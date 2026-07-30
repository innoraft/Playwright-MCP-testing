import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import multer from 'multer';
import {
  initializeAuth,
  signToken,
  authenticate,
  requireAuth,
  requireAdminRole,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  requestPasswordReset,
  getResetRequests,
  clearResetRequest
} from './auth.js';
import {
  setOwner,
  getOwner,
  removeOwner,
  setOwnerBulk,
  getOwnedFilenames,
  isOwnerOrAdmin,
  migrateExistingFiles
} from './ownership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'llm.config.js');
const TESTS_DIR = path.join(__dirname, '..', 'tests');
const REPORTS_DIR = path.join(__dirname, '..', 'test-reports');
const PROJECT_ROOT = path.join(__dirname, '..');
const FILES_DIR = path.join(PROJECT_ROOT, 'files');
const BASELINES_DIR = path.join(FILES_DIR, 'baselines');

function findChromiumPath() {
  let chromiumPath;

  try {
    const reported = execSync('node -e "const pw = require(\'playwright-core\'); console.log(pw.chromium.executablePath())"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    if (reported && fs.existsSync(reported)) chromiumPath = reported;
  } catch { /* ignore */ }

  if (!chromiumPath) {
    const cacheDir = path.join(process.env.HOME || '/root', '.cache', 'ms-playwright');
    try {
      const dirs = fs.readdirSync(cacheDir)
        .filter(d => d.startsWith('chromium-') && !d.includes('headless'))
        .sort()
        .reverse();
      for (const dir of dirs) {
        const candidates = [
          path.join(cacheDir, dir, 'chrome-linux64', 'chrome'),
          path.join(cacheDir, dir, 'chrome-linux', 'chrome')
        ];
        const found = candidates.find(p => fs.existsSync(p));
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
    chromiumPath = fallbacks.find(p => fs.existsSync(p)) || '';
  }

  if (!chromiumPath || !fs.existsSync(chromiumPath)) {
    throw new Error('Chromium not found. Run "npx playwright install chromium" to install it.');
  }

  return chromiumPath;
}

function detectTestType(content = '') {
  const trimmed = content.trimStart().toLowerCase();
  if (trimmed.startsWith('schemaversion:') || /(^|\n)\s*performance\s*:/i.test(content)) {
    return 'performance';
  }
  if (/(^|\n)\s*tests\s*:/i.test(content)) {
    return 'general';
  }
  if (trimmed.startsWith('name:')) {
    return 'visual-regression';
  }
  if (/(^|\n)\s*form-validation\s*:/i.test(content)) {
    return 'form-validation';
  }
  return 'general';
}

// Ensure base directories exist
fs.mkdirSync(BASELINES_DIR, { recursive: true });
fs.mkdirSync(path.join(FILES_DIR, 'diffs'), { recursive: true });
fs.mkdirSync(path.join(FILES_DIR, 'screenshots'), { recursive: true });

// Helper: check if the current user has admin role
function reqIsAdmin(req) {
  if (!req.user || !Array.isArray(req.user.roles)) return false;
  return req.user.roles.some((role) => String(role).toLowerCase() === 'admin');
}

// Setup multer for baseline uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin requests (no origin header), localhost dev, and production domain
    const allowed = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/ai-testing\.innoraft-sites\.com$/,
    ];
    if (!origin || allowed.some(pattern => pattern.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json({ limit: '10mb' }));

// ── Static serving for test reports & images ────────────────
app.use('/reports', express.static(REPORTS_DIR));
app.use('/files/baselines', express.static(BASELINES_DIR));
app.use('/files/diffs', express.static(path.join(FILES_DIR, 'diffs')));
app.use('/files/screenshots', express.static(path.join(FILES_DIR, 'screenshots')));

// ══════════════════════════════════════════════════════════
//  AUTHENTICATION ENDPOINTS
// ══════════════════════════════════════════════════════════

// ── POST /api/auth/login ───────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    active: user.active
  });
});

// ── POST /api/auth/change-password ─────────────────────────
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new passwords are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Verify current password
    const user = await authenticate(req.user.username, currentPassword);
    if (!user) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    await updateUser(req.user.userId, { password: newPassword });
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ══════════════════════════════════════════════════════════
//  USER MANAGEMENT ENDPOINTS (Admin only)
// ══════════════════════════════════════════════════════════

// ── POST /api/auth/forgot-password ───────────────────────
app.post('/api/auth/forgot-password', (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const result = requestPasswordReset(username);
    // Always return success to avoid username enumeration
    res.json({
      success: true,
      message: 'If the account exists, a password reset request has been submitted. Your administrator will set a new password for you.'
    });
    if (result) {
      console.log(`🔑 Password reset requested for user: ${username}`);
    }
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process reset request' });
  }
});

// ── GET /api/users/reset-requests (Admin) ───────────────
app.get('/api/users/reset-requests', requireAuth, requireAdminRole, (req, res) => {
  res.json(getResetRequests());
});

// ── POST /api/users/:id/admin-reset (Admin) ─────────────
app.post('/api/users/:id/admin-reset', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await updateUser(req.params.id, { password: newPassword });
    clearResetRequest(req.params.id);
    console.log(`🛡️ Admin reset password for user: ${user.username}`);
    res.json({ success: true, message: `Password reset for ${user.username}` });
  } catch (err) {
    console.error('Admin reset error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/users/:id/reset-request (Admin) ─────────
app.delete('/api/users/:id/reset-request', requireAuth, requireAdminRole, (req, res) => {
  try {
    clearResetRequest(req.params.id);
    res.json({ success: true, message: 'Reset request dismissed' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/users ─────────────────────────────────────────
app.get('/api/users', requireAuth, requireAdminRole, (req, res) => {
  res.json(getAllUsers());
});

// ── POST /api/users ────────────────────────────────────────
app.post('/api/users', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const { username, email, password, roles } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await createUser({ username, email, password, roles });
    res.json({ success: true, user });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /api/users/:id ─────────────────────────────────────
app.put('/api/users/:id', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const { username, email, password, roles, active } = req.body;
    const user = await updateUser(req.params.id, { username, email, password, roles, active });
    res.json({ success: true, user });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /api/users/:id/toggle-active ───────────────────────
app.put('/api/users/:id/toggle-active', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const updated = await updateUser(req.params.id, { active: !user.active });
    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('Toggle user error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── Helper: Read config from llm.config.js ─────────────────
function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    // Parse the JS object literal out of: const llmConfig = { ... };
    const match = raw.match(/const\s+llmConfig\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      return { provider: 'openai', model: 'gpt-5', apiKey: '', temperature: 1 };
    }
    // Use Function constructor to safely evaluate the object literal
    const config = new Function(`return ${match[1]}`)();
    return config;
  } catch {
    return { provider: 'openai', model: 'gpt-5', apiKey: '', temperature: 1 };
  }
}

// ── Helper: Write config to llm.config.js ──────────────────
function writeConfig(data) {
  const jsContent = `const llmConfig = {
  provider: '${data.provider}',
  model: '${data.model}',
  apiKey: ${JSON.stringify(data.apiKey || '')},
  temperature: ${data.temperature !== undefined ? Number(data.temperature) : 1}
};

export default llmConfig
`;
  fs.writeFileSync(CONFIG_PATH, jsContent, 'utf-8');
}

// ══════════════════════════════════════════════════════════
//  LLM CONFIG ENDPOINTS
// ══════════════════════════════════════════════════════════

// ── GET /api/llm-config ────────────────────────────────────
app.get('/api/llm-config', requireAuth, requireAdminRole, (req, res) => {
  const config = readConfig();
  res.json({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature
  });
});

// ── POST /api/llm-config ───────────────────────────────────
app.post('/api/llm-config', requireAuth, requireAdminRole, (req, res) => {
  const { provider, model, apiKey, temperature } = req.body;

  if (!provider || !model) {
    return res.status(400).json({ error: 'Provider and model are required' });
  }

  const config = {
    provider,
    model,
    apiKey: apiKey || '',
    temperature: temperature !== undefined ? Number(temperature) : 1
  };

  try {
    writeConfig(config);
    res.json({ success: true, message: 'LLM configuration saved successfully' });
  } catch (err) {
    console.error('Failed to save config:', err);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// ══════════════════════════════════════════════════════════
//  TEST FILE ENDPOINTS
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  BASELINE ENDPOINTS
// ══════════════════════════════════════════════════════════

// ── GET /api/baselines ─────────────────────────────────────
app.get('/api/baselines', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(BASELINES_DIR)) {
      return res.json([]);
    }

    const isAdmin = reqIsAdmin(req);
    const ownedFiles = new Set(getOwnedFilenames('baselines', req.user.userId, isAdmin));

    const files = fs.readdirSync(BASELINES_DIR)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .filter(f => isAdmin || ownedFiles.has(f))
      .map(f => {
        const stat = fs.statSync(path.join(BASELINES_DIR, f));
        const match = f.match(/^(.*)_(\d+px)\.(png|jpg|jpeg)$/i);
        return {
          filename: f,
          testName: match ? match[1] : 'Unknown',
          breakpoint: match ? match[2] : 'Unknown',
          sizeBytes: stat.size,
          modified: stat.mtimeMs
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json(files);
  } catch (err) {
    console.error('Failed to list baselines:', err);
    res.status(500).json({ error: 'Failed to list baseline images' });
  }
});

// ── POST /api/baselines/upload ─────────────────────────────
app.post('/api/baselines/upload', requireAuth, upload.single('image'), (req, res) => {
  try {
    const { testName, breakpoint } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only PNG, JPG and JPEG images are supported' });
    }

    if (!testName || !breakpoint) {
      return res.status(400).json({ error: 'testName and breakpoint are required' });
    }

    // Determine extension from uploaded file
    const ext = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    // Generate safe filename matches what visual-regression.js expects
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBreakpoint = breakpoint.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}_${safeBreakpoint}.png`;
    const filePath = path.join(BASELINES_DIR, filename);

    // Prevent silent overwrite: duplicate baseline names must be explicit.
    if (fs.existsSync(filePath)) {
      return res.status(409).json({
        error: `A baseline file named "${filename}" already exists. Please change the test name or breakpoint (or rename the file) and try again.`
      });
    }

    fs.writeFileSync(filePath, req.file.buffer);

    // Track ownership
    setOwner('baselines', filename, req.user.userId);

    res.json({
      success: true,
      message: 'Baseline image uploaded successfully',
      filename,
      path: `files/baselines/${filename}`
    });
  } catch (err) {
    console.error('Failed to save baseline:', err);
    res.status(500).json({ error: 'Failed to save baseline image' });
  }
});

// ── DELETE /api/baselines/:filename ────────────────────────
app.delete('/api/baselines/:filename', requireAuth, (req, res) => {
  try {
    const fileName = req.params.filename;

    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    const filePath = path.join(BASELINES_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Baseline image not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Deleted ${fileName}` });
  } catch (err) {
    console.error('Failed to delete baseline:', err);
    res.status(500).json({ error: 'Failed to delete baseline image' });
  }
});

// ── GET /api/tests ─────────────────────────────────────────
// List test files owned by the current user (admin sees all)
app.get('/api/tests', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(TESTS_DIR)) {
      fs.mkdirSync(TESTS_DIR, { recursive: true });
    }

    const isAdmin = reqIsAdmin(req);
    const ownedFiles = new Set(getOwnedFilenames('tests', req.user.userId, isAdmin));

    const files = fs.readdirSync(TESTS_DIR)
      .filter(f => f.endsWith('.test.yml'))
      .filter(f => isAdmin || ownedFiles.has(f))
      .map(f => {
        const filePath = path.join(TESTS_DIR, f);
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        const type = detectTestType(content);
        return {
          name: f,
          type,
          createdAt: stats.birthtime ? stats.birthtime.toISOString() : null,
          modifiedAt: stats.mtime ? stats.mtime.toISOString() : null,
        };
      });

    res.json(files);
  } catch (err) {
    console.error('Failed to list tests:', err);
    res.status(500).json({ error: 'Failed to list test files' });
  }
});

// ── GET /api/tests/:name ───────────────────────────────────
// Read a single test file (must be owner or admin)
app.get('/api/tests/:name', requireAuth, (req, res) => {
  try {
    const fileName = req.params.name;
    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!isOwnerOrAdmin('tests', fileName, req.user.userId, reqIsAdmin(req))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const filePath = path.join(TESTS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Test file not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ name: fileName, content });
  } catch (err) {
    console.error('Failed to read test:', err);
    res.status(500).json({ error: 'Failed to read test file' });
  }
});

// ── POST /api/tests ────────────────────────────────────────
// Save (create or update) a test file.
// • New test  → duplicate-name guard runs
// • Edit      → client sends `oldName` (the original filename)
//               so the guard skips that file and if the name
//               changed the old file is deleted after saving.
app.post('/api/tests', requireAuth, (req, res) => {
  try {
    const { name, content, oldName } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    // Ensure name ends with .test.yml
    let fileName = name;
    if (!fileName.endsWith('.test.yml')) {
      fileName = fileName.replace(/\.yml$/, '').replace(/\.test$/, '');
      fileName = `${fileName}.test.yml`;
    }

    // Normalize oldName the same way
    let oldFileName = oldName || null;
    if (oldFileName && !oldFileName.endsWith('.test.yml')) {
      oldFileName = oldFileName.replace(/\.yml$/, '').replace(/\.test$/, '');
      oldFileName = `${oldFileName}.test.yml`;
    }

    // Sanitize
    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!fs.existsSync(TESTS_DIR)) {
      fs.mkdirSync(TESTS_DIR, { recursive: true });
    }

    const filePath = path.join(TESTS_DIR, fileName);

    // ── Duplicate-name guard ──────────────────────────────
    // Normalise names so "my-test" and "my_test" are treated
    // as the same name.  When editing (oldName provided), the
    // old file is excluded from the collision check.
    const normalize = (n) => n.replace(/\.test\.yml$/, '').replace(/[-_]+/g, '_').toLowerCase();
    const incomingNorm = normalize(fileName);
    const oldNorm = oldFileName ? normalize(oldFileName) : null;

    const typeLabels = {
      'general': 'General Test',
      'visual-regression': 'Visual Regression',
      'performance': 'Performance Metrics',
      'form-validation': 'Form Validation',
    };

    const existingFiles = fs.existsSync(TESTS_DIR)
      ? fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.test.yml'))
      : [];

    for (const existing of existingFiles) {
      const existingNorm = normalize(existing);
      // Skip the file we're editing (it's being replaced / renamed)
      if (oldNorm && existingNorm === oldNorm) continue;
      if (existingNorm === incomingNorm) {
        const existingContent = fs.readFileSync(path.join(TESTS_DIR, existing), 'utf-8');
        const existingType = detectTestType(existingContent);
        const label = typeLabels[existingType] || existingType;
        return res.status(409).json({
          error: `A test named "${existing.replace('.test.yml', '')}" already exists as a "${label}" test. Please choose a different name.`,
        });
      }
    }

    // Write the new / updated file
    fs.writeFileSync(filePath, content, 'utf-8');

    // Track ownership — creator owns it
    setOwner('tests', fileName, req.user.userId);

    // If the name changed during an edit, delete the old file
    if (oldFileName && normalize(oldFileName) !== normalize(fileName)) {
      const oldPath = path.join(TESTS_DIR, oldFileName);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
        removeOwner('tests', oldFileName);
      }
    }

    res.json({ success: true, message: `Test saved as ${fileName}`, fileName });
  } catch (err) {
    console.error('Failed to save test:', err);
    res.status(500).json({ error: 'Failed to save test file' });
  }
});

// ── DELETE /api/tests/:name ────────────────────────────────
// Delete a test file (must be owner or admin)
app.delete('/api/tests/:name', requireAuth, (req, res) => {
  try {
    const fileName = req.params.name;

    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!isOwnerOrAdmin('tests', fileName, req.user.userId, reqIsAdmin(req))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const filePath = path.join(TESTS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Test file not found' });
    }

    fs.unlinkSync(filePath);
    removeOwner('tests', fileName);
    res.json({ success: true, message: `Deleted ${fileName}` });
  } catch (err) {
    console.error('Failed to delete test:', err);
    res.status(500).json({ error: 'Failed to delete test file' });
  }
});

// ── DELETE /api/tests ─────────────────────────────────────
// Delete all visible test files for the current user (must be owner or admin)
app.delete('/api/tests', requireAuth, (req, res) => {
  try {
    const isAdmin = reqIsAdmin(req);
    const ownedFiles = new Set(getOwnedFilenames('tests', req.user.userId, isAdmin));
    const deletableFiles = fs.existsSync(TESTS_DIR)
      ? fs.readdirSync(TESTS_DIR)
          .filter((f) => f.endsWith('.test.yml'))
          .filter((f) => isAdmin || ownedFiles.has(f))
      : [];

    let deletedCount = 0;
    for (const fileName of deletableFiles) {
      const filePath = path.join(TESTS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removeOwner('tests', fileName);
        deletedCount += 1;
      }
    }

    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error('Failed to bulk delete tests:', err);
    res.status(500).json({ error: 'Failed to delete test files' });
  }
});

// ── POST /api/forms/detect ─────────────────────────────────
// Launch a headless browser, navigate to the given URL, and
// return all detected forms + their input fields.
app.post('/api/forms/detect', requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\/.+/.test(url)) {
    return res.status(400).json({ error: 'Valid URL is required' });
  }

  let browser;
  try {
    const chromiumPath = findChromiumPath();
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const forms = await page.evaluate(() => {
      const result = [];
      const formEls = document.querySelectorAll('form');
      const processForm = (formEl, idx) => {
        const selectorStr = formEl.id
          ? `#${formEl.id}`
          : formEl.className
            ? `.${formEl.className.trim().split(/\s+/).join('.')}`
            : `form:nth-of-type(${idx + 1})`;

        const fields = [];
        const inputs = formEl.querySelectorAll('input, textarea, select');
        inputs.forEach(el => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text');
          const name = el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || '';
          const fieldSel = el.id
            ? `#${el.id}`
            : el.name
              ? `[name="${el.name}"]`
              : null;
          if (!name) return;
          let fieldType = 'text';
          if (tag === 'textarea') fieldType = 'textarea';
          else if (tag === 'select') fieldType = el.multiple ? 'multiselect' : 'select';
          else if (type === 'checkbox') fieldType = 'checkbox';
          else if (type === 'radio') fieldType = 'radio';
          else if (type === 'email') fieldType = 'email';
          else if (type === 'password') fieldType = 'password';
          else if (type === 'number') fieldType = 'number';
          fields.push({ name, selector: fieldSel, type: fieldType });
        });

        // Find submit button
        const submitBtn = formEl.querySelector('[type="submit"], button:not([type="button"])');
        const submitSel = submitBtn
          ? (submitBtn.id ? `#${submitBtn.id}` : submitBtn.getAttribute('type') === 'submit' ? '[type="submit"]' : 'button')
          : null;

        if (fields.length > 0) {
          result.push({ formSelector: selectorStr, fields, submitSelector: submitSel });
        }
      };

      if (formEls.length > 0) {
        formEls.forEach((f, i) => processForm(f, i));
      } else {
        // No <form> tags — scan all visible inputs as a single virtual form
        const allInputs = document.querySelectorAll('input, textarea, select');
        const fields = [];
        allInputs.forEach(el => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || 'text';
          if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) return;
          const name = el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || '';
          if (!name) return;
          const fieldSel = el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : null;
          let fieldType = 'text';
          if (tag === 'textarea') fieldType = 'textarea';
          else if (tag === 'select') fieldType = el.multiple ? 'multiselect' : 'select';
          else if (type === 'checkbox') fieldType = 'checkbox';
          else if (type === 'radio') fieldType = 'radio';
          else if (type === 'email') fieldType = 'email';
          else if (type === 'password') fieldType = 'password';
          else if (type === 'number') fieldType = 'number';
          fields.push({ name, selector: fieldSel, type: fieldType });
        });
        if (fields.length > 0) result.push({ formSelector: null, fields, submitSelector: null });
      }
      return result;
    });

    res.json({ forms });
  } catch (err) {
    console.error('Form detection failed:', err);
    res.status(500).json({ error: `Form detection failed: ${err.message}` });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ══════════════════════════════════════════════════════════
//  TEST RUNNER ENDPOINTS
// ══════════════════════════════════════════════════════════

// ── Per-user runner state ───────────────────────────────────
// Each user gets their own isolated runner state so multiple
// users can run tests concurrently without blocking each other.
const runnerStates = new Map(); // Map<userId, RunnerState>

function createRunnerState() {
  return {
    status: 'idle',        // 'idle' | 'running'
    runId: null,           // unique run ID for tracking
    testName: null,        // name of test being run
    userId: null,          // owner user ID
    process: null,         // child process reference
    logBuffer: [],         // buffered log lines
    sseClients: [],        // connected SSE clients
    result: null,          // 'passed' | 'failed' | null
    reportFile: null,      // latest report filename
    startedAt: null        // run start time
  };
}

function getRunnerState(userId) {
  if (!runnerStates.has(userId)) {
    runnerStates.set(userId, createRunnerState());
  }
  return runnerStates.get(userId);
}

function resetRunnerState(userId) {
  const state = getRunnerState(userId);
  state.status = 'idle';
  state.runId = null;
  state.testName = null;
  state.userId = null;
  state.process = null;
  state.logBuffer = [];
  state.result = null;
  state.reportFile = null;
  state.startedAt = null;
}

// Run history — stores completed runs for lookup
const runHistory = [];
const MAX_HISTORY = 50;

function generateRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Log type detection ─────────────────────────────────────
function detectLogType(line) {
  if (/✅|passed|✓.*passed/i.test(line)) return 'pass';
  if (/❌|failed|✗.*failed|Error/i.test(line)) return 'fail';
  if (/🤖|LLM/i.test(line)) return 'llm';
  if (/📍|Step \d+/i.test(line)) return 'step';
  return 'info';
}

// ── Broadcast to a user's SSE clients ──────────────────────
function broadcastSSE(userId, event, data) {
  const state = getRunnerState(userId);
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  state.sseClients = state.sseClients.filter(res => {
    try {
      res.write(msg);
      return true;
    } catch {
      return false;
    }
  });
}

// ── POST /api/runner/run ───────────────────────────────────
app.post('/api/runner/run', requireAuth, (req, res) => {
  const { testName } = req.body;
  const userId = req.user.userId;

  if (!testName) {
    return res.status(400).json({ error: 'testName is required' });
  }

  const RUNNER_SCRIPTS = {
    'tool-call': 'ai_tool_runner.js',
    'visual-regression': 'ai_visual_runner.js',
    performance: 'ai_lighthouse_runner.js',
  };

  const state = getRunnerState(userId);

  if (state.status === 'running') {
    return res.status(409).json({ error: 'You already have a test running' });
  }

  // Sanitize
  if (testName.includes('..') || testName.includes('/')) {
    return res.status(400).json({ error: 'Invalid test name' });
  }

  const testPath = path.join(TESTS_DIR, testName);
  if (!fs.existsSync(testPath)) {
    return res.status(404).json({ error: 'Test file not found' });
  }

  // Auto-select dedicated runner by test type.
  const testContent = fs.readFileSync(testPath, 'utf-8');
  const detectedType = detectTestType(testContent);
  let runner;
  switch (detectedType) {
    case 'performance':
      runner = 'performance';
      break;
    case 'visual-regression':
      runner = 'visual-regression';
      break;
    case 'general':
    case 'form-validation':
    default:
      runner = 'tool-call';
      break;
  }

  // Reset state for new run
  resetRunnerState(userId);
  state.status = 'running';
  state.runId = generateRunId();
  state.testName = testName;
  state.userId = userId;
  state.startedAt = Date.now();

  const currentRunId = state.runId;
  const currentUserId = userId;
  const runnerEnv = { ...process.env };

  if (runner === 'tool-call') {
    runnerEnv.MCP_WORKSPACE_DIR = FILES_DIR;
    runnerEnv.MCP_OUTPUT_DIR = '.';
  }

  // Spawn the test runner as a child process
  const runnerScript = RUNNER_SCRIPTS[runner];
  if (!runnerScript) {
    return res.status(400).json({ error: `No runner configured for test type: ${detectedType}` });
  }
  const child = spawn('node', [runnerScript, `tests/${testName}`], {
    cwd: PROJECT_ROOT,
    env: runnerEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  state.process = child;

  // Handle stdout
  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim() === '') continue;

      // Detect CDP screencast frames — forward as a separate SSE event
      if (line.startsWith('__SCREENCAST_FRAME__')) {
        const frameData = line.slice('__SCREENCAST_FRAME__'.length);
        broadcastSSE(currentUserId, 'screencast', { frame: frameData });
        continue; // don't add to log buffer
      }

      // Detect performance test marker — notify UI to suppress live monitor
      if (line.startsWith('__PERF_TEST__')) {
        broadcastSSE(currentUserId, 'perftest', { isPerformanceTest: true });
        continue; // don't add to log buffer
      }

      // Detect form-validation marker (kept for compatibility).
      // Form-validation runs should keep live monitor enabled.
      if (line.startsWith('__FORM_VALIDATION_TEST__')) {
        continue; // don't add to log buffer
      }

      // Explicit report file marker from runner
      if (line.startsWith('__REPORT_FILE__')) {
        const reportName = line.slice('__REPORT_FILE__'.length).trim();
        if (reportName) {
          state.reportFile = reportName;
        }
        continue;
      }

      const logType = detectLogType(line);
      const logEntry = { line, type: logType, timestamp: Date.now() };
      state.logBuffer.push(logEntry);
      broadcastSSE(currentUserId, 'log', logEntry);
    }
  });

  // Handle stderr
  let stderrBuffer = '';
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop();

    for (const line of lines) {
      if (line.trim() === '') continue;
      const logEntry = { line, type: 'fail', timestamp: Date.now() };
      state.logBuffer.push(logEntry);
      broadcastSSE(currentUserId, 'log', logEntry);
    }
  });

  // Handle process exit
  child.on('close', (code) => {
    // Flush remaining buffers
    if (stdoutBuffer.trim()) {
      const logType = detectLogType(stdoutBuffer);
      const logEntry = { line: stdoutBuffer, type: logType, timestamp: Date.now() };
      state.logBuffer.push(logEntry);
      broadcastSSE(currentUserId, 'log', logEntry);
    }
    if (stderrBuffer.trim()) {
      const logEntry = { line: stderrBuffer, type: 'fail', timestamp: Date.now() };
      state.logBuffer.push(logEntry);
      broadcastSSE(currentUserId, 'log', logEntry);
    }

    state.status = 'idle';
    state.result = code === 0 ? 'passed' : 'failed';
    state.process = null;

    // Fallback: find latest report only if runner didn't publish one explicitly
    if (!state.reportFile) {
      try {
        if (fs.existsSync(REPORTS_DIR)) {
          const reports = fs.readdirSync(REPORTS_DIR)
            .filter(f => f.endsWith('.html'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

          if (reports.length > 0) {
            state.reportFile = reports[0].name;
          }
        }
      } catch (err) {
        console.error('Failed to find report:', err);
      }
    }

    // Attribute generated files to the user who triggered the run
    if (currentUserId) {
      // Attribute report
      if (state.reportFile) {
        setOwner('reports', state.reportFile, currentUserId);
      }
      // Attribute generated files created during this run.
      // This includes screenshots/diffs and downloaded/uploaded assets.
      const runStart = state.startedAt || 0;
      for (const subdir of ['screenshots', 'diffs', 'uploads', 'Downloads', 'downloads']) {
        const dirPath = path.join(FILES_DIR, subdir);
        if (fs.existsSync(dirPath)) {
          const newFiles = fs.readdirSync(dirPath)
            .filter(f => !f.startsWith('.'))
            .filter(f => {
              try {
                return fs.statSync(path.join(dirPath, f)).mtimeMs >= runStart;
              } catch { return false; }
            });
          for (const f of newFiles) {
            setOwner('files', `${subdir}/${f}`, currentUserId);
          }
        }
      }

      // Some tools can save downloads directly under /files root.
      const rootFiles = fs.readdirSync(FILES_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
        .filter(entry => {
          try {
            return fs.statSync(path.join(FILES_DIR, entry.name)).mtimeMs >= runStart;
          } catch {
            return false;
          }
        });
      for (const entry of rootFiles) {
        setOwner('files', entry.name, currentUserId);
      }
    }

    // Save to run history
    runHistory.unshift({
      runId: currentRunId,
      testName: state.testName,
      userId: currentUserId,
      result: state.result,
      reportFile: state.reportFile,
      startedAt: state.startedAt,
      finishedAt: Date.now(),
      exitCode: code,
      logCount: state.logBuffer.length
    });
    if (runHistory.length > MAX_HISTORY) runHistory.pop();

    broadcastSSE(currentUserId, 'done', {
      runId: currentRunId,
      result: state.result,
      reportFile: state.reportFile,
      exitCode: code
    });
  });

  child.on('error', (err) => {
    console.error('Runner process error:', err);
    state.status = 'idle';
    state.result = 'failed';
    state.process = null;

    const logEntry = { line: `Process error: ${err.message}`, type: 'fail', timestamp: Date.now() };
    state.logBuffer.push(logEntry);
    broadcastSSE(currentUserId, 'log', logEntry);
    broadcastSSE(currentUserId, 'done', { runId: currentRunId, result: 'failed', reportFile: null, exitCode: -1 });
  });

  res.json({
    success: true,
    message: `Running test: ${testName}`,
    runId: currentRunId,
    runner,
    detectedType
  });
});

// ── GET /api/runner/logs (SSE) ─────────────────────────────
// SSE endpoint supports token via query param since EventSource can't send headers
app.get('/api/runner/logs', (req, res, next) => {
  // Accept token from query param or Authorization header
  const token = req.query.token;
  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`;
  }
  requireAuth(req, res, next);
}, (req, res) => {
  const userId = req.user.userId;
  const state = getRunnerState(userId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Replay buffered logs
  for (const logEntry of state.logBuffer) {
    res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`);
  }

  // If run already finished, send done immediately
  if (state.status === 'idle' && state.result) {
    res.write(`event: done\ndata: ${JSON.stringify({
      runId: state.runId,
      result: state.result,
      reportFile: state.reportFile
    })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  // Register client for future events
  state.sseClients.push(res);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    state.sseClients = state.sseClients.filter(c => c !== res);
  });
});

// ── POST /api/runner/stop ──────────────────────────────────
app.post('/api/runner/stop', requireAuth, (req, res) => {
  const state = getRunnerState(req.user.userId);

  if (state.status !== 'running' || !state.process) {
    return res.status(400).json({ error: 'No test is currently running' });
  }

  try {
    const pid = state.process.pid;

    // Send SIGTERM first to trigger cleanup handlers in the child
    state.process.kill('SIGTERM');

    // Force-kill the entire process group after a short grace period
    // This ensures Chromium, MCP server, and all subprocesses are terminated
    setTimeout(() => {
      try {
        // Kill the entire process group (negative PID)
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Process group may already be dead, try direct kill
        try {
          state.process.kill('SIGKILL');
        } catch { /* already dead */ }
      }

      // Ensure state is cleaned up
      state.status = 'idle';
      state.result = 'stopped';
      state.process = null;

      // Notify SSE clients that the run is done
      broadcastSSE(req.user.userId, 'done', {
        runId: state.runId,
        result: 'stopped',
        reportFile: null,
        exitCode: -1
      });
    }, 1500);

    res.json({ success: true, message: 'Test run stopped' });
  } catch (err) {
    console.error('Failed to stop runner:', err);
    res.status(500).json({ error: 'Failed to stop test run' });
  }
});

// ── GET /api/runner/status ─────────────────────────────────
app.get('/api/runner/status', requireAuth, (req, res) => {
  const state = getRunnerState(req.user.userId);

  res.json({
    status: state.status,
    runId: state.runId,
    testName: state.testName,
    result: state.result,
    reportFile: state.reportFile,
    logCount: state.logBuffer.length,
    startedAt: state.startedAt
  });
});

// ── GET /api/runner/history ────────────────────────────────
app.get('/api/runner/history', requireAuth, (req, res) => {
  const isAdmin = reqIsAdmin(req);
  const filtered = isAdmin
    ? runHistory
    : runHistory.filter(r => r.userId === req.user.userId);
  res.json(filtered);
});

// ══════════════════════════════════════════════════════════
//  REPORTS ENDPOINTS
// ══════════════════════════════════════════════════════════

/**
 * Parse an HTML report to extract summary metadata (result, steps, duration, etc.)
 * This allows the dashboard sidebar to show rich info without loading the full report.
 */
function parseReportMetadata(filePath) {
  try {
    const html = fs.readFileSync(filePath, 'utf-8');
    const meta = {};

    // Detect performance reports (generated by PerformanceReportGenerator)
    if (
      html.includes('<title>Performance Report</title>') ||
      html.includes('Performance Metrics Report') ||
      html.includes('Lighthouse Report —') ||
      html.includes('Lighthouse Audit Report')
    ) {
      meta.type = 'performance';
      meta.result = 'pass'; // Performance reports are informational, always "pass"

      // Extract test name
      const testNameMatch = html.match(/<strong>Test:<\/strong>\s*([^<]+)/i);
      meta.testName = testNameMatch ? testNameMatch[1].trim() : null;

      // Extract target URL
      const urlMatch = html.match(/<strong>Target URL:<\/strong>\s*([^<]+)/i);
      meta.targetUrl = urlMatch ? urlMatch[1].trim() : null;

      // Extract generated date
      const dateMatch = html.match(/<strong>Generated:<\/strong>\s*([^<]+)/i);
      meta.generatedAt = dateMatch ? dateMatch[1].trim() : null;

      // Attempt to extract core metrics from the report HTML
      const metricPattern = /<span>([^<]+)<\/span>\s*<strong>([^<]+)<\/strong>/g;
      const metrics = {};
      let m;
      while ((m = metricPattern.exec(html)) !== null) {
        metrics[m[1].trim()] = m[2].trim();
      }
      meta.metrics = metrics;
      meta.totalActions = 0;
      meta.passed = 0;
      meta.failed = 0;
      meta.successRate = 100;
      meta.duration = metrics['Load Event End'] || 'N/A';

      return meta;
    }

    // Extract test result (PASS / FAIL)
    const resultMatch = html.match(/<div class="stat-value (success|failure)">\s*(PASS|FAIL)\s*<\/div>/i);
    meta.result = resultMatch ? resultMatch[2].toLowerCase() : 'unknown';

    // Extract total actions
    const totalMatch = html.match(/<div class="stat-value">(\d+)<\/div>\s*<div class="stat-label">Total Actions<\/div>/i);
    meta.totalActions = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    // Extract passed
    const passedMatch = html.match(/<div class="stat-value success">(\d+)<\/div>\s*<div class="stat-label">Passed<\/div>/i);
    meta.passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;

    // Extract failed
    const failedMatch = html.match(/<div class="stat-value failure">(\d+)<\/div>\s*<div class="stat-label">Failed<\/div>/i);
    meta.failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;

    // Extract success rate
    const rateMatch = html.match(/<div class="stat-value">([\d.]+)%<\/div>\s*<div class="stat-label">Success Rate<\/div>/i);
    meta.successRate = rateMatch ? parseFloat(rateMatch[1]) : 0;

    // Extract duration
    const durMatch = html.match(/<div class="stat-value">([\d.]+[ms]+)<\/div>\s*<div class="stat-label">Duration<\/div>/i);
    meta.duration = durMatch ? durMatch[1] : 'N/A';

    // Extract visual checks (optional)
    const vrMatch = html.match(/<div class="stat-value"[^>]*>(\d+\/\d+)<\/div>\s*<div class="stat-label">Visual Checks<\/div>/i);
    meta.visualChecks = vrMatch ? vrMatch[1] : null;

    // Extract generated date from header
    const dateMatch = html.match(/Generated on (.+?)<\/p>/);
    meta.generatedAt = dateMatch ? dateMatch[1].trim() : null;

    return meta;
  } catch {
    return { result: 'unknown', totalActions: 0, passed: 0, failed: 0, successRate: 0, duration: 'N/A' };
  }
}

// ── GET /api/reports ───────────────────────────────────────
app.get('/api/reports', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      return res.json([]);
    }

    const isAdmin = reqIsAdmin(req);
    const ownedFiles = new Set(getOwnedFilenames('reports', req.user.userId, isAdmin));

    const reports = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.html'))
      .filter(f => isAdmin || ownedFiles.has(f))
      .map(f => {
        const stat = fs.statSync(path.join(REPORTS_DIR, f));
        const meta = parseReportMetadata(path.join(REPORTS_DIR, f));
        return {
          name: f,
          modified: stat.mtimeMs,
          sizeBytes: stat.size,
          ...meta
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json(reports);
  } catch (err) {
    console.error('Failed to list reports:', err);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// ── DELETE /api/reports/:filename ──────────────────────────
app.delete('/api/reports/:filename', requireAuth, (req, res) => {
  try {
    const fileName = req.params.filename;

    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!isOwnerOrAdmin('reports', fileName, req.user.userId, reqIsAdmin(req))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const filePath = path.join(REPORTS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    fs.unlinkSync(filePath);
    removeOwner('reports', fileName);
    res.json({ success: true, message: `Deleted ${fileName}` });
  } catch (err) {
    console.error('Failed to delete report:', err);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// ── DELETE /api/reports ───────────────────────────────────
// Delete all visible reports for the current user (must be owner or admin)
app.delete('/api/reports', requireAuth, (req, res) => {
  try {
    const isAdmin = reqIsAdmin(req);
    const ownedFiles = new Set(getOwnedFilenames('reports', req.user.userId, isAdmin));
    const deletableFiles = fs.existsSync(REPORTS_DIR)
      ? fs.readdirSync(REPORTS_DIR)
          .filter((f) => f.endsWith('.html'))
          .filter((f) => isAdmin || ownedFiles.has(f))
      : [];

    let deletedCount = 0;
    for (const fileName of deletableFiles) {
      const filePath = path.join(REPORTS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removeOwner('reports', fileName);
        deletedCount += 1;
      }
    }

    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error('Failed to bulk delete reports:', err);
    res.status(500).json({ error: 'Failed to delete reports' });
  }
});

// ══════════════════════════════════════════════════════════
//  FILES & ASSET BROWSER ENDPOINTS (EPIC-07)
// ══════════════════════════════════════════════════════════

const ALLOWED_ASSET_FOLDERS = ['screenshots', 'baselines', 'diffs', 'uploads', 'Downloads', 'downloads'];

/**
 * Recursively read a directory and return a tree of files and folders.
 * Only traverses directories within the allowed asset folders.
 */
function readDirTree(dirPath, relativeTo) {
  const items = [];
  if (!fs.existsSync(dirPath)) return items;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(relativeTo, fullPath);

    if (entry.isDirectory()) {
      items.push({
        name: entry.name,
        path: relPath,
        type: 'folder',
        children: readDirTree(fullPath, relativeTo)
      });
    } else {
      const stat = fs.statSync(fullPath);
      items.push({
        name: entry.name,
        path: relPath,
        type: 'file',
        sizeBytes: stat.size,
        modified: stat.mtimeMs,
        extension: path.extname(entry.name).toLowerCase().replace('.', '')
      });
    }
  }

  // Sort: folders first, then files, alphabetically within each group
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

// ── GET /api/files/browse ──────────────────────────────────
// Browse a specific folder path within the files directory.
// Query params: ?folder=screenshots/subfolder (optional, defaults to root)
app.get('/api/files/browse', requireAuth, (req, res) => {
  try {
    const folder = req.query.folder || '';

    // Security: prevent directory traversal
    if (folder.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const targetDir = folder ? path.join(FILES_DIR, folder) : FILES_DIR;

    // Ensure target is within FILES_DIR
    const resolvedTarget = path.resolve(targetDir);
    const resolvedFiles = path.resolve(FILES_DIR);
    if (!resolvedTarget.startsWith(resolvedFiles)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = [];
    const isAdmin = reqIsAdmin(req);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      // At root level, only show allowed asset folders
      if (!folder && entry.isDirectory() && !ALLOWED_ASSET_FOLDERS.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(targetDir, entry.name);
      const relPath = folder ? `${folder}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: relPath,
          type: 'folder'
        });
      } else {
        // Check ownership: use 'baselines' category for baselines folder,
        // 'files' category (with relative path) for everything else
        const isBaseline = (folder === 'baselines' || folder?.startsWith('baselines/'));
        let hasAccess = isAdmin;
        if (!hasAccess) {
          if (isBaseline) {
            hasAccess = isOwnerOrAdmin('baselines', entry.name, req.user.userId, false);
          } else {
            hasAccess = isOwnerOrAdmin('files', relPath, req.user.userId, false);
          }
        }
        if (!hasAccess) continue;

        const stat = fs.statSync(fullPath);
        items.push({
          name: entry.name,
          path: relPath,
          type: 'file',
          sizeBytes: stat.size,
          modified: stat.mtimeMs,
          extension: path.extname(entry.name).toLowerCase().replace('.', '')
        });
      }
    }

    // Sort: folders first, then files
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Build breadcrumbs
    const breadcrumbs = [{ name: 'Files', path: '' }];
    if (folder) {
      const parts = folder.split('/');
      let accumulated = '';
      for (const part of parts) {
        accumulated = accumulated ? `${accumulated}/${part}` : part;
        breadcrumbs.push({ name: part, path: accumulated });
      }
    }

    res.json({
      currentPath: folder || '',
      breadcrumbs,
      items,
      totalFiles: items.filter(i => i.type === 'file').length,
      totalFolders: items.filter(i => i.type === 'folder').length
    });
  } catch (err) {
    console.error('Failed to browse files:', err);
    res.status(500).json({ error: 'Failed to browse directory' });
  }
});

// ── GET /api/files/preview/:filePath(*) ────────────────────
// Serve a file for inline preview. Only allows files inside FILES_DIR.
app.get('/api/files/preview/{*filePath}', requireAuth, (req, res) => {
  try {
    // Express 5 + path-to-regexp 8.x returns wildcard as array of segments
    const filePath = Array.isArray(req.params.filePath)
      ? req.params.filePath.join('/')
      : req.params.filePath;

    if (!filePath || filePath.includes('..')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const fullPath = path.join(FILES_DIR, filePath);

    // Ensure within FILES_DIR
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(path.resolve(FILES_DIR))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.yml': 'text/yaml',
      '.yaml': 'text/yaml',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(resolvedPath);
  } catch (err) {
    console.error('Failed to preview file:', err);
    res.status(500).json({ error: 'Failed to preview file' });
  }
});

// ── DELETE /api/files/:filePath(*) ─────────────────────────
// Delete a specific file within files directory.
app.delete('/api/files/delete/{*filePath}', requireAuth, (req, res) => {
  try {
    // Express 5 + path-to-regexp 8.x returns wildcard as array of segments
    const filePath = Array.isArray(req.params.filePath)
      ? req.params.filePath.join('/')
      : req.params.filePath;

    if (!filePath || filePath.includes('..')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const fullPath = path.join(FILES_DIR, filePath);

    // Ensure within FILES_DIR
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(path.resolve(FILES_DIR))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot delete directories through this endpoint' });
    }

    // Check ownership: baselines use 'baselines' category, others use 'files'
    const isBaseline = filePath.startsWith('baselines/');
    const ownerCategory = isBaseline ? 'baselines' : 'files';
    const ownerKey = isBaseline ? path.basename(filePath) : filePath;
    if (!isOwnerOrAdmin(ownerCategory, ownerKey, req.user.userId, reqIsAdmin(req))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    fs.unlinkSync(fullPath);
    removeOwner(ownerCategory, ownerKey);
    res.json({ success: true, message: `Deleted ${filePath}` });
  } catch (err) {
    console.error('Failed to delete file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ── Start server ───────────────────────────────────────────
async function startServer() {
  await initializeAuth();

  // Migrate any pre-existing files to admin ownership
  migrateExistingFiles(
    { tests: TESTS_DIR, reports: REPORTS_DIR, baselines: BASELINES_DIR, files: FILES_DIR },
    'admin-001'
  );

  // Global JSON error handler — ensures all unhandled errors return JSON,
  // not Express's default HTML error page.
  // Must be registered AFTER all routes (Express convention: 4-arg middleware).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
