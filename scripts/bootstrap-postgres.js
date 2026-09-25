#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../server/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_ADMIN_ID = 'admin-001';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readLegacyLlmConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/const\s+llmConfig\s*=\s*(\{[\s\S]*?\});/);
  if (!match) throw new Error(`Could not parse ${filePath}`);
  return new Function(`return ${match[1]}`)();
}

function detectTestType(content) {
  const trimmed = content.trimStart().toLowerCase();
  if (trimmed.startsWith('schemaversion:') || /(^|\n)\s*performance\s*:/i.test(content)) return 'performance';
  if (/(^|\n)\s*tests\s*:/i.test(content)) return 'general';
  if (trimmed.startsWith('name:')) return 'visual-regression';
  if (/(^|\n)\s*form-validation\s*:/i.test(content)) return 'form-validation';
  return 'general';
}

async function importUsers(store) {
  for (const user of store.users || []) {
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, roles, active, created_at, reset_requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.username, user.email || '', user.passwordHash, user.roles || ['authenticated'],
        user.active !== false, user.createdAt || new Date().toISOString(), user.resetRequestedAt || null]
    );
  }
}

async function importOwnership(ownership) {
  const { rows } = await pool.query('SELECT id FROM users');
  const knownUsers = new Set(rows.map((row) => row.id));

  for (const category of ['tests', 'reports', 'baselines', 'files']) {
    for (const [filename, ownerId] of Object.entries(ownership[category] || {})) {
      const resolvedOwner = knownUsers.has(ownerId) ? ownerId : DEFAULT_ADMIN_ID;
      await pool.query(
        `INSERT INTO file_ownership (category, filename, owner_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (category, filename) DO NOTHING`,
        [category, filename, resolvedOwner]
      );
    }
  }
}

async function importLlmConfig(config) {
  await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ('llm_config', $1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey || '',
      temperature: config.temperature !== undefined ? Number(config.temperature) : 1,
    })]
  );
}

async function importTestMetadata() {
  const testsDir = path.join(ROOT, 'tests');
  if (!fs.existsSync(testsDir)) return;

  for (const name of fs.readdirSync(testsDir).filter((entry) => entry.endsWith('.test.yml'))) {
    const filePath = path.join(testsDir, name);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const owner = await pool.query(
      'SELECT owner_user_id FROM file_ownership WHERE category = $1 AND filename = $2',
      ['tests', name]
    );
    await pool.query(
      `INSERT INTO tests_meta (name, type, owner_user_id, created_at, modified_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING`,
      [name, detectTestType(content), owner.rows[0]?.owner_user_id || DEFAULT_ADMIN_ID, stat.birthtime, stat.mtime]
    );
  }
}

async function backfillUntrackedFiles() {
  const sources = [
    ['reports', path.join(ROOT, 'test-reports'), (name) => name.endsWith('.html')],
    ['baselines', path.join(ROOT, 'files', 'baselines'), (name) => /\.(png|jpg|jpeg)$/i.test(name)],
  ];

  for (const [category, dirPath, include] of sources) {
    if (!fs.existsSync(dirPath)) continue;
    for (const name of fs.readdirSync(dirPath).filter(include)) {
      const ownerKey = category === 'baselines' ? name : name;
      await pool.query(
        `INSERT INTO file_ownership (category, filename, owner_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (category, filename) DO NOTHING`,
        [category, ownerKey, DEFAULT_ADMIN_ID]
      );
    }
  }

  for (const subdir of ['screenshots', 'diffs', 'uploads', 'Downloads', 'downloads']) {
    const rootDir = path.join(ROOT, 'files', subdir);
    if (!fs.existsSync(rootDir)) continue;

    const walk = async (currentDir) => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          await pool.query(
            `INSERT INTO file_ownership (category, filename, owner_user_id)
             VALUES ('files', $1, $2)
             ON CONFLICT (category, filename) DO NOTHING`,
            [path.relative(path.join(ROOT, 'files'), fullPath), DEFAULT_ADMIN_ID]
          );
        }
      }
    };

    await walk(rootDir);
  }
}

async function main() {
  const usersPath = path.join(ROOT, 'config', 'users.json');
  const ownershipPath = path.join(ROOT, 'config', 'ownership.json');
  const llmPath = path.join(ROOT, 'config', 'llm.config.js');

  for (const filePath of [usersPath, ownershipPath, llmPath]) {
    if (!fs.existsSync(filePath)) throw new Error(`Required legacy file is missing: ${filePath}`);
  }

  await importUsers(readJson(usersPath));
  await importOwnership(readJson(ownershipPath));
  await importLlmConfig(readLegacyLlmConfig(llmPath));
  await importTestMetadata();
  await backfillUntrackedFiles();
  console.log('Bootstrap data import completed. Source files were not modified.');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(`Bootstrap failed: ${err.message}`);
    pool.end().finally(() => process.exit(1));
  });