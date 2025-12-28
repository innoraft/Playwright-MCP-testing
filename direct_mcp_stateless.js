#!/usr/bin/env node
/**
 * Autonomous LLM-to-MCP Test Runner (Stateless Edition)
 * ------------------------------------------------------
 * • No batching, no memory accumulation
 * • Direct streaming LLM responses
 * • Full MCP integration for browser automation
 * • Minimal, production-ready design
 * 
 * Usage: node direct_mcp_stateless.js tests/example.test.yml
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TestReportGenerator } from './test-report-generator.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CONFIG ----------
const config = {
  llm: {
    model: 'gpt-5',
    temperature: 1,
    apiKey: process.env.OPENAI_API_KEY
  },
  browser: {
    headless: false,
    viewport: { width: 1280, height: 720 }
  },
  reporting: {
    screenshotsDir: 'test-screenshots',
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
  }

  extractScreenshotPath(result) {
    if (!result || !Array.isArray(result.content)) return null;

    // Collect ALL text output
    const fullText = result.content
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text)
      .join('\n');

    if (!fullText) return null;

    // Match any image filename Playwright might emit
    const matches = fullText.match(/([^\s"'()]+?\.(png|jpg|jpeg))/gi);
    if (!matches || matches.length === 0) return null;

    // Return LAST screenshot (most relevant)
    const filename = path.basename(matches[matches.length - 1]);

    return path.join(config.reporting.screenshotsDir, filename);
  }

  recordAction({ tool, params, status, assertion, error, duration, screenshot }) {
    this.testResults.actions.push({
      tool,
      params,
      status,
      assertion: assertion || null,  // Add this
      error: error || null,
      duration,
      screenshot: screenshot || null,
      timestamp: new Date()
    });

    console.log("tool:" + tool)
    console.log("param" + params)
    console.log("status:" + status)
    console.log("assertion:" + assertion)  // Add this
    console.log("error: " + error)
    console.log("duration: " + duration)
    console.log("screenshot : " + screenshot)

    if (status === 'passed') this.testResults.passed++;
    if (status === 'failed') this.testResults.failed++;
  }

  async initializeMCP() {
    const screenshotsDir = path.resolve(config.reporting.screenshotsDir);

    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
      log.info(`Created screenshots directory: ${screenshotsDir}`);
    }

    const transport = new StdioClientTransport({
      command: 'npx',
      cwd: screenshotsDir,
      args: [
        '@playwright/mcp@latest',
        '--ignore-https-errors',
        '--output-dir', screenshotsDir,
        '--viewport-size', `${config.browser.viewport.width}x${config.browser.viewport.height}`
      ],
      stderr: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_HEADLESS: config.browser.headless ? '1' : '0',
        DISPLAY: process.env.DISPLAY || ':0'
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

    return this.mcpTools;
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
    console.log(result)
    const duration = Date.now() - start;

    if (result.isError) {
      // Don't record here, just throw with context
      const error = new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
      error.duration = duration;
      console.log(" i am from executemcp->", error)
      throw error;
    }

    // Check if result contains "false" in text content
    if (Array.isArray(result.content)) {
      const textContent = result.content.find(c => c.type === 'text')?.text || '';
      if (textContent.toLowerCase().includes('false')) {
        const error = new Error(`MCP Tool returned false: ${textContent}`);
        error.duration = duration;
        throw error;
      }
    }

    return { result, duration };
  }

  async callLLM(messages, includeTools = false) {
    if (!config.llm.apiKey) throw new Error('OPENAI_API_KEY not set');

    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;

    const body = {
      model: config.llm.model,
      temperature: config.llm.temperature,
      messages
    };

    // Only include tools if explicitly requested (not needed for planning)
    if (includeTools) {
      body.tools = this.generateMCPTools();
      body.tool_choice = 'auto';
    }

    const response = await fetchFn(
      'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const json = await response.json();
    return json.choices[0].message;
  }

  buildPlanningPrompt(testText, stepCount) {
    // Dynamically inject tool definitions
    const toolsInfo = Array.from(this.mcpTools.values()).map(tool => ({
      name: tool.name, // Ensure this is the exact string needed to call the tool
      description: tool.description,
      schema: tool.inputSchema
    }));

    return `You are an intelligent Test Automation Planner. Your objective is to map natural language test steps to a precise sequence of executable tool calls based strictly on the provided tool definitions.
    Do not try to improve the test steps, don't try to imporve the test. Don't skip any step, Don't repeat any step, Dont change the sequence of the steps.

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
- **For screenshoot purpose try to pickup the screenshot tool.
- **Strict Adherence:** You must ONLY use tools listed in the "AVAILABLE TOOLS" section. Do not hallucinate tool names.

### 2. Parameter Generation (Schema Compliance)
- **Schema Mapping:** Once a tool is selected, you must generate parameters that strictly adhere to its \`schema\`.
- **Data Extraction:** Extract values (selectors, text, numbers, logic) directly from the test step to populate the schema fields.
- **Type Safety:** Ensure boolean, integer, and string types match the schema definitions exactly.

### 3. Step Classification
- **Action:** If the step implies interaction (e.g., click, type, navigate, wait, scroll etc.), classify as \`isAssertion: false\`.
- **Assertion:** If the step implies verification (e.g., verify, check, ensure, validate, confirm etc.), classify as \`isAssertion: true\`.

### 4. Code Generation (If Applicable)
- If a tool requires a code/script parameter (based on its schema):
  - Generate self-contained, synchronous code.
  - The code must implement the logic described in the test step.
  - Do not assume the existence of external variables.

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

  isAssertionFailure(result) {
    if (!result || !Array.isArray(result.content)) return true;

    // Common MCP patterns
    const text = result.content.find(c => c.type === 'text')?.text;
    const json = result.content.find(c => c.type === 'json')?.json;

    // Explicit false
    if (json === false) return true;

    // Empty / falsy text
    if (typeof text === 'string' && text.trim().toLowerCase() === 'false') {
      return true;
    }

    // Empty arrays / objects
    if (Array.isArray(json) && json.length === 0) return true;
    if (json && typeof json === 'object' && Object.keys(json).length === 0) {
      return true;
    }

    return false;
  }

  async generateExecutionPlan(testText, testSteps) {
    log.llm('Generating execution plan...');

    const planningPrompt = this.buildPlanningPrompt(testText, testSteps.length);

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
      log.success(`Generated plan with ${plan.length} steps`);
      return plan;
    } catch (err) {
      log.error('Failed to parse execution plan', err.message);
      throw new Error(`Invalid plan JSON: ${err.message}`);
    }
  }

  async runTest(testText, testName) {
    log.info(`🧪 Starting test: ${testName}`);

    this.testReport = {
      testName,
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
      const originalStep = testSteps[step.stepIndex - 1] || testSteps[i];

      log.info(`\n📍 Step ${i + 1}/${executionPlan.length}: ${originalStep.trim()}`);


      const toolName = step.tool.replace(/^mcp_/, '');

      try {
        const { result, duration } = await this.executeMCP(toolName, step.params);
        const screenshotPath = this.extractScreenshotPath(result);

        if (step.isAssertion && this.isAssertionFailure(result)) {
          throw new Error('Assertion failed: condition evaluated to false');
        }

        this.recordAction({
          tool: step.tool,
          params: step.params,
          status: 'passed',
          assertion: step.isAssertion || false,
          duration,
          screenshot: screenshotPath
        });


        log.success(`✓ Step ${i + 1} passed${step.isAssertion ? ' (assertion)' : ''}`);

      } catch (err) {
        log.error(`✗ Step ${i + 1} failed`, err.message);

        this.recordAction({
          tool: step.tool,
          params: step.params,
          status: 'failed',
          assertion: step.isAssertion || false,
          error: err.message,
          duration: err.duration || 0
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

  async cleanup() {
    if (this.mcpClient) {
      await this.mcpClient.close();
      log.info('MCP connection closed');
    }
  }
}

// ---------- MAIN EXECUTION ----------
async function main() {
  const testFile = process.argv[2];
  if (!testFile || !fs.existsSync(testFile)) {
    console.error('Usage: node direct_mcp_stateless.js <test.yml>');
    process.exit(1);
  }

  const runner = new StatelessMCPRunner();

  try {
    await runner.initializeMCP();
    await runner.runTest(
      fs.readFileSync(testFile, 'utf8'),
      path.basename(testFile)
    );
    log.success('TEST PASSED');
  } catch (err) {
    log.error('TEST FAILED', err.message);
    process.exit(1);
  } finally {
    await runner.cleanup();
  }
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
main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
