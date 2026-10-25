#!/bin/sh
# Pilot only (tm 389.1, docker-compose.pilot.yml). Runs once, on the first
# start of an empty data directory, after `00-extensions.sql` has created the
# `siyahtus_platform` role (BYPASSRLS — it reads every workspace) with the
# development password every copy of this repository publishes. Same pattern
# as 10-app-role-password.sh, with one difference on purpose:
#
# The tenant pilot does not need this role (the platform API and the admin
# panel, tm 389.3+, do), so an empty `SIYAHTUS_PLATFORM_DB_PASSWORD` does not
# stop the database from initialising (owner rule 2026-10-10: no new
# boot-blocking rule). Instead the role is locked — NOLOGIN, no password — so
# the published development password never opens a cross-tenant connection.
# Unlocking it later is a manual `ALTER ROLE siyahtus_platform LOGIN PASSWORD …`,
# see docs/production-checklist.md "Pilot on Docker Compose".
#
# The value comes from the container environment and is passed to psql as a
# variable, so it is quoted by psql (`:'…'`) rather than spliced into SQL text.
# Like every script in /docker-entrypoint-initdb.d, this does NOT run against a
# data directory that already exists.
set -e

# if/else rather than an early `exit`: the entrypoint *sources* a script that
# is not executable, and an `exit` there would end the whole initialisation.
if [ -z "${SIYAHTUS_PLATFORM_DB_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
ALTER ROLE siyahtus_platform NOLOGIN PASSWORD NULL;
SQL
  echo "20-platform-role-password: SIYAHTUS_PLATFORM_DB_PASSWORD is empty; siyahtus_platform locked (NOLOGIN)" >&2
else
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v platform_password="$SIYAHTUS_PLATFORM_DB_PASSWORD" <<'SQL'
ALTER ROLE siyahtus_platform LOGIN PASSWORD :'platform_password';
SQL
  echo "20-platform-role-password: siyahtus_platform password set from SIYAHTUS_PLATFORM_DB_PASSWORD"
fi
