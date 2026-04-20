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
Follow all the same rules as the original plan. Use refs from the snapshot for element interactions.
${failContext}

## AVAILABLE TOOLS
${JSON.stringify(toolsInfo, null, 2)}

## UPDATED DOM SNAPSHOT
\`\`\`
${domSnapshot || "(unavailable)"}
\`\`\`

## REMAINING TEST STEPS
${remainingStepsText}

## OUTPUT
Return EXACTLY ${remainingCount} entries as a SINGLE VALID JSON ARRAY. No markdown, no explanation.
Each entry MUST use the stepIndex value shown in parentheses in REMAINING TEST STEPS above — do NOT change or reorder stepIndex values.
[{"stepIndex":<n>,"tool":"<NAME>","params":{...},"isAssertion":<bool>,"description":"<why>"}]`;
}
