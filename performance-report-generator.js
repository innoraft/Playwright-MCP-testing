import fs from 'fs';
import path from 'path';

export class PerformanceReportGenerator {
  constructor(config = {}) {
    this.outputDir = config.outputDir || 'test-reports';
  }

  ensureOutputDir() {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  generateReport(report) {
    this.ensureOutputDir();
    const filePath = path.join(this.outputDir, `performance_report_${Date.now()}.html`);
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

  scoreColor(score) {
    if (score >= 90) return '#0cce6b';
    if (score >= 50) return '#ffa400';
    return '#ff4e42';
  }

  ratingColor(rating) {
    if (rating === 'good')              return '#0cce6b';
    if (rating === 'needs-improvement') return '#ffa400';
    if (rating === 'poor')              return '#ff4e42';
    return '#9ca3af';
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
      const color = score !== null ? this.scoreColor(score) : '#9ca3af';
      const meta  = CATEGORY_META[cat] || { label: cat, icon: '📊' };
      const pct   = score ?? 0;
      return `
        <div class="score-card">
          <div class="score-gauge" style="--sc:${color};--sv:${pct}">
            <div class="score-inner">
              <div class="score-num" style="color:${color}">${score !== null ? score : '—'}</div>
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
      const color  = this.ratingColor(rating);
      const disp   = v.key === 'cls' ? this.formatNumber(v.value) : this.formatSeconds(v.value);
      return `
        <div class="vital-card" style="--vc:${color}">
          <div class="vital-ring"><div class="vital-value">${disp}</div></div>
          <div class="vital-label">${v.label}</div>
          <div class="vital-desc">${v.description}</div>
          <div class="vital-rating" style="color:${color}">${this.ratingLabel(rating)}</div>
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
      const col = this.scoreColor(pct);
      return `
      <tr>
        <td><span class="score-badge" style="background:${col}">${pct}</span></td>
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
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No network data captured.</td></tr>'}</tbody>
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
    const sColor = score !== null ? this.scoreColor(score) : '#9ca3af';

    if (audits.length === 0) {
      return `<div class="card"><p style="color:#94a3b8;text-align:center;padding:20px">No audit data for ${this.escapeHtml(meta.label)}.</p></div>`;
    }

    const failed     = audits.filter(a => a.score !== null && a.score < 0.9);
    const passed     = audits.filter(a => a.score !== null && a.score >= 0.9);
    const infoManual = audits.filter(a => a.score === null);

    const auditRow = (a) => {
      let badge, bColor;
      if (a.score === null) {
        badge = a.scoreDisplayMode === 'manual' ? '🔍' : 'ℹ';
        bColor = '#64748b';
      } else if (a.score >= 0.9) {
        badge = '✓'; bColor = '#0cce6b';
      } else if (a.score >= 0.5) {
        badge = '▲'; bColor = '#ffa400';
      } else {
        badge = '✕'; bColor = '#ff4e42';
      }
      return `
        <tr>
          <td style="width:34px;text-align:center;vertical-align:middle">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${bColor};color:#fff;font-size:11px;font-weight:700">${badge}</span>
          </td>
          <td class="opp-title">${this.escapeHtml(a.title)}</td>
          <td class="opp-desc">${this.escapeHtml(a.displayValue || '')}</td>
        </tr>`;
    };

    const failedRows  = [...failed, ...infoManual].map(auditRow).join('');
    const passedBlock = passed.length > 0 ? `
      <tr>
        <td colspan="3" style="padding:0">
          <details style="padding:0 12px 8px">
            <summary style="cursor:pointer;font-size:13px;color:#64748b;padding:10px 0;list-style:none;display:flex;align-items:center;gap:6px">
              <span style="font-size:10px">▶</span> ${passed.length} passed audit${passed.length !== 1 ? 's' : ''}
            </summary>
            <table style="width:100%;border-collapse:collapse"><tbody>${passed.map(auditRow).join('')}</tbody></table>
          </details>
        </td>
      </tr>` : '';

    return `
    <div class="card">
      <h2 class="card-title">${meta.icon} ${this.escapeHtml(meta.label)} Audits
        <span class="cat-score-pill" style="background:${sColor}">${score !== null ? score : '—'}</span>
      </h2>
      <p class="section-subtitle">${failed.length} issue${failed.length !== 1 ? 's' : ''} · ${passed.length} passed · ${infoManual.length} informational</p>
      <table class="audit-table">
        <thead><tr><th style="width:34px"></th><th>Audit</th><th>Value</th></tr></thead>
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
      : '<p style="color:#94a3b8;text-align:center;padding:40px">Mobile audit data not available.</p>';
    const desktopPanel = hasDesktop
      ? this._buildDevicePanel('desktop', desktopMetrics, selectedCats, aiSuggestions)
      : '<p style="color:#94a3b8;text-align:center;padding:40px">Desktop audit data not available.</p>';

    const catLabels = selectedCats
      .map(c => ({ performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best Practices', seo: 'SEO' }[c] || c))
      .join(', ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lighthouse Report — ${this.escapeHtml(report.testName || 'Audit')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: #f0f4f8; color: #1a202c; margin: 0; line-height: 1.55; }
    .container { max-width: 1100px; margin: 0 auto; padding: 28px 20px; }

    /* ── HEADER ── */
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #2563eb 100%); color: #fff; border-radius: 20px; padding: 28px 32px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 14px; font-size: 26px; font-weight: 800; }
    .header-meta { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 13px; opacity: 0.92; }
    .header-meta span { display: flex; align-items: center; gap: 5px; }
    .cats-badge { display: inline-block; margin-top: 12px; background: rgba(255,255,255,0.15); border-radius: 6px; padding: 3px 12px; font-size: 12px; }

    /* ── DEVICE TABS ── */
    .device-tabs-bar { display: flex; gap: 4px; background: #fff; border-radius: 14px; padding: 6px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .device-tab { flex: 1; padding: 10px 20px; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; background: transparent; color: #64748b; transition: background 0.15s, color 0.15s; }
    .device-tab.active { background: #0f172a; color: #fff; }
    .device-tab:hover:not(.active) { background: #f1f5f9; color: #334155; }

    /* ── DEVICE PANELS ── */
    .device-panel.hidden { display: none; }

    /* ── SCORE GAUGES ── */
    .scores-section { background: #fff; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .scores-section-title { margin: 0 0 20px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
    .scores-grid { display: flex; gap: 28px; flex-wrap: wrap; justify-content: center; }
    .score-card { text-align: center; }
    .score-gauge { width: 110px; height: 110px; border-radius: 50%; background: conic-gradient(var(--sc) calc(var(--sv) * 1%), #e8eaed calc(var(--sv) * 1%)); display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; }
    .score-inner { width: 88px; height: 88px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
    .score-num { font-size: 26px; font-weight: 800; }
    .score-label { font-size: 13px; font-weight: 600; color: #334155; }

    /* ── CATEGORY TABS ── */
    .category-tabs-bar { display: flex; gap: 4px; background: #fff; border-radius: 14px; padding: 6px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); flex-wrap: wrap; }
    .cat-tab { padding: 8px 16px; border: none; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; background: transparent; color: #64748b; transition: background 0.15s, color 0.15s; white-space: nowrap; }
    .cat-tab.active { background: #2563eb; color: #fff; }
    .cat-tab:hover:not(.active) { background: #f1f5f9; color: #334155; }

    /* ── CATEGORY SECTIONS ── */
    .cat-section.hidden { display: none; }

    /* ── CARDS ── */
    .card { background: #fff; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .card-title { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .section-subtitle { margin: 0 0 16px; font-size: 13px; color: #64748b; }
    .cat-score-pill { font-size: 12px; font-weight: 700; color: #fff; padding: 2px 10px; border-radius: 12px; }

    /* ── VITALS ── */
    .vitals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; }
    .vital-card { text-align: center; padding: 16px 8px; border: 2px solid var(--vc, #e2e8f0); border-radius: 14px; background: #fafbff; }
    .vital-ring { width: 76px; height: 76px; margin: 0 auto 8px; border-radius: 50%; border: 5px solid var(--vc, #9ca3af); display: flex; align-items: center; justify-content: center; }
    .vital-value { font-size: 12px; font-weight: 700; color: #1e293b; }
    .vital-label { font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 2px; }
    .vital-desc { font-size: 10px; color: #64748b; margin-bottom: 4px; }
    .vital-rating { font-size: 11px; font-weight: 600; }

    /* ── AUDIT TABLES ── */
    .audit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .audit-table th { background: #f8fafc; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 12px; text-align: left; border-bottom: 2px solid #e2e8f0; }
    .audit-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .audit-table tr:last-child td { border-bottom: none; }
    .opp-title { font-weight: 600; color: #1e293b; }
    .opp-savings { white-space: nowrap; font-weight: 700; color: #0f766e; width: 120px; }
    .opp-desc { color: #64748b; font-size: 12px; }
    .score-badge { display: inline-block; width: 34px; height: 20px; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 700; text-align: center; line-height: 20px; }

    /* ── NETWORK TABLE ── */
    .res-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .res-table th { background: #f8fafc; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 9px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; }
    .res-table td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
    .res-index { color: #94a3b8; font-weight: 600; width: 26px; }
    .res-name { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; }
    .res-mime { color: #94a3b8; font-size: 11px; }

    .summary-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .summary-chip { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 14px; font-size: 13px; color: #334155; }
    .summary-chip strong { font-size: 16px; display: block; color: #1e40af; }

    /* ── AI SUGGESTIONS ── */
    .ai-disclaimer { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 8px 14px; font-size: 12px; color: #92400e; margin-bottom: 16px; }
    .ai-category-block { margin-bottom: 20px; }
    .ai-category-label { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 10px; }
    .ai-suggestion-list { margin: 0; padding-left: 20px; }
    .ai-suggestion-item { margin-bottom: 8px; font-size: 14px; color: #334155; line-height: 1.6; }
    .ai-suggestion-item::marker { color: #2563eb; }

    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 20px; padding-top: 14px; border-top: 1px solid #e2e8f0; }

    @media (max-width: 640px) {
      .scores-grid { gap: 18px; }
      .vitals-grid { grid-template-columns: repeat(2, 1fr); }
      .header { padding: 20px; }
      .device-tab, .cat-tab { font-size: 12px; padding: 8px 10px; }
    }
  </style>
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
