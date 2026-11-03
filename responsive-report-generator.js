import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "url";

const ISSUE_LABELS = {
  overlap: "Overlap",
  clipping: "Clipping",
  overflow: "Overflow",
  other: "Other",
};

/**
 * Generates a self-contained HTML report for a Responsive Check run, grouped
 * by breakpoint with one capture card per page section.
 *
 * @param {object} options
 * @param {string} options.suiteName
 * @param {string} options.baseUrl
 * @param {Array<object>} [options.setupSteps] - One-time pre-steps run before the breakpoint loop
 * @param {Array<object>} options.breakpoints - { label, width, height, status, reason, durationMs, captures: [] }
 * @param {number} options.totalDurationMs
 * @param {string} [options.outputDir]
 * @param {string} [options.runBy]
 * @returns {string} Absolute path to the generated report file
 */
export function generateResponsiveHtmlReport({
  suiteName,
  baseUrl,
  setupSteps = [],
  breakpoints = [],
  totalDurationMs,
  outputDir = "test-reports",
  runBy,
}) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = (suiteName || "responsive_suite").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const fileName = `${safeName}-responsive-${timestamp}-${randomUUID()}.html`;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, fileName);

  const allCaptures = breakpoints.flatMap((bp) => bp.captures || []);
  const totalChecks = allCaptures.length;
  const passedChecks = allCaptures.filter((c) => c.status === "passed").length;
  const failedChecks = allCaptures.filter((c) => c.status === "failed").length;
  const failedSetup = setupSteps.filter((s) => s.status === "failed").length;
  const failedResizes = breakpoints.filter((bp) => bp.status === "failed").length;

  const issueCounts = {};
  for (const capture of allCaptures) {
    for (const issue of capture.issues || []) {
      issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
    }
  }

  const overallStatus = failedChecks > 0 || failedSetup > 0 || failedResizes > 0 ? "FAILED" : "PASSED";
  const durationStr = formatDuration(totalDurationMs);

  const setupSection = setupSteps.length > 0
    ? `
    <div class="steps-section">
      <h2>🔧 Setup Steps</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Step</th><th>Status</th><th>Details</th></tr>
        </thead>
        <tbody>
          ${setupSteps.map((s) => `
          <tr class="step-row step-${s.status}">
            <td class="step-num">${s.stepNumber}</td>
            <td class="step-text">${escapeHtml(s.stepText)}</td>
            <td class="step-status">${getStatusBadge(s.status)}</td>
            <td class="step-reason">${escapeHtml(s.reason)}</td>
          </tr>
          ${s.screenshotBase64 ? `<tr class="screenshot-row"><td colspan="4"><div class="screenshot-container"><img src="${s.screenshotBase64}" class="screenshot" alt="Setup step ${s.stepNumber} screenshot" /></div></td></tr>` : ""}
          `).join("\n")}
        </tbody>
      </table>
    </div>`
    : "";

  const breakpointSections = breakpoints.map((bp) => {
    const bpChecks = bp.captures || [];
    const bpPassed = bpChecks.filter((c) => c.status === "passed").length;
    const bpFailed = bpChecks.filter((c) => c.status === "failed").length;
    const bpStatus = bp.status === "failed" || bpFailed > 0 ? "failed" : "passed";

    const resizeError = bp.status === "failed"
      ? `<p class="bp-resize-error">⚠️ Could not resize viewport: ${escapeHtml(bp.reason)}</p>`
      : "";

    const captureCards = bpChecks.map((c) => `
      <div class="capture-card capture-${c.status}">
        <div class="capture-image-wrap">
          ${c.screenshotBase64 ? `<img src="${c.screenshotBase64}" alt="${escapeHtml(c.scrollLabel)} screenshot" class="capture-image" />` : `<div class="capture-image-missing">No screenshot</div>`}
        </div>
        <div class="capture-meta">
          <span class="capture-scroll-label">${escapeHtml(c.scrollLabel)}</span>
          ${getStatusBadge(c.status)}
        </div>
        ${c.issues && c.issues.length > 0 ? `
        <ul class="issue-list">
          ${c.issues.map((i) => `<li><span class="issue-badge issue-${i.type}">${ISSUE_LABELS[i.type] || i.type}</span> ${escapeHtml(i.description)}</li>`).join("\n")}
        </ul>` : (c.status === "failed" && c.reason ? `<p class="capture-reason">${escapeHtml(c.reason)}</p>` : "")}
      </div>`).join("\n");

    return `
    <div class="breakpoint-card">
      <div class="breakpoint-header">
        <h3>📐 ${escapeHtml(bp.label)} <span class="bp-dims">${bp.width}×${bp.height}</span></h3>
        <div class="breakpoint-header-right">
          <span class="bp-count">${bpPassed}/${bpChecks.length} passed</span>
          ${getStatusBadge(bpStatus)}
        </div>
      </div>
      ${resizeError}
      ${bpChecks.length > 0 ? `<div class="capture-grid">${captureCards}</div>` : ""}
    </div>`;
  }).join("\n");

  let css = "";
  const cssCandidates = [
    path.join(__dirname, "tool-report.css"),
    path.join(__dirname, "report-generator.css"),
  ];
  const cssPath = cssCandidates.find((candidate) => fs.existsSync(candidate));
  if (cssPath) {
    css = fs.readFileSync(cssPath, "utf-8");
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Responsive Check Report — ${escapeHtml(suiteName)}</title>
  <style>
    ${css}
    ${RESPONSIVE_REPORT_EXTRA_CSS}
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div class="header">
      <h1>
        📱 Responsive Check Report
        <span class="overall-badge badge-${overallStatus.toLowerCase()}">${overallStatus}</span>
      </h1>
      <div class="meta-grid">
        <div class="meta-item">🧪 Suite: <span>${escapeHtml(suiteName)}</span></div>
        <div class="meta-item">🔗 URL: <span>${escapeHtml(baseUrl || "N/A")}</span></div>
        <div class="meta-item">🕐 Run: <span>${now.toLocaleString()}</span></div>
        <div class="meta-item">⏱ Duration: <span>${durationStr}</span></div>
        <div class="meta-item">👤 Run by: <span>${escapeHtml(runBy || "N/A")}</span></div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary">
      <div class="summary-card card-total">
        <span class="count">${breakpoints.length}</span>
        <span class="label">Breakpoints</span>
      </div>
      <div class="summary-card card-total">
        <span class="count">${totalChecks}</span>
        <span class="label">Total Checks</span>
      </div>
      <div class="summary-card card-passed">
        <span class="count">${passedChecks}</span>
        <span class="label">Passed</span>
      </div>
      <div class="summary-card card-failed">
        <span class="count">${failedChecks}</span>
        <span class="label">Failed</span>
      </div>
    </div>

    ${Object.keys(issueCounts).length > 0 ? `
    <div class="issue-summary">
      <h2>🔎 Issues Found</h2>
      <div class="issue-summary-badges">
        ${Object.entries(issueCounts).map(([type, count]) => `<span class="issue-badge issue-${type}">${ISSUE_LABELS[type] || type}: ${count}</span>`).join("\n")}
      </div>
    </div>` : ""}

    ${setupSection}

    <div class="steps-section">
      <h2>📐 Breakpoint Results</h2>
      ${breakpointSections}
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(filePath, html, "utf8");
  return path.resolve(filePath);
}

const RESPONSIVE_REPORT_EXTRA_CSS = `
.issue-summary { margin-bottom: 1.5rem; }
.issue-summary h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #0f172a; }
.issue-summary-badges { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.issue-badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  white-space: nowrap;
}
.issue-overlap { background: #fee2e2; color: #991b1b; }
.issue-clipping { background: #ffedd5; color: #9a3412; }
.issue-overflow { background: #fef9c3; color: #854d0e; }
.issue-other { background: #e5e7eb; color: #374151; }

.breakpoint-card {
  background: #ffffff;
  border: 1px solid #d7dee9;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.25rem;
}
.breakpoint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.breakpoint-header h3 { font-size: 1.05rem; color: #0f172a; display: flex; align-items: center; gap: 0.5rem; }
.bp-dims { font-size: 0.8rem; font-weight: 400; color: #6b7280; }
.breakpoint-header-right { display: flex; align-items: center; gap: 0.75rem; }
.bp-count { font-size: 0.85rem; color: #6b7280; }
.bp-resize-error { color: #991b1b; font-size: 0.9rem; margin-bottom: 0.75rem; }

.capture-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
}
.capture-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: #f9fafb;
}
.capture-card.capture-failed { border-color: #fca5a5; }
.capture-image-wrap { background: #fff; border-bottom: 1px solid #e5e7eb; }
.capture-image { width: 100%; display: block; }
.capture-image-missing {
  padding: 2rem 0;
  text-align: center;
  color: #9ca3af;
  font-size: 0.85rem;
}
.capture-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
}
.capture-scroll-label { font-size: 0.85rem; font-weight: 600; color: #1f2937; }
.issue-list { list-style: none; padding: 0 0.75rem 0.75rem; font-size: 0.8rem; color: #374151; }
.issue-list li { margin-top: 0.4rem; }
.capture-reason { padding: 0 0.75rem 0.75rem; font-size: 0.8rem; color: #991b1b; }
`;

// ── Helpers ──

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getStatusBadge(status) {
  const icons = { passed: "✅", failed: "❌", skipped: "⏭" };
  const labels = { passed: "PASS", failed: "FAIL", skipped: "SKIP" };
  const icon = icons[status] ?? "❓";
  const label = labels[status] ?? String(status).toUpperCase();
  return `<span class="status-badge status-${status}">${icon} ${label}</span>`;
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${seconds}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}
