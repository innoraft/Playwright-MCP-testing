/**
 * Builds a compact re-plan prompt for when a step fails or navigation
 * changes the page. Includes only the REMAINING steps and the NEW snapshot.
 */
export function buildReplanPrompt(
  remainingStepsText,
  domSnapshot,
  failedStep,
  failError,
  mcpTools,
  remainingCount,
) {
  const toolsInfo = Array.from(mcpTools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
  }));
  toolsInfo.push({
    name: "visual_regression_check",
    description:
      "Compares page screenshot at a viewport breakpoint against a stored baseline.",
    schema: {
      type: "object",
      properties: {
        breakpoint: { type: "string", description: 'e.g. "1280px"' },
        screenshotPath: {
          type: "string",
          description: 'e.g. "files/screenshots/home-1280.png"',
        },
      },
      required: ["breakpoint", "screenshotPath"],
    },
  });

  const failContext = failedStep
    ? `\n## FAILURE CONTEXT\nThe step "${failedStep}" failed with: ${failError}\nYou must re-plan this failed step AND all remaining steps below using the new snapshot.`
    : `\n## CONTEXT\nThe page has changed due to navigation. Re-plan the remaining steps using the new snapshot.`;

  return `You are an intelligent Test Automation Planner. Re-plan the remaining test steps using the updated DOM snapshot.
${failContext}

## AVAILABLE TOOLS
${JSON.stringify(toolsInfo, null, 2)}

## UPDATED DOM SNAPSHOT
\`\`\`
${domSnapshot || "(unavailable)"}
\`\`\`

## REMAINING TEST STEPS
${remainingStepsText}

## PLANNING LOGIC & RULES (MANDATORY)

### 1. Tool Selection Strategy
- **Read the step thoroughly** and extract the context of the step.
- **Analyze the Intent:** For each test step, identify the core verb (action) and the target (noun/data).
- **Semantic Matching:** Compare the step's intent against the **description** field of every available tool.
- **Best Fit:** Select the tool whose description most accurately describes the action required by the step.
- **Strict Adherence:** You must ONLY use tools listed in the "AVAILABLE TOOLS" section. Do not hallucinate tool names.

### 2. CRITICAL — Tool Misuse Prevention
- **browser_snapshot is ONLY for observing the page state.** It is NOT an action tool.
- **NEVER use browser_snapshot for steps that say "click", "type", "select", "scroll", "navigate", "press", "drag", "hover", "choose", "open", "close", "toggle", "submit", "reset", "search", "filter", "switch", "expand", "collapse", or any other interactive verb.**
- If a step says "Click the X button" → use browser_click, NOT browser_snapshot.
- If a step says "Type a keyword" → use browser_type, NOT browser_snapshot.
- If a step says "Select an option" → use browser_select_option or browser_click, NOT browser_snapshot.
- If a step says "Click a dropdown" → use browser_click, NOT browser_snapshot.
- **Every action step MUST use an action tool** (browser_click, browser_type, browser_select_option, browser_navigate, browser_press_key, browser_hover, browser_drag, browser_handle_dialog, browser_tab_close, browser_tab_new, browser_file_upload, browser_run_code, etc.)
- For alert/confirm/prompt dialogs, use browser_handle_dialog, NOT browser_run_code.

### 3. Parameter Generation (Schema Compliance)
- **Schema Mapping:** Generate parameters that strictly adhere to the selected tool's \`schema\`.
- **Data Extraction:** Extract values (selectors, text, refs, numbers) directly from the test step and the DOM snapshot.
- **Use refs from the snapshot** (e.g. ref="eXX") for element interactions — do NOT use CSS selectors or IDs as refs.
- **Type Safety:** Ensure boolean, integer, and string types match the schema definitions exactly.

### 4. Step Classification
- **Action:** If the step implies interaction (click, type, navigate, scroll, select, etc.), set \`isAssertion: false\`.
- **Assertion:** If the step implies verification (verify, check, ensure, validate, confirm visibility, etc.), set \`isAssertion: true\`.

### 5. Code Generation (If Applicable)
- If a tool requires a code/script parameter:
  - Generate self-contained, synchronous code.
  - NEVER invoke the function (no trailing \`()\`).
  - Valid: \`"() => { return true; }"\`
  - Invalid: \`"(() => { return true; })()"\`

## OUTPUT
Return EXACTLY ${remainingCount} entries as a SINGLE VALID JSON ARRAY. No markdown, no explanation.
Each entry MUST use the stepIndex value shown in parentheses in REMAINING TEST STEPS above — do NOT change or reorder stepIndex values.
[{"stepIndex":<n>,"tool":"<NAME>","params":{...},"isAssertion":<bool>,"description":"<why>"}]`;
}
