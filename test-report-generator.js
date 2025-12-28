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

export class TestReportGenerator {
  constructor(config) {
    this.config = config || {
      reporting: {
        outputDir: 'test-reports',
        screenshotsDir: 'test-screenshots'
      }
    };
    this.screenshotCounter = 0;
  }

  /**
   * Generate a predefined screenshot name
   * @param {string} testName - Name of the test
   * @param {number} actionIndex - Index of the action (0-based)
   * @param {string} actionType - Type of action (navigation, click, type, etc.)
   * @returns {string} - Predefined screenshot filename
   */
  generateScreenshotName(testName, actionIndex, actionType = 'action') {
    const sanitizedTestName = testName.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
    const paddedIndex = String(actionIndex + 1).padStart(2, '0');
    const timestamp = Date.now();

    // Generate predictable filename: testname_action01_type_timestamp.png
    return `${sanitizedTestName}_action${paddedIndex}_${actionType}_${timestamp}.png`;
  }

  /**
   * Generate modal screenshot name for overlay elements
   * @param {string} testName - Name of the test
   * @returns {string} - Modal screenshot filename
   */
  generateModalScreenshotName(testName) {
    const sanitizedTestName = testName.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
    const timestamp = Date.now();
    return `${sanitizedTestName}_modal_${timestamp}.png`;
  }

  /**
   * Generate error screenshot name for failed actions
   * @param {string} testName - Name of the test
   * @param {number} actionIndex - Index of the action (0-based)
   * @returns {string} - Error screenshot filename
   */
  generateErrorScreenshotName(testName, actionIndex) {
    const sanitizedTestName = testName.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
    const paddedIndex = String(actionIndex + 1).padStart(2, '0');
    const timestamp = Date.now();
    return `${sanitizedTestName}_error${paddedIndex}_${timestamp}.png`;
  }

  /**
   * Extract action type from action for screenshot naming
   * @param {Object} action - The action object
   * @returns {string} - Action type (navigation, click, type, etc.)
   */
  extractActionType(action) {
    if (!action.tool) return 'unknown';

    // Map MCP tool names to readable action types
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
      'browser_handle_dialog': 'dialog'
    };

    // Remove 'mcp_' prefix if present
    const cleanTool = action.tool.replace(/^mcp_/, '');
    return toolTypeMap[cleanTool] || cleanTool.replace('browser_', '');
  }

  /**
   * Generate HTML report from test data
   * @param {Object} testReport - Test execution data
   * @returns {Object} - Report file path and data
   */
  generateReport(testReport) {
    // Finalize test report data
    testReport.endTime = new Date();
    testReport.duration = testReport.endTime - testReport.startTime;

    // Calculate overall test result based on individual action results
    testReport.testResult = testReport.failedActions === 0 ? 'pass' : 'fail';

    const timestamp = Date.now();
    const htmlReportFile = path.join(this.config.reporting.outputDir, `autonomous_mcp_report_${timestamp}.html`);

    // Ensure directories exist
    this.ensureDirectories();

    // Generate HTML report with embedded screenshots
    const htmlReport = this.generateHTMLReport(testReport);
    fs.writeFileSync(htmlReportFile, htmlReport);

    // Log report generation
    this.logReportGeneration(testReport, htmlReportFile);

    return {
      htmlReport: htmlReportFile,
      testReport
    };
  }

  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    if (!fs.existsSync(this.config.reporting.outputDir)) {
      fs.mkdirSync(this.config.reporting.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.config.reporting.screenshotsDir)) {
      fs.mkdirSync(this.config.reporting.screenshotsDir, { recursive: true });
    }
  }

  /**
   * Log report generation details
   */
  logReportGeneration(testReport, htmlReportFile) {
    console.log('\n📊 Enhanced Test Report Generated:');
    console.log(`🌐 HTML Report: ${htmlReportFile}`);
    console.log(`⏱️  Duration: ${testReport.duration}ms`);
    console.log(`✅ Passed Actions: ${testReport.passedActions}`);
    console.log(`❌ Failed Actions: ${testReport.failedActions}`);
    console.log(`📈 Success Rate: ${((testReport.passedActions / testReport.totalActions) * 100).toFixed(1)}%`);
  }

  /**
   * Generate HTML report with embedded styling and screenshots
   * @param {Object} testReport - Test execution data
   * @returns {string} - Complete HTML report
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

    // Find all screenshots and process them for embedding
    const screenshots = this.findScreenshots();

    const actionsWithScreenshots = testReport.actions.map((action) => {
      if (!action.screenshot) return action;

      const screenshotFilename = path.basename(action.screenshot);
      const base64Data = this.embedScreenshot(screenshotFilename);

      if (!base64Data) return action;

      return {
        ...action,
        screenshotBase64: base64Data,
        screenshotFilename
      };
    });



    // Don't try to assign screenshots to actions that didn't take them
    // This was causing the issue where every action had a screenshot attached
    console.log(`📊 Actions with screenshots: ${actionsWithScreenshots.filter(a => a.screenshotBase64).length}/${actionsWithScreenshots.length}`);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Autonomous LLM-MCP Test Report</title>
    <style>
        ${this.getReportCSS()}
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

    <!-- Modal for full-size screenshots -->
    <div id="imageModal" class="modal" onclick="closeModal()">
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">×</span>
            <img id="modalImage" class="modal-img" src="" alt="Screenshot">
        </div>
    </div>

    <script>
        ${this.getReportJavaScript()}
    </script>
</body>
</html>`;

    return html;
  }

  /**
   * Find and process screenshots for embedding
   * @returns {Array} - Array of screenshot filenames
   */
  findScreenshots() {
    const screenshots = [];
    if (fs.existsSync(this.config.reporting.screenshotsDir)) {
      const files = fs.readdirSync(this.config.reporting.screenshotsDir);
      screenshots.push(...files.filter(file => file.match(/\.(png|jpg|jpeg)$/i)));
    }
    return screenshots;
  }

  /**
   * Convert screenshot to base64 for embedding
   * @param {string} filename - Screenshot filename
   * @returns {string|null} - Base64 data URL or null
   */
  embedScreenshot(filename) {
    const screenshotPath = path.join(this.config.reporting.screenshotsDir, filename);

    if (fs.existsSync(screenshotPath)) {
      try {
        const imageData = fs.readFileSync(screenshotPath);
        const base64 = imageData.toString('base64');
        const extension = path.extname(filename).toLowerCase();
        const mimeType = extension === '.png' ? 'image/png' :
          extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';

        return `data:${mimeType};base64,${base64}`;
      } catch (error) {
        console.error(`❌ Error reading screenshot ${filename}: ${error.message}`);
        return null;
      }
    } else {
      console.warn(`⚠️ Screenshot file not found: ${screenshotPath}`);

      // Try to find similar files
      if (fs.existsSync(this.config.reporting.screenshotsDir)) {
        const files = fs.readdirSync(this.config.reporting.screenshotsDir);
        const similarFiles = files.filter(file =>
          file.toLowerCase().includes(filename.toLowerCase().replace('.png', '').replace('.jpg', '').replace('.jpeg', ''))
        );

        if (similarFiles.length > 0) {
          console.log(`🔍 Found similar files: ${similarFiles.join(', ')}`);
          // Try the first similar file
          return this.embedScreenshot(similarFiles[0]);
        }
      }

      return null;
    }
  }

  /**
   * Generate report header section
   */
  generateReportHeader(testReport) {
    return `
        <div class="header">
            <h1>� Autonomous LLM-MCP Test Report</h1>
            <p>Generated on ${new Date(testReport.startTime).toLocaleString()}</p>
        </div>`;
  }

  /**
   * Generate stats grid section
   */
  generateStatsGrid(testReport, successRate, formatDuration) {
    const testResult = testReport.testResult || 'unknown';
    const testResultClass = testResult === 'pass' ? 'success' : testResult === 'fail' ? 'failure' : 'neutral';
    const testResultText = testResult.toUpperCase();

    return `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value ${testResultClass}">${testResultText}</div>
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
        </div>`;
  }

  /**
   * Generate progress chart section
   */
  generateProgressChart(testReport, successRate) {
    return `
        <div class="chart-container">
            <div class="chart">
                <div class="chart-title">Action Success Rate</div>
                <div class="progress-bar">
                    <div class="progress-segment progress-passed" style="width: ${successRate}%">
                        ${testReport.passedActions} Passed
                    </div>
                    <div class="progress-segment progress-failed" style="width: ${100 - successRate}%">
                        ${testReport.failedActions} Failed
                    </div>
                </div>
            </div>
        </div>`;
  }

  /**
   * Format data in human-readable way instead of JSON
   */
  formatData(data, indentLevel = 0) {
    if (!data) return '<em>None</em>';

    const indent = '  '.repeat(indentLevel);

    // Handle primitives
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return `<strong>${data}</strong>`;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      if (data.length === 0) return '<em>Empty array</em>';
      return data.map((item, idx) =>
        `${indent}<strong>•</strong> ${this.formatData(item, indentLevel + 1)}`
      ).join('<br>');
    }

    // Handle objects
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return '<em>Empty object</em>';

      return keys.map(key => {
        const value = data[key];
        // Skip large/complex nested objects
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 5) {
          return `${indent}<strong>${key}:</strong> <em>[Complex object]</em>`;
        }
        return `${indent}<strong>${key}:</strong> ${this.formatData(value, indentLevel + 1)}`;
      }).join('<br>');
    }

    return String(data);
  }

  /**
   * Format assertion result in a clean way
   */
  formatAssertionResult(action) {
    if (action.tool !== 'mcp_assert') return null;

    const result = action.result || {};
    const status = action.success ? '✅ Passed' : '❌ Failed';

    return `
      <div class="detail-section" style="background: ${action.success ? '#f0fdf4' : '#fef2f2'}; padding: 15px; border-radius: 6px; border: 1px solid ${action.success ? '#86efac' : '#fecaca'};">
        <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">${status}</div>
        <div style="margin-bottom: 8px;"><strong>Expression:</strong><br><code style="background: white; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 4px;">${action.params?.expression || 'N/A'}</code></div>
        ${result.expectedValue ? `<div style="margin-bottom: 8px;"><strong>Expected:</strong> <span style="color: #059669;">${result.expectedValue}</span></div>` : ''}
        ${result.actualValue !== undefined ? `<div style="margin-bottom: 8px;"><strong>Actual:</strong> <span style="color: ${action.success ? '#059669' : '#dc2626'};">${result.actualValue}</span></div>` : ''}
        ${action.error ? `<div style="margin-top: 10px; padding: 10px; background: white; border-radius: 4px; color: #991b1b;"><strong>Error:</strong> ${action.params?.failureMessage || action.error}</div>` : ''}
      </div>
    `;
  }

  /**
   * Generate timeline section with expandable actions
   */
  generateTimeline(actionsWithScreenshots) {
    return `
        <div class="timeline">
            <div class="timeline-header">
                <h2>� Action Timeline</h2>
                <div class="filter-buttons">
                    <button class="filter-btn active" onclick="filterActions('all')">All</button>
                    <button class="filter-btn" onclick="filterActions('passed')">Passed</button>
                    <button class="filter-btn" onclick="filterActions('failed')">Failed</button>
                </div>
            </div>
            
            <div id="actions-container">
                ${actionsWithScreenshots.map((action, idx) => {
      return `
                    <div class="action-item ${action.status}" data-status="${action.status}">
                        <div class="action-header" onclick="toggleAction(${idx})">
                            <div class="action-title">
                                <div class="action-number">${idx + 1}</div>
                                <div class="action-tool">${action.tool}</div>
                            </div>
                            <div class="action-status">
                                <div class="status-badge ${action.status}">${action.status}</div>
                                <div class="duration-badge">${action.duration || 0}ms</div>
                                <div class="expand-icon">▼</div>
                            </div>
                        </div>
                        <div class="action-details">
                            ${action.error ? `
                                <div class="error-box">
                                    <strong>❌ Error:</strong> ${action.error}
                                </div>
                            ` : ''}
                            
                            ${action.failureDetails ? `
                                <div class="error-box">
                                    <strong>❌ Test Failed:</strong><br>
                                    <strong>Expected:</strong> ${action.failureDetails.expected}<br>
                                    <strong>Actual:</strong> ${action.failureDetails.actual}<br>
                                    <strong>Reason:</strong> ${action.failureDetails.reason}
                                </div>
                            ` : ''}
                            
                            ${action.tool === 'mcp_assert' ? this.formatAssertionResult(action) : `
                              <div class="detail-section">
                                  <div class="detail-label">Action Parameters</div>
                                  <div class="detail-content">${this.formatData(action.params)}</div>
                              </div>
                            `}
                            
                            ${action.evaluationResult ? `
                                <div class="detail-section">
                                    <div class="detail-label">Evaluation Result</div>
                                    <div class="detail-content">${this.formatData(action.evaluationResult)}</div>
                                </div>
                            ` : ''}
                            
                            ${action.screenshotBase64 ? `
                                <div class="screenshot-container">
                                    <div class="detail-label">Screenshot</div>
                                    <img src="${action.screenshotBase64}" 
                                         class="screenshot-img" 
                                         onclick="openModal('screenshot-${idx}')"
                                         id="screenshot-${idx}"
                                         alt="Action screenshot">
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `}).join('')}
            </div>
        </div>`;
  }

  /**
   * Generate footer section
   */
  generateFooter(testReport) {
    return `
        <div class="footer">
            <p>Generated on ${testReport.endTime ? testReport.endTime.toLocaleString() : new Date().toLocaleString()}</p>
            <p style="margin-top: 8px; color: #9ca3af;">
                Start: ${testReport.startTime.toLocaleTimeString()} | 
                End: ${testReport.endTime ? testReport.endTime.toLocaleTimeString() : 'In Progress'} | 
                Duration: ${testReport.duration ? (testReport.duration / 1000).toFixed(2) : '0'}s
            </p>
            <p style="margin-top: 8px; color: #9ca3af;">
                Report generated by Autonomous LLM-MCP Test Runner v1.0
            </p>
        </div>`;
  }

  /**
   * Get CSS styles for the report
   */
  getReportCSS() {
    return `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
          color: #333;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 40px;
          text-align: center;
        }
        .header h1 {
          font-size: 32px;
          margin-bottom: 10px;
          font-weight: 700;
        }
        .header p {
          opacity: 0.9;
          font-size: 16px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          padding: 30px;
          background: #f8f9fa;
        }
        .stat-card {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          text-align: center;
          transition: transform 0.2s;
        }
        .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .stat-value {
          font-size: 36px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .stat-label {
          color: #666;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .success { color: #10b981; }
        .error { color: #ef4444; }
        .failure { color: #ef4444; }
        .neutral { color: #6b7280; }
        .timeline {
          padding: 30px;
        }
        .timeline-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e5e7eb;
        }
        .timeline-header h2 {
          font-size: 24px;
          color: #1f2937;
        }
        .filter-buttons {
          display: flex;
          gap: 10px;
        }
        .filter-btn {
          padding: 8px 16px;
          border: 1px solid #d1d5db;
          background: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        .filter-btn:hover {
          background: #f3f4f6;
        }
        .filter-btn.active {
          background: #667eea;
          color: white;
          border-color: #667eea;
        }
        .action-item {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          margin-bottom: 15px;
          overflow: hidden;
          transition: all 0.3s;
        }
        .action-item.passed {
          border-left: 4px solid #10b981;
        }
        .action-item.failed {
          border-left: 4px solid #ef4444;
        }
        .action-header {
          padding: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fafafa;
          transition: background 0.2s;
        }
        .action-header:hover {
          background: #f3f4f6;
        }
        .action-title {
          display: flex;
          align-items: center;
          gap: 15px;
          flex: 1;
        }
        .action-number {
          width: 32px;
          height: 32px;
          background: #667eea;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
        }
        .action-tool {
          font-weight: 600;
          font-size: 16px;
          color: #1f2937;
        }
        .action-status {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .status-badge {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .status-badge.passed {
          background: #d1fae5;
          color: #065f46;
        }
        .status-badge.failed {
          background: #fee2e2;
          color: #991b1b;
        }
        .duration-badge {
          padding: 6px 12px;
          background: #e0e7ff;
          color: #3730a3;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
        }
        .expand-icon {
          font-size: 20px;
          color: #9ca3af;
          transition: transform 0.3s;
        }
        .action-item.expanded .expand-icon {
          transform: rotate(180deg);
        }
        .action-details {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
          padding: 0 20px;
        }
        .action-item.expanded .action-details {
          max-height: 2000px;
          padding: 20px;
          border-top: 1px solid #e5e7eb;
        }
        .detail-section {
          margin-bottom: 20px;
        }
        .detail-label {
          font-weight: 600;
          color: #6b7280;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 8px;
        }
        .detail-content {
          background: #f9fafb;
          padding: 12px;
          border-radius: 6px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          overflow-x: auto;
        }
        .error-box {
          background: #fef2f2;
          border: 1px solid #fecaca;
          padding: 15px;
          border-radius: 6px;
          color: #991b1b;
          margin-bottom: 15px;
        }
        .screenshot-container {
          margin-top: 15px;
        }
        .screenshot-img {
          max-width: 100%;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .screenshot-img:hover {
          transform: scale(1.02);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.9);
          z-index: 1000;
          align-items: center;
          justify-content: center;
        }
        .modal.active {
          display: flex;
        }
        .modal-content {
          max-width: 90%;
          max-height: 90%;
          position: relative;
        }
        .modal-img {
          max-width: 100%;
          max-height: 90vh;
          border-radius: 8px;
        }
        .modal-close {
          position: absolute;
          top: -40px;
          right: 0;
          color: white;
          font-size: 36px;
          cursor: pointer;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .chart-container {
          padding: 30px;
          background: #f8f9fa;
        }
        .chart {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .chart-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 20px;
          color: #1f2937;
        }
        .progress-bar {
          width: 100%;
          height: 30px;
          background: #e5e7eb;
          border-radius: 15px;
          overflow: hidden;
          display: flex;
        }
        .progress-segment {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 12px;
          font-weight: 600;
          transition: width 0.5s ease;
        }
        .progress-passed {
          background: #10b981;
        }
        .progress-failed {
          background: #ef4444;
        }
        .footer {
          padding: 20px;
          text-align: center;
          background: #f8f9fa;
          color: #6b7280;
          font-size: 14px;
        }`;
  }

  /**
   * Get JavaScript for the report
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
                if (status === 'all' || action.dataset.status === status) {
                    action.style.display = 'block';
                } else {
                    action.style.display = 'none';
                }
            });
        }
        
        function openModal(imgId) {
            event.stopPropagation();
            const img = document.getElementById(imgId);
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImage');
            modalImg.src = img.src;
            modal.classList.add('active');
        }
        
        function closeModal() {
            document.getElementById('imageModal').classList.remove('active');
        }
        
        // Keyboard support
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeModal();
        });`;
  }
}

export default TestReportGenerator;
