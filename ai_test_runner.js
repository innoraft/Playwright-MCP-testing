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
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { generateText } from 'ai';
import { createLLM } from './llm-factory.js';
import llmConfig from './config/llm.config.js';
import { VisualRegressionChecker } from './visual-regression.js';
import { CDPService } from './src/cdp/cdp.service.js';
import { buildSystemPrompt } from './src/prompts/initial.prompt.js';
import { buildReplanPrompt } from './src/prompts/retry.prompt.js';

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
    // Token accounting
    this.tokenUsage = {
      totalInputTokens:  0,
      totalOutputTokens: 0,
      callCount:         0,
      perStep:           []
    };

    this.cdpService = new CDPService(config.browser, log);
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

    // Remove non-image files from screenshots dir
    try {
      const entries = fs.readdirSync(config.reporting.screenshotsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && !/\.(png|jpg|jpeg)$/i.test(entry.name)) {
          const filePath = path.join(config.reporting.screenshotsDir, entry.name);
          fs.unlinkSync(filePath);
          log.info(`Removed non-image file from screenshots: ${entry.name}`);
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
    const cdpPort = await this.cdpService.initialize(chromiumPath);

    const transport = new StdioClientTransport({
      command: 'npx',
      cwd: workspaceDir,
      args: [
        '@playwright/mcp@latest',
        '--cdp-endpoint', `http://127.0.0.1:${cdpPort}`,
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
    await this.cdpService.startScreencast();

    return this.mcpTools;
  }

  /**
   * Takes a DOM accessibility snapshot via MCP browser_snapshot.
   * Returns the text content the LLM can use for ref-based planning.
   */
  async takeDOMSnapshot() {
    try {
      const { result } = await this.executeMCP('browser_snapshot', {});
      if (!result || !Array.isArray(result.content)) return '';
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    } catch (err) {
      log.warn(`DOM snapshot failed (non-fatal): ${err.message}`);
      return '';
    }
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

    // ── Token tracking ─────────────────────────────────────────────
    if (usage) {
      const input  = usage.inputTokens  || usage.promptTokens     || 0;
      const output = usage.outputTokens || usage.completionTokens || 0;
      const total  = usage.totalTokens  || (input + output);

      this.tokenUsage.totalInputTokens  += input;
      this.tokenUsage.totalOutputTokens += output;
      this.tokenUsage.callCount++;
      this.tokenUsage.perStep.push({ label: `call-${this.tokenUsage.callCount}`, input, output, total });

      log.info(`📊 LLM Tokens — in: ${input}, out: ${output}, total: ${total} (call #${this.tokenUsage.callCount})`);
    }

    return {
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
  }

  /** Prints a token usage summary after all steps have executed. */
  printTokenSummary() {
    const model   = config.llm.model;
    const totalIn  = this.tokenUsage.totalInputTokens;
    const totalOut = this.tokenUsage.totalOutputTokens;
    const calls    = this.tokenUsage.callCount;

    const bar = '─'.repeat(54);
    console.log(`\n┌${bar}┐`);
    console.log(`│  📊 TOKEN USAGE SUMMARY`.padEnd(55) + '│');
    console.log(`├${bar}┤`);
    console.log(`│  Model          : ${model}`.padEnd(55) + '│');
    console.log(`│  LLM Calls      : ${calls}`.padEnd(55) + '│');
    console.log(`│  Input  tokens  : ${totalIn.toLocaleString()}`.padEnd(55) + '│');
    console.log(`│  Output tokens  : ${totalOut.toLocaleString()}`.padEnd(55) + '│');
    console.log(`│  Total  tokens  : ${(totalIn + totalOut).toLocaleString()}`.padEnd(55) + '│');
    console.log(`└${bar}┘\n`);

    console.log('  Per-call token breakdown:');
    this.tokenUsage.perStep.forEach(s => {
      console.log(`    ${s.label.padEnd(14)}: in=${s.input}, out=${s.output}, total=${s.total}`);
    });
    console.log('');
  }

  /**
   * Generates a structured execution plan using the LLM.
   *
   * @param {string} testText - Raw test steps text
   * @param {Array<string>} testSteps - Parsed step list
   * @returns {Promise<Array<Object>>} Execution plan
   * @throws {Error} If plan JSON is invalid
   */
  async generateExecutionPlan(testText, testSteps, domSnapshot, isVisualRegression = false) {
    log.llm(`Chosen LLM provider -> ${config.llm.provider}`);
    log.llm(`Chosen Model -> ${config.llm.model} `)
    log.llm('Generating execution plan...');

    const planningPrompt = buildSystemPrompt(testText, testSteps.length, domSnapshot, this.mcpTools, isVisualRegression);

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

      // Sort by stepIndex to guarantee sequential execution
      plan.sort((a, b) => a.stepIndex - b.stepIndex);

      // Deduplicate: keep only the first plan entry per stepIndex
      const seenIndices = new Set();
      const dedupedPlan = plan.filter(step => {
        if (seenIndices.has(step.stepIndex)) return false;
        seenIndices.add(step.stepIndex);
        return true;
      });

      // Trim to exactly testSteps.length entries — one per test step
      if (dedupedPlan.length > testSteps.length) {
        log.warn(`Plan has ${dedupedPlan.length} entries for ${testSteps.length} test steps — trimming to match.`);
        dedupedPlan.splice(testSteps.length);
      }

      log.success(`Generated plan with ${dedupedPlan.length} steps (sorted, deduped)`);
      return dedupedPlan;
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
  // Tools that cause a page navigation (DOM becomes stale after these)
  static NAVIGATION_TOOLS = new Set([
    'browser_navigate', 'browser_navigate_back'
  ]);

  /**
   * Executes a single planned step (VR or MCP tool).
   * Returns { passed: boolean, needsResnapshot: boolean }.
   */
  executeVisualRegressionStep(step, originalStep, testName) {
    let { breakpoint, screenshotPath } = step.params;
    const start = Date.now();

    if (screenshotPath && !screenshotPath.startsWith('files/') && !screenshotPath.startsWith('./files/')) {
      screenshotPath = path.join(config.reporting.screenshotsDir, path.basename(screenshotPath));
    }

    try {
      const vrTestName = this.logicalTestName || testName;
      const result = this.visualChecker.runRegressionStep(vrTestName, breakpoint, screenshotPath);

      this.recordAction({
        tool: 'visual_regression_check', params: step.params,
        status: result.passed ? 'passed' : 'failed', assertion: true,
        error: result.passed ? null : result.summary,
        duration: Date.now() - start, screenshot: screenshotPath,
        diffScreenshot: result.diffPath || null, visualResult: result,
        testStep: originalStep.trim()
      });

      if (result.passed) {
        log.success(`Visual regression passed at ${breakpoint} — ${result.mismatchPercent}% mismatch`);
      } else {
        log.error(`Visual regression FAILED at ${breakpoint}`, result.summary);
      }
      return { passed: result.passed, needsResnapshot: false };
    } catch (err) {
      this.recordAction({
        tool: 'visual_regression_check', params: step.params,
        status: 'failed', assertion: true, error: err.message,
        duration: Date.now() - start, screenshot: screenshotPath,
        testStep: originalStep.trim()
      });
      log.error('Visual regression error', err.message);
      return { passed: false, needsResnapshot: false };
    }
  }

  async runTest(testText, testName) {
    const yamlNameMatch = testText.match(/^name:\s*(.+)$/m);
    const logicalName = yamlNameMatch ? yamlNameMatch[1].trim() : testName;
    this.logicalTestName = logicalName;
    const isVisualRegression = !!yamlNameMatch;

    log.info(`🧪 Starting test: ${testName} (logical name: ${logicalName})`);

    this.testReport = {
      testName: logicalName, testText,
      startTime: new Date(), endTime: null,
      actions: [], passedActions: 0, failedActions: 0,
      totalActions: 0, testResult: 'running'
    };

    const testSteps = testText.split('\n').filter(l => l.trim().startsWith('-'));

    // ── Phase 0: Extract URL and navigate first ───────────────────────
    const urlMatch = testText.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
      const targetUrl = urlMatch[0];
      // Find the raw test step that contains this URL for reporting
      const navStepText = testSteps.find(s => s.includes(targetUrl));
      log.info(`🌐 Navigating to ${targetUrl} before taking snapshot...`);
      try {
        const { result, duration } = await this.executeMCP('browser_navigate', { url: targetUrl });
        log.success(`Navigation to ${targetUrl} complete`);
        this.recordAction({
          tool: 'mcp_browser_navigate', params: { url: targetUrl },
          status: 'passed', assertion: false,
          duration, testStep: (navStepText || `- Navigate to ${targetUrl}`).trim()
        });
      } catch (navErr) {
        log.warn(`Initial navigation failed (non-fatal): ${navErr.message}`);
        this.recordAction({
          tool: 'mcp_browser_navigate', params: { url: targetUrl },
          status: 'failed', assertion: false,
          error: navErr.message, duration: navErr.duration || 0,
          testStep: (navStepText || `- Navigate to ${targetUrl}`).trim()
        });
      }
    }

    // ── Phase 1: Snapshot AFTER navigation ─────────────────────────────
    let initialSnapshot = '';
    if (!isVisualRegression) {
      log.info('📸 Taking DOM snapshot of loaded page for planning...');
      initialSnapshot = await this.takeDOMSnapshot();
    } else {
      log.info('📸 Skipping DOM snapshot for visual regression test...');
    }

    // ── Phase 2: Single LLM plan with snapshot ────────────────────────
    let executionPlan = await this.generateExecutionPlan(testText, testSteps, initialSnapshot, isVisualRegression);

    // Remove duplicate navigation step — Phase 0 already navigated to the URL
    if (urlMatch) {
      const navigatedUrl = urlMatch[0];
      executionPlan = executionPlan.filter(step => {
        const tool = step.tool.replace(/^mcp_/, '');
        if (tool === 'browser_navigate' && step.params?.url === navigatedUrl) {
          log.info(`Skipping duplicate browser_navigate to ${navigatedUrl} (already done in Phase 0)`);
          return false;
        }
        return true;
      });
    }

    // Phase 3: Execute locally, re-plan on failure/navigation
    let planIndex = 0;
    // Track which original test steps have been attempted (1-based)
    const attemptedSteps = new Set();
    // Allow at most 1 re-plan per step to avoid infinite loops
    const replanCount = { total: 0 };
    const MAX_REPLANS = 3;

    while (planIndex < executionPlan.length) {
      const step = executionPlan[planIndex];
      const rawStep = testSteps[step.stepIndex - 1] || testSteps[planIndex] || '';
      const originalStep = rawStep || step.description || '';
      const stepNum = step.stepIndex || (planIndex + 1);

      log.info(`\n📍 Step ${stepNum}/${testSteps.length}: ${originalStep.trim()}`);

      const toolName = step.tool.replace(/^mcp_/, '');

      // Visual regression (local, no re-plan needed)
      if (toolName === 'visual_regression_check') {
        this.executeVisualRegressionStep(step, originalStep, testName);
        planIndex++;
        continue;
      }

      // Normalize filename for browser_take_screenshot:
      // MCP server cwd is 'files/', so strip leading 'files/' to avoid double-prefix
      if (toolName === 'browser_take_screenshot' && step.params?.filename) {
        step.params.filename = step.params.filename.replace(/^\.?\/?(files\/)+/, '');
      }

      // Execute MCP tool
      let stepPassed = false;
      let needsResnapshot = false;

      try {
        const { result, duration } = await this.executeMCP(toolName, step.params);
        const screenshotPath = this.extractScreenshotPath(result);

        // If this step was previously recorded as failed (retried via re-plan),
        // remove the old failed entry so only the final outcome remains.
        const prevFailIdx = this.testResults.actions.findIndex(
          a => a.testStep === originalStep.trim() && a.status === 'failed'
        );
        if (prevFailIdx !== -1) {
          this.testResults.actions.splice(prevFailIdx, 1);
          this.testResults.failed--;
        }

        this.recordAction({
          tool: `mcp_${step.tool}`, params: step.params,
          status: 'passed', assertion: step.isAssertion || false,
          duration, screenshot: screenshotPath,
          testStep: originalStep.trim()
        });

        log.success(`✓ Step ${stepNum} passed${step.isAssertion ? ' (assertion)' : ''}`);
        stepPassed = true;
        // needsResnapshot stays false on success — re-plan only when a step fails.
        // Triggering re-plan after every navigation caused the LLM to regenerate
        // the remaining plan with wrong tools and duplicate/reordered steps.
      } catch (err) {
        log.error(`✗ Step ${stepNum} failed`, err.message);

        this.recordAction({
          tool: `mcp_${step.tool}`, params: step.params,
          status: 'failed', assertion: step.isAssertion || false,
          error: err.message, duration: err.duration || 0,
          testStep: originalStep.trim()
        });

        needsResnapshot = !isVisualRegression; // Failed → likely stale refs (skip if VR)
      }

      // ── Phase 4 & 5: Re-snapshot + re-plan on failure or navigation ──
      if (needsResnapshot && replanCount.total < MAX_REPLANS) {
        // If step failed, include it in remaining steps for re-plan
        const startIdx = stepPassed ? planIndex + 1 : planIndex;
        const remainingPlan = executionPlan.slice(startIdx);
        if (remainingPlan.length === 0) {
          planIndex++;
          continue;
        }

        log.info('📸 Page changed — taking fresh snapshot for re-planning...');
        const freshSnapshot = await this.takeDOMSnapshot();

        // Collect the ORIGINAL stepIndex values so we can remap after re-plan
        const remainingOriginalIndices = remainingPlan.map(s => s.stepIndex);
        // Annotate each step with its stepIndex so the LLM preserves the order
        const remainingStepsText = remainingPlan
          .map(s => {
            const text = testSteps[s.stepIndex - 1];
            return text ? `(stepIndex ${s.stepIndex}) ${text}` : '';
          })
          .filter(Boolean)
          .join('\n');

        if (remainingStepsText.trim()) {
          log.llm(`Re-planning ${remainingPlan.length} remaining steps with fresh snapshot...`);
          replanCount.total++;

          const replanPrompt = buildReplanPrompt(
            remainingStepsText, freshSnapshot,
            stepPassed ? null : originalStep.trim(),
            stepPassed ? null : this.testResults.actions[this.testResults.actions.length - 1]?.error,
            this.mcpTools,
            remainingPlan.length
          );

          try {
            const response = await this.callLLM([
              { role: 'system', content: replanPrompt },
              { role: 'user', content: 'Re-plan the remaining steps as JSON array.' }
            ]);

            let planJson = response.content
              .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const newPlan = JSON.parse(planJson);

            // Trim to at most the expected remaining count to prevent LLM over-generation
            if (newPlan.length > remainingOriginalIndices.length) {
              newPlan.splice(remainingOriginalIndices.length);
            }

            // Remap stepIndex to original test step indices so that
            // rawStep lookup and deduplication work correctly.
            newPlan.forEach((s, i) => {
              if (i < remainingOriginalIndices.length) {
                s.stepIndex = remainingOriginalIndices[i];
              }
            });

            log.success(`Re-plan generated: ${newPlan.length} steps (remapped to original indices)`);

            // Replace remaining portion of execution plan
            const completedPlan = executionPlan.slice(0, startIdx);
            executionPlan = [...completedPlan, ...newPlan];
            // Resume from the first re-planned step
            planIndex = completedPlan.length;
            continue;
          } catch (replanErr) {
            log.warn(`Re-plan failed: ${replanErr.message}. Continuing with original plan.`);
          }
        }
      }

      planIndex++;
    }

    // ── Finalize report ───────────────────────────────────────────────
    this.testReport.endTime = new Date();
    this.testReport.actions = this.testResults.actions;
    this.testReport.passedActions = this.testResults.passed;
    this.testReport.failedActions = this.testResults.failed;
    this.testReport.totalActions = this.testResults.actions.length;
    this.testReport.testResult = this.testResults.failed === 0 ? 'pass' : 'fail';
    this.testReport.tokenUsage = {
      model:        config.llm.model,
      inputTokens:  this.tokenUsage.totalInputTokens,
      outputTokens: this.tokenUsage.totalOutputTokens,
      callCount:    this.tokenUsage.callCount
    };

    const report = this.reportGenerator.generateReport(this.testReport);
    log.success(`📊 HTML Report: ${report.htmlReport}`);

    // Print token cost summary
    this.printTokenSummary();

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
    if (this.mcpClient) {
      await this.mcpClient.close();
      log.info('MCP connection closed');
    }

    await this.cdpService.shutdown();
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

  // Aggregate token usage across all test files
  const suiteTokens = {
    totalInputTokens:  0,
    totalOutputTokens: 0,
    callCount:         0
  };

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
      // Accumulate suite-wide token stats
      suiteTokens.totalInputTokens  += runner.tokenUsage.totalInputTokens;
      suiteTokens.totalOutputTokens += runner.tokenUsage.totalOutputTokens;
      suiteTokens.callCount         += runner.tokenUsage.callCount;

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

  // Suite-wide token usage
  if (testFiles.length > 1) {
    const bar = '─'.repeat(54);
    console.log(`\n┌${bar}┐`);
    console.log(`│  🗂️  SUITE-WIDE TOKEN USAGE`.padEnd(55) + '│');
    console.log(`├${bar}┤`);
    console.log(`│  Total LLM calls   : ${suiteTokens.callCount}`.padEnd(55) + '│');
    console.log(`│  Total input tokens: ${suiteTokens.totalInputTokens.toLocaleString()}`.padEnd(55) + '│');
    console.log(`│  Total output tokens: ${suiteTokens.totalOutputTokens.toLocaleString()}`.padEnd(55) + '│');
    console.log(`│  Total tokens      : ${(suiteTokens.totalInputTokens + suiteTokens.totalOutputTokens).toLocaleString()}`.padEnd(55) + '│');
    console.log(`└${bar}┘\n`);
  }

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
