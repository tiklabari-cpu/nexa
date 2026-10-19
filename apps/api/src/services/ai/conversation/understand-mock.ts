/**
 * What `LLM_PROVIDER=mock` answers the understanding call with (tm 297.1 ·
 * AI-05 §6 · ADR §6a.6): a deterministic {@link UnderstandReply}, built from
 * the context line `buildUnderstandPrompt` wrote — the same prompt, the same
 * bytes, and they pass `completeStructured`'s gate like a model's would.
 *
 * Deliberately modest — the reading that stood in for the call until #297
 * (`interimUnderstanding`), now behind the provider:
 *
 *   - **which procedure** — `matchIntent` over each catalogue entry's example
 *     sentences (its name when it has none), the legacy skill gate's own
 *     matcher; the score is the confidence, the other scoring entries the
 *     alternatives. Ties are the policy's.
 *   - **the slot values** — only for the question the AI is waiting on: each
 *     slot it asked for, proposed with the whole message as the player's
 *     words, and only when that slot's own reader (`readSlot`) finds something
 *     of its kind in them — an enum, one of its options. Nothing is proposed
 *     for a slot nobody asked about: the whole message read as a username or a
 *     yes/no would fill it with words that were never an answer to it. A
 *     message with nothing for the question does not answer it, which is what
 *     lets another topic take over.
 *   - **a yes/no** — the boolean reader's, for "Önceki konuya dönelim mi?".
 *   - **the language** — `detectLanguage`, the persona check's rule (AI-05 §7).
 *   - **the mood** — angry or negative only on a few words no request is made
 *     of ({@link mockSentiment}): what lets a suite drive AI-09's
 *     `negative_sentiment` (tm 303.2); neutral otherwise.
 *   - **everything else** — the least committal reading: no wish for a person,
 *     neutral, no abuse, no risk, no `ai` answer (unknown, which the condition
 *     evaluator counts as false). A stub that raised flags would make
 *     decisions in every suite that nobody asked for (`exampleForSchema`'s
 *     rule); the deterministic input screen for the locked topics is AI-08's.
 */
import { matchIntent } from '@siyahtus/ai-mock';
import { detectLanguage, type SlotDef } from '@siyahtus/types';
import { foldTr, parseBooleanTr } from './slots/normalize-tr.js';
import { readSlot, type SlotReadContext } from './slots/validators.js';
import { UNDERSTAND_RISKS, type UnderstandGrounding, type UnderstandReply } from './understand.js';

/** Words that are an upset player and nothing else, folded (`foldTr`). */
const ANGRY = /\b(rezalet|sacmalik|berbat|ridiculous|outrageous|furious)\b/;
const NEGATIVE = /\b(hayal kirikligi|cok kotu|mutsuzum|disappointed|unhappy)\b/;

/** The stub's mood: angry or negative on {@link ANGRY} / {@link NEGATIVE}, neutral otherwise. */
export function mockSentiment(text: string): UnderstandReply['sentiment'] {
  const folded = foldTr(text);
  if (ANGRY.test(folded)) return 'angry';
  if (NEGATIVE.test(folded)) return 'negative';
  return 'neutral';
}

export function mockUnderstanding(grounding: UnderstandGrounding): UnderstandReply {
  const text = grounding.message;
  const scored = grounding.catalogue
    .map((entry) => ({
      key: entry.key,
      confidence: matchIntent(text, entry.name, [...entry.examples]).score,
    }))
    .sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];

  const extracted: UnderstandReply['extracted'] = [];
  if (grounding.pending) {
    const defs = new Map(grounding.slots.map((def) => [def.name, def as SlotDef]));
    const read = {
      now: new Date(grounding.now),
      timeZone: grounding.time_zone,
      currency: grounding.currency,
    };
    for (const name of grounding.pending.asked) {
      const def = defs.get(name);
      if (def === undefined || def.type === 'file') continue;
      const partial = grounding.pending.partial[name];
      const options = grounding.options[name];
      const reading = readSlot(def, text, {
        ...read,
        ...(options ? { options } : {}),
        completing:
          partial !== null && typeof partial === 'object'
            ? (partial as SlotReadContext['completing'])
            : null,
      });
      // Nothing of the slot's kind: no words to read, or — an enum — none of its options named.
      if (
        reading.status === 'invalid' &&
        (reading.reason === 'unreadable' || reading.reason === 'not_an_option')
      ) {
        continue;
      }
      extracted.push({ slot: name, raw_text: text, value: null, confidence: 0.9 });
    }
  }
  const answers = grounding.pending !== null && extracted.length > 0;

  const yes = parseBooleanTr(text);
  return {
    language: detectLanguage(text),
    relates_to_previous: null,
    wants_human: { value: false, explicit: false },
    intent: {
      procedure_key: best && best.confidence > 0 ? best.key : null,
      confidence: best?.confidence ?? 0,
      alternatives: scored
        .slice(1)
        .filter((candidate) => candidate.confidence > 0)
        .slice(0, 3),
      is_continuation: answers,
      smalltalk: false,
      off_topic: false,
    },
    answers_pending_question: answers,
    yes_no: yes.status === 'filled' ? (yes.value ? 'yes' : 'no') : null,
    extracted,
    correction: false,
    ai_conditions: [],
    sentiment: mockSentiment(text),
    abuse: false,
    risk: Object.fromEntries(
      UNDERSTAND_RISKS.map((risk) => [risk, { flag: false, evidence_quote: null }]),
    ) as UnderstandReply['risk'],
  };
}
