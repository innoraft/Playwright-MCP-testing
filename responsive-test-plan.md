Plan: Responsiveness (overlap) check inside Visual Regression
Extend the existing Visual Regression runner, in the UI implement a new tab for responsive-test so breakpoint screenshots are also reviewed by a vision-capable LLM for overlapping/clipped/overflowing content, with a fixed animation-settle wait before each capture to handle animated/scrolling sections.

Steps

Phase A — Prompt/tool plumbing

system.prompt.js: in the isVisualRegression tool-injection branch, add two fake tools alongside the existing visual_regression_check: wait_for_animations (no params) and responsiveness_check (breakpoint, screenshotPath, scrollLabel).
New src/prompts/responsiveness-check.prompt.js: vision prompt instructing the model to flag overlap/clipping/overflow, with a strict JSON contract { passed, issues: [{type, description}] }.
Add a fixed, runner-authored JS snippet ANIMATION_SETTLE_SCRIPT (polls document.getAnimations({subtree:true}) until idle or a fixed max wait, e.g. 3000ms) — the runner sends this directly to browser_run_code_unsafe, never letting the LLM author the code.
Phase B — ai_visual_runner.js runtime (depends on A)
4. Add getResponsivenessScreenshotFilename(testName, breakpoint, scrollLabel).
5. In the plan dispatch loop in runTest(): intercept wait_for_animations → directly call browser_run_code_unsafe with the fixed script (new executeWaitForAnimationsStep); intercept responsiveness_check → new executeResponsivenessCheckStep that reads the screenshot, sends it + prompt to generateText (multimodal message with image block), parses {passed, issues}, and records a report action (issues joined into the existing error field — no report-generator changes needed). Track scroll-step index internally (not regex-parsed from step text) for reliable filenames.

Phase C — Form (parallel with A/B)
6. VisualRegressionForm.jsx: add enableResponsivenessCheck checkbox and optional preSteps textarea (for login/cookie-banner steps executed once before the breakpoint loop). Update buildYAML() to inject pre-steps after Navigate to {url}, and — when enabled — replace each Wait for 2 seconds in the scroll sequence with wait_for_animations + per-scroll screenshot + responsiveness_check steps. Pixel-diff baseline check stays unconditional/independent.

Phase D — Verify report rendering (depends on B)
7. Confirm test-report-generator.js already renders arbitrary tool/error/screenshot fields generically (likely yes, same as visual_regression_check today) — no changes expected.

Relevant files

VisualRegressionForm.jsx — checkbox, pre-steps textarea, buildYAML() changes
system.prompt.js (~L41-70) — new fake tool defs
src/prompts/responsiveness-check.prompt.js (new) — vision prompt/contract
ai_visual_runner.js (~L30, ~L370-420, ~L495-560) — new consts/methods + dispatch interception
test-report-generator.js — verify only, likely untouched
visual-regression.js — untouched
Verification

Existing visual-regression test with the checkbox off → identical behavior/report (regression safety).
Enable responsiveness check against a known-good responsive page at 3 breakpoints → all responsiveness_check actions pass.
Point at a page with an intentionally broken/overlapping layout → at least one responsiveness_check fails with a descriptive reason in the HTML report.
Page with zero running animations → wait_for_animations returns immediately, doesn't stall to the max timeout.
Non-vision LLM configured → responsiveness_check fails gracefully with a clear error, not a crash.
Decisions

No new test type/tab/runner/route — rides entirely on the existing visual-regression pipeline.
Overlap detection = LLM vision review only (no DOM/getBoundingClientRect heuristic).
Animation wait timeout fixed in code, not user-configurable.
Pixel-diff baseline check remains independent/unconditional; responsiveness check is purely additive.

Further considerations

The admin-configured LLM must support image input (e.g. GPT-4o/4.1, Gemini, Claude vision) — recommend noting this in the checkbox hint text.
Derive scrollLabel from the runner's own known scroll sequence (20/40/60/75/footer/header) rather than parsing free-text step strings, for robustness.
Let me know if you'd like changes, or you can proceed to implementation.