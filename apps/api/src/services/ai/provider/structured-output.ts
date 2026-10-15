/**
 * A model call that answers with a JSON object, and the gate that object
 * passes before anyone uses it (tm 283.1 · ADR
 * `docs/adr/pilot-llm-embedding-provider.md` §6a.2–§6a.4).
 *
 * `completeStructured(llm, request)` sends `request` — its `responseFormat`
 * names the schema — and returns the parsed, validated object. It sits above
 * the provider, not inside it, so every provider passes the same gate: the
 * mock's deterministic object, a model that honoured `strict`, a model on the
 * plain-JSON fallback that only read the schema in its prompt, and a test's
 * injected provider that returns anything at all (§6a.2: "`strict` does not
 * replace server-side validation"; §6a.6).
 *
 * **Invalid** (§6a.4.2) is any of: text that is not JSON, an object the schema
 * rejects, a refusal, a reply cut off at the output limit — the last two reach
 * here as the adapter's `no_answer` failure. An invalid reply gets **one**
 * more try, with the problem named in the system prompt (§6a.4.3); that try is
 * a second `complete()`, so a metered caller (`MeteredLlm.for(tenant)`)
 * reserves and settles it on the same daily counter as the first. It is
 * separate from the adapter's transport retries and shares the call's
 * deadline: the second try gets what is left of `timeoutMs`, and none when
 * less than {@link STRUCTURED_MIN_RETRY_MS} is.
 *
 * **Still invalid** is an `LlmProviderError('no_answer')` — the failure every
 * conversation-path caller already turns into "a human answers" (§6a.4.4,
 * AI-09 `ai_failure`). Its `reason` says which check failed (`not_json`,
 * `schema`, or the adapter's own `refusal` / `length` / …) and its `usage` is
 * what both tries cost. A background caller (cluster titles, QA, conflict
 * checks) catches it and runs its own fallback.
 *
 * Neither the reply nor the value ever goes into an error, a log line or the
 * retry prompt: the problem is described by path and rule only
 * (`validateJson`), because the reply is the model's text and can quote the
 * customer.
 */
import { assertStrictJsonSchema, validateJson } from './json-schema.js';
import { LlmProviderError } from './llm-error.js';
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmResponseFormat,
  LlmUsage,
} from './llm-provider.js';

/** A request that asks for structured output. */
export type LlmStructuredRequest = LlmCompletionRequest & { responseFormat: LlmResponseFormat };

export interface LlmStructuredCompletion<T> {
  /** The reply, parsed and checked against the schema. A candidate, not a decision (§6a.2). */
  value: T;
  /** What both tries cost together — what the run records. */
  usage: LlmUsage;
  /** 1, or 2 when the first reply was invalid. */
  tries: 1 | 2;
}

/**
 * Below this, the second try is not started: a completion cannot be written in
 * less, and it would be billed for what the model produced before the abort.
 * The adapter's own floor per transport attempt (`LLM_MIN_ATTEMPT_MS`).
 */
export const STRUCTURED_MIN_RETRY_MS = 1_000;

type Read<T> =
  | { ok: true; value: T; usage: LlmUsage }
  | { ok: false; reason: string; note: string; usage: LlmUsage | null };

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0 };

function add(a: LlmUsage, b: LlmUsage | null): LlmUsage {
  return b
    ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens }
    : a;
}

/**
 * The JSON inside `text`. A model on the plain-JSON path (§6a.4.1) sometimes
 * fences its answer as a Markdown code block; one surrounding fence is taken
 * off. Nothing else is repaired — a reply that needs more was not an answer.
 */
export function parseStructuredText(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The sentence the second try's system prompt ends with. */
export function structuredRetryNote(problem: string): string {
  return `Your previous reply could not be used (${problem}). Reply with exactly one JSON object that matches the required schema, and nothing else.`;
}

export async function completeStructured<T = unknown>(
  llm: Pick<LlmProvider, 'complete'>,
  request: LlmStructuredRequest,
  now: () => number = Date.now,
): Promise<LlmStructuredCompletion<T>> {
  const { name, schema } = request.responseFormat;
  assertStrictJsonSchema(name, schema);
  const started = now();

  const first = await tryOnce<T>(llm, request);
  if (first.ok) return { value: first.value, usage: first.usage, tries: 1 };

  const left = request.timeoutMs - (now() - started);
  if (left < STRUCTURED_MIN_RETRY_MS) {
    throw new LlmProviderError('no_answer', { reason: first.reason, usage: first.usage });
  }

  const second = await tryOnce<T>(llm, {
    ...request,
    system: `${request.system}\n\n${structuredRetryNote(first.note)}`,
    timeoutMs: left,
  });
  const usage = add(first.usage ?? ZERO, second.usage);
  if (second.ok) return { value: second.value, usage, tries: 2 };
  throw new LlmProviderError('no_answer', { reason: second.reason, usage });
}

async function tryOnce<T>(
  llm: Pick<LlmProvider, 'complete'>,
  request: LlmStructuredRequest,
): Promise<Read<T>> {
  let text: string;
  let usage: LlmUsage;
  try {
    ({ text, usage } = await llm.complete(request));
  } catch (error) {
    // A refusal, a cut-off or an empty reply is an invalid answer and gets the
    // one retry; every other failure (timeout, 5xx, open circuit, cap) is the
    // caller's to handle as it already does.
    if (error instanceof LlmProviderError && error.kind === 'no_answer') {
      const reason = error.reason ?? 'no_answer';
      return { ok: false, reason, note: NOTES[reason] ?? 'it held no answer', usage: error.usage };
    }
    throw error;
  }

  const parsed = parseStructuredText(text);
  if (!parsed.ok) return { ok: false, reason: 'not_json', note: 'it was not valid JSON', usage };
  const problem = validateJson(parsed.value, request.responseFormat.schema);
  if (problem) return { ok: false, reason: 'schema', note: problem, usage };
  return { ok: true, value: parsed.value as T, usage };
}

const NOTES: Readonly<Record<string, string>> = {
  refusal: 'it was a refusal',
  length: 'it was cut off at the output limit; keep it shorter',
  empty: 'it was empty',
};
