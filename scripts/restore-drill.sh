#!/usr/bin/env bash
#
# Restore drill (tm 165.2, M-BACKUP-b).
#
# `scripts/backup.sh` proves a backup was *produced*. That is a weaker claim
# than the one NFR-R5 actually needs, and the gap between them is where backup
# strategies fail: an archive that restores into an empty schema, a policy that
# came back as a comment, an extension the target cluster does not have. So this
# script measures the other claim — the archive is *restorable*, and what comes
# back is the database that went in.
#
# It restores into a scratch database it creates itself, verifies, and drops it
# again (including when a check fails, or when the window is interrupted). It
# never writes to `siyahtus`: every statement against the source database is a
# SELECT, and the only DDL is CREATE/DROP DATABASE against a name that has to
# match `siyahtus_restore_drill_<digits>` — enforced in `assert_droppable_database`,
# not by review. CLAUDE.md's "no DB drop" boundary holds by construction.
#
# psql/pg_dump/pg_restore are not assumed to be on the host: everything runs
# *inside* the `db` compose container, the same container-side pattern
# `make psql` and `scripts/backup.sh` use. That also pins the client to the
# server's major version, which pg_restore requires.
#
# Usage:
#   ./scripts/restore-drill.sh                 # back up, then drill that backup
#   ./scripts/restore-drill.sh --dump FILE     # drill an archive that already exists
#
# In the default mode the archive is taken seconds before it is restored, so
# every comparison against the live database is exact. `--dump` drills an older
# archive; the row counts of a database that has moved on since will legitimately
# differ, and the drill reports that as a failure because "does this archive
# still reproduce its source" is the question being asked.
#
# The root panel's data (tm 392 · NFR-ADMIN-B) is checked on top of the tenant
# data: every `platform_*` table must come back with its source's row count, and
# the `platform_audit_log` HMAC chain is walked in the restore by the api's own
# verifier (`platform:chain-check`, the code behind `POST /platform/v1/audit/verify`)
# — from position 1, no gap, no break. Two honest non-results exist and neither is
# printed as `ok`: no PLATFORM_SETTINGS_KEY ("skipped") and an empty trail ("not
# exercised"). RESTORE_DRILL_REQUIRE_PLATFORM=1, for a deployment that runs the
# root panel, turns both into failures. PLATFORM_CHAIN_CHECK_CMD replaces the
# command (e.g. `docker compose exec -T platform-api node
# dist/src/services/platform/restore-chain-check-run.js` where the host has no
# pnpm); the restored rows reach it on stdin, so it needs no database access.
#
# The uploads archive beside the dump (tm 418) is extracted and compared with the
# store it was taken from, file by file, by sha256. With
# `COMPOSE_FILE=docker-compose.pilot.yml` that store is the api container's
# volume (UPLOADS_SERVICE / UPLOADS_CONTAINER_DIR, the same switches and defaults
# as scripts/backup.sh), and a missing archive is a failure: the pilot always
# has the directory.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-backups}"
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
# The non-owner runtime role. Postgres exempts owners and superusers from row
# level security, so the behavioural RLS check below is only worth anything from
# this role — the same one the API connects as (DATABASE_APP_URL). Defaults are
# the dev-only values from .env.example; a drill runs against dev datastores.
APP_DB_USER="${APP_DB_USER:-siyahtus_app}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-siyahtus_app_dev_password}"

# Tables whose row counts have to survive the round trip. Not "every table":
# these are the spine of the domain model (PRD §8.4), and the ones a silently
# empty restore would show up in first.
COUNT_TABLES=(organizations accounts chats events)
# Filled from the source catalogue once the database is reachable (tm 392): the
# root panel's tables are whatever `platform_*` the migrations created, not a
# list kept here to go stale.
PLATFORM_TABLES=()
# A command, word-split on purpose; the chain rows arrive on its stdin.
PLATFORM_CHAIN_CHECK_CMD="${PLATFORM_CHAIN_CHECK_CMD:-pnpm --filter @siyahtus/api --silent platform:chain-check}"
REQUIRE_PLATFORM="${RESTORE_DRILL_REQUIRE_PLATFORM:-0}"

DRILL_DB_PREFIX='siyahtus_restore_drill_'
DRILL_DB="${DRILL_DB:-${DRILL_DB_PREFIX}$(date -u +%Y%m%d%H%M%S)_$$}"

passed=0
failed=0
tmpdir="$(mktemp -d)"
created_drill_db=0

pass() {
  passed=$((passed + 1))
  printf '  ok    %s\n' "$1"
}

fail() {
  failed=$((failed + 1))
  printf '  FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '        %s\n' "$2"
  return 0
}

note() { printf '  note  %s\n' "$1"; }

# A check that could not run is not a check that passed: a note (or, where the
# deployment demands the evidence, a failure) — never `ok`.
unproven() { # unproven <message> [detail]
  if [ "$REQUIRE_PLATFORM" = '1' ]; then
    fail "$1" "${2:-} (RESTORE_DRILL_REQUIRE_PLATFORM=1)"
  else
    note "$1"
  fi
}

fatal() {
  printf 'restore-drill: %s\n' "$1" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# The guard. Every destructive statement in this script goes through it.
# ---------------------------------------------------------------------------
#
# A drop built from a name that came out of pg_database (the sweep below) or out
# of the environment (DRILL_DB) is one typo away from dropping the development
# database. Checking the exact minted shape — not merely a prefix — makes that
# impossible by construction. Same reasoning, and same wording, as
# apps/api/scripts/test-datastores.ts:assertDroppableDatabaseName.
assert_droppable_database() {
  if [[ ! "$1" =~ ^siyahtus_restore_drill_[0-9]+(_[0-9]+)?$ ]]; then
    fatal "refusing to create or drop \"$1\": not a ${DRILL_DB_PREFIX}<id> database"
  fi
}

# --- Container-side psql/pg_restore -----------------------------------------

# `</dev/null` on every query: `docker compose exec -T` forwards this script's
# stdin to the container, and a query run inside a loop would otherwise consume
# whatever that loop is reading.
psql_q() { # psql_q <database> <sql>  -> tuples, unaligned, one row per line
  docker compose exec -T "$DB_SERVICE" \
    psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -qtAX -c "$2" </dev/null
}

psql_app() { # psql_app <database> <sql>  -> as the non-owner runtime role
  docker compose exec -T -e "PGPASSWORD=$APP_DB_PASSWORD" "$DB_SERVICE" \
    psql -U "$APP_DB_USER" -h 127.0.0.1 -d "$1" -v ON_ERROR_STOP=1 -qtAX -c "$2" </dev/null
}

drop_drill_database() {
  assert_droppable_database "$1"
  # FORCE terminates leftover backends: an interrupted drill can leave an idle
  # connection that would otherwise block the drop.
  psql_q postgres "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null
}

cleanup() {
  local status=$?
  if [ "$created_drill_db" -eq 1 ]; then
    if drop_drill_database "$DRILL_DB" 2>/dev/null; then
      printf 'Dropped scratch database %s\n' "$DRILL_DB"
    else
      printf 'WARNING: could not drop %s — drop it by hand\n' "$DRILL_DB" >&2
    fi
  fi
  rm -rf "$tmpdir"
  exit "$status"
}
trap cleanup EXIT INT TERM

# --- Snapshot helpers --------------------------------------------------------

count_rows() { # count_rows <database> -> "table|n" lines
  local sql='' table
  for table in "${COUNT_TABLES[@]}" "${PLATFORM_TABLES[@]}"; do
    [ -n "$sql" ] && sql+=' UNION ALL '
    sql+="SELECT '${table}|'||count(*) AS r FROM ${table}"
  done
  psql_q "$1" "SELECT r FROM (${sql}) s ORDER BY r"
}

count_of() { # count_of <snapshot> <table>
  awk -F'|' -v t="$2" '$1 == t { print $2 }' <<<"$1"
}

migration_fingerprint() {
  psql_q "$1" "SELECT count(*)||':'||coalesce(md5(string_agg(migration_name, ',' ORDER BY migration_name)),'-')
               FROM _prisma_migrations WHERE finished_at IS NOT NULL"
}

# Table, whether RLS is on, and the full body of every policy — not just the
# names. A policy restored with a different USING clause is still one policy.
rls_surface() {
  psql_q "$1" "SELECT c.relname||'|'||c.relrowsecurity||'|'||coalesce(p.policyname,'-')
                    ||'|'||coalesce(p.cmd,'-')||'|'||coalesce(array_to_string(p.roles,'+'),'-')
                    ||'|'||coalesce(p.qual,'-')||'|'||coalesce(p.with_check,'-')
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
               WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                 AND (c.relrowsecurity OR p.policyname IS NOT NULL)
               ORDER BY 1"
}

# Read from pg_inherits rather than from a name pattern — the same reason
# 20260826090000_events_partition_rls gives: events_default was created directly
# and would slip through a pattern.
events_partitions() {
  psql_q "$1" "SELECT child.relname||'|'||child.relrowsecurity||'|'||
                 (SELECT count(*) FROM pg_policies pp
                  WHERE pp.schemaname = 'public' AND pp.tablename = child.relname)
               FROM pg_inherits i
               JOIN pg_class child ON child.oid = i.inhrelid
               JOIN pg_class parent ON parent.oid = i.inhparent
               JOIN pg_namespace pn ON pn.oid = parent.relnamespace
               WHERE parent.relname = 'events' AND pn.nspname = 'public'
               ORDER BY 1"
}

extensions() { psql_q "$1" "SELECT extname FROM pg_extension ORDER BY 1"; }

# `<sha256>  <path>` lines, sorted bytewise. sha256sum marks a binary read with
# `*` before the name (Git Bash does, the Linux container does not); one
# separator for both, so the two sides compare as text.
normalise_manifest() {
  sed -E 's/^([0-9a-f]{64}) [ *]/\1  /' | LC_ALL=C sort
}

# The store the uploads archive was taken from, as a manifest whose paths start
# with the directory's own name — the way the archive holds them
# (`uploads/<licence>/<uuid>.png`). Empty, with exit 0, for a host directory that
# does not exist yet; a container that cannot be read is an error.
live_uploads_manifest() {
  if [ -n "$UPLOADS_SERVICE" ]; then
    docker compose exec -T "$UPLOADS_SERVICE" sh -c \
      'cd "$1" && find "$2" -type f -exec sha256sum {} +' sh \
      "$(dirname "$UPLOADS_CONTAINER_DIR")" "$(basename "$UPLOADS_CONTAINER_DIR")" \
      </dev/null | normalise_manifest
  elif [ -d "$UPLOADS_DIR" ]; then
    (cd "$(dirname "$UPLOADS_DIR")" && find "$(basename "$UPLOADS_DIR")" -type f -exec sha256sum {} +) |
      normalise_manifest
  fi
}

# Lines of the first manifest that the second does not have, as `<path>` only.
manifest_minus() { # manifest_minus <a> <b>
  LC_ALL=C comm -23 <(sed '/^$/d' <<<"$1") <(sed '/^$/d' <<<"$2") | sed -E 's/^[0-9a-f]{64}  //'
}

# proconfig is part of the identity here on purpose: a SECURITY DEFINER function
# that comes back without its `SET search_path` is a privilege-escalation seam,
# not a cosmetic difference.
security_definer_functions() {
  psql_q "$1" "SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'
                    ||coalesce(array_to_string(p.proconfig,','),'-')
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.prosecdef
               ORDER BY 1"
}

diff_check() { # diff_check <label> <source> <restored>
  # An empty source side means the query never ran, not that the database has
  # nothing to compare — and two empty sides compare equal, which is how a
  # broken query turns into a green check. Caught here rather than trusted:
  # the first run of this script did exactly that, with an ORDER BY that
  # referenced a column the SELECT does not have.
  if [ -z "$2" ]; then
    fail "$1: read nothing from $DB_NAME" 'the comparison query failed — this check proved nothing'
    return 0
  fi
  printf '%s\n' "$2" >"$tmpdir/source"
  printf '%s\n' "$3" >"$tmpdir/restored"
  if diff -u "$tmpdir/source" "$tmpdir/restored" >"$tmpdir/diff"; then
    pass "$1 ($(grep -c . "$tmpdir/source") entries, identical)"
  else
    fail "$1 differs between source and restore" "$(sed -n '4,13p' "$tmpdir/diff" | tr '\n' ' ')"
  fi
}

# ---------------------------------------------------------------------------
# 0. Arguments and the archive under test
# ---------------------------------------------------------------------------

dump_file=''
fresh_backup=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dump)
      [ $# -ge 2 ] || fatal '--dump needs a file'
      dump_file="$2"
      fresh_backup=0
      shift 2
      ;;
    -h | --help)
      sed -n '24,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fatal "unknown argument: $1 (see --help)" ;;
  esac
done

assert_droppable_database "$DRILL_DB"

psql_q postgres 'SELECT 1' >/dev/null 2>&1 ||
  fatal "the \"$DB_SERVICE\" compose service is not reachable — start the datastores first (make up)"

printf 'SiyahTuş restore drill — scratch database %s\n' "$DRILL_DB"

# The uploads store as it stands before the archive is read — before the backup
# in the default mode: everything in it has to be in the archive (the uploads
# check below). With --dump, as with the row counts, a store that has taken files
# since the archive was made is reported, not excused.
uploads_before=''
uploads_before_ok=0
if uploads_before="$(live_uploads_manifest 2>"$tmpdir/uploads-before.err")"; then
  uploads_before_ok=1
fi
if [ "$fresh_backup" -eq 1 ]; then
  printf '\nTaking a fresh backup first (scripts/backup.sh)\n'
  ./scripts/backup.sh
  dump_file="$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -1 || true)"
  [ -n "$dump_file" ] || fatal "scripts/backup.sh produced no db-*.dump in $BACKUP_DIR"
else
  [ -f "$dump_file" ] || fatal "no such archive: $dump_file"
  note "drilling an existing archive — row counts and uploads will differ if $DB_NAME has moved on since"
fi

printf '\nArchive: %s (%s bytes)\n' "$dump_file" "$(wc -c <"$dump_file" | tr -d ' ')"

# ---------------------------------------------------------------------------
# 1. Sweep, create, restore
# ---------------------------------------------------------------------------
#
# A drill that was killed rather than closed leaves its scratch database behind.
# Sweep before creating, the way test-datastores.ts does. Two drills must not run
# at the same time (the same constraint apps/e2e has on the shared datastore).
while read -r stale; do
  [ -n "$stale" ] || continue
  printf 'Sweeping abandoned scratch database %s\n' "$stale"
  drop_drill_database "$stale" || true
done < <(psql_q postgres \
  "SELECT datname FROM pg_database WHERE starts_with(datname, '${DRILL_DB_PREFIX}')")

# The platform tables, by catalogue. The name goes into SQL, so one that is not
# plain lowercase-and-underscore is refused rather than quoted around.
platform_tables_of() { # platform_tables_of <database>
  psql_q "$1" "SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                 AND starts_with(table_name, 'platform_') ORDER BY 1"
}
platform_tables_source="$(platform_tables_of "$DB_NAME")"
while read -r table; do
  [ -n "$table" ] || continue
  [[ "$table" =~ ^platform_[a-z0-9_]+$ ]] || fatal "unexpected platform table name: $table"
  PLATFORM_TABLES+=("$table")
done <<<"$platform_tables_source"

# The platform audit chain as text for `platform:chain-check`: the head on line 1
# (`null` when there is no head row), then one line per entry in the shape of the
# audit export (`GET /platform/v1/audit/export`) — which is what the checker's
# parser reads. Timestamps are cut to milliseconds, the precision the writer hashes.
chain_dump() { # chain_dump <database>
  psql_q "$1" "SELECT coalesce((SELECT json_build_object('seq', seq::text, 'hash', hash)::text
                                FROM platform_audit_chain_head WHERE id = 1), 'null')" &&
    psql_q "$1" "SELECT json_build_object(
                 'chain_seq', chain_seq::text, 'admin_id', admin_id, 'action', action,
                 'target_type', target_type, 'target_id', target_id,
                 'license_id', license_id::text, 'reason', reason, 'payload', payload, 'ip', ip,
                 'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
                 'prev_hash', prev_hash, 'hash', hash)
               FROM platform_audit_log ORDER BY chain_seq"
}

source_counts_before="$(count_rows "$DB_NAME" 2>"$tmpdir/counts.err" || true)"
[ -n "$source_counts_before" ] ||
  fatal "could not read row counts from $DB_NAME: $(tr '\n' ' ' <"$tmpdir/counts.err")"

# TEMPLATE template0 is the known-clean starting point — the same one pg_dump's
# own `--create` emits — so nothing that happens to live in template1 can be
# mistaken for something the archive restored.
psql_q postgres "CREATE DATABASE \"$DRILL_DB\" TEMPLATE template0" >/dev/null
created_drill_db=1

printf '\nRestoring...\n'
# --exit-on-error, because pg_restore's default is to log a failed statement and
# carry on with exit 0 — which would turn "half the schema is missing" into a
# green drill.
if ! docker compose exec -T "$DB_SERVICE" \
  pg_restore -U "$DB_USER" -d "$DRILL_DB" --exit-on-error <"$dump_file" >"$tmpdir/restore.log" 2>&1; then
  tail -20 "$tmpdir/restore.log" >&2
  fatal 'pg_restore failed — the archive is not restorable'
fi
printf 'Restored into %s\n' "$DRILL_DB"

# ---------------------------------------------------------------------------
# 2. Verify
# ---------------------------------------------------------------------------

printf '\nVerifying:\n'

# --- Migration state ---
src_migrations="$(migration_fingerprint "$DB_NAME")"
dst_migrations="$(migration_fingerprint "$DRILL_DB")"
if [ "$src_migrations" = "$dst_migrations" ]; then
  pass "applied migrations (${dst_migrations%%:*}, same set as $DB_NAME)"
else
  fail 'applied migrations differ' "source $src_migrations vs restored $dst_migrations"
fi

# A row with no finished_at is the P3009 state (CONVENTIONS §6.2): the next
# `migrate deploy` against this database would refuse to run — unless it was
# rolled back. `prisma migrate resolve --rolled-back` (the §6.2 recovery) sets
# rolled_back_at on the failed row and leaves it there, and the next deploy
# applies the migration again in a row of its own; Prisma itself skips the old
# one. Counting it was this check's red on the dev database (tm 418: one such
# row, 20261116090000_ai_suggestions, rolled back and re-applied 2026-10-28).
unfinished="$(psql_q "$DRILL_DB" \
  'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
if [ "$unfinished" = '0' ]; then
  pass 'no half-applied migration in the restore (finished_at IS NULL, not rolled back: 0)'
else
  fail "restored database carries $unfinished half-applied migration(s)" \
    'a later migrate deploy would fail with P3009'
fi

# --- Row counts ---
restored_counts="$(count_rows "$DRILL_DB")"
source_counts_after="$(count_rows "$DB_NAME")"
# The archive is a snapshot taken between the two source readings, so for a
# source that is being written to concurrently the honest assertion is that the
# restored count lies between them — which degenerates to equality when nothing
# is writing, i.e. the normal case.
for table in "${COUNT_TABLES[@]}" "${PLATFORM_TABLES[@]}"; do
  before="$(count_of "$source_counts_before" "$table")"
  after="$(count_of "$source_counts_after" "$table")"
  actual="$(count_of "$restored_counts" "$table")"
  # A non-numeric reading means the count query failed, not that the table is
  # empty. Said plainly here, rather than left to `[` to complain about.
  if ! [[ "$before$after$actual" =~ ^[0-9]+$ ]]; then
    fail "$table: could not count rows" \
      "source '$before' -> '$after', restored '$actual' (a count query failed)"
    continue
  fi
  lo="$before"
  hi="$after"
  if [ "$lo" -gt "$hi" ]; then
    lo="$after"
    hi="$before"
  fi
  if [ -n "$actual" ] && [ "$actual" -ge "$lo" ] && [ "$actual" -le "$hi" ]; then
    if [ "$lo" = "$hi" ]; then
      pass "$table: $actual rows (source $lo)"
    else
      pass "$table: $actual rows (source moved $before to $after during the drill)"
    fi
  else
    fail "$table: restored $actual rows, source has $before to $after"
  fi
done

# --- The root panel's tables and its audit chain (tm 392 · NFR-ADMIN-B) ---
#
# The row counts above already cover every platform_* table. What they cannot say
# is that the *set* of tables came back, nor that the audit trail is still a chain:
# a restore can return every row and still carry an altered one. Rows are counted,
# the chain is verified.
if [ "${#PLATFORM_TABLES[@]}" -eq 0 ]; then
  fail 'no platform_* tables in the source' 'the root panel migrations (tm 389) are not applied'
else
  diff_check 'platform tables present' "$platform_tables_source" "$(platform_tables_of "$DRILL_DB")"
  if [[ " ${PLATFORM_TABLES[*]} " != *' platform_audit_log '* ]]; then
    fail 'platform_audit_log is not among the source tables' 'the audit chain cannot be verified'
  else
    # The rows are read with the container's psql into a file first, so a failed read
    # is its own failure (not the checker's "empty"), and piped in, so the checker
    # needs no database connection (the pilot publishes no host port).
    chain_status=0
    chain_out=''
    if ! chain_dump "$DRILL_DB" >"$tmpdir/chain.dump" 2>"$tmpdir/chain.err"; then
      chain_status=2
    else
      # shellcheck disable=SC2086 # the command is a word list on purpose
      chain_out="$($PLATFORM_CHAIN_CHECK_CMD <"$tmpdir/chain.dump" 2>>"$tmpdir/chain.err")" || chain_status=$?
    fi
    case "$chain_status" in
      0) pass "$(head -1 <<<"$chain_out")" ;;
      1) fail 'platform audit chain is broken in the restore' "$(tr '\n' ' ' <<<"$chain_out")" ;;
      3) unproven 'platform audit chain skipped: no PLATFORM_SETTINGS_KEY, so it was not verified' \
        'set it (the root .env has it) to verify the chain in the restore' ;;
      4) unproven 'platform audit chain not exercised: platform_audit_log is empty, nothing to verify' \
        'the root panel has recorded nothing yet' ;;
      *) fail 'platform audit chain check could not run' \
        "exit $chain_status: $(tr '\n' ' ' <"$tmpdir/chain.err")$(tr '\n' ' ' <<<"$chain_out")" ;;
    esac
  fi
fi

# --- Schema objects a logical dump is not obliged to carry ---
diff_check 'row level security surface (tables, policies, bodies)' \
  "$(rls_surface "$DB_NAME")" "$(rls_surface "$DRILL_DB")"
diff_check 'extensions' "$(extensions "$DB_NAME")" "$(extensions "$DRILL_DB")"
diff_check 'SECURITY DEFINER functions (name, args, search_path)' \
  "$(security_definer_functions "$DB_NAME")" "$(security_definer_functions "$DRILL_DB")"

# --- Partitions, called out rather than left implicit ---
#
# tm 150 found that RLS on the `events` parent says nothing about its partitions,
# and a query naming a partition directly is checked against that partition's own
# policies. Whether a logical dump carries those per-partition policies is exactly
# the kind of thing that gets assumed instead of measured, so it gets its own check.
partitions="$(events_partitions "$DRILL_DB")"
partition_count="$(grep -c . <<<"$partitions" || true)"
# `true`, not `t`: psql renders a boolean column as t/f, but this one is
# concatenated into a string, and boolean::text is `true`.
unsecured="$(awk -F'|' '$2 != "true" || $3 != "1"' <<<"$partitions" | tr '\n' ' ')"
if [ "$partition_count" -gt 0 ] && [ -z "${unsecured// /}" ]; then
  pass "events partitions: $partition_count restored, every one with RLS on and exactly 1 policy"
else
  fail 'restored events partitions are not all secured' "${unsecured:-no partitions found}"
fi

# --- Does RLS actually hold, or is it just present in the catalog? ---
#
# The catalog checks above compare text. This one asks the database: connected as
# the non-owner runtime role, does the restore hand out the rows it should and
# withhold the ones it should not?
#
# Both halves are load-bearing, and the second one is the surprising one. A
# restore that lost every policy does NOT leak — measured (tm 165.2) by restoring
# this same archive with every POLICY entry filtered out of pg_restore's TOC:
# 0 policies, but `relrowsecurity` survives on all 90 tables (it rides on the
# table entry, not the policy entries), and a table with RLS enabled and no
# policy denies everything. Unscoped reads still came back 0 and 0. The damage
# shows up only on the other side: with app.current_license set, the correct
# tenant's rows also came back 0 and 0 — a silently empty application, not an
# open one. So "sees nothing" is not evidence of a good restore, and the check
# fails unless the rows come back when they are asked for properly.
#
# The partition and the licence come from one event row (tm 418). Taken from two
# unrelated rows — any partition, any chat's licence — the scoped read could ask
# a partition for a workspace that has no event in it, see 0 there, and call a
# sound restore "vacuous". An event's licence always has that event in that
# partition, and the chat the event belongs to.
sample="$(psql_q "$DRILL_DB" 'SELECT tableoid::regclass::text||'"'|'"'||license_id FROM events LIMIT 1')"
sample_partition="${sample%%|*}"
sample_license="${sample#*|}"
if [[ ! "$sample_partition" =~ ^[a-z0-9_]+$ ]] || [[ ! "$sample_license" =~ ^[0-9]+$ ]]; then
  fail 'RLS enforcement not exercised' 'the restore holds no events/chats rows to test against'
elif ! blind="$(psql_app "$DRILL_DB" \
  "SELECT count(*) FROM $sample_partition UNION ALL SELECT count(*) FROM chats" 2>&1)"; then
  fail "could not connect to the restore as $APP_DB_USER" "${blind//$'\n'/ } (set APP_DB_PASSWORD)"
elif [ "$(tr -d '\n' <<<"$blind")" != '00' ]; then
  fail "$APP_DB_USER reads rows from the restore with no tenant context" \
    "$sample_partition + chats returned ${blind//$'\n'/ }, expected 0 and 0"
else
  scoped="$(psql_app "$DRILL_DB" \
    "SET app.current_license = '$sample_license';
     SELECT count(*) FROM $sample_partition UNION ALL SELECT count(*) FROM chats" | grep -c '^[1-9]')"
  if [ "$scoped" = '2' ]; then
    pass "RLS enforced in the restore: $APP_DB_USER sees 0 rows unscoped, rows again once app.current_license is set"
  else
    fail 'RLS check is vacuous' \
      "$APP_DB_USER sees nothing even with app.current_license=$sample_license — a lost GRANT, not a policy"
  fi
fi

# --- Uploads half of the backup ---
#
# Extracting proves the archive is a tar; it does not prove it holds the files.
# So what comes out is compared with the store it was taken from, by sha256, file
# by file (tm 418). Files only accumulate in that store, so for one written to
# during the drill the honest claim is the one the row counts make: everything
# stored before the backup is in the archive, and everything in the archive is
# still in the store with the same bytes. The archive is looked for beside the
# dump, which is where a copy fetched back from off the host also has it.
timestamp="$(basename "$dump_file" .dump)"
timestamp="${timestamp#db-}"
uploads_archive="$(dirname "$dump_file")/uploads-$timestamp.tar.gz"
if [ -n "$UPLOADS_SERVICE" ]; then
  uploads_source="$UPLOADS_CONTAINER_DIR in the $UPLOADS_SERVICE container"
  uploads_name="$(basename "$UPLOADS_CONTAINER_DIR")"
else
  uploads_source="$UPLOADS_DIR"
  uploads_name="$(basename "$UPLOADS_DIR")"
fi
if [ -f "$uploads_archive" ]; then
  mkdir -p "$tmpdir/uploads"
  if ! tar -tzf "$uploads_archive" >"$tmpdir/uploads.list" 2>"$tmpdir/uploads.err"; then
    fail 'uploads archive is unreadable' "$(tr '\n' ' ' <"$tmpdir/uploads.err")"
  elif ! tar -xzf "$uploads_archive" -C "$tmpdir/uploads" 2>>"$tmpdir/uploads.err"; then
    fail 'uploads archive does not extract' "$(tr '\n' ' ' <"$tmpdir/uploads.err")"
  else
    listed="$(grep -vc '/$' "$tmpdir/uploads.list" || true)"
    extracted="$(find "$tmpdir/uploads" -type f | wc -l | tr -d ' ')"
    if [ "$listed" != "$extracted" ]; then
      fail "uploads archive lists $listed files but extracted $extracted"
    elif ! archived="$( (cd "$tmpdir/uploads" && find "$uploads_name" -type f -exec sha256sum {} +) \
      2>>"$tmpdir/uploads.err" | normalise_manifest)"; then
      fail "uploads archive holds no $uploads_name/ directory" "$(tr '\n' ' ' <"$tmpdir/uploads.err")"
    elif ! live_after="$(live_uploads_manifest 2>"$tmpdir/uploads-after.err")"; then
      fail "could not read the uploads store ($uploads_source)" \
        "$(tr '\n' ' ' <"$tmpdir/uploads-after.err")"
    elif [ "$uploads_before_ok" -ne 1 ]; then
      fail "could not read the uploads store ($uploads_source) before the drill" \
        "$(tr '\n' ' ' <"$tmpdir/uploads-before.err")"
    else
      changed="$(manifest_minus "$archived" "$live_after")"
      missing="$(manifest_minus "$uploads_before" "$archived")"
      if [ -n "$changed" ]; then
        fail "uploads archive: $(grep -c . <<<"$changed") file(s) differ from the store or are gone from it" \
          "$(head -3 <<<"$changed" | tr '\n' ' ')"
      elif [ -n "$missing" ]; then
        fail "uploads archive: $(grep -c . <<<"$missing") file(s) in the store are not in it" \
          "$(head -3 <<<"$missing" | tr '\n' ' ')"
      else
        pass "uploads archive restores: $extracted files, each identical (sha256) to $uploads_source, none missing"
      fi
    fi
  fi
elif [ -n "$UPLOADS_SERVICE" ]; then
  fail 'no uploads archive beside the dump' \
    "the uploads live in $uploads_source, so $uploads_archive should have been produced"
elif [ -d "$UPLOADS_DIR" ]; then
  fail 'no uploads archive beside the dump' \
    "$UPLOADS_DIR exists, so $uploads_archive should have been produced"
else
  note "uploads: no archive and no $UPLOADS_DIR — nothing was uploaded to back up"
fi

# ---------------------------------------------------------------------------
# 3. What the archive does NOT carry — stated, because it is a restore step
# ---------------------------------------------------------------------------
#
# Measured, not assumed (tm 165.2): restoring this archive into a *fresh* cluster
# aborts on the first `GRANT USAGE ON SCHEMA public TO siyahtus_app` with
# `role "siyahtus_app" does not exist`. Roles are cluster-wide objects and a
# per-database dump has no CREATE ROLE in it — pg_dumpall --globals-only is the
# tool that carries them. Restoring into *this* cluster works only because
# infra/db/init/00-extensions.sql already created the role here.
grants="$(docker compose exec -T "$DB_SERVICE" pg_restore -f - <"$dump_file" 2>/dev/null |
  grep -c "$APP_DB_USER" || true)"
note "archive references $APP_DB_USER $grants times and creates the role 0 times —"
note "  a fresh cluster needs infra/db/init/00-extensions.sql (or pg_dumpall --globals-only) first"

# ---------------------------------------------------------------------------

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ] || exit 1
printf 'Restore drill green: %s is restorable.\n' "$(basename "$dump_file")"
