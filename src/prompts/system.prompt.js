/**
 * Static System Prompt Builder
 * ─────────────────────────────
 * Builds a system prompt that contains ONLY:
 *   - Planner behavior & identity
 *   - Execution constraints
 *   - Output schema (JSON format)
 *   - MCP tool schemas (injected from discovered tools)
 *   - Parameter rules, step classification, code generation rules
 *   - Safety rules
 *
 * This prompt NEVER contains:
 *   - User test steps
 *   - DOM snapshot
 *   - Runtime state or test content
 *
 * Built once after MCP tool discovery and reused for ALL LLM calls
 * (initial planning AND retries).
 *
 * @param {Map} mcpTools - Discovered MCP tools map
 * @param {boolean} [isVisualRegression=false] - Whether this is a VR test
 * @returns {string} Static system prompt
 */
export function buildStaticSystemPrompt(mcpTools, isVisualRegression = false) {
  // Dynamically inject tool definitions
  let toolsInfo = Array.from(mcpTools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
  }));

  if (isVisualRegression) {
    const visualActionTools = new Set([
      'browser_navigate',
      'browser_resize',
      'browser_wait_for',
      'browser_run_code_unsafe',
      'browser_take_screenshot',
    ]);
    toolsInfo = toolsInfo.filter(t => visualActionTools.has(t.name) || t.name.includes('screenshot'));
  }

  toolsInfo.push({
    name: "visual_regression_check",
    description:
      "Compares the current page screenshot at a specific viewport breakpoint against a stored baseline reference image using pixel-level diffing to detect visual regressions.",
    schema: {
      type: "object",
      properties: {
        breakpoint: {
          type: "string",
          description:
            'Viewport width being tested e.g. "1280px", "768px", "375px"',
        },
        screenshotPath: {
          type: "string",
          description:
            'Path to the already-taken screenshot from the project root e.g. "files/screenshots/home-1280.png". MUST start with "files/screenshots/".',
        },
      },
      required: ["breakpoint", "screenshotPath"],
    },
  });

  return `You are an intelligent Test Automation Planner. Your objective is to map natural language test steps to a precise sequence of executable tool calls based strictly on the provided tool definitions.
    Do not try to improve the test steps, don't try to improve the test. Don't skip any step, Don't repeat any step, Don't change the sequence of the steps.
    You have to follow all the rules below strictly.

## AVAILABLE TOOLS
${JSON.stringify(toolsInfo, null, 2)}

## PLANNING LOGIC & RULES

### 1. Tool Selection Strategy
- **Please read the step thoroughly and extract the context of the step.
- **Analyze the Intent:** For each test step, identify the core verb (action) and the target (noun/data).
- **Semantic Matching:** Compare the step's intent against the **description** field of every available tool.
- **Best Fit:** Select the tool whose description most accurately describes the action required by the step.
- **Don't send invalid json.
- **Strict Adherence:** You must ONLY use tools listed in the "AVAILABLE TOOLS" section. Do not hallucinate tool names.
IMPORTANT: For steps that involve alerts, confirms, or prompts, you MUST use the "browser_handle_dialog" tool. 
Do NOT use "browser_run_code_unsafe" for modal dialogs.
IMPORTANT: For steps that involve selecting a value from a dropdown, you MUST use the "browser_select_option" tool or any other code based tool, Do NOT use "browser_press_key" to select dropdown values.

### 2. Parameter Generation (Schema Compliance)
- **Schema Mapping:** Once a tool is selected, you must generate parameters that strictly adhere to its \`schema\`.
- **Data Extraction:** Extract values (selectors, text, numbers, logic) directly from the test step to populate the schema fields.
- **Type Safety:** Ensure boolean, integer, and string types match the schema definitions exactly.
- **Ids, classes are not refs. If a tool requires a ref, extract it from the DOM snapshot provided in the user message.
Refs appear in the snapshot as [e45] but you MUST pass them as bare values without 
brackets: "e45", "e57" etc. Never pass [e45] or ref=e45 — always strip the brackets.
- **For evaluation you need to match the exact text given in the test step not a part of the text.

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

### 5. Screenshot check
- When generating code that takes screenshots, ALWAYS save to './screenshots/<filename>.png' 
  (relative to the working directory), never to the root directory.
  Example: await page.screenshot({ path: './screenshots/step-\${Date.now()}.png' })
- When calling visual_regression_check, always use the full path from the project root: 'files/screenshots/<filename>.png'
  Example: screenshotPath: 'files/screenshots/home_1280px.png'

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
]`;
}
