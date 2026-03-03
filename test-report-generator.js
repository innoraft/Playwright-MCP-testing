/**
 * Test Report Generator
 * Handles creation of HTML test reports for autonomous LLM-MCP tests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class TestReportGenerator {
  constructor(config) {
    this.config = config || {
      reporting: {
        outputDir: 'test-reports',
        screenshotsDir: 'files/screenshots'
      }
    };
    this.screenshotCounter = 0;
  }

  generateScreenshotName(testName, actionIndex, actionType = 'action') {
    const sanitizedTestName = testName.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
    const paddedIndex = String(actionIndex + 1).padStart(2, '0');
    const timestamp = Date.now();
    return `${sanitizedTestName}_action${paddedIndex}_${actionType}_${timestamp}.png`;
  }

  extractActionType(action) {
    if (!action.tool) return 'unknown';
    const toolTypeMap = {
      'browser_navigate': 'navigation',
      'browser_click': 'click',
      'browser_type': 'type',
      'browser_fill_form': 'form',
      'browser_select_option': 'select',
      'browser_wait_for': 'wait',
      'browser_evaluate': 'evaluate',
      'browser_snapshot': 'snapshot',
      'browser_take_screenshot': 'screenshot',
      'browser_hover': 'hover',
      'browser_drag': 'drag',
      'browser_press_key': 'key',
      'browser_handle_dialog': 'dialog',
      'visual_regression_check': 'visual-regression'
    };
    const cleanTool = action.tool.replace(/^mcp_/, '');
    return toolTypeMap[cleanTool] || cleanTool.replace('browser_', '');
  }

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

  ensureDirectories() {
    fs.mkdirSync(this.config.reporting.outputDir, { recursive: true });
    fs.mkdirSync(this.config.reporting.screenshotsDir, { recursive: true });
  }

  logReportGeneration(testReport, htmlReportFile) {
    console.log('\n📊 Test Report Generated:');
    console.log(`🌐 HTML Report: ${htmlReportFile}`);
    console.log(`⏱️  Duration: ${testReport.duration}ms`);
    console.log(`✅ Passed: ${testReport.passedActions}`);
    console.log(`❌ Failed: ${testReport.failedActions}`);
    console.log(`📈 Success Rate: ${((testReport.passedActions / testReport.totalActions) * 100).toFixed(1)}%`);
  }

  /**
   * Embed any image by its absolute or relative path.
   * Works for screenshots, baselines, and diffs — not just the screenshots dir.
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

  embedScreenshot(filename) {
    const screenshotPath = path.join(this.config.reporting.screenshotsDir, filename);
    return this.embedImageFromPath(screenshotPath);
  }

  findScreenshots() {
    if (!fs.existsSync(this.config.reporting.screenshotsDir)) return [];
    return fs.readdirSync(this.config.reporting.screenshotsDir)
      .filter(f => f.match(/\.(png|jpg|jpeg)$/i));
  }

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
    ${this.getVisualRegressionCSS()}
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
   * Extra CSS for visual regression panels
   */
  getVisualRegressionCSS() {
    return `
      .vr-panel-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
        margin-top: 12px;
      }
      .vr-panel {
        display: flex;
        flex-direction: column;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #e5e7eb;
      }
      .vr-panel-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 6px 10px;
        text-align: center;
      }
      .vr-panel-label.reference { background: #dbeafe; color: #1d4ed8; }
      .vr-panel-label.actual    { background: #dcfce7; color: #15803d; }
      .vr-panel-label.diff      { background: #fee2e2; color: #b91c1c; }
      .vr-panel-label.diff.pass { background: #f0fdf4; color: #15803d; }
      .vr-panel img {
        width: 100%;
        cursor: pointer;
        display: block;
        transition: opacity 0.2s;
      }
      .vr-panel img:hover { opacity: 0.85; }
      .vr-no-image {
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f9fafb;
        color: #9ca3af;
        font-size: 12px;
      }
      .vr-score-bar {
        margin-top: 10px;
        background: #f3f4f6;
        border-radius: 999px;
        height: 10px;
        overflow: hidden;
      }
      .vr-score-fill {
        height: 100%;
        border-radius: 999px;
        transition: width 0.4s ease;
      }
      .vr-score-fill.pass { background: #22c55e; }
      .vr-score-fill.fail { background: #ef4444; }
      .vr-meta {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        margin-top: 8px;
        font-size: 13px;
      }
      .vr-meta span { color: #6b7280; }
      .vr-meta strong { color: #111827; }
      .vr-badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
      }
      .vr-badge.pass { background: #dcfce7; color: #15803d; }
      .vr-badge.fail { background: #fee2e2; color: #b91c1c; }
      .vr-baseline-notice {
        margin-top: 10px;
        padding: 10px 14px;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        color: #1d4ed8;
        font-size: 13px;
      }
    `;
  }

  /**
   * Renders the 3-panel visual regression section for a step.
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

  generateReportHeader(testReport) {
    return `
      <div class="header">
        <h1>🤖 Autonomous LLM-MCP Test Report</h1>
        <p>Generated on ${new Date(testReport.startTime).toLocaleString()}</p>
      </div>`;
  }

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

  generateTimeline(actionsWithScreenshots) {
    return `
      <div class="timeline">
        <div class="timeline-header">
          <h2>📋 Action Timeline</h2>
          <div class="filter-buttons">
            <button class="filter-btn active" onclick="filterActions('all')">All</button>
            <button class="filter-btn" onclick="filterActions('passed')">Passed</button>
            <button class="filter-btn" onclick="filterActions('failed')">Failed</button>
            <button class="filter-btn" onclick="filterActions('visual')">Visual Checks</button>
          </div>
        </div>

        <div id="actions-container">
          ${actionsWithScreenshots.map((action, idx) => {
            const isVR = action.tool === 'visual_regression_check';
            const dataStatus = isVR ? `${action.status} visual` : action.status;

            return `
            <div class="action-item ${action.status}${isVR ? ' vr-action' : ''}"
                 data-status="${dataStatus}">
              <div class="action-header" onclick="toggleAction(${idx})">
                <div class="action-title">
                  <div class="action-number">${idx + 1}</div>
                  <div class="action-tool">
                    ${isVR ? 'mcp_ ' : ''}${action.tool}
                    ${isVR && action.visualResult?.breakpoint
                      ? `<span style="font-size:11px;color:#6b7280;margin-left:6px;">
                           @ ${action.visualResult.breakpoint}
                         </span>`
                      : ''}
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
                ${action.error ? `
                  <div class="error-box">
                    <strong>❌ Error:</strong> ${action.error}
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

  generateFooter(testReport) {
    return `
      <div class="footer">
        <p>Generated on ${testReport.endTime ? testReport.endTime.toLocaleString() : new Date().toLocaleString()}</p>
        <p style="margin-top:8px;color:#9ca3af;">
          Start: ${testReport.startTime.toLocaleTimeString()} |
          End: ${testReport.endTime ? testReport.endTime.toLocaleTimeString() : 'In Progress'} |
          Duration: ${testReport.duration ? (testReport.duration / 1000).toFixed(2) : '0'}s
        </p>
        <p style="margin-top:8px;color:#9ca3af;">
          Report generated by Autonomous LLM-MCP Test Runner v2.0
        </p>
      </div>`;
  }

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
