/**
 * `llm:smoke` (tm 481): the three calls, the three exit codes, and that nothing
 * secret reaches stdout.
 *
 * Two layers. A scripted provider drives every branch of `runLlmSmoke`
 * (all three pass, one fails, a refusal, an empty reply, a failure that
 * carries what the adapter sanitised). And `runLlmSmokeFromEnv` runs the whole
 * path — `parseEnv` → `createLlmProvider` → the real DeepSeek adapter — against
 * a fake `chat/completions` API on 127.0.0.1: no request leaves the machine,
 * and `KEY` is a label, not a credential, which every output is searched for.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chatCompletion,
  chatError,
  startFakeChatCompletions,
  type FakeChatCompletions,
} from '../../../../test/helpers/fake-chat-completions.js';
import { LlmProviderError } from './llm-error.js';
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from './llm-provider.js';
import {
  runLlmSmoke,
  runLlmSmokeFromEnv,
  secretRedactor,
  SMOKE_EXIT,
  type SmokeTarget,
} from './llm-smoke.js';

const KEY = 'sk-smoke-test-only-not-a-credential-Zr4Kp9';
const USAGE = { inputTokens: 41, outputTokens: 9 };
const ANSWER_TEXT = 'Ankara, Türkiye’nin başkentidir.';

type Script = (request: LlmCompletionRequest, call: number) => LlmCompletion | Error;

function scripted(script: Script): LlmProvider & { requests: LlmCompletionRequest[] } {
  const requests: LlmCompletionRequest[] = [];
  return {
    id: 'openai',
    requests,
    async complete(request) {
      requests.push(request);
      const outcome = script(request, requests.length);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

/** A well-behaved model: prose for a plain call, a matching object for a structured one. */
const WELL_BEHAVED: Script = (request) => ({
  text: request.responseFormat
    ? JSON.stringify({ city: 'İzmir', country: 'Türkiye' })
    : ANSWER_TEXT,
  usage: USAGE,
});

function target(llm: LlmProvider, fastModel: string | null = 'model-fast'): SmokeTarget {
  return {
    llm,
    model: 'model-default',
    fastModel,
    limits: { maxOutputTokens: 400, timeoutMs: 20_000 },
  };
}

async function run(
  llm: LlmProvider,
  fastModel?: string | null,
): Promise<{ lines: string[]; json: Array<Record<string, unknown>>; exitCode: number }> {
  const lines: string[] = [];
  let clock = 0;
  const result = await runLlmSmoke(target(llm, fastModel), {
    out: (line) => lines.push(line),
    now: () => (clock += 125),
  });
  const json = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  return { lines, json, exitCode: result.exitCode };
}

describe('runLlmSmoke', () => {
  it('makes three calls — text, structured, fast — and exits 0 when all pass', async () => {
    const llm = scripted(WELL_BEHAVED);
    const { lines, json, exitCode } = await run(llm);

    expect(exitCode).toBe(SMOKE_EXIT.passed);
    expect(llm.requests).toHaveLength(3);
    expect(json.map((l) => l.check)).toEqual(['text', 'structured', 'fast']);
    expect(json.every((l) => l.ok === true && l.state === 'answered')).toBe(true);
    expect(llm.requests.map((r) => r.tier)).toEqual(['default', 'default', 'fast']);
    expect(llm.requests[1]!.responseFormat?.name).toBe('smoke_city');
    expect(llm.requests[0]!.responseFormat).toBeUndefined();
    expect(llm.requests[0]!.maxOutputTokens).toBe(400);
    expect(lines.at(-1)).toBe('llm:smoke PASSED 3/3 (openai, model-default)');
  });

  it('reports provider, model per tier, time, tokens and the reply length', async () => {
    const { json } = await run(scripted(WELL_BEHAVED));
    expect(json[0]).toMatchObject({
      provider: 'openai',
      model: 'model-default',
      tier: 'default',
      ms: 125,
      inputTokens: 41,
      outputTokens: 9,
      chars: ANSWER_TEXT.length,
    });
    expect(json[1]).toMatchObject({ detail: { tries: 1 } });
    expect(json[2]).toMatchObject({ tier: 'fast', model: 'model-fast' });
  });

  it('names the default model for the fast call when LLM_MODEL_FAST is unset', async () => {
    const { json } = await run(scripted(WELL_BEHAVED), null);
    expect(json[2]).toMatchObject({ tier: 'fast', model: 'model-default' });
  });

  it('exits 1 when one call fails and still runs the others', async () => {
    const llm = scripted((request, call) =>
      call === 1
        ? new LlmProviderError('auth', { status: 401, code: 'invalid_api_key', requestId: 'req-1' })
        : WELL_BEHAVED(request, call),
    );
    const { lines, json, exitCode } = await run(llm);

    expect(exitCode).toBe(SMOKE_EXIT.failed);
    expect(llm.requests).toHaveLength(3);
    expect(json.map((l) => l.ok)).toEqual([false, true, true]);
    expect(json[0]).toMatchObject({
      state: 'auth',
      chars: null,
      detail: { status: 401, code: 'invalid_api_key', requestId: 'req-1' },
    });
    expect(lines.at(-1)).toBe('llm:smoke FAILED 2/3 (openai, model-default)');
  });

  it('reports a refusal and a cut-off as no_answer with their reason, and the tokens they cost', async () => {
    const llm = scripted((request, call) => {
      if (call === 1) return new LlmProviderError('no_answer', { reason: 'refusal', usage: USAGE });
      if (call === 3)
        return new LlmProviderError('no_answer', {
          reason: 'length',
          usage: { inputTokens: 30, outputTokens: 400 },
          hint: 'the output limit ran out before any text; raise LLM_MAX_OUTPUT_TOKENS',
        });
      return WELL_BEHAVED(request, call);
    });
    const { json, exitCode } = await run(llm);

    expect(exitCode).toBe(1);
    expect(json[0]).toMatchObject({ ok: false, state: 'no_answer:refusal', inputTokens: 41 });
    expect(json[2]).toMatchObject({
      ok: false,
      state: 'no_answer:length',
      outputTokens: 400,
      detail: { hint: expect.stringContaining('LLM_MAX_OUTPUT_TOKENS') },
    });
  });

  it('counts an empty reply as a failure', async () => {
    const { json, exitCode } = await run(scripted(() => ({ text: '  \n', usage: USAGE })));
    expect(exitCode).toBe(1);
    expect(json[0]).toMatchObject({ ok: false, state: 'no_answer:empty' });
  });

  it('fails the structured call on a reply outside the schema, after the one retry', async () => {
    const llm = scripted((request, call) =>
      request.responseFormat
        ? { text: '{"city":"İzmir"}', usage: USAGE }
        : WELL_BEHAVED(request, call),
    );
    const { json, exitCode } = await run(llm);

    expect(exitCode).toBe(1);
    expect(llm.requests.filter((r) => r.responseFormat)).toHaveLength(2);
    expect(json[1]).toMatchObject({ check: 'structured', ok: false, state: 'no_answer:schema' });
  });

  it('passes the structured call on its second try and says so', async () => {
    let structuredCalls = 0;
    const llm = scripted((request, call) => {
      if (!request.responseFormat) return WELL_BEHAVED(request, call);
      structuredCalls += 1;
      return structuredCalls === 1
        ? { text: 'not json', usage: USAGE }
        : { text: '{"city":"İzmir","country":"Türkiye"}', usage: USAGE };
    });
    const { json, exitCode } = await run(llm);

    expect(exitCode).toBe(0);
    expect(json[1]).toMatchObject({ ok: true, detail: { tries: 2 }, inputTokens: 82 });
  });

  it('prints only the class name of a failure that is not the adapter’s', async () => {
    const llm = scripted((request, call) =>
      call === 1 ? new TypeError(`boom with ${KEY}`) : WELL_BEHAVED(request, call),
    );
    const { lines, json } = await run(llm);
    expect(json[0]).toMatchObject({ ok: false, state: 'unexpected:TypeError' });
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('never prints a prompt or a reply, only the reply length', async () => {
    const llm = scripted(WELL_BEHAVED);
    const { lines } = await run(llm);
    const out = lines.join('\n');
    for (const request of llm.requests) {
      expect(out).not.toContain(request.system);
      for (const message of request.messages) expect(out).not.toContain(message.content);
    }
    expect(out).not.toContain(ANSWER_TEXT);
    expect(out).not.toContain('İzmir');
  });
});

describe('secretRedactor', () => {
  it('replaces the value of secret-looking variables, longest first, and nothing else', () => {
    const redact = secretRedactor({
      LLM_API_KEY: KEY,
      EMBEDDING_API_KEY: `${KEY}-longer`,
      JWT_SIGNING_KEY: 'short',
      LLM_MODEL: 'model-default-name',
      DB_PASSWORD: 'a-database-password',
    });
    expect(redact(`x ${KEY}-longer y ${KEY} z a-database-password`)).toBe(
      'x [redacted] y [redacted] z [redacted]',
    );
    expect(redact('model-default-name short')).toBe('model-default-name short');
  });
});

describe('runLlmSmokeFromEnv', () => {
  let fake: FakeChatCompletions;
  beforeAll(async () => {
    fake = await startFakeChatCompletions();
  });
  afterAll(async () => {
    await fake.close();
  });
  afterEach(() => {
    fake.requests.length = 0;
  });

  const BASE: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://siyahtus:siyahtus@127.0.0.1:5432/siyahtus',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
    WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
    CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
    UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
    AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
  };

  async function runEnv(
    overrides: NodeJS.ProcessEnv,
  ): Promise<{ code: number; stdout: string; lines: string[] }> {
    const lines: string[] = [];
    const code = await runLlmSmokeFromEnv(
      { ...BASE, ...overrides },
      { write: (line) => lines.push(line), now: () => 0 },
    );
    return { code, stdout: lines.join('\n'), lines };
  }

  const DEEPSEEK = (): NodeJS.ProcessEnv => ({
    LLM_PROVIDER: 'deepseek',
    LLM_MODEL: 'deepseek-test-model',
    LLM_MODEL_FAST: 'deepseek-test-fast',
    LLM_API_KEY: KEY,
    LLM_API_BASE_URL: fake.url,
  });

  it('runs the three calls through the real adapter and exits 0; the key is in no line', async () => {
    fake.reply(
      chatCompletion('Ankara.'),
      chatCompletion('{"city":"İzmir","country":"Türkiye"}'),
      chatCompletion('Ankara.'),
    );
    const { code, stdout, lines } = await runEnv(DEEPSEEK());

    expect(code).toBe(0);
    expect(fake.requests).toHaveLength(3);
    // The vendor was sent the key (that is the point) and the model of each tier …
    expect(fake.requests.every((r) => r.headers.authorization === `Bearer ${KEY}`)).toBe(true);
    expect(fake.requests.map((r) => r.body.model)).toEqual([
      'deepseek-test-model',
      'deepseek-test-model',
      'deepseek-test-fast',
    ]);
    // … and the output never carries it.
    expect(stdout).not.toContain(KEY);
    expect(stdout).not.toContain('sk-smoke');
    expect(lines.filter((l) => l.startsWith('{'))).toHaveLength(3);
    expect(lines.at(-1)).toBe('llm:smoke PASSED 3/3 (deepseek, deepseek-test-model)');
  });

  it('exits 1 on a vendor error whose message quotes the key, and the key is still absent', async () => {
    fake.reply(
      chatError(401, {
        type: 'authentication_error',
        message: `Incorrect API key provided: ${KEY}`,
      }),
    );
    const { code, stdout } = await runEnv(DEEPSEEK());

    expect(code).toBe(1);
    expect(stdout).toContain('"state":"auth"');
    expect(stdout).toContain('"status":401');
    expect(stdout).not.toContain(KEY);
    expect(stdout).toContain('llm:smoke FAILED 0/3');
  });

  it('exits 2 and sends nothing when LLM_PROVIDER is mock', async () => {
    const { code, stdout } = await runEnv({ LLM_PROVIDER: 'mock' });
    expect(code).toBe(2);
    expect(stdout).toContain('NOT CONFIGURED');
    expect(stdout).toContain('LLM_PROVIDER is mock');
    expect(fake.requests).toHaveLength(0);
  });

  it('exits 2 and names the missing variables when the key is missing', async () => {
    const { code, stdout } = await runEnv({ ...DEEPSEEK(), LLM_API_KEY: undefined });
    expect(code).toBe(2);
    expect(stdout).toContain('LLM_MODEL and LLM_API_KEY');
    expect(fake.requests).toHaveLength(0);
  });

  it('exits 2 on an invalid environment, and a secret that the message quotes is redacted', async () => {
    // zod quotes a rejected enum value; here the "region" is the key itself.
    const { code, stdout } = await runEnv({ ...DEEPSEEK(), LLM_PROVIDER_REGION: KEY });
    expect(code).toBe(2);
    expect(stdout).toContain('LLM_PROVIDER_REGION');
    expect(stdout).not.toContain(KEY);
    expect(fake.requests).toHaveLength(0);
  });
});
