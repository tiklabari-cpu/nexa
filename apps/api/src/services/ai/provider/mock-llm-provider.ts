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
 * example sentences in every suite (AI-05 §6). So is the cited knowledge
 * answer (tm 298): `mockKnowledgeAnswer` reads the grounding
 * `buildAnswerPrompt` wrote and writes the stitched answer it always wrote,
 * citing the passages it used. And so is the guardrails' judge (tm 301.3):
 * `mockJudge` reads the context `buildJudgePrompt` wrote and finds nothing —
 * the deterministic output check is the stub's whole judgement.
 * And so is the simulated player (tm 314.6 · AI-19): `mockPlayer` reads the
 * persona, facts and goal `buildPlayerPrompt` wrote and the conversation the
 * request carries, and writes the player's next line by fixed rules. And so
 * is the scenario judge (tm 314.3): `mockScenarioJudge` reads the context
 * `buildScenarioJudgePrompt` wrote and scores from the hard checks that
 * failed — advice that never says more than they did.
 * And so is the QA pre-score (tm 319.2): `mockQaPrescore` reads the context
 * `buildQaPrescorePrompt` wrote and passes every criterion but the guardrails
 * the decision trail says only warned, citing the AI's last message.
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
import {
  KNOWLEDGE_ANSWER_RESPONSE_NAME,
  mockKnowledgeAnswer,
} from '../conversation/knowledge-answer.js';
import {
  JUDGE_RESPONSE_NAME,
  mockJudge,
  readJudgeGrounding,
} from '../conversation/guardrails/judge.js';
import { mockUnderstanding } from '../conversation/understand-mock.js';
import {
  mockScenarioJudge,
  readScenarioJudgeGrounding,
  SCENARIO_JUDGE_RESPONSE_NAME,
} from '../simulation/judge-prompt.js';
import {
  mockPlayer,
  readPlayerGrounding,
  SIMULATED_PLAYER_RESPONSE_NAME,
} from '../simulation/player-prompt.js';
import { readUnderstandGrounding, UNDERSTAND_RESPONSE_NAME } from '../conversation/understand.js';
import {
  mockQaPrescore,
  QA_PRESCORE_RESPONSE_NAME,
  readQaPrescoreGrounding,
} from '../../qa/prescore-prompt.js';
import { exampleForSchema } from './json-schema.js';
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from './llm-provider.js';

export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock' as const;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    if (request.responseFormat?.name === KNOWLEDGE_ANSWER_RESPONSE_NAME) {
      const grounding = readAnswerGrounding(request.system);
      if (!grounding) {
        throw new Error(
          'A knowledge answer request without the grounding buildAnswerPrompt writes.',
        );
      }
      return {
        text: JSON.stringify(mockKnowledgeAnswer(grounding)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (request.responseFormat?.name === JUDGE_RESPONSE_NAME) {
      const grounding = readJudgeGrounding(request.system);
      if (!grounding)
        throw new Error('A judge request without the context buildJudgePrompt writes.');
      return {
        text: JSON.stringify(mockJudge(grounding)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (request.responseFormat?.name === SIMULATED_PLAYER_RESPONSE_NAME) {
      const grounding = readPlayerGrounding(request.system);
      if (!grounding) {
        throw new Error('A simulated player request without the context buildPlayerPrompt writes.');
      }
      return {
        text: JSON.stringify(mockPlayer(grounding, request.messages)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (request.responseFormat?.name === SCENARIO_JUDGE_RESPONSE_NAME) {
      const grounding = readScenarioJudgeGrounding(request.system);
      if (!grounding) {
        throw new Error(
          'A scenario judge request without the context buildScenarioJudgePrompt writes.',
        );
      }
      return {
        text: JSON.stringify(mockScenarioJudge(grounding)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (request.responseFormat?.name === QA_PRESCORE_RESPONSE_NAME) {
      const grounding = readQaPrescoreGrounding(request.system);
      if (!grounding) {
        throw new Error('A QA pre-score request without the context buildQaPrescorePrompt writes.');
      }
      return {
        text: JSON.stringify(mockQaPrescore(grounding)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
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
