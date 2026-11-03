#!/usr/bin/env node
/**
 * Responsive Layout Test Runner (OpenAI Agents SDK)
 * --------------------------------------------------
 * Dedicated entrypoint for "Responsive Check" tests: resizes the viewport to
 * each configured breakpoint, scrolls through the page capturing screenshots
 * (waiting for in-page animations/transitions to settle first), then has a
 * vision-capable agent review each screenshot for overlapping, clipped, or
 * overflowing content.
 *
 * Deterministic actions (resize/scroll/animation-wait/screenshot) are issued
 * directly against the MCP server so results don't depend on an LLM following
 * instructions precisely. Two OpenAI Agents SDK agents are used for the parts
 * that genuinely need reasoning:
 *   - "Setup Executor": runs optional free-text pre-steps (e.g. login, cookie
 *     banner dismissal) once, before the breakpoint loop.
 *   - "Responsiveness Auditor": vision review of each captured screenshot.
 *
 * This runner intentionally has no import-time dependency on ai_tool_runner.js
 * or any other runner — shared pieces live under src/utils/.
 *
 * Usage: node ai_responsive_runner.js tests/example.test.yml
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import { z } from "zod";
import { setMaxListeners } from "node:events";
import { Agent, run } from "@openai/agents";
import { generateResponsiveHtmlReport } from "./responsive-report-generator.js";
import { CDPService } from "./src/cdp/cdp.service.js";
import * as settingsRepo from "./server/db/repositories/settingsRepo.js";
import { findChromiumPath } from "./src/utils/browser-utils.js";
import { buildMcpServer as buildMcpServerShared } from "./src/utils/mcp-stdio-server.js";
import { toDataUriFromPng, captureFailureScreenshot } from "./src/utils/screenshot-utils.js";
import { moveDownloadedFiles } from "./src/utils/downloads-utils.js";
import { chunkSteps, getUserFriendlyStepFailure } from "./src/utils/step-utils.js";

setMaxListeners(50);

// Paths & Config

const __rootDir = path.dirname(fileURLToPath(import.meta.url));

const MCP_COMMAND = process.env.MCP_COMMAND ?? "npx";
const MCP_WORKSPACE_DIR = process.env.MCP_WORKSPACE_DIR ?? process.cwd();
const PLAYWRIGHT_RUN_ID = process.env.PLAYWRIGHT_RUN_ID?.trim() || "";
const PLAYWRIGHT_RUN_USER = process.env.PLAYWRIGHT_RUN_USER?.trim() || "";
const MCP_CDP_ENDPOINT = process.env.MCP_CDP_ENDPOINT;
const MCP_OUTPUT_DIR = process.env.MCP_OUTPUT_DIR ?? "files/screenshots";
const MCP_BROWSER = process.env.MCP_BROWSER?.trim();
const MCP_ISOLATED = (process.env.MCP_ISOLATED ?? "true").toLowerCase() === "true";
const MCP_HEADLESS = (process.env.MCP_HEADLESS ?? "false").toLowerCase() === "true";
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE) || 5;
const PRE_NAV_WAIT_SECONDS = Number(process.env.PRE_NAV_WAIT_SECONDS) || 10;
const MAX_SECTIONS_PER_BREAKPOINT = Number(process.env.MAX_SECTIONS_PER_BREAKPOINT) || 15;

const SETUP_EXECUTOR_INSTRUCTIONS = fs.readFileSync(
  path.join(__rootDir, "src/prompts", "executor-agent-prompt.md"),
  "utf-8"
);
const NAVIGATOR_INSTRUCTIONS = fs.readFileSync(
  path.join(__rootDir, "src/prompts", "responsive-navigator-agent-prompt.md"),
  "utf-8"
);
const AUDITOR_INSTRUCTIONS = fs.readFileSync(
  path.join(__rootDir, "src/prompts", "responsiveness-auditor-agent-prompt.md"),
  "utf-8"
);
void NAVIGATOR_INSTRUCTIONS; // Reserved for a future agent-driven navigator; deterministic path is used for now.

// Zod Schemas for Structured Output

const setupStepResultSchema = z.object({
  stepNumber: z.number().describe("The step number (e.g. 1, 2, 3)"),
  stepText: z.string().describe("The original step text from the setup steps"),
  status: z.enum(["passed", "failed"]),
  reason: z.string().optional().describe("Concise root cause or outcome summary, omit for passed steps"),
});

const setupChunkResultSchema = z.object({
  steps: z.array(setupStepResultSchema).describe("Per-step results for this chunk"),
  stoppedEarly: z.boolean().describe("True if execution stopped before completing all steps due to a failure"),
});

const captureIssueSchema = z.object({
  type: z.enum(["overlap", "clipping", "overflow", "other"]),
  description: z.string(),
});

const captureAuditSchema = z.object({
  scrollLabel: z.string().describe("The section label supplied for this image, copied verbatim"),
  passed: z.boolean(),
  issues: z.array(captureIssueSchema).default([]),
});

const breakpointAuditSchema = z.object({
  captures: z.array(captureAuditSchema),
});

const navigatorCaptureSchema = z.object({
  sectionLabel: z.string().describe("Short descriptive label for this section, e.g. 'hero', 'testimonials', 'footer'"),
  filename: z.string(),
  status: z.enum(["passed", "failed"]),
  reason: z.string().optional(),
  isFooter: z.boolean().optional().describe("True if this capture is the page footer / final section"),
});

const navigatorResultSchema = z.object({
  captures: z.array(navigatorCaptureSchema),
});

// Helpers

function safeName(value) {
  return String(value || "untitled").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildMcpServer(cdpPort, viewportWidth, viewportHeight) {
  return buildMcpServerShared({
    cdpPort,
    cdpEndpoint: MCP_CDP_ENDPOINT,
    command: MCP_COMMAND,
    workspaceDir: MCP_WORKSPACE_DIR,
    outputDir: MCP_OUTPUT_DIR,
    viewportWidth,
    viewportHeight,
    browser: MCP_BROWSER,
    isolated: MCP_ISOLATED,
    headless: MCP_HEADLESS,
  });
}

/**
 * Parses the `responsiveness:` block out of a test YAML document.
 */
function parseResponsivenessConfig(data) {
  const block = data?.responsiveness;
  if (!block || !Array.isArray(block.breakpoints) || block.breakpoints.length === 0) {
    throw new Error('Invalid test file. Expected a "responsiveness.breakpoints" array in the YAML.');
  }

  const breakpoints = block.breakpoints.map((bp, idx) => ({
    label: String(bp.label || `bp${idx + 1}`),
    width: Number(bp.width) || 1280,
    height: Number(bp.height) || 720,
  }));

  const preSteps = Array.isArray(block.preSteps)
    ? block.preSteps.map((s) => String(s)).filter((s) => s.trim().length > 0)
    : [];

  return { breakpoints, preSteps };
}

async function main() {
  const llmConfig = await settingsRepo.getLlmConfig();
  const configuredApiKey = llmConfig?.apiKey;
  if (!configuredApiKey) {
    console.error("❌ Missing OpenAI API key. Set apiKey in the LLM Config admin page.");
    process.exit(1);
  }
  process.env.OPENAI_API_KEY = configuredApiKey;

  const testFilePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__rootDir, "tests", "responsive-demo.test.yml");

  if (!fs.existsSync(testFilePath)) {
    console.error(`❌ Test file not found: ${testFilePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(testFilePath, "utf8");
  const data = yaml.load(raw);

  let responsiveConfig;
  try {
    responsiveConfig = parseResponsivenessConfig(data);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const suiteName = data.name ?? "Unnamed Responsive Suite";
  const baseUrl = data.baseUrl ?? "";
  const { breakpoints, preSteps } = responsiveConfig;

  console.log(`\n🚀 Running: ${suiteName}`);
  console.log(`🔗 Base URL: ${baseUrl}`);
  console.log(`📐 Breakpoints: ${breakpoints.map((bp) => `${bp.label} (${bp.width}x${bp.height})`).join(", ")}`);
  console.log(`📜 Scrolling section by section until the footer is reached\n`);

  const log = {
    info: (msg, d) => console.log(`ℹ️  ${msg}`, d || ""),
    success: (msg) => console.log(`✅ ${msg}`),
    error: (msg, err) => console.error(`❌ ${msg}`, err || ""),
    warn: (msg) => console.warn(`⚠️  ${msg}`),
  };

  const cdpService = new CDPService(
    { headless: MCP_HEADLESS, viewport: { width: breakpoints[0].width, height: breakpoints[0].height } },
    log
  );

  let cdpPort;
  try {
    const chromiumPath = findChromiumPath();
    cdpPort = await cdpService.initialize(chromiumPath);
  } catch (error) {
    console.error(`❌ Failed to initialize CDP service:`, error);
    process.exit(1);
  }

  const mcpServer = buildMcpServer(cdpPort, breakpoints[0].width, breakpoints[0].height);

  const setupExecutorAgent = new Agent({
    name: "Setup Executor",
    instructions: SETUP_EXECUTOR_INSTRUCTIONS,
    model: llmConfig.model,
    modelSettings: { parallelToolCalls: false },
    mcpServers: [mcpServer],
    outputType: setupChunkResultSchema,
  });

  const navigatorAgent = new Agent({
    name: "Responsive Navigator",
    instructions: NAVIGATOR_INSTRUCTIONS,
    model: llmConfig.model,
    modelSettings: { parallelToolCalls: false },
    mcpServers: [mcpServer],
    outputType: navigatorResultSchema,
  });

  const auditorAgent = new Agent({
    name: "Responsiveness Auditor",
    instructions: AUDITOR_INSTRUCTIONS,
    model: llmConfig.model,
    outputType: breakpointAuditSchema,
  });

  try {
    await mcpServer.connect();
    await mcpServer.callTool("browser_navigate", { url: "about:blank" }).catch(() => {});
    await cdpService.startScreencast();

    if (baseUrl) {
      console.log(`[Setup] Navigating to base URL: ${baseUrl}`);
      await mcpServer.callTool("browser_navigate", { url: baseUrl });
      if (PRE_NAV_WAIT_SECONDS > 0) {
        console.log(`[Setup] Waiting ${PRE_NAV_WAIT_SECONDS}s for initial page load...`);
        await mcpServer.callTool("browser_wait_for", { time: PRE_NAV_WAIT_SECONDS });
      }
    }
  } catch (error) {
    console.error(`❌ Failed to connect to MCP server or load base URL:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const setupSteps = [];
  const breakpointReports = [];
  let stepCounter = 0;
  const runStartTime = Date.now();
  const screenshotsOutputDir = path.resolve(MCP_WORKSPACE_DIR, MCP_OUTPUT_DIR);
  let reportFileBaseName = null;
  let shouldStop = false;

  const handleShutdown = async (signal) => {
    console.log(`\n⚠️ Received ${signal} — generating partial report...`);
    try {
      const reportPath = generateResponsiveHtmlReport({
        suiteName,
        baseUrl,
        setupSteps,
        breakpoints: breakpointReports,
        totalDurationMs: Date.now() - runStartTime,
        runBy: PLAYWRIGHT_RUN_USER,
      });
      reportFileBaseName = path.basename(reportPath, path.extname(reportPath));
      console.log(`📄 Partial report saved: ${reportPath}`);
    } catch (err) {
      console.error(`Failed to generate partial report:`, err.message);
    }
    await mcpServer.close().catch(() => {});
    if (cdpService) await cdpService.shutdown().catch(() => {});
    process.exit(130);
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  try {
    // Phase 0 — optional one-time setup steps (login, dismiss banners, etc.)
    if (preSteps.length > 0 && !shouldStop) {
      mcpServer.allowBrowserClose = false;
      const chunks = chunkSteps(preSteps, CHUNK_SIZE);
      console.log(`[Setup] Executing ${preSteps.length} pre-step(s) in ${chunks.length} chunk(s)...`);

      for (let chunkIdx = 0; chunkIdx < chunks.length && !shouldStop; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const startStepNum = chunkIdx * CHUNK_SIZE + 1;
        const numberedSteps = chunk.map((s, i) => `${startStepNum + i}. ${s}`).join("\n");
        const prompt = [
          baseUrl ? `Base URL: ${baseUrl}` : null,
          ``,
          `One-time setup steps before responsive checks begin. Continue in the SAME existing browser session. Do NOT close the browser.`,
          ``,
          `Setup Steps:`,
          numberedSteps,
        ].filter((l) => l !== null).join("\n");

        try {
          const chunkStart = Date.now();
          const result = await run(setupExecutorAgent, prompt, { maxTurns: 20 });
          const chunkResult = result.finalOutput;

          if (chunkResult && Array.isArray(chunkResult.steps)) {
            for (const stepResult of chunkResult.steps) {
              stepCounter++;
              let screenshotBase64 = null;
              if (stepResult.status === "failed") {
                screenshotBase64 = await captureFailureScreenshot(mcpServer);
              }
              setupSteps.push({
                stepNumber: stepCounter,
                stepText: stepResult.stepText,
                status: stepResult.status,
                reason: stepResult.reason || null,
                screenshotBase64,
                durationMs: null,
              });
              if (stepResult.status === "failed") {
                log.error(`Setup step failed: ${stepResult.stepText}`, stepResult.reason);
                shouldStop = true;
                break;
              }
            }
            if (chunkResult.stoppedEarly) shouldStop = true;
          } else {
            stepCounter++;
            setupSteps.push({
              stepNumber: stepCounter,
              stepText: chunk[0],
              status: "failed",
              reason: "Structured output not returned by setup agent",
              screenshotBase64: await captureFailureScreenshot(mcpServer),
              durationMs: Date.now() - chunkStart,
            });
            shouldStop = true;
          }
        } catch (err) {
          stepCounter++;
          setupSteps.push({
            stepNumber: stepCounter,
            stepText: chunk[0],
            status: "failed",
            reason: getUserFriendlyStepFailure(err.message),
            screenshotBase64: await captureFailureScreenshot(mcpServer),
            durationMs: null,
          });
          shouldStop = true;
        }
      }
    }

    // Phase 1+ — AI-guided resize/scroll/capture per breakpoint, then vision audit
    for (let bpIdx = 0; bpIdx < breakpoints.length && !shouldStop; bpIdx++) {
      const bp = breakpoints[bpIdx];
      const isLastBreakpoint = bpIdx === breakpoints.length - 1;
      mcpServer.allowBrowserClose = isLastBreakpoint;

      console.log(`\n${"═".repeat(60)}\n[Breakpoint ${bpIdx + 1}/${breakpoints.length}] ${bp.label} (${bp.width}x${bp.height})\n${"═".repeat(60)}`);

      const bpReport = { label: bp.label, width: bp.width, height: bp.height, status: "passed", reason: null, durationMs: null, captures: [] };
      breakpointReports.push(bpReport);
      const navigatorStart = Date.now();
      const captures = []; // { label, filename, filePath, dataUri, stepNumber }

      const navigatorPrompt = [
        `Breakpoint: ${bp.label} (${bp.width}x${bp.height}).`,
        `Resize the viewport to exactly ${bp.width}x${bp.height}.`,
        `This page must be reviewed section by section — do NOT scroll by fixed percentages.`,
        `Starting at the very top of the page (before any scrolling), capture the first visible section.`,
        `Then repeat: scroll down toward the next distinct section of the page (e.g. hero, feature block, testimonials, pricing, footer), wait briefly for the page to settle, and capture a screenshot. Inspect the page and choose the appropriate Playwright tool for scrolling, including the correct scroll container if the page uses a custom one.`,
        `Continue section by section until you capture the page footer, then stop. Do not scroll past the footer and do not capture the same section twice.`,
        `Capture at most ${MAX_SECTIONS_PER_BREAKPOINT} sections total.`,
        `Save each screenshot using the filename pattern "${safeName(suiteName)}_${safeName(bp.label)}_section-<N>.png", where <N> is the 1-based section index for this breakpoint.`,
        `Return one result per captured section, in order, with the exact filename used, a short descriptive sectionLabel (e.g. "hero", "testimonials", "footer"), and isFooter set to true for the final/footer section.`,
      ].join("\n");

      try {
        const navigatorRun = await run(navigatorAgent, navigatorPrompt, {
          maxTurns: Math.max(30, MAX_SECTIONS_PER_BREAKPOINT * 6),
        });
        const navigatorCaptures = navigatorRun.finalOutput?.captures || [];
        if (navigatorCaptures.length === 0) {
          throw new Error("Navigator did not return any section captures");
        }

        for (const navigatorCapture of navigatorCaptures) {
          const captureStart = Date.now();
          const stepNumber = ++stepCounter;
          // Sanitize the agent-supplied filename to prevent path traversal.
          const safeFilename = path.basename(String(navigatorCapture.filename || "")).replace(/[^a-zA-Z0-9_.-]/g, "_");
          const label = navigatorCapture.sectionLabel || `section-${captures.length + 1}`;
          const filePath = path.join(screenshotsOutputDir, safeFilename);
          const capture = { label, filename: safeFilename, filePath, stepNumber, dataUri: null };

          try {
            if (!safeFilename || navigatorCapture.status !== "passed") {
              throw new Error(navigatorCapture?.reason || "Navigator did not complete this capture");
            }
            capture.dataUri = toDataUriFromPng(filePath);
            captures.push(capture);
            bpReport.captures.push({
              stepNumber,
              scrollLabel: label,
              status: "passed",
              reason: null,
              issues: [],
              screenshotBase64: capture.dataUri,
              durationMs: Date.now() - captureStart,
            });
          } catch (err) {
            bpReport.captures.push({
              stepNumber,
              scrollLabel: label,
              status: "failed",
              reason: getUserFriendlyStepFailure(err.message),
              issues: [],
              screenshotBase64: await captureFailureScreenshot(mcpServer),
              durationMs: Date.now() - captureStart,
            });
          }
        }
      } catch (err) {
        bpReport.status = "failed";
        bpReport.reason = getUserFriendlyStepFailure(err.message);
        bpReport.captures.push({
          stepNumber: ++stepCounter,
          scrollLabel: "section-1",
          status: "failed",
          reason: bpReport.reason,
          issues: [],
          screenshotBase64: await captureFailureScreenshot(mcpServer),
          durationMs: null,
        });
      }
      bpReport.durationMs = Date.now() - navigatorStart;

      // Vision audit — one batched agent call per breakpoint covering all successful captures.
      const auditable = captures.filter((c) => c.dataUri);
      if (auditable.length > 0) {
        try {
          const promptLines = [
            `Breakpoint: ${bp.label} (${bp.width}x${bp.height}).`,
            `You are given ${auditable.length} screenshot(s) in order, one per page section. Review each independently.`,
            ...auditable.map((c, i) => `Image ${i + 1} = scrollLabel "${c.label}".`),
          ];

          const content = [
            { type: "input_text", text: promptLines.join("\n") },
            ...auditable.map((c) => ({ type: "input_image", image: c.dataUri })),
          ];

          const auditResult = await run(auditorAgent, [{ role: "user", content }]);
          const audit = auditResult.finalOutput;

          const byLabel = new Map((audit?.captures || []).map((c) => [c.scrollLabel, c]));
          for (const capture of auditable) {
            const found = byLabel.get(capture.label);
            const reportCapture = bpReport.captures.find((c) => c.stepNumber === capture.stepNumber);
            if (!reportCapture) continue;

            if (!found) {
              reportCapture.status = "failed";
              reportCapture.reason = "Responsiveness auditor did not return a result for this section";
              continue;
            }

            reportCapture.status = found.passed ? "passed" : "failed";
            reportCapture.issues = found.issues || [];
            reportCapture.reason = found.passed
              ? null
              : (found.issues || []).map((i) => `[${i.type}] ${i.description}`).join("; ") || "Layout issue detected";
          }
        } catch (err) {
          log.warn(`Responsiveness audit failed for ${bp.label} (non-fatal): ${err.message}`);
          for (const capture of auditable) {
            const reportCapture = bpReport.captures.find((c) => c.stepNumber === capture.stepNumber);
            if (reportCapture) {
              reportCapture.status = "failed";
              reportCapture.reason = `Could not complete AI review: ${err.message}`;
            }
          }
        }
      }
    }

    const allCaptures = breakpointReports.flatMap((bp) => bp.captures);
    const passed = setupSteps.filter((s) => s.status === "passed").length
      + breakpointReports.filter((bp) => bp.status === "passed").length
      + allCaptures.filter((c) => c.status === "passed").length;
    const failed = setupSteps.filter((s) => s.status === "failed").length
      + breakpointReports.filter((bp) => bp.status === "failed").length
      + allCaptures.filter((c) => c.status === "failed").length;
    const totalDurationMs = Date.now() - runStartTime;

    console.log(`\n${"═".repeat(60)}`);
    console.log(`📊 FINAL RESULTS  (${passed} passed / ${failed} failed)`);
    console.log("═".repeat(60));
    for (const s of setupSteps) {
      const icon = s.status === "passed" ? "✅" : "❌";
      console.log(`  ${icon} [Setup] ${s.stepText}`);
      if (s.reason) console.log(`       ${s.reason}`);
    }
    for (const bp of breakpointReports) {
      console.log(`  📐 ${bp.label} (${bp.width}x${bp.height})`);
      if (bp.status === "failed") {
        console.log(`       ❌ ${bp.reason}`);
        continue;
      }
      for (const c of bp.captures) {
        const icon = c.status === "passed" ? "✅" : "❌";
        console.log(`    ${icon} section ${c.scrollLabel}`);
        if (c.reason) console.log(`         ${c.reason}`);
      }
    }
    console.log(`${"═".repeat(60)}\n`);

    const reportPath = generateResponsiveHtmlReport({
      suiteName,
      baseUrl,
      setupSteps,
      breakpoints: breakpointReports,
      totalDurationMs,
      runBy: PLAYWRIGHT_RUN_USER,
    });
    reportFileBaseName = path.basename(reportPath, path.extname(reportPath));
    console.log(`📄 HTML Report saved: ${reportPath}\n`);
    console.log(`__REPORT_FILE__${path.basename(reportPath)}`);
  } catch (error) {
    console.error(`\n❌ Responsive run failed:`, error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
  } finally {
    await mcpServer.close();
    if (cdpService) await cdpService.shutdown();

    const fallbackFolderName = `${safeName(suiteName).toLowerCase()}-${new Date(runStartTime)
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19)}`;
    const runFolderName = PLAYWRIGHT_RUN_ID
      ? `${safeName(suiteName).toLowerCase()}-${PLAYWRIGHT_RUN_ID}`
      : reportFileBaseName || fallbackFolderName;
    const downloadsDir = path.resolve(MCP_WORKSPACE_DIR, "Downloads", runFolderName);
    moveDownloadedFiles(screenshotsOutputDir, downloadsDir, MCP_WORKSPACE_DIR);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
