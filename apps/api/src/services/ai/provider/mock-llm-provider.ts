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
 * It answers three kinds of request. Prose only for the grounded answer
 * `buildAnswerPrompt` builds and for a procedure turn's written part
 * `buildComposePrompt` builds (tm 296.3 — the instructions, joined); any other
 * prose prompt throws — returning an empty string instead would make a caller
 * wired to the wrong prompt look like a knowledge miss, and nobody would look.
 * And any request with a
 * `responseFormat` (tm 283.1 · ADR §6a.6): the deterministic object
 * `exampleForSchema` builds from the schema, serialised — the same request
 * always gets the same bytes, and they pass `completeStructured`'s gate.
 * The understanding call (tm 297.1) is the one structured request answered
 * from its input rather than its schema: `mockUnderstanding` reads the
 * context line `buildUnderstandPrompt` wrote, so a procedure is found by its
 * example sentences in every suite (AI-05 §6).
 * The invalid, refused and cut-off replies a real model can give are not
 * produced here; tests inject a provider that gives them (§6a.6).
 *
 * **Its usage is zero (tm 255.9).** It used to estimate four characters a token
 * so its `usage` looked like a model's. Once `usage` is recorded on the run and
 * summed in the AI Agent report, an estimate is a count of tokens no provider
 * billed: a deployment that moves from the stub to a model mid-month would see
 * a total that is part invoice and part invention, and one on the stub would
 * report spend it never had. The stub consumed nothing, so it says so.
 */
import { shapeAnswer } from '@siyahtus/types';
import { readAnswerGrounding } from './answer-prompt.js';
import { readComposeGrounding } from './compose-prompt.js';
import { mockUnderstanding } from '../conversation/understand-mock.js';
import { readUnderstandGrounding, UNDERSTAND_RESPONSE_NAME } from '../conversation/understand.js';
import { exampleForSchema } from './json-schema.js';
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from './llm-provider.js';

export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock' as const;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    if (request.responseFormat) {
      const grounding =
        request.responseFormat.name === UNDERSTAND_RESPONSE_NAME
          ? readUnderstandGrounding(request.system)
          : null;
      const text = JSON.stringify(
        grounding ? mockUnderstanding(grounding) : exampleForSchema(request.responseFormat.schema),
      );
      return { text, usage: { inputTokens: 0, outputTokens: 0 } };
    }

    // A procedure turn's written part (tm 296.3): the instructions themselves,
    // joined — the honest deterministic reading of "write this".
    const compose = readComposeGrounding(request.system);
    if (compose) {
      return {
        text: compose.instructions.map((instruction) => instruction.trim()).join(' '),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const grounding = readAnswerGrounding(request.system);
    if (!grounding) {
      throw new Error(
        'The mock LLM provider only answers prompts built by buildAnswerPrompt (services/ai/provider/answer-prompt.ts) or buildComposePrompt (compose-prompt.ts).',
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

    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
