#!/usr/bin/env node
/**
 * mcp_llm_runner.js
 *  - Reads tests/*.txt (natural language)
 *  - Sends the text to an LLM (OpenAI) to translate into an ordered list of MCP tool calls
 *  - Connects to local Playwright MCP and executes the tool calls
 *  - Generates test report with pass/fail status
 *  - Runs in headed mode (browser visible)
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   node mcp_llm_runner.js tests/example.test.txt
 *
 * Security: Your API key stays in your environment. The script does not store it.
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SCREENSHOTS_DIR = path.join(process.cwd(), 'test-screenshots');

// Create screenshots directory if it doesn't exist
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

if (!OPENAI_KEY) {
  console.error('Please set OPENAI_API_KEY in the environment and try again.');
  process.exit(1);
}

// Test report tracking
const testReport = {
  testFile: '',
  startTime: new Date(),
  endTime: null,
  totalActions: 0,
  passedActions: 0,
  failedActions: 0,
  actions: [],
  testResult: null, // 'pass', 'fail', or null if no evaluation
  evaluationResults: [] // Store all evaluation results
};

async function callOpenAI(prompt) {
  // prefer the built-in fetch (Node 18+). If not available, dynamically import node-fetch.
  let fetchFn = globalThis.fetch;
  if (!fetchFn) {
    const mod = await import('node-fetch');
    fetchFn = mod.default ?? mod;
  }

  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0
    })
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices[0].message.content;
}

function buildPrompt(testText) {
  return `You are a translator from natural-language test steps to MCP tool calls for Playwright MCP.\n\n` +
    `Output JSON only: an array of actions in order. Each action is an object: { "tool": string, "params": object }. ` +
    `Available tools:\n` +
    `- browser_navigate(url: string) - Navigate to URL\n` +
    `- browser_navigate_back() - Go back\n` +
    `- browser_snapshot() - Get page accessibility snapshot (USE THIS before any click/type/select action!)\n` +
    `- browser_click(element: string, ref: string) - Click element (requires snapshot first, use element description)\n` +
    `- browser_type(element: string, ref: string, text: string, submit?: boolean) - Type text (requires snapshot first)\n` +
    `- browser_hover(element: string, ref: string) - Hover element\n` +
    `- browser_select_option(element: string, ref: string, values: string[]) - Select dropdown option\n` +
    `- browser_evaluate(function: string) - Execute JavaScript (use arrow function syntax)\n` +
    `- browser_wait_for(time?: number, text?: string, textGone?: string) - Wait (time in ms)\n` +
    `- browser_take_screenshot(fullPage?: boolean, filename?: string) - Take screenshot\n` +
    `- browser_fill_form(fields: array) - Fill multiple form fields\n` +
    `- browser_drag(startElement, startRef, endElement, endRef) - Drag and drop\n` +
    `- browser_press_key(key: string) - Press keyboard key\n` +
    `- browser_resize(width: number, height: number) - Resize window\n` +
    `- browser_console_messages(onlyErrors?: boolean) - Get console logs\n` +
    `- browser_network_requests() - Get network requests\n\n` +
    `IMPORTANT RULES:\n` +
    `1. For browser_wait_for, use "time" not "ms". For browser_evaluate, use "function" with arrow syntax.\n` +
    `2. BEFORE any click/type/select action, you MUST insert a browser_snapshot action!\n` +
    `3. For click/type/select actions, provide a clear "element" description (e.g., "search box", "submit button", "email input")\n` +
    `4. Set ref to "AUTO" - the runner will find the correct ref from the snapshot\n` +
    `5. For dropdown selects, provide the option text in values array\n` +
    `6. For test verification, use browser_evaluate to check expected conditions. Return 'pass' for success, 'fail' for failure.\n` +
    `   Example: {"tool":"browser_evaluate","params":{"function":"() => { return document.title.includes('Dashboard') ? 'pass' : 'fail'; }"}}\n` +
    `7. Base your evaluation logic on the specific test requirements and website behavior described in the test.\n` +
    `8. Use flexible matching for URLs (use .includes() or startsWith() instead of exact equality) and CSS selectors.\n` +
    `   For logout links, use: document.querySelector('a[href*="logout"]') instead of specific classes.\n\n` +
    `Example output with interactions:\n` +
    `[{"tool":"browser_navigate","params":{"url":"https://google.com"}},\n` +
    `{"tool":"browser_snapshot","params":{}},\n` +
    `{"tool":"browser_click","params":{"element":"search box","ref":"AUTO"}},\n` +
    `{"tool":"browser_type","params":{"element":"search box","ref":"AUTO","text":"Drupal"}},\n` +
    `{"tool":"browser_snapshot","params":{}},\n` +
    `{"tool":"browser_click","params":{"element":"search button","ref":"AUTO"}},\n` +
    `{"tool":"browser_wait_for","params":{"time":3000}},\n` +
    `{"tool":"browser_take_screenshot","params":{"fullPage":true}}]\n\n` +
    `Translate these test steps exactly into actions (do not include commentary):\n\n${testText}`;
}

async function runMcpActions(actions) {
  // Launch MCP in HEADED mode (browser visible)
  // Pass parameters directly as command line arguments for better compatibility
  const outputDir = path.join(process.cwd(), 'test-screenshots');
  
  const transport = new StdioClientTransport({ 
    command: 'npx', 
    args: [
      '@playwright/mcp@latest',
      '--ignore-https-errors',
      '--output-dir', outputDir,
      '--viewport-size', '1280x720'
    ],
    stderr: 'inherit',
    env: { ...process.env, PLAYWRIGHT_HEADLESS: '0', DISPLAY: process.env.DISPLAY || ':0' }
  });
  const client = new Client({ name: 'mcp-llm-runner', version: '0.0.1' });
  await client.connect(transport);
  console.log('Connected to MCP (HEADED MODE - browser will be visible):', client.getServerVersion());

  // inspect tools and schemas to guide simple param coercion
  let toolSchemas = {};
  try {
    const tl = await client.listTools();
    if (tl && tl.tools) {
      for (const t of tl.tools) {
        toolSchemas[t.name] = t.inputSchema;
      }
    }
  } catch (e) {
    console.log('Could not list tools for schema adaptation:', e.message || e);
  }
  console.log('Discovered tool schemas:', Object.keys(toolSchemas).length, 'tools');
  console.log('Available tools:', Object.keys(toolSchemas));
  // print a couple of relevant schemas if present
  if (toolSchemas['browser_navigate']) console.log('browser_navigate schema:', JSON.stringify(toolSchemas['browser_navigate'], null, 2));
  if (toolSchemas['browser_evaluate']) console.log('browser_evaluate schema:', JSON.stringify(toolSchemas['browser_evaluate'], null, 2));

  let lastSnapshot = null; // Store the most recent snapshot for element ref lookup

  for (const action of actions) {
    console.log('\n=====================================');
    console.log('Executing Action:', action.tool);
    console.log('=====================================');
    
    const actionResult = {
      tool: action.tool,
      params: action.params,
      status: 'pending',
      error: null,
      startTime: new Date()
    };
    
    testReport.totalActions++;
    
    // clone params so we can mutate safely
    let params = (action.params && typeof action.params === 'object') ? { ...action.params } : action.params;

    // browser_navigate: ensure { url }
    if (action.tool === 'browser_navigate') {
      if (!params || typeof params === 'string') {
        params = { url: params || 'https://demo11.lndo.site/' };
      } else if (!params.url) {
        params.url = 'https://demo11.lndo.site/';
      }
    }

    // browser_wait_for: ensure proper param name (time, text, or textGone)
    if (action.tool === 'browser_wait_for') {
      if (params && params.ms !== undefined && params.time === undefined) {
        params.time = params.ms;
        delete params.ms;
      } else if (!params || (params.time === undefined && params.text === undefined && params.textGone === undefined)) {
        params = { time: 2000 }; // default 2 second wait
      }
      // if still no valid param, default to 2 second wait
      if (!params.time && !params.text && !params.textGone) {
        params = { time: 2000 };
      }
    }

    // browser_evaluate: server expects 'function' string param
    if (action.tool === 'browser_evaluate') {
      if (params && typeof params === 'string') {
        params = { function: params };
      } else if (params && params.code !== undefined && params.function === undefined) {
        params.function = params.code;
        delete params.code;
      } else if (params && params.script !== undefined && params.function === undefined) {
        params.function = params.script;
        delete params.script;
      } else if (!params || !params.function) {
        console.warn('browser_evaluate requires function parameter, skipping');
        actionResult.status = 'failed';
        actionResult.error = 'Missing function parameter';
        actionResult.endTime = new Date();
        actionResult.duration = actionResult.endTime - actionResult.startTime;
        testReport.actions.push(actionResult);
        testReport.failedActions++;
        continue;
      }
    }

    // Handle interactive actions that need element refs (click, type, select_option, hover)
    const needsRef = ['browser_click', 'browser_type', 'browser_select_option', 'browser_hover'];
    if (needsRef.includes(action.tool)) {
      if (!params || !params.element) {
        console.warn(`${action.tool} requires element parameter, skipping`);
        actionResult.status = 'failed';
        actionResult.error = 'Missing element parameter';
        actionResult.endTime = new Date();
        actionResult.duration = actionResult.endTime - actionResult.startTime;
        testReport.actions.push(actionResult);
        testReport.failedActions++;
        continue;
      }
      
      if (params.ref === 'AUTO' && lastSnapshot) {
        const foundRef = await findElementRef(lastSnapshot, params.element);
        if (foundRef) {
          params.ref = foundRef;
          console.log(`✅ Element found: ${params.element} -> ${foundRef}`);
        } else {
          console.warn(`❌ Could not find element: ${params.element}`);
          actionResult.status = 'failed';
          actionResult.error = `Element not found: ${params.element}`;
          actionResult.failureDetails = {
            expected: `Element matching "${params.element}"`,
            actual: 'Element not found in page',
            reason: 'The specified element could not be located on the current page',
            rawOutput: lastSnapshot ? 'Page snapshot available but element not found' : 'No page snapshot available'
          };
          testReport.failedActions++;
          actionResult.endTime = new Date();
          actionResult.duration = actionResult.endTime - actionResult.startTime;
          testReport.actions.push(actionResult);
          continue;
        }
      }
    }

  console.log('Calling tool with params:', JSON.stringify(params));
  
  try {
    const result = await client.callTool({
      name: action.tool,
      arguments: params
    });
    
    console.log('Tool result:', result);
    actionResult.status = 'passed';
    
    // Store snapshot for element ref lookup
    if (action.tool === 'browser_snapshot') {
      lastSnapshot = result;
    }
    
    // Check for evaluation results that determine test pass/fail
    if (action.tool === 'browser_evaluate') {
      const evaluationResult = extractEvaluationResult(result);
      if (evaluationResult && evaluationResult.result) {
        testReport.evaluationResults.push(evaluationResult.result);
        console.log(`🔍 Evaluation result: ${evaluationResult.result}`);
        
        // Store detailed evaluation information
        actionResult.evaluationDetails = evaluationResult;
        
        // Mark this specific action as failed if evaluation failed
        if (evaluationResult.result === 'fail') {
          actionResult.status = 'failed';
          actionResult.error = `Test evaluation failed`;
          actionResult.failureDetails = {
            expected: evaluationResult.expected,
            actual: evaluationResult.actual,
            reason: evaluationResult.reason,
            rawOutput: evaluationResult.rawOutput
          };
          testReport.testResult = 'fail';
        } else if (evaluationResult.result === 'pass' && testReport.testResult !== 'fail') {
          testReport.testResult = 'pass';
        }
        
        // Store evaluation result in action details
        actionResult.evaluationResult = evaluationResult;
      }
    }
    
    // Count passed/failed actions after evaluation check
    if (actionResult.status === 'passed') {
      testReport.passedActions++;
    } else {
      testReport.failedActions++;
    }
    
    // Auto-screenshot for important actions
    const screenshotActions = ['browser_click', 'browser_navigate'];
    if (screenshotActions.includes(action.tool) && params.element && 
        (params.element.toLowerCase().includes('login') || 
         params.element.toLowerCase().includes('submit') ||
         params.element.toLowerCase().includes('save'))) {
      try {
        const timestamp = Date.now();
        const screenshotResult = await client.callTool({
          name: 'browser_take_screenshot',
          arguments: { 
            fullPage: true, 
            filename: `auto-${timestamp}.png` 
          }
        });
        actionResult.screenshot = `auto-${timestamp}.png`;
      } catch (e) {
        console.log('Auto-screenshot failed:', e.message);
      }
    }
    
  } catch (error) {
    console.error(`Action failed:`, error);
    actionResult.status = 'failed';
    actionResult.error = error.message || error;
    testReport.failedActions++;
  }
  
  actionResult.endTime = new Date();
  actionResult.duration = actionResult.endTime - actionResult.startTime;
  testReport.actions.push(actionResult);
  }

  await client.close();
  await transport.close();
  
  return testReport;
}

/**
 * Extract pass/fail result from browser_evaluate tool response
 * Returns an object with result, details, and failure information
 */
function extractEvaluationResult(result) {
  if (!result || !result.content) return null;
  
  let resultText = '';
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c.text) resultText += c.text + '\n';
    }
  } else if (result.content.text) {
    resultText = result.content.text;
  }
  
  // Look for evaluation results in the response
  const lowerText = resultText.toLowerCase();
  
  // Extract the actual result value
  let actualResult = 'unknown';
  let evaluationDetails = {
    result: null,
    rawOutput: resultText.trim(),
    expected: null,
    actual: null,
    reason: null
  };
  
  // Check for explicit pass/fail results
  if (resultText.includes('"pass"') || resultText.includes("'pass'")) {
    evaluationDetails.result = 'pass';
    evaluationDetails.actual = 'pass';
    evaluationDetails.expected = 'pass';
    evaluationDetails.reason = 'All evaluation criteria met successfully';
    return evaluationDetails;
  }
  if (resultText.includes('"fail"') || resultText.includes("'fail'")) {
    evaluationDetails.result = 'fail';
    evaluationDetails.actual = 'fail';
    evaluationDetails.expected = 'pass';
    
    // Try to extract more specific failure reason from the evaluation context
    if (resultText.includes('document.title') && resultText.includes('API')) {
      evaluationDetails.reason = 'Page title does not contain "API" - expected API documentation page';
    } else if (resultText.includes('Posts') || resultText.includes('posts')) {
      evaluationDetails.reason = 'Posts section verification failed - expected posts content to be visible';
    } else if (resultText.includes('title') && resultText.includes('content')) {
      evaluationDetails.reason = 'Post content verification failed - expected post title and content to be displayed';
    } else if (resultText.includes('console.error')) {
      evaluationDetails.reason = 'JavaScript errors detected on page - expected no console errors';
    } else {
      evaluationDetails.reason = 'One or more evaluation criteria not met - check page content and functionality';
    }
    return evaluationDetails;
  }
  
  // Check for boolean results
  if (lowerText.includes('true') && lowerText.includes('login')) {
    evaluationDetails.result = 'pass';
    evaluationDetails.actual = 'true';
    return evaluationDetails;
  }
  if (lowerText.includes('false') && lowerText.includes('login')) {
    evaluationDetails.result = 'fail';
    evaluationDetails.actual = 'false';
    evaluationDetails.expected = 'true';
    evaluationDetails.reason = 'Login verification failed';
    return evaluationDetails;
  }
  
  // Try to extract more specific information about what failed
  if (resultText.includes('undefined')) {
    evaluationDetails.result = 'fail';
    evaluationDetails.actual = 'undefined';
    evaluationDetails.expected = 'valid result';
    evaluationDetails.reason = 'Evaluation function returned undefined';
    return evaluationDetails;
  }
  
  return evaluationDetails;
}

function generateReport(report) {
  report.endTime = new Date();
  report.totalDuration = report.endTime - report.startTime;
  
  // Recalculate totals from actual actions array to ensure consistency
  report.totalActions = report.actions.length;
  report.passedActions = report.actions.filter(action => action.status === 'passed').length;
  report.failedActions = report.actions.filter(action => action.status === 'failed').length;
  
  const reportLines = [];
  reportLines.push('═══════════════════════════════════════════════════════');
  reportLines.push('              TEST EXECUTION REPORT');
  reportLines.push('═══════════════════════════════════════════════════════');
  reportLines.push('');
  reportLines.push(`Test File: ${report.testFile}`);
  reportLines.push(`Start Time: ${report.startTime.toISOString()}`);
  reportLines.push(`End Time: ${report.endTime.toISOString()}`);
  reportLines.push(`Total Duration: ${report.totalDuration}ms (${(report.totalDuration/1000).toFixed(2)}s)`);
  reportLines.push('');
  reportLines.push('───────────────────────────────────────────────────────');
  reportLines.push('                   SUMMARY');
  reportLines.push('───────────────────────────────────────────────────────');
  reportLines.push(`Total Actions: ${report.totalActions}`);
  reportLines.push(`✅ Passed: ${report.passedActions}`);
  reportLines.push(`❌ Failed: ${report.failedActions}`);
  reportLines.push(`Success Rate: ${((report.passedActions/report.totalActions)*100).toFixed(1)}%`);
  
  // Add overall test result
  if (report.testResult) {
    const testIcon = report.testResult === 'pass' ? '✅' : '❌';
    reportLines.push('');
    reportLines.push(`${testIcon} OVERALL TEST RESULT: ${report.testResult.toUpperCase()}`);
    if (report.evaluationResults.length > 0) {
      reportLines.push(`   Evaluation Results: ${report.evaluationResults.join(', ')}`);
    }
  } else if (report.evaluationResults.length > 0) {
    reportLines.push('');
    reportLines.push(`🔍 Evaluation Results: ${report.evaluationResults.join(', ')} (no pass/fail determination)`);
  }
  
  reportLines.push('');
  reportLines.push('───────────────────────────────────────────────────────');
  reportLines.push('                ACTION DETAILS');
  reportLines.push('───────────────────────────────────────────────────────');
  
  report.actions.forEach((action, idx) => {
    const statusIcon = action.status === 'passed' ? '✅' : '❌';
    reportLines.push('');
    reportLines.push(`${statusIcon} Action ${idx + 1}: ${action.tool}`);
    reportLines.push(`   Status: ${action.status.toUpperCase()}`);
    reportLines.push(`   Duration: ${action.duration}ms`);
    reportLines.push(`   Params: ${JSON.stringify(action.params)}`);
    if (action.error) {
      reportLines.push(`   Error: ${action.error}`);
    }
    
    // Add detailed failure information for evaluation actions
    if (action.failureDetails) {
      reportLines.push(`   Expected: ${action.failureDetails.expected}`);
      reportLines.push(`   Actual: ${action.failureDetails.actual}`);
      reportLines.push(`   Reason: ${action.failureDetails.reason}`);
      if (action.failureDetails.rawOutput && action.failureDetails.rawOutput.length < 200) {
        reportLines.push(`   Raw Output: ${action.failureDetails.rawOutput}`);
      }
    }
    
    if (action.evaluationResult) {
      reportLines.push(`   Evaluation: ${action.evaluationResult}`);
    }
    if (action.evaluationDetails && action.evaluationDetails.result) {
      reportLines.push(`   Evaluation: ${action.evaluationDetails.result}`);
    }
    if (action.screenshot) {
      reportLines.push(`   Screenshot: ${action.screenshot}`);
    }
  });
  
  reportLines.push('');
  reportLines.push('───────────────────────────────────────────────────────');
  reportLines.push(`Screenshots saved in: ${SCREENSHOTS_DIR}`);
  reportLines.push('═══════════════════════════════════════════════════════');
  
  const reportText = reportLines.join('\n');
  
  // Save report to file
  const reportPath = path.join(process.cwd(), 'test-reports', `report_${Date.now()}.txt`);
  const reportDir = path.join(process.cwd(), 'test-reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, reportText);
  
  console.log('\n');
  console.log(reportText);
  console.log(`\n📊 Report saved to: ${reportPath}`);
  
  return reportPath;
}

/**
 * Find element ref from snapshot based on element description
 * Uses LLM to intelligently match element descriptions to snapshot refs
 */
async function findElementRef(snapshot, elementDescription) {
  if (!snapshot || !elementDescription) return null;
  
  // Extract the snapshot text from the response
  let snapshotText = '';
  if (Array.isArray(snapshot.content)) {
    for (const c of snapshot.content) {
      if (c.text) snapshotText += c.text + '\n';
    }
  } else if (snapshot.content && snapshot.content.text) {
    snapshotText = snapshot.content.text;
  }
  
  if (!snapshotText) return null;
  
  // Try simple keyword matching first (fast path)
  const keywords = elementDescription.toLowerCase();
  const lines = snapshotText.split('\n');
  
  // Look for common patterns
  const patterns = [
    // Input fields
    { match: /search|query/i, find: /combobox.*"Search"|textbox.*"Search"|input.*search/i },
    { match: /email/i, find: /textbox.*"Email"|input.*email/i },
    { match: /password/i, find: /textbox.*"Password"|input.*password/i },
    { match: /username|user.*name/i, find: /textbox.*"Username"|input.*username/i },
    
    // Buttons
    { match: /search.*button|google.*search/i, find: /button.*"Google Search"|button.*"Search"/i },
    { match: /submit|sign.*in|log.*in/i, find: /button.*"Submit"|button.*"Sign in"|button.*"Log in"/i },
    { match: /feeling.*lucky/i, find: /button.*"I'm Feeling Lucky"/i },
    
    // Links
    { match: /sign.*in.*link/i, find: /link.*"Sign in"/i },
    { match: /gmail/i, find: /link.*"Gmail"/i },
    { match: /images/i, find: /link.*"Images"/i },
  ];
  
  // Try pattern matching
  for (const pattern of patterns) {
    if (pattern.match.test(keywords)) {
      for (const line of lines) {
        if (pattern.find.test(line)) {
          const refMatch = line.match(/\[ref=([^\]]+)\]/);
          if (refMatch) {
            console.log(`Found element ref using pattern: ${refMatch[1]} for "${elementDescription}"`);
            return refMatch[1];
          }
        }
      }
    }
  }
  
  // Fallback: Use LLM to find the best match
  try {
    const prompt = `Given this page snapshot and element description, find the exact ref value.\n\n` +
      `Element to find: "${elementDescription}"\n\n` +
      `Page snapshot (YAML format with [ref=eXXX] references):\n${snapshotText.substring(0, 8000)}\n\n` +
      `Instructions:\n` +
      `1. Find the element that best matches "${elementDescription}"\n` +
      `2. Return ONLY the ref value (e.g., "e42") - nothing else\n` +
      `3. If not found, return "NOT_FOUND"\n` +
      `4. Prioritize interactive elements (textbox, combobox, button, link)\n\n` +
      `Ref value:`;
    
    const response = await callOpenAI(prompt);
    const ref = response.trim().replace(/['"]/g, '');
    
    if (ref && ref !== 'NOT_FOUND' && /^e\d+$/.test(ref)) {
      console.log(`Found element ref using LLM: ${ref} for "${elementDescription}"`);
      return ref;
    }
  } catch (e) {
    console.log(`Could not find ref using LLM:`, e.message);
  }
  
  return null;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node mcp_llm_runner.js path/to/test.txt');
    process.exit(1);
  }
  
  testReport.testFile = file;
  
  const testText = fs.readFileSync(file, 'utf8');
  const prompt = buildPrompt(testText);
  console.log('Calling LLM to translate test...');
  const reply = await callOpenAI(prompt);
  console.log('LLM reply:', reply);
  let actions;
  try {
    // Extract JSON from code blocks if present
    let jsonText = reply;
    if (reply.includes('```json')) {
      const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
    } else if (reply.includes('```')) {
      const codeMatch = reply.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        jsonText = codeMatch[1];
      }
    }
    actions = JSON.parse(jsonText);
  } catch (e) {
    console.error('Failed to parse LLM JSON output:', e);
    console.error('Raw reply:', reply);
    process.exit(1);
  }

  const report = await runMcpActions(actions);
  const reportPath = generateReport(report);
  
  // Determine exit status based on test logic, not just action execution
  let shouldFail = false;
  let failureReason = '';
  let failureDetails = null;
  
  // Check if any actions failed to execute
  if (report.failedActions > 0) {
    shouldFail = true;
    
    // Find the first failed action with details
    const failedAction = report.actions.find(action => action.status === 'failed');
    if (failedAction && failedAction.failureDetails) {
      failureReason = `Test evaluation failed`;
      failureDetails = failedAction.failureDetails;
    } else {
      failureReason = `${report.failedActions} action(s) failed to execute`;
    }
  }
  
  // Check if test logic failed (more important than action execution)
  if (report.testResult === 'fail') {
    shouldFail = true;
    const failedEvaluation = report.actions.find(action => 
      action.tool === 'browser_evaluate' && action.status === 'failed'
    );
    if (failedEvaluation && failedEvaluation.failureDetails) {
      failureReason = 'Test logic failed';
      failureDetails = failedEvaluation.failureDetails;
    } else {
      failureReason = 'Test logic failed - evaluation returned "fail"';
    }
  }
  
  // Exit with appropriate status
  if (shouldFail) {
    console.error(`\n❌ TEST FAILED: ${failureReason}`);
    if (failureDetails) {
      console.error(`   Expected: ${failureDetails.expected}`);
      console.error(`   Actual: ${failureDetails.actual}`);
      console.error(`   Reason: ${failureDetails.reason}`);
    }
    process.exit(1);
  } else if (report.testResult === 'pass') {
    console.log(`\n✅ TEST PASSED: All actions executed and test logic succeeded`);
  } else {
    console.log(`\n✅ All ${report.passedActions} actions passed! (No test logic evaluation performed)`);
  }
}

main().catch(e=>{console.error(e); process.exit(1)});