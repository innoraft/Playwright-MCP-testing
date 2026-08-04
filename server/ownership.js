/**
 * File Ownership Tracker
 * ─────────────────────────────────────────
 * Tracks which user owns which file so that non-admin users
 * only see their own test files, reports, baselines, and assets.
 * Admin users can see (and manage) everything.
 *
 * Ownership records are stored in config/ownership.json.
 * Categories: tests, reports, baselines, files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OWNERSHIP_PATH = path.join(__dirname, '..', 'config', 'ownership.json');

// ── Load / Save ──────────────────────────────────────────

function loadOwnership() {
  try {
    const raw = fs.readFileSync(OWNERSHIP_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { tests: {}, reports: {}, baselines: {}, files: {} };
  }
}

function saveOwnership(data) {
  fs.writeFileSync(OWNERSHIP_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Public API ───────────────────────────────────────────

/**
 * Set the owner of a file in a category.
 * @param {'tests'|'reports'|'baselines'|'files'} category
 * @param {string} filename - filename or relative path within category
 * @param {string} userId - owner's user ID
 */
function setOwner(category, filename, userId) {
  const data = loadOwnership();
  if (!data[category]) data[category] = {};
  data[category][filename] = userId;
  saveOwnership(data);
}

/**
 * Get the owner userId of a file, or null if untracked.
 */
function getOwner(category, filename) {
  const data = loadOwnership();
  return (data[category] && data[category][filename]) || null;
}

/**
 * Remove ownership record (e.g. on file deletion).
 */
function removeOwner(category, filename) {
  const data = loadOwnership();
  if (data[category]) {
    delete data[category][filename];
    saveOwnership(data);
  }
}

/**
 * Bulk set ownership for multiple files at once.
 * @param {'tests'|'reports'|'baselines'|'files'} category
 * @param {string[]} filenames
 * @param {string} userId
 */
function setOwnerBulk(category, filenames, userId) {
  const data = loadOwnership();
  if (!data[category]) data[category] = {};
  for (const f of filenames) {
    data[category][f] = userId;
  }
  saveOwnership(data);
}

/**
 * Get all filenames owned by a specific user in a category.
 * If isAdmin is true, returns ALL filenames in the category.
 */
function getOwnedFilenames(category, userId, isAdmin) {
  const data = loadOwnership();
  const entries = data[category] || {};

  if (isAdmin) {
    return Object.keys(entries);
  }

  return Object.entries(entries)
    .filter(([, owner]) => owner === userId)
    .map(([filename]) => filename);
}

/**
 * Check if a user is the owner of a file (or is admin).
 * Unowned files (no record) are treated as admin-only.
 */
function isOwnerOrAdmin(category, filename, userId, isAdmin) {
  if (isAdmin) return true;
  const owner = getOwner(category, filename);
  return owner === userId;
}

/**
 * Migrate existing untracked files to a default owner (admin).
 * Call once at startup to ensure all pre-existing files have ownership.
 * @param {object} dirs - { tests: '/abs/path', reports: '/abs/path', baselines: '/abs/path', files: '/abs/path' }
 * @param {string} adminUserId - the admin user's ID
 */
function migrateExistingFiles(dirs, adminUserId) {
  const data = loadOwnership();
  let changed = false;

  // Migrate test files
  if (dirs.tests && fs.existsSync(dirs.tests)) {
    if (!data.tests) data.tests = {};
    const testFiles = fs.readdirSync(dirs.tests).filter(f => f.endsWith('.test.yml'));
    for (const f of testFiles) {
      if (!data.tests[f]) {
        data.tests[f] = adminUserId;
        changed = true;
      }
    }
  }

  // Migrate report files
  if (dirs.reports && fs.existsSync(dirs.reports)) {
    if (!data.reports) data.reports = {};
    const reportFiles = fs.readdirSync(dirs.reports).filter(f => f.endsWith('.html'));
    for (const f of reportFiles) {
      if (!data.reports[f]) {
        data.reports[f] = adminUserId;
        changed = true;
      }
    }
  }

  // Migrate baseline files
  if (dirs.baselines && fs.existsSync(dirs.baselines)) {
    if (!data.baselines) data.baselines = {};
    const baselineFiles = fs.readdirSync(dirs.baselines).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
    for (const f of baselineFiles) {
      if (!data.baselines[f]) {
        data.baselines[f] = adminUserId;
        changed = true;
      }
    }
  }

  // Migrate files in asset folders and root files
  if (dirs.files && fs.existsSync(dirs.files)) {
    if (!data.files) data.files = {};
    for (const subdir of ['screenshots', 'diffs', 'uploads', 'Downloads', 'downloads']) {
      const subdirPath = path.join(dirs.files, subdir);
      if (fs.existsSync(subdirPath)) {
        const files = fs.readdirSync(subdirPath).filter(f => !f.startsWith('.'));
        for (const f of files) {
          const relPath = `${subdir}/${f}`;
          if (!data.files[relPath]) {
            data.files[relPath] = adminUserId;
            changed = true;
          }
        }
      }
    }

    // Also track files directly under /files root.
    const rootEntries = fs.readdirSync(dirs.files, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      if (!data.files[entry.name]) {
        data.files[entry.name] = adminUserId;
        changed = true;
      }
    }
  }

  if (changed) {
    saveOwnership(data);
    console.log('📋 Migrated existing files to admin ownership');
  }
}

export {
  setOwner,
  getOwner,
  removeOwner,
  setOwnerBulk,
  getOwnedFilenames,
  isOwnerOrAdmin,
  migrateExistingFiles
};
