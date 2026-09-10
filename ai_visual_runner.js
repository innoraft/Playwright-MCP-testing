#!/usr/bin/env node
/**
 * Visual Regression LLM-to-MCP Test Runner
 * ----------------------------------------
 * Dedicated entrypoint for visual regression tests.
 *
 * Usage: node ai_visual_runner.js tests/example.test.yml
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
import { buildStaticSystemPrompt } from './src/prompts/system.prompt.js';
import { buildPlanningUserMessage } from './src/prompts/step.prompt.js';
import { findChromiumPath } from './src/utils/browser-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runId = process.env.PLAYWRIGHT_RUN_ID?.trim() || '';
const runScreenshotsDir = runId ? `files/screenshots/${runId}` : 'files/screenshots';
const runDiffsDir = runId ? `files/diffs/${runId}` : 'files/diffs';

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
    screenshotsDir: runScreenshotsDir,
    outputDir: 'test-reports',
    runId
  }
};

const log = {
  info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg, err) => console.error(`❌ ${msg}`, err || ''),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  tool: (name, args) => console.log(`🔧 Tool: ${name}(${JSON.stringify(args).substring(0, 120)}...)`),
  llm: (msg) => console.log(`🤖 LLM: ${msg}`)
};

class VisualMCPRunner {
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
    this.visualChecker = new VisualRegressionChecker({
      baselineDir: 'files/baselines',
      diffDir: runDiffsDir
    });
    this.systemPrompt = null;
    this.cdpService = new CDPService(config.browser, log);
  }

  extractScreenshotPath(result) {
    if (!result || !Array.isArray(result.content)) return null;

    const fullText = result.content
      .filter(content => content.type === 'text' && typeof content.text === 'string')
      .map(content => content.text)
      .join('\n');

    if (!fullText) return null;

    const matches = fullText.match(/([^\s"'()]+?\.(png|jpg|jpeg))/gi);
    if (!matches || matches.length === 0) return null;

    const filename = path.basename(matches[matches.length - 1]);
    const screenshotsPath = path.join(config.reporting.screenshotsDir, filename);
    const filesRootPath = path.join('files', filename);

    if (!fs.existsSync(screenshotsPath) && fs.existsSync(filesRootPath)) {
      fs.renameSync(filesRootPath, screenshotsPath);
      log.info(`Moved screenshot from /files to /files/screenshots: ${filename}`);
    }

    return screenshotsPath;
  }

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
      testStep: typeof testStep === 'string' ? testStep.trim() : null,
      timestamp: new Date()
    });
    if (status === 'passed') this.testResults.passed++;
    if (status === 'failed') this.testResults.failed++;
  }

  async initializeMCP() {
    const workspaceDir = path.resolve('files');
    const screenshotsDir = path.join(workspaceDir, runId ? `screenshots/${runId}` : 'screenshots');
    const uploadsDir = path.join(workspaceDir, 'uploads');

    fs.mkdirSync(path.resolve('files/baselines'), { recursive: true });
    fs.mkdirSync(path.resolve('files/diffs'), { recursive: true });
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    const chromiumPath = findChromiumPath();
    log.info(`Using Chromium at: ${chromiumPath}`);

    const cdpPort = await this.cdpService.initialize(chromiumPath);

    const transport = new StdioClientTransport({
      command: 'npx',
      cwd: workspaceDir,
      args: [
        '@playwright/mcp@latest',
        '--cdp-endpoint', `http://127.0.0.1:${cdpPort}`,
        '--ignore-https-errors',
        '--output-dir', runId ? `screenshots/${runId}` : 'screenshots',
        '--viewport-size', `${config.browser.viewport.width}x${config.browser.viewport.height}`
      ],
      stderr: 'inherit',
      env: {
        ...process.env
      }
    });

    this.mcpClient = new Client({
      name: 'visual-mcp-runner',
      version: '2.0.0'
    });

    await this.mcpClient.connect(transport);
    log.success(`Connected to MCP: ${JSON.stringify(this.mcpClient.getServerVersion())}`);

    const toolsList = await this.mcpClient.listTools();
    log.info(`Discovered ${toolsList.tools.length} MCP tools`);

    for (const tool of toolsList.tools) {
      this.mcpTools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      });
    }

    await this.cdpService.startScreencast();
    this.systemPrompt = buildStaticSystemPrompt(this.mcpTools, true);

    return this.mcpTools;
  }

  async takeDOMSnapshot() {
    try {
      const { result } = await this.executeMCP('browser_snapshot', {});
      if (!result || !Array.isArray(result.content)) return '';
      return result.content
        .filter(content => content.type === 'text')
        .map(content => content.text)
        .join('\n');
    } catch (err) {
      log.warn(`DOM snapshot failed (non-fatal): ${err.message}`);
      return '';
    }
  }

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

  async executeMCP(toolName, params) {
    log.tool(toolName, params);
    const start = Date.now();

    const result = await this.mcpClient.callTool({
      name: toolName,
      arguments: params
    });
    const duration = Date.now() - start;

    if (result.isError) {
      const error = new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
      error.duration = duration;
      log.error('Error while mcp execution-> ', error);
      throw error;
    }

    if (Array.isArray(result.content)) {
      const textBlock = result.content.find(content => content.type === 'text')?.text;

      if (textBlock) {
        const match = textBlock.match(/### Result\s+([^\n]+)/i);

        if (match) {
          const value = match[1].trim().toLowerCase();

          if (value === 'false') {
            const error = new Error('MCP Tool returned false');
            error.duration = duration;
            throw error;
          }

          if (value === 'undefined' || value === 'null' || value === 'error') {
            const error = new Error(
              `MCP Tool returned ${value} — element not found or action had no effect`
            );
            error.duration = duration;
            throw error;
          }
        }
      }
    }

    return { result, duration };
  }

  async callLLM(messages, includeTools = false) {
    const requestConfig = {
      model: this.llm,
      temperature: config.llm.temperature,
      messages
    };

    if (includeTools) {
      requestConfig.tools = this.generateMCPTools();
    }

    const { text, toolCalls } = await generateText(requestConfig);

    return {
      content: text,
      tool_calls: toolCalls?.map(toolCall => ({
        id: toolCall.toolCallId,
        type: 'function',
        function: {
          name: toolCall.toolName,
          arguments: JSON.stringify(toolCall.args)
        }
      }))
    };
  }

  async generateExecutionPlan(testText, testSteps, domSnapshot) {
    log.llm(`Chosen LLM provider -> ${config.llm.provider}`);
    log.llm(`Chosen Model -> ${config.llm.model} `);
    log.llm('Generating execution plan...');

    const systemPrompt = buildStaticSystemPrompt(this.mcpTools, true);
    const userMessage = buildPlanningUserMessage({
      testText,
      stepCount: testSteps.length,
      compressedSnapshot: domSnapshot || null,
    });

    const response = await this.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]);

    let planJson = response.content;
    planJson = planJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const plan = JSON.parse(planJson);

      plan.forEach((step, index) => {
        if (step.stepIndex < 1 || step.stepIndex > testSteps.length) {
          log.warn(`Step ${index + 1} has invalid stepIndex ${step.stepIndex}, correcting to ${index + 1}`);
          step.stepIndex = index + 1;
        }
      });

      plan.sort((left, right) => left.stepIndex - right.stepIndex);

      const seenIndices = new Set();
      const dedupedPlan = plan.filter(step => {
        if (seenIndices.has(step.stepIndex)) return false;
        seenIndices.add(step.stepIndex);
        return true;
      });

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
        tool: 'visual_regression_check',
        params: step.params,
        status: result.passed ? 'passed' : 'failed',
        assertion: true,
        error: result.passed ? null : result.summary,
        duration: Date.now() - start,
        screenshot: screenshotPath,
        diffScreenshot: result.diffPath || null,
        visualResult: result,
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
      return { passed: false, needsResnapshot: false };
    }
  }

  async runTest(testText, testName) {
    const yamlNameMatch = testText.match(/^name:\s*(.+)$/m);
    if (!yamlNameMatch) {
      throw new Error('ai_visual_runner only supports visual regression tests with a top-level name: field.');
    }

    const logicalName = yamlNameMatch[1].trim();
    this.logicalTestName = logicalName;

    log.info(`🧪 Starting visual regression test: ${testName} (logical name: ${logicalName})`);

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

    const testSteps = testText.split('\n').filter(line => line.trim().startsWith('-'));

    const urlMatch = testText.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
      const targetUrl = urlMatch[0];
      const navStepText = testSteps.find(step => step.includes(targetUrl));
      log.info(`🌐 Navigating to ${targetUrl} before taking snapshot...`);
      try {
        const { duration } = await this.executeMCP('browser_navigate', { url: targetUrl });
        log.success(`Navigation to ${targetUrl} complete`);
        this.recordAction({
          tool: 'mcp_browser_navigate',
          params: { url: targetUrl },
          status: 'passed',
          assertion: false,
          duration,
          testStep: (navStepText || `- Navigate to ${targetUrl}`).trim()
        });
      } catch (navErr) {
        log.warn(`Initial navigation failed (non-fatal): ${navErr.message}`);
        this.recordAction({
          tool: 'mcp_browser_navigate',
          params: { url: targetUrl },
          status: 'failed',
          assertion: false,
          error: navErr.message,
          duration: navErr.duration || 0,
          testStep: (navStepText || `- Navigate to ${targetUrl}`).trim()
        });
      }
    }

    log.info('📸 Skipping DOM snapshot for visual regression test...');

    let executionPlan = await this.generateExecutionPlan(testText, testSteps, '');

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

    let planIndex = 0;

    while (planIndex < executionPlan.length) {
      const step = executionPlan[planIndex];
      const rawStep = testSteps[step.stepIndex - 1] || testSteps[planIndex] || '';
      const originalStep = rawStep || step.description || '';
      const stepNum = step.stepIndex || (planIndex + 1);

      log.info(`\n📍 Step ${stepNum}/${testSteps.length}: ${originalStep.trim()}`);

      const toolName = step.tool.replace(/^mcp_/, '');

      if (toolName === 'visual_regression_check') {
        this.executeVisualRegressionStep(step, originalStep, testName);
        planIndex++;
        continue;
      }

      if (toolName === 'browser_take_screenshot' && step.params?.filename) {
        step.params.filename = step.params.filename.replace(/^\.?\/?(files\/)+/, '');
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

        log.success(`✓ Step ${stepNum} passed${step.isAssertion ? ' (assertion)' : ''}`);
      } catch (err) {
        log.error(`✗ Step ${stepNum} failed`, err.message);
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

      planIndex++;
    }

    this.testReport.endTime = new Date();
    this.testReport.actions = this.testResults.actions;
    this.testReport.passedActions = this.testResults.passed;
    this.testReport.failedActions = this.testResults.failed;
    this.testReport.totalActions = this.testResults.actions.length;
    this.testReport.testResult = this.testResults.failed === 0 ? 'pass' : 'fail';

    const report = this.reportGenerator.generateReport(this.testReport);
    log.success(`📊 HTML Report: ${report.htmlReport}`);
    console.log(`__REPORT_FILE__${path.basename(report.htmlReport)}`);

    if (this.testResults.failed > 0) {
      throw new Error('Test failed');
    }

    return this.testResults;
  }

  async cleanup() {
    if (this.mcpClient) {
      await this.mcpClient.close();
      log.info('MCP connection closed');
    }

    await this.cdpService.shutdown();
  }
}

function getTestFiles(dirPath) {
  const testFiles = [];

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Path does not exist: ${dirPath}`);
  }

  const stats = fs.statSync(dirPath);

  if (stats.isFile()) {
    if (dirPath.endsWith('.yml') || dirPath.endsWith('.yaml')) {
      return [path.resolve(dirPath)];
    }
    throw new Error(`File must be a .yml or .yaml file: ${dirPath}`);
  }

  if (stats.isDirectory()) {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const fileStats = fs.statSync(fullPath);

      if (fileStats.isFile() && (file.endsWith('.yml') || file.endsWith('.yaml'))) {
        testFiles.push(path.resolve(fullPath));
      }
    }

    return testFiles.sort();
  }

  return testFiles;
}

async function main() {
  const testPath = process.argv[2];

  if (!testPath) {
    console.error('Usage: node ai_visual_runner.js <test.yml | tests-folder>');
    console.error('Examples:');
    console.error('  node ai_visual_runner.js tests/visual.test.yml');
    console.error('  node ai_visual_runner.js tests/');
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

  log.info(`Found ${testFiles.length} visual regression test file(s) to execute`);

  const allResults = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (let index = 0; index < testFiles.length; index++) {
    const testFile = testFiles[index];
    const testName = path.basename(testFile);

    log.info(`\n${'='.repeat(60)}`);
    log.info(`Executing visual test ${index + 1}/${testFiles.length}: ${testName}`);
    log.info(`${'='.repeat(60)}\n`);

    const runner = new VisualMCPRunner();
    activeRunner = runner;

    const testText = fs.readFileSync(testFile, 'utf8');

    try {
      await runner.initializeMCP();
      const result = await runner.runTest(testText, testName);
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
      activeRunner = null;
    }
  }

  log.info(`\n${'='.repeat(60)}`);
  log.info('TEST SUITE SUMMARY');
  log.info(`${'='.repeat(60)}`);
  log.info(`Total Tests: ${testFiles.length}`);
  log.success(`Passed: ${totalPassed}`);
  if (totalFailed > 0) {
    log.error(`Failed: ${totalFailed}`, '');
  }
  log.info(`${'='.repeat(60)}\n`);

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

let activeRunner = null;

async function gracefulShutdown(signal) {
  log.warn(`${signal} received. Cleaning up...`);
  if (activeRunner) {
    try {
      await activeRunner.cleanup();
    } catch (err) {
      log.error('Cleanup error during shutdown', err);
    }
    activeRunner = null;
  }
  process.exit(signal === 'SIGTERM' ? 143 : 0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  log.error('Unhandled rejection', err);
  process.exit(1);
});

export { VisualMCPRunner, log, config };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error('Fatal error', err);
    process.exit(1);
  });
}
