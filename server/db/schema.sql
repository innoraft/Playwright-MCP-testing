CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text UNIQUE,
  password_hash text NOT NULL,
  roles text[] NOT NULL DEFAULT ARRAY['authenticated'],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  reset_requested_at timestamptz
);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_ownership (
  category text NOT NULL,
  filename text NOT NULL,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, filename)
);
CREATE INDEX IF NOT EXISTS idx_file_ownership_owner ON file_ownership(owner_user_id);

CREATE TABLE IF NOT EXISTS tests_meta (
  name text PRIMARY KEY,
  type text NOT NULL,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  modified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tests_meta_owner ON tests_meta(owner_user_id);

CREATE TABLE IF NOT EXISTS reports_meta (
  filename text PRIMARY KEY,
  owner_user_id text REFERENCES users(id) ON DELETE CASCADE,
  result text,
  total_actions int,
  passed int,
  failed int,
  success_rate numeric,
  duration text,
  test_name text,
  target_url text,
  generated_at text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_meta_owner ON reports_meta(owner_user_id);

CREATE TABLE IF NOT EXISTS run_history (
  run_id text PRIMARY KEY,
  test_name text NOT NULL,
  owner_user_id text REFERENCES users(id) ON DELETE CASCADE,
  result text,
  report_filename text,
  started_at timestamptz,
  finished_at timestamptz,
  exit_code int,
  log_count int
);
CREATE INDEX IF NOT EXISTS idx_run_history_owner_started ON run_history(owner_user_id, started_at DESC);