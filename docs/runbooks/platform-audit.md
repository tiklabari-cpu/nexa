# Runbook: the root panel's audit chain (tm 389.5 · FR-ADMIN-05/06)

Every operator action in the root panel — a sign-in, a code, every mutation —
is one entry in `platform_audit_log`: a single HMAC chain for the whole
deployment, gapless positions (`chain_seq`), each entry's hash over its own
columns and the hash before it. The key is derived from `PLATFORM_SETTINGS_KEY`
(HKDF, `siyahtus/platform/audit-chain/v1`), which lives in the environment, not
the database: whoever holds only the database can delete or edit a row, but
cannot rebuild the chain around it.

Code: `apps/api/src/services/platform/platform-audit.ts` (the writer, the
vocabulary, list/export/verify), `apps/api/src/plugins/platform-audit.ts` (the
route rules), `apps/api/src/services/audit/audit-chain.ts` (the hashing, shared
with the workspace chains under the scope `platform`).

## What is recorded

- **Every mutation states why.** A business route without a 3–500 character
  `reason` in its body is refused (400 `platform_reason_required`) before it
  runs. Only the operator's own session events (`admin.signed_in`,
  `admin.totp_verified`, `admin.signed_out`, …) carry none.
- **Refusals too:** `admin.sign_in_failed` (no operator named — the answer does
  not say which address exists) and `admin.totp_failed`.
- **A workspace sees what was done to it.** An action naming a workspace is
  also written to that workspace's own audit log, as actor "SiyahTuş support"
  (`actor_type = 'platform'`, action `platform.<module>_<verb>`), in the same
  transaction: if either entry cannot be written, the action does not happen.
  The workspace's entry carries the platform position (`platform_seq`) — never
  the operator's reason or detail.
- **No secrets.** Payloads are identifiers, counts and changed field names; a
  key change records `changed: ['api_key']`, not the key.

The first entry of a fresh deployment is `admin.bootstrapped`
(`platform:bootstrap-admin`).

## Checking the chain

`POST /platform/v1/audit/verify` (any operator role with `audit.read`) walks
the chain from position 1 and lists every break with its position:

| `kind`           | Means                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `hash_mismatch`  | the entry at `seq` was edited                                       |
| `sequence_gap`   | entries from `seq` on are missing between two that survive          |
| `start_mismatch` | the chain does not start at 1 — entries were removed from the front |
| `broken_link`    | the entry at `seq` no longer points at the one before               |
| `head_mismatch`  | the head handed out more positions than survive — a removed tail    |

`ok: true` with `findings: []` is the only clean answer. Any finding is an
incident: do not "repair" the table (it refuses UPDATE and DELETE for every
role, the owner included; getting past that took deliberate effort). Export the
chain as it stands, note the findings, and follow
`tenant-isolation-suspicion.md` for the workspaces whose `license_id` appears
around the broken positions.

## Exporting and checking an export offline

`GET /platform/v1/audit/export` returns up to 1000 records (`?limit=` up to 5000) as NDJSON, oldest first, never filtered. Page on with the
`x-siyahtus-export-cursor` header (`?cursor=…`); it is kept when a page comes
back empty, so a poller never starts over.

`X-Siyahtus-Signature` is an HMAC over the body's SHA-256 together with the
record count and the first and last positions. To check a saved page on any
machine that has the deployment's `PLATFORM_SETTINGS_KEY` (and no database):

```sh
curl -sS -D headers.txt -o page.ndjson \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  "https://admin.example.com/platform/v1/audit/export?limit=5000"
SIG=$(grep -i '^x-siyahtus-signature:' headers.txt | cut -d' ' -f2 | tr -d '\r')

PLATFORM_SETTINGS_KEY=… pnpm --filter @siyahtus/api platform:audit-check \
  --file page.ndjson --signature "$SIG"
# in a built image:
#   node dist/src/services/platform/audit-export-check-run.js --file … --signature …
```

Exit 0: the signature matches the bytes and the range, and every record's hash
and link hold. Exit 1: the JSON verdict says which (`signatureOk`,
`chain.findings` with positions). Exit 2: usage. The signature cannot be checked
without the key — on purpose: a signature anyone can verify is anyone's to
forge. Hand an auditor a copy of the key only for the check, and rotate it
afterwards if that copy cannot be accounted for (the same root seals the
operators' TOTP secrets, so a rotation means every authenticator is reset and
enrolled again, and the chain written so far verifies only under the old key —
keep it with the exports it signed).

## A workspace's own trail

`GET /platform/v1/audit/workspaces/{licenseId}` shows a workspace's audit log
exactly as its members see it (same filters, same 30-day default window),
including the `platform.*` entries. Read-only; it never shows message or
customer content.
