import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'llm.config.js');
const TESTS_DIR = path.join(__dirname, '..', 'tests');
const REPORTS_DIR = path.join(__dirname, '..', 'test-reports');
const PROJECT_ROOT = path.join(__dirname, '..');
const FILES_DIR = path.join(PROJECT_ROOT, 'files');
const BASELINES_DIR = path.join(FILES_DIR, 'baselines');

// Ensure base directories exist
fs.mkdirSync(BASELINES_DIR, { recursive: true });
fs.mkdirSync(path.join(FILES_DIR, 'diffs'), { recursive: true });
fs.mkdirSync(path.join(FILES_DIR, 'screenshots'), { recursive: true });

// Setup multer for baseline uploads
const upload = multer({
  storage: multer.memoryStorage(), // We'll save it manually to control the filename
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server) or any localhost port
    if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
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

// ── Role-based middleware ──────────────────────────────────
function requireAdmin(req, res, next) {
  const role = req.headers['x-user-role'];
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

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
app.get('/api/llm-config', requireAdmin, (req, res) => {
  const config = readConfig();
  res.json({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature
  });
});

// ── POST /api/llm-config ───────────────────────────────────
app.post('/api/llm-config', requireAdmin, (req, res) => {
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
app.get('/api/baselines', (req, res) => {
  try {
    if (!fs.existsSync(BASELINES_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(BASELINES_DIR)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(BASELINES_DIR, f));
        // Parse filename: testName_breakpoint.png
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
app.post('/api/baselines/upload', upload.single('image'), (req, res) => {
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

    fs.writeFileSync(filePath, req.file.buffer);

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
app.delete('/api/baselines/:filename', (req, res) => {
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
// List all .test.yml files in the tests/ directory
app.get('/api/tests', (req, res) => {
  try {
    if (!fs.existsSync(TESTS_DIR)) {
      fs.mkdirSync(TESTS_DIR, { recursive: true });
    }

    const files = fs.readdirSync(TESTS_DIR)
      .filter(f => f.endsWith('.test.yml'))
      .map(f => {
        const content = fs.readFileSync(path.join(TESTS_DIR, f), 'utf-8');
        const firstLine = content.split('\n')[0].trim().toLowerCase();
        // Detect type: if first line starts with "name:" it's visual regression format
        const type = firstLine.startsWith('name:') ? 'visual-regression' : 'general';
        return { name: f, type };
      });

    res.json(files);
  } catch (err) {
    console.error('Failed to list tests:', err);
    res.status(500).json({ error: 'Failed to list test files' });
  }
});

// ── GET /api/tests/:name ───────────────────────────────────
// Read a single test file
app.get('/api/tests/:name', (req, res) => {
  try {
    const fileName = req.params.name;
    // Sanitize: prevent directory traversal
    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
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
// Save (create or update) a test file
app.post('/api/tests', (req, res) => {
  try {
    const { name, content } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    // Ensure name ends with .test.yml
    let fileName = name;
    if (!fileName.endsWith('.test.yml')) {
      fileName = fileName.replace(/\.yml$/, '').replace(/\.test$/, '');
      fileName = `${fileName}.test.yml`;
    }

    // Sanitize
    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!fs.existsSync(TESTS_DIR)) {
      fs.mkdirSync(TESTS_DIR, { recursive: true });
    }

    const filePath = path.join(TESTS_DIR, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');

    res.json({ success: true, message: `Test saved as ${fileName}`, fileName });
  } catch (err) {
    console.error('Failed to save test:', err);
    res.status(500).json({ error: 'Failed to save test file' });
  }
});

// ── DELETE /api/tests/:name ────────────────────────────────
// Delete a test file
app.delete('/api/tests/:name', (req, res) => {
  try {
    const fileName = req.params.name;

    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    const filePath = path.join(TESTS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Test file not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Deleted ${fileName}` });
  } catch (err) {
    console.error('Failed to delete test:', err);
    res.status(500).json({ error: 'Failed to delete test file' });
  }
});

// ══════════════════════════════════════════════════════════
//  TEST RUNNER ENDPOINTS
// ══════════════════════════════════════════════════════════

// ── Runner state ───────────────────────────────────────────
let runnerState = {
  status: 'idle',        // 'idle' | 'running'
  runId: null,           // unique run ID for tracking
  testName: null,        // name of test being run
  process: null,         // child process reference
  logBuffer: [],         // buffered log lines
  sseClients: [],        // connected SSE clients
  result: null,          // 'passed' | 'failed' | null
  reportFile: null,      // latest report filename
  startedAt: null        // run start time
};

// Run history — stores completed runs for lookup
const runHistory = [];
const MAX_HISTORY = 50;

function generateRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resetRunnerState() {
  runnerState.status = 'idle';
  runnerState.runId = null;
  runnerState.testName = null;
  runnerState.process = null;
  runnerState.logBuffer = [];
  runnerState.result = null;
  runnerState.reportFile = null;
  runnerState.startedAt = null;
}

// ── Log type detection ─────────────────────────────────────
function detectLogType(line) {
  if (/✅|passed|✓.*passed/i.test(line)) return 'pass';
  if (/❌|failed|✗.*failed|Error/i.test(line)) return 'fail';
  if (/🤖|LLM/i.test(line)) return 'llm';
  if (/📍|Step \d+/i.test(line)) return 'step';
  return 'info';
}

// ── Broadcast to all SSE clients ───────────────────────────
function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  runnerState.sseClients = runnerState.sseClients.filter(res => {
    try {
      res.write(msg);
      return true;
    } catch {
      return false;
    }
  });
}

// ── POST /api/runner/run ───────────────────────────────────
app.post('/api/runner/run', (req, res) => {
  const { testName } = req.body;

  if (!testName) {
    return res.status(400).json({ error: 'testName is required' });
  }

  if (runnerState.status === 'running') {
    return res.status(409).json({ error: 'A test is already running' });
  }

  // Sanitize
  if (testName.includes('..') || testName.includes('/')) {
    return res.status(400).json({ error: 'Invalid test name' });
  }

  const testPath = path.join(TESTS_DIR, testName);
  if (!fs.existsSync(testPath)) {
    return res.status(404).json({ error: 'Test file not found' });
  }

  // Reset state for new run
  resetRunnerState();
  runnerState.status = 'running';
  runnerState.runId = generateRunId();
  runnerState.testName = testName;
  runnerState.startedAt = Date.now();

  const currentRunId = runnerState.runId;

  // Spawn the test runner as a child process
  const child = spawn('node', ['ai_test_runner.js', `tests/${testName}`], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  runnerState.process = child;

  // Handle stdout
  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim() === '') continue;
      const logType = detectLogType(line);
      const logEntry = { line, type: logType, timestamp: Date.now() };
      runnerState.logBuffer.push(logEntry);
      broadcastSSE('log', logEntry);
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
      runnerState.logBuffer.push(logEntry);
      broadcastSSE('log', logEntry);
    }
  });

  // Handle process exit
  child.on('close', (code) => {
    // Flush remaining buffers
    if (stdoutBuffer.trim()) {
      const logType = detectLogType(stdoutBuffer);
      const logEntry = { line: stdoutBuffer, type: logType, timestamp: Date.now() };
      runnerState.logBuffer.push(logEntry);
      broadcastSSE('log', logEntry);
    }
    if (stderrBuffer.trim()) {
      const logEntry = { line: stderrBuffer, type: 'fail', timestamp: Date.now() };
      runnerState.logBuffer.push(logEntry);
      broadcastSSE('log', logEntry);
    }

    runnerState.status = 'idle';
    runnerState.result = code === 0 ? 'passed' : 'failed';
    runnerState.process = null;

    // Find the latest report file
    try {
      if (fs.existsSync(REPORTS_DIR)) {
        const reports = fs.readdirSync(REPORTS_DIR)
          .filter(f => f.endsWith('.html'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);

        if (reports.length > 0) {
          runnerState.reportFile = reports[0].name;
        }
      }
    } catch (err) {
      console.error('Failed to find report:', err);
    }

    // Save to run history
    runHistory.unshift({
      runId: currentRunId,
      testName: runnerState.testName,
      result: runnerState.result,
      reportFile: runnerState.reportFile,
      startedAt: runnerState.startedAt,
      finishedAt: Date.now(),
      exitCode: code,
      logCount: runnerState.logBuffer.length
    });
    if (runHistory.length > MAX_HISTORY) runHistory.pop();

    broadcastSSE('done', {
      runId: currentRunId,
      result: runnerState.result,
      reportFile: runnerState.reportFile,
      exitCode: code
    });
  });

  child.on('error', (err) => {
    console.error('Runner process error:', err);
    runnerState.status = 'idle';
    runnerState.result = 'failed';
    runnerState.process = null;

    const logEntry = { line: `Process error: ${err.message}`, type: 'fail', timestamp: Date.now() };
    runnerState.logBuffer.push(logEntry);
    broadcastSSE('log', logEntry);
    broadcastSSE('done', { runId: currentRunId, result: 'failed', reportFile: null, exitCode: -1 });
  });

  res.json({ success: true, message: `Running test: ${testName}`, runId: currentRunId });
});

// ── GET /api/runner/logs (SSE) ─────────────────────────────
app.get('/api/runner/logs', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Replay buffered logs
  for (const logEntry of runnerState.logBuffer) {
    res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`);
  }

  // If run already finished, send done immediately
  if (runnerState.status === 'idle' && runnerState.result) {
    res.write(`event: done\ndata: ${JSON.stringify({
      runId: runnerState.runId,
      result: runnerState.result,
      reportFile: runnerState.reportFile
    })}\n\n`);
  }

  // Register client for future events
  runnerState.sseClients.push(res);

  // Cleanup on disconnect
  req.on('close', () => {
    runnerState.sseClients = runnerState.sseClients.filter(c => c !== res);
  });
});

// ── POST /api/runner/stop ──────────────────────────────────
app.post('/api/runner/stop', (req, res) => {
  if (runnerState.status !== 'running' || !runnerState.process) {
    return res.status(400).json({ error: 'No test is currently running' });
  }

  try {
    runnerState.process.kill('SIGTERM');
    res.json({ success: true, message: 'Test run stopped' });
  } catch (err) {
    console.error('Failed to stop runner:', err);
    res.status(500).json({ error: 'Failed to stop test run' });
  }
});

// ── GET /api/runner/status ─────────────────────────────────
app.get('/api/runner/status', (req, res) => {
  res.json({
    status: runnerState.status,
    runId: runnerState.runId,
    testName: runnerState.testName,
    result: runnerState.result,
    reportFile: runnerState.reportFile,
    logCount: runnerState.logBuffer.length,
    startedAt: runnerState.startedAt
  });
});

// ── GET /api/runner/history ────────────────────────────────
app.get('/api/runner/history', (req, res) => {
  res.json(runHistory);
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
app.get('/api/reports', (req, res) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      return res.json([]);
    }

    const reports = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.html'))
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
app.delete('/api/reports/:filename', (req, res) => {
  try {
    const fileName = req.params.filename;

    if (fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    const filePath = path.join(REPORTS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Deleted ${fileName}` });
  } catch (err) {
    console.error('Failed to delete report:', err);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// ══════════════════════════════════════════════════════════
//  FILES & ASSET BROWSER ENDPOINTS (EPIC-07)
// ══════════════════════════════════════════════════════════

const ALLOWED_ASSET_FOLDERS = ['screenshots', 'baselines', 'diffs', 'uploads'];

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
app.get('/api/files/browse', (req, res) => {
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
app.get('/api/files/preview/{*filePath}', (req, res) => {
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
app.delete('/api/files/delete/{*filePath}', (req, res) => {
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

    fs.unlinkSync(fullPath);
    res.json({ success: true, message: `Deleted ${filePath}` });
  } catch (err) {
    console.error('Failed to delete file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ── Start server ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
