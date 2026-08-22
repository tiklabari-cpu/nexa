#!/bin/sh
# Runs once per container start, before the app process. Migrations connect as
# the table owner (DATABASE_URL); the app itself connects as `nexa_app`
# (DATABASE_APP_URL) so row level security stays in force — see
# apps/api/src/plugins/database.ts and README's "table owner ile bağlanmaz" rule.
set -e

echo "docker-entrypoint: prisma migrate deploy"
npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "docker-entrypoint: starting @nexa/api"
exec "$@"
