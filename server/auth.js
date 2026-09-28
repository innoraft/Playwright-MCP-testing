/**
 * Authentication & User Management Module
 * ──────────────────────────────────────────
 * Postgres-backed user store (bcrypt password hashing + JWT sessions).
 * Exported function names/signatures are unchanged from the previous
 * JSON-file-based implementation, so server/index.js only needed `await` added.
 */

import jwt from 'jsonwebtoken';
import * as usersRepo from './db/repositories/usersRepo.js';

const TOKEN_EXPIRY = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to your .env file.');
  }
  return secret;
}

// ── Initialization (seed admin) ──────────────────────────

async function initializeAuth() {
  // Fail fast on boot if the secret is missing rather than on first login attempt.
  getSecret();
  await usersRepo.ensureAdminSeeded();
}

// ── JWT helpers ──────────────────────────────────────────

function signToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    roles: user.roles
  };
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

function hasAdminRole(roles) {
  if (!Array.isArray(roles)) return false;
  return roles.some((role) => String(role).toLowerCase() === 'admin');
}

// ── User CRUD (delegated to usersRepo) ───────────────────

async function getAllUsers() {
  return usersRepo.getAllUsers();
}

async function getUserById(id) {
  return usersRepo.getUserById(id);
}

async function getUserByUsername(username) {
  return usersRepo.getUserByUsername(username);
}

async function createUser(input) {
  return usersRepo.createUser(input);
}

async function updateUser(id, updates) {
  return usersRepo.updateUser(id, updates);
}

// ── Authentication ───────────────────────────────────────

async function authenticate(username, password) {
  return usersRepo.authenticate(username, password);
}

// ── Forgot Password (admin-assisted) ─────────────────────

async function requestPasswordReset(username) {
  return usersRepo.requestPasswordReset(username);
}

async function getResetRequests() {
  return usersRepo.getResetRequests();
}

async function clearResetRequest(userId) {
  return usersRepo.clearResetRequest(userId);
}

// ── Express Middleware ────────────────────────────────────

/**
 * Extracts and verifies JWT from Authorization header.
 * Attaches req.user = { userId, username, roles } on success.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);

    // Always hydrate from store so role changes (e.g. user promoted to admin)
    // take effect immediately without requiring token re-login.
    const user = await usersRepo.getUserById(decoded.userId);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      userId: user.id,
      username: user.username,
      roles: Array.isArray(user.roles) ? user.roles : []
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Requires the user to have the 'admin' role.
 * Must be used after requireAuth.
 */
function requireAdminRole(req, res, next) {
  if (!req.user || !hasAdminRole(req.user.roles)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

export {
  initializeAuth,
  signToken,
  verifyToken,
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  authenticate,
  requireAuth,
  requireAdminRole,
  requestPasswordReset,
  getResetRequests,
  clearResetRequest
};
