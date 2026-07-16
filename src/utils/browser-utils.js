import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Resolves the Chromium executable path using multiple fallback strategies.
 * Exported so it can be reused across different runners.
 * @returns {string} Absolute path to Chromium binary
 */
export function findChromiumPath() {
  let chromiumPath;

  try {
    const reported = execSync('node -e "const pw = require(\'playwright-core\'); console.log(pw.chromium.executablePath())"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (reported && fs.existsSync(reported)) chromiumPath = reported;
  } catch { /* ignore */ }

  if (!chromiumPath) {
    const cacheDir = path.join(process.env.HOME || '/root', '.cache', 'ms-playwright');
    try {
      const dirs = fs.readdirSync(cacheDir)
        .filter(d => d.startsWith('chromium-') && !d.includes('headless'))
        .sort().reverse();
      for (const dir of dirs) {
        const candidates = [
          path.join(cacheDir, dir, 'chrome-linux64', 'chrome'),
          path.join(cacheDir, dir, 'chrome-linux', 'chrome')
        ];
        const found = candidates.find(candidate => fs.existsSync(candidate));
        if (found) {
          chromiumPath = found;
          break;
        }
      }
    } catch { /* ignore */ }
  }

  if (!chromiumPath) {
    const fallbacks = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];
    chromiumPath = fallbacks.find(candidate => fs.existsSync(candidate)) || '';
  }

  if (!chromiumPath || !fs.existsSync(chromiumPath)) {
    throw new Error('Chromium not found. Run "npx playwright install chromium" to install it.');
  }

  return chromiumPath;
}
