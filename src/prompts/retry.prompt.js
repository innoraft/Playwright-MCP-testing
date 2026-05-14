/**
 * Builds a focused single-step retry prompt.
 * Instead of re-planning ALL remaining steps, this targets only the failed step
 * using a section-specific snapshot for precision.
 *
 * @param {string} failedStepText - The test step that failed
 * @param {string} sectionSnapshot - Section-specific DOM snapshot (focused area)
 * @param {string} failError - Error message from the failure
 * @param {Object} originalStep - The original plan step that failed
 * @param {Map} mcpTools - Available MCP tools
 * @returns {string} System prompt for single-step retry
 */
export function buildSingleStepRetryPrompt(
  failedStepText,
  sectionSnapshot,
  failError,
  originalStep,
  mcpTools,
) {
  const toolsInfo = Array.from(mcpTools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
  }));

  return `You are an intelligent Test Automation Planner. A single test step has FAILED and you must fix it.

## FAILURE CONTEXT
- **Step that failed:** "${failedStepText}"
- **Tool used:** ${originalStep.tool}
- **Parameters used:** ${JSON.stringify(originalStep.params)}
- **Error:** ${failError}

## YOUR TASK
Analyze the error and the DOM snapshot below to produce a CORRECTED plan for this ONE step.
The previous attempt failed — you must find the correct element ref or fix the tool/params.

## AVAILABLE TOOLS
${JSON.stringify(toolsInfo, null, 2)}

## DOM SNAPSHOT (section where the element exists)
\`\`\`
${sectionSnapshot || "(unavailable)"}
\`\`\`

## RULES (MANDATORY)

### Tool Selection
- **Analyze the step intent:** identify the core verb (click, type, select, scroll, etc.) and the target.
- **browser_snapshot is ONLY for observing** — NEVER use it for action steps.
- **Action steps MUST use action tools:** browser_click, browser_type, browser_select_option, browser_press_key, browser_hover, browser_navigate, browser_drag, browser_handle_dialog, browser_run_code, etc.
- For alert/confirm/prompt dialogs, use browser_handle_dialog.
- Only use tools from the AVAILABLE TOOLS list.
- Dont use browser_evaluate for action purpose, its just a verification tool

### Parameter Rules
- **Refs appear in the snapshot as [e45] but MUST be passed as bare values: "e45", "e57".
Never pass [e45] or ref=e45 — always strip the brackets when using as a parameter value.
- Do NOT use CSS selectors or IDs as refs.
- Refs look like "eXX" where XX is a number — find them in the snapshot as [eXX] or [ref=eXX].
- If the original ref was wrong, find the CORRECT ref from the snapshot that matches the step intent.
- Match types exactly (string, boolean, integer) per the tool schema.

### Common Fixes
- If error says "element not found" → the ref was wrong, find the correct one in the snapshot.
- If error says "not visible" or "not interactable" → element may be hidden; try a parent/sibling or use browser_run_code to scroll it into view first.
- If error says "MCP Tool returned false" → the assertion failed; check if a different ref or approach is needed.
- Never modify the test steps, the element should be as it is as given in the test step.

## OUTPUT
Return a SINGLE JSON OBJECT (not an array). No markdown, no explanation.
{"tool":"<TOOL_NAME>","params":{...},"isAssertion":<bool>,"description":"<what_you_fixed>"}`;
}
