/**
 * Reading the AI configuration change history (tm 315 · AI-21): the timeline
 * (`GET /ai/changes`), one change with its before and after
 * (`GET /ai/changes/{id}`) and the CSV export (`GET /ai/changes/export`).
 *
 * Who sees what (AI-21-S2): the Founder and the Administrator the whole
 * history; a Team Lead their own changes and the publish history (the
 * `config_version` rows, tm 316); a Team Member nothing — the route's role
 * gate. Row level security keeps every read inside the workspace; the
 * visibility here narrows within it.
 */
import type { Prisma } from '@prisma/client';
import {
  AI_CONFIG_CHANGES_EXPORT_MAX,
  AI_CONFIG_CHANGES_PAGE_DEFAULT,
  AI_CONFIG_CHANGES_PAGE_MAX,
  aiConfigDiffFields,
  isAiConfigOmittedText,
  type AiConfigChangeAction,
  type AiConfigDiffEntry,
  type AiConfigEntityType,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** `all`: the Founder's and the Administrator's view; `own`: a Team Lead's. */
export type ConfigHistoryVisibility = { kind: 'all' } | { kind: 'own'; accountId: string };

export interface ConfigHistoryFilter {
  entityType?: AiConfigEntityType;
  entityId?: string;
  action?: AiConfigChangeAction;
  actorId?: string;
  versionId?: string;
  from?: Date;
  to?: Date;
}

/** The ordering is (at DESC, id DESC); the cursor carries both. */
interface Cursor {
  at: string;
  id: string;
}

export function encodeChangeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Null for a cursor this did not write — the caller answers 400. */
export function decodeChangeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Cursor).at === 'string' &&
      typeof (parsed as Cursor).id === 'string' &&
      !Number.isNaN(Date.parse((parsed as Cursor).at)) &&
      /^[0-9a-f-]{36}$/i.test((parsed as Cursor).id)
    ) {
      return { at: (parsed as Cursor).at, id: (parsed as Cursor).id };
    }
  } catch {
    // fall through
  }
  return null;
}

function whereOf(
  visibility: ConfigHistoryVisibility,
  filter: ConfigHistoryFilter,
): Prisma.AiConfigChangeWhereInput {
  const and: Prisma.AiConfigChangeWhereInput[] = [];
  if (visibility.kind === 'own') {
    and.push({ OR: [{ actorId: visibility.accountId }, { entityType: 'config_version' }] });
  }
  if (filter.entityType) and.push({ entityType: filter.entityType });
  if (filter.entityId) and.push({ entityId: filter.entityId });
  if (filter.action) and.push({ action: filter.action });
  if (filter.actorId) and.push({ actorId: filter.actorId });
  if (filter.versionId) and.push({ versionId: filter.versionId });
  if (filter.from) and.push({ at: { gte: filter.from } });
  if (filter.to) and.push({ at: { lte: filter.to } });
  return and.length === 0 ? {} : { AND: and };
}

const SUMMARY_SELECT = {
  id: true,
  aiAgentId: true,
  entityType: true,
  entityId: true,
  action: true,
  actorId: true,
  actorType: true,
  actorRole: true,
  at: true,
  versionId: true,
  draftRevision: true,
  diff: true,
  note: true,
  before: true,
  after: true,
} satisfies Prisma.AiConfigChangeSelect;

type ChangeRow = Prisma.AiConfigChangeGetPayload<{ select: typeof SUMMARY_SELECT }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The members' names by id; a system job's name is not an account. */
export async function actorNames(
  tx: TenantClient,
  ids: ReadonlyArray<string | null>,
): Promise<Map<string, string>> {
  const accounts = [...new Set(ids.filter((id): id is string => id !== null && UUID.test(id)))];
  if (accounts.length === 0) return new Map();
  const rows = await tx.account.findMany({
    where: { id: { in: accounts } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** What the timeline calls the entity: its name, title or label, as it was. */
export function entityNameOf(row: { before: unknown; after: unknown }): string | null {
  for (const side of [record(row.after), record(row.before)]) {
    if (!side) continue;
    for (const key of ['name', 'title', 'label', 'phrase', 'key']) {
      const value = side[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
  }
  return null;
}

function diffOf(value: unknown): AiConfigDiffEntry[] {
  return Array.isArray(value) ? (value as AiConfigDiffEntry[]) : [];
}

function serialiseSummary(row: ChangeRow, names: ReadonlyMap<string, string>) {
  const diff = diffOf(row.diff);
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    entity_type: row.entityType,
    entity_id: row.entityId,
    entity_name: entityNameOf(row),
    action: row.action,
    actor: {
      id: row.actorId,
      type: row.actorType,
      role: row.actorRole,
      name: row.actorId === null ? null : (names.get(row.actorId) ?? null),
    },
    at: row.at.toISOString(),
    version_id: row.versionId,
    draft_revision: row.draftRevision === null ? null : Number(row.draftRevision),
    note: row.note,
    fields: aiConfigDiffFields(diff),
    diff,
  };
}

export type ConfigChangeSummary = ReturnType<typeof serialiseSummary>;

export async function listConfigChanges(
  tx: TenantClient,
  visibility: ConfigHistoryVisibility,
  filter: ConfigHistoryFilter,
  page: { limit?: number; cursor?: Cursor | null },
): Promise<{ items: ConfigChangeSummary[]; next_cursor: string | null }> {
  const limit = Math.min(
    Math.max(page.limit ?? AI_CONFIG_CHANGES_PAGE_DEFAULT, 1),
    AI_CONFIG_CHANGES_PAGE_MAX,
  );
  const where = whereOf(visibility, filter);
  const cursor = page.cursor;
  const rows = await tx.aiConfigChange.findMany({
    where: cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { at: { lt: new Date(cursor.at) } },
                { at: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: SUMMARY_SELECT,
  });
  const pageRows = rows.slice(0, limit);
  const names = await actorNames(
    tx,
    pageRows.map((row) => row.actorId),
  );
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((row) => serialiseSummary(row, names)),
    next_cursor:
      rows.length > limit && last
        ? encodeChangeCursor({ at: last.at.toISOString(), id: last.id })
        : null,
  };
}

/** One change with the entity before and after; null when it is not visible. */
export async function getConfigChange(
  tx: TenantClient,
  visibility: ConfigHistoryVisibility,
  id: string,
) {
  const row = await tx.aiConfigChange.findFirst({
    where: { AND: [{ id }, whereOf(visibility, {})] },
    select: { ...SUMMARY_SELECT, requestId: true },
  });
  if (!row) return null;
  const names = await actorNames(tx, [row.actorId]);
  return {
    ...serialiseSummary(row, names),
    before: row.before ?? null,
    after: row.after ?? null,
    request_id: row.requestId,
  };
}

/** A diff value as one CSV cell: text as it is, anything else as JSON. */
export function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (isAiConfigOmittedText(value)) return `[${value.length} chars · sha256 ${value.sha256}]`;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export const CONFIG_CHANGES_CSV_HEADERS = [
  'at',
  'actor',
  'actor_role',
  'entity_type',
  'entity_id',
  'entity_name',
  'action',
  'field',
  'before',
  'after',
  'version_id',
  'change_id',
] as const;

/**
 * The export's rows (AI-21 acceptance: who, when, entity, field, before,
 * after, version): one line per changed field, newest change first; a change
 * with no field (a reindex) is one line with the field empty. At most
 * {@link AI_CONFIG_CHANGES_EXPORT_MAX} changes.
 */
export async function exportConfigChanges(
  tx: TenantClient,
  filter: ConfigHistoryFilter,
): Promise<Array<Array<string | null>>> {
  const rows = await tx.aiConfigChange.findMany({
    where: whereOf({ kind: 'all' }, filter),
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: AI_CONFIG_CHANGES_EXPORT_MAX,
    select: SUMMARY_SELECT,
  });
  const names = await actorNames(
    tx,
    rows.map((row) => row.actorId),
  );
  const lines: Array<Array<string | null>> = [];
  for (const row of rows) {
    const actor = row.actorId === null ? row.actorType : (names.get(row.actorId) ?? row.actorId);
    const base = {
      at: row.at.toISOString(),
      name: entityNameOf(row),
    };
    const diff = diffOf(row.diff);
    const entries: Array<AiConfigDiffEntry | null> = diff.length > 0 ? diff : [null];
    for (const entry of entries) {
      lines.push([
        base.at,
        actor,
        row.actorRole,
        row.entityType,
        row.entityId,
        base.name,
        row.action,
        entry?.path ?? row.note,
        entry ? csvValue(entry.before) : '',
        entry ? csvValue(entry.after) : '',
        row.versionId,
        row.id,
      ]);
    }
  }
  return lines;
}
