/**
 * The platform's locked compliance rules, G1–G19 (tm 301.1 · SiyahTuş
 * analysis AI-08; the research's guardrail list, `kaynaklar/igaming-ai-
 * arastirma.md` §4.2; K13 for G14).
 *
 * In iGaming one wrong sentence from the AI is a licence risk: a bonus offered
 * to a player asking to self-exclude, game advice to a minor, "it will land in
 * 5 minutes", a hint that an AML check is running. Telling the model "don't"
 * is not enough, so every rule here is three things at once:
 *
 *   - a short imperative line for the top of the prompt (`prompt`, AI-07's
 *     layer 1, `platform_locked`);
 *   - a lexicon the input scan runs on the player's message before the
 *     understanding call (`input`) — no model, so a model outage or a
 *     misreading cannot let "kendimi öldüreceğim" through;
 *   - a lexicon the output check runs on every draft before it is sent
 *     (`output`): "kontrol ettim", "hesabınıza geçti", "garanti", a time
 *     promise without "genellikle"…
 *
 * The catalogue lives in code, not in a table: a workspace cannot switch a rule
 * off or loosen it (it may only add stricter ones, `ai_guardrail_rules`), and
 * every turn records the {@link PLATFORM_GUARDRAILS_VERSION} it ran under, as
 * every published AI package records it as `guardrail_catalog_version` (ADR-14b
 * §2.12). Change a rule, a line or a pattern here and the version moves with
 * it — `guardrails.test.ts` pins a fingerprint of the whole catalogue.
 *
 * The lexicons are regular expressions over {@link normalizeGuardrailText}'s
 * output, not over what the player typed: lower-case ASCII (Turkish letters
 * folded, accents stripped), a letter repeated three times or more squashed to
 * one, zero-width characters and apostrophes dropped, words split by one space,
 * clauses by `,` and sentences by a newline. So "HESABIMI KAPATIIIN",
 * "hesabimi kapatin" and "hesabımı kapatın" are one string, and a phrase never
 * matches across a comma or a full stop. Every pattern names the request or
 * the claim, in the forms that make it one, and leaves out the forms that do
 * not: "hesabımı kapatın" is G1, "hesabımı neden kapattınız?" and "hesabımı
 * kapatmayın" are not; "garanti ediyoruz" is G7, "garanti veremiyoruz" and
 * "Garanti Bankası" are not.
 *
 * What this module does not do: decide. {@link scanGuardrails} says which
 * patterns matched and quotes the player's or the draft's own words; the turn
 * (`conversation/guardrails/`, tm 301.3) combines that with the understanding
 * call's risk signals, the conversation's risk flags and the workspace's
 * settings, acts, and records the hit (`ai_guardrail_hits`).
 */

/** Bump with any change to the catalogue below — a rule, a line, a pattern. */
export const PLATFORM_GUARDRAILS_VERSION = '2026-10-19.1';

export const GUARDRAIL_IDS = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  'G7',
  'G8',
  'G9',
  'G10',
  'G11',
  'G12',
  'G13',
  'G14',
  'G15',
  'G16',
  'G17',
  'G18',
  'G19',
] as const;
export type GuardrailId = (typeof GUARDRAIL_IDS)[number];

export function isGuardrailId(value: unknown): value is GuardrailId {
  return (GUARDRAIL_IDS as readonly unknown[]).includes(value);
}

/** The research's five groups (§4.2): what a rule protects. */
export const GUARDRAIL_CATEGORIES = [
  'responsible_gaming',
  'money',
  'data_security',
  'legal',
  'transparency',
] as const;
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number];

/**
 * What a rule makes the turn do (AI-08):
 *
 *   - `force_handoff` — the AI stops and hands over (AI-09), to the rule's
 *                       target with its priority;
 *   - `block_output`  — a draft that breaks it is rewritten once, then
 *                       replaced by a safe text and handed over;
 *   - `block_promo`   — on a risk-flagged conversation, no promotion in the
 *                       prompt or the draft (G4);
 *   - `warn`          — recorded for QA, nothing blocked (G18).
 *
 * A rule with an `output` lexicon blocks a draft that matches it whatever its
 * primary action: G13 hands over on the player's words and also keeps the AI
 * from naming an AML check.
 */
export const GUARDRAIL_ACTIONS = ['force_handoff', 'block_output', 'block_promo', 'warn'] as const;
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number];

/** Where a hit was found (`ai_guardrail_hits.stage`): the player's message or the AI's draft. */
export const GUARDRAIL_STAGES = ['input', 'output'] as const;
export type GuardrailStage = (typeof GUARDRAIL_STAGES)[number];

/** The languages a rule's title, line and lexicons are written in. */
export const GUARDRAIL_LANGS = ['tr', 'en'] as const;
export type GuardrailLang = (typeof GUARDRAIL_LANGS)[number];

/**
 * The hand-over's priority (AI-12 §3, `threads.priority`): `urgent` for self-
 * harm, a suspected minor and a self-exclusion request; `normal` otherwise —
 * `high` is AI-12's for a repeat contact or an angry player, no rule's.
 */
export const GUARDRAIL_PRIORITIES = ['urgent', 'high', 'normal'] as const;
export type GuardrailPriority = (typeof GUARDRAIL_PRIORITIES)[number];

/**
 * Where a rule's hand-over goes (AI-12's reason routes, `handoff_routes.
 * match_key`): G1/G2/G3/G6 → responsible gaming, G13 → KYC and risk, G15 →
 * complaints. G5 goes to responsible gaming by default; AI-12 lets a workspace
 * send it to KYC instead.
 */
export const GUARDRAIL_HANDOFF_TOPICS = ['responsible_gaming', 'kyc_risk', 'complaints'] as const;
export type GuardrailHandoffTopic = (typeof GUARDRAIL_HANDOFF_TOPICS)[number];

/** The hand-over reason codes a rule hands over with (AI-09's list, tm 303). */
export const GUARDRAIL_HANDOFF_REASONS = [
  'guardrail_rg',
  'guardrail_self_harm',
  'guardrail_minor',
  'guardrail_account_security',
  'guardrail_complaint',
  'player_request',
  'no_knowledge',
  'abuse',
  'guardrail_output_block',
] as const;
export type GuardrailHandoffReason = (typeof GUARDRAIL_HANDOFF_REASONS)[number];

/** The reason when a draft is still in breach after its one rewrite (AI-08 §8). */
export const GUARDRAIL_OUTPUT_BLOCK_REASON: GuardrailHandoffReason = 'guardrail_output_block';

/**
 * What the player is told when a draft is still in breach after its rewrite
 * and the step has no verbatim text of its own (AI-08 §8).
 */
export const GUARDRAIL_SAFE_TEXT: Readonly<Record<GuardrailLang, string>> = Object.freeze({
  tr: 'Bilgilerinizi ilgili ekibimize iletiyorum.',
  en: 'I am passing your details on to the team that handles this.',
});

/**
 * The risk flags a rule's own hit raises on the conversation — names from
 * AI-27's flag types (#302), the same as `AI_RETURN_BLOCKING_RISK_FLAGS`.
 */
export const GUARDRAIL_RISK_FLAGS = [
  'self_exclusion_request',
  'rg_signal',
  'self_harm',
  'underage_suspected',
  'account_takeover_suspected',
  'fraud_suspected',
  'complaint_formal',
  'abusive',
] as const;
export type GuardrailRiskFlag = (typeof GUARDRAIL_RISK_FLAGS)[number];

/**
 * The understanding call's risk signals (`UNDERSTAND_RISKS`, `conversation/
 * understand.ts` — same names, same order) and the flag each one raises.
 */
export const GUARDRAIL_UNDERSTAND_RISKS = [
  'self_exclusion',
  'rg_signal',
  'self_harm',
  'minor',
  'fraud_aml',
  'complaint_formal',
  'account_takeover',
] as const;
export type GuardrailUnderstandRisk = (typeof GUARDRAIL_UNDERSTAND_RISKS)[number];

export const UNDERSTAND_RISK_FLAGS: Readonly<Record<GuardrailUnderstandRisk, GuardrailRiskFlag>> =
  Object.freeze({
    self_exclusion: 'self_exclusion_request',
    rg_signal: 'rg_signal',
    self_harm: 'self_harm',
    minor: 'underage_suspected',
    fraud_aml: 'fraud_suspected',
    complaint_formal: 'complaint_formal',
    account_takeover: 'account_takeover_suspected',
  });

/**
 * The workspace text a rule sends or answers from (`ai_guardrail_settings`;
 * the access information is AI-13's setting, K13): G3 sends the crisis text
 * verbatim, before the hand-over and whatever the hour; G15 gives the
 * complaint procedure; G14 answers only from the access information.
 */
export const GUARDRAIL_TENANT_TEXTS = ['crisis', 'complaint', 'access_info'] as const;
export type GuardrailTenantText = (typeof GUARDRAIL_TENANT_TEXTS)[number];

/** An evidence quote is cut to this many characters (as the understanding call's). */
export const GUARDRAIL_QUOTE_MAX = 200;

/**
 * One pattern of a lexicon, over normalised text. `unless`, when present, is
 * looked for in the same sentence: a match beside it is no breach — G7's time
 * promise next to "genellikle" or "politikamıza göre".
 */
export interface GuardrailPattern {
  readonly re: RegExp;
  readonly unless?: RegExp;
}

export type GuardrailLexicon = Readonly<Record<GuardrailLang, readonly GuardrailPattern[]>>;

export interface PlatformGuardrail {
  readonly id: GuardrailId;
  readonly title: Readonly<Record<GuardrailLang, string>>;
  /** The rule as one imperative line for the prompt's locked layer. */
  readonly prompt: Readonly<Record<GuardrailLang, string>>;
  readonly category: GuardrailCategory;
  readonly action: GuardrailAction;
  /** Null: the hand-over follows the procedure's own routing. */
  readonly target: GuardrailHandoffTopic | null;
  readonly priority: GuardrailPriority;
  readonly handoffReason: GuardrailHandoffReason | null;
  /** The flag a hit raises; null where the signal names it (G13: takeover or fraud). */
  readonly riskFlag: GuardrailRiskFlag | null;
  /** The understanding call's signals that trigger the rule on their own. */
  readonly understandRisks: readonly GuardrailUnderstandRisk[];
  /**
   * Whether an input-lexicon hit triggers the rule without the understanding
   * call agreeing. True where a false positive costs only a hand-over and a
   * miss costs the player (G1, G3, G5 — AI-08 §2), and where the words are the
   * request itself (G6, G16, G19). Otherwise the hit is evidence for the
   * understanding call, and is recorded.
   */
  readonly lexiconAlone: boolean;
  /** Applies on every turn, or only once the conversation carries a risk flag (G4). */
  readonly appliesWhen: 'always' | 'risk_flagged';
  readonly tenantText: GuardrailTenantText | null;
  /** G19: calm warnings before the hand-over (AI-09 `abuse_warnings`, a workspace setting). */
  readonly warningsBeforeHandoff: number | null;
  readonly input: GuardrailLexicon | null;
  readonly output: GuardrailLexicon | null;
}

// ---------------------------------------------------------------------------
// Normalisation.
// ---------------------------------------------------------------------------

/**
 * Text in the form the lexicons are written against, and where each of its
 * characters came from: `starts[i]`/`ends[i]` are the original range of
 * `text[i]`, so a match can be quoted in the writer's own words.
 */
export interface NormalizedGuardrailText {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/**
 * Dropped without a trace: the soft hyphen, the zero-width space, non-joiner,
 * joiner and word joiner, the BOM, and the apostrophes and accents typed in
 * their place. Built from code points so the source shows what it holds.
 */
const DROPPED = charClass([
  0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x27, 0x2018, 0x2019, 0x2bc, 0x60, 0xb4,
]);

/** A character class of these code points, each written as a `\uXXXX` escape. */
/*@__NO_SIDE_EFFECTS__*/
function charClass(codes: readonly number[]): RegExp {
  return new RegExp(
    `[${codes.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('')}]`,
  );
}
/** Ends a sentence wherever it stands (a full stop only before a non-letter, below). */
const SENTENCE_END = /[\n\r!?;…؟。]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** After "10.": a space, then a lower-case word — the ordinal, not a full stop. */
const ORDINAL_NEXT = /^[ \t]+\p{Ll}/u;
const COMBINING = /\p{M}/gu;
const KEPT = /[a-z0-9%]/;
/** Letters with no decomposition to ASCII. */
const LETTERS: Readonly<Record<string, string>> = {
  ı: 'i',
  ə: 'e',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
};
const SEPARATOR_RANK = { '': 0, ' ': 1, ',': 2, '\n': 3 } as const;
type Separator = keyof typeof SEPARATOR_RANK;

function foldChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (ch.length === 1 && code < 128) return ch.toLowerCase();
  const out = ch.normalize('NFKC').toLocaleLowerCase('tr').normalize('NFD').replace(COMBINING, '');
  return [...out].map((c) => (c.charCodeAt(0) < 128 ? c : (LETTERS[c] ?? c))).join('');
}

/**
 * Lower-cased with Turkish rules, Turkish letters folded to ASCII (ş→s, ı→i,
 * ğ→g, ü→u, ö→o, ç→c, â→a), compatibility forms unified (NFKC: "１６" → "16"),
 * accents stripped; zero-width characters and apostrophes dropped
 * ("Curaçao'ya" → "curacaoya"); a letter repeated three times or more squashed
 * to one ("kapatıııın" → "kapatin"); `%` and digits kept. Everything else
 * separates: a full stop before a non-letter, `!`, `?`, `;`, `…` and a line
 * break end a sentence (`\n`); a comma not between digits ends a clause (`,`);
 * the rest is one space. Nothing leads or trails.
 */
export function normalizeGuardrailText(raw: string): NormalizedGuardrailText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let pending: Separator = '';
  let pendingStart = 0;
  let pendingEnd = 0;

  const separate = (kind: Separator, start: number, end: number) => {
    if (SEPARATOR_RANK[kind] <= SEPARATOR_RANK[pending]) return;
    pending = kind;
    pendingStart = start;
    pendingEnd = end;
  };
  const emit = (c: string, start: number, end: number) => {
    if (pending !== '' && chars.length > 0) {
      chars.push(pending);
      starts.push(pendingStart);
      ends.push(pendingEnd);
    }
    pending = '';
    chars.push(c);
    starts.push(start);
    ends.push(end);
  };

  for (let i = 0; i < raw.length;) {
    const point = raw.codePointAt(i) ?? 0;
    const start = i;
    const end = i + (point > 0xffff ? 2 : 1);
    const ch = raw.slice(start, end);
    i = end;
    if (DROPPED.test(ch)) continue;
    if (SENTENCE_END.test(ch)) {
      separate('\n', start, end);
      continue;
    }
    if (ch === '.') {
      // Inside a word or a number ("site.com", "2.500"), or a Turkish ordinal
      // ("10. sınıf"): a space. Otherwise the sentence ends.
      const ordinal =
        /[0-9]/.test(raw.charAt(start - 1)) && ORDINAL_NEXT.test(raw.slice(end, end + 8));
      separate(ordinal || LETTER_OR_DIGIT.test(raw.charAt(end)) ? ' ' : '\n', start, end);
      continue;
    }
    if (ch === ',') {
      const between = /[0-9]/.test(chars[chars.length - 1] ?? '') && /[0-9]/.test(raw.charAt(end));
      separate(between && pending === '' ? ' ' : ',', start, end);
      continue;
    }
    const folded = foldChar(ch);
    if (folded === '') {
      // A combining mark typed on its own belongs to the letter before it.
      if (pending === '' && ends.length > 0) ends[ends.length - 1] = end;
      continue;
    }
    for (const c of folded) {
      if (KEPT.test(c)) emit(c, start, end);
      else separate(' ', start, end);
    }
  }

  // A letter three times or more in a row is one letter ("evettt", "yaaa").
  const text: string[] = [];
  const outStarts: number[] = [];
  const outEnds: number[] = [];
  for (let k = 0; k < chars.length;) {
    const c = chars[k] as string;
    let run = 1;
    while (chars[k + run] === c) run += 1;
    const squash = run >= 3 && c >= 'a' && c <= 'z';
    const kept = squash ? 1 : run;
    for (let r = 0; r < kept; r += 1) {
      text.push(c);
      outStarts.push(starts[k + r] as number);
      outEnds.push(ends[squash ? k + run - 1 : k + r] as number);
    }
    k += run;
  }
  return { text: text.join(''), starts: outStarts, ends: outEnds };
}

/** {@link normalizeGuardrailText}'s text alone — for writing and comparing phrases. */
export function foldGuardrailText(raw: string): string {
  return normalizeGuardrailText(raw).text;
}

// ---------------------------------------------------------------------------
// Lexicon building blocks. Every source is lower-case ASCII: it runs on
// normalised text, and a Turkish letter in a pattern could never match.
//
// The builders are marked side-effect free (`__NO_SIDE_EFFECTS__`, and
// `__PURE__` on the few other top-level constructions) so a bundle that never
// scans — the widget's loader imports `@siyahtus/types` for one helper — drops
// the whole catalogue instead of shipping ~7 KB of patterns (bundle-size.test).
// ---------------------------------------------------------------------------

/** A pattern from parts; string parts are regex source. */
/*@__NO_SIDE_EFFECTS__*/
function rx(...parts: ReadonlyArray<string | RegExp>): RegExp {
  return new RegExp(parts.map((part) => (typeof part === 'string' ? part : part.source)).join(''));
}

/*@__NO_SIDE_EFFECTS__*/
function lexicon(
  tr: ReadonlyArray<RegExp | GuardrailPattern>,
  en: ReadonlyArray<RegExp | GuardrailPattern>,
): GuardrailLexicon {
  const wrap = (list: ReadonlyArray<RegExp | GuardrailPattern>) =>
    Object.freeze(list.map((p) => Object.freeze(p instanceof RegExp ? { re: p } : { ...p })));
  return Object.freeze({ tr: wrap(tr), en: wrap(en) });
}

/** Up to n words in between, within one clause. */
/*@__NO_SIDE_EFFECTS__*/
function gap(n: number): string {
  return `( [a-z0-9]+){0,${n}}`;
}

// G1 — what to close, and "close"/"delete"/"freeze"/"cancel" in the forms
// that ask for it: not the negative ("kapatmayın"), the past ("kapattınız",
// "kapatmış"), the passive past ("kapatıldı"), a converb ("kapatıp") or "…
// istemiyorum". The causative ("kapattırmak") and the gerund ("kapatmayı
// düşünüyorum") stay.
const G1_OBJECT = /(hesab(i|im|imi|imin|imiz|imizi)|uyelig(im|imi|imin)|uyelik)/;
const G1_VERB = rx(
  '(',
  /kapat(?!t(?!ir)|ma(y(i?n|iniz|acak|acag|alim|sin|iz|abil)|[dmz])|mi(s|yor)|il(di|mis|iyor|ma[dmyz])|ip\b|inca|arak|mak istem)/,
  '|',
  /sil(?!d|me(y(i?n|iniz|ecek|eceg|elim|sin|iz|ebil)|[dmz])|mi(s|yor)|in(di|mis|iyor|me[dmyz])|ip\b|ince|erek|mek istem)/,
  '|',
  /dondur(?!d|ma(y(i?n|iniz|acak|acag|alim|sin|iz|abil)|[dmz])|mu(s|yor)|ul(du|mus|uyor|ma[dmyz])|up\b|unca|arak|mak istem)/,
  '|',
  /iptal (edin|ediniz|eder|edebilir|etmek(?! istem)|etmenizi|edilsin|edilmesini|edilmeli|et\b)/,
  ')',
);
/** "… istemiyorum" / "istemem" anywhere in the word that follows. */
const NOT_WANTED = /(?![a-z]* istem)/;

// G7 — the hedges that turn a time into an estimate (AI-08 §6c).
const HEDGE_TR =
  /\b(genellikle|genelde|cogunlukla|cogu zaman|cogu durumda|politikamiz(a|in|ca)|ortalama|tahmini|normalde|normal sartlarda|yaklasik|beklenir|beklenmektedir|bekleniyor)\b/;
const HEDGE_EN =
  /\b(usually|typically|generally|normally|on average|in most cases|most of the time|according to our policy|per our policy|estimated|approximately|expected to)\b/;
const PROMISED_TR =
  /(yatar|yatacak|yatacaktir|yatmis olur|gelir|gelecek|gelecektir|gecer|gececek|gecmis olur|odenir|odenecek|odenecektir|yansir|yansiyacak|yansimis olur|tamamlanir|tamamlanacak|onaylanir|onaylanacak|aktarilir|aktarilacak|cozulur|cozulecek|islenir|islenecek|hesabiniza gecer)\b/;
const DURATION_EN = /\d+ (to \d+ )?(minutes?|mins?|hours?|hrs?|days?|business days?|working days?)/;
const LANDS_EN =
  /(credited|arrive|reflected|paid|processed|approved|completed|cleared|show up|land)/;

// G11 — a secret named as the object of a request, then the request.
const SECRET_TR = rx(
  '(',
  /sifre(niz|nizi)|parola(niz|nizi)|sms (kodu|kodunu|kodunuzu|ile gelen kodu)/,
  '|',
  /(dogrulama|onay|guvenlik|tek kullanimlik) (kodu|kodunu|kodunuzu|sifresini|sifrenizi)/,
  '|',
  /otp( kodu| kodunu| kodunuzu)?|cvv( kodu| kodunu| kodunuzu| numarasini)?|cvc( kodu| kodunu)?/,
  '|',
  /kart(inizin)? (numaranizin )?(tamamini|tam numarasini)|kart numaranizi/,
  '|',
  /(internet|mobil) bankacilik (sifrenizi|bilgilerinizi|sifreniz)/,
  '|',
  /seed( phrase| ifadenizi| kelimelerinizi)?|kurtarma (kelimelerinizi|ifadenizi)/,
  '|',
  /(ozel|gizli) anahtar(inizi)?|private key|cuzdan (sifrenizi|anahtarinizi)/,
  ')\\b',
);
/**
 * The request: the imperative, the polite question, "-menizi rica ediyorum".
 * Not the negative ("paylaşmayın") and not "girin" — telling the player to
 * type the password into the login page is help, not a request for it.
 */
const ASK_TR = rx(
  '(',
  [
    'yazin|yaziniz|yazar misiniz|yazabilir misiniz|yazmanizi',
    'paylasin|paylasiniz|paylasir misiniz|paylasabilir misiniz|paylasmanizi',
    'iletin|iletiniz|iletir misiniz|iletebilir misiniz|iletmenizi',
    'gonderin|gonderiniz|gonderir misiniz|gonderebilir misiniz|gondermenizi',
    'soyleyin|soyleyiniz|soyler misiniz|soyleyebilir misiniz|soylemenizi',
    'verin|veriniz|verir misiniz|verebilir misiniz|vermenizi',
    'belirtin|belirtiniz|belirtir misiniz|belirtebilir misiniz|belirtmenizi',
    'ogrenebilir miyim|alabilir miyim|rica ediyorum',
  ].join('|'),
  ')\\b',
);

// ---------------------------------------------------------------------------
// The catalogue.
// ---------------------------------------------------------------------------

const G1: PlatformGuardrail = {
  id: 'G1',
  title: {
    tr: 'Kendini oyundan men etme ve hesap kapatma',
    en: 'Self-exclusion and account closure',
  },
  prompt: {
    tr: 'Oyuncu kendini oyundan men etmek, ara vermek, hesabını kapatmak ya da oynamayı bırakmak isterse ikna etme, alternatif sunma; aynı turda sorumlu oyun ekibine devret.',
    en: 'If the player asks to self-exclude, take a break, close the account or stop playing, do not persuade and offer no alternative; hand over to the responsible-gaming team in the same turn.',
  },
  category: 'responsible_gaming',
  action: 'force_handoff',
  target: 'responsible_gaming',
  priority: 'urgent',
  handoffReason: 'guardrail_rg',
  riskFlag: 'self_exclusion_request',
  understandRisks: ['self_exclusion'],
  lexiconAlone: true,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      rx(/\b/, G1_OBJECT, gap(3), ' ', G1_VERB),
      /\b(hesap|uyelik) (kapatma|silme|dondurma|iptal)/,
      /\bkendimi( [a-z]+){0,2} (engelle|yasakla|kisitla|men et|men ettir|disla)(?![a-z]* istem|m[ae](y(i?n|iniz)|[dz])|miyor)/,
      /\bbeni( [a-z]+){0,2} (engelleyin|engelleyiniz|engelleyebilir|engellemenizi|engellemelisiniz|engeller misiniz|yasaklayin|yasaklayiniz|yasaklayabilir|yasaklamanizi|men edin|men ediniz|men edebilir)/,
      rx(
        /\b(ara|mola) ver(mek|meye|meyi|mem|meliyim|elim|eyim|in|iniz|ebilir|menizi|ilsin|ilmesini|iyorum|ecegim)/,
        NOT_WANTED,
      ),
      rx(/\boynama(yi|ya|mi)? (birak|kes|son ver|ara ver)/, NOT_WANTED),
      /\boynamak istemiyorum/,
      /\boynamayacag(im|iz)\b/,
      rx(
        /\b(kumar|kumari|kumardan|bahis|bahsi|bahisten|bahis oynamayi) (birak|kes|son ver|uzak dur|uzaklas)/,
        NOT_WANTED,
      ),
      /\bself ?exclu/,
      /\bkendini (men et|disla|engelle|kisitla)/,
    ],
    [
      /(?<!\b(did|have|has|why) (you|they|u) )\b(close|delete|deactivate|terminate|suspend|freeze|cancel|shut down) (my|this|the) account/,
      /\bself ?exclu/,
      /\b(take|taking|need|want) (a )?break from (gambling|playing|betting|gaming)/,
      /\b(want|need|like) to take a break\b/,
      /\bcool(ing)? ?off\b/,
      /\btime ?out (period|from (gambling|playing|betting))/,
      /\b(stop|quit) (gambling|betting|playing)\b/,
      /\b(block|ban|exclude) (me|myself)\b/,
      /\b(dont|do not|never) want to (gamble|bet|play)( here)? (anymore|again|ever)/,
    ],
  ),
  output: null,
};

const G2: PlatformGuardrail = {
  id: 'G2',
  title: { tr: 'Problemli kumar belirtileri', en: 'Signs of problem gambling' },
  prompt: {
    tr: 'Kayıp kovalama, borçla ya da krediyle oynama, maaşını ya da kirasını yatırma, kontrol kaybı ya da çaresizlik belirtisinde empatiyle yanıt ver, limit araçlarını ve yardım kaynağını an, insana devret.',
    en: 'On signs of chasing losses, gambling with debt or a loan, staking a salary or rent, losing control or despair, answer with empathy, mention the limit tools and where to get help, and hand over to a person.',
  },
  category: 'responsible_gaming',
  action: 'force_handoff',
  target: 'responsible_gaming',
  priority: 'normal',
  handoffReason: 'guardrail_rg',
  riskFlag: 'rg_signal',
  understandRisks: ['rg_signal'],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      /\b(kayb(im|imi|ettigimi|ettiklerimi|ettigim parayi)|zarar(im|imi))( [a-z]+){0,2} (geri (al|kazan|cikar|getir)|cikar|telafi|kurtar|kapat)/,
      /\bborc(um|umu|lar(im|imi)|lan(dim|mis|iyorum)|la|lu|a (gir|bat)| (aldim|alarak|alip|icinde|batagi))/,
      /\bkredi (cek(tim|ip|erek|ecegim|tik|mek zorunda)|kullan(dim|ip|arak))/,
      /\b(ihtiyac|tuketici|banka) kredisi( [a-z]+){0,2} (yatir|cek|kullan|aldim)/,
      /\b(kredi karti|kart) borc/,
      // A consonant stem takes "-ımı" ("maaşımı"), a vowel stem "-mı" ("kiramı").
      // Possessive required: "maaşımı yatırdım", not "maaş günü yatıracağım".
      /\b((maas|harclik|emekli maas|birikim)(im|imi|ini|imin|imizi|lerimi|larimi|i)|(kira|nafaka)(m|mi|min|mizi|yi)|kira paras(i|ini|imi))( [a-z]+){0,2} (yatir(?!il)|kaybet|bas(tim|iyorum)|gom|harca)/,
      /\bher seyimi (kaybet|yatir|bas)/,
      /\b(tum|butun) param(i|imi)? (kaybet|yatir|bitti|gitti|bas)/,
      /\bson param(di|i|imi|dir)?\b/,
      /\b(evimi|arabami|altinlarimi|telefonumu|esyalarimi|ziynetimi)( [a-z]+){0,1} (sattim|sattik|bozdurdum|rehin)/,
      /\b((kumar|bahis) )?bagimli(yim|siyim|si|lik|ligim|ligimi)/,
      /\b(oynamayi|kumari|bahsi|bahis oynamayi) birakamiyorum/,
      /\bkendimi (durduramiyorum|tutamiyorum|alamiyorum|kontrol edemiyorum)/,
      /\bkontrolumu kaybet/,
      /\b(esim|karim|kocam|ailem) (ogrenirse|beni birakacak|bosanacak|beni terk)/,
    ],
    [
      /\b(chase|chasing|win back|recover|recoup) (my )?loss(es)?\b/,
      /\bwin (it|my money|everything) back\b/,
      /\b(borrowed|borrowing) (money|cash)\b/,
      /\b(took|take|taking) (out )?a loan\b/,
      /\bpayday loan/,
      /\bin debt\b/,
      /\bmy debts?\b/,
      /\b(salary|rent|wages|paycheck|savings|pension)( money)?( [a-z]+){0,2} (on|into|in) (bets?|betting|gambling|this site|the site|casino|slots)\b/,
      /\b(lost|spent|gambled|blew) (all )?(my )?(salary|rent|savings|paycheck|pension|everything|life savings)\b/,
      /\b(cant|can not|cannot) (stop|control) (gambling|playing|betting|myself)\b/,
      /\baddict(ed|ion)?\b/,
      /\bgambling (problem|addiction)\b/,
      /\blost control\b/,
    ],
  ),
  output: null,
};

const G3: PlatformGuardrail = {
  id: 'G3',
  title: { tr: 'Kendine zarar verme', en: 'Self-harm' },
  prompt: {
    tr: 'Kendine zarar verme ya da intihar ifadesinde işletmenin kriz metnini olduğu gibi gönder ve acil öncelikle devret; konuyu başka bir şeye bağlama.',
    en: "On any expression of self-harm or suicide, send the business's crisis text exactly as written and hand over with urgent priority; do not steer the conversation elsewhere.",
  },
  category: 'responsible_gaming',
  action: 'force_handoff',
  target: 'responsible_gaming',
  priority: 'urgent',
  handoffReason: 'guardrail_self_harm',
  riskFlag: 'self_harm',
  understandRisks: ['self_harm'],
  lexiconAlone: true,
  appliesWhen: 'always',
  tenantText: 'crisis',
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      /\bintihar/,
      /\bkendimi (oldur|asa(cag|rim|yim)|as(mak|arim)|vur(acag|mak)|yak(acag|mak))/,
      /\bkendimi (kopru|balkon|pencere|cati|bina)[a-z]* (at|birak)/,
      /\bkendime (zarar|kiy)/,
      /\bcanima kiy/,
      /\bhayatima son ver/,
      /\bbile(gimi|klerimi) kes/,
      /\byasama(k|yi|ya)( [a-z]+){0,2} istemiyorum/,
      /\byasamak icin (bir )?(sebep|sebebim|neden|nedenim) (yok|kalmadi)/,
      /\b(yasamanin|hayatin|hayatimin) (bir )?anlami (yok|kalmadi)/,
      /\bolmek istiyorum/,
      /\bolsem (daha iyi|iyi olur|kurtulurum)/,
      /\bolmeyi dusun/,
      /\bbu dunyadan (gitmek|ayrilmak)/,
    ],
    [
      /\bsuicid/,
      /\bkill(ing)? myself\b/,
      /\bend (my life|it all)\b/,
      /\b(want|wanna|going) to die\b/,
      /\bself ?harm/,
      /\bhurt(ing)? myself\b/,
      /\b(dont|do not) want to (live|be alive|exist)\b/,
      /\bno reason to live\b/,
      /\bbetter off dead\b/,
      /\btake my (own )?life\b/,
    ],
  ),
  output: null,
};

const G4: PlatformGuardrail = {
  id: 'G4',
  title: { tr: 'Riskli oyuncuya promosyon yok', en: 'No promotion to a player at risk' },
  prompt: {
    tr: 'Konuşmada risk bayrağı varsa bonus, promosyon, kampanya ya da yatırım teşviki önerme.',
    en: 'When the conversation carries a risk flag, offer no bonus, promotion, campaign or encouragement to deposit.',
  },
  category: 'responsible_gaming',
  action: 'block_promo',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'risk_flagged',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\b(bonus|freespin|free spin|bedava (spin|bahis|dondurme)|kampanya|promosyon|cashback|kayip bonusu|cevrim|deneme bonusu|hos ?geldin bonusu|yatirim bonusu|turnuva|cekilis|hediye (bakiye|spin|bahis)|promo kodu|bonus kodu)/,
      /\b(yatirin|yatiriniz|yatirabilirsiniz|yatirim (yapin|yapiniz|yapabilirsiniz|yapmanizi|yapmayi deneyin|yaparsaniz)|para yatir(in|abilirsiniz|manizi)|bakiye (yukleyin|yukleyebilirsiniz)|hesabiniza (para|bakiye) (yukleyin|yatirin|ekleyin))\b/,
    ],
    [
      /\b(bonus(es)?|free ?spins?|free bets?|promo(tion)?s?|promo code|cashback|campaign|tournament|reload offer|welcome offer|deposit match|loyalty (points|reward))\b/,
      /\b(deposit now|make a deposit|deposit again|top up|you can deposit|please deposit|add funds)\b/,
    ],
  ),
};

const G5: PlatformGuardrail = {
  id: 'G5',
  title: { tr: 'Reşit olmayan şüphesi', en: 'Suspected minor' },
  prompt: {
    tr: 'Oyuncu 18 yaşından küçük olabileceğini gösterirse oyunlar, bahis ya da yatırım hakkında bilgi verme; acil öncelikle devret.',
    en: 'If the player may be under 18, give no information about games, betting or deposits; hand over with urgent priority.',
  },
  category: 'responsible_gaming',
  action: 'force_handoff',
  target: 'responsible_gaming',
  priority: 'urgent',
  handoffReason: 'guardrail_minor',
  riskFlag: 'underage_suspected',
  understandRisks: ['minor'],
  lexiconAlone: true,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      /\b(1[0-7]|[5-9]) ?yas(inday|imday)(im|iz)\b/,
      /\b(1[0-7]|[5-9]) yasinda (bir )?(ogrenciyim|cocugum|gencim|liseliyim)/,
      /\byasim (1[0-7]|[5-9])\b/,
      /\bon (bir|iki|uc|dort|bes|alti|yedi) ?yas(inday|imday)(im|iz)\b/,
      /\b(bes|alti|yedi|sekiz|dokuz) yas(inday|imday)(im|iz)\b/,
      /\b18 (yasindan|yasinin) (kucugum|altindayim|asagidayim)/,
      /\b18 (yasinda )?(degilim|olmadim)/,
      /\bresit (degilim|olmadim|sayilmam)/,
      /\byasim (tutmuyor|kucuk|yetmiyor)/,
      /\b(lisedeyim|liseliyim|ortaokuldayim|ortaokulluyum|lise ogrencisiyim|ortaokul ogrencisiyim|liseye gidiyorum|ortaokula gidiyorum)/,
      /\blise ([1-4]|bir|iki|uc|dort)(deyim|teyim|yim)\b/,
      /\blise (sondayim|son siniftayim|son sinif ogrencisiyim)/,
      /\b([5-9]|1[0-2]) siniftayim\b/,
    ],
    [
      /\b(im|i am) 1[0-7]\b( years old| yo| y o)?(?! ?(min|hour|hr|day|week|month|tl|try|usd|eur|euro|dollar|lira|percent|%|bet|times|x\b|k\b|[0-9]))/,
      /\b(im|i am) [5-9] years old\b/,
      /\b(im|i am) (a )?(minor|underage|under ?18|under the age|not 18|not an adult|in (high|middle) school|a (high|middle) school student)\b/,
      /\bi (go to|attend) (high|middle) school\b/,
      /\b(im|i am) in (7|8|9|10|11|12)(th)? grade\b/,
    ],
  ),
  output: null,
};

const G6: PlatformGuardrail = {
  id: 'G6',
  title: { tr: 'Limit yükseltme ve kaldırma', en: 'Raising or removing a limit' },
  prompt: {
    tr: 'Yatırım, kayıp ya da bahis limitini yükseltme veya kaldırma talebini kolaylaştırma ve söz verme; talebi insana devret.',
    en: 'Do not facilitate or promise a raised or removed deposit, loss or betting limit; hand the request over to a person.',
  },
  category: 'responsible_gaming',
  action: 'force_handoff',
  target: 'responsible_gaming',
  priority: 'normal',
  handoffReason: 'guardrail_rg',
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: true,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      /\b(yatirim|yatirma|para yatirma|kayip|bahis|kupon|sure|oturum|harcama|depozit|deposit|sorumlu oyun) limit(im|imi|ini|i|lerimi|leri|imin)?( [a-z]+){0,2} (yukselt|artir|arttir|kaldir|sifirla|genislet|iptal)/,
      /\b(?<!(cekim|cekme|kart|banka|papara|havale|kripto|eft|usdt|odeme) )limit(im|imi|lerim|lerimi)( [a-z]+){0,2} (yukselt|artir|arttir|kaldir|sifirla|genislet)/,
    ],
    [
      /\b(raise|increase|remove|lift|reset|cancel|up) (my |the )?(deposit|loss|betting|wager|wagering|spending|session|time|gambling) limits?\b/,
      /\b(deposit|loss|betting|wager|spending|session) limit (increase|removal|raise)\b/,
      /\b(raise|increase|remove|lift) my limits?\b/,
    ],
  ),
  output: null,
};

const G7: PlatformGuardrail = {
  id: 'G7',
  title: { tr: 'Söz, garanti ve süre taahhüdü yok', en: 'No promise, guarantee or committed time' },
  prompt: {
    tr: 'Ödeme, çekim, iade, bonus ya da bahis sonucu için söz, garanti ya da kesin süre verme; süreden bahsedeceksen "genellikle" ya da "politikamıza göre" de.',
    en: 'Give no promise, guarantee or firm time for a payment, withdrawal, refund, bonus or bet settlement; if you mention a time, say "usually" or "according to our policy".',
  },
  category: 'money',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\bgaranti(li|liyoruz|liyorum|dir|lidir|si|siyle|sidir)?\b(?! ?(veremi|veremey|veremem|veremez|verilmez|verilemez|edemi|edemey|edemem|edemez|edilemez|vermi|vermez|etmi|etmez|yok|degil|olmaz|bank|bbva))/,
      /\bkesin(likle)? (olarak )?(yatacak|yatar|yatacaktir|gelecek|gelir|gelecektir|gececek|gecer|gecektir|odenecek|odenir|onaylanacak|onaylanir|cozulecek|cozulur|alacaksiniz|alirsiniz|kazanacaksiniz|kazanirsiniz|iade edilecek)\b/,
      /\bsoz (veriyorum|veriyoruz|veririm|veririz)\b/,
      /(?<![a-z0-9])(% ?100|100 ?%|yuzde ?100)( [a-z]+){0,1} (garanti|kesin|yatar|yatacak|gelir|gecer|odenir|kazanc|kazan)/,
      {
        re: rx(
          /\b\d+ (dk|dakika|saat|gun|is gunu|hafta)( [a-z]+){0,1} (icinde|icerisinde|sonra|zarfinda|sonunda|kadar)( [a-z]+){0,3} /,
          PROMISED_TR,
        ),
        unless: HEDGE_TR,
      },
      { re: rx(/\ben gec \d+ (dk|dakika|saat|gun|is gunu)/), unless: HEDGE_TR },
      {
        re: rx(
          /\b(hemen|birazdan|aninda|kisa sure (icinde|icerisinde)|kisa surede|bugun icinde)( [a-z]+){0,3} /,
          PROMISED_TR,
        ),
        unless: HEDGE_TR,
      },
    ],
    [
      /(?<!\b(cannot|cant|can not|not|no|never|unable to|without) )\bguarantee(d|s)?\b/,
      /\b(definitely|certainly|100 ?%|for sure)( [a-z]+){0,2} (be credited|arrive|be paid|be approved|win)\b/,
      /\b(i|we) promise\b/,
      {
        re: rx(/\bwill (be )?/, LANDS_EN, /( [a-z]+){0,3} (within|in) /, DURATION_EN),
        unless: HEDGE_EN,
      },
      {
        re: rx(/\b(within|in) /, DURATION_EN, /( [a-z]+){0,4} will (be )?/, LANDS_EN),
        unless: HEDGE_EN,
      },
    ],
  ),
};

const G8: PlatformGuardrail = {
  id: 'G8',
  title: { tr: 'Doğrulanmamış hesap bilgisi yok', en: 'No unverified account status' },
  prompt: {
    tr: 'Hesap durumunu doğrulamış gibi konuşma: "kontrol ettim", "sistemde görünüyor", "hesabınıza geçti" deme.',
    en: 'Never speak as if you had verified the account: do not say "I checked", "it shows in the system" or "it has been credited".',
  },
  category: 'money',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\bkontrol (ettim|ettik|edildi|edilmistir|sagladim|sagladik|ettigim kadariyla|ettigimiz kadariyla)\b/,
      /\b(hesabiniz(i|a)|kayitlariniz(i|a)|islem(ler)?iniz(i|e)|bakiyeniz(i|e)|yatirim(lar)?iniz(i|a)|cekim(ler)?iniz(i|e)|talebiniz(i|e)|odemeniz(i|e)) (baktim|baktik|inceledim|inceledik)\b/,
      /\b(sistem(de|imizde|e gore)|kayitlar(da|imizda)|panel(de|imizde)|ekran(da|imda)|veritabani(nda|mizda))( [a-z]+){0,3} (gorun(uyor|muyor|mektedir|memektedir)|gozuk(uyor|muyor)|goruluyor|bulunuyor|bulunmuyor|kayitli|yer almiyor)/,
      /\bhesabiniza (gecti|gecmistir|gecmis|yansidi|yansimistir|aktarildi|aktarilmistir|yatti|yatmistir|eklendi|eklenmistir|tanimlandi|tanimlanmistir|islendi|yuklendi|yuklenmistir)\b/,
      /\b(yatiriminiz|cekiminiz|odemeniz|paraniz|bonusunuz|iadeniz|bakiyeniz|kazanciniz|talebiniz|isleminiz)( [a-z]+){0,2} (gecti|gecmistir|yansidi|yansimistir|aktarildi|aktarilmistir|yatti|yatmistir|eklendi|tanimlandi|islendi|onaylandi|onaylanmistir|tamamlandi|tamamlanmistir|gonderildi|gonderilmistir|reddedildi|reddedilmistir|iptal edildi)\b/,
      /\b(goruyorum|gorebiliyorum) (ki )?(yatirim|cekim|islem|hesab|bakiye|odeme)/,
    ],
    [
      /\bi (have |ve )?(checked|verified|looked at|reviewed|confirmed)( [a-z]+){0,2} (your|the) (account|transaction|deposit|withdrawal|balance|records|payment|transfer)\b/,
      /(?<!\b(once|when|after|if|until|before) )\b(your|the) (deposit|payment|withdrawal|transfer|bonus|refund|winnings|funds)( [a-z]+){0,2} (has been|was|is now|have been) (credited|approved|completed|processed|received|sent|added|declined|rejected)\b/,
      /\b(i can see|i see|it shows|it is showing|appears) (in|on) (the|our|my) (system|records|panel|screen)\b/,
      /\b(the |our )?(system|records) (shows?|indicates?|says)\b/,
    ],
  ),
};

const G9: PlatformGuardrail = {
  id: 'G9',
  title: { tr: 'Bahis ve oyun tavsiyesi yok', en: 'No betting or game advice' },
  prompt: {
    tr: 'Hangi maça, oyuna ya da slota oynanacağını önerme, kazanç vaat etme; RTP gibi genel bilgiyi yalnız bilgi bankasındaki resmi metinden ver.',
    en: 'Never suggest which match, game or slot to play and never promise a win; give general information such as RTP only from the official text in the knowledge base.',
  },
  category: 'money',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\bkazan(irsiniz|irsin|acaksiniz|acaksin|acaginiz|diran|dirir|dirabilir|dirma sansi|ma sansiniz (yuksek|artar|fazla))/,
      /\b(bu|su|o|bugunku|bu aksamki|sonraki) (mac|maca|maci|oyun|oyuna|oyunu|slot|slota|slotu|kupon|kupona|takim|takima|bahis|bahse)( [a-z]+){0,2} (oyna(yin|yiniz|yabilirsiniz|manizi)|yatir(in|iniz|abilirsiniz)|bahis (yapin|yapabilirsiniz|oynayin)|girin|girebilirsiniz|deneyin)/,
      /\b(simdi|hemen|bugun|bu aksam) (yatirirsan|yatirirsaniz|oynarsan|oynarsaniz|bahis yaparsaniz)\b/,
      /\b(ust|alt|kg var|kg yok|karsilikli gol|handikap|cifte sans|ilk yari|mac sonucu)( [a-z]+){0,1} (oyna(yin|yiniz|yabilirsiniz|manizi)|tercih edin|secin)\b/,
      /\brtp(li|si yuksek| orani yuksek)?( [a-z]+){0,3} (secin|oynayin|tercih edin|deneyin|oynamanizi)/,
      /\b(kesin|garantili) (kazanc|kazandir|kupon|tahmin)/,
      /\b(tavsiyem|tavsiyemiz|onerim|onerimiz) (su|bu|olarak)( [a-z]+){0,2} (oyna|mac|slot|kupon|takim)/,
    ],
    [
      /\byou (will|ll|are going to|re going to|are sure to) (definitely |surely |certainly )?win\b/,
      /\b(bet|wager|put (your )?(money|it)) on (this|that|the|tonights|todays)( [a-z]+){0,1} (match|game|team|slot|fixture|race)\b/,
      /\b(winning|hot|lucky|loose|best paying) (slots?|games?|machines?)\b/,
      /\bif you (deposit|bet|play) (now|today|tonight)\b/,
      /\b(i|we) (recommend|suggest|advise) (betting|playing|you bet|you play|that you bet|that you play|backing)\b/,
      /\b(high(er)? rtp|rtp) (slots?|games?)( [a-z]+){0,2} (to play|are better|pay more)\b/,
      /\bsure (bet|win|thing)\b/,
    ],
  ),
};

const G10: PlatformGuardrail = {
  id: 'G10',
  title: { tr: 'Mükerrer yatırım teşviki yok', en: 'No encouragement to deposit again' },
  prompt: {
    tr: 'Yeniden ya da mükerrer yatırım yapmayı önerme; "tekrar yatırın" deme.',
    en: 'Never encourage another or a duplicate deposit; do not say "deposit again".',
  },
  category: 'money',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\b(tekrar|yeniden|bir daha|tekrardan|ikinci kez|bir kez daha)( [a-z]+){0,2} (yatir(in|iniz|abilirsiniz|mayi deneyin|manizi|irsaniz)|yatirim (yapin|yapiniz|yapabilirsiniz|yapmanizi|yapmayi deneyin|yaparsaniz)|para yatir(in|abilirsiniz|manizi)|yukleme (yapin|yapabilirsiniz))\b/,
      /\byatirim(i|inizi)? (tekrar|yeniden|bir daha) (dene|yap)(yin|in|iniz|abilirsiniz|menizi|manizi)/,
    ],
    [
      /(?<!\b(not|dont|never) )\b(deposit|top up|pay|send (the )?(money|funds|payment)) (again|once more|one more time)\b/,
      /\b(make|try|place) (another|a new|a second) deposit\b/,
      /\btry (depositing|the deposit|to deposit) again\b/,
    ],
  ),
};

const G11: PlatformGuardrail = {
  id: 'G11',
  title: { tr: 'Hassas bilgi istenmez', en: 'Never ask for a secret' },
  prompt: {
    tr: 'Şifre, SMS ya da tek kullanımlık kod, kartın tamamı, CVV, internet bankacılığı bilgisi, özel anahtar ya da seed phrase asla isteme; oyuncu paylaşırsa paylaşmamasını hatırlat.',
    en: 'Never ask for a password, an SMS or one-time code, a full card number, a CVV, online-banking details, a private key or a seed phrase; if the player shares one, remind them not to.',
  },
  category: 'data_security',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      rx(/\b/, SECRET_TR, /( [a-z0-9]+){0,3} /, ASK_TR),
      /\b(sifreniz|parolaniz|sms kodunuz|otp kodunuz|cvv( kodunuz)?|kart numaraniz) (ne|nedir|neydi|nelerdir)\b/,
    ],
    [
      /(?<!\b(never|dont|do not|not|no one|nobody) )\b(send|share|give|tell|provide|confirm|reply with|write)( me| us)? (your )?(password|passcode|pin|otp|one time (code|password|pin)|sms code|verification code|security code|cvv|cvc|full card number|card number|seed phrase|recovery phrase|private key|online banking (password|login|details|credentials)|login details)\b/,
      /\b(what is|whats) your (password|pin|otp|cvv|cvc|security code|sms code|seed phrase|card number)\b/,
    ],
  ),
};

const G12: PlatformGuardrail = {
  id: 'G12',
  title: { tr: 'KYC belgeleri güvenli kanaldan', en: 'KYC documents through the secure channel' },
  prompt: {
    tr: 'KYC belgelerini yalnız işletmenin güvenli kanalından iste; belge içeriğini yorumlama, "onaylandı" ya da "doğrulandı" deme.',
    en: "Ask for KYC documents only through the business's secure channel; never interpret a document or say it is approved or verified.",
  },
  category: 'data_security',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\b(belge(niz|leriniz)|evrak(iniz|lariniz)|kimliginiz|kimlik (belgeniz|bilgileriniz)|dekont(unuz|lariniz)|ekstreniz|adres belgeniz|kyc( belgeleriniz| isleminiz| dogrulamaniz)?|hesabiniz|dogrulamaniz|dogrulama isleminiz)( [a-z]+){0,2} (onaylandi|onaylanmistir|onaylanmis|dogrulandi|dogrulanmistir|dogrulanmis|kabul edildi|kabul edilmistir|gecerli sayildi|reddedildi|reddedilmistir)\b/,
    ],
    [
      /(?<!\b(once|when|after|if|until|before) )\byour (documents?|id|identity|kyc|verification|proof of address|receipt|account)( [a-z]+){0,2} (has|have|was|were|is|are) (been )?(approved|verified|accepted|confirmed|validated|rejected)\b/,
    ],
  ),
};

const G13: PlatformGuardrail = {
  id: 'G13',
  title: {
    tr: 'Hesap güvenliği, çoklu hesap ve AML',
    en: 'Account security, multiple accounts and AML',
  },
  prompt: {
    tr: 'Hesap bilgisi değişikliği, hesabın ele geçirildiği şüphesi, çoklu hesap ya da dolandırıcılık şüphesinde devret; AML ya da risk kontrollerini açıklama, yalnız "hesabınız güvenlik incelemesinde" gibi nötr bir ifade kullan.',
    en: 'Hand over on a change of account details, a suspected takeover, multiple accounts or suspected fraud; never reveal AML or risk checks — use a neutral phrase such as "your account is under a security review".',
  },
  category: 'data_security',
  action: 'force_handoff',
  target: 'kyc_risk',
  priority: 'normal',
  handoffReason: 'guardrail_account_security',
  riskFlag: null,
  understandRisks: ['account_takeover', 'fraud_aml'],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      /\bhesab(im|imi|ima|imin)( [a-z]+){0,2} (calindi|calinmis|ele gecir|hack|kirildi|kirilmis|baskasinin eline)/,
      /\b(baskasi|baska biri|biri|birisi|yabanci biri|tanimadigim biri)( [a-z]+){0,2} (girmis|girdi|giris yap|erismis|erisiyor|kullaniyor|kullanmis|degistirmis|cekmis|cekim yapmis|oynamis)/,
      /\b(benden habersiz|izinsiz|bilgim disinda|onayim olmadan)( [a-z]+){0,3} (cekim|giris|islem|degis|yatir|para|sifre)/,
      /\bsifrem(i)?( [a-z]+){0,2} (degistirilmis|degistirmis|degismis|calinmis|calindi|ele gecir)/,
      /\b(kardesim|arkadasim|esim|babam|annem|oglum|kizim|yegenim)( [a-z]+){0,2} (hesabim(a|i|dan)|benim hesab)( [a-z]+){0,2} (girmis|oynamis|kullanmis|cekmis|yatirmis|giriyor|oynuyor|kullaniyor)/,
      /\b(baskasinin|arkadasimin|annemin|babamin|esimin|kardesimin|akrabamin) (kart|hesab|iban|papara|banka)/,
      /\b(ikinci|iki|baska|yeni|diger|birden fazla|coklu) (bir )?hesap( [a-z]+){0,1} (ac|olustur|kullan)/,
      /\bkara ?para/,
      /\b(telefon numara(mi|si)|numarami|e ?posta( adres)?(imi|ini|i)|mail( adres)?(imi|ini|i)|email(imi|i)|ad soyad(imi|i)|isim(imi|i)|soyad(imi|i)|soyisim(imi|i)|dogum tarih(imi|i)|tc( kimlik)?( no| numara)?(mi|imi|yi|sini)|kimlik bilgi(lerimi|mi)|banka hesab(imi|i)|iban(imi|i))( [a-z]+){0,1} (degis(tir|tiril|tirme|ik)|guncelle)/,
    ],
    [
      /\b(my )?account( was| has been| got| is)? (hacked|stolen|compromised|taken over|breached)\b/,
      /\b(someone|somebody) (else )?(has )?(logged|logging|got|getting|broke|broken) (in|into)\b/,
      /\b(someone|somebody)( else)? (is using|used|has used|accessed|has accessed|changed|withdrew)\b/,
      /\bunauthori[sz]ed (access|login|withdrawal|transaction|activity|use)\b/,
      /\b(open|create|make|have|opened|created) (a )?(second|another|new|multiple|two) accounts?\b/,
      /\b(change|update) (my )?(email|e mail|phone( number)?|name|surname|address|date of birth|bank account|iban|personal details)\b/,
      /\bmoney laundering\b/,
      /\b(someone elses|my friends|my moms|my dads|my wifes|my husbands|another persons) (card|account|bank)\b/,
    ],
  ),
  output: lexicon(
    [
      /\b(aml|masak|kara ?para|terorun finansmani|suc geliri|supheli (islem|aktivite|hareket)|fraud (inceleme|suphe|kontrol|tespit|ekib)|dolandiricilik (incelemesi|suphesi|sorusturmasi|kontrolu|tespiti)|sahtecilik (incelemesi|suphesi)|fonlarin kaynag|kaynak arastirmasi)/,
      /\brisk (ekib|birim|departman|analiz)[a-z]*( [a-z]+){0,3} (supheli|inceleme|tespit)/,
    ],
    [
      /\b(aml|anti money laundering|money laundering|suspicious (activity|transactions?)|fraud (check|review|investigation|team|department|suspicion)|source of (funds|wealth) (check|review|investigation)|financial crime)\b/,
    ],
  ),
};

const G14: PlatformGuardrail = {
  id: 'G14',
  title: { tr: 'Erişim engeli aşma yöntemi yok', en: 'No way around an access block' },
  prompt: {
    tr: 'Erişim, güncel adres ya da "site açılmıyor" sorularında yalnız işletmenin Erişim bilgisi ayarındaki bilgiyi ver; VPN, proxy, ayna site ya da engel aşma yöntemi uydurma ve önerme; bilgi yoksa devret.',
    en: 'On access, current-address or "the site won\'t open" questions give only what the business\'s access information setting says; never invent or suggest a VPN, proxy, mirror site or any way around a block; if there is no such information, hand over.',
  },
  category: 'legal',
  action: 'block_output',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: 'access_info',
  warningsBeforeHandoff: null,
  input: null,
  output: lexicon(
    [
      /\b(vpn|proxy|proksi|tor tarayici)( [a-z]+){0,2} (kullan(in|iniz|abilirsiniz|manizi|arak)|acin|acabilirsiniz|deneyin|ile (girin|girebilirsiniz|baglanin|erisebilirsiniz)|oneri|tavsiye)/,
      /\bdns( [a-z]+){0,2} (degistir(in|ebilirsiniz|menizi)|ayarlay(in|abilirsiniz))/,
      /\b(ayna|alternatif|yedek) (site|adres|link|giris)/,
      /\bmirror (site|link|adres)/,
      /\b(yeni|guncel|aktif|son|calisan) (giris (adresimiz|adresi|linkimiz|linki)|adresimiz|linkimiz|domainimiz|alan adimiz)/,
      /\b(engel(i|leri)?|erisim engel(i|ini)?|yasag(i)?) (as(abilir|mak|manin|arak|in)|kaldir(abilir|mak icin)|atla(tmak|yabilir))/,
    ],
    [
      /\b(use|try|enable|turn on|connect (via|through|with))( a| an)? (vpn|proxy|tor browser)\b/,
      /\b(vpn|proxy) to (access|bypass|get around|reach)\b/,
      /\bmirror (site|link|domain|url)\b/,
      /\b(new|current|latest|working|alternative|backup) (access |login |entry )?(address|domain|url|mirror)\b/,
      /\bchange (your )?dns\b/,
      /\b(bypass|get around|circumvent) (the )?(block|ban|restriction|filter)s?\b/,
    ],
  ),
};

const G15: PlatformGuardrail = {
  id: 'G15',
  title: { tr: 'Şikâyetler insana', en: 'Complaints go to a person' },
  prompt: {
    tr: 'Şikâyet ve itirazlarda işletmenin resmi şikâyet prosedürünü ve ADR bilgisini ver ve insana devret; karmaşık bir şikâyeti kendin çözmeye çalışma.',
    en: "On a complaint or a dispute give the business's formal complaint procedure and its ADR information and hand over to a person; never try to settle a complex complaint yourself.",
  },
  category: 'legal',
  action: 'force_handoff',
  target: 'complaints',
  priority: 'normal',
  handoffReason: 'guardrail_complaint',
  riskFlag: 'complaint_formal',
  understandRisks: ['complaint_formal'],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: 'complaint',
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      /\bresmi (bir )?(sikayet|itiraz|basvuru)/,
      /\bavukat/,
      /\blisans (kurum|kurulus|otorite|veren)/,
      /\b(curacao|cga|mga|ukgc|gaming control|gaming authority|gambling commission)[a-z]*( [a-z]+){0,2} (sikayet|bildir|basvur|ilet|yaz)/,
      /\b(dava (ac|edece|ediyorum)|davaci|mahkemeye|savciliga|suc duyurusu|polise (gidece|sikayet|basvur|bildir)|karakola gidece)/,
      /\bsikayet (edecegim|edicem|edecem|edeceyim|edecegiz|etmek istiyorum|olusturmak|dilekce|kaydi|basvurusu)/,
      /\bsikayetvar/,
      /\bsikayetimi (ilet|yaz|kaydet|resmi)/,
      /\bsikayetim (var|vardir)\b/,
      /\b(adr|alternatif uyusmazlik)\b/,
      /\b(tuketici hakem|tuketici mahkeme|btk|bddk)\b/,
    ],
    [
      /\b(formal|official) complaint\b/,
      /\bfile (a )?complaint\b/,
      /\bescalate (this|my complaint|the complaint)\b/,
      /\b(lawyer|attorney|solicitor|legal action)\b/,
      /\b(sue|suing) (you|the company|this)\b/,
      /\btake (you|this|it) to court\b/,
      /\b(report|complain|reporting|complaining)( [a-z]+){0,3} (regulator|gaming authority|licensing authority|gambling commission|curacao|mga|ukgc|cga)\b/,
      /\b(adr|alternative dispute)\b/,
    ],
  ),
  output: null,
};

const G16: PlatformGuardrail = {
  id: 'G16',
  title: { tr: 'Şeffaflık ve insanla görüşme', en: 'Transparency and the right to a person' },
  prompt: {
    tr: 'Yapay zekâ olduğunu gizleme, insan olduğunu söyleme; oyuncu insanla görüşmek isterse en fazla bir netleştirme sorusuyla devret.',
    en: 'Never hide that you are an AI or claim to be a person; when the player asks for a person, hand over after at most one clarifying question.',
  },
  category: 'transparency',
  action: 'force_handoff',
  target: null,
  priority: 'normal',
  handoffReason: 'player_request',
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: true,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: lexicon(
    [
      rx(
        /\b(canli destek|musteri temsilci|temsilci|yetkili|gercek (biri|birisi|bir insan|bir kisi))(si|siyle|yle|le|ile|ye|e|a|ya|nize)?( [a-z]+){0,2} (gorus|konus|baglan|aktar|istiyorum|gelsin)/,
        NOT_WANTED,
      ),
      rx(/\binsan(la|a|ile| ile|la mi)( [a-z]+){0,1} (gorus|konus|baglan|aktar)/, NOT_WANTED),
      /\b(bot|robot|yapay zeka)(la|yla|ile| ile)? (konusmak istemiyorum|konusmayacagim)/,
    ],
    [
      /\b(talk|speak|chat) (to|with) (a |an )?(human|person|real person|live agent|agent|representative|someone real|real human|operator|staff)\b/,
      /\b(human|live|real) (agent|person|support|operator)\b/,
      /\b(dont|do not) want (to talk to |to chat with )?(a |the |an )?(bot|robot|ai)\b/,
      /\bconnect me (to|with)\b/,
    ],
  ),
  output: lexicon(
    [
      /\b(ben )?(bir )?(gercek )?insan(im|iz)\b/,
      /\byapay zeka degilim/,
      /\b(bot|robot) degilim/,
      /\b(ben|biz) (bir )?(canli )?(musteri )?temsilci(yim|siyim|leriz)\b/,
    ],
    [
      /\b(im|i am) (a )?(real )?(human|person|human being)\b/,
      /\b(im|i am) not (a |an )?(bot|robot|ai|machine)\b/,
    ],
  ),
};

const G17: PlatformGuardrail = {
  id: 'G17',
  title: { tr: 'Bilgi yoksa uydurma yok', en: 'No invented answer' },
  prompt: {
    tr: 'Bilgi bankasında cevap yoksa uydurma; "bu konuda size kesin bilgi veremiyorum" de ve devret.',
    en: 'When the knowledge base has no answer, never invent one; say you cannot give definite information on this and hand over.',
  },
  category: 'transparency',
  action: 'force_handoff',
  target: null,
  priority: 'normal',
  handoffReason: 'no_knowledge',
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: null,
};

const G18: PlatformGuardrail = {
  id: 'G18',
  title: { tr: 'Tutarlılık', en: 'Consistency' },
  prompt: {
    tr: 'Aynı soruya her seferinde aynı kaynağa dayanan tutarlı bir cevap ver.',
    en: 'Answer the same question consistently, from the same source, every time.',
  },
  category: 'transparency',
  action: 'warn',
  target: null,
  priority: 'normal',
  handoffReason: null,
  riskFlag: null,
  understandRisks: [],
  lexiconAlone: false,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: null,
  input: null,
  output: null,
};

const G19: PlatformGuardrail = {
  id: 'G19',
  title: { tr: 'Hakaret ve tehdit', en: 'Abuse and threats' },
  prompt: {
    tr: 'Hakaret ya da tehdit karşısında sakin kal ve karşılık verme; iki uyarıdan sonra devret.',
    en: 'Stay calm under abuse or threats and never answer in kind; hand over after two warnings.',
  },
  category: 'transparency',
  action: 'force_handoff',
  target: null,
  priority: 'normal',
  handoffReason: 'abuse',
  riskFlag: 'abusive',
  understandRisks: [],
  lexiconAlone: true,
  appliesWhen: 'always',
  tenantText: null,
  warningsBeforeHandoff: 2,
  input: lexicon(
    [
      // Short ones whole; the long ones with whatever suffix ("şerefsizler").
      /\b(amk|aq|amq|mk|sikik|sikicem|pust|yarak|gotunu|gotune)\b/,
      /\b(aminakoy|aminakodum|siktir|sikeyim|sikerim|orospu|orosbu|pezevenk|serefsiz|yavsak|kahpe|ibne|kaltak|gavat|haysiyetsiz|namussuz|soysuz|dalyarak|yarrak|amcik|gotveren)/,
      /\bamina (koy|koyim|koyayim|kodum|koydugum)/,
      /\b(pic kurusu|it oglu it|got veren)\b/,
      /\b(aptal|salak|gerizekali|geri zekali|dangalak|ahmak|beyinsiz|embesil|andaval|denyo|ezik|cahil)( mi(sin|siniz)|sin|siniz|lar|ler|lara|lere|larin|lerin)\b/,
      /\bmal (misin|misiniz)\b|\bmalsin(iz)?\b/,
      /\b(seni|sizi|hepinizi)( [a-z]+){0,1} (oldurece|oldururum|oldurmek|gebert|bulacag|bulurum|bitirece|mahvedece|yakacag|vuracag|keserim)/,
      /\b(evini|evinizi|adresini|adresinizi|yerinizi|yerini|ofisinizi)( [a-z]+){0,1} (bulacag|bulurum|biliyorum|basacag|basarim|yakacag|yakarim)/,
      /\b(kafani|kafanizi|agzini|agzinizi) (kirar|kiracag|kopar|keser|parcala)/,
    ],
    [
      /\b(fuck|fucking|fucker|fucked|motherfucker|bitch|bastard|asshole|cunt|dickhead|wanker|twat|prick|scumbag|piece of shit)\b/,
      /\b(you|u|youre|you are|ur)( a| an| such a| such an| fucking| bloody)? (idiot|idiots|stupid|moron|morons|dumb|retard|loser|losers|clown|clowns|useless)\b/,
      /\b(i will|ill|im going to|i am going to|gonna) (kill|find|hurt|destroy|burn|beat) (you|u|your)\b/,
      /\bi know where (you|u) live\b/,
      /\byou (will|ll) (regret|pay for) (this|it)\b/,
    ],
  ),
  output: null,
};

/*@__NO_SIDE_EFFECTS__*/
function freezeCatalogue(rules: readonly PlatformGuardrail[]): readonly PlatformGuardrail[] {
  return Object.freeze(
    rules.map((rule) =>
      Object.freeze({
        ...rule,
        title: Object.freeze({ ...rule.title }),
        prompt: Object.freeze({ ...rule.prompt }),
        understandRisks: Object.freeze([...rule.understandRisks]),
      }),
    ),
  );
}

/** The locked catalogue, G1 to G19. */
export const PLATFORM_GUARDRAILS: readonly PlatformGuardrail[] = freezeCatalogue([
  G1,
  G2,
  G3,
  G4,
  G5,
  G6,
  G7,
  G8,
  G9,
  G10,
  G11,
  G12,
  G13,
  G14,
  G15,
  G16,
  G17,
  G18,
  G19,
]);

export function platformGuardrail(id: GuardrailId): PlatformGuardrail {
  return PLATFORM_GUARDRAILS.find((rule) => rule.id === id) as PlatformGuardrail;
}

// ---------------------------------------------------------------------------
// Scanning.
// ---------------------------------------------------------------------------

/** One pattern that matched, with the writer's own words. */
export interface GuardrailMatch {
  readonly rule: GuardrailId;
  readonly stage: GuardrailStage;
  readonly lang: GuardrailLang;
  /** The pattern's place in the rule's lexicon for this stage and language (lexicon upkeep, AI-24). */
  readonly pattern: number;
  /** The matched range in the original text, `[start, end)`. */
  readonly start: number;
  readonly end: number;
  /** The original text of the match, trimmed, at most {@link GUARDRAIL_QUOTE_MAX} characters. */
  readonly quote: string;
}

export interface GuardrailScanOptions {
  /** Only these rules; every rule with a lexicon for the stage by default. */
  readonly rules?: readonly GuardrailId[];
  /** Only these languages' lexicons; both by default — a player may switch language mid-sentence. */
  readonly langs?: readonly GuardrailLang[];
}

const GLOBAL = /* @__PURE__ */ new WeakMap<RegExp, RegExp>();
function globalOf(re: RegExp): RegExp {
  let global = GLOBAL.get(re);
  if (!global) {
    global = new RegExp(re.source, 'g');
    GLOBAL.set(re, global);
  }
  global.lastIndex = 0;
  return global;
}

const WORD_CHAR = /[a-z0-9%]/;

/** The sentence (between newlines) a range of normalised text sits in. */
function sentenceOf(text: string, start: number, end: number): string {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const to = text.indexOf('\n', end);
  return text.slice(from, to === -1 ? text.length : to);
}

/**
 * Every lexicon pattern of the stage that matches the text — the player's
 * message (`input`) or the AI's draft (`output`) — in text order. Pure and
 * deterministic: no model, no settings; the caller decides what a match does
 * (G4's lexicon applies only to a risk-flagged conversation, G14's lets through
 * what the access information itself says).
 */
export function scanGuardrails(
  text: string,
  stage: GuardrailStage,
  options: GuardrailScanOptions = {},
): GuardrailMatch[] {
  const normalized = normalizeGuardrailText(text);
  const folded = normalized.text;
  if (folded === '') return [];
  const langs = options.langs ?? GUARDRAIL_LANGS;
  const matches: GuardrailMatch[] = [];
  for (const rule of PLATFORM_GUARDRAILS) {
    if (options.rules && !options.rules.includes(rule.id)) continue;
    const lex = stage === 'input' ? rule.input : rule.output;
    if (!lex) continue;
    for (const lang of langs) {
      lex[lang].forEach((pattern, index) => {
        for (const found of folded.matchAll(globalOf(pattern.re))) {
          const at = found.index ?? 0;
          let last = at + found[0].length - 1;
          if (pattern.unless && pattern.unless.test(sentenceOf(folded, at, last + 1))) continue;
          // A pattern may stop at a stem ("hesabimi kapat"); the quote takes the whole word.
          while (last + 1 < folded.length && WORD_CHAR.test(folded.charAt(last + 1))) last += 1;
          const start = normalized.starts[at] as number;
          const end = normalized.ends[last] as number;
          matches.push({
            rule: rule.id,
            stage,
            lang,
            pattern: index,
            start,
            end,
            quote: text.slice(start, end).trim().slice(0, GUARDRAIL_QUOTE_MAX),
          });
        }
      });
    }
  }
  return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The rules a scan found, once each, in catalogue order. */
export function guardrailsHit(matches: readonly GuardrailMatch[]): GuardrailId[] {
  const hit = new Set(matches.map((match) => match.rule));
  return GUARDRAIL_IDS.filter((id) => hit.has(id));
}
