/**
 * The root panel's AI catalogues and a workspace's AI summary (tm 389.19 ·
 * FR-ADMIN-23 · docs/platform-admin/design.md §C ai-catalogs, §B2).
 *
 * Two kinds of answer, and neither carries a workspace's content:
 *
 *   - **What the platform ships.** The G1–G19 rules, the iGaming template
 *     pack, the compliance scenario pack and the QA rubric are code; this
 *     file shows their keys, versions and counts (the procedure text, the
 *     lexicon patterns and the scenario turns stay where they are). The one
 *     editable thing is the set of crisis-text drafts, a platform setting.
 *   - **How workspaces use it.** Counts, per workspace: installed template
 *     copies and how many are live; an AI summary of guidance rules, guardrail
 *     triggers, the last compliance run. Every query names its licence — the
 *     platform connection bypasses row level security, so the `WHERE
 *     license_id` is the only wall (`platform-ai-catalogs.test.ts` mutates it).
 *
 * A source that has not shipped yet — `ai_config_changes` (tm 315),
 * `qa_reviews` (tm 319), the tool catalogue (tm 321) — answers
 * `not_installed`, decided at read time from the database (`to_regclass`), so
 * it turns on by itself when its migration lands. If the table exists and its
 * columns are not the ones named in {@link OPTIONAL_SOURCES} the query fails
 * loudly: the summary must not report a zero it cannot stand behind.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AI_TEMPLATES_PACKAGE_VERSION,
  IGAMING_CORE_PACK,
  IGAMING_TEMPLATES_TR,
} from '@siyahtus/ai-templates';
import {
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  AI_COMPLIANCE_SCENARIOS,
  AI_CRISIS_TEXT_DRAFTS_SETTING_KEY,
  AI_QA_RUBRIC,
  AI_QA_RUBRIC_SCALE,
  AI_QA_RUBRIC_VERSION,
  PLATFORM_CRISIS_TEXT_MAX,
  PLATFORM_GUARDRAILS,
  PLATFORM_GUARDRAILS_VERSION,
  isCrisisTextDrafts,
  type AiCatalogStatus,
  type CrisisTextDrafts,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';

const DAY_MS = 86_400_000;
/** The window of "the last 30 days" counts. */
export const AI_SUMMARY_WINDOW_DAYS = 30;

export const TEMPLATE_INSTALLS_DEFAULT = 50;
export const TEMPLATE_INSTALLS_MAX = 200;

/** A keyset cursor over (installed desc, licence asc). */
interface InstallCursor {
  installed: number;
  licenseId: string;
}

export interface GuardrailCatalogItem {
  id: string;
  title: { tr: string; en: string };
  prompt: { tr: string; en: string };
  category: string;
  action: string;
  target: string | null;
  priority: string;
  handoff_reason: string | null;
  risk_flag: string | null;
  applies_when: 'always' | 'risk_flagged';
  tenant_text: string | null;
  lexicon_alone: boolean;
  stages: Array<'input' | 'output'>;
  input_patterns: { tr: number; en: number };
  output_patterns: { tr: number; en: number };
}

export interface CrisisTextDraftsView {
  drafts: CrisisTextDrafts;
  version: number;
  updated_at: string | null;
  max_length: number;
}

export interface CrisisDraftsChange {
  view: CrisisTextDraftsView;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface TemplateInstallRow {
  license_id: string;
  workspace_name: string;
  installed: number;
  active: number;
  outdated: number;
}

/**
 * The tables that are not in the schema yet, and the two columns this file
 * reads from each. A name here is a promise to the task that creates the
 * table (315, 319): it keeps the column, or changes this line in the same
 * commit — `platform-ai-catalogs.test.ts` probes the lookup with a throwaway
 * table of the same shape.
 */
export const OPTIONAL_SOURCES = {
  configChanges: {
    table: 'ai_config_changes',
    licenseColumn: 'license_id',
    timeColumn: 'created_at',
  },
  qaReviews: { table: 'qa_reviews', licenseColumn: 'license_id', timeColumn: 'created_at' },
} as const;

export type OptionalSource = {
  table: string;
  licenseColumn: string;
  timeColumn: string;
};

/** An identifier the code (never a request) supplies. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function identifier(name: string): Prisma.Sql {
  if (!IDENTIFIER.test(name)) throw new Error(`not a plain identifier: ${name}`);
  return Prisma.raw(`"${name}"`);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function encodeInstallCursor(cursor: InstallCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeInstallCursor(raw: string): InstallCursor {
  try {
    const value = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<InstallCursor>;
    if (
      Number.isSafeInteger(value.installed) &&
      (value.installed as number) >= 0 &&
      typeof value.licenseId === 'string' &&
      /^[1-9][0-9]{0,18}$/.test(value.licenseId)
    ) {
      return { installed: value.installed as number, licenseId: value.licenseId };
    }
  } catch {
    // falls through
  }
  throw ApiError.validation('cursor: not a cursor this list issued.');
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Whether `table` exists in the schema the connection searches. */
async function tableExists(db: Pick<PrismaClient, '$queryRaw'>, table: string): Promise<boolean> {
  identifier(table);
  const rows = await db.$queryRaw<Array<{ found: boolean }>>`
    SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS found`;
  return rows[0]?.found === true;
}

/**
 * Rows of `source` that belong to `licenseId` and are newer than `since`; a
 * section object without a number when the table is not there yet.
 */
export async function countSince(
  db: Pick<PrismaClient, '$queryRaw'>,
  source: OptionalSource,
  licenseId: bigint,
  since: Date,
): Promise<{ status: AiCatalogStatus; count: number }> {
  if (!(await tableExists(db, source.table))) return { status: 'not_installed', count: 0 };
  const rows = await db.$queryRaw<Array<{ n: number }>>(
    Prisma.sql`SELECT count(*)::int AS n FROM ${identifier(source.table)}
      WHERE ${identifier(source.licenseColumn)} = ${licenseId}
        AND ${identifier(source.timeColumn)} >= ${since}`,
  );
  return { status: 'available', count: rows[0]?.n ?? 0 };
}

export interface PlatformAiCatalogsOptions {
  now?: () => number;
}

export class PlatformAiCatalogs {
  readonly #db: PrismaClient;
  readonly #now: () => number;

  constructor(db: PrismaClient, options: PlatformAiCatalogsOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
  }

  // --- What the platform ships ----------------------------------------------

  guardrails(): { version: string; count: number; items: GuardrailCatalogItem[] } {
    const items = PLATFORM_GUARDRAILS.map((rule): GuardrailCatalogItem => {
      const stages: Array<'input' | 'output'> = [];
      if (rule.input) stages.push('input');
      if (rule.output) stages.push('output');
      return {
        id: rule.id,
        title: { tr: rule.title.tr, en: rule.title.en },
        prompt: { tr: rule.prompt.tr, en: rule.prompt.en },
        category: rule.category,
        action: rule.action,
        target: rule.target,
        priority: rule.priority,
        handoff_reason: rule.handoffReason,
        risk_flag: rule.riskFlag,
        applies_when: rule.appliesWhen,
        tenant_text: rule.tenantText,
        lexicon_alone: rule.lexiconAlone,
        stages,
        input_patterns: { tr: rule.input?.tr.length ?? 0, en: rule.input?.en.length ?? 0 },
        output_patterns: { tr: rule.output?.tr.length ?? 0, en: rule.output?.en.length ?? 0 },
      };
    });
    return { version: PLATFORM_GUARDRAILS_VERSION, count: items.length, items };
  }

  templates() {
    return {
      pack: {
        key: IGAMING_CORE_PACK.key,
        version: AI_TEMPLATES_PACKAGE_VERSION,
        industry: IGAMING_CORE_PACK.industry,
        lang: IGAMING_CORE_PACK.lang,
        template_count: IGAMING_TEMPLATES_TR.length,
      },
      items: IGAMING_TEMPLATES_TR.map((template) => ({
        key: template.key,
        name: template.name,
        version: template.version,
        locked: template.locked,
        scenario_count: template.scenarios.length,
        tenant_must_fill_count: template.tenant_must_fill.length,
      })),
    };
  }

  compliancePack() {
    return {
      version: AI_COMPLIANCE_PACK_VERSION,
      size: AI_COMPLIANCE_PACK_SIZE,
      items: AI_COMPLIANCE_SCENARIOS.map((scenario) => ({
        key: scenario.key,
        guardrail: scenario.guardrail,
        language: scenario.language,
      })),
    };
  }

  qaRubric() {
    return {
      status: 'available' as AiCatalogStatus,
      version: AI_QA_RUBRIC_VERSION,
      scale: { ...AI_QA_RUBRIC_SCALE },
      items: AI_QA_RUBRIC.map((criterion) => ({ ...criterion })),
    };
  }

  /** The tool slot (tm 321) has not shipped: no catalogue, and the panel says so. */
  tools() {
    return {
      status: 'not_installed' as AiCatalogStatus,
      version: null as string | null,
      items: [] as Array<{ key: string }>,
    };
  }

  // --- Crisis-text drafts -----------------------------------------------------

  async crisisDrafts(
    client: Pick<PrismaClient, 'platformSetting'> = this.#db,
  ): Promise<CrisisTextDraftsView> {
    const row = await client.platformSetting.findUnique({
      where: { key: AI_CRISIS_TEXT_DRAFTS_SETTING_KEY },
    });
    return viewOf(row);
  }

  /**
   * Replace the whole map. A map equal to the stored one writes nothing
   * (`added`/`changed`/`removed` all empty); the caller records only a change.
   */
  async updateCrisisDrafts(
    drafts: CrisisTextDrafts,
    adminId: string,
    record: (tx: Prisma.TransactionClient, change: CrisisDraftsChange) => Promise<void>,
  ): Promise<CrisisDraftsChange> {
    return this.#db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_settings.ai.crisis_text_drafts'))`;
      const before = await this.crisisDrafts(tx);
      const added = Object.keys(drafts).filter((country) => !(country in before.drafts));
      const removed = Object.keys(before.drafts).filter((country) => !(country in drafts));
      const changed = Object.keys(drafts).filter(
        (country) =>
          country in before.drafts &&
          canonical(drafts[country]) !== canonical(before.drafts[country]),
      );
      if (added.length === 0 && removed.length === 0 && changed.length === 0) {
        return { view: before, added, changed, removed };
      }
      const json = drafts as unknown as Prisma.InputJsonValue;
      await tx.platformSetting.upsert({
        where: { key: AI_CRISIS_TEXT_DRAFTS_SETTING_KEY },
        create: { key: AI_CRISIS_TEXT_DRAFTS_SETTING_KEY, value: json, updatedBy: adminId },
        update: { value: json, updatedBy: adminId, version: { increment: 1 } },
      });
      const change: CrisisDraftsChange = {
        view: await this.crisisDrafts(tx),
        added: added.sort(),
        changed: changed.sort(),
        removed: removed.sort(),
      };
      await record(tx, change);
      return change;
    });
  }

  // --- How workspaces use it --------------------------------------------------

  /**
   * Per workspace that holds at least one installed template copy: how many,
   * how many are switched on, how many are behind the pack's version of their
   * template. Most copies first, then licence number; keyset-paged.
   */
  async templateInstalls(options: {
    cursor?: string;
    limit?: number;
  }): Promise<{ data: TemplateInstallRow[]; next_cursor: string | null }> {
    const limit = clamp(options.limit, TEMPLATE_INSTALLS_DEFAULT, TEMPLATE_INSTALLS_MAX);
    const cursor = options.cursor ? decodeInstallCursor(options.cursor) : null;
    const keys = IGAMING_TEMPLATES_TR.map((template) => template.key as string);
    const versions = IGAMING_TEMPLATES_TR.map((template) => template.version);
    const after = cursor
      ? Prisma.sql`WHERE p.installed < ${cursor.installed}
          OR (p.installed = ${cursor.installed} AND p.license_id > ${BigInt(cursor.licenseId)})`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<
      Array<{
        license_id: bigint;
        workspace_name: string;
        installed: number;
        active: number;
        outdated: number;
      }>
    >(Prisma.sql`
      WITH current_versions (key, version) AS (
        SELECT * FROM unnest(${keys}::text[], ${versions}::int[])
      ),
      per AS (
        SELECT s.license_id,
               count(*)::int AS installed,
               (count(*) FILTER (WHERE s.active))::int AS active,
               (count(*) FILTER (WHERE s.template_version < cv.version))::int AS outdated
          FROM skills s
          LEFT JOIN current_versions cv ON cv.key = s.template_key
         WHERE s.kind = 'ai_agent' AND s.template_key IS NOT NULL
         GROUP BY s.license_id
      )
      SELECT p.license_id, o.name AS workspace_name, p.installed, p.active, p.outdated
        FROM per p
        JOIN licenses l ON l.id = p.license_id
        JOIN organizations o ON o.id = l.organization_id
        ${after}
       ORDER BY p.installed DESC, p.license_id ASC
       LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        license_id: row.license_id.toString(),
        workspace_name: row.workspace_name,
        installed: row.installed,
        active: row.active,
        outdated: row.outdated,
      })),
      next_cursor:
        rows.length > limit && last
          ? encodeInstallCursor({
              installed: last.installed,
              licenseId: last.license_id.toString(),
            })
          : null,
    };
  }

  /** The workspace's AI at a glance — counts and states only (tm 389.19). */
  async workspaceSummary(licenseId: bigint) {
    const since = new Date(this.#now() - AI_SUMMARY_WINDOW_DAYS * DAY_MS);
    const [
      agentsTotal,
      agentsActive,
      guidanceTotal,
      guidanceActive,
      changes,
      hits,
      qaReviewed,
      qaAwaiting,
      lastRun,
    ] = await Promise.all([
      this.#db.aiAgent.count({ where: { licenseId } }),
      this.#db.aiAgent.count({ where: { licenseId, active: true } }),
      this.#db.aiGuidanceRule.count({ where: { licenseId } }),
      this.#db.aiGuidanceRule.count({ where: { licenseId, active: true } }),
      countSince(this.#db, OPTIONAL_SOURCES.configChanges, licenseId, since),
      this.#guardrailHits(licenseId, since),
      countSince(this.#db, OPTIONAL_SOURCES.qaReviews, licenseId, since),
      this.#qaAwaiting(licenseId),
      this.#db.aiTestRun.findFirst({
        where: { licenseId, compliancePackVersion: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: {
          compliancePackVersion: true,
          status: true,
          compliancePassed: true,
          complianceFailed: true,
          finishedAt: true,
        },
      }),
    ]);
    return {
      ai_agents: { total: agentsTotal, active: agentsActive },
      guidance_rules: {
        status: 'available' as AiCatalogStatus,
        total: guidanceTotal,
        active: guidanceActive,
      },
      config_changes: { status: changes.status, last_30_days: changes.count },
      guardrail_hits: hits,
      qa: {
        status: qaReviewed.status,
        reviewed_30_days: qaReviewed.count,
        awaiting_review: qaAwaiting,
      },
      compliance_pack: {
        status: 'available' as AiCatalogStatus,
        last_run: lastRun
          ? {
              version: lastRun.compliancePackVersion as string,
              run_status: lastRun.status,
              passed: lastRun.compliancePassed,
              failed: lastRun.complianceFailed,
              finished_at: iso(lastRun.finishedAt),
            }
          : null,
      },
    };
  }

  /** Triggers by rule: `G1`…`G19`, and one bucket each for the workspace's own rules and phrases. */
  async #guardrailHits(licenseId: bigint, since: Date) {
    const rows = await this.#db.$queryRaw<Array<{ rule: string; n: number }>>`
      SELECT CASE
               WHEN rule_key LIKE 'rule:%' THEN 'workspace_rule'
               WHEN rule_key LIKE 'phrase:%' THEN 'forbidden_phrase'
               ELSE rule_key
             END AS rule,
             count(*)::int AS n
        FROM ai_guardrail_hits
       WHERE license_id = ${licenseId} AND created_at >= ${since}
       GROUP BY 1`;
    const byRule: Record<string, number> = {};
    for (const row of rows) byRule[row.rule] = row.n;
    return {
      status: 'available' as AiCatalogStatus,
      last_30_days: rows.reduce((sum, row) => sum + row.n, 0),
      by_rule: byRule,
    };
  }

  /** Reviews waiting for a team lead; zero when the QA queue has not shipped. */
  async #qaAwaiting(licenseId: bigint): Promise<number> {
    const source = OPTIONAL_SOURCES.qaReviews;
    if (!(await tableExists(this.#db, source.table))) return 0;
    const rows = await this.#db.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT count(*)::int AS n FROM ${identifier(source.table)}
        WHERE ${identifier(source.licenseColumn)} = ${licenseId} AND status = 'pending'`,
    );
    return rows[0]?.n ?? 0;
  }
}

function viewOf(
  row: { value: unknown; version: number; updatedAt: Date } | null,
): CrisisTextDraftsView {
  if (row === null || !isCrisisTextDrafts(row.value)) {
    return {
      drafts: {},
      version: row?.version ?? 0,
      updated_at: iso(row?.updatedAt ?? null),
      max_length: PLATFORM_CRISIS_TEXT_MAX,
    };
  }
  return {
    drafts: row.value,
    version: row.version,
    updated_at: row.updatedAt.toISOString(),
    max_length: PLATFORM_CRISIS_TEXT_MAX,
  };
}

/** Key-order-free text of a per-country entry, to tell "changed" from "re-sent". */
function canonical(texts: unknown): string {
  const record = (texts ?? {}) as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}
