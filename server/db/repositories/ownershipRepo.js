/**
 * File ownership repository — Postgres-backed replacement for ownership.json.
 * Categories: tests, reports, baselines, files.
 */

import { pool } from '../pool.js';

async function setOwner(category, filename, userId) {
  await pool.query(
    `INSERT INTO file_ownership (category, filename, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (category, filename) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id`,
    [category, filename, userId]
  );
}

async function getOwner(category, filename) {
  const { rows } = await pool.query(
    'SELECT owner_user_id FROM file_ownership WHERE category = $1 AND filename = $2',
    [category, filename]
  );
  return rows[0]?.owner_user_id || null;
}

async function removeOwner(category, filename) {
  await pool.query('DELETE FROM file_ownership WHERE category = $1 AND filename = $2', [category, filename]);
}

async function setOwnerBulk(category, filenames, userId) {
  if (!filenames || filenames.length === 0) return;
  const values = [];
  const placeholders = filenames.map((filename, i) => {
    values.push(category, filename, userId);
    const base = i * 3;
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  });

  await pool.query(
    `INSERT INTO file_ownership (category, filename, owner_user_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (category, filename) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id`,
    values
  );
}

async function getOwnedFilenames(category, userId, isAdmin) {
  if (isAdmin) {
    const { rows } = await pool.query('SELECT filename FROM file_ownership WHERE category = $1', [category]);
    return rows.map((r) => r.filename);
  }

  const { rows } = await pool.query(
    'SELECT filename FROM file_ownership WHERE category = $1 AND owner_user_id = $2',
    [category, userId]
  );
  return rows.map((r) => r.filename);
}

async function isOwnerOrAdmin(category, filename, userId, isAdmin) {
  if (isAdmin) return true;
  const owner = await getOwner(category, filename);
  return owner === userId;
}

export { setOwner, getOwner, removeOwner, setOwnerBulk, getOwnedFilenames, isOwnerOrAdmin };
