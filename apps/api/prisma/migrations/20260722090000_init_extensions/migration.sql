-- Baseline: extensions and the least-privileged runtime role.
--
-- docker-compose also runs infra/db/init/00-extensions.sql on a fresh volume,
-- but a migration must be able to bring up an arbitrary database (CI, staging,
-- a restored dump), so it repeats the work idempotently rather than assuming it.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "vector";

-- The API connects as nexa_app, never as the owner: PostgreSQL exempts table
-- owners and superusers from row level security, so using the migration role at
-- runtime would silently disable every tenant isolation policy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexa_app') THEN
    CREATE ROLE nexa_app LOGIN PASSWORD 'nexa_app_dev_password';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO nexa_app;

-- Applies to tables created by future migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexa_app;

-- And to anything that already exists (re-running on a populated database).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexa_app;
