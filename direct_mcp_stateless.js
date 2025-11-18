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
    model: 'gpt-4o-mini',
    temperature: 0.1,
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
  tool: (name, args) => console.log(`🔧 Tool: ${name}(${JSON.stringify(args).substring(0, 80)}...)`),
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
  sanitizeLLMContent(content) {
  if (!content) return content;
  // Remove long base64 blobs or large JSON blocks
  return content
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '[screenshot-omitted]')
    .replace(/"data":\s*"[^"]{500,}"/g, '"data": "[omitted]"')
    .replace(/"content":\s*"[^"]{500,}"/g, '"content": "[omitted]"');
}
  async initializeMCP() {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '@playwright/mcp@latest',
        '--ignore-https-errors',
        '--output-dir', config.reporting.screenshotsDir,
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

  generateMCPFunctions() {
    const functions = [];
    
    // Real MCP tools
    for (const [toolName, tool] of this.mcpTools) {
      functions.push({
        name: `mcp_${toolName}`,
        description: tool.description || `Execute MCP tool: ${toolName}`,
        parameters: tool.inputSchema || {
          type: "object",
          properties: {},
          required: []
        }
      });
    }
    
    // Virtual assertion tool
    functions.push({
      name: 'mcp_assert',
      description: 'Test assertion that fails if expression evaluates to false',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'JavaScript boolean expression (e.g., "window.location.href.includes(\'/login\')")'
          },
          failureMessage: {
            type: 'string',
            description: 'Error message if assertion fails'
          }
        },
        required: ['expression', 'failureMessage']
      }
    });

    return functions;
  }

  extractExpectedValue(expression) {
    // Handle comparison operators (===, ==, !==, !=, >, <, >=, <=)
    const comparisonMatch = expression.match(/(?:===|==|!==|!=|>=|<=|>|<)\s*['"](.+?)['"]/);
    if (comparisonMatch) {
      return comparisonMatch[1];
    }
    
    // Handle numeric comparisons
    const numericMatch = expression.match(/(?:===|==|!==|!=|>=|<=|>|<)\s*(\d+(?:\.\d+)?)/);
    if (numericMatch) {
      return numericMatch[1];
    }
    
    // Handle .includes() method calls
    const includesMatch = expression.match(/\.includes\s*\(\s*['"](.+?)['"]\s*\)/);
    if (includesMatch) {
      return `text contains "${includesMatch[1]}"`;
    }
    
    // Handle .startsWith() method calls
    const startsWithMatch = expression.match(/\.startsWith\s*\(\s*['"](.+?)['"]\s*\)/);
    if (startsWithMatch) {
      return `text starts with "${startsWithMatch[1]}"`;
    }
    
    // Handle .endsWith() method calls
    const endsWithMatch = expression.match(/\.endsWith\s*\(\s*['"](.+?)['"]\s*\)/);
    if (endsWithMatch) {
      return `text ends with "${endsWithMatch[1]}"`;
    }
    
    // Handle boolean expressions that should be true
    if (expression.includes('.includes(') || expression.includes('.startsWith(') || expression.includes('.endsWith(')) {
      return 'true (condition should be met)';
    }
    
    // For other expressions, try to infer what's expected
    return 'true (assertion should pass)';
  }

  async callMCPTool(toolName, params) {
    log.tool(toolName, params);
    
    const actionStart = Date.now();
    const result = await this.mcpClient.callTool({ 
      name: toolName, 
      arguments: params 
    });
    const actionDuration = Date.now() - actionStart;
    
    this.testResults.passed++;
    this.testResults.actions.push({
      tool: `mcp_${toolName}`,
      params: params,
      status: 'passed',
      result: result,
      duration: actionDuration,
      timestamp: new Date()
    });
    
    return result;
  }

  async executeFunctionCall(functionCall) {
    const functionName = functionCall.name;
    const args = JSON.parse(functionCall.arguments);

    // Handle virtual assertion tool
    if (functionName === 'mcp_assert') {
      log.info('Executing assertion', args.expression);
      
      // First, get the actual value by extracting the base expression
      let actualValue = 'unknown';
      let actualRawValue = null;
      try {
        // For method calls like .includes(), .contains(), etc., get the object
        // For comparisons like ===, get the left side
        let leftSideExpr = null;
        
        // Check for method calls first (e.g., str.includes('x'))
        const methodMatch = args.expression.match(/^(.+?)\.(includes|contains|startsWith|endsWith)\(/);
        if (methodMatch) {
          leftSideExpr = methodMatch[1].trim();
        } else {
          // Check for comparison operators
          const comparisonMatch = args.expression.match(/^(.+?)\s*(?:===|==|!==|!=|>|<|>=|<=)\s*/);
          if (comparisonMatch) {
            leftSideExpr = comparisonMatch[1].trim();
          }
        }
        
        if (leftSideExpr) {
          const actualResult = await this.mcpClient.callTool({ 
            name: 'browser_evaluate', 
            arguments: { function: `() => ${leftSideExpr}` }  // Wrap in function
          });
          actualRawValue = actualResult;
          
          // Extract the actual value from the MCP response
          if (actualResult && actualResult.content) {
            if (Array.isArray(actualResult.content)) {
              const textContent = actualResult.content.find(c => c.type === 'text');
              if (textContent && textContent.text) {
                // Parse the actual value from MCP response format "### Result\nVALUE\n\n### Ran..."
                const match = textContent.text.match(/### Result\s*\n\s*(.+?)(?:\n\n### Ran|$)/s);
                if (match) {
                  actualValue = match[1].trim();
                } else {
                  actualValue = textContent.text;
                }
              }
            } else {
              actualValue = JSON.stringify(actualResult.content);
            }
          } else if (actualResult && actualResult.result !== undefined) {
            actualValue = JSON.stringify(actualResult.result);
          }
        }
      } catch (e) {
        actualValue = 'Error getting value: ' + e.message;
      }
      
      // Now evaluate the full assertion (also needs to be wrapped in function)
      const evalResult = await this.callMCPTool('browser_evaluate', { 
        function: `() => ${args.expression}`
      });

      // Extract the boolean result from MCP response
      let assertionPassed = false;
      if (evalResult && evalResult.content) {
        if (Array.isArray(evalResult.content)) {
          const textContent = evalResult.content.find(c => c.type === 'text');
          if (textContent && textContent.text) {
            // Parse the result from the text (it's in format "### Result\ntrue")
            const match = textContent.text.match(/### Result\s*\n\s*(true|false)/);
            if (match) {
              assertionPassed = match[1] === 'true';
            }
          }
        }
      } else if (evalResult && evalResult.result !== undefined) {
        assertionPassed = evalResult.result === true;
      }

      if (assertionPassed) {
        log.success('Assertion passed');
        
        // Extract expected value from expression
        const expectedValue = this.extractExpectedValue(args.expression);
        
        // Track passed assertion
        this.testResults.passed++;
        this.testResults.actions.push({
          tool: 'mcp_assert',
          params: {
            expression: args.expression,
            failureMessage: args.failureMessage
          },
          status: 'passed',
          success: true,
          result: {
            assertion: 'Passed',
            expression: args.expression,
            expectedValue: expectedValue,
            actualValue: actualValue
          },
          duration: 0,
          timestamp: new Date()
        });
        
        return { success: true, message: 'Assertion passed' };
      } else {
        // Extract expected value from expression
        const expectedValue = this.extractExpectedValue(args.expression);
        
        // Enhanced error message with expected vs actual
        const detailedError = `${args.failureMessage}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Test Step Context: Verification step
Expression Used: ${args.expression}
Expected Value: ${expectedValue}
Actual Value: ${actualValue}
Assertion Result: FAILED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        console.error('\n❌ ASSERTION FAILED:');
        console.error(detailedError);
        
        this.testResults.failed++;
        this.testResults.actions.push({
          tool: 'assertion',
          status: 'failed',
          success: false,
          error: detailedError,
          expression: args.expression,
          expectedValue: expectedValue,
          actualValue: actualValue,
          timestamp: new Date()
        });
        throw new Error(detailedError);
      }
    }

    // Handle real MCP tools
    const mcpToolName = functionName.replace('mcp_', '');
    return await this.callMCPTool(mcpToolName, args);
  }

  async callLLM(messages) {
    if (!config.llm.apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    let fetchFn = globalThis.fetch;
    if (!fetchFn) {
      const mod = await import('node-fetch');
      fetchFn = mod.default ?? mod;
    }

    const functions = this.generateMCPFunctions();
    
    const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llm.apiKey}`
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: messages,
        temperature: config.llm.temperature,
        functions: functions,
        function_call: 'auto'
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    return result.choices[0].message;
  }

  async runTest(testText, testName) {
    log.info(`🧪 Starting test: ${testName}`);
    
    // Initialize test report
    this.testReport = {
      testName: testName,
      testText: testText,
      startTime: new Date(),
      endTime: null,
      duration: 0,
      passedActions: 0,
      failedActions: 0,
      totalActions: 0,
      actions: [],
      testResult: 'running'
    };
    
    // Parse test steps to get actual count
    const testSteps = testText.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('-') && !trimmed.includes('if not') && !trimmed.includes('otherwise');
    });
    const actualStepCount = testSteps.length;
    log.info(`Test has ${actualStepCount} steps`);

    const messages = [
      {
        role: "system",
        content: `You are a STRICT test execution agent. Your ONLY job is to execute test steps EXACTLY as written.

ABSOLUTE RULES - NO EXCEPTIONS:
1. Execute ONLY the steps listed in the test - NO additional actions beyond what is explicitly stated
2. DO NOT repeat steps or add extra actions not specified in the test
3. DO NOT try to "help" or "improve" the test - follow it LITERALLY word-by-word
4. Execute ONE tool call per step, then WAIT for the next user instruction
5. For verification steps, use the EXACT expected values from the test - do NOT modify them
6. After completing ALL ${actualStepCount} steps, respond with ONLY the text "TEST COMPLETED" and NO tool calls
7. Choose the appropriate tool for each step based on what the step describes

Available tools: ${Array.from(this.mcpTools.keys()).map(n => `mcp_${n}`).join(', ')}, mcp_assert

TEST STEPS TO EXECUTE (${actualStepCount} steps total):
${testText}

CRITICAL: This test has ${actualStepCount} steps. Execute them in order, one at a time. After step ${actualStepCount}, say "TEST COMPLETED".`
      },
      {
        role: "user",
        content: "Execute step 1"
      }
    ];

    let stepCount = 0;
    const maxSteps = actualStepCount + 5; // Allow small buffer for sub-steps
    let testCompleted = false;

    while (stepCount < maxSteps && !testCompleted) {
      stepCount++;
      log.info(`Step ${stepCount}`);
      
      const response = await this.callLLM(messages);
      
      // 1️⃣ After LLM response - sanitize content before pushing
      const cleanResponse = {
        ...response,
        content: this.sanitizeLLMContent(response.content),
      };
      messages.push(cleanResponse);

      // Check for completion
      if (response.content && response.content.includes("TEST COMPLETED")) {
        log.success("Test execution completed");
        testCompleted = true;
        break;
      }

      // Handle function calls
      if (response.function_call) {
        log.llm(`Chose ${response.function_call.name}`);
        
        try {
          const result = await this.executeFunctionCall(response.function_call);
          log.success('Action succeeded');
          
          // 2️⃣ After function call results - sanitize before pushing
          messages.push({
            role: "function",
            name: response.function_call.name,
            content: this.sanitizeLLMContent(JSON.stringify(result))
          });
          
          // Guide LLM to next step
          if (stepCount < actualStepCount) {
            messages.push({
              role: "user",
              content: `Step ${stepCount} completed. Execute step ${stepCount + 1}`
            });
          } else {
            messages.push({
              role: "user",
              content: `All ${actualStepCount} steps completed. Respond with "TEST COMPLETED"`
            });
          }
        } catch (error) {
          log.error('Action failed', error.message);
          
          messages.push({
            role: "function",
            name: response.function_call.name,
            content: `ERROR: ${error.message}`
          });
          
          // Stop on assertion failure (but generate report first)
          if (response.function_call.name === 'mcp_assert') {
            testCompleted = true; // Mark as completed so we break out
            break; // Exit the while loop to generate report
          }
        }
      }
    }

    if (!testCompleted && stepCount >= maxSteps) {
      log.warn('Test stopped: max steps reached');
    }

    // ALWAYS finalize test report (even on failure)
    this.testReport.endTime = new Date();
    this.testReport.duration = this.testReport.endTime - this.testReport.startTime;
    this.testReport.actions = this.testResults.actions;
    this.testReport.passedActions = this.testResults.passed;
    this.testReport.failedActions = this.testResults.failed;
    this.testReport.totalActions = this.testResults.actions.length;
    this.testReport.testResult = this.testResults.failed === 0 ? 'pass' : 'fail';
    
    // Generate HTML report
    const reportResult = this.reportGenerator.generateReport(this.testReport);
    log.success(`📊 HTML Report: ${reportResult.htmlReport}`);
    
    // If there were assertion failures, throw error AFTER generating report
    if (this.testResults.failed > 0) {
      const failedActions = this.testResults.actions.filter(a => !a.success);
      const errorMsg = failedActions.map(a => a.error).join('\n');
      throw new Error(`Test failed with ${this.testResults.failed} assertion(s):\n${errorMsg}`);
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
  
  if (!testFile) {
    console.error('Usage: node direct_mcp_stateless.js <test-file>');
    process.exit(1);
  }

  if (!fs.existsSync(testFile)) {
    console.error(`Test file not found: ${testFile}`);
    process.exit(1);
  }

  const testText = fs.readFileSync(testFile, 'utf8');
  const testName = path.basename(testFile);
  
  const runner = new StatelessMCPRunner();
  
  try {
    await runner.initializeMCP();
    const results = await runner.runTest(testText, testName);
    
    log.info('📊 Test Results:', {
      passed: results.passed,
      failed: results.failed,
      total: results.actions.length
    });

    if (results.failed > 0) {
      log.error(`TEST FAILED: ${results.failed} assertion(s) failed`);
      process.exit(1);
    } else {
      log.success(`TEST PASSED: All ${results.passed} actions succeeded`);
      process.exit(0);
    }
  } catch (error) {
    log.error('Test execution failed', error.message);
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
