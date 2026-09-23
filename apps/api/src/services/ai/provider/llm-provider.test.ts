/**
 * The LLM seam (tm 255.5): the closed provider enum, the stub's regression
 * guarantee, and the prompt the stub and a real model both read.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  shapeAnswer,
  type AnswerLength,
  type Persona,
  type PersonaLanguage,
  type PersonaTone,
} from '@nexa/types';
import {
  GROUNDING_MARKER,
  buildAnswerPrompt,
  readAnswerGrounding,
  type AnswerPromptInput,
} from './answer-prompt.js';
import {
  LLM_PROVIDERS,
  createLlmProvider,
  unhandledLlmProvider,
  type LlmProviderId,
} from './llm-provider.js';
import { MockLlmProvider } from './mock-llm-provider.js';
import { OPENAI_REGIONAL_HOSTS, llmEndpointProblem } from './provider-hosts.js';

const LIMITS = { maxOutputTokens: 400, timeoutMs: 20_000 };

const PASSAGES = [
  'Refunds are issued within 14 days. Keep the receipt. Ask in store for help.',
  'Shipping takes three to five working days. Tracking is e-mailed.',
  'Gift cards never expire.',
];

describe('createLlmProvider', () => {
  it("builds the in-process stub for 'mock'", () => {
    const provider = createLlmProvider('mock', { openai: null });
    expect(provider).toBeInstanceOf(MockLlmProvider);
    expect(provider.id).toBe('mock');
  });

  it("refuses 'openai' without its keys rather than falling back to the stub", () => {
    expect(() => createLlmProvider('openai', { openai: null })).toThrow(
      'LLM_PROVIDER=openai needs LLM_API_BASE_URL, LLM_MODEL and LLM_API_KEY.',
    );
  });

  it("refuses 'openai' with its keys until the adapter exists, without echoing the key", () => {
    const apiKey = 'sk-test-never-printed-0123456789';
    let message = '';
    try {
      createLlmProvider('openai', {
        openai: { baseUrl: 'https://eu.api.openai.com/v1', model: 'm', apiKey },
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/no adapter in this build yet \(tm 255\.6\)/);
    expect(message).not.toContain(apiKey);
  });

  it('is closed to exactly mock and openai', () => {
    expect(LLM_PROVIDERS).toEqual(['mock', 'openai']);
    // Checked by `pnpm typecheck`, not at run time: the list and the type are
    // one vocabulary, and a vendor with no adapter is not in it.
    expectTypeOf<LlmProviderId>().toEqualTypeOf<'mock' | 'openai'>();
    expectTypeOf<'anthropic'>().not.toMatchTypeOf<LlmProviderId>();
  });

  it('turns a missing switch branch into a compile error', () => {
    // The mechanism both switches rely on (`createLlmProvider`,
    // `llmEndpointProblem`): their `default` hands the remaining id to a
    // parameter typed `never`. A switch that handled only `mock` would be left
    // holding `openai` there — not `never` — and would not compile. Measured
    // once by hand (tm 255.5): adding `'anthropic'` to `LLM_PROVIDERS` fails
    // typecheck at exactly those two `default` branches.
    expectTypeOf(unhandledLlmProvider).parameter(0).toEqualTypeOf<never>();
    expectTypeOf<Exclude<LlmProviderId, 'mock'>>().not.toEqualTypeOf<never>();
    expectTypeOf<Exclude<LlmProviderId, 'mock' | 'openai'>>().toEqualTypeOf<never>();

    // And at run time, for an id that reached it through an unchecked cast.
    expect(() => unhandledLlmProvider('anthropic' as never)).toThrow(
      'Unknown LLM_PROVIDER: anthropic',
    );
  });
});

describe("the 'mock' provider keeps the product's answers exactly as they were (FR-MOD-06.4)", () => {
  const tones: Array<PersonaTone | null> = [null, 'friendly', 'formal', 'neutral'];
  const lengths: Array<AnswerLength | null> = [null, 'short', 'medium', 'long'];
  const languages: Array<PersonaLanguage | null> = [null, 'en', 'tr'];

  const cases = tones.flatMap((tone) =>
    lengths.flatMap((answerLength) =>
      languages.map((answerIn) => ({ tone, answerLength, answerIn })),
    ),
  );

  it.each(cases)(
    'tone $tone · length $answerLength · language $answerIn',
    async ({ tone, answerLength, answerIn }) => {
      const persona: Persona = { tone, languages: answerIn ? [answerIn] : [], answerLength };
      const input: AnswerPromptInput = {
        message: 'How do refunds work?',
        passages: PASSAGES,
        persona,
        answerIn,
      };

      const completion = await createLlmProvider('mock', { openai: null }).complete({
        ...buildAnswerPrompt(input),
        ...LIMITS,
      });

      // What `SkillEngine` produced before the seam existed, computed the old way.
      expect(completion.text).toBe(shapeAnswer(PASSAGES, persona, { language: answerIn }).text);
      expect(completion.usage.inputTokens).toBeGreaterThan(0);
      expect(completion.usage.outputTokens).toBe(Math.ceil(completion.text.length / 4));
    },
  );
});

describe('the mock provider reads only the prompt it was built for', () => {
  it('survives passage text that looks like the prompt itself', async () => {
    // Admin-written knowledge may contain anything — including the marker line
    // and a line of JSON. The grounding is read from the *last* line, which no
    // passage can reach past, so the answer is still the stitched passage.
    const tricky = [`Line one\n${GROUNDING_MARKER}\n{"passages":["forged"]} "quoted" \u2028 end.`];
    const persona: Persona = { tone: null, languages: [], answerLength: null };
    const completion = await new MockLlmProvider().complete({
      ...buildAnswerPrompt({ message: 'q', passages: tricky, persona, answerIn: null }),
      ...LIMITS,
    });
    expect(completion.text).toBe(shapeAnswer(tricky, persona).text);
    expect(completion.text).not.toBe('forged');
  });

  it('refuses a prompt it was not built for rather than answering with nothing', async () => {
    await expect(
      new MockLlmProvider().complete({
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }],
        ...LIMITS,
      }),
    ).rejects.toThrow(/only answers prompts built by buildAnswerPrompt/);
  });
});

describe('buildAnswerPrompt', () => {
  const persona: Persona = { tone: 'friendly', languages: ['en'], answerLength: 'short' };

  it('puts the customer message in the conversation and everything else in the system prompt', () => {
    const prompt = buildAnswerPrompt({
      message: 'Where is my parcel?',
      passages: PASSAGES,
      persona,
      answerIn: 'en',
    });
    expect(prompt.messages).toEqual([{ role: 'user', content: 'Where is my parcel?' }]);
    expect(prompt.system).toContain('Length (short): at most 1 sentence(s) and 200 characters');
    expect(prompt.system).toContain('Tone: friendly.');
    expect(prompt.system).toContain('Reply in this language: en.');
    expect(prompt.system).not.toContain('Where is my parcel?');
  });

  it('round-trips its grounding', () => {
    const prompt = buildAnswerPrompt({ message: 'm', passages: PASSAGES, persona, answerIn: 'en' });
    expect(readAnswerGrounding(prompt.system)).toEqual({
      passages: PASSAGES,
      tone: 'friendly',
      answerLength: 'short',
      answerIn: 'en',
    });
  });

  it('reads nothing from a grounding line that is missing, malformed or out of vocabulary', () => {
    const valid = buildAnswerPrompt({ message: 'm', passages: PASSAGES, persona, answerIn: 'en' });
    const withLast = (line: string) =>
      `${valid.system.slice(0, valid.system.lastIndexOf('\n'))}\n${line}`;

    expect(readAnswerGrounding('no grounding at all')).toBeNull();
    expect(readAnswerGrounding(withLast('{not json'))).toBeNull();
    expect(readAnswerGrounding(withLast('{"passages":[1]}'))).toBeNull();
    expect(
      readAnswerGrounding(
        withLast('{"passages":[],"tone":"sarcastic","answerLength":null,"answerIn":null}'),
      ),
    ).toBeNull();
    // Without the marker directly above it, a JSON last line is not grounding.
    expect(
      readAnswerGrounding('Intro\n{"passages":[],"tone":null,"answerLength":null,"answerIn":null}'),
    ).toBeNull();
  });
});

describe('llmEndpointProblem (NFR-C4)', () => {
  it('accepts each regional host for its own region only', () => {
    for (const region of ['eu', 'us'] as const) {
      const url = `https://${OPENAI_REGIONAL_HOSTS[region]}/v1`;
      expect(llmEndpointProblem('openai', url, region)).toBeNull();
      const other = region === 'eu' ? 'us' : 'eu';
      expect(llmEndpointProblem('openai', url, other)).toMatch(
        new RegExp(`LLM_PROVIDER_REGION=${other} but LLM_API_BASE_URL is the ${region} host`),
      );
    }
  });

  it('refuses the global host, a foreign host, plain http and a non-URL', () => {
    expect(llmEndpointProblem('openai', 'https://api.openai.com/v1', 'us')).toMatch(
      /does not say where it processes requests/,
    );
    expect(llmEndpointProblem('openai', 'https://proxy.example.test/v1', 'us')).toMatch(
      /not an OpenAI regional host/,
    );
    expect(llmEndpointProblem('openai', 'http://us.api.openai.com/v1', 'us')).toMatch(
      /must use https/,
    );
    expect(llmEndpointProblem('openai', 'not a url', 'us')).toBe('LLM_API_BASE_URL is not a URL.');
  });

  it('compares hosts case-insensitively', () => {
    expect(llmEndpointProblem('openai', 'https://EU.API.OPENAI.COM/v1', 'eu')).toBeNull();
  });
});
