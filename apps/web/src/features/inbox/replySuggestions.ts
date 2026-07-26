/**
 * Reply Suggestions (FR-MOD-02.3.2).
 *
 * The lightest of the platform's three AI layers (PRD §108): not Copilot — no
 * knowledge base, no retrieval, no server round-trip — just a few context-shaped
 * reply drafts the agent can drop into the composer and edit before sending. The
 * agent asks for them by pressing Space in an empty reply field; a chip fills the
 * field with editable text (the acceptance criterion). Kept instant because this
 * persona is answering a waiting visitor and every second counts (v2-01 §51).
 *
 * Deterministic, like the {@link ../../../../../packages/ai-mock} stubs it stands
 * in for: same conversation in, same suggestions out. Swapping in a real provider
 * means replacing this one function and nothing else.
 */

/** One turn of the visible conversation, reduced to who spoke and what they said. */
export interface SuggestionTurn {
  role: 'customer' | 'agent';
  text: string;
}

/**
 * Two safe holding replies, always offered last. They fit any conversation, so
 * Space never comes up empty — even before the customer has said anything, the
 * agent has something to send while they read in. Worded to match the product's
 * own observed chips ("I'm still on it. Please bear…", "Give me a moment, I'll
 * ch…", rapor-1 §461).
 */
const HOLDING: readonly string[] = [
  "I'm still on it — please bear with me for a moment.",
  "Give me a moment, I'll check that for you.",
];

/** At most this many chips: a short row the agent scans in one glance, not a menu. */
const MAX_SUGGESTIONS = 4;

const GREETING = /^\s*(hi|hey|hello|good\s+(morning|afternoon|evening))\b/i;
const THANKS = /\b(thanks|thank you|thank u|cheers|appreciate)\b/i;
const ORDER = /\b(refund|cancel|return|order|payment|charge|invoice|money back)\b/i;

/**
 * Context-shaped opener(s) for the latest thing the customer said. Returns the
 * most specific match first; a question can add a second, softer line. An empty
 * conversation gets a plain opener rather than an invented intent.
 */
function leadFor(lastCustomer: string | null): string[] {
  if (lastCustomer === null) {
    return ['Hi there! Thanks for reaching out — how can I help you today?'];
  }

  const text = lastCustomer.trim();

  if (GREETING.test(text)) {
    return ['Hi there! How can I help you today?'];
  }
  if (THANKS.test(text)) {
    return ["You're very welcome! Is there anything else I can help you with?"];
  }
  if (ORDER.test(text)) {
    return ['Happy to help with that — let me pull up the details and take a look.'];
  }
  if (text.includes('?')) {
    return [
      'Great question — let me look into that and get right back to you.',
      'Thanks for asking! One moment while I find the answer for you.',
    ];
  }
  return ['Thanks for the details — let me take a look and get back to you.'];
}

/**
 * Reply drafts for the current conversation, most useful first, capped and
 * de-duplicated. The lead lines answer the newest customer message; the holding
 * lines always follow so there is never an empty result.
 */
export function replySuggestions(turns: SuggestionTurn[]): string[] {
  const spoken = turns.filter((turn) => turn.text.trim().length > 0);
  const lastCustomer = [...spoken].reverse().find((turn) => turn.role === 'customer');

  const ordered = [...leadFor(lastCustomer?.text ?? null), ...HOLDING];

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const suggestion of ordered) {
    if (seen.has(suggestion)) continue;
    seen.add(suggestion);
    unique.push(suggestion);
    if (unique.length === MAX_SUGGESTIONS) break;
  }
  return unique;
}
