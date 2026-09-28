/**
 * Test metadata repository — Postgres cache of tests/*.test.yml ownership + type.
 * The YAML content itself remains on disk as the source of truth.
 */

import { pool } from '../pool.js';

async function upsertTestMeta({ name, type, ownerId }) {
  await pool.query(
    `INSERT INTO tests_meta (name, type, owner_user_id, modified_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, modified_at = now()`,
    [name, type, ownerId]
  );
}

async function renameTestMeta(oldName, newName) {
  await pool.query('UPDATE tests_meta SET name = $1, modified_at = now() WHERE name = $2', [newName, oldName]);
}

async function deleteTestMeta(name) {
  await pool.query('DELETE FROM tests_meta WHERE name = $1', [name]);
}

async function getTestMeta(name) {
  const { rows } = await pool.query('SELECT * FROM tests_meta WHERE name = $1', [name]);
  return rows[0] || null;
}

async function listTestsMeta() {
  const { rows } = await pool.query('SELECT * FROM tests_meta');
  return rows;
}

export { upsertTestMeta, renameTestMeta, deleteTestMeta, getTestMeta, listTestsMeta };
