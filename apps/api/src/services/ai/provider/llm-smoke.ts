/**
 * The live smoke for the chat provider (tm 481 · K51) — what the owner runs
 * with their own key, once, after choosing a provider and before trusting it
 * with a customer:
 *
 *   pnpm --filter @siyahtus/api llm:smoke
 *   docker compose -f docker-compose.pilot.yml run --rm --no-deps api node dist/scripts/llm-smoke.js
 *
 * tm 479 and tm 480 were tested against fake servers only; a real key is the
 * owner's (the secret rule), so this is the one-command way to find out
 * whether the vendor accepts what the adapter sends. It builds the provider
 * from the environment exactly as the server does (`parseEnv` →
 * `createLlmProvider`) and makes three calls: a short Turkish question (plain
 * text), a small schema through `completeStructured` (the path the AI features
 * use), and the same plain question on the `fast` tier.
 *
 * **What it prints.** One JSON line per call: provider, model, tier, time,
 * input/output tokens, and the state (`answered`, or the failure kind and
 * detail). **What it never prints:** the key, the prompt, or the reply — only
 * the reply's length in characters. A failure carries the adapter's own
 * sanitised fields (kind, HTTP status, vendor error code, request id, hint),
 * never provider text. As a last line of defence every line passes through a
 * redactor that replaces the value of any secret-looking variable
 * (`*KEY`, `*SECRET`, `*TOKEN`, `*PASSWORD`), so even a message that should
 * not hold one cannot leak it.
 *
 * Exit code: 0 every call passed, 1 at least one failed, 2 not configured (the
 * environment is invalid, the provider is `mock`, or its keys are missing) —
 * nothing was sent.
 */
import { parseEnv } from '../../../config/env.js';
import type { JsonSchema } from './json-schema.js';
import { LlmProviderError } from './llm-error.js';
import {
  createLlmProvider,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmProviderId,
  type LlmTier,
} from './llm-provider.js';
import type { LlmLogger } from './chat-completions-transport.js';
import { completeStructured } from './structured-output.js';

export const SMOKE_EXIT = { passed: 0, failed: 1, notConfigured: 2 } as const;

/** The three calls, in order. */
export const SMOKE_CHECKS = ['text', 'structured', 'fast'] as const;
export type SmokeCheck = (typeof SMOKE_CHECKS)[number];

const SYSTEM = 'Sen kısa ve doğru yanıt veren bir yardımcısın. Yalnızca Türkçe yanıt ver.';
const QUESTION = "Türkiye'nin başkenti neresidir? Tek cümleyle yanıtla.";
const SCHEMA_NAME = 'smoke_city';
const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['city', 'country'],
  properties: {
    city: { type: 'string', description: 'The city asked about.' },
    country: { type: 'string', description: 'The country the city is in.' },
  },
};
const STRUCTURED_SYSTEM =
  'Sen bir sınıflandırıcısın. Kullanıcının sorduğu şehri ve bulunduğu ülkeyi JSON olarak ver.';
const STRUCTURED_QUESTION = 'İzmir hangi ülkenin şehridir?';

export interface SmokeLimits {
  /** `LLM_MAX_OUTPUT_TOKENS`: the ceiling every call is made with. */
  maxOutputTokens: number;
  /** `LLM_TIMEOUT_MS`. */
  timeoutMs: number;
}

export interface SmokeTarget {
  llm: LlmProvider;
  /** The model ids `LLM_MODEL` / `LLM_MODEL_FAST` name (not secrets); `fast` is null when unset. */
  model: string;
  fastModel: string | null;
  limits: SmokeLimits;
}

export interface SmokeIo {
  /** One line of stdout. Redaction is applied by the caller of `runLlmSmoke`. */
  out(line: string): void;
  /** Milliseconds on a monotonic clock. */
  now(): number;
}

export interface SmokeResult {
  exitCode: 0 | 1;
  passed: number;
  failed: number;
}

interface Line {
  check: SmokeCheck;
  ok: boolean;
  provider: LlmProviderId;
  model: string;
  tier: LlmTier;
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Characters in the reply — never the reply. */
  chars: number | null;
  /** `answered`, or what went wrong. */
  state: string;
  detail?: Record<string, string | number | null>;
}

/** The failure, as the fields the adapter already sanitised — never a provider's text. */
function describeFailure(error: unknown): {
  state: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  detail: Record<string, string | number | null>;
} {
  if (error instanceof LlmProviderError) {
    const state =
      error.kind === 'no_answer' && error.reason ? `no_answer:${error.reason}` : error.kind;
    return {
      state,
      usage: error.usage,
      detail: {
        status: error.status,
        code: error.code,
        requestId: error.requestId,
        reason: error.reason,
        attempts: error.attempts,
        hint: error.hint,
      },
    };
  }
  // Not an adapter failure (a schema defect, say): the class name only — a
  // message from a library can quote anything.
  return {
    state: `unexpected:${error instanceof Error ? error.name : typeof error}`,
    usage: null,
    detail: {},
  };
}

/** Make the three calls and print one line each. Never throws for a call's failure. */
export async function runLlmSmoke(target: SmokeTarget, io: SmokeIo): Promise<SmokeResult> {
  const { llm, limits } = target;
  const base = (tier: LlmTier): LlmCompletionRequest => ({
    system: SYSTEM,
    messages: [{ role: 'user', content: QUESTION }],
    maxOutputTokens: limits.maxOutputTokens,
    timeoutMs: limits.timeoutMs,
    tier,
  });

  const calls: Array<{
    check: SmokeCheck;
    tier: LlmTier;
    run: () => Promise<{
      chars: number | null;
      usage: { inputTokens: number; outputTokens: number };
      detail?: Record<string, string | number | null>;
    }>;
  }> = [
    {
      check: 'text',
      tier: 'default',
      run: async () => {
        const reply = await llm.complete(base('default'));
        if (reply.text.trim().length === 0) {
          throw new LlmProviderError('no_answer', { reason: 'empty', usage: reply.usage });
        }
        return { chars: reply.text.length, usage: reply.usage };
      },
    },
    {
      check: 'structured',
      tier: 'default',
      run: async () => {
        const reply = await completeStructured<{ city: string; country: string }>(llm, {
          system: STRUCTURED_SYSTEM,
          messages: [{ role: 'user', content: STRUCTURED_QUESTION }],
          maxOutputTokens: limits.maxOutputTokens,
          timeoutMs: limits.timeoutMs,
          tier: 'default',
          responseFormat: { name: SCHEMA_NAME, schema: SCHEMA },
        });
        return {
          chars: JSON.stringify(reply.value).length,
          usage: reply.usage,
          detail: { tries: reply.tries },
        };
      },
    },
    {
      check: 'fast',
      tier: 'fast',
      run: async () => {
        const reply = await llm.complete(base('fast'));
        if (reply.text.trim().length === 0) {
          throw new LlmProviderError('no_answer', { reason: 'empty', usage: reply.usage });
        }
        return { chars: reply.text.length, usage: reply.usage };
      },
    },
  ];

  let passed = 0;
  let failed = 0;
  for (const call of calls) {
    const model = call.tier === 'fast' ? (target.fastModel ?? target.model) : target.model;
    const started = io.now();
    let line: Line;
    try {
      const done = await call.run();
      line = {
        check: call.check,
        ok: true,
        provider: llm.id,
        model,
        tier: call.tier,
        ms: Math.round(io.now() - started),
        inputTokens: done.usage.inputTokens,
        outputTokens: done.usage.outputTokens,
        chars: done.chars,
        state: 'answered',
        ...(done.detail ? { detail: done.detail } : {}),
      };
      passed += 1;
    } catch (error) {
      const failure = describeFailure(error);
      line = {
        check: call.check,
        ok: false,
        provider: llm.id,
        model,
        tier: call.tier,
        ms: Math.round(io.now() - started),
        inputTokens: failure.usage?.inputTokens ?? null,
        outputTokens: failure.usage?.outputTokens ?? null,
        chars: null,
        state: failure.state,
        detail: failure.detail,
      };
      failed += 1;
    }
    io.out(JSON.stringify(line));
  }

  const verdict = failed === 0 ? 'PASSED' : 'FAILED';
  io.out(`llm:smoke ${verdict} ${passed}/${calls.length} (${llm.id}, ${target.model})`);
  return { exitCode: failed === 0 ? SMOKE_EXIT.passed : SMOKE_EXIT.failed, passed, failed };
}

const SECRET_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD)$/i;
const MIN_SECRET_LENGTH = 8;

/**
 * A function that replaces the value of every secret-looking variable in
 * `source` by `[redacted]`. Longest values first, so a value that holds
 * another is removed whole.
 */
export function secretRedactor(source: NodeJS.ProcessEnv): (text: string) => string {
  const secrets = Object.entries(source)
    .filter(
      (entry): entry is [string, string] =>
        SECRET_NAME.test(entry[0]) &&
        typeof entry[1] === 'string' &&
        entry[1].length >= MIN_SECRET_LENGTH,
    )
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
  return (text) => secrets.reduce((acc, secret) => acc.split(secret).join('[redacted]'), text);
}

export interface SmokeRuntime {
  /** Where the lines go (stdout in the script). */
  write(line: string): void;
  now(): number;
  fetchImpl?: typeof fetch;
}

/**
 * The whole run from an environment: validate it as the server would, build
 * the provider, run the three calls. Returns the exit code.
 */
export async function runLlmSmokeFromEnv(
  source: NodeJS.ProcessEnv,
  runtime: SmokeRuntime,
): Promise<0 | 1 | 2> {
  const redact = secretRedactor(source);
  const out = (line: string): void => runtime.write(redact(line));
  const refuse = (reason: string): 2 => {
    out(`llm:smoke NOT CONFIGURED — ${reason}`);
    return SMOKE_EXIT.notConfigured;
  };

  let env: ReturnType<typeof parseEnv>;
  try {
    env = parseEnv(source);
  } catch (error) {
    // `parseEnv` writes the variable names and the rule that failed, one per line.
    return refuse(
      error instanceof Error ? error.message.replace(/\n/g, ' ') : 'invalid environment',
    );
  }
  if (env.LLM_PROVIDER === 'mock') {
    return refuse(
      'LLM_PROVIDER is mock; there is no vendor to reach. Set LLM_PROVIDER, LLM_MODEL and LLM_API_KEY.',
    );
  }

  // Warnings and errors the adapter logs while it runs (a retry, a schema the
  // model refused): only the event names are kept, printed once at the end.
  const events = new Set<string>();
  const logger: LlmLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (details) => void (typeof details.event === 'string' && events.add(details.event)),
    error: (details) => void (typeof details.event === 'string' && events.add(details.event)),
  };

  let llm: LlmProvider;
  try {
    llm = createLlmProvider(env.LLM_PROVIDER, env.llm, {
      logger,
      ...(runtime.fetchImpl ? { fetchImpl: runtime.fetchImpl } : {}),
    });
  } catch (error) {
    // The factory's sentences name the missing variables, never a value.
    return refuse(error instanceof Error ? error.message : 'the provider could not be built');
  }

  const model = env.LLM_MODEL;
  if (!model) return refuse('LLM_MODEL is not set.');

  const result = await runLlmSmoke(
    {
      llm,
      model,
      fastModel: env.LLM_MODEL_FAST ?? null,
      limits: { maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS, timeoutMs: env.LLM_TIMEOUT_MS },
    },
    { out, now: runtime.now },
  );
  if (events.size > 0) out(`llm:smoke events: ${[...events].sort().join(', ')}`);
  return result.exitCode;
}
