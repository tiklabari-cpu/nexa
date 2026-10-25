-- SiyahTuş — base extensions. Runs once on first container start (empty data dir).
-- Idempotent so it is also safe to re-run manually via `make db-extensions`.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email columns
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector (knowledge_chunks.embedding)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram GIN, message text search (events_text_search_idx)

-- Dedicated application role used by the API. RLS policies are enforced against
-- this role; it is intentionally NOT a superuser and NOT the table owner, because
-- Postgres exempts both from row level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_app') THEN
    CREATE ROLE siyahtus_app LOGIN PASSWORD 'siyahtus_app_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE siyahtus TO siyahtus_app;
GRANT USAGE ON SCHEMA public TO siyahtus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siyahtus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO siyahtus_app;

-- Platform (root panel) role, tm 389.1 · docs/platform-admin/design.md §B1. It
-- reads every tenant (BYPASSRLS) and is never used by the tenant API. The
-- migration 20261101090000_platform_role_and_tables repeats this block and
-- holds its grants; the pilot replaces the development password in
-- infra/db/pilot/20-platform-role-password.sh.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    CREATE ROLE siyahtus_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
      PASSWORD 'siyahtus_platform_dev_password';
  END IF;
  -- BYPASSRLS needs a superuser; this container's init user is one.
  BEGIN
    EXECUTE 'ALTER ROLE siyahtus_platform BYPASSRLS';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'siyahtus_platform: BYPASSRLS could not be granted';
  END;
END
$$;

GRANT CONNECT ON DATABASE siyahtus TO siyahtus_platform;
