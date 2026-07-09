/**
 * Runs a Lighthouse audit against a URL.
 * Spawns a fresh, isolated Chrome process directly (bypasses chrome-launcher),
 * waits for CDP to be ready, then connects Lighthouse via the port.
 * No existing browser session is reused — each audit gets a clean temp profile.
 *
 * PSI compatibility:
 *  - channel: 'lr' aligns Lighthouse config defaults with PageSpeed Insights
 *  - Throttling profiles mirror PSI's lab settings (no hardcoded derived values)
 *  - Runs 3 audits and picks the median by performance score (matches PSI behaviour)
 *  - INP captured as a Core Web Vital alongside FCP, LCP, TBT, CLS
 */
import lighthouse from 'lighthouse';
import { spawn }        from 'child_process';
import { createServer } from 'net';
import { rmSync }       from 'fs';

const DESKTOP_SCREEN = {
  mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false
};
const MOBILE_SCREEN = {
  mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false
};

const DESKTOP_THROTTLE = {
  rttMs: 40,
  throughputKbps: 10240,
  cpuSlowdownMultiplier: 1,
};

const MOBILE_THROTTLE = {
  rttMs: 150,
  throughputKbps: 1638.4,
  cpuSlowdownMultiplier: 4,
};

// Internal helpers

/**
 * Returns a free TCP port on 127.0.0.1 by binding to port 0 and reading back
 * the OS-assigned port, then immediately releasing it.
 */
async function _getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Polls http://127.0.0.1:<port>/json/version until Chrome's CDP endpoint responds.
 * Throws if Chrome isn't ready within `timeoutMs`.
 */
async function _waitForCDP(port, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Chrome CDP did not become ready on port ${port} within ${timeoutMs}ms`);
}

/**
 * Spawns a fresh isolated Chromium process with all flags needed on Linux.
 * Returns { port, kill() } — call kill() when done to terminate Chrome and
 * remove its temporary profile directory.
 */
async function _spawnChrome(chromiumPath) {
  const port   = await _getFreePort();
  const tmpDir = `/tmp/lh-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const proc = spawn(chromiumPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpDir}`,

    '--headless=new',

    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',

    '--no-first-run',
    '--no-default-browser-check',

    '--disable-extensions',

    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',

    '--disable-features=Translate',

    '--metrics-recording-only',
    '--mute-audio',
    '--hide-scrollbars',
  ], {
    detached: false,
    stdio: 'ignore'
  });

  await _waitForCDP(port);

  return {
    port,
    kill() {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* ignore */ }
        }, 2000);
      } catch { /* already exited */ }
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/**
 * Builds the Lighthouse flags object for a given port/formFactor/categories.
 * Extracted so the same config is used identically across all runs in a
 * median-of-N invocation.
 */
function _buildFlags(port, formFactor, categories) {
  const isMobile = formFactor === 'mobile';
  return {
    locale:           'en',
    port,
    output:           'json',
    logLevel:         'error',
    onlyCategories:   categories,
    formFactor:       isMobile ? 'mobile' : 'desktop',
    screenEmulation:  isMobile ? MOBILE_SCREEN : DESKTOP_SCREEN,
    emulatedUserAgent: isMobile
      ? 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    throttling:       isMobile ? MOBILE_THROTTLE : DESKTOP_THROTTLE,
    throttlingMethod: 'simulate',
    disableStorageReset: false,
    // 'lr' aligns Lighthouse's internal config preset with PageSpeed Insights
    channel:          'lr',
  };
}

/**
 * Extracts the structured metrics object from a raw Lighthouse result (lhr).
 */
function _extractMetrics(lhr, categories) {
  const roundMs = (id) => {
    const v = lhr.audits?.[id]?.numericValue;
    return v != null ? Math.round(v) : null;
  };

  // Core Web Vitals + key timing metrics
  const fcp        = roundMs('first-contentful-paint');
  const lcp        = roundMs('largest-contentful-paint');
  const tbt        = roundMs('total-blocking-time');
  const cls        = lhr.audits?.['cumulative-layout-shift']?.numericValue ?? null;
  const inp        = roundMs('interaction-to-next-paint');
  const tti        = roundMs('interactive');
  const speedIndex = roundMs('speed-index');
  const ttfb       = roundMs('server-response-time');
  const fmp        = roundMs('first-meaningful-paint');

  const performanceScore = Math.round((lhr.categories?.performance?.score ?? 0) * 100);

  // Category scores for all audited categories
  const categoryScores = {};
  for (const cat of categories) {
    const catResult = lhr.categories?.[cat];
    categoryScores[cat] = catResult?.score != null
      ? Math.round(catResult.score * 100)
      : null;
  }

  // All audits per category, sorted worst-first for report display
  const categoryAudits = {};
  for (const cat of categories) {
    const auditRefs = lhr.categories?.[cat]?.auditRefs ?? [];
    categoryAudits[cat] = auditRefs
      .map(ref => {
        const a = lhr.audits?.[ref.id];
        if (!a) return null;
        return {
          id:               a.id,
          title:            a.title,
          description:      a.description,
          score:            a.score,
          displayValue:     a.displayValue ?? '',
          scoreDisplayMode: a.scoreDisplayMode,
          weight:           ref.weight ?? 0,
        };
      })
      .filter(Boolean)
      .filter(a => a.scoreDisplayMode !== 'not-applicable')
      .sort((a, b) => {
        // null (informative/manual) → after failing, before passing
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return a.score - b.score;
      });
  }

  // Network requests
  const networkItems = lhr.audits?.['network-requests']?.details?.items ?? [];
  const resources = networkItems
    .filter(r => r.url)
    .map(r => ({
      name:            r.url,
      duration:        Math.round((r.endTime ?? 0) - (r.startTime ?? 0)),
      transferSize:    r.transferSize ?? 0,
      encodedBodySize: r.resourceSize ?? 0,
      mimeType:        r.mimeType ?? '',
      statusCode:      r.statusCode ?? 0
    }))
    .sort((a, b) => b.duration - a.duration);

  // Opportunities (audits with potential time savings)
  const opportunities = Object.values(lhr.audits ?? {})
    .filter(a => a.details?.type === 'opportunity' && (a.numericValue ?? 0) > 50)
    .sort((a, b) => b.numericValue - a.numericValue)
    .slice(0, 8)
    .map(a => ({
      id:           a.id,
      title:        a.title,
      description:  a.description,
      savingsMs:    Math.round(a.numericValue),
      displayValue: a.displayValue ?? ''
    }));

  // Diagnostics (table audits with score < 1)
  const diagnostics = Object.values(lhr.audits ?? {})
    .filter(a => a.details?.type === 'table' && a.score !== null && a.score !== undefined && a.score < 1)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 8)
    .map(a => ({
      id:           a.id,
      title:        a.title,
      description:  a.description,
      score:        a.score,
      displayValue: a.displayValue ?? ''
    }));

  return {
    // Core Web Vitals (null when 'performance' not in categories)
    fcp, lcp, tbt, cls, inp, tti, speedIndex, ttfb, fmp,
    performanceScore,
    // Compat shape retained for report generator
    navigation: { responseStart: ttfb, domContentLoaded: null, loadEventEnd: null },
    paints: { 'first-paint': fmp, 'first-contentful-paint': fcp },
    // Lists
    resources,
    opportunities,
    diagnostics,
    // Multi-category data
    categoryScores,
    categoryAudits,
    categories: categoryScores,
  };
}

// Public API

/**
 * Runs a Lighthouse audit using freshly spawned, isolated Chrome instances.
 * Performs `runs` sequential audits and returns the median result by
 * performance score — mirroring how PageSpeed Insights reduces variance.
 *
 * @param {string}   url           - Page URL to audit
 * @param {string}   chromiumPath  - Absolute path to the Chromium executable
 * @param {'desktop'|'mobile'} formFactor
 * @param {string[]} categories    - Lighthouse category IDs to audit
 * @param {number}   runs          - Number of runs; median is returned (default 3)
 * @returns {Promise<{ metrics: object, lhr: object }>}
 */
export async function runLighthouseAudit(
  url,
  chromiumPath,
  formFactor = 'desktop',
  categories = ['performance'],
  runs = 3,
) {
  const lhrs = [];

  for (let i = 0; i < runs; i++) {
    const chrome = await _spawnChrome(chromiumPath);
    try {
      console.log(`ℹ️  ${formFactor} run ${i + 1}/${runs}: auditing...`);
      const flags = _buildFlags(chrome.port, formFactor, categories);
      const { lhr } = await lighthouse(url, flags);
      const score = Math.round((lhr.categories?.performance?.score ?? 0) * 100);
      console.log(`ℹ️  ${formFactor} run ${i + 1}/${runs}: done (score: ${score})`);
      lhrs.push(lhr);
    } finally {
      chrome.kill();
    }
  }

  // Sort by performance score and pick the middle run (median)
  lhrs.sort((a, b) =>
    (a.categories?.performance?.score ?? 0) - (b.categories?.performance?.score ?? 0)
  );
  const medianLhr = lhrs[Math.floor(lhrs.length / 2)];

  const metrics = _extractMetrics(medianLhr, categories);
  return { metrics, lhr: medianLhr };
}
