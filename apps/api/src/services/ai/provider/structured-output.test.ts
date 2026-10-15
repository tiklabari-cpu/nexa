/**
 * `completeStructured` (tm 283.1 · ADR §6a.4, §6a.6): every provider's reply
 * passes one gate; an invalid reply gets one more try; a second invalid reply
 * is the provider failure the conversation path already hands to a human.
 *
 * The invalid, refused and cut-off replies come from an injected provider, as
 * §6a.6 asks — never from a real model.
 */
import { describe, expect, it } from 'vitest';
import type { JsonSchema } from './json-schema.js';
import { LlmProviderError } from './llm-error.js';
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from './llm-provider.js';
import { MockLlmProvider } from './mock-llm-provider.js';
import {
  completeStructured,
  parseStructuredText,
  structuredRetryNote,
  type LlmStructuredRequest,
} from './structured-output.js';

/** AI-08's judge (ADR §6a.1). */
const VERDICT: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rule_id: { type: 'string' }, quote: { type: 'string' } },
        required: ['rule_id', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['ok', 'violations'],
  additionalProperties: false,
};

const REQUEST: LlmStructuredRequest = {
  system: 'Judge the draft against the locked rules.',
  messages: [{ role: 'user', content: 'Draft: we refund within 3 days.' }],
  maxOutputTokens: 300,
  timeoutMs: 20_000,
  tier: 'fast',
  responseFormat: { name: 'guard_verdict', schema: VERDICT },
};

type Answer = LlmCompletion | LlmProviderError | Error;

/** Answers in order (the last repeats) and records every request it was given. */
function scripted(...answers: Answer[]) {
  const requests: LlmCompletionRequest[] = [];
  const llm: Pick<LlmProvider, 'complete'> = {
    complete: async (request) => {
      requests.push(request);
      const answer = answers[Math.min(requests.length, answers.length) - 1]!;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { llm, requests };
}

const reply = (text: string, inputTokens = 100, outputTokens = 10): LlmCompletion => ({
  text,
  usage: { inputTokens, outputTokens },
});

async function failure(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmProviderError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('completeStructured — one gate for every provider (FR-05-06.EK1)', () => {
  it('returns the parsed object of a valid reply, after one call', async () => {
    const { llm, requests } = scripted(reply('{"ok":true,"violations":[]}'));
    const result = await completeStructured<{ ok: boolean }>(llm, REQUEST);
    expect(result).toEqual({
      value: { ok: true, violations: [] },
      usage: { inputTokens: 100, outputTokens: 10 },
      tries: 1,
    });
    expect(requests).toEqual([REQUEST]);
  });

  it('takes one Markdown fence off a plain-JSON reply, and nothing else', () => {
    expect(parseStructuredText('```json\n{"ok":true}\n```')).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(parseStructuredText('Sure! {"ok":true}')).toEqual({ ok: false });
  });

  it('retries invalid JSON once, naming the problem, and sums what both tries cost', async () => {
    const { llm, requests } = scripted(
      reply('{"ok": tru', 100, 5),
      reply('{"ok":false,"violations":[{"rule_id":"r-2","quote":"3 days"}]}', 120, 20),
    );
    const result = await completeStructured(llm, REQUEST);
    expect(result.tries).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 220, outputTokens: 25 });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.system).toBe(
      `${REQUEST.system}\n\n${structuredRetryNote('it was not valid JSON')}`,
    );
    // Everything else about the second try is the first one's.
    expect({ ...requests[1], system: '', timeoutMs: 0 }).toEqual({
      ...REQUEST,
      system: '',
      timeoutMs: 0,
    });
  });

  it('retries a schema mismatch with its path and rule — never the reply', async () => {
    const { llm, requests } = scripted(
      reply('{"ok":"maybe, the customer said 4111 1111","violations":[]}'),
      reply('{"ok":true,"violations":[]}'),
    );
    await completeStructured(llm, REQUEST);
    expect(requests[1]!.system).toContain('$.ok: expected boolean');
    expect(requests[1]!.system).not.toContain('4111');
  });

  it('a second invalid reply is a provider failure (no_answer) carrying both tries’ cost', async () => {
    const { llm, requests } = scripted(reply('nope', 100, 5), reply('{"ok":true}', 100, 7));
    const error = await failure(completeStructured(llm, REQUEST));
    expect(requests).toHaveLength(2);
    expect(error.kind).toBe('no_answer');
    expect(error.reason).toBe('schema');
    expect(error.usage).toEqual({ inputTokens: 200, outputTokens: 12 });
    // Not the provider's fault: a customer can make a model answer badly, and
    // that must not open the circuit for every workspace.
    expect(error.providerFault).toBe(false);
    expect(error.message).not.toContain('nope');
  });

  it.each([
    ['refusal', 'it was a refusal'],
    ['length', 'it was cut off at the output limit; keep it shorter'],
  ])('treats a %s from the adapter as an invalid reply: one more try', async (reason, note) => {
    const usage = { inputTokens: 90, outputTokens: 30 };
    const { llm, requests } = scripted(
      new LlmProviderError('no_answer', { reason, usage }),
      reply('{"ok":true,"violations":[]}', 90, 8),
    );
    const result = await completeStructured(llm, REQUEST);
    expect(result.usage).toEqual({ inputTokens: 180, outputTokens: 38 });
    expect(requests[1]!.system).toContain(note);
  });

  it('does not retry a failure that is not about the reply — timeout, outage, circuit', async () => {
    for (const kind of ['timeout', 'unavailable', 'circuit_open'] as const) {
      const { llm, requests } = scripted(new LlmProviderError(kind));
      const error = await failure(completeStructured(llm, REQUEST));
      expect(error.kind).toBe(kind);
      expect(requests).toHaveLength(1);
    }
  });

  it('gives the second try only what is left of the deadline, and none when under a second', async () => {
    let clock = 0;
    const slow = scripted(reply('x'), reply('{"ok":true,"violations":[]}'));
    const timed: Pick<LlmProvider, 'complete'> = {
      complete: async (request) => {
        clock += 12_000;
        return slow.llm.complete(request);
      },
    };
    await completeStructured(timed, REQUEST, () => clock);
    expect(slow.requests[1]!.timeoutMs).toBe(8_000);

    clock = 0;
    const late = scripted(reply('x'));
    const lateLlm: Pick<LlmProvider, 'complete'> = {
      complete: async (request) => {
        clock += 19_500;
        return late.llm.complete(request);
      },
    };
    const error = await failure(completeStructured(lateLlm, REQUEST, () => clock));
    expect(error.reason).toBe('not_json');
    expect(late.requests).toHaveLength(1);
  });

  it('refuses a schema outside the strict subset before any call — a defect, not a failure', async () => {
    const { llm, requests } = scripted(reply('{}'));
    await expect(
      completeStructured(llm, {
        ...REQUEST,
        responseFormat: { name: 'loose', schema: { type: 'object', properties: {} } },
      }),
    ).rejects.toThrow(/additionalProperties/);
    expect(requests).toHaveLength(0);
  });
});

describe('LLM_PROVIDER=mock answers structured requests deterministically (FR-05-06.EK1)', () => {
  it('passes the gate with the same bytes for the same request, at no cost', async () => {
    const mock = new MockLlmProvider();
    const first = await mock.complete(REQUEST);
    const second = await mock.complete({ ...REQUEST });
    expect(first.text).toBe('{"ok":false,"violations":[]}');
    expect(second).toEqual(first);
    expect(first.usage).toEqual({ inputTokens: 0, outputTokens: 0 });

    const result = await completeStructured(mock, REQUEST);
    expect(result).toEqual({
      value: { ok: false, violations: [] },
      usage: { inputTokens: 0, outputTokens: 0 },
      tries: 1,
    });
  });

  it('still refuses a prose prompt it was not built for', async () => {
    const { responseFormat: _format, ...prose } = REQUEST;
    await expect(new MockLlmProvider().complete(prose)).rejects.toThrow(/buildAnswerPrompt/);
  });
});
