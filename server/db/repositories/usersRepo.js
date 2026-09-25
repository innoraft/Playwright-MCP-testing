/**
 * Users repository — Postgres-backed replacement for the old users.json store.
 * Row shape mirrors what server/auth.js previously read from JSON.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../pool.js';

const SALT_ROUNDS = 10;

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    roles: row.roles || [],
    active: row.active,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
  };
}

async function getAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, username, email, roles, active, created_at FROM users ORDER BY created_at ASC'
  );
  return rows.map(toPublicUser);
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function usernameOrEmailTaken(username, email, excludeId) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE (username = $1 OR ($2::text IS NOT NULL AND email = $2)) AND id IS DISTINCT FROM $3`,
    [username, email || null, excludeId || null]
  );
  return rows;
}

async function createUser({ username, email, password, roles = ['authenticated'] }) {
  const existing = await usernameOrEmailTaken(username, email, null);
  if (existing.length > 0) {
    const { rows } = await pool.query('SELECT username, email FROM users WHERE id = $1', [existing[0].id]);
    if (rows[0]?.username === username) throw new Error('Username already exists');
    throw new Error('Email already exists');
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const { rows } = await pool.query(
    `INSERT INTO users (id, username, email, password_hash, roles, active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, username, email, roles, active, created_at`,
    [id, username, email || '', hash, roles]
  );

  return toPublicUser(rows[0]);
}

async function updateUser(id, updates) {
  const user = await getUserById(id);
  if (!user) throw new Error('User not found');

  const nextUsername = updates.username !== undefined ? updates.username : user.username;
  const nextEmail = updates.email !== undefined ? updates.email : user.email;

  if (updates.username !== undefined || updates.email !== undefined) {
    const conflicts = await usernameOrEmailTaken(nextUsername, nextEmail || null, id);
    if (conflicts.length > 0) {
      if (updates.username !== undefined) throw new Error('Username already exists');
      throw new Error('Email already exists');
    }
  }

  const nextRoles = updates.roles !== undefined ? updates.roles : user.roles;
  const nextActive = updates.active !== undefined ? updates.active : user.active;
  const nextPasswordHash = updates.password
    ? await bcrypt.hash(updates.password, SALT_ROUNDS)
    : user.password_hash;

  const { rows } = await pool.query(
    `UPDATE users
     SET username = $1, email = $2, roles = $3, active = $4, password_hash = $5
     WHERE id = $6
     RETURNING id, username, email, roles, active, created_at`,
    [nextUsername, nextEmail || '', nextRoles, nextActive, nextPasswordHash, id]
  );

  return toPublicUser(rows[0]);
}

async function authenticate(username, password) {
  const user = await getUserByUsername(username);
  if (!user || !user.active) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return { id: user.id, username: user.username, email: user.email, roles: user.roles };
}

async function requestPasswordReset(username) {
  const { rows } = await pool.query(
    `UPDATE users SET reset_requested_at = now() WHERE username = $1 AND active = true
     RETURNING id, username`,
    [username]
  );
  if (!rows[0]) return null;
  return { username: rows[0].username, userId: rows[0].id };
}

async function getResetRequests() {
  const { rows } = await pool.query(
    `SELECT id, username, email, reset_requested_at FROM users WHERE reset_requested_at IS NOT NULL`
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    requestedAt: row.reset_requested_at ? row.reset_requested_at.toISOString() : null,
  }));
}

async function clearResetRequest(userId) {
  await pool.query('UPDATE users SET reset_requested_at = NULL WHERE id = $1', [userId]);
}

/** Seeds the default admin account if no users exist yet. Idempotent. */
async function ensureAdminSeeded() {
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (rows.length > 0) return;

  const hash = await bcrypt.hash('admin123', SALT_ROUNDS);
  await pool.query(
    `INSERT INTO users (id, username, email, password_hash, roles, active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    ['admin-001', 'admin', 'admin@playwright-mcp.local', hash, ['admin', 'authenticated']]
  );
  console.log('🔐 Default admin account created (username: admin, password: admin123)');
}

export {
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  authenticate,
  requestPasswordReset,
  getResetRequests,
  clearResetRequest,
  ensureAdminSeeded,
};
