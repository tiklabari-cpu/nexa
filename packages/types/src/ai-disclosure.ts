/**
 * The AI tells the player what it is, and the player can always ask for a
 * person (tm 308 · SiyahTuş analysis AI-29 · guardrail G16; EU AI Act art. 50
 * — the legal reading awaits counsel, 07 open risk).
 *
 *   - **The disclosure.** The AI's first reply on a connection opens with
 *     "{name}, {brand}'s AI assistant" in the reply's language
 *     ({@link aiDisclosureSentence}), then the workspace's own opening words
 *     (`ai_agents.persona.welcome`). The workspace cannot remove the sentence:
 *     when its words do not carry it, it is put in front of them
 *     ({@link aiOpening}).
 *   - **The button.** While the AI answers the connection the widget shows
 *     "Talk to an agent" (`owner === 'ai'`, {@link customerChatOwner}); a
 *     person assigned or the queue hides it. The workspace may reword it
 *     (`human_button_label`), never hide it (AI-29-S1).
 *
 * Plain constants, no top-level calls: the widget loader imports this
 * package and its size budget counts every statement a bundler cannot drop.
 */
import type { PersonaLanguage } from './persona.js';

/** The longest opening the workspace may write (the route and the form). */
export const AI_WELCOME_MESSAGE_MAX = 500;

/** The longest wording of the "Talk to an agent" button. */
export const HUMAN_BUTTON_LABEL_MAX = 40;

/** Who has a visitor's open connection, as the widget reads it. */
export const CUSTOMER_CHAT_OWNERS = ['ai', 'human', 'queue'] as const;
export type CustomerChatOwner = (typeof CUSTOMER_CHAT_OWNERS)[number];

/** How the player asked for a person outside their own words (`ai_handoffs.requested_via`). */
export const HUMAN_REQUEST_VIAS = ['button'] as const;
export type HumanRequestVia = (typeof HUMAN_REQUEST_VIAS)[number];

/**
 * Who has the connection (AI-29 §2): the AI while it answers it
 * (`threads.ai_mode` `ai`, AI-11 — beside an agent `parallel` assignment gave
 * it, who has not written yet); else a person assigned; else the queue it
 * waits in; else the AI again when it has not joined yet and an AI agent is
 * switched on to answer. Anything else waits for a person.
 */
export function customerChatOwner(thread: {
  assigneeId: string | null;
  queuePosition: number | null;
  aiMode: string | null;
  aiAgentActive: boolean;
}): CustomerChatOwner {
  if (thread.aiMode === 'ai') return 'ai';
  if (thread.assigneeId !== null) return 'human';
  if (thread.queuePosition !== null) return 'queue';
  if (thread.aiMode === null && thread.aiAgentActive) return 'ai';
  return 'queue';
}

const TURKISH_VOWELS = 'aeıioöuü';

/** Turkish lower case: `I` is `ı` and `İ` is `i`, whatever the runtime's locale. */
function turkishLower(text: string): string {
  return text.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

/**
 * The Turkish genitive ending a name takes after its apostrophe — `'nın`,
 * `'nin`, `'nun`, `'nün` after a vowel, `'ın`, `'in`, `'un`, `'ün` after a
 * consonant — by the last written vowel's harmony. A name with no vowel at all
 * (an acronym, a number) takes `'nin`, how most letter names end. A foreign
 * name said otherwise than spelt ("Betway" → `'in`) is the workspace's to
 * write into its opening: {@link hasAiDisclosure} reads any of the eight.
 */
export function turkishGenitive(name: string): string {
  const lower = turkishLower(name.trim());
  let vowel: string | null = null;
  for (let index = lower.length - 1; index >= 0; index -= 1) {
    const char = lower.charAt(index);
    if (TURKISH_VOWELS.includes(char)) {
      vowel = char;
      break;
    }
  }
  if (vowel === null) return "'nin";
  const harmony =
    vowel === 'a' || vowel === 'ı'
      ? 'ı'
      : vowel === 'e' || vowel === 'i'
        ? 'i'
        : vowel === 'o' || vowel === 'u'
          ? 'u'
          : 'ü';
  const last = lower.charAt(lower.length - 1);
  return TURKISH_VOWELS.includes(last) ? `'n${harmony}n` : `'${harmony}n`;
}

/**
 * "{name}, {brand}'s AI assistant" in the reply's language — Turkish when it
 * is not known (the platform's default), English for a language the persona
 * cannot speak.
 */
export function aiDisclosureSentence(input: {
  name: string;
  brand: string;
  language: PersonaLanguage | null;
}): string {
  const name = input.name.trim();
  const brand = input.brand.trim();
  switch (input.language ?? 'tr') {
    case 'tr':
      return `${name}, ${brand}${turkishGenitive(brand)} yapay zekâ asistanıyım.`;
    case 'de':
      return `Ich bin ${name}, der KI-Assistent von ${brand}.`;
    case 'fr':
      return `Je suis ${name}, l’assistant IA de ${brand}.`;
    case 'es':
      return `Soy ${name}, el asistente de IA de ${brand}.`;
    default:
      return `I am ${name}, ${brand}${/s$/i.test(brand) ? '’' : '’s'} AI assistant.`;
  }
}

/**
 * Lower case, one space, typographic quotes as plain ones, any genitive ending
 * as one, no closing full stop.
 */
function comparable(text: string): string {
  return turkishLower(text)
    .replace(/[’‘`]/g, "'")
    .replace(/'n?[ıiuü]n(?=[\s,.!?]|$)/gu, "'nin")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '');
}

/** Whether `text` carries the disclosure already, give or take case, spacing and its full stop. */
export function hasAiDisclosure(text: string, sentence: string): boolean {
  return comparable(text).includes(comparable(sentence));
}

/**
 * What the AI's first reply on a connection opens with: the disclosure, then
 * the workspace's opening words — as written, when they carry the sentence
 * already; after it, when they do not (G16: it cannot be removed).
 */
export function aiOpening(sentence: string, welcome: string | null | undefined): string {
  const own = welcome?.trim() ?? '';
  if (own === '') return sentence;
  return hasAiDisclosure(own, sentence) ? own : `${sentence} ${own}`;
}

/** The reply with its opening in front, unless the reply opens with it already. */
export function withAiOpening(reply: string, opening: string): string {
  if (comparable(reply).startsWith(comparable(opening))) return reply;
  return `${opening}\n\n${reply}`;
}

function personaText(persona: unknown, key: string, max: number): string | null {
  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) return null;
  const value = (persona as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, max);
}

/** The agent's opening words (`ai_agents.persona.welcome`), or null. */
export function readAiWelcome(persona: unknown): string | null {
  return personaText(persona, 'welcome', AI_WELCOME_MESSAGE_MAX);
}

/** The agent's wording of the button (`ai_agents.persona.humanButtonLabel`), or null. */
export function readHumanButtonLabel(persona: unknown): string | null {
  return personaText(persona, 'humanButtonLabel', HUMAN_BUTTON_LABEL_MAX);
}

/**
 * The button's own words in each widget language, when the workspace wrote
 * none. Served resolved by `GET /customer/chat` in the language the visitor
 * opened the conversation in, so the widget's bundle does not carry them
 * (NFR-P3's ceiling).
 */
export const HUMAN_BUTTON_DEFAULT_LABELS: Readonly<Record<string, string>> = {
  en: 'Talk to an agent',
  tr: 'Temsilciyle görüş',
  de: 'Mit einem Mitarbeiter sprechen',
  fr: 'Parler à un conseiller',
  es: 'Hablar con un agente',
  it: 'Parla con un operatore',
  pt: 'Falar com um atendente',
  ar: 'تحدث إلى موظف',
};

/** The words on the button: the workspace's, else the default in `locale` (English when unknown). */
export function humanButtonText(own: string | null, locale: string | null | undefined): string {
  return own ?? HUMAN_BUTTON_DEFAULT_LABELS[locale ?? 'en'] ?? 'Talk to an agent';
}
