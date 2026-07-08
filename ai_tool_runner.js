import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import { z } from "zod";
import { setMaxListeners } from "node:events";
import { execSync } from "child_process";
import { Agent, run } from "@openai/agents";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateHtmlReport } from "./tool-call-report-generator.js";
import { CDPService } from './src/cdp/cdp.service.js';
import llmConfig from './config/llm.config.js';

setMaxListeners(50);

// Paths & Config

const __rootDir = path.dirname(fileURLToPath(import.meta.url));

const MCP_COMMAND = process.env.MCP_COMMAND ?? "npx";
const MCP_WORKSPACE_DIR = process.env.MCP_WORKSPACE_DIR ?? process.cwd();
const MCP_CDP_ENDPOINT = process.env.MCP_CDP_ENDPOINT;
const MCP_OUTPUT_DIR = process.env.MCP_OUTPUT_DIR ?? "files/screenshots";
const VIEWPORT_WIDTH = process.env.PLAYWRIGHT_VIEWPORT_WIDTH ?? "1440";
const VIEWPORT_HEIGHT = process.env.PLAYWRIGHT_VIEWPORT_HEIGHT ?? "900";
const MCP_BROWSER = process.env.MCP_BROWSER?.trim();
const MCP_ISOLATED = (process.env.MCP_ISOLATED ?? "true").toLowerCase() === "true";
const MCP_HEADLESS = (process.env.MCP_HEADLESS ?? "false").toLowerCase() === "true";
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE) || 7;
const PRE_EXEC_STEPS = 2;
const PRE_NAV_WAIT_SECONDS = Number(process.env.PRE_NAV_WAIT_SECONDS) || 10;

/**
 * Resolves the Chromium executable path using multiple fallback strategies.
 * Exported so it can be reused by the server and form-validation runner.
 * @returns {string} Absolute path to Chromium binary
 */
export function findChromiumPath() {
  let chromiumPath;

  // 1. Try playwright-core's reported path
  try {
    const reported = execSync('node -e "const pw = require(\'playwright-core\'); console.log(pw.chromium.executablePath())"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (reported && fs.existsSync(reported)) chromiumPath = reported;
  } catch { /* ignore */ }

  // 2. Scan ms-playwright cache for any installed chromium (not headless_shell)
  if (!chromiumPath) {
    const cacheDir = path.join(process.env.HOME || '/root', '.cache', 'ms-playwright');
    try {
      const dirs = fs.readdirSync(cacheDir)
        .filter(d => d.startsWith('chromium-') && !d.includes('headless'))
        .sort().reverse();
      for (const dir of dirs) {
        const candidates = [
          path.join(cacheDir, dir, 'chrome-linux64', 'chrome'),
          path.join(cacheDir, dir, 'chrome-linux', 'chrome')
        ];
        const found = candidates.find(p => fs.existsSync(p));
        if (found) { chromiumPath = found; break; }
      }
    } catch { /* ignore */ }
  }

  // 3. Fallback to system-installed Chromium / Chrome
  if (!chromiumPath) {
    const fallbacks = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];
    chromiumPath = fallbacks.find(p => fs.existsSync(p)) || '';
  }

  if (!chromiumPath || !fs.existsSync(chromiumPath)) {
    throw new Error('Chromium not found. Run "npx playwright install chromium" to install it.');
  }
  return chromiumPath;
}

// Executor Instructions

const EXECUTOR_INSTRUCTIONS = fs.readFileSync(
  path.join (__rootDir, "src/prompts", "executor-agent-prompt.md"),
  "utf-8"
)

// Zod Schemas for Structured Output

const stepResultSchema = z.object({
  stepNumber: z.number().describe("The step number (e.g. 1, 2, 3)"),
  stepText: z.string().describe("The original step text from the test plan"),
  status: z.enum(["passed", "failed"]),
  reason: z.string().max(30).optional().describe("For passed steps: omit or keep to <10 words. For failed steps: concise root cause, max 30 chars."),
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

// MCP Server (Stdio transport)

class MCPServerSdkStdio {
  cacheToolsList = true;
  toolFilter;
  toolMetaResolver;
  errorFunction;
  allowBrowserClose = true;
  _cachedTools;
  _client;
  _transport;

  constructor(options = {}) {
    this._name = options.name ?? "playwright";
    this._command = options.command ?? "npx";
    this._args = options.args ?? [];
    this._cwd = options.cwd;
    this._env = options.env;
    this.cacheToolsList = options.cacheToolsList ?? true;
    this.toolFilter = options.toolFilter;
    this.toolMetaResolver = options.toolMetaResolver;
    this.errorFunction = options.errorFunction;
  }

  get name() {
    return this._name;
  }

  async connect() {
    if (this._client) {
      return;
    }

    console.log(`\n[MCP] Connecting to Playwright MCP...`);
    console.log(`[MCP] Command: ${this._command} ${this._args.join(" ")}`);

    this._transport = new StdioClientTransport({
      command: this._command,
      args: this._args,
      cwd: this._cwd,
      stderr: "inherit",
      env: this._env,
    });

    this._client = new MCPClient({
      name: "stateless-mcp-runner",
      version: "2.0.0",
    });

    await this._client.connect(this._transport);
    console.log(`[MCP] Connected successfully\n`);
  }

  async close() {
    if (!this._client) {
      return;
    }

    try {
      await this._client.close();
    } finally {
      this._client = undefined;
      this._transport = undefined;
      this._cachedTools = undefined;
    }
  }

  async listTools() {
    if (this.cacheToolsList && this._cachedTools) {
      return this._cachedTools;
    }

    try {
      console.log(`[MCP] Fetching available tools...`);
      const result = await this._client.listTools();
      const tools = (result?.tools ?? []).map((toolDef) => ({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: {
          type: "object",
          properties: toolDef.inputSchema?.properties ?? {},
          required: toolDef.inputSchema?.required ?? [],
          additionalProperties: toolDef.inputSchema?.additionalProperties ?? true,
        },
      }));

      console.log(`[MCP] Found ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

      if (this.cacheToolsList) {
        this._cachedTools = tools;
      }

      return tools;
    } catch (error) {
      console.error(`[MCP] Failed to list tools:`, error);
      throw error;
    }
  }

  async callTool(toolName, args, meta) {
    try {
      if (toolName === "browser_close" && !this.allowBrowserClose) {
        console.log("[MCP] Skipping browser_close to preserve session across chunks");
        return [
          {
            type: "text",
            text: "### Result\nSkipped browser_close to keep session alive for next chunks.",
          },
        ];
      }

      console.log(`[MCP] Calling tool: ${toolName} with args: ${JSON.stringify(args).slice(0, 200)}`);
      const result = await this._client.callTool({
        name: toolName,
        arguments: args ?? {},
        _meta: meta ?? undefined,
      });

      // Ensure we return the content array in the expected format
      let content = result?.content ?? [];
      if (!Array.isArray(content)) {
        content = [{ type: "text", text: JSON.stringify(content) }];
      }
      console.log(`[MCP] Tool result: ${JSON.stringify(content).slice(0, 200)}`);
      return content;
    } catch (error) {
      console.error(`[MCP] Tool call failed:`, error);
      throw error;
    }
  }

  async listResources(params = {}) {
    return this._client.listResources(params);
  }

  async listResourceTemplates(params = {}) {
    return this._client.listResourceTemplates(params);
  }

  async readResource(uri) {
    return this._client.readResource({ uri });
  }

  async invalidateToolsCache() {
    this._cachedTools = undefined;
  }
}

// Build MCP Server

function buildMcpServer(cdpPort) {
  const args = ["@playwright/mcp"];
  const finalCdpEndpoint = cdpPort ? `http://127.0.0.1:${cdpPort}` : MCP_CDP_ENDPOINT;
  if (finalCdpEndpoint) {
    args.push("--cdp-endpoint", finalCdpEndpoint);
    if (MCP_ISOLATED) {
      args.push("--isolated");
    }
  } else {
    // Use a clean Playwright-managed browser profile to avoid native password/change-password prompts.
    if (MCP_HEADLESS) {
      args.push("--headless");
    }
    if (MCP_BROWSER) {
      args.push("--browser", MCP_BROWSER);
    }
    if (MCP_ISOLATED) {
      args.push("--isolated");
    }
  }
  args.push(
    "--ignore-https-errors",
    "--output-dir",
    MCP_OUTPUT_DIR,
    "--viewport-size",
    `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`,
    "--image-responses",
    "omit"
  );

  return new MCPServerSdkStdio({
    name: "playwright",
    command: MCP_COMMAND,
    args,
    cwd: MCP_WORKSPACE_DIR,
    env: { 
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --unhandled-rejections=warn`.trim()
    },
  });
}

// Helpers

/**
 * Splits steps into chunks of specified size.
 */
function chunkSteps(steps, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < steps.length; i += chunkSize) {
    chunks.push(steps.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Programmatic screenshot capture as fallback when agent doesn't take one.
 * Returns base64 data URI or null.
 */
async function captureFailureScreenshot(server) {
  try {
    console.log(`  📸 Taking fallback failure screenshot...`);
    const result = await server.callTool("browser_take_screenshot", {});
    const content = result?.content ?? result;

    if (Array.isArray(content)) {
      for (const item of content) {
        // MCP screenshot returns image as base64 in the content
        if (item.type === "image" && item.data) {
          return `data:${item.mimeType || "image/png"};base64,${item.data}`;
        }
      }
      // Sometimes the screenshot path is returned as text
      for (const item of content) {
        if (item.type === "text" && item.text) {
          // Check if MCP saved a file — read it and convert to base64
          const match = item.text.match(/Screenshot saved to[:\s]+(.+\.png)/i);
          if (match) {
            const screenshotPath = match[1].trim();
            if (fs.existsSync(screenshotPath)) {
              const imgBuffer = fs.readFileSync(screenshotPath);
              return `data:image/png;base64,${imgBuffer.toString("base64")}`;
            }
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.error(`  ⚠️ Failed to capture fallback screenshot:`, err.message ?? err);
    return null;
  }
}

function toDataUriFromPng(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const imgBuffer = fs.readFileSync(filePath);
    return `data:image/png;base64,${imgBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function listScreenshotsWithMtime(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => {
      const fullPath = path.join(outputDir, f);
      return {
        name: f,
        fullPath,
        mtime: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => a.mtime - b.mtime);
}

function parseStepNumberFromScreenshotName(fileName) {
  if (!fileName) return null;
  const match = fileName.match(/(?:^|[_-])step[_-]?(\d+)(?:[_-]|\.|$)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function collectChunkScreenshotsByStep(outputDir, chunkStartMs, chunkStepNumbers) {
  const byStep = new Map();
  const chunkSet = new Set(chunkStepNumbers);
  const fresh = listScreenshotsWithMtime(outputDir).filter((f) => f.mtime >= chunkStartMs);
  const unassigned = [];

  for (const file of fresh) {
    const uri = toDataUriFromPng(file.fullPath);
    if (!uri) continue;
    const parsedStep = parseStepNumberFromScreenshotName(file.name);
    if (parsedStep && chunkSet.has(parsedStep)) {
      const arr = byStep.get(parsedStep) ?? [];
      arr.push(uri);
      byStep.set(parsedStep, arr);
    } else {
      unassigned.push(uri);
    }
  }

  // Fallback assignment for screenshots without step-based filename.
  if (unassigned.length > 0) {
    let cursor = 0;
    for (const stepNum of chunkStepNumbers) {
      if (cursor >= unassigned.length) break;
      const arr = byStep.get(stepNum) ?? [];
      if (arr.length === 0) {
        arr.push(unassigned[cursor]);
        cursor += 1;
        byStep.set(stepNum, arr);
      }
    }
  }

  return byStep;
}

/**
 * Try to find a screenshot file from the output directory for the most recent capture.
 */
function findLatestScreenshot(outputDir) {
  try {
    if (!fs.existsSync(outputDir)) return null;
    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(outputDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const latestPath = path.join(outputDir, files[0].name);
    const imgBuffer = fs.readFileSync(latestPath);
    return `data:image/png;base64,${imgBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Execute first steps directly with MCP (without LLM tokens):
 * 1) navigate to baseUrl
 * 2) wait for configured seconds
 */
async function executePreAgentSteps({ server, steps, baseUrl }) {
  const results = [];
  const totalToRun = Math.min(PRE_EXEC_STEPS, steps.length);

  if (totalToRun === 0) {
    return { results, failed: false };
  }

  // Step 1: Navigate
  if (totalToRun >= 1) {
    try {
      if (!baseUrl) {
        throw new Error("baseUrl missing");
      }
      await server.callTool("browser_navigate", { url: baseUrl });
      results.push({
        stepNumber: 1,
        stepText: steps[0],
        status: "passed",
        reason: "Navigated",
        screenshotBase64: null,
        durationMs: null,
      });
      console.log(`  ✅ Step 1 executed directly: navigation`);
    } catch (err) {
      const screenshotBase64 = await captureFailureScreenshot(server);
      results.push({
        stepNumber: 1,
        stepText: steps[0],
        status: "failed",
        reason: `Pre-step failed: ${err instanceof Error ? err.message : String(err)}`,
        screenshotBase64,
        durationMs: null,
      });
      return { results, failed: true };
    }
  }

  // Step 2: Wait
  if (totalToRun >= 2) {
    try {
      await server.callTool("browser_wait_for", { time: PRE_NAV_WAIT_SECONDS });
      results.push({
        stepNumber: 2,
        stepText: steps[1],
        status: "passed",
        reason: `Waited ${PRE_NAV_WAIT_SECONDS}s`,
        screenshotBase64: null,
        durationMs: null,
      });
      console.log(`  ✅ Step 2 executed directly: wait ${PRE_NAV_WAIT_SECONDS}s`);
    } catch (err) {
      const screenshotBase64 = await captureFailureScreenshot(server);
      results.push({
        stepNumber: 2,
        stepText: steps[1],
        status: "failed",
        reason: `Pre-step failed: ${err instanceof Error ? err.message : String(err)}`,
        screenshotBase64,
        durationMs: null,
      });
      return { results, failed: true };
    }
  }

  return { results, failed: false };
}

// Main

async function main() {
  const configuredApiKey = llmConfig?.apiKey;
  if (!configuredApiKey) {
    console.error('❌ Missing OpenAI API key. Set apiKey in config/llm.config.js.');
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
    model: "gpt-5-mini"?? "got-55-mini",
    modelSettings: { parallelToolCalls: false },
    mcpServers: [mcpServer],
    outputType: chunkResultSchema,
  });

  try {
    await mcpServer.connect();
    // Force Playwright to initialize the context/page before screencast attaches
    await mcpServer.callTool("browser_navigate", { url: "about:blank" }).catch(() => {});
    await cdpService.startScreencast();
  } catch (error) {
    console.error(
      `❌ Failed to connect to MCP server:`,
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }

  // { stepNumber, stepText, status, reason, screenshotBase64, durationMs }
  const allResults = [];
  const tokenUsage = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const runStartTime = Date.now();
  const screenshotsOutputDir = path.resolve(MCP_WORKSPACE_DIR, MCP_OUTPUT_DIR);
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
        tokenUsage,
        totalDurationMs: Date.now() - runStartTime,
      });
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
    console.log(`[Pre-Agent] Executing first ${Math.min(PRE_EXEC_STEPS, steps.length)} step(s) directly...`);
    const preExec = await executePreAgentSteps({ server: mcpServer, steps, baseUrl });
    allResults.push(...preExec.results);

    if (preExec.failed) {
      shouldStop = true;
      console.log(`[Pre-Agent] Stopping run because a pre-agent step failed.`);
    }

    // const remainingSteps = steps.slice(PRE_EXEC_STEPS);
    const chunks = chunkSteps(steps, CHUNK_SIZE);

    console.log(`[Agent] Executing ${chunks.length} chunk(s) of steps (max ${CHUNK_SIZE} per chunk)...\n`);

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      if (shouldStop) break;

      const chunk = chunks[chunkIdx];
      const isFinalChunk = chunkIdx === chunks.length - 1;
      const startStepNum = PRE_EXEC_STEPS + chunkIdx * CHUNK_SIZE + 1;
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
        const stream = await run(executorAgent, prompt, { stream: true, maxTurns: 15 });

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

        // Track token usage
        const usage = stream?.state?.usage;
        tokenUsage.requests += Number(usage?.requests ?? 0);
        tokenUsage.inputTokens += Number(usage?.inputTokens ?? 0);
        tokenUsage.outputTokens += Number(usage?.outputTokens ?? 0);
        tokenUsage.totalTokens += Number(usage?.totalTokens ?? 0);

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
          reason: `Chunk execution error: ${message}`,
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

    console.log(`📈 TOKEN USAGE (cumulative across all chunks)`);
    console.log(`   Requests : ${tokenUsage.requests}`);
    console.log(`   Input    : ${tokenUsage.inputTokens.toLocaleString()}`);
    console.log(`   Output   : ${tokenUsage.outputTokens.toLocaleString()}`);
    console.log(`   Total    : ${tokenUsage.totalTokens.toLocaleString()}\n`);

    // Generate HTML Report
    const reportPath = generateHtmlReport({
      suiteName,
      baseUrl,
      results: allResults,
      tokenUsage,
      totalDurationMs,
    });
    console.log(`📄 HTML Report saved: ${reportPath}\n`);
  } catch (error) {
    console.error(`\n❌ Agent execution failed:`, error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  } finally {
    await mcpServer.close();
    if (cdpService) await cdpService.shutdown();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
