/**
 * The AI configuration change history's one writer (tm 315 · AI-21 ·
 * ADR-14b `docs/adr/ai-config-versioning.md` §2.5 step 3).
 *
 * Every write of an AI editing table goes through `config-draft.ts`; this is
 * the step that helper takes in the same transaction: the row before (read
 * `FOR UPDATE`), the write, the row after, their JSON-path difference, and one
 * `ai_config_changes` row plus one `audit_log` row naming the fields. A write
 * that rolls back takes both with it. One save is one row: a helper records
 * once per save, never once per statement.
 *
 * What a row keeps (AI-21 coding logic):
 *   - the entity's own columns, by their database names, minus what is not
 *     configuration — the licence, timestamps, run-time caches
 *     ({@link VOLATILE_COLUMNS});
 *   - every text through AI-26's staff masking (`maskSensitive`, author
 *     `agent`): a card, an SMS code or a password pasted into a procedure is
 *     not kept in clear for five years. An IBAN is not masked — a payment
 *     method's account is configuration (AI-26-S2);
 *   - a text over 20 KB as its digest and length only — the text itself is in
 *     the version's package (AI-20) or the source.
 *
 * The audit row carries field names, never values (the `AuditEntry` rule).
 */
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  AI_CONFIG_TEXT_LIMIT_BYTES,
  aiConfigDiffFields,
  type AiConfigActorType,
  type AiConfigChangeAction,
  type AiConfigDiffEntry,
  type AiConfigEntityType,
  type AiConfigOmittedText,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { maskSensitive } from '../../lib/sensitive-mask.js';
import { type AuditAction, type AuditContext, writeAuditEntry } from '../audit/audit-log.js';

/**
 * Who made the change. `audit` is the request's audit context (or a system
 * job's); `role` is the actor's membership role at this moment, kept on the
 * row because the role can change later. A system job names itself in
 * `jobId` — the audit log's `actor_id` holds accounts only.
 */
export interface ConfigChangeAuthor {
  audit: AuditContext;
  role: string | null;
  jobId?: string;
  /**
   * The draft revision the save was made against — the request's `If-Match`
   * (tm 316.2 · ADR-14b §2.5 step 2). A save that would move a revision other
   * than this one is `409 ai_config_revision_conflict`; absent, the save moves
   * the revision whatever it is (last write wins, as before versioning).
   */
  expectedRevision?: bigint | null;
}

/** A system job's author: `actor_type = 'system'`, the job's name as the actor. */
export function systemConfigAuthor(
  licenseId: bigint,
  chainSecret: string,
  jobId: string,
): ConfigChangeAuthor {
  return {
    audit: { licenseId, chainSecret, actorId: null, actorType: 'system' },
    role: null,
    jobId,
  };
}

/** The editing tables a snapshot may read — a closed list, never a request's word. */
export const CONFIG_TABLES = [
  'ai_agents',
  'skills',
  'ai_guidance_rules',
  'ai_guardrail_settings',
  'ai_guardrail_rules',
  'ai_forbidden_phrases',
  'ai_handoff_settings',
  'ai_handoff_rules',
  'handoff_routes',
  'knowledge_sources',
  'kb_payment_methods',
  'kb_bonuses',
  'kb_kyc_documents',
  'kb_rules',
  'ai_access_info',
] as const;
export type ConfigTable = (typeof CONFIG_TABLES)[number];

/** The two settings tables are one row per agent, keyed by it. */
const KEY_COLUMN: Partial<Record<ConfigTable, string>> = {
  ai_guardrail_settings: 'ai_agent_id',
  ai_handoff_settings: 'ai_agent_id',
};

/**
 * Columns that are not configuration: the tenant, the row's own clock, and
 * what run time or indexing writes (a run counter, the indexing status, a
 * crawl's bookkeeping, the access information's fetched value, versioning's
 * own counters and pointer — tm 316). A change of these alone is no change.
 */
const VOLATILE_COLUMNS: ReadonlySet<string> = new Set([
  'license_id',
  'created_at',
  'updated_at',
  'runs_count',
  'draft_revision',
  'published_version_id',
  'chunk_generation',
  'status',
  'last_refresh_error',
  'next_refresh_at',
  'last_crawled_at',
  'page_count',
  'last_value',
  'last_fetched_at',
  'search_vector',
]);

/**
 * The row as configuration: its columns by database name, minus
 * {@link VOLATILE_COLUMNS}. `lock` reads it `FOR UPDATE`, so the "before" a
 * change records is the row the write then replaces — a concurrent save
 * waits rather than slipping between the two reads.
 */
export async function snapshotConfigRow(
  tx: TenantClient,
  table: ConfigTable,
  id: string,
  options: { lock?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  if (!(CONFIG_TABLES as readonly string[]).includes(table)) {
    throw new Error(`not an AI editing table: ${table}`);
  }
  const lock = options.lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{ row: Record<string, unknown> }>>(
    Prisma.sql`SELECT to_jsonb(t) AS row FROM ${Prisma.raw(`"${table}"`)} t
      WHERE t.${Prisma.raw(KEY_COLUMN[table] ?? 'id')} = ${id}::uuid ${lock}`,
  );
  const row = rows[0]?.row;
  if (!row) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!VOLATILE_COLUMNS.has(key)) clean[key] = value;
  }
  return clean;
}

/** {@link snapshotConfigRow} for several rows of one table, by id. */
export async function snapshotConfigRows(
  tx: TenantClient,
  table: ConfigTable,
  ids: readonly string[],
  options: { lock?: boolean } = {},
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const row = await snapshotConfigRow(tx, table, id, options);
    if (row) out.set(id, row);
  }
  return out;
}

function omitted(text: string): AiConfigOmittedText {
  return {
    omitted: 'too_large',
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    length: text.length,
  };
}

/**
 * A value as the history keeps it: every string masked (AI-26 staff policy),
 * a string over {@link AI_CONFIG_TEXT_LIMIT_BYTES} replaced by its digest and
 * length. The digest is of the original, so it matches the package's text.
 */
export function storableConfigValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > AI_CONFIG_TEXT_LIMIT_BYTES) return omitted(value);
    return maskSensitive(value, { author: 'agent' }).text;
  }
  if (Array.isArray(value)) return value.map(storableConfigValue);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = storableConfigValue(entry);
    }
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function join(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base === '' ? key : `${base}.${key}`;
}

/**
 * The JSON-path difference of two states (AI-21 coding logic 1): one entry
 * per leaf added, removed or changed. Objects are walked key by key, arrays
 * index by index — a procedure's step 3 is `steps[2]`. A value that changes
 * type (an object becoming a string) is one `changed` entry at its path.
 */
export function diffConfig(before: unknown, after: unknown, path = ''): AiConfigDiffEntry[] {
  if (same(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => {
      const at = join(path, key);
      if (!(key in after)) return [{ path: at, kind: 'removed' as const, before: before[key] }];
      if (!(key in before)) return [{ path: at, kind: 'added' as const, after: after[key] }];
      return diffConfig(before[key], after[key], at);
    });
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: AiConfigDiffEntry[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      const at = join(path, i);
      if (i >= after.length) out.push({ path: at, kind: 'removed', before: before[i] });
      else if (i >= before.length) out.push({ path: at, kind: 'added', after: after[i] });
      else out.push(...diffConfig(before[i], after[i], at));
    }
    return out;
  }
  if (path === '') {
    // The whole entity appeared or went: one entry per top-level field.
    if (before === null || before === undefined) return diffConfig({}, after, '');
    if (after === null || after === undefined) return diffConfig(before, {}, '');
  }
  if (before === undefined || before === null) {
    return after === null || after === undefined ? [] : [{ path, kind: 'added', after }];
  }
  if (after === undefined || after === null) return [{ path, kind: 'removed', before }];
  return [{ path, kind: 'changed', before, after }];
}

export interface ConfigChangeInput {
  entityType: AiConfigEntityType;
  entityId: string;
  /** The customer-facing agent the change reaches, when there is one. */
  aiAgentId?: string | null;
  action: AiConfigChangeAction;
  /** The entity before — null for a creation. */
  before: Record<string, unknown> | null;
  /** The entity after — null for a deletion. */
  after: Record<string, unknown> | null;
  note?: string | null;
  versionId?: string | null;
  draftRevision?: bigint | null;
}

export interface RecordedConfigChange {
  id: string;
  diff: AiConfigDiffEntry[];
  fields: string[];
}

/** The audit action a change writes (AI-21 "Audit eylemleri"). */
function auditActionFor(action: AiConfigChangeAction): AuditAction {
  switch (action) {
    case 'submitted':
      return 'ai.config_submitted';
    case 'approved':
      return 'ai.config_approved';
    case 'rejected':
      return 'ai.config_rejected';
    case 'published':
      return 'ai.config_published';
    case 'rolled_back':
      return 'ai.config_rolled_back';
    case 'paused':
      return 'ai.paused';
    case 'resumed':
      return 'ai.resumed';
    case 'crawled':
      return 'knowledge.crawled';
    default:
      return 'ai.config_changed';
  }
}

function actorTypeOf(author: ConfigChangeAuthor): AiConfigActorType {
  const type = author.audit.actorType ?? 'agent';
  // A customer is never an author; the audit plugin cannot name one on a
  // configuration route, and the table refuses it.
  if (type === 'customer') throw new Error('a customer cannot change the AI configuration');
  return type;
}

/**
 * Write one change row and its audit row in the caller's transaction. An
 * update whose difference is empty — the save changed nothing that is
 * configuration — writes neither and returns null, unless it carries a note
 * (`reindex`: the text was embedded again).
 */
export async function recordChange(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  input: ConfigChangeInput,
): Promise<RecordedConfigChange | null> {
  const before = input.before === null ? null : (storableConfigValue(input.before) as object);
  const after = input.after === null ? null : (storableConfigValue(input.after) as object);
  const diff = diffConfig(before, after);
  // A save with a note says what it was even when no field moved (a reindex).
  if (diff.length === 0 && input.action === 'updated' && !input.note) return null;

  const id = randomUUID();
  const actorType = actorTypeOf(author);
  const actorId = actorType === 'system' ? (author.jobId ?? null) : (author.audit.actorId ?? null);
  const fields = aiConfigDiffFields(diff);

  await tx.aiConfigChange.create({
    data: {
      id,
      licenseId: author.audit.licenseId,
      aiAgentId: input.aiAgentId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId,
      actorType,
      actorRole: author.role,
      // Millisecond precision on purpose: the timeline's keyset cursor is a
      // JS date, which would lose a database default's microseconds.
      at: new Date(),
      versionId: input.versionId ?? null,
      draftRevision: input.draftRevision ?? null,
      before: before === null ? Prisma.DbNull : (before as Prisma.InputJsonObject),
      after: after === null ? Prisma.DbNull : (after as Prisma.InputJsonObject),
      diff: diff as unknown as Prisma.InputJsonArray,
      note: input.note ?? null,
      requestId: author.audit.requestId ?? null,
    },
  });

  await writeAuditEntry(tx, author.audit, {
    action: auditActionFor(input.action),
    target: `ai_config_change:${id}`,
    metadata: {
      entity_type: input.entityType,
      entity_id: input.entityId,
      change: input.action,
      fields,
    },
  });

  return { id, diff, fields };
}

/** Which history entity a skill row is: a procedure (AI-03) or a plain skill. */
export function skillEntityType(row: Record<string, unknown> | null): AiConfigEntityType {
  return row?.['mode'] === 'procedure' ? 'procedure' : 'skill';
}
