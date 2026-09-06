/**
 * What the AI agent's persona actually *does* to an answer (FR-MOD-06.4).
 *
 * The persona has five fields and, until this module existed, three of them
 * were decoration: `tone`, `languages` and `answerLength` were editable,
 * persisted, previewed — and read by nothing. A visitor saw the name and the
 * avatar and then got a reply shaped exactly as it would have been for an
 * assistant configured the opposite way. This is the piece that makes those
 * three fields mean something.
 *
 * Three properties are load-bearing, and all three come from the same place —
 * the model provider here is a deterministic in-process stub (CLAUDE.md's
 * external-services rule), so there is nothing to ask "please be brief" of:
 *
 *   1. **Pure and deterministic.** No clock, no randomness, no I/O. The same
 *      passages and the same persona produce the same string every time, which
 *      is the only reason a persona effect can be asserted at all rather than
 *      eyeballed.
 *   2. **Free text never reaches the logic.** `tone` is an admin-typed string.
 *      It is normalised onto a closed set of five tones and anything outside
 *      that set means "no tone", so a tone box cannot smuggle instructions into
 *      whatever composes the reply.
 *   3. **An unset persona is a no-op, byte for byte.** `shapeAnswer` with an
 *      empty persona returns the first passage unchanged — the exact string the
 *      engine sent before any of this existed.
 *
 * It lives in `@nexa/types` rather than beside the engine because two surfaces
 * have to agree on it: the engine that produces the customer's reply, and the
 * admin-facing preview that promises what that reply will look like. A preview
 * running its own approximation of these rules is worse than no preview.
 */

/** How long an answer the persona asks for. */
export const ANSWER_LENGTHS = ['short', 'medium', 'long'] as const;
export type AnswerLength = (typeof ANSWER_LENGTHS)[number];

/**
 * The closed set an admin's free-text `tone` is mapped onto.
 *
 * `neutral` is a real choice, not a placeholder: it names "I set a tone and I
 * want no flourish", which is different from having set nothing at all.
 */
export const PERSONA_TONES = ['friendly', 'professional', 'casual', 'formal', 'neutral'] as const;
export type PersonaTone = (typeof PERSONA_TONES)[number];

/**
 * The languages the persona can actually *speak* — i.e. the ones this module
 * has phrasing for and can recognise in an incoming message.
 *
 * `languages` on the wire is an open list of codes (an admin may type anything),
 * so this is deliberately narrower: a declared language outside this set still
 * counts for the "can we serve this customer" decision, it just gets no
 * tone phrasing, because inventing a greeting in a language nobody wrote is how
 * a persona ends up saying something embarrassing.
 */
export const PERSONA_LANGUAGES = ['en', 'tr', 'de', 'fr', 'es'] as const;
export type PersonaLanguage = (typeof PERSONA_LANGUAGES)[number];

/** The persona, normalised. Every field is either meaningful or absent. */
export interface Persona {
  tone: PersonaTone | null;
  /** Normalised, de-duplicated language codes; empty means "no declaration". */
  languages: string[];
  answerLength: AnswerLength | null;
}

/** A persona that asks for nothing. `shapeAnswer` against it changes nothing. */
export const NO_PERSONA: Persona = { tone: null, languages: [], answerLength: null };

/** How much answer each `answerLength` buys. */
export interface AnswerBudget {
  /** Retrieved passages that may be stitched into one reply. */
  passages: number;
  /** Sentences kept from the stitched text. */
  sentences: number;
  /**
   * Soft character ceiling. Soft because a word is never cut in half: the only
   * way past it is a single word longer than the whole budget.
   */
  maxChars: number;
}

/**
 * The budgets.
 *
 * `passages` is the part that makes "long" genuinely longer rather than
 * theatrically so. Retrieval returns several passages above the similarity
 * threshold and the engine has always used exactly one; a long answer stitches
 * more of them in, a short answer keeps the one and trims it. Nothing is
 * invented to pad a long answer — an assistant that manufactures sentences to
 * fill a length setting is worse than one that ignores the setting.
 */
export const ANSWER_BUDGETS: Record<AnswerLength, AnswerBudget> = {
  short: { passages: 1, sentences: 1, maxChars: 200 },
  medium: { passages: 2, sentences: 4, maxChars: 600 },
  long: { passages: 3, sentences: 8, maxChars: 1200 },
};

/**
 * Passages used when no `answerLength` is set — one, which is what the engine
 * did before this module existed and must keep doing.
 */
export const DEFAULT_ANSWER_PASSAGES = 1;

/**
 * Tone phrasing, by tone and language.
 *
 * A fixed table rather than anything generated: these are the only words the
 * product puts in the assistant's mouth that no admin wrote, so they are
 * reviewable in one place. `neutral` is present with empty strings so the
 * record stays total — a missing key would read as an oversight.
 */
const TONE_OPENERS: Record<PersonaTone, Record<PersonaLanguage, string>> = {
  friendly: {
    en: 'Happy to help!',
    tr: 'Yardımcı olmaktan mutluluk duyarım!',
    de: 'Gerne helfe ich!',
    fr: 'Avec plaisir !',
    es: '¡Con mucho gusto!',
  },
  professional: {
    en: 'Certainly.',
    tr: 'Tabii ki.',
    de: 'Selbstverständlich.',
    fr: 'Bien sûr.',
    es: 'Por supuesto.',
  },
  casual: {
    en: 'Sure thing —',
    tr: 'Tabii —',
    de: 'Klar —',
    fr: 'Bien sûr —',
    es: 'Claro —',
  },
  formal: {
    en: 'Thank you for your enquiry.',
    tr: 'İlginiz için teşekkür ederiz.',
    de: 'Vielen Dank für Ihre Anfrage.',
    fr: 'Nous vous remercions de votre demande.',
    es: 'Gracias por su consulta.',
  },
  neutral: { en: '', tr: '', de: '', fr: '', es: '' },
};

/**
 * Free text an admin might type, mapped onto the closed set.
 *
 * Multilingual because the tone box is a plain input on a screen that ships in
 * English and Turkish, and "Kibar" is a tone an admin will type. Anything not
 * listed normalises to `null` — no tone — which is the safe direction: an
 * unrecognised word changing nothing is a persona that under-promises, whereas
 * feeding it onwards would be the injection surface this closed set exists to
 * remove. The PRD's own observed example ("Tone Polite, Short") is in here.
 */
const TONE_ALIASES: Record<string, PersonaTone> = {
  friendly: 'friendly',
  warm: 'friendly',
  cheerful: 'friendly',
  helpful: 'friendly',
  samimi: 'friendly',
  dostane: 'friendly',
  sicak: 'friendly',
  freundlich: 'friendly',
  amical: 'friendly',
  amigable: 'friendly',

  professional: 'professional',
  polite: 'professional',
  courteous: 'professional',
  business: 'professional',
  profesyonel: 'professional',
  kibar: 'professional',
  nazik: 'professional',
  hoflich: 'professional',
  professionnel: 'professional',
  profesional: 'professional',

  casual: 'casual',
  relaxed: 'casual',
  informal: 'casual',
  chatty: 'casual',
  rahat: 'casual',
  locker: 'casual',
  decontracte: 'casual',

  formal: 'formal',
  resmi: 'formal',
  formell: 'formal',
  formel: 'formal',

  neutral: 'neutral',
  plain: 'neutral',
  direct: 'neutral',
  concise: 'neutral',
  notr: 'neutral',
  sachlich: 'neutral',
};

/**
 * Function words that identify a language, scored by how many of them a message
 * contains.
 *
 * Content words are deliberately absent. "order" or "delivery" would make the
 * detector agree with English on a message that merely quotes an English
 * product name, and the cost of a wrong detection here is a customer being told
 * their language is not supported.
 */
const LANGUAGE_STOPWORDS: Record<PersonaLanguage, readonly string[]> = {
  en: [
    'the',
    'is',
    'are',
    'was',
    'my',
    'your',
    'you',
    'i',
    'how',
    'what',
    'where',
    'when',
    'why',
    'do',
    'does',
    'did',
    'can',
    'could',
    'to',
    'for',
    'and',
    'of',
    'it',
    'please',
    'thanks',
    'thank',
    'have',
    'has',
    'not',
  ],
  tr: [
    'bir',
    've',
    'için',
    'icin',
    'nasıl',
    'nasil',
    'nedir',
    'mi',
    'mı',
    'mu',
    'mü',
    'ben',
    'benim',
    'siz',
    'sizin',
    'ne',
    'nerede',
    'neden',
    'var',
    'yok',
    'değil',
    'degil',
    'lütfen',
    'lutfen',
    'teşekkür',
    'tesekkur',
    'musunuz',
    'mısınız',
    'misiniz',
  ],
  de: [
    'und',
    'der',
    'die',
    'das',
    'ist',
    'sind',
    'wie',
    'was',
    'wo',
    'wann',
    'warum',
    'ich',
    'mein',
    'meine',
    'sie',
    'ihr',
    'nicht',
    'kann',
    'können',
    'konnen',
    'bitte',
    'danke',
    'für',
    'fur',
    'mit',
    'haben',
  ],
  fr: [
    'le',
    'la',
    'les',
    'est',
    'sont',
    'comment',
    'quand',
    'pourquoi',
    'je',
    'vous',
    'mon',
    'ma',
    'mes',
    'pour',
    'avec',
    'où',
    'ou',
    'merci',
    'pas',
    'une',
    'des',
    'dans',
    'être',
    'etre',
  ],
  es: [
    'el',
    'los',
    'las',
    'es',
    'son',
    'cómo',
    'como',
    'cuándo',
    'cuando',
    'dónde',
    'donde',
    'por',
    'qué',
    'que',
    'para',
    'con',
    'mi',
    'usted',
    'gracias',
    'favor',
    'una',
    'del',
    'muy',
  ],
};

/**
 * Letters that only one of the five languages uses.
 *
 * A weak signal on its own (one accented word proves little) so it is worth a
 * single point, the same as one function word — enough to break a tie between
 * two languages that share their small words, not enough to decide a message by
 * itself.
 */
const LANGUAGE_MARKS: Record<PersonaLanguage, RegExp | null> = {
  en: null,
  tr: /[ığşİĞŞ]/u,
  de: /[äßÄ]/u,
  fr: /[àèêùœÀÈÊÙŒ]/u,
  es: /[ñ¿¡Ñ]/u,
};

/** The score a winning language must reach before it is believed at all. */
const LANGUAGE_MIN_SCORE = 2;

/**
 * Strip the accents a lookup table should not have to enumerate.
 *
 * NFD handles every accented letter in the five languages except the Turkish
 * dotless `ı`, which is a letter in its own right and decomposes to nothing, so it
 * is folded by hand. Without that line `sıcak` normalises to `scak` and silently
 * matches no alias at all.
 */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i');
}

/**
 * Map an admin's free-text tone onto the closed set, or `null` for "no tone".
 *
 * Exported because it is the boundary the security argument rests on: whatever
 * an admin types, only one of five constants leaves this function.
 */
export function normaliseTone(raw: string | null | undefined): PersonaTone | null {
  if (typeof raw !== 'string') return null;
  const key = fold(raw.trim()).replace(/[^a-z]/g, '');
  if (key === '') return null;
  return TONE_ALIASES[key] ?? null;
}

/**
 * Normalise one language code to its primary subtag (`en-GB` → `en`).
 *
 * Returns `null` for anything that is not a plausible code, so a stray value in
 * the array cannot widen or narrow what the persona is taken to speak.
 */
export function normaliseLanguage(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/** Whether a normalised code is one this module has phrasing for. */
export function isPersonaLanguage(code: string | null): code is PersonaLanguage {
  return code !== null && (PERSONA_LANGUAGES as readonly string[]).includes(code);
}

/** The raw shape a persona arrives in — a row, or a wire payload. */
export interface PersonaSource {
  tone?: string | null;
  languages?: readonly string[] | null;
  /**
   * The `persona` JSON column, which is where `answerLength` is stored
   * alongside anything else an admin has set (a signature, say).
   */
  persona?: unknown;
  /** An explicit answer length, which wins over the JSON when present. */
  answerLength?: string | null;
}

/** Normalise whatever was stored into a persona the rest of this module trusts. */
export function readPersona(source: PersonaSource | null | undefined): Persona {
  if (!source) return NO_PERSONA;

  const declared =
    source.answerLength !== undefined ? source.answerLength : answerLengthFromJson(source.persona);

  const languages: string[] = [];
  for (const entry of source.languages ?? []) {
    const code = normaliseLanguage(entry);
    if (code && !languages.includes(code)) languages.push(code);
  }

  return {
    tone: normaliseTone(source.tone),
    languages,
    answerLength: isAnswerLength(declared) ? declared : null,
  };
}

function answerLengthFromJson(persona: unknown): string | null {
  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) return null;
  const value = (persona as Record<string, unknown>)['answerLength'];
  return typeof value === 'string' ? value : null;
}

function isAnswerLength(value: string | null | undefined): value is AnswerLength {
  return typeof value === 'string' && (ANSWER_LENGTHS as readonly string[]).includes(value);
}

/** True when the persona asks for nothing and can be skipped entirely. */
export function personaIsEmpty(persona: Persona): boolean {
  return persona.tone === null && persona.languages.length === 0 && persona.answerLength === null;
}

/**
 * Which of the five languages a message is written in, or `null` for "cannot
 * tell".
 *
 * The `null` is the important return value. A three-word message, a bare order
 * number or a language this detector does not know all produce it, and callers
 * must treat it as *no information* — never as "not one of ours". Guessing
 * "unsupported" from silence would refuse to answer customers whose language is
 * perfectly well supported, which is a worse failure than the one this exists
 * to fix.
 */
export function detectLanguage(message: string): PersonaLanguage | null {
  const words = new Set(
    message
      .toLowerCase()
      .split(/[^\p{L}\p{M}']+/u)
      .filter(Boolean),
  );
  if (words.size === 0) return null;

  let best: PersonaLanguage | null = null;
  let bestScore = 0;
  let runnerUp = 0;

  for (const language of PERSONA_LANGUAGES) {
    let score = 0;
    for (const stopword of LANGUAGE_STOPWORDS[language]) {
      if (words.has(stopword)) score += 1;
    }
    const mark = LANGUAGE_MARKS[language];
    if (mark && mark.test(message)) score += 1;

    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = language;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // A tie is not a detection: two languages sharing the same small words is
  // exactly the case where guessing costs a customer an answer.
  if (bestScore < LANGUAGE_MIN_SCORE || bestScore === runnerUp) return null;
  return best;
}

/** What the persona's language declaration says about one incoming message. */
export interface LanguageVerdict {
  /** The language the message was written in, as far as it can be told. */
  detected: PersonaLanguage | null;
  /**
   * The language the reply should be phrased in, or `null` when there is no
   * basis to pick one.
   */
  answerIn: PersonaLanguage | null;
  /**
   * True only when the message is *confidently* in a language the persona
   * declares it does not speak. An undetectable message is never unsupported.
   */
  unsupported: boolean;
}

/**
 * Decide whether this persona can serve this message, and in which language.
 *
 * The unsupported case needs all three of: a declaration (an empty `languages`
 * is "no claim made", not "speaks nothing"), a confident detection, and a
 * mismatch. Anything less resolves to "carry on" — the persona is a description
 * of an assistant, not a filter customers should fall through by accident.
 */
export function personaLanguageVerdict(message: string, persona: Persona): LanguageVerdict {
  const detected = detectLanguage(message);
  const declared = persona.languages;
  const unsupported = declared.length > 0 && detected !== null && !declared.includes(detected);

  if (unsupported) return { detected, answerIn: null, unsupported: true };

  if (detected !== null) return { detected, answerIn: detected, unsupported: false };

  // Nothing detected: fall back to the first declared language this module can
  // actually phrase, so a persona that says "Turkish" still sounds Turkish when
  // the customer's message was too short to read.
  const fallback = declared.find(isPersonaLanguage) ?? null;
  return { detected: null, answerIn: fallback, unsupported: false };
}

/** The result of shaping, plus a record of what the persona changed. */
export interface ShapedAnswer {
  text: string;
  /**
   * One short phrase per effect that actually fired, for the skill run log.
   * Empty when the persona changed nothing — which is the whole story an admin
   * needs when they wonder why the setting appears to do nothing.
   */
  notes: string[];
}

/**
 * Shape retrieved passages into the reply this persona would give.
 *
 * The passages are what retrieval found, best first. Only these get shaped:
 * a fixed `send_message` reply and a `request_info` prompt are text an admin
 * typed by hand, and trimming or prefixing those would rewrite their words
 * behind their back. The persona shapes what the assistant *composes*, never
 * what a human wrote — see `#### K06.4` for the decision.
 */
export function shapeAnswer(
  passages: readonly string[],
  persona: Persona,
  options: { language?: PersonaLanguage | null } = {},
): ShapedAnswer {
  const notes: string[] = [];
  const available = passages.map((passage) => passage.trim()).filter(Boolean);
  if (available.length === 0) return { text: '', notes };

  const budget = persona.answerLength ? ANSWER_BUDGETS[persona.answerLength] : null;
  const allowed = budget ? budget.passages : DEFAULT_ANSWER_PASSAGES;
  const used = available.slice(0, allowed);
  if (budget && used.length > DEFAULT_ANSWER_PASSAGES) {
    notes.push(`${persona.answerLength}: stitched ${used.length} passages`);
  }

  let text = used.join(' ');

  if (budget) {
    const sentences = splitSentences(text);
    if (sentences.length > budget.sentences) {
      text = sentences.slice(0, budget.sentences).join('').trimEnd();
      notes.push(
        `${persona.answerLength}: kept ${budget.sentences} of ${sentences.length} sentences`,
      );
    }
    if (text.length > budget.maxChars) {
      text = truncateAtWord(text, budget.maxChars);
      notes.push(`${persona.answerLength}: truncated to ${budget.maxChars} characters`);
    }
  }

  const language = normaliseLanguage(options.language ?? null);
  const opener = personaOpener(persona.tone, language);
  if (opener) {
    text = `${opener} ${text}`;
    notes.push(`${persona.tone} opener (${language})`);
  }

  return { text, notes };
}

/**
 * The phrase this tone opens with in this language, or `''` for none.
 *
 * `''` covers three cases on purpose — no tone set, the `neutral` tone, and a
 * language with no phrasing — because all three mean the same thing to the
 * caller: say nothing extra.
 */
export function personaOpener(tone: PersonaTone | null, language: string | null): string {
  if (!tone) return '';
  const code = normaliseLanguage(language);
  if (!isPersonaLanguage(code)) return '';
  return TONE_OPENERS[tone][code];
}

/**
 * Split into sentences, keeping every character.
 *
 * The pieces carry their own punctuation and trailing space so re-joining a
 * prefix of them reproduces the original text exactly, rather than a
 * re-spaced approximation of it.
 */
function splitSentences(text: string): string[] {
  return text.match(/[^.!?]*[.!?]+[\s]*|[^.!?]+$/g) ?? [text];
}

/**
 * Cut to at most `max` characters without splitting a word.
 *
 * The one case where the ceiling gives way is a first word longer than the
 * whole budget: half a word is not a shorter answer, it is a broken one, so the
 * word survives and the budget does not.
 */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  // One character is reserved for the ellipsis that says the answer continues.
  const head = text.slice(0, max - 1);
  // When the character just past the cut is whitespace the head already ends on
  // a whole word; otherwise the trailing partial word has to go.
  const endsWhole = /\s/u.test(text.charAt(max - 1));
  const cut = (endsWhole ? head : head.replace(/\s+\S*$/u, '')).trimEnd();
  // `cut === head` on a head holding no whitespace at all means the very first
  // word is longer than the entire budget. Half a word is not a shorter answer,
  // it is a broken one, so the word wins and the ceiling gives way.
  if (cut !== '' && (endsWhole || cut !== head)) return `${cut}…`;
  const firstWord = /^\S+/u.exec(text);
  return firstWord ? `${firstWord[0]}…` : text.slice(0, max);
}
