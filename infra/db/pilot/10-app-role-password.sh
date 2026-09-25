#!/bin/sh
# Pilot only (tm 255.15, docker-compose.pilot.yml). Runs once, on the first
# start of an empty data directory, right after `00-extensions.sql` has created
# the non-owner `siyahtus_app` role with the development password every copy of
# this repository publishes. The pilot's api and rtm connect as that role
# (DATABASE_APP_URL), so leaving the published password in place would make
# the one credential row level security depends on a public one.
#
# The value comes from the container environment (`SIYAHTUS_APP_DB_PASSWORD`, set
# by the compose file from the pilot's `.env`) and is passed to psql as a
# variable, so it is quoted by psql (`:'…'`) rather than spliced into SQL text.
#
# Like every script in /docker-entrypoint-initdb.d, this does NOT run against a
# data directory that already exists. Changing the password later is a manual
# `ALTER ROLE siyahtus_app PASSWORD …` plus the same change in `.env` — see
# docs/production-checklist.md "Pilot on Docker Compose".
set -e

if [ -z "${SIYAHTUS_APP_DB_PASSWORD:-}" ]; then
  echo "10-app-role-password: SIYAHTUS_APP_DB_PASSWORD is empty; refusing to keep the development password" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$SIYAHTUS_APP_DB_PASSWORD" <<'SQL'
ALTER ROLE siyahtus_app PASSWORD :'app_password';
SQL

echo "10-app-role-password: siyahtus_app password set from SIYAHTUS_APP_DB_PASSWORD"
