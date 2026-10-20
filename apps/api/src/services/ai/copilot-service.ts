/**
 * Copilot — agent-assist (FR-MOD-12).
 *
 * Copilot is a second AI surface, for agents and never reachable by a customer
 * token. Since K11 (tm 309, `docs/adr/single-knowledge-store.md`) its knowledge
 * is not a base of its own: the AI agent's and Copilot's sources are one store
 * told apart by who each is for (`audiences`). Copilot drafts from all of it —
 * what the AI agent answers players from and what is for agents only
 * (`{copilot}`, FR-MOD-12.2's "Copilot's own") — narrowed by the
 * conversation's brand (tm 309.2); only the AI agent's search is held away
 * from `{copilot}`. The `kind: 'copilot'` record stays, as the anchor of the
 * assist runs below and the filing of the sources for agents only.
 *
 * Everything here is find-or-create against the license: the seed makes a
 * Copilot agent, but a freshly provisioned workspace (or a test fixture) may not
 * have one yet, and an assist must not fail because setup ran in a different
 * order. A copilot assist also records a `SkillRun` on the chat — the exact
 * signal Reports counts as "assisted" (07.3.2), so using Copilot on a chat that
 * a human then closes moves it out of the "manual" column.
 */
import {
  biMetricSource,
  resolveBiQuestion,
  type ConversationTurn,
  type MetricKey,
  type RelativeRange,
} from '@siyahtus/ai-mock';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import type { Prisma } from '@prisma/client';
import { AiDailyCapError } from './ai-daily-budget.js';
import {
  createKnowledgeSourceDraft,
  deleteKnowledgeSourceDraft,
  ensureCopilotAgentId,
} from './config-draft.js';
import { buildOverviewReport, resolveRange } from '../../routes/reports.js';
import {
  lastInstantBefore,
  startOfIsoWeek,
  startOfUtcDay,
} from '../reports/scheduled-report-period.js';
import {
  ANSWER_RETRIEVAL_LIMIT,
  type KnowledgeService,
  type PreparedChunks,
  type QueryEmbedding,
} from './knowledge-service.js';
import { EmbeddingProviderError, type EmbeddingFailureKind } from './provider/embedding-error.js';
import type { LlmUsage } from './provider/llm-provider.js';
import type { TenantRunner } from './conversation/turn.js';

const COPILOT_KIND = 'copilot';
/**
 * The copilot assist-run skill uses `workspace` — the `skills_kind_check`
 * constraint permits `ai_agent` and `workspace` only, and `workspace` is the
 * kind the Reports "assisted" split already treats as a non-AI-agent run.
 */
const COPILOT_SKILL_KIND = 'workspace';

/**
 * The `/copilot/knowledge` view (ADR §2.7, deprecated): the sources for agents
 * only, by exact audience, and none a KB article manages.
 */
const AGENTS_ONLY = {
  audiences: { equals: ['copilot'] },
  kbArticleId: null,
} satisfies Prisma.KnowledgeSourceWhereInput;

export interface CopilotSourceView {
  id: string;
  name: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
  updated_at: string;
}

export interface CopilotDraft {
  draft: string;
  sources: Array<{ name: string; score: number }>;
}

/**
 * The chat's messages as plain turns, oldest first, for summary/draft input.
 * A function of its own because two readers need only this — the summary
 * route and the MCP `summarize_chat` tool — and neither has any business
 * holding a knowledge service to get it.
 */
export async function readConversationTurns(
  tx: TenantClient,
  chatId: string,
): Promise<ConversationTurn[]> {
  const rows = await tx.event.findMany({
    where: { chatId, type: 'message', text: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { text: true, authorType: true, recipients: true },
  });
  return (
    rows
      // An internal note is agent-to-agent chatter, not part of the customer
      // conversation Copilot is summarising.
      .filter((row) => row.recipients !== 'agents' && row.text)
      .map((row) => ({
        role: row.authorType === 'customer' ? ('customer' as const) : ('agent' as const),
        text: row.text!,
      }))
  );
}

export class CopilotService {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** The copilot agent, creating it on first use so an assist never 500s on setup order. */
  async ensureAgentId(tx: TenantClient, tenant: TenantContext): Promise<string> {
    return ensureCopilotAgentId(tx, tenant.licenseId);
  }

  /**
   * The copilot "skill" that owns assist runs. It exists only to satisfy the
   * `skill_runs.skill_id` foreign key, so it uses the `workspace` kind the split
   * already recognises for non-AI-agent runs (07.3.2) rather than a new one. It
   * is identified by hanging off the copilot agent — a scope nothing else writes
   * to — and the Playbook list filters to `ai_agent`, so an admin never sees it.
   */
  private async ensureSkillId(tx: TenantClient, tenant: TenantContext): Promise<string> {
    const agentId = await this.ensureAgentId(tx, tenant);
    const existing = await tx.skill.findFirst({
      where: { aiAgentId: agentId, kind: COPILOT_SKILL_KIND },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;

    const created = await tx.skill.create({
      data: {
        licenseId: tenant.licenseId,
        aiAgentId: agentId,
        name: 'Copilot',
        kind: COPILOT_SKILL_KIND,
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Record that Copilot assisted this chat. Feeds the Reports "assisted" split
   * (07.3.2), which keys off the existence of a `skill_run` for the chat — so
   * this is the one line that makes 12.1's "feeds the Assisted metric" true.
   *
   * `usage` is what a model call cost, when the assist made one (the summary,
   * tm 257.5) — written on the run on the AI Agent answer's terms, so a
   * per-workspace count of model tokens can include Copilot's.
   */
  async recordAssist(
    tx: TenantClient,
    tenant: TenantContext,
    chatId: string,
    action: string,
    detail: string,
    usage?: LlmUsage,
  ): Promise<void> {
    const skillId = await this.ensureSkillId(tx, tenant);
    await tx.skillRun.create({
      data: {
        skillId,
        chatId,
        licenseId: tenant.licenseId,
        status: 'succeeded',
        // The detail may quote the conversation; masked like every AI record (AI-26).
        log: {
          outcome: `copilot_${action}`,
          entries: [{ step: action, detail: maskForWrite(detail, 'agent').text, ok: true }],
        },
        ...(usage
          ? { llmInputTokens: usage.inputTokens, llmOutputTokens: usage.outputTokens }
          : {}),
      },
    });
    await tx.skill.update({ where: { id: skillId }, data: { runsCount: { increment: 1 } } });
  }

  // --- Knowledge (12.2) ------------------------------------------------------

  /**
   * The sources for agents only (`audiences = {copilot}`, exactly — ADR §3
   * detail 1), the ones added for them: the same rows this view listed while
   * they were filed under the Copilot record, before and after the store
   * became one. A KB article's source is the article's to manage, not this
   * view's (AI-14-S2), so it is not listed here.
   */
  async listSources(tx: TenantClient): Promise<CopilotSourceView[]> {
    const sources = await tx.knowledgeSource.findMany({
      where: AGENTS_ONLY,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
    return sources.map(serialiseSource);
  }

  /**
   * `prepared` is `content` already chunked and embedded
   * (`KnowledgeService.prepare`), by the caller, before this transaction.
   */
  async createSource(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    input: {
      type: string;
      name: string;
      content: string;
      sourceUrl: string | null;
      prepared: PreparedChunks;
    },
  ): Promise<CopilotSourceView> {
    // For agents only (`audiences = {copilot}`), filed under the Copilot
    // record: what this route has always kept away from players.
    const source = await createKnowledgeSourceDraft(
      tx,
      { audiences: ['copilot'], aiAgentIds: [] },
      {
        licenseId: tenant.licenseId,
        type: input.type,
        name: input.name,
        content: input.content,
        sourceUrl: input.sourceUrl,
        status: 'indexing',
        addedBy: principal.kind === 'agent' ? principal.accountId : null,
      },
    );

    // Indexed in the same transaction: a source that exists but is not
    // searchable looks ready and answers nothing.
    const chunks = await this.knowledge.index(tx, tenant, source.id, input.prepared);
    return {
      ...serialiseSource({ ...source, _count: { chunks } }),
      status: chunks > 0 ? 'ready' : 'empty',
    };
  }

  /**
   * Delete a source for agents only. Any other source of the store is not
   * this view's — an AI-agent (customer-facing) source, a KB article's — so
   * this route can never remove one, even given its id (ADR §2.7).
   */
  async deleteSource(tx: TenantClient, sourceId: string): Promise<number> {
    return deleteKnowledgeSourceDraft(tx, sourceId, AGENTS_ONLY);
  }

  // --- Assist (12.3) ---------------------------------------------------------

  /** The chat's messages as plain turns, oldest first — {@link readConversationTurns}. */
  async conversationTurns(tx: TenantClient, chatId: string): Promise<ConversationTurn[]> {
    return readConversationTurns(tx, chatId);
  }

  /**
   * A suggested reply, retrieved from the knowledge store using the customer's
   * latest message as the query — every source Copilot may use (tm 309.2):
   * the AI agent's and those for agents only, for the conversation's brand or
   * every brand; a chat whose brand is not known reads the every-brand ones
   * only, so a draft for one brand's player never quotes another brand's rule
   * (ADR §2.4). Returns an empty draft when there is nothing to answer from,
   * rather than inventing one — the same honesty the customer-facing responder
   * applies (RETRIEVAL_THRESHOLD).
   *
   * Three short steps through `db` rather than one transaction, because the
   * question is embedded in between and the provider is never called with a
   * transaction open (tm 255.7). When the provider cannot embed, the draft is
   * empty and `failure` says why — the agent writes the reply, and no draft is
   * better than one from a search that did not run. The question is counted
   * against the workspace's daily AI allowance (tm 257.20); when today's cap
   * cannot take it the draft is empty and `capped` carries the refusal, so the
   * agent is told the allowance is used up rather than that nothing matched.
   */
  async draftReply(
    db: TenantRunner,
    tenant: TenantContext,
    chatId: string,
  ): Promise<CopilotDraft & { failure?: EmbeddingFailureKind; capped?: AiDailyCapError }> {
    const { brandId, turns } = await db(async (tx) => ({
      brandId:
        (await tx.chat.findUnique({ where: { id: chatId }, select: { brandId: true } }))?.brandId ??
        null,
      turns: await this.conversationTurns(tx, chatId),
    }));
    const lastCustomer = [...turns].reverse().find((turn) => turn.role === 'customer');

    if (!lastCustomer) {
      return { draft: '', sources: [] };
    }

    let question: QueryEmbedding;
    try {
      question = await this.knowledge.embedQuery(lastCustomer.text, tenant, {
        surface: 'copilot',
        chatId,
      });
    } catch (error) {
      if (error instanceof AiDailyCapError) return { draft: '', sources: [], capped: error };
      if (!(error instanceof EmbeddingProviderError)) throw error;
      return { draft: '', sources: [], failure: error.kind };
    }

    const chunks = await db((tx) =>
      this.knowledge.retrieve(tx, tenant, question, {
        reader: { audience: 'copilot', brandId },
        limit: ANSWER_RETRIEVAL_LIMIT,
      }),
    );
    if (chunks.length === 0) return { draft: '', sources: [] };

    // Stitch the retrieved passages into a first-person draft the agent edits —
    // Copilot proposes, the human decides and sends.
    const draft = chunks.map((chunk) => chunk.text).join(' ');
    return {
      draft,
      sources: chunks.map((chunk) => ({ name: chunk.sourceName, score: chunk.score })),
    };
  }

  // --- BI command (12.4) -----------------------------------------------------

  /**
   * Answer a report question about this license's own activity.
   *
   * Thin by design, and the thinness *is* the feature (ADR-09). Three steps,
   * none of which is arithmetic: match the question to a known Overview field
   * (`resolveBiQuestion`, deterministic — no LLM, no clock), turn the window it
   * named into dates, and read the figure out of the very same
   * {@link buildOverviewReport} that `GET /reports/overview` serves. There is no
   * SQL here and there must never be: a second query for "how many chats
   * closed" is a second definition of it, and the first anyone notices is
   * Copilot saying 12 while the Reports tab says 11.
   *
   * `now` is a parameter rather than a `new Date()` inside so a window is a
   * function of the request's instant and a test can stand on any calendar
   * boundary it likes.
   */
  async answerBi(
    tx: TenantClient,
    tenant: TenantContext,
    question: string,
    now: Date,
  ): Promise<BiAnswer> {
    const resolution = resolveBiQuestion(question);

    // Nothing matched, or two metrics matched equally well. Either way the
    // honest answer is that there is no answer — a 200 with `not_understood`,
    // the same way an unmatched palette query or an empty knowledge match is a
    // 200 with a negative result rather than a 4xx. No report is read: a
    // question this could not place has no window to read one over.
    if (!resolution.metric) {
      return {
        answer: NOT_UNDERSTOOD_ANSWER,
        kind: 'not_understood',
        metric: null,
        value: null,
        range: null,
      };
    }

    const { from, to } = biWindow(resolution.range, now);
    const when = resolution.range ? RANGE_LABELS[resolution.range] : DEFAULT_RANGE_LABEL;
    const metric = biMetricSource(resolution.metric);
    const phrasing = BI_PHRASING[resolution.metric];

    const overview = await buildOverviewReport(tx, tenant.licenseId, from, to);
    const value = readMetric(overview, metric);

    // Null is "nobody rated anything in this window", not zero — reporting a 0%
    // satisfaction score for an unrated period would read as a catastrophe that
    // never happened. The window is still named out loud, in prose, because the
    // contract sends `range` only alongside a `value`.
    if (value === null) {
      return {
        answer: `No data for ${phrasing.subject} ${when}.`,
        kind: 'no_data',
        metric,
        value: null,
        range: null,
      };
    }

    return {
      answer: phrasing.describe(value, when),
      kind: 'metric',
      metric,
      value,
      range: { from: from.toISOString(), to: to.toISOString() },
    };
  }
}

// ===========================================================================
// BI command helpers (12.4)
// ===========================================================================

export interface BiAnswer {
  answer: string;
  /**
   * `metric` — a figure was found and `answer` quotes it. `no_data` — the
   * metric was understood but the window has nothing to report. Anything else
   * about the question is `not_understood`; Copilot never guesses a figure.
   */
  kind: 'metric' | 'no_data' | 'not_understood';
  /** The Overview field `answer` quotes, e.g. `totals.chats`. Null when not understood. */
  metric: string | null;
  value: number | null;
  range: { from: string; to: string } | null;
}

const DAY_MS = 86_400_000;

/**
 * The dates a spoken window covers, as of `now`.
 *
 * The calendar boundaries come from `scheduled-report-period.ts` rather than
 * being re-derived here, so "last week" means the same Monday-to-Sunday UTC week
 * a weekly scheduled export covers. Every window is closed at both ends, the
 * interval shape every report aggregation uses (`created_at >= from AND <= to`):
 * a completed period ends on its last millisecond, and a period still running
 * ends *now* — reporting "today" up to midnight would quote a window that has
 * not happened yet.
 *
 * A question that named no window (`null`) falls back to the report default —
 * {@link resolveRange}'s 30 days, the span the Reports tab opens on — through
 * that same function, so the two cannot drift apart. The answer says which
 * window it used either way, so a default is never silently applied.
 */
export function biWindow(range: RelativeRange | null, now: Date): { from: Date; to: Date } {
  switch (range) {
    case 'today':
      return { from: startOfUtcDay(now), to: now };
    case 'yesterday': {
      const startOfToday = startOfUtcDay(now);
      return {
        from: new Date(startOfToday.getTime() - DAY_MS),
        to: lastInstantBefore(startOfToday),
      };
    }
    case 'this_week':
      return { from: startOfIsoWeek(now), to: now };
    case 'last_week': {
      const thisMonday = startOfIsoWeek(now);
      return {
        from: new Date(thisMonday.getTime() - 7 * DAY_MS),
        to: lastInstantBefore(thisMonday),
      };
    }
    case 'this_month':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
    case 'last_7_days':
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
    case 'last_30_days':
    case null:
      // Both go through the report's own default so "the last 30 days" is one
      // definition, shared with every `GET /reports/*` that was given no range.
      return resolveRange({ to: now });
    default: {
      const unknown: never = range;
      throw new RangeError(`unknown BI window: ${String(unknown)}`);
    }
  }
}

/** How each window reads inside a sentence — an adverbial, so it needs no preposition. */
const RANGE_LABELS: Record<RelativeRange, string> = {
  today: 'today',
  yesterday: 'yesterday',
  this_week: 'this week',
  last_week: 'last week',
  this_month: 'this month',
  last_7_days: 'in the last 7 days',
  last_30_days: 'in the last 30 days',
};

/** Named out loud when the question specified no window — see {@link biWindow}. */
const DEFAULT_RANGE_LABEL = RANGE_LABELS.last_30_days;

interface BiPhrasing {
  /** What the figure counts, for the "no data" sentence. */
  subject: string;
  describe: (value: number, when: string) => string;
}

const plural = (value: number): string => (value === 1 ? '' : 's');
const wasWere = (value: number): string => (value === 1 ? 'was' : 'were');

/**
 * One phrasing per metric. Prose only — every number in it came from the
 * Overview report, and nothing here recomputes or rounds one.
 */
const BI_PHRASING: Record<MetricKey, BiPhrasing> = {
  chats: {
    subject: 'chats started',
    describe: (value, when) => `${String(value)} chat${plural(value)} started ${when}.`,
  },
  closed: {
    subject: 'chats closed',
    describe: (value, when) => `${String(value)} chat${plural(value)} closed ${when}.`,
  },
  manual: {
    subject: 'chats resolved by an agent',
    describe: (value, when) =>
      `${String(value)} chat${plural(value)} ${wasWere(value)} resolved by an agent ${when}.`,
  },
  assisted: {
    subject: 'AI-assisted resolutions',
    describe: (value, when) =>
      `${String(value)} chat${plural(value)} ${wasWere(value)} resolved with AI assistance ${when}.`,
  },
  automated: {
    subject: 'automated resolutions',
    describe: (value, when) =>
      `${String(value)} chat${plural(value)} ${wasWere(value)} resolved automatically ${when}.`,
  },
  csat: {
    subject: 'customer satisfaction',
    describe: (value, when) => `Customer satisfaction is ${String(value)}% ${when}.`,
  },
};

/**
 * What Copilot says when it cannot place a question. It names what it *can*
 * answer rather than apologising — the same shape the palette's unmatched query
 * uses — because a dead end that teaches the next question is not a dead end.
 */
const NOT_UNDERSTOOD_ANSWER =
  "I couldn't match that to a report figure I can answer from. Try asking about chats started, " +
  'chats closed, resolutions (manual, AI-assisted or automated), or customer satisfaction — ' +
  "optionally for a window like 'yesterday', 'this week' or 'the last 30 days'.";

/**
 * Read one dotted path out of an Overview report body.
 *
 * `null` is a real answer ("nobody rated anything"), so it is returned as such
 * and becomes `no_data`. A path that resolves to *nothing* is a different thing
 * entirely — a metric pointing at a field the report no longer has — and it
 * throws rather than degrading into a plausible "no data yet", which would hide
 * the defect for as long as anyone kept asking. Unreachable: every
 * `BI_METRICS.metricSource` is pinned against a real Overview body in
 * `copilot-bi.test.ts`.
 */
function readMetric(report: Record<string, unknown>, path: string): number | null {
  let cursor: unknown = report;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) {
      cursor = undefined;
      break;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (cursor === null) return null;
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return cursor;
  /* istanbul ignore next -- pinned by copilot-bi.test.ts; a live hit means a report field moved. */
  throw new Error(`BI metric \`${path}\` is not a field of the Overview report.`);
}

function serialiseSource(source: {
  id: string;
  name: string;
  type: string;
  status: string;
  sourceUrl: string | null;
  updatedAt: Date;
  _count: { chunks: number };
}): CopilotSourceView {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    source_url: source.sourceUrl,
    chunk_count: source._count.chunks,
    updated_at: source.updatedAt.toISOString(),
  };
}

export { COPILOT_KIND };
