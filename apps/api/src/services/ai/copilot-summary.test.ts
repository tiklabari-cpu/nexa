/**
 * The Copilot summary's prompt and its writer switch (tm 257.5) — the edges
 * the route suite (`test/integration/copilot-summary-llm.test.ts`) does not
 * reach through a server: an empty conversation, one with no customer in it,
 * text that doubles when escaped, a ceiling too small for anything, and a
 * provider id nobody handled.
 */
import { describe, expect, it } from 'vitest';
import { summariseConversation, type ConversationTurn } from '@siyahtus/ai-mock';
import {
  SUMMARY_TURN_MAX_CHARS,
  buildSummaryPrompt,
  writeConversationSummary,
} from './copilot-summary.js';
import { LlmProviderError } from './provider/llm-error.js';
import {
  promptLength,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmProviderId,
} from './provider/llm-provider.js';

const LIMITS = { maxOutputTokens: 400, timeoutMs: 20_000 } as const;

function recorder(id: LlmProviderId = 'openai'): LlmProvider & { calls: LlmCompletionRequest[] } {
  const calls: LlmCompletionRequest[] = [];
  return {
    id,
    calls,
    async complete(request) {
      calls.push(request);
      return { text: 'A summary.', usage: { inputTokens: 5, outputTokens: 2 } };
    },
  };
}

const parsed = (content: string) =>
  JSON.parse(content) as {
    total: number;
    omitted: number;
    turns: Array<{ role: string; text: string }>;
  };

describe('writeConversationSummary', () => {
  const turns: ConversationTurn[] = [
    { role: 'customer', text: 'Where is my order?' },
    { role: 'agent', text: 'Checking.' },
  ];

  it('is the stub’s summary on mock, with no model call and no usage', async () => {
    const llm = recorder('mock');
    const written = await writeConversationSummary(llm, turns, {
      ...LIMITS,
      language: 'tr',
      maxPromptChars: 2_000,
    });
    expect(written).toEqual({
      text: summariseConversation(turns),
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('says there is nothing to summarise, in the asked language, without calling the model', async () => {
    const llm = recorder();
    const blank: ConversationTurn[] = [{ role: 'customer', text: '  \n ' }];
    const options = { ...LIMITS, maxPromptChars: 16_000 };
    expect((await writeConversationSummary(llm, blank, { ...options, language: 'en' })).text).toBe(
      'No messages to summarise yet.',
    );
    expect((await writeConversationSummary(llm, [], { ...options, language: 'tr' })).text).toBe(
      'Özetlenecek mesaj henüz yok.',
    );
    expect(llm.calls).toHaveLength(0);
  });

  it('refuses a ceiling too small for the instructions before any call (prompt_too_long)', async () => {
    const llm = recorder();
    const refusal = writeConversationSummary(llm, turns, {
      ...LIMITS,
      language: 'en',
      maxPromptChars: 100,
    });
    await expect(refusal).rejects.toBeInstanceOf(LlmProviderError);
    await expect(refusal).rejects.toMatchObject({ kind: 'prompt_too_long' });
    expect(llm.calls).toHaveLength(0);
  });

  it('refuses a provider id it has no branch for', async () => {
    const llm = { ...recorder(), id: 'other' as unknown as LlmProviderId };
    await expect(
      writeConversationSummary(llm, turns, { ...LIMITS, language: 'en', maxPromptChars: 2_000 }),
    ).rejects.toThrow('Unknown LLM_PROVIDER: other');
  });
});

describe('buildSummaryPrompt', () => {
  it('keeps the newest messages of a conversation with no customer in it', () => {
    const team: ConversationTurn[] = Array.from({ length: 30 }, (_, i) => ({
      role: 'agent',
      text: `[${String(i).padStart(2, '0')}] ${'z'.repeat(400)}`,
    }));
    const { prompt, transcript } = buildSummaryPrompt(team, {
      language: 'en',
      maxPromptChars: 4_000,
    });
    expect(promptLength(prompt)).toBeLessThanOrEqual(4_000);
    expect(transcript.turns.length).toBeGreaterThan(1);
    expect(transcript.turns.at(-1)!.text.startsWith('[29]')).toBe(true);
    expect(transcript.omitted).toBe(30 - transcript.turns.length);
  });

  it('stays under every ceiling when escaping doubles the text, keeping the opening and the newest', () => {
    const awkward: ConversationTurn[] = [
      { role: 'customer', text: `[open] ${'"\\'.repeat(3_000)}` },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 ? 'customer' : 'agent') as ConversationTurn['role'],
        text: `[m${String(i).padStart(2, '0')}] ${'"'.repeat(2_000)}`,
      })),
    ];
    for (let ceiling = 2_000; ceiling <= 9_000; ceiling += 173) {
      const { prompt, transcript } = buildSummaryPrompt(awkward, {
        language: 'tr',
        maxPromptChars: ceiling,
      });
      expect(promptLength(prompt)).toBeLessThanOrEqual(ceiling);
      expect(parsed(prompt.messages[0]!.content)).toEqual(transcript);
      expect(transcript.turns[0]!.text.startsWith('[open]')).toBe(true);
      expect(transcript.turns.at(-1)!.text.startsWith('[m19]')).toBe(true);
      for (const turn of transcript.turns) {
        expect(turn.text.length).toBeLessThanOrEqual(SUMMARY_TURN_MAX_CHARS);
      }
    }
  });
});
