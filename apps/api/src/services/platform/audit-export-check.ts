/**
 * Checking a downloaded page of the platform audit export offline (tm 389.5 ·
 * FR-ADMIN-06 · docs/runbooks/platform-audit.md).
 *
 * Everything the signature covers is in the file itself: the range and the
 * count are read off the records, so the auditor needs the body, the
 * `X-Siyahtus-Signature` header and the chain key — derived, as the server
 * derives it, from `PLATFORM_SETTINGS_KEY`. Each record's own hash and link
 * are recomputed as well, so an edit is located, not only detected.
 */
import { derivePlatformKey } from '../../lib/platform-keys.js';
import {
  PLATFORM_CHAIN_SCOPE,
  platformChainRowHash,
  verifyChain,
  verifyExportSignature,
  type ChainVerification,
} from '../audit/audit-chain.js';

export interface PlatformExportCheck {
  signatureOk: boolean;
  count: number;
  firstSeq: string | null;
  lastSeq: string | null;
  /** The page's own links and hashes; its first record is not checked against the page before. */
  chain: ChainVerification;
}

interface ExportRecord {
  chain_seq: string;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  license_id: string | null;
  reason: string | null;
  payload: unknown;
  ip: string | null;
  created_at: string;
  prev_hash: string | null;
  hash: string;
}

export function checkPlatformExport(input: {
  body: string;
  signature: string;
  settingsKey: string;
}): PlatformExportCheck {
  const key = Buffer.from(derivePlatformKey(input.settingsKey, 'auditChain'), 'hex');
  const records = input.body
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ExportRecord);
  const rows = records.map((record) => ({
    chainSeq: BigInt(record.chain_seq),
    adminId: record.admin_id,
    action: record.action,
    targetType: record.target_type,
    targetId: record.target_id,
    licenseId: record.license_id === null ? null : BigInt(record.license_id),
    reason: record.reason,
    payload: record.payload,
    ip: record.ip,
    createdAt: new Date(record.created_at),
    prevHash: record.prev_hash,
    hash: record.hash,
  }));
  const firstSeq = rows[0]?.chainSeq ?? null;
  const lastSeq = rows.at(-1)?.chainSeq ?? null;
  return {
    signatureOk: verifyExportSignature(
      key,
      { scope: PLATFORM_CHAIN_SCOPE, count: rows.length, firstSeq, lastSeq, body: input.body },
      input.signature,
    ),
    count: rows.length,
    firstSeq: firstSeq === null ? null : firstSeq.toString(),
    lastSeq: lastSeq === null ? null : lastSeq.toString(),
    chain: verifyChain(rows, { recompute: (row) => platformChainRowHash(key, row) }),
  };
}
