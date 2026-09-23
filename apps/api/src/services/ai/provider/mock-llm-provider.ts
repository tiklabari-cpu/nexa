/**
 * `LLM_PROVIDER=mock` — the in-process, deterministic stand-in (CLAUDE.md: an
 * external service is mocked).
 *
 * It writes exactly the answer the product gave before any provider existed:
 * the retrieved passages stitched and trimmed by `shapeAnswer` to the persona's
 * budget, with the tone's opener in front. What changed is only where that
 * happens — behind the same `complete()` a model answers through, reading the
 * same prompt. It stays the provider for every test suite and for a deployment
 * that runs with AI text generation off, which is why it is not a test helper.
 *
 * It answers one kind of prompt: the grounded answer `buildAnswerPrompt` builds.
 * Anything else throws. Returning an empty string instead would make a caller
 * wired to the wrong prompt look like a knowledge miss, and nobody would look.
 */
import { shapeAnswer } from '@nexa/types';
import { readAnswerGrounding } from './answer-prompt.js';
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from './llm-provider.js';

export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock' as const;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const grounding = readAnswerGrounding(request.system);
    if (!grounding) {
      throw new Error(
        'The mock LLM provider only answers prompts built by buildAnswerPrompt (services/ai/provider/answer-prompt.ts).',
      );
    }

    const { text } = shapeAnswer(
      grounding.passages,
      // `languages` is the persona's *declaration* and is decided before a
      // prompt exists (a message in an undeclared language never gets here);
      // what reaches the answer is the one language it settled on, `answerIn`.
      { tone: grounding.tone, languages: [], answerLength: grounding.answerLength },
      { language: grounding.answerIn },
    );

    const prompt = request.system + request.messages.map((m) => m.content).join('');
    return {
      text,
      usage: { inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(text) },
    };
  }
}

/**
 * Four characters a token — the usual rule of thumb for English, and the same
 * character-for-token trade the ADR makes for `LLM_MAX_PROMPT_CHARS`. The stub
 * has no tokenizer and bills nobody; this only keeps its `usage` in the right
 * order of magnitude for whatever tm 255.9 hangs off it.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
