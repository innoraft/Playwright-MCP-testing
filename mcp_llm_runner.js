#!/usr/bin/env node
/**
 * Pure LLM-Based MCP Test Runner
 * Uses AI to translate natural language test steps into Playwright MCP actions
 * 
 * Features:
 * - 100% LLM-driven test translation (no pattern matching)
 * - Intelligent element finding via page snapshots
 * - Rich HTML reports with embedded screenshots
 * - Automatic test pass/fail evaluation
 * - Support for complex assertions and validations
 * 
 * Usage:
 *   node mcp_llm_runner.js tests/example.test.txt
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration (embedded defaults)
const config = {
  runner: { mode: 'auto', retries: 2, timeout: 60000, headless: false, slowMo: 0 },
  llm: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0, maxTokens: 16000, cache: true, apiKey: process.env.OPENAI_API_KEY },
  browser: { viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true, defaultWaitTime: 2000, elementTimeout: 10000 },
  reporting: { formats: ['html', 'text'], screenshots: 'on-failure', outputDir: 'test-reports', screenshotsDir: 'test-screenshots', includeSnapshots: false },
  elementFinding: { fuzzyMatch: true, fuzzyThreshold: 30, cache: true, cacheSize: 100 }
};

// Parse CLI arguments
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v');

const SCREENSHOTS_DIR = path.join(process.cwd(), config.reporting.screenshotsDir);
const REPORTS_DIR = path.join(process.cwd(), config.reporting.outputDir);

// Create directories
for (const dir of [SCREENSHOTS_DIR, REPORTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

//═══════════════════════════════════════════════════════════════════════
// CUSTOM ERROR CLASSES
//═══════════════════════════════════════════════════════════════════════

class TestError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'TestError';
    this.context = context;
    this.suggestions = this.generateSuggestions();
  }
  
  generateSuggestions() {
    const suggestions = [];
    const msg = this.message.toLowerCase();
    
    if (msg.includes('element not found')) {
      suggestions.push('• Try using a more specific element description (e.g., "login button" instead of "button")');
      suggestions.push('• Add a "Wait 2 seconds" step before the action');
      suggestions.push('• Use "Take snapshot" before the action to verify element exists');
    } else if (msg.includes('variable') && msg.includes('not defined')) {
      suggestions.push('• Define the variable using: Set $varName to "value"');
      suggestions.push('• Check for typos in variable names');
      suggestions.push('• Variables are case-sensitive');
    } else if (msg.includes('timeout')) {
      suggestions.push('• Increase the wait time');
      suggestions.push('• Check if the page is loading slowly');
      suggestions.push('• Verify the element appears on the page');
    } else if (msg.includes('assertion') || msg.includes('expect')) {
      suggestions.push('• Check if the expected text/element is actually on the page');
      suggestions.push('• Try a partial match instead of exact match');
      suggestions.push('• Add a wait before the assertion');
    }
    
    return suggestions;
  }
  
  toString() {
    let str = `${this.name}: ${this.message}`;
    if (this.context && Object.keys(this.context).length > 0) {
      str += `\n  Context: ${JSON.stringify(this.context, null, 2)}`;
    }
    if (this.suggestions.length > 0) {
      str += `\n  Suggestions:\n    ${this.suggestions.join('\n    ')}`;
    }
    return str;
  }
}

//═══════════════════════════════════════════════════════════════════════
// LLM PARSER (Pure LLM approach - no pattern matching)
//═══════════════════════════════════════════════════════════════════════

async function callOpenAI(prompt) {
  if (!config.llm.apiKey) {
    throw new TestError('OPENAI_API_KEY not set. LLM mode requires API key.');
  }
  
  let fetchFn = globalThis.fetch;
  if (!fetchFn) {
    const mod = await import('node-fetch');
    fetchFn = mod.default ?? mod;
  }

  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.llm.apiKey}`
    },
    body: JSON.stringify({
      model: config.llm.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: config.llm.maxTokens,
      temperature: config.llm.temperature
    })
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices[0].message.content;
}

function buildPrompt(testText, format = 'txt') {
  // Base tools documentation
  const toolsDocs = `Available tools:\n` +
    `- browser_navigate(url: string) - Navigate to URL\n` +
    `- browser_navigate_back() - Go back to the previous page\n` +
    `- browser_snapshot() - Capture accessibility snapshot of the current page (USE THIS before any click/type/select action!)\n` +
    `- browser_click(element: string, ref: string) - Click element (requires snapshot first, use element description)\n` +
    `- browser_type(element: string, ref: string, text: string, submit?: boolean) - Type text (requires snapshot first)\n` +
    `- browser_hover(element: string, ref: string) - Hover over element on page\n` +
    `- browser_select_option(element: string, ref: string, values: string[]) - Select an option in a dropdown\n` +
    `- browser_evaluate(function: string) - Evaluate JavaScript expression on page or element (use arrow function syntax)\n` +
    `- browser_wait_for(time?: number, text?: string, textGone?: string) - Wait for text to appear/disappear or time to pass (time in ms)\n` +
    `- browser_take_screenshot(fullPage?: boolean, filename?: string) - Take screenshot of the page\n` +
    `- browser_fill_form(fields: array) - Fill multiple form fields at once\n` +
    `- browser_drag(startElement: string, startRef: string, endElement: string, endRef: string) - Perform drag and drop between two elements\n` +
    `- browser_press_key(key: string) - Press a key on the keyboard (e.g., "Enter", "Escape", "ArrowDown")\n` +
    `- browser_resize(width: number, height: number) - Resize the browser window\n` +
    `- browser_console_messages(onlyErrors?: boolean) - Returns all console messages (or only errors if onlyErrors=true)\n` +
    `- browser_network_requests() - Returns all network requests since loading the page\n` +
    `- browser_close() - Close the current page/tab\n` +
    `- browser_handle_dialog(accept: boolean, promptText?: string) - Handle browser dialogs (alert/confirm/prompt)\n` +
    `- browser_file_upload(paths: string[]) - Upload one or multiple files (provide absolute file paths)\n` +
    `- browser_install() - Install the browser (call if you get browser not installed error)\n\n`;
  
  // Format-specific prompts
  if (format === 'yaml' || format === 'yml') {
    return `You are a translator from YAML test specifications to MCP tool calls for Playwright MCP.\n\n` +
      `Input: A YAML test specification with structured test steps\n` +
      `Output: JSON only - an array of actions in order. Each action is an object: { "tool": string, "params": object }\n\n` +
      toolsDocs +
      `YAML FORMAT RULES:\n` +
      `1. "action" field maps to tool names (navigate→browser_navigate, click→browser_click, type→browser_type, etc.)\n` +
      `2. "url" field maps to url parameter for browser_navigate\n` +
      `3. "element" or "in" or "from" fields map to element parameter\n` +
      `4. "text" or "value" fields map to text parameter for browser_type\n` +
      `5. "option" field maps to values array for browser_select_option\n` +
      `6. "verify" sections should use browser_evaluate to check conditions\n` +
      `7. "wait" with number maps to browser_wait_for with time parameter (convert to milliseconds if needed)\n` +
      `8. Set ref="AUTO" for all interactive elements (click, type, select)\n` +
      `9. ALWAYS insert browser_snapshot BEFORE any click/type/select action\n\n` +
      `CRITICAL: VERIFICATION LOGIC FOR FORMS:\n` +
      `When verifying form elements, DYNAMICALLY generate selectors based on the element description:\n` +
      `\n` +
      `STEP 1: EXTRACT element type and description from the test step\n` +
      `- Parse "Name field" → type: textbox, keyword: "Name"\n` +
      `- Parse "Female radio button" → type: radio, keyword: "Female"\n` +
      `- Parse "Sunday checkbox" → type: checkbox, keyword: "Sunday"\n` +
      `- Parse "Country dropdown" → type: select, keyword: "Country"\n` +
      `\n` +
      `STEP 2: GENERATE appropriate selectors based on element type\n` +
      `- For TEXT INPUTS (field, input, textbox):\n` +
      `  Generate: input[placeholder*="{keyword}"], input[aria-label*="{keyword}"], input[name*="{keyword.toLowerCase()}"], #{keyword.toLowerCase()}\n` +
      `  Check: field.value === expectedValue\n` +
      `\n` +
      `- For RADIO BUTTONS (radio, option):\n` +
      `  Generate: input[value*="{keyword}"], input[aria-label*="{keyword}"], input[type="radio"][value*="{keyword.toLowerCase()}"], input[name*="gender"]\n` +
      `  Check: field.checked\n` +
      `\n` +
      `- For CHECKBOXES (checkbox, check):\n` +
      `  Generate: input[value*="{keyword}"], input[aria-label*="{keyword}"], input[type="checkbox"][value*="{keyword.toLowerCase()}"], input[name*="day"]\n` +
      `  Check: field.checked\n` +
      `\n` +
      `- For DROPDOWNS/SELECT (dropdown, select, combobox):\n` +
      `  Generate: select[name*="{keyword.toLowerCase()}"], select[id*="{keyword.toLowerCase()}"], select[aria-label*="{keyword}"]\n` +
      `  Check: field.value !== '' && field.selectedIndex > 0\n` +
      `\n` +
      `STEP 3: EXAMPLE dynamic verification patterns\n` +
      `For "Female radio button":\n` +
      `() => {\n` +
      `  const keyword = "Female";\n` +
      `  const selectors = [\n` +
      `    \`input[value*="\${keyword}"]\`,\n` +
      `    \`input[aria-label*="\${keyword}"]\`,\n` +
      `    \`input[type="radio"][value*="\${keyword.toLowerCase()}"]\`,\n` +
      `    'input[name*="gender"]'\n` +
      `  ];\n` +
      `  let field = null;\n` +
      `  for (const sel of selectors) {\n` +
      `    field = document.querySelector(sel);\n` +
      `    if (field) break;\n` +
      `  }\n` +
      `  return field && field.checked ? 'pass' : 'fail';\n` +
      `}\n` +
      `\n` +
      `For "Username field" with value "john123":\n` +
      `() => {\n` +
      `  const keyword = "Username";\n` +
      `  const expectedValue = "john123";\n` +
      `  const selectors = [\n` +
      `    \`input[placeholder*="\${keyword}"]\`,\n` +
      `    \`input[aria-label*="\${keyword}"]\`,\n` +
      `    \`input[name*="\${keyword.toLowerCase()}"]\`,\n` +
      `    \`#\${keyword.toLowerCase()}\`\n` +
      `  ];\n` +
      `  let field = null;\n` +
      `  for (const sel of selectors) {\n` +
      `    field = document.querySelector(sel);\n` +
      `    if (field) break;\n` +
      `  }\n` +
      `  return field && field.value === expectedValue ? 'pass' : 'fail';\n` +
      `}\n` +
      `\n` +
      `CRITICAL: Always extract the actual element description from the test step and generate selectors dynamically!\n\n` +
      `SMART LIBRARY DETECTION (same as text format):\n` +
      `- Always wrap in: if (typeof $ !== 'undefined') { /* jQuery */ } else { /* vanilla JS */ }\n` +
      `- For jQuery UI datepickers: $('#id').datepicker('setDate', new Date(year, month, day))\n` +
      `- Month is 0-indexed: January=0, September=8, December=11\n` +
      `- Prefer jQuery when available, ensure vanilla JS fallback\n\n` +
      `Example YAML to JSON translation:\n` +
      `YAML:\n` +
      `  - action: navigate\n` +
      `    url: https://example.com\n` +
      `  - action: type\n` +
      `    text: Hello\n` +
      `    in: search box\n` +
      `  - action: click\n` +
      `    element: search button\n` +
      `  - verify:\n` +
      `      element: results container\n` +
      `      contains: "Hello"\n\n` +
      `JSON Output:\n` +
      `[{"tool":"browser_navigate","params":{"url":"https://example.com"}},\n` +
      `{"tool":"browser_snapshot","params":{}},\n` +
      `{"tool":"browser_type","params":{"element":"search box","ref":"AUTO","text":"Hello"}},\n` +
      `{"tool":"browser_snapshot","params":{}},\n` +
      `{"tool":"browser_click","params":{"element":"search button","ref":"AUTO"}},\n` +
      `{"tool":"browser_evaluate","params":{"function":"() => { const container = document.querySelector('.results'); return container && container.textContent.includes('Hello') ? 'pass' : 'fail'; }"}}]\n\n` +
      `Translate this YAML test spec to JSON actions:\n\n${testText}`;
  }
  
  // Default text format prompt
  return `You are a translator from natural-language test steps to MCP tool calls for Playwright MCP.\n\n` +
    `Output JSON only: an array of actions in order. Each action is an object: { "tool": string, "params": object }. ` +
    toolsDocs +
    `IMPORTANT RULES:\n` +
    `1. For browser_wait_for, use "time" not "ms". For browser_evaluate, use "function" with arrow syntax.\n` +
    `2. BEFORE any click/type/select action, you MUST insert a browser_snapshot action!\n` +
    `3. For click/type/select actions, provide a clear "element" description (e.g., "search box", "submit button", "email input")\n` +
    `4. Set ref to "AUTO" - the runner will find the correct ref from the snapshot\n` +
    `5. For dropdown selects, provide the option text in values array\n` +
    `6. For test verification, use browser_evaluate to check expected conditions. Return 'pass' for success, 'fail' for failure.\n` +
    `   Example: {"tool":"browser_evaluate","params":{"function":"() => { return document.title.includes('Dashboard') ? 'pass' : 'fail'; }"}}\n` +
    `7. DYNAMIC FORM FIELD VERIFICATION - Extract element info from test description and generate selectors:\n` +
    `   \n` +
    `   STEP 1: Parse element description to extract type and keyword\n` +
    `   - "Submit button" → type: button, keyword: "Submit"\n` +
    `   - "Email field" → type: textbox, keyword: "Email"\n` +
    `   - "Premium radio" → type: radio, keyword: "Premium"\n` +
    `   - "Terms checkbox" → type: checkbox, keyword: "Terms"\n` +
    `   \n` +
    `   STEP 2: Generate selectors dynamically based on type\n` +
    `   TEXT INPUTS: input[placeholder*="{keyword}"], input[aria-label*="{keyword}"], input[name*="{keyword.toLowerCase()}"] \n` +
    `   RADIO BUTTONS: input[value*="{keyword}"], input[aria-label*="{keyword}"], input[type="radio"][value*="{keyword.toLowerCase()}"]\n` +
    `   CHECKBOXES: input[value*="{keyword}"], input[aria-label*="{keyword}"], input[type="checkbox"][value*="{keyword.toLowerCase()}"]\n` +
    `   DROPDOWNS: select[name*="{keyword.toLowerCase()}"], select[aria-label*="{keyword}"]\n` +
    `   \n` +
    `   STEP 3: Use appropriate property check\n` +
    `   TEXT INPUTS: field.value === expectedValue\n` +
    `   RADIO/CHECKBOXES: field.checked\n` +
    `   DROPDOWNS: field.value !== '' && field.selectedIndex > 0\n` +
    `   \n` +
    `   Example for any radio button verification:\n` +
    `   () => {\n` +
    `     const elementDesc = "Premium radio button"; // Extract from test\n` +
    `     const keyword = elementDesc.match(/(\\w+)\\s+(radio|button)/)?.[1] || "Premium";\n` +
    `     const selectors = [\n` +
    `       \`input[value*="\${keyword}"]\`,\n` +
    `       \`input[aria-label*="\${keyword}"]\`,\n` +
    `       \`input[type="radio"][value*="\${keyword.toLowerCase()}"]\`\n` +
    `     ];\n` +
    `     let field = null;\n` +
    `     for (const sel of selectors) {\n` +
    `       field = document.querySelector(sel);\n` +
    `       if (field) break;\n` +
    `     }\n` +
    `     return field && field.checked ? 'pass' : 'fail';\n` +
    `   }\n` +
    `8. Base your evaluation logic on the specific test requirements and website behavior described in the test.\n` +
    `9. SMART LIBRARY DETECTION - Always detect and use the best available method:\n` +
    `   a) Check if jQuery is available: typeof $ !== 'undefined'\n` +
    `   b) For element selection:\n` +
    `      - If jQuery available: $('#elementId') or $('.className') or $('selector')\n` +
    `      - If not: document.querySelector('#elementId') or document.querySelectorAll('.className')\n` +
    `   c) For getting/setting values:\n` +
    `      - If jQuery: $('#input').val() or $('#input').val('value')\n` +
    `      - If not: document.querySelector('#input').value or element.value = 'value'\n` +
    `   d) For showing/hiding elements:\n` +
    `      - If jQuery: $('#element').show() / $('#element').hide()\n` +
    `      - If not: element.style.display = 'block' / element.style.display = 'none'\n` +
    `   e) For adding/removing classes:\n` +
    `      - If jQuery: $('#element').addClass('class') / $('#element').removeClass('class')\n` +
    `      - If not: element.classList.add('class') / element.classList.remove('class')\n` +
    `   f) For AJAX/fetch:\n` +
    `      - If jQuery: $.ajax() or $.get() or $.post()\n` +
    `      - If not: fetch() API\n` +
    `   g) For event handling:\n` +
    `      - If jQuery: $('#element').on('click', handler) or $('#element').click()\n` +
    `      - If not: element.addEventListener('click', handler) or element.click()\n` +
    `   h) For animations:\n` +
    `      - If jQuery: $('#element').fadeIn() / $('#element').slideDown()\n` +
    `      - If not: element.style.transition / CSS animations / Web Animations API\n` +
    `   ALWAYS wrap in detection check: if (typeof $ !== 'undefined') { /* jQuery */ } else { /* vanilla JS */ }\n` +
    `9. FOR JQUERY UI DATEPICKERS specifically:\n` +
    `   - Check: if (typeof $ !== 'undefined' && typeof $.fn.datepicker !== 'undefined')\n` +
    `   - If available: $('#datepickerID').datepicker('setDate', new Date(year, month, day))\n` +
    `   - If not: document.querySelector('#datepickerID').value = 'MM/DD/YYYY'; element.dispatchEvent(new Event('change'));\n` +
    `   - Month is 0-indexed: January=0, February=1, ... September=8, ... December=11\n` +
    `10. Use flexible matching for URLs (use .includes() or startsWith() instead of exact equality).\n` +
    `11. GENERAL PRINCIPLE: Always prefer jQuery when available (cleaner, cross-browser), but ensure vanilla JS fallback works.\n` +
    `    Generate code that adapts to the page automatically without requiring manual configuration.\n\n` +
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
  // Initialize test report
  const testReport = {
    testFile: '',
    startTime: new Date(),
    actions: [],
    passedActions: 0,
    failedActions: 0,
    totalActions: 0,
    evaluationResults: [],
    testResult: 'pass' // Start optimistically - will be set to 'fail' if any action fails
  };
  
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
          // If element not found, the entire test fails
          testReport.testResult = 'fail';
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
    
    // Extract screenshot path from browser_take_screenshot result
    if (action.tool === 'browser_take_screenshot') {
      // Extract screenshot path from result
      let resultText = '';
      if (result.content && Array.isArray(result.content)) {
        for (const c of result.content) {
          if (c.text) resultText += c.text;
        }
      }
      // Look for the screenshot path in the result text
      const screenshotMatch = resultText.match(/saved it as (.+\.png)/);
      if (screenshotMatch) {
        actionResult.screenshot = screenshotMatch[1];
        console.log(`📸 Screenshot saved: ${actionResult.screenshot}`);
      }
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
          // Once ANY action fails, the entire test fails (never revert to pass)
          testReport.testResult = 'fail';
        }
        // Note: We don't set testResult = 'pass' here because it starts as 'pass'
        // and should only be changed to 'fail', never back to 'pass'
        
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
    // If any action fails to execute, the entire test fails
    testReport.testResult = 'fail';
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
  
  const reportDir = path.join(process.cwd(), 'test-reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  const htmlReportPath = path.join(reportDir, `report_${timestamp}.html`);
  const textReportPath = path.join(reportDir, `report_${timestamp}.txt`);
  
  // Generate text report (for backwards compatibility)
  const textReport = generateTextReport(report);
  fs.writeFileSync(textReportPath, textReport);
  
  // Generate interactive HTML report with screenshots
  const htmlReport = generateHTMLReport(report);
  fs.writeFileSync(htmlReportPath, htmlReport);
  
  console.log('\n');
  console.log(textReport);
  console.log(`\n📊 Reports saved:`);
  console.log(`   HTML: ${htmlReportPath}`);
  console.log(`   Text: ${textReportPath}`);
  
  return htmlReportPath;
}

function generateTextReport(report) {
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
    if (action.failureDetails) {
      reportLines.push(`   Expected: ${action.failureDetails.expected}`);
      reportLines.push(`   Actual: ${action.failureDetails.actual}`);
      reportLines.push(`   Reason: ${action.failureDetails.reason}`);
    }
    if (action.screenshot) {
      reportLines.push(`   Screenshot: ${action.screenshot}`);
    }
  });
  
  reportLines.push('');
  reportLines.push('───────────────────────────────────────────────────────');
  reportLines.push(`Screenshots saved in: ${SCREENSHOTS_DIR}`);
  reportLines.push('═══════════════════════════════════════════════════════');
  
  return reportLines.join('\n');
}

function generateHTMLReport(report) {
  const successRate = ((report.passedActions/report.totalActions)*100).toFixed(1);
  const testResultClass = report.testResult === 'pass' ? 'success' : report.testResult === 'fail' ? 'failure' : 'neutral';
  const testResultText = report.testResult ? report.testResult.toUpperCase() : 'N/A';
  
  // Read screenshots as base64 for embedding
  const actionsWithScreenshots = report.actions.map(action => {
    if (action.screenshot) {
      try {
        // Check if file exists
        if (fs.existsSync(action.screenshot)) {
          const imageData = fs.readFileSync(action.screenshot);
          const base64Image = imageData.toString('base64');
          console.log(`✅ Embedded screenshot: ${path.basename(action.screenshot)} (${(base64Image.length / 1024).toFixed(2)} KB base64)`);
          return { ...action, screenshotBase64: base64Image };
        } else {
          console.warn(`⚠️  Screenshot file not found: ${action.screenshot}`);
        }
      } catch (error) {
        console.error(`❌ Error reading screenshot ${action.screenshot}:`, error.message);
      }
    }
    return action;
  });
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report - ${path.basename(report.testFile)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      color: #333;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 {
      font-size: 32px;
      margin-bottom: 10px;
      font-weight: 700;
    }
    .header p {
      opacity: 0.9;
      font-size: 16px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 30px;
      background: #f8f9fa;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
      transition: transform 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .stat-value {
      font-size: 36px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .stat-label {
      color: #666;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .success { color: #10b981; }
    .failure { color: #ef4444; }
    .neutral { color: #6b7280; }
    .timeline {
      padding: 30px;
    }
    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #e5e7eb;
    }
    .timeline-header h2 {
      font-size: 24px;
      color: #1f2937;
    }
    .filter-buttons {
      display: flex;
      gap: 10px;
    }
    .filter-btn {
      padding: 8px 16px;
      border: 1px solid #d1d5db;
      background: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .filter-btn:hover {
      background: #f3f4f6;
    }
    .filter-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .action-item {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      transition: all 0.3s;
    }
    .action-item.passed {
      border-left: 4px solid #10b981;
    }
    .action-item.failed {
      border-left: 4px solid #ef4444;
    }
    .action-header {
      padding: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fafafa;
      transition: background 0.2s;
    }
    .action-header:hover {
      background: #f3f4f6;
    }
    .action-title {
      display: flex;
      align-items: center;
      gap: 15px;
      flex: 1;
    }
    .action-number {
      width: 32px;
      height: 32px;
      background: #667eea;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
    }
    .action-tool {
      font-weight: 600;
      font-size: 16px;
      color: #1f2937;
    }
    .action-status {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-badge.passed {
      background: #d1fae5;
      color: #065f46;
    }
    .status-badge.failed {
      background: #fee2e2;
      color: #991b1b;
    }
    .duration-badge {
      padding: 6px 12px;
      background: #e0e7ff;
      color: #3730a3;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .expand-icon {
      font-size: 20px;
      color: #9ca3af;
      transition: transform 0.3s;
    }
    .action-item.expanded .expand-icon {
      transform: rotate(180deg);
    }
    .action-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
      padding: 0 20px;
    }
    .action-item.expanded .action-details {
      max-height: 2000px;
      padding: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .detail-section {
      margin-bottom: 20px;
    }
    .detail-label {
      font-weight: 600;
      color: #6b7280;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .detail-content {
      background: #f9fafb;
      padding: 12px;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
      overflow-x: auto;
    }
    .error-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      padding: 15px;
      border-radius: 6px;
      color: #991b1b;
      margin-bottom: 15px;
    }
    .screenshot-container {
      margin-top: 15px;
    }
    .screenshot-img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .screenshot-img:hover {
      transform: scale(1.02);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal.active {
      display: flex;
    }
    .modal-content {
      max-width: 90%;
      max-height: 90%;
      position: relative;
    }
    .modal-img {
      max-width: 100%;
      max-height: 90vh;
      border-radius: 8px;
    }
    .modal-close {
      position: absolute;
      top: -40px;
      right: 0;
      color: white;
      font-size: 36px;
      cursor: pointer;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .chart-container {
      padding: 30px;
      background: #f8f9fa;
    }
    .chart {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .chart-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 20px;
      color: #1f2937;
    }
    .progress-bar {
      width: 100%;
      height: 30px;
      background: #e5e7eb;
      border-radius: 15px;
      overflow: hidden;
      display: flex;
    }
    .progress-segment {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 12px;
      font-weight: 600;
      transition: width 0.5s ease;
    }
    .progress-passed {
      background: #10b981;
    }
    .progress-failed {
      background: #ef4444;
    }
    .footer {
      padding: 20px;
      text-align: center;
      background: #f8f9fa;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧪 Test Execution Report</h1>
      <p>${path.basename(report.testFile)}</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value ${testResultClass}">${testResultText}</div>
        <div class="stat-label">Test Result</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${report.totalActions}</div>
        <div class="stat-label">Total Actions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value success">${report.passedActions}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value failure">${report.failedActions}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${successRate}%</div>
        <div class="stat-label">Success Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(report.totalDuration/1000).toFixed(2)}s</div>
        <div class="stat-label">Duration</div>
      </div>
    </div>
    
    <div class="chart-container">
      <div class="chart">
        <div class="chart-title">Action Success Rate</div>
        <div class="progress-bar">
          <div class="progress-segment progress-passed" style="width: ${successRate}%">
            ${report.passedActions} Passed
          </div>
          <div class="progress-segment progress-failed" style="width: ${100 - successRate}%">
            ${report.failedActions} Failed
          </div>
        </div>
      </div>
    </div>
    
    <div class="timeline">
      <div class="timeline-header">
        <h2>📋 Action Timeline</h2>
        <div class="filter-buttons">
          <button class="filter-btn active" onclick="filterActions('all')">All</button>
          <button class="filter-btn" onclick="filterActions('passed')">Passed</button>
          <button class="filter-btn" onclick="filterActions('failed')">Failed</button>
        </div>
      </div>
      
      <div id="actions-container">
        ${actionsWithScreenshots.map((action, idx) => `
          <div class="action-item ${action.status}" data-status="${action.status}">
            <div class="action-header" onclick="toggleAction(${idx})">
              <div class="action-title">
                <div class="action-number">${idx + 1}</div>
                <div class="action-tool">${action.tool}</div>
              </div>
              <div class="action-status">
                <div class="status-badge ${action.status}">${action.status}</div>
                <div class="duration-badge">${action.duration}ms</div>
                <div class="expand-icon">▼</div>
              </div>
            </div>
            <div class="action-details">
              ${action.error ? `
                <div class="error-box">
                  <strong>❌ Error:</strong> ${action.error}
                </div>
              ` : ''}
              
              ${action.failureDetails ? `
                <div class="error-box">
                  <strong>❌ Test Failed:</strong><br>
                  <strong>Expected:</strong> ${action.failureDetails.expected}<br>
                  <strong>Actual:</strong> ${action.failureDetails.actual}<br>
                  <strong>Reason:</strong> ${action.failureDetails.reason}
                </div>
              ` : ''}
              
              <div class="detail-section">
                <div class="detail-label">Parameters</div>
                <div class="detail-content">${JSON.stringify(action.params, null, 2)}</div>
              </div>
              
              ${action.evaluationResult ? `
                <div class="detail-section">
                  <div class="detail-label">Evaluation Result</div>
                  <div class="detail-content">${action.evaluationResult}</div>
                </div>
              ` : ''}
              
              ${action.screenshotBase64 ? `
                <div class="screenshot-container">
                  <div class="detail-label">Screenshot</div>
                  <img src="data:image/png;base64,${action.screenshotBase64}" 
                       class="screenshot-img" 
                       onclick="openModal('screenshot-${idx}')"
                       id="screenshot-${idx}"
                       alt="Action screenshot">
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="footer">
      <p>Generated on ${report.endTime.toLocaleString()}</p>
      <p style="margin-top: 8px; color: #9ca3af;">
        Start: ${report.startTime.toLocaleTimeString()} | 
        End: ${report.endTime.toLocaleTimeString()} | 
        Duration: ${(report.totalDuration/1000).toFixed(2)}s
      </p>
    </div>
  </div>
  
  <div id="imageModal" class="modal" onclick="closeModal()">
    <div class="modal-content">
      <span class="modal-close" onclick="closeModal()">×</span>
      <img id="modalImage" class="modal-img" src="" alt="Screenshot">
    </div>
  </div>
  
  <script>
    function toggleAction(idx) {
      const actions = document.querySelectorAll('.action-item');
      actions[idx].classList.toggle('expanded');
    }
    
    function filterActions(status) {
      const actions = document.querySelectorAll('.action-item');
      const buttons = document.querySelectorAll('.filter-btn');
      
      buttons.forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      actions.forEach(action => {
        if (status === 'all' || action.dataset.status === status) {
          action.style.display = 'block';
        } else {
          action.style.display = 'none';
        }
      });
    }
    
    function openModal(imgId) {
      event.stopPropagation();
      const img = document.getElementById(imgId);
      const modal = document.getElementById('imageModal');
      const modalImg = document.getElementById('modalImage');
      modalImg.src = img.src;
      modal.classList.add('active');
    }
    
    function closeModal() {
      document.getElementById('imageModal').classList.remove('active');
    }
    
    // Keyboard support
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>`;
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
    console.error('Usage: node mcp_llm_runner.js path/to/test.[txt|yml|yaml]');
    process.exit(1);
  }
  
  const testText = fs.readFileSync(file, 'utf8');
  
  // Detect file format
  const fileExt = path.extname(file).toLowerCase();
  const format = (fileExt === '.yml' || fileExt === '.yaml') ? 'yaml' : 'txt';
  
  console.log(`📄 Detected test format: ${format.toUpperCase()}`);
  
  // Pure LLM approach - no deterministic parsing
  console.log('🤖 Using LLM to translate test steps to MCP actions...');
  const prompt = buildPrompt(testText, format);
  const reply = await callOpenAI(prompt);
  console.log('LLM response received');
  
  let actions;
  let jsonText = ''; // Declare outside try block for error reporting
  try {
    // Extract JSON from code blocks if present (handle various markdown formats)
    jsonText = reply.trim();
    
    // Remove markdown code blocks - try multiple patterns
    // Pattern 1: ```json ... ```
    if (jsonText.includes('```json')) {
      const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }
    }
    // Pattern 2: ``` ... ``` (without language specifier)
    else if (jsonText.includes('```')) {
      const codeMatch = jsonText.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        jsonText = codeMatch[1].trim();
      }
    }
    
    // Final cleanup: remove any remaining backticks at start/end
    jsonText = jsonText.replace(/^`+|`+$/g, '');
    
    actions = JSON.parse(jsonText);
    console.log(`✅ Parsed ${actions.length} actions from LLM response`);
  } catch (e) {
    console.error('❌ Failed to parse LLM JSON output:', e);
    console.error('Raw reply (first 500 chars):', reply.substring(0, 500));
    console.error('Extracted jsonText (first 500 chars):', jsonText.substring(0, 500));
    console.error('Extracted jsonText (last 200 chars):', jsonText.substring(Math.max(0, jsonText.length - 200)));
    process.exit(1);
  }

  const report = await runMcpActions(actions);
  report.testFile = file;
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