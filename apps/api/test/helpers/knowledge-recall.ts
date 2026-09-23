/**
 * The retrieval recall gate's harness (tm 255.8 · PLAN §D183): the golden set,
 * the gate's numbers, and the scoring both of its callers share —
 * `knowledge-recall-gate.test.ts` (the fake provider, every CI run) and
 * `scripts/measure-knowledge-recall.ts` (a real provider, by hand).
 *
 * The questions are asked the way the skill engine asks them: embedded first,
 * outside any transaction, then `KnowledgeService.search` as `nexa_app` with
 * RLS on, scoped to one agent, with the limit the product passes. Nothing here
 * ranks chunks itself — a gate that re-implemented the search could agree with
 * a broken one. The one exception is {@link calibrate}, which reads a ranking
 * the service returned and only moves the cut-off along it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import {
  ANSWER_RETRIEVAL_LIMIT,
  type KnowledgeService,
  type QueryEmbedding,
  type RetrievedChunk,
} from '../../src/services/ai/knowledge-service.js';

export const GOLDEN_SET_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/knowledge-recall-golden.json',
);

/**
 * The gate. Each number is a measurement, not a wish — PLAN §D183 has the run.
 */
export const RECALL_GATE = {
  /**
   * recall@k at the k the product asks for — the constant itself, not a copy.
   * The skill engine searches with `Math.max(ANSWER_RETRIEVAL_LIMIT, passages)`
   * — 2 for every persona but a `long` one, and the seed's Ada is `short` —
   * and hands every hit to the model; the copilot drafts from
   * `ANSWER_RETRIEVAL_LIMIT`. A passage ranked past it is one no answer is
   * ever written from.
   */
  k: ANSWER_RETRIEVAL_LIMIT,
  /**
   * The lexical stub finds 23 of the 31 answerable questions' passages at
   * k = 2 (0.742): every question that shares a word with its passage, and none
   * of the seven written in other words. 0.74 is that, rounded down to where
   * one lost answer (22/31 = 0.710) is a red. A real model is held to the same
   * floor: switching to it may not lose an answer the stub found.
   */
  recallFloor: 0.74,
  /**
   * Unanswerable questions that still get a passage above the threshold — a
   * customer answered from an unrelated article instead of handed to a human.
   * The stub answers one of ten ("opening hours on Sunday" meets "valid for
   * one hour"); a second is a red.
   */
  maxFalseAnswers: 1,
} as const;

const agentKind = z.enum(['ai_agent', 'copilot']);
export type GoldenAgent = z.infer<typeof agentKind>;

const goldenSetSchema = z
  .object({
    version: z.literal(1),
    sources: z
      .array(
        z.object({
          id: z.string().min(1),
          agent: agentKind,
          origin: z.enum(['seed', 'help-centre']),
          name: z.string().min(1),
          passages: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
    questions: z.array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        expected: z.object({ source: z.string(), passage: z.number().int().nonnegative() }),
        wording: z.enum(['shared', 'paraphrase', 'competing']),
      }),
    ),
    unanswerable: z.array(
      z.object({ id: z.string().min(1), question: z.string().min(1), agent: agentKind }),
    ),
  })
  .superRefine((set, ctx) => {
    const ids = [...set.sources, ...set.questions, ...set.unanswerable].map((item) => item.id);
    for (const id of ids.filter((id, index) => ids.indexOf(id) !== index)) {
      ctx.addIssue({ code: 'custom', message: `duplicate id "${id}"` });
    }
    for (const q of set.questions) {
      const source = set.sources.find((s) => s.id === q.expected.source);
      if (!source) {
        ctx.addIssue({ code: 'custom', message: `${q.id}: unknown source "${q.expected.source}"` });
      } else if (q.expected.passage >= source.passages.length) {
        ctx.addIssue({
          code: 'custom',
          message: `${q.id}: ${source.id} has no passage ${q.expected.passage}`,
        });
      }
    }
  });

export type GoldenSet = z.infer<typeof goldenSetSchema>;

/** The golden set, validated — a malformed file throws rather than scoring less. */
export function loadGoldenSet(path = GOLDEN_SET_PATH): GoldenSet {
  return goldenSetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** A question with the passage that answers it resolved, and the agent it is asked of. */
export interface AnswerableQuestion {
  id: string;
  question: string;
  wording: GoldenSet['questions'][number]['wording'];
  agent: GoldenAgent;
  sourceName: string;
  passage: string;
}

export function answerableQuestions(set: GoldenSet): AnswerableQuestion[] {
  return set.questions.map((q) => {
    const source = set.sources.find((s) => s.id === q.expected.source)!;
    return {
      id: q.id,
      question: q.question,
      wording: q.wording,
      agent: source.agent,
      sourceName: source.name,
      passage: source.passages[q.expected.passage]!,
    };
  });
}

/**
 * The golden knowledge base in one workspace: an agent per kind, a source per
 * entry, each written by `KnowledgeService` itself — `prepare()` then `index()`,
 * as the route does — so the chunks are what production stores. A source's
 * passages are its paragraphs, which the chunker keeps apart.
 */
export async function seedGoldenKnowledgeBase(
  owner: PrismaClient,
  knowledge: KnowledgeService,
  tenant: TenantContext,
  set: GoldenSet,
): Promise<Record<GoldenAgent, string>> {
  const agents = {} as Record<GoldenAgent, string>;
  for (const [kind, name] of [
    ['ai_agent', 'Ada'],
    ['copilot', 'Copilot'],
  ] as const) {
    const agent = await owner.aiAgent.create({
      data: { licenseId: tenant.licenseId, kind, name },
      select: { id: true },
    });
    agents[kind] = agent.id;
  }
  for (const source of set.sources) {
    const content = source.passages.join('\n\n');
    const row = await owner.knowledgeSource.create({
      data: {
        aiAgentId: agents[source.agent],
        licenseId: tenant.licenseId,
        type: 'article',
        name: source.name,
        content,
      },
      select: { id: true },
    });
    await knowledge.index(owner as TenantClient, tenant, row.id, await knowledge.prepare(content));
  }
  return agents;
}

/** Every golden question embedded once — a real provider is billed per call. */
export async function embedGoldenQuestions(
  knowledge: KnowledgeService,
  set: GoldenSet,
): Promise<Map<string, QueryEmbedding>> {
  const embedded = new Map<string, QueryEmbedding>();
  for (const { id, question } of [...set.questions, ...set.unanswerable]) {
    embedded.set(id, await knowledge.embedQuery(question));
  }
  return embedded;
}

/** What `search()` returned for each question, keyed by question id. */
export type GoldenAnswers = Map<string, RetrievedChunk[]>;

/**
 * Ask every golden question through `knowledge.search`, as the request path
 * does. `limit` defaults to the gate's k.
 */
export async function askGoldenSet(options: {
  app: PrismaClient;
  knowledge: KnowledgeService;
  tenant: TenantContext;
  agents: Record<GoldenAgent, string>;
  set: GoldenSet;
  embedded: Map<string, QueryEmbedding>;
  limit?: number;
}): Promise<GoldenAnswers> {
  const { app, knowledge, tenant, agents, set, embedded } = options;
  const limit = options.limit ?? RECALL_GATE.k;
  const asked = [
    ...answerableQuestions(set).map((q) => ({ id: q.id, agent: q.agent })),
    ...set.unanswerable.map((q) => ({ id: q.id, agent: q.agent })),
  ];
  const answers: GoldenAnswers = new Map();
  for (const { id, agent } of asked) {
    const query = embedded.get(id);
    if (!query) throw new Error(`question ${id} was not embedded`);
    const { chunks } = await withTenant(app, tenant, (tx) =>
      knowledge.search(tx, tenant, query, { aiAgentId: agents[agent], limit }),
    );
    answers.set(id, chunks);
  }
  return answers;
}

export interface RecallMiss {
  id: string;
  question: string;
  wording: AnswerableQuestion['wording'];
  expected: string;
  /** What came back instead, best first, with scores. */
  got: string[];
}

export interface RecallReport {
  k: number;
  answerable: number;
  found: number;
  /** found / answerable, to four places. */
  recall: number;
  /** The questions whose passage was not in the top k — the gate's "below the line" list. */
  misses: RecallMiss[];
  unanswerable: number;
  /** Unanswerable questions that got a passage anyway. */
  falseAnswers: Array<{ id: string; question: string; got: string[] }>;
}

const describeHit = (hit: RetrievedChunk): string =>
  `${hit.sourceName}: "${hit.text}" (${hit.score.toFixed(4)})`;

/** A hit is the expected passage when both its source and its text are. */
function isExpected(hit: RetrievedChunk, q: AnswerableQuestion): boolean {
  return hit.sourceName === q.sourceName && hit.text === q.passage;
}

/** recall@k and the false answers, from what `search()` returned. */
export function scoreRecall(
  set: GoldenSet,
  answers: GoldenAnswers,
  k = RECALL_GATE.k,
): RecallReport {
  const questions = answerableQuestions(set);
  const misses: RecallMiss[] = [];
  for (const q of questions) {
    const hits = answers.get(q.id) ?? [];
    if (!hits.slice(0, k).some((hit) => isExpected(hit, q))) {
      misses.push({
        id: q.id,
        question: q.question,
        wording: q.wording,
        expected: `${q.sourceName}: "${q.passage}"`,
        got: hits.map(describeHit),
      });
    }
  }
  const falseAnswers = set.unanswerable
    .map((q) => ({
      id: q.id,
      question: q.question,
      got: (answers.get(q.id) ?? []).map(describeHit),
    }))
    .filter((q) => q.got.length > 0);
  const found = questions.length - misses.length;
  return {
    k,
    answerable: questions.length,
    found,
    recall: questions.length === 0 ? 0 : Number((found / questions.length).toFixed(4)),
    misses,
    unanswerable: set.unanswerable.length,
    falseAnswers,
  };
}

/** The gate's verdict on a report: every reason it is red, or none. */
export function gateFailures(report: RecallReport): string[] {
  const failures: string[] = [];
  if (report.recall < RECALL_GATE.recallFloor) {
    failures.push(
      `recall@${report.k} ${report.recall} (${report.found}/${report.answerable}) is below the floor of ${RECALL_GATE.recallFloor}`,
    );
  }
  if (report.falseAnswers.length > RECALL_GATE.maxFalseAnswers) {
    failures.push(
      `${report.falseAnswers.length} of ${report.unanswerable} unanswerable questions got a passage (at most ${RECALL_GATE.maxFalseAnswers})`,
    );
  }
  return failures;
}

/** A report as lines a person reads — the misses first, since they are the point. */
export function formatReport(report: RecallReport): string {
  const lines = [
    `recall@${report.k}: ${report.found}/${report.answerable} = ${report.recall} (floor ${RECALL_GATE.recallFloor})`,
    `false answers: ${report.falseAnswers.length}/${report.unanswerable} (at most ${RECALL_GATE.maxFalseAnswers})`,
  ];
  for (const miss of report.misses) {
    lines.push(`  miss [${miss.wording}] ${miss.id}: ${miss.question}`);
    lines.push(`       expected ${miss.expected}`);
    lines.push(
      `       got ${miss.got.length === 0 ? 'nothing above the threshold' : miss.got.join(' · ')}`,
    );
  }
  for (const answered of report.falseAnswers) {
    lines.push(`  false answer ${answered.id}: ${answered.question}`);
    lines.push(`       got ${answered.got.join(' · ')}`);
  }
  return lines.join('\n');
}

export interface CalibrationRow {
  threshold: number;
  found: number;
  recall: number;
  falseAnswers: number;
}

export interface Calibration {
  /** Each answerable question's passage: its rank (1-based, 0 = not found) and its score. */
  expected: Array<{ id: string; rank: number; score: number | null }>;
  /** Each unanswerable question's best score, or null when nothing was in scope. */
  unanswerableBest: Array<{ id: string; score: number | null }>;
  /** recall@k and false answers had the threshold been each of these. */
  sweep: CalibrationRow[];
}

/**
 * How the threshold would do at other values, from full rankings — answers
 * `search()` returned with the threshold at -1 and a limit past every chunk.
 * Search ranks by distance and then cuts at the threshold, so every cut-off is
 * a prefix of the same ranking: recall@k at `t` is "the expected passage is in
 * the top k and scores ≥ t", and a false answer at `t` is "the best score is ≥ t".
 */
export function calibrate(
  set: GoldenSet,
  rankings: GoldenAnswers,
  thresholds: readonly number[],
  k = RECALL_GATE.k,
): Calibration {
  const questions = answerableQuestions(set);
  const expected = questions.map((q) => {
    const ranking = rankings.get(q.id) ?? [];
    const index = ranking.findIndex((hit) => isExpected(hit, q));
    return { id: q.id, rank: index + 1, score: index < 0 ? null : ranking[index]!.score };
  });
  const unanswerableBest = set.unanswerable.map((q) => ({
    id: q.id,
    score: rankings.get(q.id)?.[0]?.score ?? null,
  }));
  const sweep = thresholds.map((threshold) => {
    const found = expected.filter(
      (e) => e.rank >= 1 && e.rank <= k && e.score !== null && e.score >= threshold,
    ).length;
    return {
      threshold,
      found,
      recall: questions.length === 0 ? 0 : Number((found / questions.length).toFixed(4)),
      falseAnswers: unanswerableBest.filter((u) => u.score !== null && u.score >= threshold).length,
    };
  });
  return { expected, unanswerableBest, sweep };
}
