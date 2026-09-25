-- Baseline: extensions and the least-privileged runtime role.
--
-- docker-compose also runs infra/db/init/00-extensions.sql on a fresh volume,
-- but a migration must be able to bring up an arbitrary database (CI, staging,
-- a restored dump), so it repeats the work idempotently rather than assuming it.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "vector";

-- The API connects as siyahtus_app, never as the owner: PostgreSQL exempts table
-- owners and superusers from row level security, so using the migration role at
-- runtime would silently disable every tenant isolation policy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_app') THEN
    CREATE ROLE siyahtus_app LOGIN PASSWORD 'siyahtus_app_dev_password';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO siyahtus_app;

-- Applies to tables created by future migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siyahtus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO siyahtus_app;

-- And to anything that already exists (re-running on a populated database).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siyahtus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO siyahtus_app;
