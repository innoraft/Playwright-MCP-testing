#!/usr/bin/env node
/**
 * Autonomous LLM-to-MCP Test Runner (Stateless Edition)
 * ------------------------------------------------------
 * • No batching, no memory accumulation
 * • Direct streaming LLM responses
 * • Full MCP integration for browser automation
 * • Minimal, production-ready design
 * 
 * Usage: node ai_test_runner.js tests/example.test.yml
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TestReportGenerator } from './test-report-generator.js';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { execSync, spawn as cpSpawn } from 'child_process';
import { generateText } from 'ai';
import { createLLM } from './llm-factory.js';
import llmConfig from './config/llm.config.js';
import { VisualRegressionChecker } from './visual-regression.js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CONFIG ----------
const config = {
  llm: {
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    temperature: 1
  },
  browser: {
    headless: false,
    viewport: { width: 1280, height: 720 }
  },
  reporting: {
    screenshotsDir: 'files/screenshots',
    outputDir: 'test-reports'
  }
};

// ---------- LOGGER ----------
const log = {
  info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg, err) => console.error(`❌ ${msg}`, err || ''),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  tool: (name, args) => console.log(`🔧 Tool: ${name}(${JSON.stringify(args).substring(0, 120)}...)`),
  llm: (msg) => console.log(`🤖 LLM: ${msg}`)
};

// ---------- STATELESS RUNNER ----------
class StatelessMCPRunner {
  constructor() {
    this.mcpClient = null;
    this.mcpTools = new Map();
    this.testResults = {
      passed: 0,
      failed: 0,
      actions: []
    };
    this.reportGenerator = new TestReportGenerator(config);
    this.testReport = null;
    this.llm = createLLM({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey
    });

    this.visualChecker = new VisualRegressionChecker();

    // CDP Screencast state
    this.cdpPort = null;
    this.browserProcess = null;
    this.cdpSocket = null;
    this.screencastActive = false;
    this.chromiumPath = null;
  }

  /**
   * Extracts the most relevant screenshot file path from an MCP tool result.
   * Scans text output for image filenames emitted by Playwright.
   * If the file landed in /files root (MCP default), moves it to /files/screenshots.
   *
   * @param {Object} result - MCP tool execution result
   * @returns {string|null} Absolute screenshot path or null if none found
   */
  extractScreenshotPath(result) {
    if (!result || !Array.isArray(result.content)) return null;

    const fullText = result.content
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text)
      .join('\n');

    if (!fullText) return null;

    const matches = fullText.match(/([^\s"'()]+?\.(png|jpg|jpeg))/gi);
    if (!matches || matches.length === 0) return null;

    const filename = path.basename(matches[matches.length - 1]);

    // Preferred path (where browser_take_screenshot saves)
    const screenshotsPath = path.join(config.reporting.screenshotsDir, filename);
    // Fallback path (where MCP browser may save to /files root)
    const filesRootPath = path.join('files', filename);

    // If the file landed in /files root, move it to /files/screenshots
    if (!fs.existsSync(screenshotsPath) && fs.existsSync(filesRootPath)) {
      fs.renameSync(filesRootPath, screenshotsPath);
      log.info(`Moved screenshot from /files to /files/screenshots: ${filename}`);
    }

    return screenshotsPath;
  }

  /**
   * Cleans up any stray image files left in /files root by MCP Playwright.
   * Moves them to /files/screenshots so /files root stays clean.
   */
  cleanupStrayFiles() {
    const filesDir = 'files';
    try {
      const entries = fs.readdirSync(filesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /\.(png|jpg|jpeg)$/i.test(entry.name)) {
          const src = path.join(filesDir, entry.name);
          const dest = path.join(config.reporting.screenshotsDir, entry.name);
          fs.renameSync(src, dest);
          log.info(`Cleaned up stray file: moved ${entry.name} → files/screenshots/`);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Records the execution outcome of a single test action.
   * Updates internal counters and persists metadata for reporting.
   *
   * @param {Object} action
   * @param {string} action.tool - Tool name executed
   * @param {Object} action.params - Tool input parameters
   * @param {'passed'|'failed'} action.status - Execution status
   * @param {boolean} [action.assertion] - Whether step was an assertion
   * @param {string} [action.error] - Error message (if failed)
   * @param {number} action.duration - Execution time in milliseconds
   * @param {string|null} [action.screenshot] - Screenshot path if captured
   */
  recordAction({ tool, params, status, assertion, error, duration, screenshot, diffScreenshot, visualResult, testStep }) {
    this.testResults.actions.push({
      tool,
      params,
      status,
      assertion: assertion || null,
      error: error || null,
      duration,
      screenshot: screenshot || null,
      diffScreenshot: diffScreenshot || null,
      visualResult: visualResult || null,
      testStep: testStep || null,
      timestamp: new Date()
    });

    if (status === 'passed') this.testResults.passed++;
    if (status === 'failed') this.testResults.failed++;
  }

  /**
   * Finds a free TCP port on localhost.
   * @returns {Promise<number>} A free port number
   */
  findFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
  }

  /**
   * Launches Chromium with --remote-debugging-port so we can
   * attach CDP screencast AND let @playwright/mcp connect via --cdp-endpoint.
   *
   * @param {string} chromiumPath - Absolute path to Chromium binary
   * @returns {Promise<number>} The allocated CDP port
   */
  async launchBrowserWithCDP(chromiumPath) {
    const port = await this.findFreePort();
    this.cdpPort = port;
    this.chromiumPath = chromiumPath;

    const args = [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--window-size=${config.browser.viewport.width},${config.browser.viewport.height}`,
      'about:blank'
    ];

    log.info(`Launching Chromium with CDP on port ${port}`);
    this.browserProcess = cpSpawn(chromiumPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Wait for CDP to be ready by polling the /json/version endpoint
    const startTime = Date.now();
    const timeout = 15000;
    while (Date.now() - startTime < timeout) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (resp.ok) {
          const info = await resp.json();
          log.success(`Chromium CDP ready: ${info.Browser}`);
          return port;
        }
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 300));
    }

    throw new Error('Chromium failed to start with CDP within 15 seconds');
  }

  /**
   * Connects to CDP and starts Page.startScreencast.
   * Emits frames to stdout with __SCREENCAST_FRAME__ prefix for the server to pick up.
   */
  async startScreencast() {
    if (!this.cdpPort) {
      log.warn('No CDP port available, skipping screencast');
      return;
    }

    try {
      // Poll /json to find a page target
      let pageWsUrl = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const resp = await fetch(`http://127.0.0.1:${this.cdpPort}/json`);
          const targets = await resp.json();
          const page = targets.find(t => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            pageWsUrl = page.webSocketDebuggerUrl;
            break;
          }
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!pageWsUrl) {
        log.warn('No page target found for screencast');
        return;
      }

      log.info(`Connecting CDP screencast to: ${pageWsUrl}`);
      this.cdpSocket = new WebSocket(pageWsUrl);

      await new Promise((resolve, reject) => {
        this.cdpSocket.on('open', resolve);
        this.cdpSocket.on('error', reject);
        setTimeout(() => reject(new Error('CDP WebSocket timeout')), 5000);
      });

      let msgId = 1;

      // Start screencast: JPEG, quality 40, capped at viewport size, every other frame
      this.cdpSocket.send(JSON.stringify({
        id: msgId++,
        method: 'Page.startScreencast',
        params: {
          format: 'jpeg',
          quality: 40,
          maxWidth: config.browser.viewport.width,
          maxHeight: config.browser.viewport.height,
          everyNthFrame: 2
        }
      }));

      this.screencastActive = true;

      this.cdpSocket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Page.screencastFrame') {
            // Acknowledge the frame so CDP keeps sending
            this.cdpSocket.send(JSON.stringify({
              id: msgId++,
              method: 'Page.screencastFrameAck',
              params: { sessionId: msg.params.sessionId }
            }));

            // Emit frame data via stdout for the server to detect
            process.stdout.write(`__SCREENCAST_FRAME__${msg.params.data}\n`);
          }
        } catch { /* ignore parse errors */ }
      });

      this.cdpSocket.on('close', () => {
        this.screencastActive = false;
        log.info('CDP screencast connection closed');
      });

      this.cdpSocket.on('error', (err) => {
        log.warn(`CDP screencast error: ${err.message}`);
        this.screencastActive = false;
      });

      log.success('CDP screencast started');
    } catch (err) {
      log.warn(`Failed to start screencast: ${err.message}`);
    }
  }

  /**
   * Stops the CDP screencast and closes the WebSocket.
   */
  async stopScreencast() {
    if (this.cdpSocket && this.screencastActive) {
      try {
        this.cdpSocket.send(JSON.stringify({
          id: 9999,
          method: 'Page.stopScreencast'
        }));
      } catch { /* ignore */ }
    }
    if (this.cdpSocket) {
      try { this.cdpSocket.close(); } catch { /* ignore */ }
      this.cdpSocket = null;
    }
    this.screencastActive = false;
  }

  /**
   * Initializes the MCP client connection and discovers available tools.
   * Also ensures screenshot output directories exist.
   *
   * @returns {Promise<Map<string, Object>>} Discovered MCP tools map
   * @throws {Error} If MCP connection fails
   */
  async initializeMCP() {
    const workspaceDir = path.resolve('files');
    const screenshotsDir = path.join(workspaceDir, 'screenshots');
    const uploadsDir = path.join(workspaceDir, 'uploads');

    fs.mkdirSync(path.resolve('files/baselines'), { recursive: true });
    fs.mkdirSync(path.resolve('files/diffs'), { recursive: true });

    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Resolve Chromium executable path dynamically
    let chromiumPath;

    // 1. Try playwright-core's reported path
    try {
      const reported = execSync('node -e "const pw = require(\'playwright-core\'); console.log(pw.chromium.executablePath())"', { encoding: 'utf-8' }).trim();
      if (reported && fs.existsSync(reported)) chromiumPath = reported;
    } catch { /* ignore */ }

    // 2. Scan ms-playwright cache for any installed chromium
    if (!chromiumPath) {
      const cacheDir = path.join(process.env.HOME || '/root', '.cache', 'ms-playwright');
      try {
        const dirs = fs.readdirSync(cacheDir)
          .filter(d => d.startsWith('chromium-') && !d.includes('headless'))
          .sort()
          .reverse(); // newest first
        for (const dir of dirs) {
          // Newer Playwright uses chrome-linux64, older uses chrome-linux
          const candidates = [
            path.join(cacheDir, dir, 'chrome-linux64', 'chrome'),
            path.join(cacheDir, dir, 'chrome-linux', 'chrome'),
          ];
          const found = candidates.find(p => fs.existsSync(p));
          if (found) { chromiumPath = found; break; }
        }
      } catch { /* ignore */ }
    }

    // 3. Fallback to system-installed chromium
    if (!chromiumPath) {
      const fallbacks = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'];
      chromiumPath = fallbacks.find(p => fs.existsSync(p)) || '';
    }

    if (!chromiumPath || !fs.existsSync(chromiumPath)) {
      throw new Error('Chromium not found. Run "npx playwright install chromium" to install it.');
    }
    log.info(`Using Chromium at: ${chromiumPath}`);

    // Launch Chromium with CDP and connect MCP to it
    await this.launchBrowserWithCDP(chromiumPath);

    const transport = new StdioClientTransport({
      command: 'npx',
      cwd: workspaceDir,
      args: [
        '@playwright/mcp@latest',
        '--cdp-endpoint', `http://127.0.0.1:${this.cdpPort}`,
        '--ignore-https-errors',
        '--output-dir', 'screenshots',
        '--output-mode', 'stdout',
        '--viewport-size', `${config.browser.viewport.width}x${config.browser.viewport.height}`
      ],
      stderr: 'inherit',
      env: {
        ...process.env
      }
    });

    this.mcpClient = new Client({
      name: 'stateless-mcp-runner',
      version: '2.0.0'
    });

    await this.mcpClient.connect(transport);
    log.success(`Connected to MCP: ${JSON.stringify(this.mcpClient.getServerVersion())}`);

    // Discover tools
    const toolsList = await this.mcpClient.listTools();
    log.info(`Discovered ${toolsList.tools.length} MCP tools`);

    for (const tool of toolsList.tools) {
      this.mcpTools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      });
    }

    // Start CDP screencast for live monitoring
    await this.startScreencast();

    return this.mcpTools;
  }

  /**
   * Converts discovered MCP tools into OpenAI function-calling format.
   *
   * @returns {Array<Object>} Tool definitions compatible with LLM APIs
   */
  generateMCPTools() {
    return Array.from(this.mcpTools.values()).map(tool => ({
      type: 'function',
      function: {
        name: `mcp_${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }));
  }

  /**
   * Executes a single MCP tool with the provided parameters.
   * Measures execution time and validates tool success.
   *
   * @param {string} toolName - MCP tool name
   * @param {Object} params - Tool input parameters
   * @returns {Promise<{result: Object, duration: number}>}
   * @throws {Error} If tool execution fails or returns false
   */
  async executeMCP(toolName, params) {
    log.tool(toolName, params);
    const start = Date.now();

    const result = await this.mcpClient.callTool({
      name: toolName,
      arguments: params
    });
    console.log("mcp result-> ")
    console.log(result)
    const duration = Date.now() - start;

    if (result.isError) {
      // Don't record here, just throw with context
      const error = new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
      error.duration = duration;
      log.error("Error while mcp execution-> ", error)
      throw error;
    }

    // Check if result contains "false" in text content
    if (Array.isArray(result.content)) {
      const textBlock = result.content.find(c => c.type === 'text')?.text;

      if (textBlock) {
        // Extract the Result section
        const match = textBlock.match(/### Result\s+([^\n]+)/i);

        if (match) {
          const value = match[1].trim().toLowerCase();
          // console.log(value)
          if (value === 'false') {
            const error = new Error(`MCP Tool returned false`);
            error.duration = duration;
            throw error;
          }
        }
      }
    }

    return { result, duration };
  }

  /**
   * Sends a request to the LLM for planning or execution reasoning.
   *
   * @param {Array<Object>} messages - Chat-style messages
   * @param {boolean} [includeTools=false] - Whether to include MCP tools
   * @returns {Promise<Object>} LLM message response
   * @throws {Error} If API call fails
   */
  async callLLM(messages, includeTools = false) {
    const requestConfig = {
      model: this.llm,
      temperature: config.llm.temperature,
      messages
    };

    // Only include tools if explicitly requested (not needed for planning)
    if (includeTools) {
      requestConfig.tools = this.generateMCPTools();
    }

    const { text, toolCalls, usage } = await generateText(requestConfig);

    // ---- TOKEN LOGGING (PER FILE) ----
    if (usage) {
      console.log('🔍 Full Usage Object:', JSON.stringify(usage, null, 2));
      log.info('📊 LLM Token Usage', {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens
      });
    }

    // Attach usage so caller (runner/report) can access it
    const response = {
      content: text,
      tool_calls: toolCalls?.map(tc => ({
        id: tc.toolCallId,
        type: 'function',
        function: {
          name: tc.toolName,
          arguments: JSON.stringify(tc.args)
        }
      })),
      _usage: usage || null
    };

    return response;
  }

  /** 
   * The prompt is used exclusively during the planning phase and does NOT
   * execute any tools or call the MCP layer.
   *
   * @param {string} testText
   *   Full raw test definition containing all human-readable test steps.
   *
   * @param {number} stepCount
   *   Total number of test steps to be analyzed and planned.
   *
   * @returns {string}
   *   A fully constructed system prompt instructing the LLM to generate
   *   a strict, ordered execution plan as valid JSON.
   */
  buildSystemPrompt(testText, stepCount) {
    // Dynamically inject tool definitions
    const toolsInfo = Array.from(this.mcpTools.values()).map(tool => ({
      name: tool.name, // Ensure this is the exact string needed to call the tool
      description: tool.description,
      schema: tool.inputSchema
    }));

    toolsInfo.push({
      name: 'visual_regression_check',
      description: 'Compares the current page screenshot at a specific viewport breakpoint against a stored baseline reference image using pixel-level diffing to detect visual regressions.',
      schema: {
        type: 'object',
        properties: {
          breakpoint: {
            type: 'string',
            description: 'Viewport width being tested e.g. "1280px", "768px", "375px"'
          },
          screenshotPath: {
            type: 'string',
            description: 'Path to the already-taken screenshot from the project root e.g. "files/screenshots/home-1280.png". MUST start with "files/screenshots/".'
          }
        },
        required: ['breakpoint', 'screenshotPath']
      }
    });

    return `You are an intelligent Test Automation Planner. Your objective is to map natural language test steps to a precise sequence of executable tool calls based strictly on the provided tool definitions.
    Do not try to improve the test steps, don't try to imporve the test. Don't skip any step, Don't repeat any step, Dont change the sequence of the steps.
    You have to follow all the rules below strictly.

## INPUT CONTEXT
1. **AVAILABLE TOOLS:**
${JSON.stringify(toolsInfo, null, 2)}

2. **TEST STEPS:**
${testText}

## PLANNING LOGIC & RULES

### 1. Tool Selection Strategy
- **Please read the step thoroughly and extract the context of the step.
- **Analyze the Intent:** For each test step, identify the core verb (action) and the target (noun/data).
- **Semantic Matching:** Compare the step's intent against the **description** field of every available tool.
- **Best Fit:** Select the tool whose description most accurately describes the action required by the step.
- **Dont send invalid json.
- **Strict Adherence:** You must ONLY use tools listed in the "AVAILABLE TOOLS" section. Do not hallucinate tool names.
IMPORTANT: For steps that involve alerts, confirms, or prompts, you MUST use the "browser_handle_dialog" tool. 
Do NOT use "browser_run_code" for modal dialogs.

### 2. Parameter Generation (Schema Compliance)
- **Schema Mapping:** Once a tool is selected, you must generate parameters that strictly adhere to its \`schema\`.
- **Data Extraction:** Extract values (selectors, text, numbers, logic) directly from the test step to populate the schema fields.
- **Type Safety:** Ensure boolean, integer, and string types match the schema definitions exactly.
- **Ids, classes are not refs keep in mind that. If you select any tool which requires ref then you have to extract proper ref from the sanpshot, otherwise
it will throw illegitimate erros.
- **If you are a old model and facing problem to extracts refs then use those tools which not demands ref as parameter.

### 3. Step Classification
- **Action:** If the step implies interaction (e.g., click, type, navigate, wait, scroll etc.), classify as \`isAssertion: false\`.
- **Assertion:** If the step implies verification (e.g., verify, check, ensure, validate, confirm etc.), classify as \`isAssertion: true\`.

### 4. Code Generation (If Applicable)
- If a tool requires a code/script parameter (based on its schema):
  - Generate self-contained, synchronous code.
  - The code must implement the logic described in the test step.
  - Do not assume the existence of external variables.
  - The code must be a pure function body passed to Playwright.
  - NEVER invoke the function (no trailing () ).
  - NEVER return an executed expression.
  - The value sent to MCP must be a function reference, not its result.
  - Valid: "() => { return true; }"
  - Invalid: "(() => { return true; })()"
  - Do NOT wrap functions in quotes that execute immediately.
  - The MCP tool will execute the function, you must only define it.

### 5. Generated code re-check
- Re check all the codes you generated with the valid standard for the dedicated mcp tools.
- Mistakes will cause critical errors as there is no second chance, so re check the codes you have generated.
- If you think any mistake is there you can rewrite the codes.
- When generating code that takes screenshots, ALWAYS save to './screenshots/<filename>.png' 
  (relative to the working directory), never to the root directory.
  Example: await page.screenshot({ path: './screenshots/step-${Date.now()}.png' })
- When calling visual_regression_check, always use the full path from the project root: 'files/screenshots/<filename>.png'
  Example: screenshotPath: 'files/screenshots/home_1280px.png'

### 6. MANDATORY TOOL ROUTING (Override all other rules)
These rules are ABSOLUTE and cannot be overridden by semantic matching:

| Step Intent | Correct Tool | FORBIDDEN Tool |
|-------------|-------------|----------------|
| "verify", "check", "ensure", "validate", "confirm", "assert" → text/element EXISTS on page | browser_run_code | browser_wait_for |
| "wait for page to load", "wait for X seconds" | browser_wait_for | browser_snapshot |
| "verify text is visible" | browser_run_code with page.locator().isVisible() | browser_wait_for |

CRITICAL: browser_wait_for is ONLY for pausing execution (time-based or pre-condition waits).
It is NEVER to be used for assertions or verifications.
If a step contains the words: verify, check, ensure, validate, confirm, assert — you MUST use browser_run_code or browser_snapshot. Never browser_wait_for.

## OUTPUT FORMAT
Return a **SINGLE VALID JSON ARRAY**. Do not include markdown formatting, code blocks, or explanatory text outside the array.

Target JSON Structure:
[
  {
    "stepIndex": <number>,
    "tool": "<EXACT_TOOL_NAME_FROM_LIST>",
    "params": <OBJECT_MATCHING_TOOL_SCHEMA>,
    "isAssertion": <boolean>,
    "description": "<BRIEF_RATIONALE>"
  }
]

Analyze the ${stepCount} steps and generate the execution plan now.`;
  }

  /**
   * Generates a structured execution plan using the LLM.
   *
   * @param {string} testText - Raw test steps text
   * @param {Array<string>} testSteps - Parsed step list
   * @returns {Promise<Array<Object>>} Execution plan
   * @throws {Error} If plan JSON is invalid
   */
  async generateExecutionPlan(testText, testSteps) {
    log.llm(`Chosen LLM provider -> ${config.llm.provider}`);
    log.llm(`Chosen Model -> ${config.llm.model} `)
    log.llm('Generating execution plan...');

    const planningPrompt = this.buildSystemPrompt(testText, testSteps.length);

    const response = await this.callLLM([
      { role: 'system', content: planningPrompt },
      { role: 'user', content: 'Generate the complete execution plan as JSON array.' }
    ]);

    // Extract JSON from response
    let planJson = response.content;

    // Remove markdown code blocks if present
    planJson = planJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log("plan ==>" + planJson)
    try {
      const plan = JSON.parse(planJson);
        // Validate and clamp stepIndex values
     plan.forEach((step, i) => {
        if (step.stepIndex < 1 || step.stepIndex > testSteps.length) {
          log.warn(`Step ${i+1} has invalid stepIndex ${step.stepIndex}, correcting to ${i+1}`);
          step.stepIndex = i + 1; // fallback to sequential
        }
      });

      log.success(`Generated plan with ${plan.length} steps`);
      return plan;
    } catch (err) {
      log.error('Failed to parse execution plan', err.message);
      throw new Error(`Invalid plan JSON: ${err.message}`);
    }
  }

  /**
   * Executes a full test from planning through reporting.
   *
   * @param {string} testText - Full test file content
   * @param {string} testName - Test name
   * @returns {Promise<Object>} Final test results
   * @throws {Error} If test fails
   */
  async runTest(testText, testName) {
    // Extract the logical test name from YAML 'name:' field if present,
    // so that baseline filenames stay consistent across naming conventions.
    const yamlNameMatch = testText.match(/^name:\s*(.+)$/m);
    const logicalName = yamlNameMatch ? yamlNameMatch[1].trim() : testName;
    this.logicalTestName = logicalName;

    log.info(`🧪 Starting test: ${testName} (logical name: ${logicalName})`);

    this.testReport = {
      testName: logicalName,
      testText,
      startTime: new Date(),
      endTime: null,
      actions: [],
      passedActions: 0,
      failedActions: 0,
      totalActions: 0,
      testResult: 'running'
    };

    const testSteps = testText
      .split('\n')
      .filter(l => l.trim().startsWith('-'));

    // Generate complete plan
    const executionPlan = await this.generateExecutionPlan(testText, testSteps);

    // Execute plan sequentially without additional LLM calls
    for (let i = 0; i < executionPlan.length; i++) {
      const step = executionPlan[i];
      const originalStep = step.description || testSteps[step.stepIndex - 1] || testSteps[i];

      log.info(`\n📍 Step ${i + 1}/${executionPlan.length}: ${originalStep.trim()}`);

      const toolName = step.tool.replace(/^mcp_/, '');

      if (toolName === 'visual_regression_check') {
        let { breakpoint, screenshotPath } = step.params;
        const start = Date.now();

        // Normalize screenshotPath: LLM may produce './screenshots/x.png' or 'screenshots/x.png'
        // but the actual file lives under 'files/screenshots/x.png' from project root.
        if (screenshotPath && !screenshotPath.startsWith('files/') && !screenshotPath.startsWith('./files/')) {
          const basename = path.basename(screenshotPath);
          screenshotPath = path.join(config.reporting.screenshotsDir, basename);
          log.info(`Normalized screenshot path to: ${screenshotPath}`);
        }

        try {
          // Use the logical YAML name (not the filename) so baseline paths match
          const vrTestName = this.logicalTestName || testName;
          const result = this.visualChecker.runRegressionStep(
            vrTestName,
            breakpoint,
            screenshotPath
          );

          const duration = Date.now() - start;

          this.recordAction({
            tool: 'visual_regression_check',
            params: step.params,
            status: result.passed ? 'passed' : 'failed',
            assertion: true,
            error: result.passed ? null : result.summary,
            duration,
            screenshot: screenshotPath,
            diffScreenshot: result.diffPath || null,
            visualResult: result,
            testStep: originalStep.trim()
          });

          if (result.passed) {
            log.success(`Visual regression passed at ${breakpoint} — ${result.mismatchPercent}% mismatch`);
          } else {
            log.error(`Visual regression FAILED at ${breakpoint}`, result.summary);
            log.info(`Diff saved at: ${result.diffPath}`);
          }

        } catch (err) {
          this.recordAction({
            tool: 'visual_regression_check',
            params: step.params,
            status: 'failed',
            assertion: true,
            error: err.message,
            duration: Date.now() - start,
            screenshot: screenshotPath,
            testStep: originalStep.trim()
          });
          log.error('Visual regression error', err.message);
        }

        continue; // Skip executeMCP for this custom-tool
      }

      try {
        const { result, duration } = await this.executeMCP(toolName, step.params);
        const screenshotPath = this.extractScreenshotPath(result);


        this.recordAction({
          tool: `mcp_${step.tool}`,
          params: step.params,
          status: 'passed',
          assertion: step.isAssertion || false,
          duration,
          screenshot: screenshotPath,
          testStep: originalStep.trim()
        });


        log.success(`✓ Step ${i + 1} passed${step.isAssertion ? ' (assertion)' : ''}`);

      } catch (err) {
        log.error(`✗ Step ${i + 1} failed`, err.message);

        this.recordAction({
          tool: `mcp_${step.tool}`,
          params: step.params,
          status: 'failed',
          assertion: step.isAssertion || false,
          error: err.message,
          duration: err.duration || 0,
          testStep: originalStep.trim()
        });
      }
    }

    this.testReport.endTime = new Date();
    this.testReport.actions = this.testResults.actions;
    this.testReport.passedActions = this.testResults.passed;
    this.testReport.failedActions = this.testResults.failed;
    this.testReport.totalActions = this.testResults.actions.length;
    this.testReport.testResult =
      this.testResults.failed === 0 ? 'pass' : 'fail';

    const report = this.reportGenerator.generateReport(this.testReport);
    log.success(`📊 HTML Report: ${report.htmlReport}`);

    if (this.testResults.failed > 0) {
      throw new Error('Test failed');
    }

    return this.testResults;
  }

  /**
   * Shuts down MCP connections and releases resources.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Stop screencast first
    await this.stopScreencast();

    if (this.mcpClient) {
      await this.mcpClient.close();
      log.info('MCP connection closed');
    }

    // Kill the browser process we launched
    if (this.browserProcess) {
      try {
        this.browserProcess.kill('SIGTERM');
        // Give it a moment to exit gracefully, then force kill
        await new Promise(r => setTimeout(r, 2000));
        if (!this.browserProcess.killed) {
          this.browserProcess.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      this.browserProcess = null;
      log.info('Browser process terminated');
    }
  }
}

/**
 * Recursively finds all .yml and .yaml files in a directory
 * 
 * @param {string} dirPath - Directory path to scan
 * @returns {Array<string>} Array of absolute file paths
 */
function getTestFiles(dirPath) {
  const testFiles = [];

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Path does not exist: ${dirPath}`);
  }

  const stats = fs.statSync(dirPath);

  // If it's a file, return it directly
  if (stats.isFile()) {
    if (dirPath.endsWith('.yml') || dirPath.endsWith('.yaml')) {
      return [path.resolve(dirPath)];
    }
    throw new Error(`File must be a .yml or .yaml file: ${dirPath}`);
  }

  // If it's a directory, scan for test files
  if (stats.isDirectory()) {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const fileStats = fs.statSync(fullPath);

      if (fileStats.isFile() && (file.endsWith('.yml') || file.endsWith('.yaml'))) {
        testFiles.push(path.resolve(fullPath));
      }
    }

    return testFiles.sort(); // Sort alphabetically
  }

  return testFiles;
}

// ---------- MAIN EXECUTION ----------
async function main() {
  const testPath = process.argv[2];

  if (!testPath) {
    console.error('Usage: node ai_test_runner.js <test.yml | tests-folder>');
    console.error('Examples:');
    console.error('  node ai_test_runner.js tests/test1.yml');
    console.error('  node ai_test_runner.js tests/');
    process.exit(1);
  }

  let testFiles;
  try {
    testFiles = getTestFiles(testPath);
  } catch (err) {
    log.error('Failed to load test files', err.message);
    process.exit(1);
  }

  if (testFiles.length === 0) {
    log.error('No test files found in the specified path');
    process.exit(1);
  }

  log.info(`Found ${testFiles.length} test file(s) to execute`);

  const allResults = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (let i = 0; i < testFiles.length; i++) {
    const testFile = testFiles[i];
    const testName = path.basename(testFile);

    log.info(`\n${'='.repeat(60)}`);
    log.info(`Executing test ${i + 1}/${testFiles.length}: ${testName}`);
    log.info(`${'='.repeat(60)}\n`);

    const runner = new StatelessMCPRunner();

    try {
      await runner.initializeMCP();
      const result = await runner.runTest(
        fs.readFileSync(testFile, 'utf8'),
        testName
      );

      allResults.push({
        testName,
        status: 'PASSED',
        passed: result.passed,
        failed: result.failed
      });

      totalPassed++;
      log.success(`✅ Test PASSED: ${testName}\n`);

    } catch (err) {
      allResults.push({
        testName,
        status: 'FAILED',
        error: err.message
      });

      totalFailed++;
      log.error(`❌ Test FAILED: ${testName}`, err.message + '\n');

    } finally {
      runner.cleanupStrayFiles();
      await runner.cleanup();
    }
  }

  // Print summary
  log.info(`\n${'='.repeat(60)}`);
  log.info('TEST SUITE SUMMARY');
  log.info(`${'='.repeat(60)}`);
  log.info(`Total Tests: ${testFiles.length}`);
  log.success(`Passed: ${totalPassed}`);
  if (totalFailed > 0) {
    log.error(`Failed: ${totalFailed}`, '');
  }
  log.info(`${'='.repeat(60)}\n`);

  // Print individual results
  allResults.forEach((result, idx) => {
    const status = result.status === 'PASSED' ? '✅' : '❌';
    console.log(`${status} ${idx + 1}. ${result.testName} - ${result.status}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  if (totalFailed > 0) {
    process.exit(1);
  }

  log.success('\n🎉 ALL TESTS PASSED');
}

// ---------- CLEANUP HANDLERS ----------
process.on('SIGINT', async () => {
  log.warn('Interrupted. Cleaning up...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  log.error('Unhandled rejection', err);
  process.exit(1);
});

// ---------- RUN ----------
// Export public APIs so this runner can be reused or extended
export { StatelessMCPRunner, log, config };

// Only execute main() when this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error('Fatal error', err);
    process.exit(1);
  });
}
