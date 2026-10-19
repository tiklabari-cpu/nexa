/**
 * Checking a behaviour rule before it is saved (tm 299.1 · SiyahTuş analysis
 * AI-07 §4, §5).
 *
 * Two different things, kept apart:
 *
 *   - **The refusal** ({@link lockedRuleViolation}) is deterministic and
 *     blocks: a rule that tells the AI to ask for a password, an OTP or a
 *     card, to make a bonus offer mandatory, or to switch off a locked
 *     platform rule (AI-08) is a 400 on every write. It reads the folded
 *     text for a forbidden subject with a positive instruction about it and
 *     no negation — "Oyuncudan şifresini iste" is refused, "Şifre asla
 *     isteme" is not — so it errs towards letting a rule through: a missed
 *     refusal still meets the platform's locked layer above it in the prompt.
 *   - **The conflict check** ({@link checkGuidance}) only warns: the draft
 *     against the agent's other rules whose scope overlaps it, at most
 *     {@link CHECK_GROUP_SIZE} at a time, read by the model into
 *     `{conflicts, duplicates, vague}` — or, with the `mock` provider or when
 *     the model cannot answer, by word overlap and polarity
 *     ({@link heuristicCheck}): two rules about the same words, one of them
 *     negated, contradict; the same words with the same polarity repeat.
 */
import type { GuidanceCategory, GuidanceScope } from '@siyahtus/types';
import { foldTr } from './conversation/slots/normalize-tr.js';
import type { JsonSchema } from './provider/json-schema.js';

export const LOCKED_RULE_KEYS = ['credentials', 'mandatory_bonus', 'disable_locked'] as const;
export type LockedRuleKey = (typeof LOCKED_RULE_KEYS)[number];

export interface LockedRuleViolation {
  locked_rule: LockedRuleKey;
  explanation: string;
}

const EXPLANATIONS: Record<LockedRuleKey, string> = {
  credentials:
    'The AI never asks a player for a password, a one-time code or card details (locked platform rule).',
  mandatory_bonus:
    'A bonus or promotion offer can never be made mandatory: a player at risk must not be offered one (locked platform rule).',
  disable_locked:
    'Locked platform rules — responsible gambling, minors, crisis hand-overs — cannot be switched off by a workspace rule.',
};

const CREDENTIAL =
  /(sifre|parola|password|passcode|\botp\b|sms kod|dogrulama kod|onay kod|tek kullanimlik|one[- ]time (code|password)|verification code|kart (numara|bilgi)|kredi karti|card (number|details)|\bcvv\b|\bcvc\b|guvenlik kod|son kullanma tarih|expiry date)/;
const CARD_DIGITS_ONLY = /(son (4|dort) (hane|rakam)|last (4|four) digits)/;
const CREDENTIAL_ASK =
  /(?<![a-z])(iste|isteyin|isteyiniz|istesin|istenmeli|istensin|sor|sorunuz|sorsun|sorulmali|talep et|talep edin|ask|request|collect|obtain|require|gondermesini|paylasmasini|yazmasini|iletmesini|vermesini|girmesini)(?![a-z])/;

const BONUS = /(bonus|freespin|free spin|bedava donus|promosyon|kampanya|promotion|campaign)/;
const MANDATORY =
  /(her zaman|daima|mutlaka|zorunlu|her mesaj|her cevap|her konusma|her sohbet|her oyuncu|always|every (message|reply|conversation|player)|must|in all cases)/;

const LOCKED_TOPIC =
  /(kilitli kural|platform kural|guvenlik kural|koruma kural|guardrail|locked rule|sorumlu oyun|responsible gambling|self[- ]?exclusion|kendini (engelle|oyundan)|kriz|intihar|resit olmayan|18 yas|yasal yas|underage|minor)/;
const DISABLE =
  /(yok say|gormezden gel|atla|devre disi|aktarma|devretme|yonlendirme|uygulama(?![a-z])|ignore|bypass|disable|skip|override|(do not|don'?t|never) (transfer|hand))/;

/** Words that turn an instruction around: "asla", "never", "hiçbir zaman". */
const NEGATOR =
  /(?<![a-z])(asla|hicbir|hic bir|never|not|dont|don't|yasak|yasaktir|kesinlikle hayir)(?![a-z])/;
/** A Turkish negative imperative closing the sentence: "isteme", "sorma", "sormayın". */
const NEGATIVE_VERB = /(me|ma|meyin|mayin|meyiniz|mayiniz|memeli|mamali|mesin|masin)$/;

/** Whether a rule says not to do what it names. */
export function isNegated(folded: string): boolean {
  if (NEGATOR.test(folded)) return true;
  const words = folded.match(/[a-z0-9']+/g) ?? [];
  const last = words.at(-1);
  return last !== undefined && last.length > 3 && NEGATIVE_VERB.test(last);
}

/**
 * The locked platform rule a rule's text goes against, or null (AI-07 §5).
 * `topicDisable: false` leaves out the locked-topic reading of
 * `disable_locked` — a compliance rule (`guardrail-lock.ts`) is about those
 * topics by nature and has its own, narrower check.
 */
export function lockedRuleViolation(
  text: string,
  options: { topicDisable?: boolean } = {},
): LockedRuleViolation | null {
  const folded = foldTr(text);
  const negated = isNegated(folded);
  const hit = (key: LockedRuleKey): LockedRuleViolation => ({
    locked_rule: key,
    explanation: EXPLANATIONS[key],
  });
  if (options.topicDisable !== false && DISABLE.test(folded) && LOCKED_TOPIC.test(folded)) {
    return hit('disable_locked');
  }
  if (negated) return null;
  if (CREDENTIAL.test(folded) && CREDENTIAL_ASK.test(folded)) {
    const onlyCardDigits =
      CARD_DIGITS_ONLY.test(folded) && !/(sifre|parola|password|otp|kod|cvv|cvc)/.test(folded);
    if (!onlyCardDigits) return hit('credentials');
  }
  if (BONUS.test(folded) && MANDATORY.test(folded)) return hit('mandatory_bonus');
  return null;
}

/** Whether two scopes can apply to the same turn. */
export function scopesOverlap(a: GuidanceScope, b: GuidanceScope): boolean {
  if ('all' in a || 'all' in b) return true;
  if ('skill_ids' in a && 'skill_ids' in b)
    return a.skill_ids.some((id) => b.skill_ids.includes(id));
  if ('brand_ids' in a && 'brand_ids' in b)
    return a.brand_ids.some((id) => b.brand_ids.includes(id));
  // A procedure's turn in a brand's conversation carries both.
  return true;
}

export interface CheckedRule {
  id: string;
  body: string;
  category: GuidanceCategory;
}

export interface GuidanceDraft {
  body: string;
  category: GuidanceCategory;
}

export interface GuidanceCheckResult {
  conflicts: Array<{ rule_id: string; explanation: string; severity: 'warning' | 'error' }>;
  duplicates: Array<{ rule_id: string; explanation: string }>;
  vague: Array<{ explanation: string }>;
}

/** The model reads the rules at most this many at a time (AI-07 §4). */
export const CHECK_GROUP_SIZE = 20;

export const GUIDANCE_CHECK_RESPONSE_NAME = 'guidance_check';

export const GUIDANCE_CHECK_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conflicts', 'duplicates', 'vague'],
  properties: {
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule_id', 'explanation', 'severity'],
        properties: {
          rule_id: { type: 'string' },
          explanation: { type: 'string' },
          severity: { type: 'string', enum: ['warning', 'error'] },
        },
      },
    },
    duplicates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule_id', 'explanation'],
        properties: { rule_id: { type: 'string' }, explanation: { type: 'string' } },
      },
    },
    vague: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['explanation'],
        properties: { explanation: { type: 'string' } },
      },
    },
  },
};

export function guidanceCheckSystemPrompt(): string {
  return [
    "You review the rules a business writes for its customer-support AI. You are given one draft rule and some of the business's existing rules, as JSON.",
    'Find: conflicts — an existing rule that tells the AI the opposite of the draft, or something it cannot do at the same time (severity "error" when following one means breaking the other in every case, else "warning"); duplicates — an existing rule that says the same thing as the draft; vague — wording in the draft too unclear for the AI to follow.',
    'Name existing rules only by the rule_id given. Explanations are one short sentence, in the language the draft is written in. Report nothing you are unsure of.',
  ].join('\n');
}

export function guidanceCheckUserContent(
  draft: GuidanceDraft,
  rules: readonly CheckedRule[],
): string {
  return JSON.stringify({
    draft: { body: draft.body, category: draft.category },
    rules: rules.map((rule) => ({ rule_id: rule.id, body: rule.body, category: rule.category })),
  });
}

/** A model's reply kept to the rules it was shown. */
export function readCheckReply(
  reply: GuidanceCheckResult,
  shown: readonly CheckedRule[],
): GuidanceCheckResult {
  const ids = new Set(shown.map((rule) => rule.id));
  return {
    conflicts: reply.conflicts.filter((entry) => ids.has(entry.rule_id)),
    duplicates: reply.duplicates.filter((entry) => ids.has(entry.rule_id)),
    vague: reply.vague.slice(0, 3),
  };
}

const STOPWORDS = new Set([
  've',
  'ile',
  'bir',
  'bu',
  'su',
  'o',
  'da',
  'de',
  'icin',
  'gibi',
  'olan',
  'olarak',
  'her',
  'en',
  'cok',
  'daha',
  'ama',
  'veya',
  'ya',
  'ki',
  'mi',
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'or',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'be',
  'it',
  'that',
  'this',
  'oyuncu',
  'oyuncuya',
  'oyuncunun',
  'oyuncudan',
  'musteri',
  'musteriye',
  'player',
  'customer',
]);
const VAGUE =
  /(uygun sekilde|uygun bir sekilde|gerektiginde|gerekirse|duruma gore|mumkunse|mumkun oldugunca|as appropriate|if needed|when necessary|where appropriate|as needed)/;

/** Content stems: folded words, stop words and negators out, first five letters. */
function stems(folded: string): Set<string> {
  const words = folded.match(/[a-z0-9]+/g) ?? [];
  const out = new Set<string>();
  for (const word of words) {
    if (STOPWORDS.has(word) || NEGATOR.test(word) || word.length < 2) continue;
    // A negative verb and its positive are one stem ("sorma" / "sor").
    const base =
      word.length > 4 && NEGATIVE_VERB.test(word) ? word.replace(NEGATIVE_VERB, '') : word;
    out.add(base.slice(0, 5));
  }
  return out;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const stem of a) if (b.has(stem)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * The model-free reading: the same words with opposite polarity contradict
 * (≥ 0.5 shared stems), the same words with the same polarity repeat (≥ 0.8),
 * and a draft of fewer than three content words or hedged wording is vague.
 */
export function heuristicCheck(
  draft: GuidanceDraft,
  rules: readonly CheckedRule[],
): GuidanceCheckResult {
  const folded = foldTr(draft.body);
  const own = stems(folded);
  const negated = isNegated(folded);
  const result: GuidanceCheckResult = { conflicts: [], duplicates: [], vague: [] };
  for (const rule of rules) {
    const other = foldTr(rule.body);
    const score = similarity(own, stems(other));
    if (negated !== isNegated(other) && score >= 0.5) {
      result.conflicts.push({
        rule_id: rule.id,
        explanation: 'This rule asks for the opposite of an existing rule about the same thing.',
        severity: 'warning',
      });
    } else if (negated === isNegated(other) && score >= 0.8) {
      result.duplicates.push({
        rule_id: rule.id,
        explanation: 'An existing rule already says the same thing.',
      });
    }
  }
  if (own.size < 3) {
    result.vague.push({ explanation: 'Too short to follow: say what to do, and when.' });
  } else if (VAGUE.test(folded)) {
    result.vague.push({
      explanation:
        'Hedged wording ("when needed", "as appropriate") leaves the AI to guess: say when.',
    });
  }
  return result;
}

/** Results of several groups, one list each. */
export function mergeCheckResults(results: readonly GuidanceCheckResult[]): GuidanceCheckResult {
  return {
    conflicts: results.flatMap((result) => result.conflicts),
    duplicates: results.flatMap((result) => result.duplicates),
    vague: results.flatMap((result) => result.vague).slice(0, 3),
  };
}

/** The rules in groups of {@link CHECK_GROUP_SIZE}. */
export function checkGroups<T>(rules: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < rules.length; start += CHECK_GROUP_SIZE) {
    groups.push(rules.slice(start, start + CHECK_GROUP_SIZE));
  }
  return groups;
}
