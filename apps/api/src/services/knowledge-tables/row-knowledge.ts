/**
 * A structured-table row in the AI's knowledge (tm 310.2 · SiyahTuş analysis
 * AI-13 "Kodlama mantığı" 3; ADR-14b §2.12; the KB article's mirror,
 * `kb-article-knowledge.ts`, is the pattern).
 *
 * Every row of the four tables is rendered to Turkish text
 * (`@siyahtus/types` `renderRowText`) and kept as one knowledge source —
 * `type = 'table_row'`, `source_table` + `source_row_id` naming the row — so
 * retrieval finds "Papara ile en az ne kadar yatırabilirim?" among the
 * passages like any other. The source carries the row's brands (the AI-14
 * brand filter is the source's), owner and review, a bonus's campaign end as
 * its `valid_until`; it is for the AI and Copilot, every AI agent. A changed
 * row is indexed again; a deleted row's source goes in the delete's own
 * transaction (`config-draft.ts`). A bonus names the payment methods it
 * excludes, so a method's rename is its bonuses' change too.
 *
 * One function decides what a row's source should be —
 * {@link KnowledgeTableRowKnowledge.sync} — and two callers run it: the
 * row's own write (`routes/knowledge-tables.ts`), right after it commits, and
 * the hourly sweep ({@link KnowledgeTableRowKnowledgeSweeper}, in the
 * `knowledge_refresh` job) for what a write could not finish.
 *
 * **The row is never refused for the AI's sake.** The row is what the AI
 * computes from (tm 310.3 reads it directly); its passage is how retrieval
 * finds it. When the new text cannot be embedded now — the residency rule
 * (NFR-C4), the day's AI cap, the provider away — the source takes the new
 * text and loses its chunks (`indexing`, the reason in `last_refresh_error`)
 * rather than answering from what the row no longer says.
 *
 * The embedding is the provider call and runs in no transaction (tm 255.7):
 * read, embed, then write — the write takes the row's lock, renders it again
 * and writes only if what was embedded is still what the row says.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  KNOWLEDGE_TABLES,
  KNOWLEDGE_TABLE_SAMPLE_SOURCE,
  KNOWLEDGE_TABLE_SOURCE_TYPE,
  KNOWLEDGE_TABLE_SQL_NAMES,
  knowledgeTableRowLabel,
  renderRowText,
  type KnowledgeTable,
} from '@siyahtus/types';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { AiDailyCapError, type AiCapScope } from '../ai/ai-daily-budget.js';
import {
  TABLE_ROW_SOURCE_SCOPE,
  createTableRowSourceDraft,
  deleteKnowledgeSourceDraft,
  updateTableRowSourceDraft,
  type TableRowSourceFields,
} from '../ai/config-draft.js';
import type { TenantRunner } from '../ai/conversation/turn.js';
import {
  inferenceAllowed,
  readInferenceResidency,
  type InferenceProvider,
} from '../ai/inference.js';
import type { KnowledgeService, PreparedChunks } from '../ai/knowledge-service.js';
import { EmbeddingProviderError } from '../ai/provider/embedding-error.js';
import { knowledgeTableFieldsOf } from './records.js';
import {
  findKnowledgeTableRecord,
  listKnowledgeTableRecords,
  type KnowledgeTableRecords,
} from './rows.js';

/** How many rows one tenant's sweep pass syncs — the rest wait for the next pass. */
export const KNOWLEDGE_TABLE_SYNC_BATCH = 50;

/** What `last_refresh_error` says when a row's text is not indexed now. */
export const TABLE_ROW_NOT_INDEXED = Object.freeze({
  residency:
    'Not indexed: this workspace is covered by a signed HIPAA agreement and the embedding provider runs outside its region.',
  ai_daily_cap:
    "Not indexed yet: today's AI allowance is used up. It is tried again after 00:00 UTC.",
  embedding: (kind: string) =>
    `Not indexed yet: the embedding provider did not answer (${kind}). It is tried again within the hour.`,
});

export type TableRowSyncOutcome =
  /** The source is what the row says already. */
  | { result: 'unchanged' }
  /** The row's text was embedded and its source written with it. */
  | { result: 'indexed'; chunks: number }
  /** A meta field (brands, owner, review, label) moved; the text, and so the chunks, did not. */
  | { result: 'updated' }
  /** The row is gone: so is its source. */
  | { result: 'removed' }
  /**
   * Not indexed now. `residency`, `ai_daily_cap` and `embedding` leave the
   * source `indexing` with no chunks; `superseded` — the row changed while its
   * text was being embedded — leaves it to the write that changed it.
   */
  | {
      result: 'deferred';
      reason: 'residency' | 'ai_daily_cap' | 'embedding' | 'superseded';
      capScope?: AiCapScope;
    };

/** May this workspace's content go to the embedding provider now (NFR-C4)? Asked only when there is text to embed. */
export type TableRowEmbedGate = () => Promise<boolean>;

type AnyRecord = KnowledgeTableRecords[KnowledgeTable];

const SOURCE_SELECT = {
  id: true,
  name: true,
  content: true,
  status: true,
  brandIds: true,
  ownerId: true,
  reviewedAt: true,
  reviewIntervalDays: true,
  validUntil: true,
  audiences: true,
  aiAgentIds: true,
  lastRefreshError: true,
} as const;

interface SourceRow {
  id: string;
  name: string;
  content: string | null;
  status: string;
  brandIds: string[];
  ownerId: string | null;
  reviewedAt: Date;
  reviewIntervalDays: number;
  validUntil: Date | null;
  audiences: string[];
  aiAgentIds: string[];
  lastRefreshError: string | null;
}

/** The payment method names a bonus's text spells its exclusions with. */
async function methodNamesFor(
  tx: TenantClient,
  table: KnowledgeTable,
  records: readonly AnyRecord[],
): Promise<Record<string, string>> {
  if (table !== 'bonuses') return {};
  const ids = [
    ...new Set(
      records.flatMap((record) => (record as KnowledgeTableRecords['bonuses']).excludedMethodIds),
    ),
  ];
  if (ids.length === 0) return {};
  const methods = await tx.kbPaymentMethod.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return Object.fromEntries(methods.map((method) => [method.id, method.name]));
}

/** What `record`'s source should hold. */
export function tableRowSourceFields(
  table: KnowledgeTable,
  record: AnyRecord,
  methodNames: Readonly<Record<string, string>>,
): TableRowSourceFields {
  const fields = knowledgeTableFieldsOf(table, record);
  return {
    name: knowledgeTableRowLabel(table, fields as unknown as Record<string, unknown>) ?? table,
    content: renderRowText(table, fields, { methodNames }),
    brandIds: [...record.brandIds],
    ownerId: record.ownerId,
    reviewedAt: record.reviewedAt,
    reviewIntervalDays: record.reviewIntervalDays,
    validUntil: table === 'bonuses' ? (record as KnowledgeTableRecords['bonuses']).activeTo : null,
    addedBy: record.createdBy,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

const sameMoment = (a: Date | null, b: Date | null) =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

/** Whether `source` says everything but its text as `fields` do. */
function sameMeta(source: SourceRow, fields: TableRowSourceFields): boolean {
  return (
    source.name === fields.name &&
    sameList(source.brandIds, fields.brandIds) &&
    source.ownerId === fields.ownerId &&
    sameMoment(source.reviewedAt, fields.reviewedAt) &&
    source.reviewIntervalDays === fields.reviewIntervalDays &&
    sameMoment(source.validUntil, fields.validUntil) &&
    sameList(source.audiences, TABLE_ROW_SOURCE_SCOPE.audiences) &&
    sameList(source.aiAgentIds, TABLE_ROW_SOURCE_SCOPE.aiAgentIds)
  );
}

/** Whether `source` is what `fields` say, chunks included. */
function current(source: SourceRow | null, fields: TableRowSourceFields): boolean {
  return (
    source !== null &&
    source.status !== 'indexing' &&
    source.content === fields.content &&
    sameMeta(source, fields)
  );
}

function readSource(
  tx: TenantClient,
  table: KnowledgeTable,
  rowId: string,
): Promise<SourceRow | null> {
  return tx.knowledgeSource.findFirst({
    where: { sourceTable: KNOWLEDGE_TABLE_SQL_NAMES[table], sourceRowId: rowId },
    select: SOURCE_SELECT,
  });
}

/** The row and what its source should hold, read together. */
async function readWanted(
  tx: TenantClient,
  table: KnowledgeTable,
  rowId: string,
): Promise<TableRowSourceFields | null> {
  const record = await findKnowledgeTableRecord(tx, table, rowId);
  // An "örnek — doğrulayın" row has no passage until a person confirms it (AI-15-S1).
  if (record === null || record.source === KNOWLEDGE_TABLE_SAMPLE_SOURCE) return null;
  return tableRowSourceFields(table, record, await methodNamesFor(tx, table, [record]));
}

/** The row's lock, for this transaction: one source writer per row at a time. */
async function lockRow(tx: TenantClient, table: KnowledgeTable, rowId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM ${Prisma.raw(KNOWLEDGE_TABLE_SQL_NAMES[table])}
                      WHERE id = ${rowId}::uuid FOR UPDATE`;
}

export class KnowledgeTableRowKnowledge {
  readonly #knowledge: KnowledgeService;

  constructor(knowledge: KnowledgeService) {
    this.#knowledge = knowledge;
  }

  /**
   * Bring `rowId`'s source to what the row says now. `run` opens a tenant
   * transaction per step; `mayEmbed` is asked only when there is text to
   * embed. Throws only what is not the provider's or the allowance's to
   * refuse — a database error, a defect.
   */
  async sync(
    run: TenantRunner,
    tenant: TenantContext,
    table: KnowledgeTable,
    rowId: string,
    mayEmbed: TableRowEmbedGate,
  ): Promise<TableRowSyncOutcome> {
    const read = await run(async (tx) => ({
      fields: await readWanted(tx, table, rowId),
      source: await readSource(tx, table, rowId),
    }));

    if (read.fields === null) {
      if (read.source === null) return { result: 'unchanged' };
      return run(async (tx) => {
        await deleteKnowledgeSourceDraft(tx, read.source!.id, {
          sourceTable: KNOWLEDGE_TABLE_SQL_NAMES[table],
          sourceRowId: rowId,
        });
        return { result: 'removed' } as const;
      });
    }
    if (current(read.source, read.fields)) return { result: 'unchanged' };

    // The text is embedded already; only the label or a meta field moves.
    if (
      read.source !== null &&
      read.source.status !== 'indexing' &&
      read.source.content === read.fields.content
    ) {
      return this.#write(run, tenant, table, rowId, read.fields, null);
    }

    if (!(await mayEmbed())) {
      return this.#hold(run, tenant, table, rowId, read.fields, 'residency');
    }
    let prepared: PreparedChunks;
    try {
      prepared = await this.#knowledge.prepare(read.fields.content, tenant);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        const held = await this.#hold(run, tenant, table, rowId, read.fields, 'ai_daily_cap');
        return held.result === 'deferred' && held.reason === 'ai_daily_cap'
          ? { ...held, capScope: error.scope }
          : held;
      }
      if (!(error instanceof EmbeddingProviderError)) throw error;
      return this.#hold(run, tenant, table, rowId, read.fields, 'embedding', error.kind);
    }
    return this.#write(run, tenant, table, rowId, read.fields, prepared);
  }

  /**
   * Write the source as `fields` say, under the row's lock and only if the row
   * still says it. `prepared` is the new text's chunks; null when the text is
   * the source's already.
   */
  async #write(
    run: TenantRunner,
    tenant: TenantContext,
    table: KnowledgeTable,
    rowId: string,
    fields: TableRowSourceFields,
    prepared: PreparedChunks | null,
  ): Promise<TableRowSyncOutcome> {
    return run(async (tx) => {
      await lockRow(tx, table, rowId);
      const now = await readWanted(tx, table, rowId);
      if (now === null || now.content !== fields.content) {
        return { result: 'deferred', reason: 'superseded' } as const;
      }
      const source = await readSource(tx, table, rowId);
      let sourceId: string;
      if (source) {
        await updateTableRowSourceDraft(tx, { id: source.id, licenseId: tenant.licenseId }, now);
        sourceId = source.id;
      } else {
        if (prepared === null) return { result: 'deferred', reason: 'superseded' } as const;
        sourceId = (
          await createTableRowSourceDraft(
            tx,
            { licenseId: tenant.licenseId, table, id: rowId },
            now,
          )
        ).id;
      }
      if (prepared === null) return { result: 'updated' } as const;
      const chunks = await this.#knowledge.index(tx, tenant, sourceId, prepared);
      return { result: 'indexed', chunks } as const;
    });
  }

  /**
   * The row's text could not be embedded now: its source takes the text
   * anyway, without chunks — `indexing`, saying why — so nothing answers from
   * what the row no longer says. The sweep indexes it later.
   */
  async #hold(
    run: TenantRunner,
    tenant: TenantContext,
    table: KnowledgeTable,
    rowId: string,
    fields: TableRowSourceFields,
    reason: 'residency' | 'ai_daily_cap' | 'embedding',
    kind = '',
  ): Promise<TableRowSyncOutcome> {
    const pending =
      reason === 'embedding'
        ? TABLE_ROW_NOT_INDEXED.embedding(kind)
        : TABLE_ROW_NOT_INDEXED[reason];
    return run(async (tx) => {
      await lockRow(tx, table, rowId);
      const now = await readWanted(tx, table, rowId);
      if (now === null || now.content !== fields.content) {
        return { result: 'deferred', reason: 'superseded' } as const;
      }
      const source = await readSource(tx, table, rowId);
      if (
        source &&
        source.status === 'indexing' &&
        source.content === now.content &&
        sameMeta(source, now) &&
        source.lastRefreshError === pending
      ) {
        // Held already, for the same reason: a sweep pass that cannot index
        // it either writes nothing.
        return { result: 'deferred', reason } as const;
      }
      if (source) {
        // Its chunks first, through the writer of chunks (ADR-14b §2.8).
        await this.#knowledge.unindex(tx, source.id);
        await updateTableRowSourceDraft(
          tx,
          { id: source.id, licenseId: tenant.licenseId },
          now,
          pending,
        );
      } else {
        await createTableRowSourceDraft(
          tx,
          { licenseId: tenant.licenseId, table, id: rowId },
          now,
          pending,
        );
      }
      return { result: 'deferred', reason } as const;
    });
  }
}

export interface KnowledgeTableRowKnowledgeSweeperOptions {
  knowledge: KnowledgeService;
  /** Where that service's embedding provider runs (`resolveEmbeddingInferenceProvider`). */
  embeddingInference: InferenceProvider;
  /** Overrides {@link KNOWLEDGE_TABLE_SYNC_BATCH}; a test lowers it. */
  batch?: number;
}

export interface KnowledgeTableRowKnowledgeReport {
  startedAt: string;
  finishedAt: string;
  totals: {
    tenants: number;
    /** Rows whose source was not what they say, and sources whose row is gone. */
    checked: number;
    /** Indexed, updated or removed this pass. */
    synced: number;
    /** Left for a later pass: the residency rule, the day's cap, the provider, the batch. */
    deferred: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/** A row whose source is not what it says, or a source whose row is gone. */
interface DueRow {
  table: KnowledgeTable;
  rowId: string;
}

/**
 * The sweep half (see the file header): per workspace, every row of the four
 * tables rendered and compared with its source — none, `indexing`, another
 * text or another meta field — and every `table_row` source whose row is
 * gone; {@link KNOWLEDGE_TABLE_SYNC_BATCH} of them at a time, each through
 * {@link KnowledgeTableRowKnowledge.sync}. Rendering is arithmetic on rows the
 * workspace holds at most `KNOWLEDGE_TABLE_ROWS_MAX` of per table, and only a
 * row that differs reaches the provider. Like the KB sweep it walks the
 * tenants through the shared SECURITY DEFINER enumerator, asks a workspace's
 * residency only when one of its rows has text to embed, and stops embedding
 * for a workspace — or for the pass — once the day's AI cap refuses.
 */
export class KnowledgeTableRowKnowledgeSweeper {
  readonly #db: PrismaClient;
  readonly #sync: KnowledgeTableRowKnowledge;
  readonly #embeddingInference: InferenceProvider;
  readonly #batch: number;

  constructor(db: PrismaClient, options: KnowledgeTableRowKnowledgeSweeperOptions) {
    this.#db = db;
    this.#sync = new KnowledgeTableRowKnowledge(options.knowledge);
    this.#embeddingInference = options.embeddingInference;
    this.#batch = options.batch ?? KNOWLEDGE_TABLE_SYNC_BATCH;
  }

  async run(): Promise<KnowledgeTableRowKnowledgeReport> {
    const startedAt = new Date().toISOString();
    const totals = { tenants: 0, checked: 0, synced: 0, deferred: 0 };
    const pass = { deploymentCapped: false };
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    for (const row of tenants) {
      totals.tenants += 1;
      const tenant: TenantContext = {
        licenseId: row.license_id,
        organizationId: row.organization_id,
      };
      const run: TenantRunner = (fn) => withTenant(this.#db, tenant, fn);
      const due = await run((tx) => dueRows(tx));
      if (due.length === 0) continue;

      let allowed: boolean | null = null;
      let workspaceCapped = false;
      const mayEmbed: TableRowEmbedGate = async () => {
        if (workspaceCapped || pass.deploymentCapped) return false;
        allowed ??= await run(async (tx) => {
          const residency = await readInferenceResidency(tx, tenant);
          return (
            residency !== null &&
            inferenceAllowed({
              provider: this.#embeddingInference,
              workspaceRegion: residency.region,
              hipaaScope: residency.hipaaScope,
            })
          );
        });
        return allowed;
      };

      for (const [index, item] of due.entries()) {
        totals.checked += 1;
        // Past the batch, or capped for this workspace or the pass: the rest
        // wait — nothing is written for them, and no provider is asked.
        if (index >= this.#batch || workspaceCapped || pass.deploymentCapped) {
          totals.deferred += 1;
          continue;
        }
        const outcome = await this.#sync.sync(run, tenant, item.table, item.rowId, mayEmbed);
        if (outcome.result === 'deferred') {
          totals.deferred += 1;
          if (outcome.capScope === 'workspace') workspaceCapped = true;
          if (outcome.capScope === 'global') pass.deploymentCapped = true;
        } else if (outcome.result !== 'unchanged') {
          totals.synced += 1;
        }
      }
    }
    return { startedAt, finishedAt: new Date().toISOString(), totals };
  }
}

/** The rows of one workspace whose source is not what they say, oldest change first; then the orphans. */
async function dueRows(tx: TenantClient): Promise<DueRow[]> {
  const sources = await tx.knowledgeSource.findMany({
    where: { type: KNOWLEDGE_TABLE_SOURCE_TYPE },
    select: { ...SOURCE_SELECT, sourceTable: true, sourceRowId: true },
  });
  const bySql = new Map<string, SourceRow>();
  for (const source of sources) bySql.set(`${source.sourceTable}:${source.sourceRowId}`, source);

  const due: Array<DueRow & { at: number }> = [];
  const orphans: DueRow[] = [];
  for (const table of KNOWLEDGE_TABLES) {
    const sql = KNOWLEDGE_TABLE_SQL_NAMES[table];
    const records = await listKnowledgeTableRecords(tx, table);
    const names = await methodNamesFor(tx, table, records);
    const present = new Set<string>();
    for (const record of records) {
      present.add(record.id);
      const source = bySql.get(`${sql}:${record.id}`) ?? null;
      if (record.source === KNOWLEDGE_TABLE_SAMPLE_SOURCE) {
        if (source !== null) due.push({ table, rowId: record.id, at: record.updatedAt.getTime() });
        continue;
      }
      if (!current(source, tableRowSourceFields(table, record, names))) {
        due.push({ table, rowId: record.id, at: record.updatedAt.getTime() });
      }
    }
    for (const source of sources) {
      if (source.sourceTable === sql && source.sourceRowId && !present.has(source.sourceRowId)) {
        orphans.push({ table, rowId: source.sourceRowId });
      }
    }
  }
  due.sort((a, b) => a.at - b.at || a.rowId.localeCompare(b.rowId));
  return [...due.map(({ table, rowId }) => ({ table, rowId })), ...orphans];
}
