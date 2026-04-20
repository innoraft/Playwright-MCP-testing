/**
 * Test Report Generator
 * Handles creation of HTML test reports for autonomous LLM-MCP tests
 * 
 * Features:
 * - HTML reports with embedded screenshots
 * - Responsive design with modal image viewing
 * - Detailed test metrics and action tracking
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class TestReportGenerator {
  /**
   * Creates an instance of TestReportGenerator.
   * @param {Object} config - Configuration object
   * @param {Object} config.reporting - Reporting configuration
   * @param {string} config.reporting.outputDir - Directory for generated HTML reports
   * @param {string} config.reporting.screenshotsDir - Directory for screenshots
   */
  constructor(config) {
    this.config = config || {
      reporting: {
        outputDir: 'test-reports',
        screenshotsDir: 'files/screenshots'
      }
    };
    this.screenshotCounter = 0;
  }

  /**
   * Generates a complete test report with HTML output and embedded media.
   * @param {Object} testReport - The test report data containing actions and results
   * @param {number} testReport.startTime - Test start timestamp
   * @param {Array} testReport.actions - Array of action objects with results
   * @param {number} testReport.passedActions - Number of passed actions
   * @param {number} testReport.failedActions - Number of failed actions
   * @param {number} testReport.totalActions - Total number of actions
   * 
   * @returns {Object} Object containing htmlReport path and updated testReport
   */
  generateReport(testReport) {
    testReport.endTime = new Date();
    testReport.duration = testReport.endTime - testReport.startTime;
    testReport.testResult = testReport.failedActions === 0 ? 'pass' : 'fail';

    const timestamp = Date.now();
    const htmlReportFile = path.join(
      this.config.reporting.outputDir,
      `autonomous_mcp_report_${timestamp}.html`
    );

    this.ensureDirectories();

    const htmlReport = this.generateHTMLReport(testReport);
    fs.writeFileSync(htmlReportFile, htmlReport);
    this.logReportGeneration(testReport, htmlReportFile);

    return { htmlReport: htmlReportFile, testReport };
  }

  /**
   * Ensures all required directories exist, creating them if necessary.
   * Creates output and screenshots directories.
   */
  ensureDirectories() {
    fs.mkdirSync(this.config.reporting.outputDir, { recursive: true });
    fs.mkdirSync(this.config.reporting.screenshotsDir, { recursive: true });
  }

  /**
   * Logs a summary of the generated test report to the console.
   * @param {Object} testReport - The test report data
   * @param {string} htmlReportFile - Path to the generated HTML report file
   */
  logReportGeneration(testReport, htmlReportFile) {
    console.log('\n📊 Test Report Generated:');
    console.log(`🌐 HTML Report: ${htmlReportFile}`);
    console.log(`⏱️  Duration: ${testReport.duration}ms`);
    console.log(`✅ Passed: ${testReport.passedActions}`);
    console.log(`❌ Failed: ${testReport.failedActions}`);
    console.log(`📈 Success Rate: ${((testReport.passedActions / testReport.totalActions) * 100).toFixed(1)}%`);
  }

  /**
   * Embeds any image as base64 data URI by its absolute or relative path.
   * Works for screenshots, baselines, and diffs from any directory.
   * @param {string} imagePath - Absolute or relative path to the image file
   * 
   * @returns {string|null} Base64 data URI string or null if image not found/error
   */
  embedImageFromPath(imagePath) {
    if (!imagePath) return null;

    // Resolve relative paths from cwd
    const resolvedPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(process.cwd(), imagePath);

    if (!fs.existsSync(resolvedPath)) {
      console.warn(`⚠️  Image not found: ${resolvedPath}`);
      return null;
    }

    try {
      const imageData = fs.readFileSync(resolvedPath);
      const base64 = imageData.toString('base64');
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      return `data:${mimeType};base64,${base64}`;
    } catch (err) {
      console.error(`❌ Error embedding image ${resolvedPath}: ${err.message}`);
      return null;
    }
  }

  /**
   * Embeds a screenshot from the configured screenshots directory as a base64 data URI.
   * @param {string} filename - Name of the screenshot file
   * 
   * @returns {string|null} Base64 data URI string or null if file not found/error
   */
  embedScreenshot(filename) {
    const screenshotPath = path.join(this.config.reporting.screenshotsDir, filename);
    return this.embedImageFromPath(screenshotPath);
  }

  /**
   * Finds all screenshot files in the configured screenshots directory.
   * 
   * @returns {Array<string>} Array of screenshot filenames
   */
  findScreenshots() {
    if (!fs.existsSync(this.config.reporting.screenshotsDir)) return [];
    return fs.readdirSync(this.config.reporting.screenshotsDir)
      .filter(f => f.match(/\.(png|jpg|jpeg)$/i));
  }

  /**
   * Generates a complete HTML report as a string.
   * Includes embedded images, styling, and interactive functionality.
   * @param {Object} testReport - The test report data containing all actions and results
   * 
   * @returns {string} HTML document as a string
   */
  generateHTMLReport(testReport) {
    const successRate = testReport.totalActions > 0
      ? ((testReport.passedActions / testReport.totalActions) * 100).toFixed(1)
      : 0;

    const formatDuration = (ms) => {
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60000).toFixed(1)}m`;
    };

    const actionsWithScreenshots = testReport.actions.map((action) => {
      const enriched = { ...action };

      // Regular screenshot
      if (action.screenshot) {
        const filename = path.basename(action.screenshot);
        enriched.screenshotBase64 = this.embedScreenshot(filename);
        enriched.screenshotFilename = filename;
      }

      // Visual regression images — embed all three panels
      if (action.tool === 'visual_regression_check' && action.visualResult) {
        const vr = action.visualResult;
        enriched.vrReferenceBase64 = this.embedImageFromPath(vr.referencePath);
        enriched.vrActualBase64 = this.embedImageFromPath(vr.actualPath);
        enriched.vrDiffBase64 = vr.diffPath ? this.embedImageFromPath(vr.diffPath) : null;
      }

      return enriched;
    });

    console.log(`📊 Actions with screenshots: ${actionsWithScreenshots.filter(a => a.screenshotBase64 || a.vrActualBase64).length}/${actionsWithScreenshots.length}`);

    let css = '';
    const cssPath = path.join(__dirname, 'report-generator.css');
    if (fs.existsSync(cssPath)) {
      css = fs.readFileSync(cssPath, 'utf-8');
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autonomous LLM-MCP Test Report</title>
  <style>
    ${css}
  </style>
</head>
<body>
  <div class="container">
    ${this.generateReportHeader(testReport)}
    ${this.generateStatsGrid(testReport, successRate, formatDuration)}
    ${this.generateProgressChart(testReport, successRate)}
    ${this.generateTimeline(actionsWithScreenshots)}
    ${this.generateFooter(testReport)}
  </div>

  <div id="imageModal" class="modal" onclick="closeModal()">
    <div class="modal-content">
      <span class="modal-close" onclick="closeModal()">×</span>
      <img id="modalImage" class="modal-img" src="" alt="Screenshot">
    </div>
  </div>

  <script>${this.getReportJavaScript()}</script>
</body>
</html>`;
  }

  /**
   * Generates the 3-panel visual regression display section for an action.
   * Shows reference, actual, and diff images with metadata and scoring.
   * @param {Object} action - The action object with visual regression results
   * @param {Object} action.visualResult - Visual regression result data
   * @param {string} action.vrReferenceBase64 - Base64 reference image
   * @param {string} action.vrActualBase64 - Base64 actual screenshot
   * @param {string} action.vrDiffBase64 - Base64 diff visualization
   * @param {number} idx - Index of the action in the timeline
   * 
   * @returns {string} HTML section for visual regression display
   */
  generateVisualRegressionSection(action, idx) {
    const vr = action.visualResult;
    if (!vr) return '<em>No visual result data.</em>';

    // Baseline update — no diff needed
    if (vr.isBaselineUpdate) {
      return `
        <div class="vr-baseline-notice">
          📸 <strong>Baseline saved</strong> for breakpoint <strong>${vr.breakpoint}</strong>.
          This image will be used as the reference in future runs.
          ${action.vrActualBase64 ? `
            <div style="margin-top:10px;">
              <img src="${action.vrActualBase64}" style="max-width:100%;border-radius:6px;cursor:pointer;"
                   onclick="openModalSrc(this.src)" alt="Baseline screenshot">
            </div>` : ''}
        </div>`;
    }

    const scoreClass = vr.passed ? 'pass' : 'fail';
    const score = vr.score ?? (100 - vr.mismatchPercent).toFixed(1);

    return `
      <div style="margin-top:10px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <span class="vr-badge ${scoreClass}">${vr.passed ? '✅ Passed' : '❌ Failed'}</span>
          <span style="font-size:13px;color:#374151;">
            Breakpoint: <strong>${vr.breakpoint}</strong>
          </span>
        </div>

        <div class="vr-meta">
          <span>Mismatched pixels: <strong>${vr.mismatchedPixels?.toLocaleString() ?? 'N/A'}</strong></span>
          <span>Mismatch: <strong>${vr.mismatchPercent ?? 'N/A'}%</strong></span>
          <span>Total pixels: <strong>${vr.totalPixels?.toLocaleString() ?? 'N/A'}</strong></span>
          <span>Dimensions: <strong>${vr.width ?? '?'}×${vr.height ?? '?'}</strong></span>
        </div>

        <div class="vr-score-bar" title="Match score">
          <div class="vr-score-fill ${scoreClass}" style="width:${100 - (vr.mismatchPercent ?? 0)}%"></div>
        </div>
        <div style="font-size:11px;color:#6b7280;margin-top:3px;">
          Match: ${(100 - (vr.mismatchPercent ?? 0)).toFixed(2)}%
        </div>

        <div class="vr-panel-grid">
          <div class="vr-panel">
            <div class="vr-panel-label reference">Reference / Baseline</div>
            ${action.vrReferenceBase64
              ? `<img src="${action.vrReferenceBase64}" alt="Reference"
                      onclick="openModalSrc(this.src)">`
              : '<div class="vr-no-image">Not available</div>'}
          </div>
          <div class="vr-panel">
            <div class="vr-panel-label actual">Actual Screenshot</div>
            ${action.vrActualBase64
              ? `<img src="${action.vrActualBase64}" alt="Actual"
                      onclick="openModalSrc(this.src)">`
              : '<div class="vr-no-image">Not available</div>'}
          </div>
          <div class="vr-panel">
            <div class="vr-panel-label diff ${scoreClass}">
              ${vr.passed ? 'Diff (within threshold)' : 'Diff (failures highlighted)'}
            </div>
            ${action.vrDiffBase64
              ? `<img src="${action.vrDiffBase64}" alt="Diff"
                      onclick="openModalSrc(this.src)">`
              : '<div class="vr-no-image">No diff generated</div>'}
          </div>
        </div>

        ${vr.summary ? `<p style="margin-top:10px;font-size:13px;color:#374151;">${vr.summary}</p>` : ''}
      </div>`;
  }

  /**
   * Converts raw MCP/Playwright error strings into clear, actionable messages.
   * Returns a structured object with a friendly title, advice, and the raw error.
   *
   * @param {string} rawError - The raw error message string
   * @returns {{ title: string, advice: string, raw: string }}
   */
  humanizeError(rawError) {
    if (!rawError) return { title: '⚠️ Unknown Error', advice: 'No error details were captured.', raw: '' };

    const raw = String(rawError);

    const patterns = [
      {
        test: /TimeoutError.*Timeout\s+\d+ms\s+exceeded/i,
        title: '⏱️ Element Not Found (Timeout)',
        advice: 'The tool waited but couldn\'t find the element on the page. Your test step may reference an element that doesn\'t exist, has a different label, or hasn\'t loaded yet. Make sure you\'re using the <strong>exact text or placeholder</strong> visible on the page.'
      },
      {
        test: /Target page,?\s*context\s+or\s+browser\s+has\s+been\s+closed/i,
        title: '🌐 Browser Session Lost',
        advice: 'The browser was closed or crashed before this step could run. This usually means a previous step caused a navigation error or the page became unresponsive. <strong>Check earlier steps for failures.</strong>'
      },
      {
        test: /net::ERR_|navigation/i,
        title: '🔗 Navigation Failed',
        advice: 'The page could not be loaded. Check that the <strong>URL in your test step is correct</strong> and the site is accessible. Also ensure there are no typos in the domain name.'
      },
      {
        test: /locator\.(click|fill|type|press)/i,
        title: '🎯 Element Interaction Failed',
        advice: 'Could not interact with the target element. It may be <strong>hidden, disabled, overlapped</strong> by another element, or the selector/placeholder text doesn\'t match what\'s actually on the page. Double-check the element\'s label or placeholder.'
      },
      {
        test: /MCP Tool returned false/i,
        title: '❌ Action Did Not Succeed',
        advice: 'The tool executed but reported failure. The element might exist but the interaction didn\'t produce the expected result — e.g., a click didn\'t trigger navigation, or a form field rejected the input. <strong>Review your test step for accuracy.</strong>'
      },
      {
        test: /Invalid plan JSON/i,
        title: '🤖 AI Planning Error',
        advice: 'The AI model produced an invalid execution plan. This can happen with complex or ambiguous test steps. Try <strong>simplifying your test steps</strong> — use shorter, clearer instructions with one action per step.'
      },
      {
        test: /Chromium not found/i,
        title: '🖥️ Browser Not Installed',
        advice: 'Chromium browser is not installed on the server. Run <code>npx playwright install chromium</code> to fix this.'
      },
      {
        test: /Chromium failed to start|CDP within/i,
        title: '🖥️ Browser Failed to Start',
        advice: 'The browser could not start within the time limit. This is usually a <strong>system resource issue</strong>. Try closing other applications or restarting the server.'
      },
      {
        test: /baseline.*not found|No baseline|ENOENT.*baseline/i,
        title: '📸 Visual Baseline Missing',
        advice: 'No baseline reference image exists for this visual check. Run the test once with <strong>baseline capture enabled</strong> to create the reference image first.'
      },
      {
        test: /strict mode violation|resolved to \d+ elements/i,
        title: '🔍 Multiple Elements Matched',
        advice: 'The selector matched more than one element on the page. Your test step description is <strong>too generic</strong>. Be more specific — e.g., instead of "click Submit", try "click the Submit button in the Contact form".'
      },
      {
        test: /waiting for selector|waiting for locator/i,
        title: '⏳ Element Not Found',
        advice: 'The tool kept waiting for an element that never appeared. The element may load <strong>after a delay or behind an interaction</strong> (e.g., after clicking a tab). Ensure previous steps set up the right page state.'
      },
    ];

    for (const pattern of patterns) {
      if (pattern.test.test(raw)) {
        return { title: pattern.title, advice: pattern.advice, raw };
      }
    }

    return {
      title: '⚠️ Unexpected Error',
      advice: 'An unexpected error occurred during this step. See the raw error details below for debugging information.',
      raw
    };
  }

  /**
   * Generates the header section of the HTML report.
   * @param {Object} testReport - The test report data
   * 
   * @returns {string} HTML header section
   */
  generateReportHeader(testReport) {
    return `
      <div class="header">
        <h1>🤖 Autonomous LLM-MCP Test Report</h1>
        <p>Generated on ${new Date(testReport.startTime).toLocaleString()}</p>
      </div>`;
  }

  /**
   * Generates the statistics grid section showing key metrics.
   * @param {Object} testReport - The test report data
   * @param {string|number} successRate - Success rate percentage
   * @param {Function} formatDuration - Function to format duration values
   * 
   * @returns {string} HTML statistics grid section
   */
  generateStatsGrid(testReport, successRate, formatDuration) {
    const testResult = testReport.testResult || 'unknown';
    const testResultClass = testResult === 'pass' ? 'success' : 'failure';

    // Count visual regression steps separately
    const vrActions = testReport.actions.filter(a => a.tool === 'visual_regression_check');
    const vrPassed = vrActions.filter(a => a.status === 'passed').length;

    return `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value ${testResultClass}">${testResult.toUpperCase()}</div>
          <div class="stat-label">Test Result</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${testReport.totalActions}</div>
          <div class="stat-label">Total Actions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value success">${testReport.passedActions}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value failure">${testReport.failedActions}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${successRate}%</div>
          <div class="stat-label">Success Rate</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${formatDuration(testReport.duration)}</div>
          <div class="stat-label">Duration</div>
        </div>
        ${vrActions.length > 0 ? `
        <div class="stat-card">
          <div class="stat-value" style="color:#6366f1">${vrPassed}/${vrActions.length}</div>
          <div class="stat-label">Visual Checks</div>
        </div>` : ''}
      </div>`;
  }

  /**
   * Generates the progress chart showing pass/fail ratio.
   * @param {Object} testReport - The test report data
   * @param {string|number} successRate - Success rate percentage
   * 
   * @returns {string} HTML progress chart section
   */
  generateProgressChart(testReport, successRate) {
    return `
      <div class="chart-container">
        <div class="chart">
          <div class="chart-title">Action Success Rate</div>
          <div class="progress-bar">
            <div class="progress-segment progress-passed" style="width:${successRate}%">
              ${testReport.passedActions} Passed
            </div>
            <div class="progress-segment progress-failed" style="width:${100 - successRate}%">
              ${testReport.failedActions} Failed
            </div>
          </div>
        </div>
      </div>`;
  }

  /**
   * Formats data objects into HTML-safe display strings.
   * Handles strings, numbers, arrays, and nested objects with proper formatting.
   * @param {*} data - Data to format (any type)
   * @param {number} [indentLevel=0] - Current indentation level for nested objects
   * 
   * @returns {string} Formatted HTML string representation of the data
   */
  formatData(data, indentLevel = 0) {
    if (!data) return '<em>None</em>';
    const indent = '  '.repeat(indentLevel);
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return `<strong>${data}</strong>`;
    }
    if (Array.isArray(data)) {
      if (data.length === 0) return '<em>Empty array</em>';
      return data.map(item => `${indent}<strong>•</strong> ${this.formatData(item, indentLevel + 1)}`).join('<br>');
    }
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return '<em>Empty object</em>';
      return keys.map(key => {
        const value = data[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 5) {
          return `${indent}<strong>${key}:</strong> <em>[Complex object]</em>`;
        }
        return `${indent}<strong>${key}:</strong> ${this.formatData(value, indentLevel + 1)}`;
      }).join('<br>');
    }
    return String(data);
  }

  /**
   * Generates the action timeline section showing all actions with details.
   * Includes filtering, expandable sections, and embedded media.
   * @param {Array} actionsWithScreenshots - Array of action objects with embedded screenshots
   * 
   * @returns {string} HTML timeline section
   */
  generateTimeline(actionsWithScreenshots) {
    return `
      <div class="timeline">
        <div class="timeline-header">
          <h2>📋 Action Timeline</h2>
          <div class="filter-buttons">
            <button class="filter-btn active" onclick="filterActions('all')">All</button>
            <button class="filter-btn" onclick="filterActions('passed')">Passed</button>
            <button class="filter-btn" onclick="filterActions('failed')">Failed</button>
            <button class="filter-btn" onclick="filterActions('assertions')">Assertions</button>
            <button class="filter-btn" onclick="filterActions('visual')">Visual Checks</button>
          </div>
        </div>

        <div id="actions-container">
          ${actionsWithScreenshots.map((action, idx) => {
            const isVR = action.tool === 'visual_regression_check';
            const dataStatus = isVR ? `${action.status} visual` : action.status;

            const isAssertion = /assert|expect|verify|check|validate/i.test(action.tool);

            // Humanize error if present
            const friendlyError = action.error ? this.humanizeError(action.error) : null;

            // Escape raw error for safe HTML display inside <pre>
            const escapeHtml = (str) => str
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');

            return `
            <div class="action-item ${action.status}${isVR ? ' vr-action' : ''}${action.status === 'failed' ? ' expanded' : ''}"
                 data-status="${dataStatus}${isAssertion ? ' assertion' : ''}">
              <div class="action-header" onclick="toggleAction(${idx})">
                <div class="action-title">
                  <div class="action-number">${idx + 1}</div>
                  <div class="action-title-text">
                    ${action.testStep
                      ? `<div class="action-step-text">${action.testStep}</div>`
                      : ''}
                    <div class="action-tool">
                      ${isVR ? 'mcp_ ' : ''}${action.tool}
                      ${isVR && action.visualResult?.breakpoint
                        ? `<span style="font-size:11px;color:#6b7280;margin-left:6px;">
                             @ ${action.visualResult.breakpoint}
                           </span>`
                        : ''}
                    </div>
                  </div>
                </div>
                <div class="action-status">
                  <div class="status-badge ${action.status}">${action.status}</div>
                  <div class="duration-badge">${action.duration || 0}ms</div>
                  ${isVR && action.visualResult && !action.visualResult.isBaselineUpdate
                    ? `<div class="vr-badge ${action.status === 'passed' ? 'pass' : 'fail'}"
                            style="font-size:11px;">
                         ${action.visualResult.mismatchPercent ?? 0}% diff
                       </div>`
                    : ''}
                  <div class="expand-icon">▼</div>
                </div>
              </div>

              <div class="action-details">
                ${friendlyError ? `
                  <div class="error-box">
                    <div class="error-friendly">
                      <div class="error-friendly-title">${friendlyError.title}</div>
                      <p class="error-friendly-advice">${friendlyError.advice}</p>
                    </div>
                    <details class="error-raw-details">
                      <summary>Show raw error</summary>
                      <pre class="error-raw">${escapeHtml(friendlyError.raw)}</pre>
                    </details>
                  </div>` : ''}

                ${isVR
                  ? this.generateVisualRegressionSection(action, idx)
                  : `
                  <div class="detail-section">
                    <div class="detail-label">Action Parameters</div>
                    <div class="detail-content">${this.formatData(action.params)}</div>
                  </div>
                  ${action.screenshotBase64 ? `
                    <div class="screenshot-container">
                      <div class="detail-label">Screenshot</div>
                      <img src="${action.screenshotBase64}"
                           class="screenshot-img"
                           onclick="openModalSrc(this.src)"
                           alt="Action screenshot">
                    </div>` : ''}`
                }
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  /**
   * Generates the footer section with metadata and timing information.
   * @param {Object} testReport - The test report data
   * 
   * @returns {string} HTML footer section
   */
  generateFooter(testReport) {
    let tokenLine = '';
    if (testReport.tokenUsage) {
      const tu = testReport.tokenUsage;
      tokenLine = `
        <p style="margin-top:10px;color:#60a5fa;font-size:13px;">
          📊 Token Usage — Model: <strong>${tu.model}</strong> |
          LLM Calls: <strong>${tu.callCount}</strong> |
          Input: <strong>${tu.inputTokens.toLocaleString()}</strong> |
          Output: <strong>${tu.outputTokens.toLocaleString()}</strong> |
          Total: <strong>${(tu.inputTokens + tu.outputTokens).toLocaleString()}</strong>
        </p>`;
    }

    return `
      <div class="footer">
        <p>Generated on ${testReport.endTime ? testReport.endTime.toLocaleString() : new Date().toLocaleString()}</p>
        <p style="margin-top:8px;color:#9ca3af;">
          Start: ${testReport.startTime.toLocaleTimeString()} |
          End: ${testReport.endTime ? testReport.endTime.toLocaleTimeString() : 'In Progress'} |
          Duration: ${testReport.duration ? (testReport.duration / 1000).toFixed(2) : '0'}s
        </p>${tokenLine}
        <p style="margin-top:8px;color:#9ca3af;">
          Report generated by Autonomous LLM-MCP Test Runner v2.0
        </p>
      </div>`;
  }

  /**
   * Generates the JavaScript code for interactive report features.
   * Handles action filtering, modal image viewing, and expand/collapse functionality.
   * 
   * @returns {string} JavaScript code as a string
   */
  getReportJavaScript() {
    return `
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
          const ds = action.dataset.status || '';
          const show = status === 'all'
            || ds === status
            || (status === 'visual' && ds.includes('visual'))
            || (status === 'assertions' && ds.includes('assertion'))
            || (status === 'passed' && ds.startsWith('passed'))
            || (status === 'failed' && ds.startsWith('failed'));
          action.style.display = show ? 'block' : 'none';
        });
      }

      // Accepts a src string directly — works for base64 and URLs
      function openModalSrc(src) {
        event.stopPropagation();
        const modal = document.getElementById('imageModal');
        const modalImg = document.getElementById('modalImage');
        modalImg.src = src;
        modal.classList.add('active');
      }

      function closeModal() {
        document.getElementById('imageModal').classList.remove('active');
      }

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
      });`;
  }
}

export default TestReportGenerator;
