/**
 * A test model's reply as the cited knowledge answer (tm 298 · AI-06 §6).
 *
 * The knowledge answer is the `knowledge_answer` object — `{ reply, grounded,
 * cited_ids }` — not prose. A scripted model that writes prose for it would
 * end every answer in "the model could not answer"; these write the prose as
 * the object's reply, grounded in full, citing the first passage the prompt
 * gave. Every other request keeps its prose.
 */
import { KNOWLEDGE_ANSWER_RESPONSE_NAME } from '../../src/services/ai/conversation/knowledge-answer.js';
import { readAnswerGrounding } from '../../src/services/ai/provider/answer-prompt.js';
import type { LlmCompletionRequest } from '../../src/services/ai/provider/llm-provider.js';

/** `reply` as the object a model writes, citing `cited` (the prompt's labels). */
export function knowledgeAnswerJson(reply: string, cited: readonly string[] = ['P1']): string {
  return JSON.stringify({ reply, grounded: 'full', cited_ids: cited });
}

/**
 * `text` as the answer to `request`: the cited object when the request asks
 * for one and `text` is not one already, `text` itself otherwise.
 */
export function asKnowledgeAnswer(text: string, request: LlmCompletionRequest): string {
  if (request.responseFormat?.name !== KNOWLEDGE_ANSWER_RESPONSE_NAME) return text;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'reply' in parsed) return text;
  } catch {
    // Prose: written as the object below.
  }
  const first = readAnswerGrounding(request.system)?.ids?.[0];
  return knowledgeAnswerJson(text, first ? [first] : []);
}
