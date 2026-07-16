import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export class PerformanceReportGenerator {
  constructor(config = {}) {
    this.outputDir = config.outputDir || 'test-reports';
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this._css = fs.readFileSync(path.join(__dirname, 'performance-report.css'), 'utf-8');
  }

  ensureOutputDir() {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  generateReport(report) {
    this.ensureOutputDir();
    const now = new Date(report?.generatedAt ?? Date.now());
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = (report?.testName || 'unnamed_suite')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .toLowerCase();
    const filePath = path.join(this.outputDir, `${safeName}-${timestamp}.html`);
    fs.writeFileSync(filePath, this.generateHTML(report), 'utf-8');
    return { htmlReport: filePath };
  }

  // ── Metric helpers ──────────────────────────────────────────────
  rateMetric(name, value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'na';
    const v = Number(value);
    const thresholds = {
      ttfb:        [800,  1800],
      fcp:         [1800, 3000],
      lcp:         [2500, 4000],
      cls:         [0.1,  0.25],
      tbt:         [200,  600],
      tti:         [3800, 7300],
      speedIndex:  [3400, 5800],
    };
    const t = thresholds[name];
    if (!t) return 'na';
    if (v <= t[0]) return 'good';
    if (v <= t[1]) return 'needs-improvement';
    return 'poor';
  }

  getScoreClass(score) {
    if (score === null || score === undefined || Number.isNaN(Number(score))) return 'score-na';
    if (Number(score) >= 90) return 'score-good';
    if (Number(score) >= 50) return 'score-needs-improvement';
    return 'score-poor';
  }

  getRatingClass(rating) {
    if (rating === 'good') return 'rating-good';
    if (rating === 'needs-improvement') return 'rating-needs-improvement';
    if (rating === 'poor') return 'rating-poor';
    return 'rating-na';
  }

  ratingLabel(rating) {
    if (rating === 'good')              return 'Good';
    if (rating === 'needs-improvement') return 'Needs Improvement';
    if (rating === 'poor')              return 'Poor';
    return '—';
  }

  formatMs(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'N/A';
    return `${Number(value).toFixed(0)} ms`;
  }

  formatSeconds(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'N/A';
    const v = Number(value);
    return v < 1000 ? `${v.toFixed(0)} ms` : `${(v / 1000).toFixed(2)} s`;
  }

  formatNumber(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'N/A';
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
  }

  formatBytes(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return 'N/A';
    const b = Number(value);
    if (b < 1024)          return `${b} B`;
    if (b < 1024 * 1024)   return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  truncateUrl(url) {
    if (!url || url.length <= 60) return this.escapeHtml(url);
    try {
      const u = new URL(url);
      const p = u.pathname.length > 30 ? '...' + u.pathname.slice(-27) : u.pathname;
      return this.escapeHtml(u.host + p);
    } catch {
      return this.escapeHtml(url.slice(0, 57) + '...');
    }
  }

  escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // ── Section builders ────────────────────────────────────────────

  _buildScoreCircles(metrics, categories) {
    const CATEGORY_META = {
      'performance':    { label: 'Performance',    icon: '⚡' },
      'accessibility':  { label: 'Accessibility',  icon: '♿' },
      'best-practices': { label: 'Best Practices', icon: '🔒' },
      'seo':            { label: 'SEO',            icon: '🔍' },
    };
    const categoryScores = metrics.categoryScores || {};
    return categories.map(cat => {
      const score = categoryScores[cat] ?? null;
      const meta  = CATEGORY_META[cat] || { label: cat, icon: '📊' };
      const pct   = score !== null ? Math.round(Math.max(0, Math.min(100, Number(score)))) : 0;
      const fillClass = `score-fill-${Math.round(pct / 10) * 10}`;
      const scoreClass = this.getScoreClass(score);
      return `
        <div class="score-card">
          <div class="score-gauge ${scoreClass} ${fillClass}">
            <div class="score-inner">
              <div class="score-num ${scoreClass}">${score !== null ? score : '—'}</div>
            </div>
          </div>
          <div class="score-label">${meta.icon} ${this.escapeHtml(meta.label)}</div>
        </div>`;
    }).join('');
  }

  _buildVitalsSection(metrics) {
    const coreVitals = [
      { key: 'fcp',        label: 'FCP',         value: metrics.fcp,        description: 'First Contentful Paint' },
      { key: 'lcp',        label: 'LCP',         value: metrics.lcp,        description: 'Largest Contentful Paint' },
      { key: 'tbt',        label: 'TBT',         value: metrics.tbt,        description: 'Total Blocking Time' },
      { key: 'cls',        label: 'CLS',         value: metrics.cls,        description: 'Cumulative Layout Shift' },
      { key: 'tti',        label: 'TTI',         value: metrics.tti,        description: 'Time to Interactive' },
      { key: 'speedIndex', label: 'Speed Index', value: metrics.speedIndex, description: 'Speed Index' },
      { key: 'ttfb',       label: 'TTFB',        value: metrics.ttfb,       description: 'Time to First Byte' },
    ];
    const cards = coreVitals.map(v => {
      const rating = this.rateMetric(v.key, v.value);
      const ratingClass = this.getRatingClass(rating);
      const disp   = v.key === 'cls' ? this.formatNumber(v.value) : this.formatSeconds(v.value);
      return `
        <div class="vital-card ${ratingClass}">
          <div class="vital-ring"><div class="vital-value">${disp}</div></div>
          <div class="vital-label">${v.label}</div>
          <div class="vital-desc">${v.description}</div>
          <div class="vital-rating ${ratingClass}">${this.ratingLabel(rating)}</div>
        </div>`;
    }).join('');
    return `
    <div class="card">
      <h2 class="card-title">🎯 Core Web Vitals</h2>
      <p class="section-subtitle">Key performance metrics measured using simulated throttling (PSI-compatible).</p>
      <div class="vitals-grid">${cards}</div>
    </div>`;
  }

  _buildOpportunitiesSection(metrics) {
    const opportunities = Array.isArray(metrics.opportunities) ? metrics.opportunities : [];
    if (opportunities.length === 0) return '';
    const rows = opportunities.map(o => `
      <tr>
        <td class="opp-title">${this.escapeHtml(o.title)}</td>
        <td class="opp-savings">${this.formatSeconds(o.savingsMs)} savings</td>
        <td class="opp-desc">${this.escapeHtml(o.description)}</td>
      </tr>`).join('');
    return `
    <div class="card">
      <h2 class="card-title">💡 Opportunities</h2>
      <p class="section-subtitle">Suggestions that can reduce page load time.</p>
      <table class="audit-table">
        <thead><tr><th>Audit</th><th>Est. Savings</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  _buildDiagnosticsSection(metrics) {
    const diagnostics = Array.isArray(metrics.diagnostics) ? metrics.diagnostics : [];
    if (diagnostics.length === 0) return '';
    const rows = diagnostics.map(d => {
      const pct = Math.round((d.score ?? 0) * 100);
      const scoreClass = this.getScoreClass(pct);
      return `
      <tr>
        <td><span class="score-badge ${scoreClass}">${pct}</span></td>
        <td class="opp-title">${this.escapeHtml(d.title)}</td>
        <td class="opp-desc">${this.escapeHtml(d.displayValue)}</td>
      </tr>`;
    }).join('');
    return `
    <div class="card">
      <h2 class="card-title">🔎 Diagnostics</h2>
      <p class="section-subtitle">Additional information about page performance.</p>
      <table class="audit-table">
        <thead><tr><th>Score</th><th>Audit</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  _buildNetworkSection(metrics) {
    const resources = Array.isArray(metrics.resources) ? metrics.resources : [];
    const totalTransfer = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
    const rows = resources.slice(0, 20).map((r, i) => `
      <tr>
        <td class="res-index">${i + 1}</td>
        <td class="res-name" title="${this.escapeHtml(r.name || '-')}">${this.truncateUrl(r.name || '-')}</td>
        <td>${this.formatSeconds(r.duration)}</td>
        <td>${this.formatBytes(r.transferSize)}</td>
        <td class="res-mime">${this.escapeHtml(r.mimeType || '-')}</td>
        <td>${r.statusCode || '-'}</td>
      </tr>`).join('');
    return `
    <div class="card">
      <h2 class="card-title">🔗 Network Requests</h2>
      <div class="summary-bar">
        <div class="summary-chip"><strong>${resources.length}</strong>Total Requests</div>
        <div class="summary-chip"><strong>${this.formatBytes(totalTransfer)}</strong>Total Transfer</div>
      </div>
      <table class="res-table">
        <thead><tr><th>#</th><th>URL</th><th>Duration</th><th>Transfer</th><th>MIME</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="res-empty-message">No network data captured.</td></tr>'}</tbody>
      </table>
    </div>`;
  }

  _buildCategoryAuditSection(metrics, cat) {
    const CATEGORY_META = {
      'performance':    { label: 'Performance',    icon: '⚡' },
      'accessibility':  { label: 'Accessibility',  icon: '♿' },
      'best-practices': { label: 'Best Practices', icon: '🔒' },
      'seo':            { label: 'SEO',            icon: '🔍' },
    };
    const categoryAudits = metrics.categoryAudits || {};
    const categoryScores = metrics.categoryScores || {};
    const audits = categoryAudits[cat] ?? [];
    const meta   = CATEGORY_META[cat] || { label: cat, icon: '📊' };
    const score  = categoryScores[cat] ?? null;
    const scoreClass = this.getScoreClass(score);

    if (audits.length === 0) {
      return `<div class="card"><p class="empty-state-message">No audit data for ${this.escapeHtml(meta.label)}.</p></div>`;
    }

    const failed     = audits.filter(a => a.score !== null && a.score < 0.9);
    const passed     = audits.filter(a => a.score !== null && a.score >= 0.9);
    const infoManual = audits.filter(a => a.score === null);

    const auditRow = (a) => {
      let badge;
      let statusClass;
      if (a.score === null) {
        badge = a.scoreDisplayMode === 'manual' ? '🔍' : 'ℹ';
        statusClass = a.scoreDisplayMode === 'manual' ? 'status-manual' : 'status-info';
      } else if (a.score >= 0.9) {
        badge = '✓';
        statusClass = 'status-good';
      } else if (a.score >= 0.5) {
        badge = '▲';
        statusClass = 'status-needs-improvement';
      } else {
        badge = '✕';
        statusClass = 'status-poor';
      }
      return `
        <tr>
          <td class="audit-status-cell">
            <span class="audit-status-badge ${statusClass}">${badge}</span>
          </td>
          <td class="opp-title">${this.escapeHtml(a.title)}</td>
          <td class="opp-desc">${this.escapeHtml(a.displayValue || '')}</td>
        </tr>`;
    };

    const failedRows  = [...failed, ...infoManual].map(auditRow).join('');
    const passedBlock = passed.length > 0 ? `
      <tr>
        <td colspan="3" class="audit-details-cell">
          <details class="audit-details">
            <summary class="audit-details-summary">
              <span class="audit-details-caret">▶</span> ${passed.length} passed audit${passed.length !== 1 ? 's' : ''}
            </summary>
            <table class="audit-details-table"><tbody>${passed.map(auditRow).join('')}</tbody></table>
          </details>
        </td>
      </tr>` : '';

    return `
    <div class="card">
      <h2 class="card-title">${meta.icon} ${this.escapeHtml(meta.label)} Audits
        <span class="cat-score-pill ${scoreClass}">${score !== null ? score : '—'}</span>
      </h2>
      <p class="section-subtitle">${failed.length} issue${failed.length !== 1 ? 's' : ''} · ${passed.length} passed · ${infoManual.length} informational</p>
      <table class="audit-table">
        <thead><tr><th class="audit-status-header"></th><th>Audit</th><th>Value</th></tr></thead>
        <tbody>${failedRows}${passedBlock}</tbody>
      </table>
    </div>`;
  }

  _buildAISuggestionsSection(aiSuggestions, categories) {
    const CATEGORY_META = {
      'performance':    { label: 'Performance',    icon: '⚡' },
      'accessibility':  { label: 'Accessibility',  icon: '♿' },
      'best-practices': { label: 'Best Practices', icon: '🔒' },
      'seo':            { label: 'SEO',            icon: '🔍' },
    };

    const catBlocks = categories
      .filter(cat => aiSuggestions && aiSuggestions[cat] && aiSuggestions[cat].length > 0)
      .map(cat => {
        const meta  = CATEGORY_META[cat] || { label: cat, icon: '📊' };
        const items = aiSuggestions[cat]
          .map(s => `<li class="ai-suggestion-item">${this.escapeHtml(s)}</li>`)
          .join('');
        return `
      <div class="ai-category-block">
        <div class="ai-category-label">${meta.icon} ${this.escapeHtml(meta.label)}</div>
        <ul class="ai-suggestion-list">${items}</ul>
      </div>`;
      }).join('');

    if (!catBlocks) {
      return `
    <div class="card">
      <h2 class="card-title">🤖 AI Fix Suggestions</h2>
      <p class="section-subtitle">No suggestions — all audits passed! 🎉</p>
    </div>`;
    }

    return `
    <div class="card">
      <h2 class="card-title">🤖 AI Fix Suggestions</h2>
      <p class="section-subtitle">Concise, developer-friendly fixes generated from failing audits by AI.</p>
      <div class="ai-disclaimer">⚠️ These suggestions are AI-generated. Always validate fixes in your own codebase context.</div>
      ${catBlocks}
    </div>`;
  }

  /**
   * Builds all tab content for one device panel (mobile or desktop).
   */
  _buildDevicePanel(device, metrics, categories, aiSuggestions) {
    const CATEGORY_META = {
      'performance':    { label: 'Performance',    icon: '⚡' },
      'accessibility':  { label: 'Accessibility',  icon: '♿' },
      'best-practices': { label: 'Best Practices', icon: '🔒' },
      'seo':            { label: 'SEO',            icon: '🔍' },
      'ai-suggestions': { label: 'AI Fixes',       icon: '🤖' },
    };

    const scoreCircles = this._buildScoreCircles(metrics, categories);
    const isPerf       = categories.includes('performance');

    // Pre-build content for each category
    const sectionMap = {};
    for (const cat of categories) {
      if (cat === 'performance') {
        sectionMap['performance'] =
          (isPerf ? this._buildVitalsSection(metrics)       : '') +
          (isPerf ? this._buildOpportunitiesSection(metrics) : '') +
          (isPerf ? this._buildDiagnosticsSection(metrics)   : '') +
          (isPerf ? this._buildNetworkSection(metrics)       : '');
      } else {
        sectionMap[cat] = this._buildCategoryAuditSection(metrics, cat);
      }
    }
    sectionMap['ai-suggestions'] = this._buildAISuggestionsSection(aiSuggestions, categories);

    const allCats = [...categories, 'ai-suggestions'];

    // Tab buttons — first tab active by default
    const tabBtns = allCats.map((cat, i) => {
      const m = CATEGORY_META[cat] || { label: cat, icon: '📊' };
      return `<button class="cat-tab${i === 0 ? ' active' : ''}" data-cat="${cat}" onclick="switchCategory('${device}','${cat}')">${m.icon} ${m.label}</button>`;
    }).join('');

    // Category sections — first one visible, rest hidden
    const sections = allCats.map((cat, i) =>
      `<div class="cat-section${i !== 0 ? ' hidden' : ''}" data-device="${device}" data-cat="${cat}">${sectionMap[cat] || ''}</div>`
    ).join('');

    return `
    <div class="scores-section">
      <div class="scores-section-title">Scores</div>
      <div class="scores-grid">${scoreCircles}</div>
    </div>
    <div class="category-tabs-bar">${tabBtns}</div>
    ${sections}`;
  }

  // ── Main HTML generator ─────────────────────────────────────────
  generateHTML(report) {
    // Support new format (mobileMetrics / desktopMetrics) and old single-device format
    const mobileMetrics  = report.mobileMetrics  || (report.formFactor === 'mobile'  ? report.metrics : null) || {};
    const desktopMetrics = report.desktopMetrics || (report.formFactor !== 'mobile'  ? report.metrics : null) || {};

    const selectedCats  = Array.isArray(report.categories) && report.categories.length > 0
      ? report.categories
      : ['performance'];
    const aiSuggestions = report.aiSuggestions || {};

    const hasMobile  = Object.keys(mobileMetrics).length  > 0;
    const hasDesktop = Object.keys(desktopMetrics).length > 0;
    const defaultDevice = hasMobile ? 'mobile' : 'desktop';

    const mobilePanel  = hasMobile
      ? this._buildDevicePanel('mobile',  mobileMetrics,  selectedCats, aiSuggestions)
      : '<p class="empty-state-message empty-state-message-lg">Mobile audit data not available.</p>';
    const desktopPanel = hasDesktop
      ? this._buildDevicePanel('desktop', desktopMetrics, selectedCats, aiSuggestions)
      : '<p class="empty-state-message empty-state-message-lg">Desktop audit data not available.</p>';

    const catLabels = selectedCats
      .map(c => ({ performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best Practices', seo: 'SEO' }[c] || c))
      .join(', ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lighthouse Report — ${this.escapeHtml(report.testName || 'Audit')}</title>
  <style>${this._css}</style>
</head>
<body>
  <div class="container">

    <!-- ── HEADER ── -->
    <div class="header">
      <h1>🔍 AI powered Audit Report</h1>
      <div class="header-meta">
        <span>📋 <strong>${this.escapeHtml(report.testName || 'Audit')}</strong></span>
        <span>🔗 ${this.escapeHtml(report.targetUrl || '—')}</span>
        <span>📅 ${new Date(report.generatedAt || Date.now()).toLocaleString()}</span>
      </div>
      <div class="cats-badge">📊 ${this.escapeHtml(catLabels)}</div>
    </div>

    <!-- ── DEVICE TABS ── -->
    <div class="device-tabs-bar">
      <button class="device-tab${defaultDevice === 'mobile'  ? ' active' : ''}" onclick="switchDevice('mobile')">📱 Mobile</button>
      <button class="device-tab${defaultDevice === 'desktop' ? ' active' : ''}" onclick="switchDevice('desktop')">💻 Desktop</button>
    </div>

    <!-- ── MOBILE PANEL ── -->
    <div class="device-panel${defaultDevice !== 'mobile' ? ' hidden' : ''}" data-device="mobile">
      ${mobilePanel}
    </div>

    <!-- ── DESKTOP PANEL ── -->
    <div class="device-panel${defaultDevice !== 'desktop' ? ' hidden' : ''}" data-device="desktop">
      ${desktopPanel}
    </div>

    <div class="footer">
      Generated by Lighthouse &bull; ${new Date().toISOString().split('T')[0]}
    </div>
  </div>

  <script>
    function switchDevice(device) {
      document.querySelectorAll('.device-tab').forEach(function(t) {
        t.classList.toggle('active', t.textContent.toLowerCase().includes(device));
      });
      document.querySelectorAll('.device-panel').forEach(function(p) {
        p.classList.toggle('hidden', p.dataset.device !== device);
      });
    }

    function switchCategory(device, cat) {
      var panel = document.querySelector('.device-panel[data-device="' + device + '"]');
      if (!panel) return;
      panel.querySelectorAll('.cat-tab').forEach(function(t) {
        t.classList.toggle('active', t.dataset.cat === cat);
      });
      panel.querySelectorAll('.cat-section').forEach(function(s) {
        s.classList.toggle('hidden', s.dataset.cat !== cat);
      });
    }
  </script>
</body>
</html>`;
  }
}
