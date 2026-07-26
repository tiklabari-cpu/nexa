/**
 * Deterministic agent-assist text helpers (Copilot, FR-MOD-12.3 / 02.5).
 *
 * Copilot needs three kinds of generated text — a conversation summary, a
 * suggested reply, and a tone/grammar rewrite. Like the embedding stub next to
 * it, none of it calls a model: the platform ships without an LLM, so these are
 * pure functions with the one property tests and demos depend on — same input,
 * same output. Swapping in a real provider means replacing these functions and
 * nothing else. The reply draft is assembled by the route from retrieved
 * knowledge; this module owns the summary and the rewrite.
 */

/** One turn of a conversation, reduced to who spoke and what they said. */
export interface ConversationTurn {
  role: 'customer' | 'agent';
  text: string;
}

/** How Copilot should rework a draft before it goes to the customer. */
export const ENHANCE_MODES = ['rephrase', 'friendly', 'formal', 'grammar'] as const;
export type EnhanceMode = (typeof ENHANCE_MODES)[number];

/** Longer than this and a "summary" is just the message again. */
const OPENING_MAX = 140;

function clip(text: string, max = OPENING_MAX): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/**
 * A short, neutral summary of a conversation for the agent picking it up — the
 * text 12.3 drops into an internal note. Built from the customer's side of the
 * conversation: what they opened with, what they last said, and how much ground
 * has been covered, so the note reads as a handover rather than a transcript.
 */
export function summariseConversation(turns: ConversationTurn[]): string {
  const spoken = turns.filter((turn) => turn.text.replace(/\s+/g, '').length > 0);
  if (spoken.length === 0) return 'No messages to summarise yet.';

  const customer = spoken.filter((turn) => turn.role === 'customer');
  const agentCount = spoken.length - customer.length;

  // With nothing from the customer there is no request to summarise — describe
  // what is there rather than inventing an intent.
  if (customer.length === 0) {
    return `Summary: ${spoken.length} message(s) from the team, no customer reply yet.`;
  }

  const opening = clip(customer[0]!.text);
  const latest = clip(customer[customer.length - 1]!.text);

  const parts = [
    `Customer opened with: "${opening}".`,
    customer.length > 1 && latest !== opening ? `Most recent: "${latest}".` : null,
    `${spoken.length} message(s) exchanged (${customer.length} from the customer, ${agentCount} from the team).`,
  ].filter((part): part is string => part !== null);

  return `Summary: ${parts.join(' ')}`;
}

/** don't → do not, and the rest of the everyday contractions, for `formal`. */
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bcan't\b/gi, 'cannot'],
  [/\bwon't\b/gi, 'will not'],
  [/\bn't\b/gi, ' not'],
  [/\bi'm\b/gi, 'I am'],
  [/\b(\w+)'re\b/gi, '$1 are'],
  [/\b(\w+)'ll\b/gi, '$1 will'],
  [/\b(\w+)'ve\b/gi, '$1 have'],
  [/\b(\w+)'d\b/gi, '$1 would'],
  [/\blet's\b/gi, 'let us'],
];

/** Whitespace tidy, a capital first letter, and a closing full stop. */
function tidy(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return collapsed;
  const capitalised = collapsed[0]!.toUpperCase() + collapsed.slice(1);
  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/**
 * Rewrite a draft in one of a few registers. Deterministic and idempotent
 * enough to be safe to run twice: `grammar` only tidies, and the framed modes
 * check for their own frame before adding it, so a second pass is a no-op rather
 * than a pile-up of greetings.
 */
export function enhanceText(text: string, mode: EnhanceMode): string {
  const base = tidy(text);
  if (!base) return base;

  switch (mode) {
    case 'grammar':
      return base;

    case 'formal': {
      let formal = base;
      for (const [pattern, replacement] of CONTRACTIONS) {
        formal = formal.replace(pattern, replacement);
      }
      formal = tidy(formal);
      return /^(dear|hello|good )/i.test(formal) ? formal : `Hello, ${lowerFirst(formal)}`;
    }

    case 'friendly':
      return /^(hi|hey|thanks|happy to help)/i.test(base)
        ? base
        : `Happy to help! ${base}`;

    case 'rephrase':
      return /^(to confirm|in other words)/i.test(base)
        ? base
        : `To confirm: ${lowerFirst(base)}`;

    default:
      return base;
  }
}

/** Lower-cases the first letter so a framed sentence reads naturally after it. */
function lowerFirst(text: string): string {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}
