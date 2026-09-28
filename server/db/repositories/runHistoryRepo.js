/**
 * Run history repository — persists completed test runs so history survives server restarts
 * (previously an in-memory array capped at 50 in server/index.js).
 */

import { pool } from '../pool.js';

const MAX_HISTORY = 50;

async function insertRunHistory({
  runId,
  testName,
  ownerId,
  result,
  reportFilename,
  startedAt,
  finishedAt,
  exitCode,
  logCount,
}) {
  await pool.query(
    `INSERT INTO run_history
       (run_id, test_name, owner_user_id, result, report_filename, started_at, finished_at, exit_code, log_count)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), $8, $9)
     ON CONFLICT (run_id) DO NOTHING`,
    [runId, testName, ownerId, result, reportFilename, startedAt, finishedAt, exitCode, logCount]
  );

  // Keep the table bounded, mirroring the previous in-memory MAX_HISTORY cap.
  await pool.query(
    `DELETE FROM run_history
     WHERE run_id IN (
       SELECT run_id FROM run_history ORDER BY finished_at DESC OFFSET $1
     )`,
    [MAX_HISTORY]
  );
}

function toClientShape(row) {
  return {
    runId: row.run_id,
    testName: row.test_name,
    userId: row.owner_user_id,
    result: row.result,
    reportFile: row.report_filename,
    startedAt: row.started_at ? row.started_at.getTime() : null,
    finishedAt: row.finished_at ? row.finished_at.getTime() : null,
    exitCode: row.exit_code,
    logCount: row.log_count,
  };
}

async function listRunHistory(userId, isAdmin) {
  const { rows } = isAdmin
    ? await pool.query('SELECT * FROM run_history ORDER BY finished_at DESC LIMIT $1', [MAX_HISTORY])
    : await pool.query(
        'SELECT * FROM run_history WHERE owner_user_id = $1 ORDER BY finished_at DESC LIMIT $2',
        [userId, MAX_HISTORY]
      );
  return rows.map(toClientShape);
}

export { insertRunHistory, listRunHistory };
