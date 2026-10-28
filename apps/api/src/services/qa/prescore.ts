/**
 * The QA pre-score (tm 319.2 · SiyahTuş analysis AI-24 §3, AI-24-S2) — the
 * scheduler's `qa_prescore` job.
 *
 * A review the sampler (or a hand) queued as `pending_prescore` is read by the
 * `default` model — the masked excerpt, the decision trail, the review's
 * reasons and its rubric — which proposes a value per criterion with the
 * event ids it rests on. The reply is kept only when every id is one of this
 * connection's events and every value fits its criterion; one foreign id and
 * the whole pre-score is dropped. Either way the review becomes `ready`: a
 * model that fails, times out, is capped, or may not see the workspace's
 * content (NFR-C4) leaves it without a pre-score, never stuck. A workspace
 * that switched the pre-score off (`qa_settings.prescore_enabled`) gets its
 * pending reviews released as they are.
 *
 * One structured call per review, metered as `qa` on the workspace. The
 * provider has no temperature knob: the request is the same for the same
 * review, and the in-process stub (`mockQaPrescore`) is deterministic in
 * every suite. The call runs outside any transaction; the write is guarded
 * by the status, so a second instance's pass never overwrites a review the
 * first one released.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { QA_PRESCORE_BATCH, type QaPrescore } from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { AiDailyCapError } from '../ai/ai-daily-budget.js';
import {
  inferenceAllowed,
  readInferenceResidency,
  type InferenceProvider,
} from '../ai/inference.js';
import { MeteredLlm } from '../ai/metered-llm.js';
import { refuseOverlongPrompt, type LlmProvider } from '../ai/provider/llm-provider.js';
import { completeStructured } from '../ai/provider/structured-output.js';
import {
  buildQaPrescorePrompt,
  prescoreGrounding,
  QA_PRESCORE_MAX_OUTPUT_TOKENS,
  QA_PRESCORE_RESPONSE_FORMAT,
  readQaPrescoreReply,
  type QaPrescoreGrounding,
} from './prescore-prompt.js';
import { readExcerpt, readRubricCriteria } from './qa-service.js';
import { readQaSettings } from './sampler.js';

export interface QaPrescorerLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface QaPrescorerDeps {
  /** The server's `MeteredLlm`; a bare provider counts nothing (a unit test's). */
  readonly llm: LlmProvider | MeteredLlm;
  readonly limits: { maxOutputTokens: number; timeoutMs: number; maxPromptChars: number };
  /** Where the model runs, as the NFR-C4 gate reads it. */
  readonly inference: InferenceProvider;
  readonly logger?: QaPrescorerLogger;
}

export interface QaPrescoreReport {
  startedAt: string;
  finishedAt: string;
  totals: {
    tenants: number;
    /** Kept a pre-score. */
    scored: number;
    /** The model answered, the answer was dropped (a foreign event id, a bad value). */
    dropped: number;
    /** Released without asking: pre-score off, or the content may not go to the model. */
    skipped: number;
    /** The model failed, timed out or was capped: released without a pre-score. */
    failed: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

type Outcome = 'scored' | 'dropped' | 'skipped' | 'failed' | 'gone';

/** The trail the model reads: codes and ids only. */
async function readTrail(
  tx: TenantClient,
  threadId: string,
): Promise<QaPrescoreGrounding['trace']> {
  const [decisions, hits, handoffs, flags] = await Promise.all([
    tx.aiDecisionLog.findMany({
      where: { threadId },
      select: { procedureId: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    tx.aiGuardrailHit.findMany({
      where: { threadId },
      select: { ruleKey: true, stage: true, actionTaken: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    tx.aiHandoff.findMany({ where: { threadId }, select: { reasonCodes: true } }),
    tx.riskFlag.findMany({ where: { threadId }, select: { type: true } }),
  ]);
  return {
    procedures: [
      ...new Set(decisions.flatMap((d) => (d.procedureId === null ? [] : [d.procedureId]))),
    ],
    guardrail_hits: hits.map((h) => ({ rule: h.ruleKey, stage: h.stage, action: h.actionTaken })),
    handoff_reasons: [...new Set(handoffs.flatMap((h) => h.reasonCodes))],
    risk_flags: [...new Set(flags.map((f) => f.type))],
  };
}

export class QaPrescorer {
  readonly #db: PrismaClient;
  readonly #deps: QaPrescorerDeps;

  constructor(db: PrismaClient, deps: QaPrescorerDeps) {
    this.#db = db;
    this.#deps = deps;
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<QaPrescoreReport> {
    const startedAt = new Date().toISOString();
    const totals = { tenants: 0, scored: 0, dropped: 0, skipped: 0, failed: 0 };
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const context: TenantContext = {
        licenseId: tenant.license_id,
        organizationId: tenant.organization_id,
      };
      const pass = await withTenant(
        this.#db,
        context,
        async (tx) => {
          const pending = await tx.qaReview.findMany({
            where: { status: 'pending_prescore' },
            orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
            take: QA_PRESCORE_BATCH,
            select: { id: true },
          });
          if (pending.length === 0) return null;
          const settings = await readQaSettings(tx);
          const residency = await readInferenceResidency(tx, context);
          const mayInfer =
            residency !== null &&
            inferenceAllowed({
              provider: this.#deps.inference,
              workspaceRegion: residency.region,
              hipaaScope: residency.hipaaScope,
            });
          return { ids: pending.map((p) => p.id), ask: settings.prescoreEnabled && mayInfer };
        },
        { readOnly: true },
      );
      totals.tenants += 1;
      if (!pass) continue;
      for (const id of pass.ids) {
        if (options.signal?.aborted) break;
        const outcome = await this.prescoreOne(context, id, pass.ask);
        if (outcome !== 'gone') totals[outcome] += 1;
      }
    }
    return { startedAt, finishedAt: new Date().toISOString(), totals };
  }

  /** Pre-score one pending review of `tenant` (or release it when `ask` is false). */
  async prescoreOne(tenant: TenantContext, id: string, ask: boolean): Promise<Outcome> {
    const read = await withTenant(
      this.#db,
      tenant,
      async (tx) => {
        const row = await tx.qaReview.findFirst({
          where: { id, status: 'pending_prescore' },
          select: {
            threadId: true,
            chatId: true,
            reasons: true,
            rubricId: true,
            excerptMasked: true,
            configVersionId: true,
          },
        });
        if (!row) return null;
        if (!ask) return { row, grounding: null, own: null, criteria: [] };
        const rubric = await tx.qaRubric.findFirst({
          where: { id: row.rubricId },
          select: { criteria: true },
        });
        const excerpt = readExcerpt(row.excerptMasked);
        const events = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM events WHERE thread_id = ${row.threadId} LIMIT 5000`;
        const own = new Set([...excerpt.map((m) => m.event_id), ...events.map((e) => e.id)]);
        const criteria = readRubricCriteria(rubric?.criteria);
        const grounding = prescoreGrounding({
          reasons: row.reasons,
          rubric: criteria,
          excerpt,
          trace: await readTrail(tx, row.threadId),
        });
        return { row, grounding, own, criteria };
      },
      { readOnly: true },
    );
    if (!read) return 'gone';

    let prescore: QaPrescore | null = null;
    let outcome: Outcome = 'skipped';
    if (read.grounding && read.own) {
      const deps = this.#deps;
      const prompt = buildQaPrescorePrompt(read.grounding);
      const metered = MeteredLlm.wrap(deps.llm);
      try {
        refuseOverlongPrompt(prompt, deps.limits.maxPromptChars);
        const { value } = await completeStructured(
          metered.forTenant(tenant, {
            surface: 'qa',
            chatId: read.row.chatId,
            configVersionId: read.row.configVersionId,
          }),
          {
            ...prompt,
            maxOutputTokens: Math.min(deps.limits.maxOutputTokens, QA_PRESCORE_MAX_OUTPUT_TOKENS),
            timeoutMs: deps.limits.timeoutMs,
            tier: 'default',
            responseFormat: QA_PRESCORE_RESPONSE_FORMAT,
          },
        );
        const kept = readQaPrescoreReply(value, read.criteria, read.own, new Date());
        if ('prescore' in kept) {
          prescore = kept.prescore;
          outcome = 'scored';
        } else {
          outcome = 'dropped';
          deps.logger?.warn(
            {
              event: 'qa.prescore_dropped',
              license_id: tenant.licenseId.toString(),
              review_id: id,
              ...kept.refused,
            },
            'a QA pre-score was dropped; the review is ready without one',
          );
        }
      } catch (error) {
        outcome = 'failed';
        deps.logger?.warn(
          {
            err: error instanceof AiDailyCapError ? undefined : error,
            event: 'qa.prescore_failed',
            license_id: tenant.licenseId.toString(),
            review_id: id,
            capped: error instanceof AiDailyCapError,
          },
          'a QA review could not be pre-scored; it is ready without a pre-score',
        );
      }
    }

    const written = await withTenant(this.#db, tenant, (tx) =>
      tx.qaReview.updateMany({
        where: { id, status: 'pending_prescore' },
        data: {
          status: 'ready',
          prescore:
            prescore === null ? Prisma.DbNull : (prescore as unknown as Prisma.InputJsonObject),
          updatedAt: new Date(),
        },
      }),
    );
    return written.count === 0 ? 'gone' : outcome;
  }
}
