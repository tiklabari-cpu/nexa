/**
 * The platform audit chain, checked in a restored database (tm 392 ·
 * NFR-ADMIN-B · scripts/restore-drill.sh).
 *
 * The drill's other checks compare the restore with the live database. This
 * one asks a different question: is the restored trail still *a chain* — every
 * position from 1, no gap, no altered or relinked entry, a head that points at
 * the last one? The walk is {@link verifyPlatformChain}, the code behind
 * `POST /platform/v1/audit/verify`, run over rows the drill read out of its
 * scratch database; nothing is re-implemented here, only the verdicts the drill
 * needs are named.
 *
 * The rows arrive as text on stdin and not over a connection, because the pilot
 * database publishes no host port: the drill reads them with the `psql` inside
 * the `db` container (the only client it assumes), and this module can run
 * anywhere there is node — on the host, or in the api image.
 *
 * Input: line 1 is the head (`{"seq":"5","hash":"…"}`, or `null` when the head
 * row is absent); every further line is one entry shaped like a line of the
 * audit export (`GET /audit/export`).
 *
 * Four outcomes, and only one of them is a proof:
 *   - `verified`  entries were walked and every one held.
 *   - `broken`    something does not hold (the drill fails).
 *   - `empty`     no entry and no head position handed out: nothing to verify,
 *                 so the chain was NOT exercised — said plainly, like the RLS
 *                 check that finds no rows to test against.
 *   - `skipped`   no `PLATFORM_SETTINGS_KEY`: the chain key cannot be derived.
 */
import { derivePlatformKey } from '../../lib/platform-keys.js';
import { parsePlatformExportBody } from './audit-export-check.js';
import {
  verifyPlatformChain,
  type PlatformAuditRow,
  type PlatformAuditVerification,
} from './platform-audit.js';

export type RestoredChainOutcome =
  | { kind: 'verified'; verification: PlatformAuditVerification }
  | { kind: 'broken'; verification: PlatformAuditVerification }
  | { kind: 'empty'; verification: PlatformAuditVerification }
  | { kind: 'skipped'; reason: string };

/** Exit codes of `restore-chain-check-run`, read by scripts/restore-drill.sh. */
export const RESTORE_CHAIN_EXIT = {
  verified: 0,
  broken: 1,
  error: 2,
  skipped: 3,
  empty: 4,
} as const;

export interface RestoredChainDump {
  head: { seq: bigint; hash: string | null } | null;
  rows: PlatformAuditRow[];
}

/** Throws on input that is not a dump — the drill reports that as "could not run", not as a verdict. */
export function parseChainDump(text: string): RestoredChainDump {
  const newline = text.indexOf('\n');
  const headLine = (newline === -1 ? text : text.slice(0, newline)).trim();
  if (headLine === '') throw new Error('the input is empty — expected a head line first');
  const parsed = JSON.parse(headLine) as { seq?: unknown; hash?: unknown } | null;
  let head: RestoredChainDump['head'] = null;
  if (parsed !== null) {
    if (typeof parsed.seq !== 'string' || !/^\d+$/.test(parsed.seq)) {
      throw new Error('the head line has no numeric "seq"');
    }
    head = { seq: BigInt(parsed.seq), hash: typeof parsed.hash === 'string' ? parsed.hash : null };
  }
  const rows = newline === -1 ? [] : parsePlatformExportBody(text.slice(newline + 1));
  rows.sort((a, b) => (a.chainSeq < b.chainSeq ? -1 : a.chainSeq > b.chainSeq ? 1 : 0));
  return { head, rows };
}

export async function checkRestoredChain(
  dump: RestoredChainDump,
  settingsKey: string | undefined,
): Promise<RestoredChainOutcome> {
  if (!settingsKey) {
    return {
      kind: 'skipped',
      reason: 'PLATFORM_SETTINGS_KEY is not set, so the chain key cannot be derived',
    };
  }
  const key = Buffer.from(derivePlatformKey(settingsKey, 'auditChain'), 'hex');
  const verification = await verifyPlatformChain(key, {
    batch: async (after, take) =>
      dump.rows.filter((row) => after === null || row.chainSeq > after).slice(0, take),
    head: async () => dump.head,
  });
  if (!verification.ok) return { kind: 'broken', verification };
  // ok with nothing checked: no entry and no position ever handed out.
  if (verification.checked === 0) return { kind: 'empty', verification };
  return { kind: 'verified', verification };
}

/** One human line per outcome, plus the first findings of a broken chain. */
export function describeOutcome(outcome: RestoredChainOutcome): string[] {
  switch (outcome.kind) {
    case 'skipped':
      return [`platform chain skipped: ${outcome.reason}`];
    case 'empty':
      return ['platform chain not exercised: platform_audit_log holds no entries'];
    case 'verified': {
      const v = outcome.verification;
      return [
        `platform chain verified: ${v.checked} entries, positions ${v.first_seq}..${v.last_seq}, head at ${v.head_seq}`,
      ];
    }
    case 'broken': {
      const v = outcome.verification;
      return [
        `platform chain BROKEN: ${v.findings_total} finding(s) over ${v.checked} entries`,
        ...v.findings.slice(0, 5).map((f) => `  ${f.kind} at ${f.seq ?? '-'}: ${f.detail}`),
      ];
    }
  }
}
