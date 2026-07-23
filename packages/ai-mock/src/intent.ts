/**
 * Intent matching for `detect_intent`.
 *
 * Lexical, using the same tokenizer as the embeddings so the two agree about
 * what a word is. A message matches when it shares enough of the intent's
 * phrases; the threshold is deliberately not "any overlap", because a single
 * common word firing a skill at the wrong customer is the failure that makes
 * teams turn automation off entirely.
 */
import { tokenize } from './embedding.js';

export interface IntentMatch {
  matched: boolean;
  score: number;
  /** Phrase tokens found in the message — shown in the run log. */
  hits: string[];
}

/**
 * Below this, the skill does not run.
 *
 * Above a half rather than at it, so a two-word phrase needs both words:
 * "order status" must not fire on "I ordered a coffee while waiting". Tokens are
 * stemmed, which is what makes that sentence a near-miss in the first place —
 * the recall stemming buys has to be paid for in precision somewhere, and this
 * is the cheaper place. A skill answering the wrong customer is the failure that
 * makes a team switch automation off entirely.
 */
export const INTENT_THRESHOLD = 0.6;

export function matchIntent(message: string, intent: string, phrases: string[] = []): IntentMatch {
  const haystack = new Set(tokenize(message));
  if (haystack.size === 0) return { matched: false, score: 0, hits: [] };

  // Phrases when the admin gave them, otherwise the intent name itself —
  // `order_status` becomes ["order", "status"].
  const candidates = phrases.length > 0 ? phrases : [intent.replace(/_/g, ' ')];

  let best = 0;
  let bestHits: string[] = [];

  for (const phrase of candidates) {
    const tokens = tokenize(phrase);
    if (tokens.length === 0) continue;

    const hits = tokens.filter((token) => haystack.has(token));
    // Share of the *phrase* found, not of the message: a long message that
    // happens to contain the phrase should still match strongly.
    const score = hits.length / tokens.length;

    if (score > best) {
      best = score;
      bestHits = hits;
    }
  }

  return { matched: best >= INTENT_THRESHOLD, score: Number(best.toFixed(3)), hits: bestHits };
}
