/**
 * File Ownership Tracker
 * ─────────────────────────────────────────
 * Tracks which user owns which file so that non-admin users
 * only see their own test files, reports, baselines, and assets.
 * Admin users can see (and manage) everything.
 *
 * Postgres-backed (file_ownership table) — replaces config/ownership.json.
 * Exported function names/signatures are unchanged, so callers only needed `await` added.
 * Categories: tests, reports, baselines, files
 */

import * as ownershipRepo from './db/repositories/ownershipRepo.js';

// ── Public API ───────────────────────────────────────────

/**
 * Set the owner of a file in a category.
 * @param {'tests'|'reports'|'baselines'|'files'} category
 * @param {string} filename - filename or relative path within category
 * @param {string} userId - owner's user ID
 */
async function setOwner(category, filename, userId) {
  return ownershipRepo.setOwner(category, filename, userId);
}

/**
 * Get the owner userId of a file, or null if untracked.
 */
async function getOwner(category, filename) {
  return ownershipRepo.getOwner(category, filename);
}

/**
 * Remove ownership record (e.g. on file deletion).
 */
async function removeOwner(category, filename) {
  return ownershipRepo.removeOwner(category, filename);
}

/**
 * Bulk set ownership for multiple files at once.
 * @param {'tests'|'reports'|'baselines'|'files'} category
 * @param {string[]} filenames
 * @param {string} userId
 */
async function setOwnerBulk(category, filenames, userId) {
  return ownershipRepo.setOwnerBulk(category, filenames, userId);
}

/**
 * Get all filenames owned by a specific user in a category.
 * If isAdmin is true, returns ALL filenames in the category.
 */
async function getOwnedFilenames(category, userId, isAdmin) {
  return ownershipRepo.getOwnedFilenames(category, userId, isAdmin);
}

/**
 * Check if a user is the owner of a file (or is admin).
 * Unowned files (no record) are treated as admin-only.
 */
async function isOwnerOrAdmin(category, filename, userId, isAdmin) {
  return ownershipRepo.isOwnerOrAdmin(category, filename, userId, isAdmin);
}

export {
  setOwner,
  getOwner,
  removeOwner,
  setOwnerBulk,
  getOwnedFilenames,
  isOwnerOrAdmin
};
