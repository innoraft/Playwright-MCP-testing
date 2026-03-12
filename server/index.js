import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'llm.config.json');
const TESTS_DIR = path.join(__dirname, '..', 'tests');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// ── Role-based middleware ──────────────────────────────────
function requireAdmin(req, res, next) {
  const role = req.headers['x-user-role'];
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

// ── Helper: Read config ────────────────────────────────────
function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { provider: 'openai', model: 'gpt-5', apiKey: '', temperature: 1 };
  }
}

// ── Helper: Write config ───────────────────────────────────
function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
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

// ── Start server ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
