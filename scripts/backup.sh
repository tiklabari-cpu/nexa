#!/usr/bin/env bash
#
# Back up a SiyahTuş datastore (tm 165.1, M-BACKUP-a): a logical Postgres
# dump plus a tar of the local object-storage directory, under one UTC
# timestamp.
#
# psql/pg_dump are not assumed to be on the host — same reasoning as the
# Makefile's `psql` target (`make psql`): pg_dump runs *inside* the `db`
# compose container, via `docker compose exec`, against whatever
# `docker-compose.yml` (the `make dev` datastores) currently has up.
#
# PILOT MODE (tm 418): `COMPOSE_FILE=docker-compose.pilot.yml` — Compose reads
# that variable itself, so every `docker compose` call below, the dump and the
# uploads archive alike, goes to the pilot's compose project; no `-f` here.
# There the uploads are not a host directory but the named volume
# `siyahtus_pilot_uploads`, mounted in the api container at
# /var/lib/siyahtus/uploads, so they are archived from inside that container
# (`docker compose exec -T api tar …`). UPLOADS_SERVICE names the container
# (it defaults to `api` when COMPOSE_FILE names the pilot file), and
# UPLOADS_CONTAINER_DIR the directory in it. Without either, the uploads are
# the host directory UPLOADS_DIR, as they always were for the dev stack.
#
# The dump is taken first, then the files: every file the dump refers to was
# already written when the archive is read. A file uploaded in between is in
# the archive and in no row, which a restore can carry.
#
# RETENTION POLICY (NFR-C8 — "backups are subject to the retention policy
# too", not exempt from it):
#
#   Backups older than BACKUP_RETENTION_DAYS (default 30, overridable) are
#   deleted whole-file on this script's own next run. A pg_dump archive has
#   no smaller deletable unit than itself, so "retention" here means the
#   whole snapshot ages out, not a row inside it.
#
#   30 days mirrors GDPR Art. 12(3)'s one-month response window for an
#   Art. 17 erasure request (see apps/api/src/services/retention/policy.ts
#   for the live-database side of NFR-C8): a request honoured in the live
#   database today is gone from every backup within roughly the same
#   window, without this script having to reach inside an archive to do it.
#
#   Urgent case — a single-subject erasure that cannot wait out the window:
#   identify which backup(s) were taken between the subject's creation and
#   the erasure (`ls -la "$BACKUP_DIR"`, filenames are UTC timestamps) and
#   delete those files by hand. There is no partial-file redaction in this
#   repo; deleting the archive is the procedure, not a gap in one.
#
# Usage:
#   ./scripts/backup.sh
#   BACKUP_DIR=./backups BACKUP_RETENTION_DAYS=30 ./scripts/backup.sh
#   COMPOSE_FILE=docker-compose.pilot.yml ./scripts/backup.sh   # the pilot
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-siyahtus}"
DB_NAME="${DB_NAME:-siyahtus}"
UPLOADS_DIR="${UPLOADS_DIR:-.data/uploads}"
case "${COMPOSE_FILE:-}" in
  *docker-compose.pilot.yml*) UPLOADS_SERVICE="${UPLOADS_SERVICE:-api}" ;;
  *) UPLOADS_SERVICE="${UPLOADS_SERVICE:-}" ;;
esac
UPLOADS_CONTAINER_DIR="${UPLOADS_CONTAINER_DIR:-/var/lib/siyahtus/uploads}"
# Git Bash would rewrite the container path above into a Windows one before
# docker sees it. No effect anywhere else.
export MSYS_NO_PATHCONV=1

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

# Each archive is written under `.partial` and renamed when complete, so a
# failed run never leaves a truncated file under a name a restore would pick.
partial=''
trap '[ -z "$partial" ] || rm -f "$partial"' EXIT

printf 'SiyahTuş backup — %s\n' "$timestamp"

# --- Database: custom-format dump (pg_restore can filter/parallelize it,
# unlike a plain SQL dump) ---
db_dump="$BACKUP_DIR/db-$timestamp.dump"
printf '  db      -> %s\n' "$db_dump"
partial="$db_dump.partial"
docker compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$partial"
mv "$partial" "$db_dump"
partial=''

# --- Object storage (STORAGE_PROVIDER=local writes here — see
# apps/api/src/services/storage/object-store.ts). On the host it is skipped,
# not failed, on a fresh checkout that has never taken an upload yet; in a
# container the directory always exists (the image creates it), and a
# container that cannot be read fails the backup. ---
uploads_archive="$BACKUP_DIR/uploads-$timestamp.tar.gz"
if [ -n "$UPLOADS_SERVICE" ]; then
  printf '  uploads -> %s (%s in the %s container)\n' \
    "$uploads_archive" "$UPLOADS_CONTAINER_DIR" "$UPLOADS_SERVICE"
  partial="$uploads_archive.partial"
  docker compose exec -T "$UPLOADS_SERVICE" \
    tar -czf - -C "$(dirname "$UPLOADS_CONTAINER_DIR")" "$(basename "$UPLOADS_CONTAINER_DIR")" \
    </dev/null >"$partial"
  mv "$partial" "$uploads_archive"
  partial=''
elif [ -d "$UPLOADS_DIR" ]; then
  printf '  uploads -> %s\n' "$uploads_archive"
  tar -czf "$uploads_archive" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
else
  printf '  uploads -> skipped (%s does not exist yet)\n' "$UPLOADS_DIR"
fi

# --- Retention: prune whole archives past the window (see policy above) ---
pruned="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' -o -name '*.partial' \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -print -delete)"
if [ -n "$pruned" ]; then
  printf 'Pruned (older than %sd):\n%s\n' "$BACKUP_RETENTION_DAYS" "$pruned"
fi

printf 'Done. %s\n' "$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
