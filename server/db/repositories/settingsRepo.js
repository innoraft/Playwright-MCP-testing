/**
 * App settings repository — Postgres-backed replacement for config/llm.config.js.
 * Stored as a single jsonb row under key 'llm_config'; no more unsafe Function() eval.
 */

import { pool } from '../pool.js';

const LLM_CONFIG_KEY = 'llm_config';
const DEFAULT_LLM_CONFIG = { provider: 'openai', model: 'gpt-5', apiKey: '', temperature: 1 };

async function getLlmConfig() {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [LLM_CONFIG_KEY]);
  if (!rows[0]) return { ...DEFAULT_LLM_CONFIG };
  return { ...DEFAULT_LLM_CONFIG, ...rows[0].value };
}

async function setLlmConfig(config) {
  const value = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey || '',
    temperature: config.temperature !== undefined ? Number(config.temperature) : 1,
  };

  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [LLM_CONFIG_KEY, JSON.stringify(value)]
  );
}

export { getLlmConfig, setLlmConfig };
