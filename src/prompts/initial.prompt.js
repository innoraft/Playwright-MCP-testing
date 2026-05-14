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
export function buildSystemPrompt(testText, stepCount, domSnapshot, mcpTools, isVisualRegression = false) {
  // Dynamically inject tool definitions
  let toolsInfo = Array.from(mcpTools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
  }));

  if (isVisualRegression) {
    toolsInfo = toolsInfo.filter(t => t.name === 'browser_run_code_unsafe' || t.name.includes('screenshot'));
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

  // Include DOM snapshot so the LLM can generate ref-based params
  const snapshotBlock = domSnapshot
    ? `\n3. **CURRENT PAGE DOM SNAPSHOT (use refs like [e45] or [ref=e45] from this):**\n\`\`\`\n${domSnapshot}\n\`\`\``
    : "";

  return `You are an intelligent Test Automation Planner. Your objective is to map natural language test steps to a precise sequence of executable tool calls based strictly on the provided tool definitions.
    Do not try to improve the test steps, don't try to imporve the test. Don't skip any step, Don't repeat any step, Dont change the sequence of the steps.
    Generate EXACTLY ${stepCount} entries in the JSON array — one entry per test step, in the exact order they appear. No extra entries, no merged entries, no skipped entries.
    You have to follow all the rules below strictly.

## INPUT CONTEXT
1. **AVAILABLE TOOLS:**
${JSON.stringify(toolsInfo, null, 2)}

2. **TEST STEPS:**
${testText}${snapshotBlock}

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
- **Ids, classes are not refs. If a tool requires a ref, extract it from the snapshot.
Refs appear in the snapshot as [e45] but you MUST pass them as bare values without 
brackets: "e45", "e57" etc. Never pass [e45] or ref=e45 — always strip the brackets.

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
  Example: await page.screenshot({ path: './screenshots/step-${Date.now()}.png' })
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
]

    Analyze the ${stepCount} steps and generate the execution plan now.`;
}
