/**
 * Authentication & User Management Module
 * ──────────────────────────────────────────
 * JSON-file-based user store with bcrypt password hashing and JWT sessions.
 * No database required — users are stored in config/users.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_PATH = path.join(__dirname, '..', 'config', 'users.json');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';

// ── Load / Save ──────────────────────────────────────────

function loadStore() {
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { users: [], jwtSecret: '' };
  }
}

function saveStore(store) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

// ── Initialization (seed admin + JWT secret) ─────────────

async function initializeAuth() {
  const store = loadStore();

  // Generate persistent JWT secret if missing
  if (!store.jwtSecret) {
    store.jwtSecret = crypto.randomBytes(64).toString('hex');
  }

  // Seed default admin if no users exist or admin has placeholder hash
  const admin = store.users.find(u => u.username === 'admin');
  if (!admin) {
    const hash = await bcrypt.hash('admin123', SALT_ROUNDS);
    store.users.push({
      id: 'admin-001',
      username: 'admin',
      email: 'admin@playwright-mcp.local',
      passwordHash: hash,
      roles: ['admin', 'authenticated'],
      active: true,
      createdAt: new Date().toISOString()
    });
    console.log('🔐 Default admin account created (username: admin, password: admin123)');
  } else if (admin.passwordHash === '$2a$10$placeholder') {
    admin.passwordHash = await bcrypt.hash('admin123', SALT_ROUNDS);
    console.log('🔐 Default admin password set (username: admin, password: admin123)');
  }

  saveStore(store);
  return store;
}

// ── JWT helpers ──────────────────────────────────────────

function getSecret() {
  return loadStore().jwtSecret;
}

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

// ── User CRUD ────────────────────────────────────────────

function getAllUsers() {
  const store = loadStore();
  return store.users.map(u => ({
    id: u.id,
    username: u.username,
    email: u.email,
    roles: u.roles,
    active: u.active,
    createdAt: u.createdAt
  }));
}

function getUserById(id) {
  const store = loadStore();
  return store.users.find(u => u.id === id) || null;
}

function getUserByUsername(username) {
  const store = loadStore();
  return store.users.find(u => u.username === username) || null;
}

async function createUser({ username, email, password, roles = ['authenticated'] }) {
  const store = loadStore();

  // Check uniqueness
  if (store.users.some(u => u.username === username)) {
    throw new Error('Username already exists');
  }
  if (email && store.users.some(u => u.email === email)) {
    throw new Error('Email already exists');
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = {
    id: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    username,
    email: email || '',
    passwordHash: hash,
    roles,
    active: true,
    createdAt: new Date().toISOString()
  };

  store.users.push(user);
  saveStore(store);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    active: user.active,
    createdAt: user.createdAt
  };
}

async function updateUser(id, updates) {
  const store = loadStore();
  const idx = store.users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('User not found');

  const user = store.users[idx];

  if (updates.username !== undefined) {
    if (store.users.some(u => u.username === updates.username && u.id !== id)) {
      throw new Error('Username already exists');
    }
    user.username = updates.username;
  }

  if (updates.email !== undefined) {
    if (updates.email && store.users.some(u => u.email === updates.email && u.id !== id)) {
      throw new Error('Email already exists');
    }
    user.email = updates.email;
  }

  if (updates.roles !== undefined) {
    user.roles = updates.roles;
  }

  if (updates.active !== undefined) {
    user.active = updates.active;
  }

  if (updates.password) {
    user.passwordHash = await bcrypt.hash(updates.password, SALT_ROUNDS);
  }

  store.users[idx] = user;
  saveStore(store);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    active: user.active,
    createdAt: user.createdAt
  };
}

// ── Authentication ───────────────────────────────────────

async function authenticate(username, password) {
  const store = loadStore();
  const user = store.users.find(u => u.username === username);

  if (!user) return null;
  if (!user.active) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles
  };
}

// ── Forgot Password (admin-assisted) ─────────────────────

function requestPasswordReset(username) {
  const store = loadStore();
  const user = store.users.find(u => u.username === username);
  if (!user) return null;
  if (!user.active) return null;

  user.resetRequestedAt = new Date().toISOString();
  saveStore(store);

  return { username: user.username, userId: user.id };
}

function getResetRequests() {
  const store = loadStore();
  return store.users
    .filter(u => u.resetRequestedAt)
    .map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      requestedAt: u.resetRequestedAt
    }));
}

function clearResetRequest(userId) {
  const store = loadStore();
  const user = store.users.find(u => u.id === userId);
  if (!user) return;
  delete user.resetRequestedAt;
  saveStore(store);
}

// ── Express Middleware ────────────────────────────────────

/**
 * Extracts and verifies JWT from Authorization header.
 * Attaches req.user = { userId, username, roles } on success.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);

    // Always hydrate from store so role changes (e.g. user promoted to admin)
    // take effect immediately without requiring token re-login.
    const user = getUserById(decoded.userId);
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
