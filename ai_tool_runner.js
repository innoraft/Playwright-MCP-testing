import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import { z } from "zod";
import { setMaxListeners } from "node:events";
import { Agent, run } from "@openai/agents";
import { generateHtmlReport } from "./tool-call-report-generator.js";
import { CDPService } from './src/cdp/cdp.service.js';
import * as settingsRepo from './server/db/repositories/settingsRepo.js';
import { findChromiumPath } from './src/utils/browser-utils.js';
import { buildMcpServer as buildMcpServerShared } from './src/utils/mcp-stdio-server.js';
import {
  toDataUriFromPng,
  collectChunkScreenshotsByStep,
  findLatestScreenshot,
  captureFailureScreenshot,
} from './src/utils/screenshot-utils.js';
import { moveDownloadedFiles } from './src/utils/downloads-utils.js';
import { chunkSteps, getUserFriendlyStepFailure } from './src/utils/step-utils.js';

setMaxListeners(50);

// Paths & Config

const __rootDir = path.dirname(fileURLToPath(import.meta.url));

const MCP_COMMAND = process.env.MCP_COMMAND ?? "npx";
const MCP_WORKSPACE_DIR = process.env.MCP_WORKSPACE_DIR ?? process.cwd();
const PLAYWRIGHT_RUN_ID = process.env.PLAYWRIGHT_RUN_ID?.trim() || "";
const PLAYWRIGHT_RUN_USER = process.env.PLAYWRIGHT_RUN_USER?.trim() || "";
const MCP_CDP_ENDPOINT = process.env.MCP_CDP_ENDPOINT;
const MCP_OUTPUT_DIR = process.env.MCP_OUTPUT_DIR ?? "files/screenshots";
const VIEWPORT_WIDTH = process.env.PLAYWRIGHT_VIEWPORT_WIDTH ?? "1440";
const VIEWPORT_HEIGHT = process.env.PLAYWRIGHT_VIEWPORT_HEIGHT ?? "900";
const MCP_BROWSER = process.env.MCP_BROWSER?.trim();
const MCP_ISOLATED = (process.env.MCP_ISOLATED ?? "true").toLowerCase() === "true";
const MCP_HEADLESS = (process.env.MCP_HEADLESS ?? "false").toLowerCase() === "true";
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE) || 5;
const PRE_NAV_WAIT_SECONDS = Number(process.env.PRE_NAV_WAIT_SECONDS) || 10;

const EXECUTOR_INSTRUCTIONS = fs.readFileSync(
  path.join (__rootDir, "src/prompts", "executor-agent-prompt.md"),
  "utf-8"
)

// Zod Schemas for Structured Output

const stepResultSchema = z.object({
  stepNumber: z.number().describe("The step number (e.g. 1, 2, 3)"),
  stepText: z.string().describe("The original step text from the test plan"),
  status: z.enum(["passed", "failed"]),
  reason: z.string().optional().describe("Concise root cause or outcome summary. Keep it brief when possible within 30 words and omit for passed steps"),
  screenshotTaken: z
    .boolean()
    .describe("Whether a screenshot was taken for this step (should be true on failure)"),
});

const chunkResultSchema = z.object({
  steps: z.array(stepResultSchema).describe("Per-step results for this chunk"),
  stoppedEarly: z
    .boolean()
    .describe("True if execution stopped before completing all steps due to a failure"),
});

// Build MCP Server

function buildMcpServer(cdpPort) {
  return buildMcpServerShared({
    cdpPort,
    cdpEndpoint: MCP_CDP_ENDPOINT,
    command: MCP_COMMAND,
    workspaceDir: MCP_WORKSPACE_DIR,
    outputDir: MCP_OUTPUT_DIR,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    browser: MCP_BROWSER,
    isolated: MCP_ISOLATED,
    headless: MCP_HEADLESS,
  });
}

// Helpers

// chunkSteps, getUserFriendlyStepFailure, captureFailureScreenshot, toDataUriFromPng,
// collectChunkScreenshotsByStep, moveDownloadedFiles and findLatestScreenshot now live in src/utils/.

// Main

async function main() {
  const llmConfig = await settingsRepo.getLlmConfig();
  const configuredApiKey = llmConfig?.apiKey;
  if (!configuredApiKey) {
    console.error('❌ Missing OpenAI API key. Set apiKey in the LLM Config admin page.');
    process.exit(1);
  }
  // OpenAI Agents SDK reads OPENAI_API_KEY from process env.
  process.env.OPENAI_API_KEY = configuredApiKey;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Resolve test file from CLI arg or default
  const testFilePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, "tests", "demo-login.yml");

  if (!fs.existsSync(testFilePath)) {
    console.error(`❌ Test file not found: ${testFilePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(testFilePath, "utf8");
  const data = yaml.load(raw);

  const steps = Array.isArray(data?.steps)
    ? data.steps
    : Array.isArray(data?.tests) && Array.isArray(data.tests[0]?.steps)
      ? data.tests[0].steps
      : null;

  if (!steps) {
    console.error('❌ Invalid test file. Expected "steps" or "tests[].steps" in YAML.');
    process.exit(1);
  }

  const suiteName = data.name ?? "Unnamed Suite";
  const baseUrl = data.baseUrl ?? "";

  console.log(`\n🚀 Running: ${suiteName}`);
  console.log(`🔗 Base URL: ${baseUrl}`);
  console.log(`📋 Steps: ${steps.length}`);
  console.log(`📦 Chunk size: ${CHUNK_SIZE}\n`);

  const log = {
    info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
    success: (msg) => console.log(`✅ ${msg}`),
    error: (msg, err) => console.error(`❌ ${msg}`, err || ''),
    warn: (msg) => console.warn(`⚠️  ${msg}`)
  };

  const cdpService = new CDPService({
    headless: MCP_HEADLESS,
    viewport: { width: Number(VIEWPORT_WIDTH), height: Number(VIEWPORT_HEIGHT) }
  }, log);

  let cdpPort;
  try {
    const chromiumPath = findChromiumPath();
    cdpPort = await cdpService.initialize(chromiumPath);
  } catch (error) {
    console.error(`❌ Failed to initialize CDP service:`, error);
    process.exit(1);
  }

  const mcpServer = buildMcpServer(cdpPort);
  
  const executorAgent = new Agent({
    name: "Executor",
    instructions: EXECUTOR_INSTRUCTIONS,
    model: llmConfig.model,
    modelSettings: { parallelToolCalls: false },
    mcpServers: [mcpServer],
    outputType: chunkResultSchema,
  });

  try {
    await mcpServer.connect();
    // Force Playwright to initialize the context/page before screencast attaches
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
    console.error(
      `❌ Failed to connect to MCP server or load base URL:`,
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }

  // { stepNumber, stepText, status, reason, screenshotBase64, durationMs }
  const allResults = [];
  const runStartTime = Date.now();
  const screenshotsOutputDir = path.resolve(MCP_WORKSPACE_DIR, MCP_OUTPUT_DIR);
  let reportFileBaseName = null;
  let shouldStop = false;

  // Graceful shutdown handler — generates partial report on interrupt
  const handleShutdown = async (signal) => {
    console.log(`\n⚠️ Received ${signal} — generating partial report...`);

    // Mark any not-yet-reported steps as skipped
    const reportedStepNums = new Set(allResults.map((r) => r.stepNumber));
    for (let i = 0; i < steps.length; i++) {
      if (!reportedStepNums.has(i + 1)) {
        allResults.push({
          stepNumber: i + 1,
          stepText: steps[i],
          status: "skipped",
          reason: `Skipped — execution interrupted by ${signal}`,
          screenshotBase64: null,
          durationMs: null,
        });
      }
    }

    try {
      const reportPath = generateHtmlReport({
        suiteName,
        baseUrl,
        results: allResults,
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
    const chunks = chunkSteps(steps, CHUNK_SIZE);

    console.log(`[Agent] Executing ${chunks.length} chunk(s) of steps (max ${CHUNK_SIZE} per chunk)...\n`);

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      if (shouldStop) break;

      const chunk = chunks[chunkIdx];
      const isFinalChunk = chunkIdx === chunks.length - 1;
      const startStepNum = chunkIdx * CHUNK_SIZE + 1;
      const endStepNum = startStepNum + chunk.length - 1;
      const chunkStartTime = Date.now();
      const chunkStepNumbers = chunk.map((_, i) => startStepNum + i);

      console.log(
        `\n${"═".repeat(60)}\n[Chunk ${chunkIdx + 1}/${chunks.length}] Steps ${startStepNum}-${endStepNum}\n${"═".repeat(60)}`
      );

      // Keep one browser session alive across chunks; only allow close on final chunk.
      mcpServer.allowBrowserClose = isFinalChunk;

      const numberedSteps = chunk.map((s, i) => `${startStepNum + i}. ${s}`).join("\n");
      const prompt = [
        baseUrl ? `Base URL: ${baseUrl}` : null,
        ``,
        `Chunk ${chunkIdx + 1} of ${chunks.length}. Continue in the SAME existing browser session.`,
        isFinalChunk
          ? `This is the final chunk. You may close browser only after all steps here are finished.`
          : `Do NOT close the browser in this chunk.`,
        ``,
        `Test Steps:`,
        numberedSteps,
      ]
        .filter((line) => line !== null)
        .join("\n");

      try {
        const stream = await run(executorAgent, prompt, { stream: true, maxTurns: 30 });

        // Stream events for live console output
        for await (const event of stream) {
          if (event.type === "run_item_stream_event") {
            const item = event.item;
            if (item.type === "tool_call_item") {
              const toolName = item.rawItem?.name ?? item.name ?? "unknown";
              console.log(`    🔧 Tool call: ${toolName}`);
            } else if (item.type === "tool_call_output_item") {
              const output = item.output ?? "";
              const text = typeof output === "string" ? output : JSON.stringify(output);
              const preview = text.slice(0, 120);
              console.log(`    📨 Tool result: ${preview}${text.length > 120 ? "…" : ""}`);
            } else if (item.type === "message_output_item") {
              console.log(`    💬 Agent message received`);
            }
          } else if (event.type === "agent_updated_stream_event") {
            console.log(`    🤖 Agent: ${event.agent.name}`);
          }
        }

        const chunkDurationMs = Date.now() - chunkStartTime;

        // Extract structured output
        const chunkResult = stream.finalOutput;

        if (chunkResult && Array.isArray(chunkResult.steps)) {
          console.log(`\n  📋 Chunk ${chunkIdx + 1} structured results:`);

          for (const stepResult of chunkResult.steps) {
            const icon = stepResult.status === "passed" ? "✅" : "❌";
            console.log(
              `    ${icon} Step ${stepResult.stepNumber}: ${stepResult.stepText} — ${stepResult.reason}`
            );

            const stepScreenshotsByStep = collectChunkScreenshotsByStep(
              screenshotsOutputDir,
              chunkStartTime,
              chunkStepNumbers
            );

            const resultEntry = {
              stepNumber: stepResult.stepNumber,
              stepText: stepResult.stepText,
              status: stepResult.status,
              reason: stepResult.reason,
              screenshots: stepScreenshotsByStep.get(stepResult.stepNumber) ?? [],
              screenshotBase64: null,
              durationMs: null, // per-step duration not available from structured output
            };

            if (resultEntry.screenshots.length > 0) {
              resultEntry.screenshotBase64 = resultEntry.screenshots[0];
            }

            // On failure: capture screenshot
            if (stepResult.status === "failed") {
              console.log(`\n  ❌ Step ${stepResult.stepNumber} FAILED — stopping execution.`);

              // Try to get screenshot: agent may have taken one, or we do it programmatically
              if (stepResult.screenshotTaken) {
                // Agent took a screenshot — try to find it in the output directory
                resultEntry.screenshotBase64 = findLatestScreenshot(
                  path.resolve(MCP_WORKSPACE_DIR, MCP_OUTPUT_DIR)
                );
              }

              // Fallback: take one programmatically if we don't have it
              if (!resultEntry.screenshotBase64) {
                const fallbackImage = await captureFailureScreenshot(mcpServer);
                if (fallbackImage) {
                  resultEntry.screenshotBase64 = fallbackImage;
                  resultEntry.screenshots = [fallbackImage, ...(resultEntry.screenshots ?? [])];
                }
              }

              // Second fallback: check output dir again (the programmatic call may have saved a file)
              if (!resultEntry.screenshotBase64) {
                const latestImage = findLatestScreenshot(
                  path.resolve(MCP_WORKSPACE_DIR, MCP_OUTPUT_DIR)
                );
                if (latestImage) {
                  resultEntry.screenshotBase64 = latestImage;
                  resultEntry.screenshots = [latestImage, ...(resultEntry.screenshots ?? [])];
                }
              }

              allResults.push(resultEntry);
              shouldStop = true;
              break;
            }

            allResults.push(resultEntry);
          }

          // If chunk reported stoppedEarly but we haven't caught a failure yet, mark it
          if (chunkResult.stoppedEarly && !shouldStop) {
            console.log(`  ⚠️ Chunk reported stoppedEarly but no failure found in results.`);
            shouldStop = true;
          }
        } else {
          // Structured output parsing failed — treat entire chunk as failed
          console.error(
            `  ⚠️ Chunk ${chunkIdx + 1}: Could not parse structured output. Treating as failure.`
          );

          // Take a screenshot for diagnostics
          const screenshotBase64 = await captureFailureScreenshot(mcpServer);

          // Mark the first step of this chunk as failed
          allResults.push({
            stepNumber: startStepNum,
            stepText: chunk[0],
            status: "failed",
            reason: "Structured output not returned by agent — chunk execution may have failed",
            screenshotBase64,
            durationMs: chunkDurationMs,
          });
          shouldStop = true;
        }

        if (!shouldStop) {
          console.log(`  ✓ Chunk ${chunkIdx + 1} completed (${(chunkDurationMs / 1000).toFixed(1)}s)\n`);
        }
      } catch (chunkError) {
        const message = chunkError instanceof Error ? chunkError.message : String(chunkError);
        console.error(`  ❌ Chunk ${chunkIdx + 1} threw an error: ${message}`);

        // Take screenshot on chunk error
        const screenshotBase64 = await captureFailureScreenshot(mcpServer);

        allResults.push({
          stepNumber: startStepNum,
          stepText: chunk[0],
          status: "failed",
          reason: getUserFriendlyStepFailure(message),
          screenshotBase64,
          durationMs: Date.now() - chunkStartTime,
        });
        shouldStop = true;
      }
    }

    // Mark remaining steps as SKIPPED
    const reportedStepNums = new Set(allResults.map((r) => r.stepNumber));
    for (let i = 0; i < steps.length; i++) {
      if (!reportedStepNums.has(i + 1)) {
        allResults.push({
          stepNumber: i + 1,
          stepText: steps[i],
          status: "skipped",
          reason: "Skipped — a previous step failed",
          screenshotBase64: null,
          durationMs: null,
        });
      }
    }

    // Sort results by step number
    allResults.sort((a, b) => a.stepNumber - b.stepNumber);

    // Console Summary
    const passed = allResults.filter((r) => r.status === "passed").length;
    const failed = allResults.filter((r) => r.status === "failed").length;
    const skipped = allResults.filter((r) => r.status === "skipped").length;
    const totalDurationMs = Date.now() - runStartTime;

    console.log(`\n${"═".repeat(60)}`);
    console.log(
      `📊 FINAL RESULTS  (${passed} passed / ${failed} failed / ${skipped} skipped / ${allResults.length} total)`
    );
    console.log("═".repeat(60));
    for (const r of allResults) {
      const icons = { passed: "✅", failed: "❌", skipped: "⏭" };
      const icon = icons[r.status] ?? "❓";
      console.log(`  ${icon} Step ${String(r.stepNumber).padStart(2, "0")}  ${r.stepText}`);
      if (r.reason) {
        console.log(`       ${r.reason}`);
      }
    }
    console.log(`${"═".repeat(60)}\n`);

    // Generate HTML Report
    const reportPath = generateHtmlReport({
      suiteName,
      baseUrl,
      results: allResults,
      totalDurationMs,
      runBy: PLAYWRIGHT_RUN_USER,
    });
    reportFileBaseName = path.basename(reportPath, path.extname(reportPath));
    console.log(`📄 HTML Report saved: ${reportPath}\n`);
    console.log(`__REPORT_FILE__${path.basename(reportPath)}`);
  } catch (error) {
    console.error(`\n❌ Agent execution failed:`, error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  } finally {
    await mcpServer.close();
    if (cdpService) await cdpService.shutdown();
    const fallbackFolderName = `${suiteName
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .toLowerCase()}-${new Date(runStartTime).toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    // Keep the folder human-readable (suite name) while still ending in currentRunId so
    // server/index.js's post-run ownership scan (suffix match) can find and attribute it.
    const safeSuiteName = suiteName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const runFolderName = PLAYWRIGHT_RUN_ID
      ? `${safeSuiteName}-${PLAYWRIGHT_RUN_ID}`
      : reportFileBaseName || fallbackFolderName;
    const downloadsDir = path.resolve(MCP_WORKSPACE_DIR, "Downloads", runFolderName);
    moveDownloadedFiles(screenshotsOutputDir, downloadsDir, MCP_WORKSPACE_DIR);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
