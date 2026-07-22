-- Nexa — base extensions. Runs once on first container start (empty data dir).
-- Idempotent so it is also safe to re-run manually via `make db-extensions`.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email columns
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector (knowledge_chunks.embedding)

-- Dedicated application role used by the API. RLS policies are enforced against
-- this role; it is intentionally NOT a superuser and NOT the table owner, because
-- Postgres exempts both from row level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexa_app') THEN
    CREATE ROLE nexa_app LOGIN PASSWORD 'nexa_app_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE nexa TO nexa_app;
GRANT USAGE ON SCHEMA public TO nexa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexa_app;
