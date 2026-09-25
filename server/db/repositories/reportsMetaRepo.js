/**
 * Report metadata repository — caches parsed HTML report stats so listing
 * reports doesn't re-parse every .html file from disk on every request.
 */

import { pool } from '../pool.js';

async function upsertReportMeta({
  filename,
  ownerId,
  result,
  totalActions,
  passed,
  failed,
  successRate,
  duration,
  testName,
  targetUrl,
  generatedAt,
}) {
  await pool.query(
    `INSERT INTO reports_meta
       (filename, owner_user_id, result, total_actions, passed, failed, success_rate, duration, test_name, target_url, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (filename) DO UPDATE SET
       owner_user_id = EXCLUDED.owner_user_id,
       result = EXCLUDED.result,
       total_actions = EXCLUDED.total_actions,
       passed = EXCLUDED.passed,
       failed = EXCLUDED.failed,
       success_rate = EXCLUDED.success_rate,
       duration = EXCLUDED.duration,
       test_name = EXCLUDED.test_name,
       target_url = EXCLUDED.target_url,
       generated_at = EXCLUDED.generated_at`,
    [filename, ownerId, result, totalActions, passed, failed, successRate, duration, testName, targetUrl, generatedAt]
  );
}

async function getReportMeta(filename) {
  const { rows } = await pool.query('SELECT * FROM reports_meta WHERE filename = $1', [filename]);
  return rows[0] || null;
}

async function deleteReportMeta(filename) {
  await pool.query('DELETE FROM reports_meta WHERE filename = $1', [filename]);
}

export { upsertReportMeta, getReportMeta, deleteReportMeta };
