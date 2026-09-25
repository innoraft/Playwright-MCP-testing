/**
 * PostgreSQL connection pool (self-hosted Postgres — local dev and production server).
 * All app code should import `pool` from here; never construct a client directly.
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// pg reads PGHOST, PGPORT, PGUSER, PGPASSWORD, and PGDATABASE directly.
const ssl = String(process.env.PGSSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  ssl,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Idle client errors must not crash the process — log and let the pool recover.
  console.error('❌ Unexpected Postgres pool error:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export { pool, query, withTransaction };
