/**
 * The structured knowledge tables (tm 310.2 · SiyahTuş analysis AI-13;
 * ADR-14b §2.12): payment methods, bonuses, KYC documents, limits and rules
 * — `/knowledge-tables/{table}` with its rows, a row's review, and the table
 * as CSV both ways.
 *
 * The rows are the AI's figures (tm 310.3 computes from them); each is also
 * one knowledge source, its Turkish text (`renderRowText`), which retrieval
 * finds like any passage. A write commits the row first and then brings its
 * source along (`row-knowledge.ts`) — never refused for the embedding's sake:
 * a workspace whose content may not reach the embedding provider, the day's
 * AI cap or an absent provider leave the source waiting for the hourly sweep.
 * So these routes carry no `aiInference` flag; the sync asks the residency
 * rule itself, and only when there is text to embed.
 *
 * Scopes are the knowledge sources' (`agents-bot--all`): the same people keep
 * the AI's knowledge, in one place.
 *
 * `/ai-access-info` (tm 310.4 · K13) is the access information beside them —
 * what the AI says about reaching the site, read and replaced whole
 * (`services/knowledge-tables/access-info-writer.ts`); the turn answers from
 * it through `access-info.ts`.
 */
import { configAuthorOf } from '../lib/config-author.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  KNOWLEDGE_TABLES,
  KNOWLEDGE_TABLE_PATH_SEGMENTS,
  type KnowledgeTable,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { isCsvParseError, parseCsv } from '../lib/csv-import.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import type { KnowledgeService } from '../services/ai/knowledge-service.js';
import {
  KNOWLEDGE_TABLE_CSV_LIMITS,
  KnowledgeTableCsvHeaderError,
  knowledgeTableCsv,
  mapKnowledgeTableCsvRow,
  resolveKnowledgeTableColumns,
} from '../services/knowledge-tables/csv.js';
import {
  listAiAccessInfo,
  putAiAccessInfo,
  serialiseAiAccessInfo,
} from '../services/knowledge-tables/access-info-writer.js';
import { serialiseKnowledgeTableRow } from '../services/knowledge-tables/records.js';
import { KnowledgeTableRowKnowledge } from '../services/knowledge-tables/row-knowledge.js';
import {
  listKnowledgeTableRecords,
  readKnowledgeTableRows,
} from '../services/knowledge-tables/rows.js';
import {
  createKnowledgeTableRow,
  deleteKnowledgeTableRow,
  importKnowledgeTableRows,
  reviewKnowledgeTableRow,
  updateKnowledgeTableRow,
  type KnowledgeTableWriter,
} from '../services/knowledge-tables/writer.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();

/** A row's body: any object — the fields are the validators' to judge, all at once. */
const rowBody = z.record(z.string(), z.unknown());

const listQuery = z
  .object({
    brand_id: uuid.optional(),
    stale: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

const importBody = z
  .object({
    // `KNOWLEDGE_TABLE_CSV_LIMITS.maxBytes` is the one authority on size.
    csv: z.string().min(1),
    dry_run: z.boolean().default(false),
  })
  .strict();

/**
 * The transport ceiling for the import only: the CSV travels as a JSON string,
 * and escaping can nearly double a quote-heavy file, so an oversized file is
 * refused by the typed budget that names its limit (the bulk import's rule).
 */
const IMPORT_BODY_LIMIT = 12_582_912; // 12 MiB

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

const TABLE_BY_SEGMENT = new Map<string, KnowledgeTable>(
  KNOWLEDGE_TABLES.map((table) => [KNOWLEDGE_TABLE_PATH_SEGMENTS[table], table]),
);

/** The table a path segment names; an unknown one is a 404, like any path that is not there. */
function tableOf(segment: string): KnowledgeTable {
  const table = TABLE_BY_SEGMENT.get(segment);
  if (table === undefined) throw ApiError.notFound('No such knowledge table.');
  return table;
}

const notFound = () => ApiError.notFound('Knowledge table row not found.');

type TableParams = { Params: { table: string } };
type RowParams = { Params: { table: string; rowId: string } };

export default async function knowledgeTableRoutes(
  app: FastifyInstance,
  {
    knowledge,
  }: {
    /** The server's one knowledge service (tm 255.7): rows are indexed into the space questions are asked in. */
    knowledge: KnowledgeService;
  },
): Promise<void> {
  const rowKnowledge = new KnowledgeTableRowKnowledge(knowledge);

  function writerOf(request: FastifyRequest): KnowledgeTableWriter {
    const principal = request.requirePrincipal();
    return {
      licenseId: request.tenant().licenseId,
      accountId: principal.kind === 'agent' ? principal.accountId : null,
      author: configAuthorOf(request),
    };
  }

  /**
   * Bring the rows' knowledge sources to what they say now, once their write
   * has committed. Nothing here refuses the write: the residency rule, the
   * day's cap or an absent provider leave a source waiting for the sweep, and
   * a failure of the sync itself is logged — the sweep finds the row again by
   * what its source says. A payment method's change is its bonuses' too: a
   * bonus's text names the methods it excludes.
   */
  async function syncRowKnowledge(
    request: FastifyRequest,
    table: KnowledgeTable,
    rowIds: readonly string[],
  ): Promise<void> {
    const tenant = request.tenant();
    let allowed: boolean | null = null;
    const mayEmbed = async () => {
      allowed ??= await request.requireAiInference().then(
        () => true,
        (error: unknown) => {
          if (error instanceof ApiError && error.type === 'not_allowed') return false;
          throw error;
        },
      );
      return allowed;
    };
    const targets: Array<{ table: KnowledgeTable; id: string }> = rowIds.map((id) => ({
      table,
      id,
    }));
    if (table === 'payment_methods' && rowIds.length > 0) {
      const bonuses = await request.withTenant((tx) =>
        tx.kbBonus.findMany({
          where: { OR: rowIds.map((id) => ({ excludedMethodIds: { has: id } })) },
          select: { id: true },
        }),
      );
      targets.push(...bonuses.map((bonus) => ({ table: 'bonuses' as const, id: bonus.id })));
    }
    for (const target of targets) {
      try {
        await rowKnowledge.sync(
          (fn) => request.withTenant(fn),
          tenant,
          target.table,
          target.id,
          mayEmbed,
        );
      } catch (error) {
        request.log.error(
          { err: error, knowledge_table: target.table, row_id: target.id },
          'knowledge table row sync failed; the knowledge sweep takes it up',
        );
      }
    }
  }

  app.get<TableParams>(
    '/knowledge-tables/:table',
    { config: { scopes: READ } },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const query = parse(listQuery, request.query ?? {});
      const now = new Date();
      const records = await request.withTenant((tx) =>
        query.brand_id === undefined
          ? listKnowledgeTableRecords(tx, table)
          : readKnowledgeTableRows(tx, table, { brandId: query.brand_id }),
      );
      const items = records
        .map((record) => serialiseKnowledgeTableRow(table, record, now))
        .filter((item) => query.stale === undefined || item['stale'] === query.stale);
      return reply.send({ items });
    },
  );

  app.post<TableParams>(
    '/knowledge-tables/:table',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const body = parse(rowBody, request.body);
      const writer = writerOf(request);
      const created = await request.withTenant((tx) =>
        createKnowledgeTableRow(tx, writer, table, body),
      );
      await syncRowKnowledge(request, table, [created.id]);
      return reply.status(201).send(serialiseKnowledgeTableRow(table, created));
    },
  );

  app.patch<RowParams>(
    '/knowledge-tables/:table/:rowId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const id = parse(uuid, request.params.rowId);
      const body = parse(rowBody, request.body);
      if (Object.keys(body).length === 0) {
        throw ApiError.validation('body: at least one field is required');
      }
      const writer = writerOf(request);
      const updated = await request.withTenant((tx) =>
        updateKnowledgeTableRow(tx, writer, table, id, body),
      );
      if (updated === null) throw notFound();
      await syncRowKnowledge(request, table, [id]);
      return reply.send(serialiseKnowledgeTableRow(table, updated));
    },
  );

  app.delete<RowParams>(
    '/knowledge-tables/:table/:rowId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const id = parse(uuid, request.params.rowId);
      const writer = writerOf(request);
      const deleted = await request.withTenant(async (tx) => {
        const gone = await deleteKnowledgeTableRow(tx, writer, table, id);
        if (gone) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `knowledge_table_row:${id}`,
            metadata: { kind: 'knowledge_table_row', table },
          });
        }
        return gone;
      });
      if (!deleted) throw notFound();
      // The row's source went with it; a method's bonuses no longer name it.
      if (table === 'payment_methods') await syncRowKnowledge(request, table, [id]);
      return reply.status(204).send();
    },
  );

  /**
   * "Gözden geçirdim" (AI-13-S2): the row is due again `review_interval_days`
   * from now. Nothing the AI says changes; the row's source takes the new
   * review like its other meta fields.
   */
  app.post<RowParams>(
    '/knowledge-tables/:table/:rowId/review',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const id = parse(uuid, request.params.rowId);
      const writer = writerOf(request);
      const reviewed = await request.withTenant((tx) =>
        reviewKnowledgeTableRow(tx, writer, table, id),
      );
      if (reviewed === null) throw notFound();
      await syncRowKnowledge(request, table, [id]);
      return reply.send(serialiseKnowledgeTableRow(table, reviewed));
    },
  );

  /**
   * A CSV import (AI-13 §8, the bulk import pattern): the file is judged
   * whole first — a malformed file or a header this table cannot read refuses
   * everything — then row by row: the valid rows are taken, the others skipped
   * with their problems, a 200 either way. A dry run is the preview.
   */
  app.post<TableParams>(
    '/knowledge-tables/:table/import',
    { config: { scopes: WRITE }, bodyLimit: IMPORT_BODY_LIMIT },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const body = parse(importBody, request.body);
      const writer = writerOf(request);

      let document;
      try {
        document = parseCsv(body.csv, KNOWLEDGE_TABLE_CSV_LIMITS);
      } catch (error) {
        if (isCsvParseError(error)) {
          throw ApiError.validation(`csv: ${error.message}`, {
            reason: `csv_${error.code}`,
            line: error.line,
            column: error.column,
            max_rows: KNOWLEDGE_TABLE_CSV_LIMITS.maxRows,
            max_cell_chars: KNOWLEDGE_TABLE_CSV_LIMITS.maxCellChars,
            max_bytes: KNOWLEDGE_TABLE_CSV_LIMITS.maxBytes,
          });
        }
        throw error;
      }
      let columns;
      try {
        columns = resolveKnowledgeTableColumns(table, document.header);
      } catch (error) {
        if (error instanceof KnowledgeTableCsvHeaderError) {
          throw ApiError.validation(`csv header: ${error.message}`, {
            reason: error.reason,
            columns: error.columns.join(', '),
          });
        }
        throw error;
      }
      const parsed = document.rows.map((cells, index) => ({
        line: index + 1,
        ...mapKnowledgeTableCsvRow(table, columns, cells),
      }));

      const { verdicts, created } = await request.withTenant((tx) =>
        importKnowledgeTableRows(tx, writer, table, parsed, body.dry_run),
      );
      await syncRowKnowledge(
        request,
        table,
        created.map((record) => record.id),
      );
      const imported = verdicts.filter((verdict) => verdict.status === 'imported').length;
      return reply.send({
        imported,
        failed: verdicts.length - imported,
        dry_run: body.dry_run,
        results: verdicts,
      });
    },
  );

  /** The access information settings (K13): the every-brand one first, then each brand's. */
  app.get('/ai-access-info', { config: { scopes: READ } }, async (request, reply) => {
    const rows = await request.withTenant((tx) => listAiAccessInfo(tx));
    return reply.send({ items: rows.map((row) => serialiseAiAccessInfo(row)) });
  });

  /** One brand's setting, or the every-brand one, replaced whole (K13). */
  app.put('/ai-access-info', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(rowBody, request.body);
    const writer = writerOf(request);
    const saved = await request.withTenant((tx) => putAiAccessInfo(tx, writer, body));
    return reply.send(serialiseAiAccessInfo(saved));
  });

  /** The table as CSV — the columns the import reads, so an exported file imports back. */
  app.get<TableParams>(
    '/knowledge-tables/:table/export',
    { config: { scopes: READ } },
    async (request, reply) => {
      const table = tableOf(request.params.table);
      const records = await request.withTenant((tx) => listKnowledgeTableRecords(tx, table));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="siyahtus-${KNOWLEDGE_TABLE_PATH_SEGMENTS[table]}.csv"`,
        )
        .send(knowledgeTableCsv(table, records));
    },
  );
}
