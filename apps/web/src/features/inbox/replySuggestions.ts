/**
 * Reply Suggestions (FR-MOD-02.3.2).
 *
 * The lightest of the platform's three AI layers (PRD §108): the agent presses
 * Space in an empty reply field and gets a few reply drafts to drop into the
 * composer and edit before sending. A chip fills the field with editable text —
 * that is the acceptance criterion, and it has not changed. What this module
 * owns is where the words come from.
 *
 * **Two sources, and the order between them is the design.** The chips this
 * file produces are *templates*: intent ids resolved through the panel's own
 * message catalogue, so they speak the agent's language and cost nothing. They
 * appear on the same tick as the keystroke, because this persona is answering a
 * waiting visitor and every second counts (v2-01 §51). The second source is
 * Copilot's existing `POST /copilot/chats/{chatId}/reply` — grounded in the
 * workspace's own knowledge base and therefore better when it has an answer,
 * but a round-trip away. The composer asks for it in the background and
 * {@link withCopilotDraft} puts it at the head of the row when it lands. No
 * second AI path is opened for this: a suggestion that disagreed with the
 * Copilot panel's own draft would be two answers to one question.
 *
 * **Why ids and not sentences.** Returning English strings is what made this
 * feature answer a Turkish conversation in English (audit `FR-MOD-02.3.2`
 * [KISMİ], 2026-08-30). The generator now returns a {@link ReplySuggestionId}
 * per chip and the composer resolves it through `t()`, so a chip is exactly as
 * translated as the rest of the console — and a locale added to
 * `src/locales/` gets these for free. The earlier note in `locales/en/inbox.ts`
 * exempted this file on the grounds that PRD §9 keeps *conversation content*
 * out of translation; that is true of what the customer wrote and of what the
 * agent types, and false of a product-authored phrase the product is offering.
 *
 * Intent detection is deterministic and language-aware rather than
 * English-only: each language brings its own folding (Turkish's dotted/dotless
 * `i` pairs are not the ASCII ones) and its own stems, and a match in any of
 * them decides the intent. So a Turkish "iade istiyorum" and an English "I want
 * a refund" reach the same chip, which the catalogue then says in whichever
 * language the agent is working in.
 */

/** One turn of the visible conversation, reduced to who spoke and what they said. */
export interface SuggestionTurn {
  role: 'customer' | 'agent';
  text: string;
}

/**
 * A chip the agent can press. `template` chips come from {@link
 * replySuggestionIds} + the catalogue; a `copilot` chip is a draft the
 * knowledge base answered with, and is marked so the composer can say where it
 * came from.
 */
export interface ReplyChip {
  text: string;
  source: 'template' | 'copilot';
}

/**
 * What a chip means, independent of the language it is said in. The composer
 * turns each of these into `inbox.composer.suggestions.chip.<id>`.
 */
export type ReplySuggestionId =
  | 'opener'
  | 'greeting'
  | 'thanks'
  | 'order'
  | 'question'
  | 'questionWait'
  | 'details'
  | 'holdingBear'
  | 'holdingMoment';

/**
 * Two safe holding replies, always offered last. They fit any conversation, so
 * Space never comes up empty — even before the customer has said anything, the
 * agent has something to send while they read in. Worded (in the catalogue) to
 * match the product's own observed chips (rapor-1 §461).
 */
const HOLDING: readonly ReplySuggestionId[] = ['holdingBear', 'holdingMoment'];

/** At most this many chips: a short row the agent scans in one glance, not a menu. */
export const MAX_SUGGESTIONS = 4;

/**
 * One language's way of reading a customer message.
 *
 * `fold` is per-language on purpose. Case folding is not a property of Unicode
 * alone here: `'I'.toLocaleLowerCase('tr')` is `'ı'`, which would quietly break
 * every English pattern, and matching Turkish with a plain `/…/i` misses `İade`
 * because the regex engine canonicalises through ASCII uppercase. Folding once,
 * the language's own way, and then matching lowercase-only patterns is both
 * correct and readable.
 *
 * The Turkish stems carry no trailing `\b`: `\b` is ASCII-word-based, so it
 * does not exist after `ş` or `ı`. Prefix matching is the better fit anyway in
 * an agglutinative language — one `sipariş` covers `siparişim`, `siparişimin`.
 */
interface LanguagePatterns {
  fold: (text: string) => string;
  greeting: RegExp;
  thanks: RegExp;
  order: RegExp;
}

const ENGLISH: LanguagePatterns = {
  fold: (text) => text.toLowerCase(),
  greeting: /^\s*(hi|hey|hello|good\s+(morning|afternoon|evening))\b/,
  thanks: /\b(thanks|thank you|thank u|cheers|appreciate)\b/,
  order: /\b(refund|cancel|return|order|payment|charge|invoice|money back)\b/,
};

const TURKISH: LanguagePatterns = {
  fold: (text) => text.toLocaleLowerCase('tr'),
  greeting: /^\s*(merhaba|selam|günaydın|iyi\s+(günler|akşamlar|sabahlar)|kolay gelsin)/,
  thanks: /(teşekkür|sağ ?ol|eyvallah|minnettar|makbule geçti)/,
  order: /(iade|iptal|sipariş|ödeme|fatura|ücret|kargo|geri ödeme|para iadesi)/,
};

/** Every language the detector reads. Adding one is adding a member here. */
const LANGUAGES: readonly LanguagePatterns[] = [ENGLISH, TURKISH];

/** Whether any language recognises `intent` in `text`. */
function matches(text: string, intent: keyof Omit<LanguagePatterns, 'fold'>): boolean {
  return LANGUAGES.some((language) => language[intent].test(language.fold(text)));
}

/**
 * Opener(s) for the latest thing the customer said, most specific first. A
 * question can add a second, softer line. An empty conversation gets a plain
 * opener rather than an invented intent.
 *
 * The priority order (greeting → thanks → order → question) is the one this
 * feature shipped with; only the reading of each is now multilingual.
 */
function leadFor(lastCustomer: string | null): ReplySuggestionId[] {
  if (lastCustomer === null) return ['opener'];

  const text = lastCustomer.trim();

  if (matches(text, 'greeting')) return ['greeting'];
  if (matches(text, 'thanks')) return ['thanks'];
  if (matches(text, 'order')) return ['order'];
  // A question mark is the one signal that needs no language at all.
  if (text.includes('?')) return ['question', 'questionWait'];
  return ['details'];
}

/**
 * The chips for the current conversation, most useful first, capped and
 * de-duplicated. The lead answers the newest customer message; the holding
 * lines always follow so there is never an empty result.
 */
export function replySuggestionIds(turns: SuggestionTurn[]): ReplySuggestionId[] {
  const spoken = turns.filter((turn) => turn.text.trim().length > 0);
  const lastCustomer = [...spoken].reverse().find((turn) => turn.role === 'customer');

  const ordered = [...leadFor(lastCustomer?.text ?? null), ...HOLDING];

  const seen = new Set<ReplySuggestionId>();
  const unique: ReplySuggestionId[] = [];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length === MAX_SUGGESTIONS) break;
  }
  return unique;
}

/**
 * Fold Copilot's draft into a row of template chips.
 *
 * It goes first because it is the one chip that knows anything about *this*
 * workspace, and it displaces the last template rather than growing the row:
 * {@link MAX_SUGGESTIONS} is a readability budget, not a starting point. A
 * draft identical to a chip already offered replaces it in place instead of
 * appearing twice.
 */
export function withCopilotDraft(chips: readonly ReplyChip[], draft: string): ReplyChip[] {
  const text = draft.trim();
  if (text.length === 0) return [...chips];
  return [
    { text, source: 'copilot' as const },
    ...chips.filter((chip) => chip.text !== text),
  ].slice(0, MAX_SUGGESTIONS);
}
