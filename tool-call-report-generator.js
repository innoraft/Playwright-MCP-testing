import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Generates a self-contained HTML test report with embedded screenshots.
 *
 * @param {object} options
 * @param {string} options.suiteName - Name of the test suite
 * @param {string} options.baseUrl - Base URL of the application under test
 * @param {Array<object>} options.results - Array of step results
 * @param {object} options.tokenUsage - Token usage stats
 * @param {number} options.totalDurationMs - Total run duration in ms
 * @param {string} [options.outputDir] - Directory to write the report to (default: "reports")
 * @returns {string} Absolute path to the generated report file
 */
export function generateHtmlReport({
  suiteName,
  baseUrl,
  results,
  tokenUsage,
  totalDurationMs,
  outputDir = "test-reports",
}) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = suiteName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const fileName = `${safeName}-${timestamp}.html`;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filePath = path.join(outputDir, fileName);

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const total = results.length;
  const overallStatus = failed > 0 ? "FAILED" : "PASSED";
  const durationStr = formatDuration(totalDurationMs);

  const stepRows = results
    .map((r) => {
      const statusBadge = getStatusBadge(r.status);
      const screenshots = Array.isArray(r.screenshots)
        ? r.screenshots.filter(Boolean)
        : (r.screenshotBase64 ? [r.screenshotBase64] : []);
      const screenshotHtml = screenshots.length > 0
        ? `<div class="screenshot-container">
             <p class="screenshot-label">📸 Screenshot${screenshots.length > 1 ? 's' : ''}</p>
             ${screenshots
               .map((img, idx) => `<img src="${img}" alt="Screenshot ${idx + 1} for step ${r.stepNumber}" class="screenshot" />`)
               .join('')}
           </div>`
        : "";
      const stepDuration = r.durationMs ? formatDuration(r.durationMs) : "—";

      return `
        <tr class="step-row step-${r.status}">
          <td class="step-num">${r.stepNumber}</td>
          <td class="step-text">${escapeHtml(r.stepText)}</td>
          <td class="step-status">${statusBadge}</td>
          <td class="step-reason">${escapeHtml(r.reason)}</td>
          <td class="step-duration">${stepDuration}</td>
        </tr>
        ${
          screenshotHtml
            ? `<tr class="screenshot-row"><td colspan="5">${screenshotHtml}</td></tr>`
            : ""
        }`;
    })
    .join("\n");

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
  <title>Test Report — ${escapeHtml(suiteName)}</title>
  <style>
    ${css}
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div class="header">
      <h1>
        📊 Test Report
        <span class="overall-badge badge-${overallStatus.toLowerCase()}">${overallStatus}</span>
      </h1>
      <div class="meta-grid">
        <div class="meta-item">🧪 Suite: <span>${escapeHtml(suiteName)}</span></div>
        <div class="meta-item">🔗 URL: <span>${escapeHtml(baseUrl || "N/A")}</span></div>
        <div class="meta-item">🕐 Run: <span>${now.toLocaleString()}</span></div>
        <div class="meta-item">⏱ Duration: <span>${durationStr}</span></div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary">
      <div class="summary-card card-total">
        <span class="count">${total}</span>
        <span class="label">Total Steps</span>
      </div>
      <div class="summary-card card-passed">
        <span class="count">${passed}</span>
        <span class="label">Passed</span>
      </div>
      <div class="summary-card card-failed">
        <span class="count">${failed}</span>
        <span class="label">Failed</span>
      </div>
      <div class="summary-card card-skipped">
        <span class="count">${skipped}</span>
        <span class="label">Skipped</span>
      </div>
    </div>

    <!-- Steps Table -->
    <div class="steps-section">
      <h2>📋 Step-by-Step Results</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Step</th>
            <th>Status</th>
            <th>Details</th>
            <th style="text-align:right">Time</th>
          </tr>
        </thead>
        <tbody>
          ${stepRows}
        </tbody>
      </table>
    </div>

    <!-- Token Usage Footer -->
    <div class="footer">
      <h3>📈 Token Usage</h3>
      <div class="token-grid">
        <div class="token-item">Requests: <span class="value">${tokenUsage.requests ?? 0}</span></div>
        <div class="token-item">Input: <span class="value">${(tokenUsage.inputTokens ?? 0).toLocaleString()}</span></div>
        <div class="token-item">Output: <span class="value">${(tokenUsage.outputTokens ?? 0).toLocaleString()}</span></div>
        <div class="token-item">Total: <span class="value">${(tokenUsage.totalTokens ?? 0).toLocaleString()}</span></div>
      </div>
    </div>

  </div>
</body>
</html>`;

  fs.writeFileSync(filePath, html, "utf8");
  return path.resolve(filePath);
}

// ── Helpers ──

function escapeHtml(str) {
  if (!str) return "";
  return str
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
  const label = labels[status] ?? status.toUpperCase();
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
