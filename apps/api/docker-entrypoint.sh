#!/bin/sh
# Runs once per container start, before the app process. Migrations connect as
# the table owner (DATABASE_URL); the app itself connects as `nexa_app`
# (DATABASE_APP_URL) so row level security stays in force — see
# apps/api/src/plugins/database.ts and README's "table owner ile bağlanmaz" rule.
#
# NEXA_MIGRATE_ON_START=false turns the migrate step off (tm 164.3). It exists
# because "migrate on every container start" is right for one container and
# wrong for several: `prisma migrate deploy` serialises on a Postgres advisory
# lock, but it only waits 10 s for it (measured — scripts/measure-concurrent-
# migrate.ts, scenario 3: P1002, exit 1). One migration slower than that and
# every *other* replica's entrypoint exits non-zero, so the app never starts and
# the pod crash-loops — during the rollout that is changing the schema, which is
# the worst possible moment. A deployment that migrates somewhere else (this
# repo's Helm chart runs a pre-upgrade Job: infra/helm/nexa/templates/
# migrate-job.yaml) sets this to `false`; see CONVENTIONS §6.
#
# The default stays `true`, deliberately: `docker-compose.full.yml`, `docker run`
# of this image and every instruction already written about it assume the image
# migrates itself, and only a >1-replica deployment has a reason to opt out.
# Silently flipping the default would break the documented single-container case
# to protect a case that has to configure itself anyway.
set -e

if [ "${NEXA_MIGRATE_ON_START:-true}" = "false" ]; then
    echo "docker-entrypoint: NEXA_MIGRATE_ON_START=false — skipping prisma migrate deploy"
else
    echo "docker-entrypoint: prisma migrate deploy"
    npx prisma migrate deploy --schema=./prisma/schema.prisma
fi

echo "docker-entrypoint: starting @nexa/api"
exec "$@"
