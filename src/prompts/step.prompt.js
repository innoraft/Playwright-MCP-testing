/**
 * User Message Builders
 * ──────────────────────
 * Builds the USER message for LLM calls. This is where all runtime
 * data lives — test steps, DOM snapshot, failure context.
 *
 * The system prompt (from system.prompt.js) stays static and is
 * reused across all calls. Only the user message changes.
 */

/**
 * Builds the user message for the initial one-shot planning call.
 *
 * Contains:
 *   - Full test text (all steps)
 *   - Step count
 *   - Compressed DOM snapshot (when available, omitted for VR tests)
 *
 * @param {Object} opts
 * @param {string} opts.testText - Full raw test YAML content
 * @param {number} opts.stepCount - Total number of test steps
 * @param {string|null} opts.compressedSnapshot - Compressed DOM snapshot, null for VR
 * @returns {string} User message for the planning LLM call
 */
export function buildPlanningUserMessage({ testText, stepCount, compressedSnapshot }) {
  const snapshotBlock = compressedSnapshot
    ? `\n## CURRENT PAGE DOM SNAPSHOT\nUse refs like [e45] or [ref=e45] from this snapshot to generate ref-based params.\n\`\`\`\n${compressedSnapshot}\n\`\`\``
    : '';

  return `## TEST STEPS
${testText}
${snapshotBlock}

Generate EXACTLY ${stepCount} entries in the JSON array — one entry per test step, in the exact order they appear. No extra entries, no merged entries, no skipped entries.

Analyze the ${stepCount} steps and generate the execution plan now.`;
}

/**
 * Builds the user message for re-planning all remaining steps after a failure.
 *
 * Only sends the remaining steps + fresh snapshot + failure context.
 * The system prompt already has all rules — no need to repeat them here.
 *
 * @param {Object} opts
 * @param {string} opts.failedStepText - The test step that just failed
 * @param {string} opts.errorMessage - Error from the failed execution
 * @param {Object} opts.failedPlanStep - The original plan step {tool, params} that failed
 * @param {Array<string>} opts.remainingSteps - Steps still to execute (includes the failed one)
 * @param {string} opts.compressedSnapshot - Fresh full compressed DOM snapshot
 * @returns {string} User message for the re-plan LLM call
 */
export function buildReplanUserMessage({
  failedStepText,
  errorMessage,
  failedPlanStep,
  remainingSteps,
  compressedSnapshot,
}) {
  const remainingBlock = remainingSteps
    .map((s, i) => `${i + 1}. ${s.trim()}`)
    .join('\n');

  return `## FAILURE CONTEXT
- **Step that failed:** "${failedStepText}"
- **Tool used:** ${failedPlanStep.tool}
- **Parameters used:** ${JSON.stringify(failedPlanStep.params)}
- **Error:** ${errorMessage}

## STEPS TO PLAN (${remainingSteps.length} steps)
${remainingBlock}

## CURRENT PAGE DOM SNAPSHOT (fresh)
\`\`\`
${compressedSnapshot || '(unavailable)'}
\`\`\`

## YOUR TASK
The step above failed. The page DOM may have changed since the original plan.
Using the FRESH snapshot above, generate a NEW execution plan for ALL ${remainingSteps.length} remaining steps listed above.

## RULES
- Generate EXACTLY ${remainingSteps.length} entries in the JSON array — one per remaining step, in order.
- **browser_snapshot is ONLY for observing** — NEVER use it for action steps.
- **For verification or assertion purposes, use browser_evaluate.**
- **Action steps MUST use action tools:** browser_click, browser_type, browser_select_option, browser_press_key, browser_hover, browser_navigate, browser_drag, browser_handle_dialog, browser_run_code, etc.
- For alert/confirm/prompt dialogs, use browser_handle_dialog.
- Don't use browser_evaluate for action purposes, it's just a verification tool.
- **Refs appear in the snapshot as [e45] but MUST be passed as bare values: "e45", "e57".**
  Never pass [e45] or ref=e45 — always strip the brackets.
- Do NOT use CSS selectors or IDs as refs.
- Find the CORRECT refs from the fresh snapshot — old refs may be stale.
- Never modify the test steps, the element should be as it is as given in the test step.
- Do not try to improve the test. Do not invent any ref if not present.
- For evaluation you need to match the exact text given in the test step.


### Common Fixes
- If error says "element not found" → the ref was wrong, find the correct one in the snapshot.
- If error says "not visible" or "not interactable" → element may be hidden; try a parent/sibling or use browser_run_code to scroll it into view first.
- If error says "MCP Tool returned false" → the assertion failed; check if a different ref or approach is needed.

## OUTPUT
Return a JSON ARRAY with EXACTLY ${remainingSteps.length} entries. No markdown, no explanation.
Each entry: {"stepIndex":<N>,"tool":"<TOOL_NAME>","params":{...},"isAssertion":<bool>,"description":"<step_description>"}`;
}
