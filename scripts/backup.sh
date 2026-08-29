#!/usr/bin/env bash
#
# Back up the dev/demo datastore (tm 165.1, M-BACKUP-a): a logical Postgres
# dump plus a tar of the local object-storage directory.
#
# psql/pg_dump are not assumed to be on the host — same reasoning as the
# Makefile's `psql` target (`make psql`): pg_dump runs *inside* the `db`
# compose container, via `docker compose exec`, against whatever
# `docker-compose.yml` (the `make dev` datastores) currently has up.
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
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-nexa}"
DB_NAME="${DB_NAME:-nexa}"
UPLOADS_DIR="${UPLOADS_DIR:-.data/uploads}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

printf 'Nexa backup — %s\n' "$timestamp"

# --- Database: custom-format dump (pg_restore can filter/parallelize it,
# unlike a plain SQL dump) ---
db_dump="$BACKUP_DIR/db-$timestamp.dump"
printf '  db      -> %s\n' "$db_dump"
docker compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$db_dump"

# --- Object storage (STORAGE_PROVIDER=local writes here — see
# apps/api/src/services/storage/object-store.ts). Skipped, not failed, on a
# fresh checkout that has never taken an upload yet. ---
if [ -d "$UPLOADS_DIR" ]; then
  uploads_archive="$BACKUP_DIR/uploads-$timestamp.tar.gz"
  printf '  uploads -> %s\n' "$uploads_archive"
  tar -czf "$uploads_archive" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
else
  printf '  uploads -> skipped (%s does not exist yet)\n' "$UPLOADS_DIR"
fi

# --- Retention: prune whole archives past the window (see policy above) ---
pruned="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -print -delete)"
if [ -n "$pruned" ]; then
  printf 'Pruned (older than %sd):\n%s\n' "$BACKUP_RETENTION_DAYS" "$pruned"
fi

printf 'Done. %s\n' "$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
