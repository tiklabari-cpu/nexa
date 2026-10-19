/**
 * The workspace's side of the compliance guardrails (tm 301.2 · SiyahTuş
 * analysis AI-08): what a workspace may add to the platform's locked G1–G19
 * catalogue (`guardrails.ts`), and the record a hit leaves.
 *
 * A workspace never loosens the catalogue — no switch, no edit, the API's 403
 * ({@link GUARDRAIL_PLATFORM_LOCKED_REASON}) — it only adds stricter things:
 *
 *   - **settings** (`ai_guardrail_settings`, one row per customer-facing
 *     agent): the crisis text G3 sends verbatim before its hand-over, the
 *     complaint procedure G15 gives, and whether the judge call (LLM #3) reads
 *     risky drafts. The crisis text must be approved by the Founder before the
 *     agent can be switched on (AI-08-S1, {@link guardrailSetupProblem});
 *   - **rules** (`ai_guardrail_rules`): extra imperative lines for the prompt's
 *     second layer (`tenant_compliance`), each also able to block a draft or
 *     force a hand-over;
 *   - **forbidden phrases** (`ai_forbidden_phrases`): words a reply must not
 *     carry — "kesin" — matched exactly, as a whole word or by a pattern.
 *
 * A pattern is a regular expression a Founder writes, and the reply check runs
 * it on text a player can steer through the model, in the one process every
 * workspace shares. So it is held to a small dialect ({@link
 * forbiddenPhraseProblem}): no back-references or look-arounds, a repeated
 * group never, every repetition capped at {@link FORBIDDEN_PHRASE_REPEAT_MAX}
 * — `*` is written back as `{0,30}` — and the ways one start position can be
 * tried (repetition ranges × optional parts × alternatives) at most {@link
 * FORBIDDEN_PHRASE_CHOICES_MAX}. Each start position then costs a bounded
 * number of steps, and a whole check is linear in the text.
 *
 * Phrases, like the catalogue's lexicons, run on {@link normalizeGuardrailText}'s
 * output: lower-case ASCII, Turkish letters folded, punctuation a space, a
 * comma `,` and a sentence end a line break. A phrase is folded the same way,
 * so "Kesin", "KESİN" and "kesin" are one phrase.
 */
import {
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_QUOTE_MAX,
  isGuardrailId,
  foldGuardrailText,
  normalizeGuardrailText,
  type GuardrailCategory,
  type GuardrailId,
} from './guardrails.js';

// ---------------------------------------------------------------------------
// Settings.
// ---------------------------------------------------------------------------

/** The crisis text and the complaint text, in characters: a chat message, not a page. */
export const GUARDRAIL_TEXT_MAX = 1000;

/**
 * Why an agent cannot be switched on yet (`409 ai_guardrail_setup_incomplete`,
 * `details.reason`): no crisis text, or one the Founder has not approved as it
 * stands.
 */
export const GUARDRAIL_SETUP_PROBLEMS = [
  'crisis_text_missing',
  'crisis_text_not_approved',
] as const;
export type GuardrailSetupProblem = (typeof GUARDRAIL_SETUP_PROBLEMS)[number];

export interface GuardrailSetupState {
  crisisText: string | null;
  approvedAt: Date | string | null;
}

/**
 * What still stands between the agent and going live, or null. An agent with
 * no settings row has no crisis text. The approval is of the text as it stands:
 * editing the text clears it (`PUT /ai-guardrails/settings`).
 */
export function guardrailSetupProblem(
  settings: GuardrailSetupState | null,
): GuardrailSetupProblem | null {
  if (!settings || !settings.crisisText || settings.crisisText.trim() === '') {
    return 'crisis_text_missing';
  }
  return settings.approvedAt ? null : 'crisis_text_not_approved';
}

// ---------------------------------------------------------------------------
// The lock.
// ---------------------------------------------------------------------------

/**
 * `details.reason` of the 403 (`not_allowed`) a write against the platform
 * catalogue gets — an edit or a delete of G1–G19, or a workspace rule that
 * would switch one off.
 */
export const GUARDRAIL_PLATFORM_LOCKED_REASON = 'guardrail_platform_locked';

// ---------------------------------------------------------------------------
// Workspace rules.
// ---------------------------------------------------------------------------

/**
 * What a workspace rule makes the turn do, besides standing in the prompt's
 * `tenant_compliance` layer:
 *
 *   - `prompt_only`   — the line in the prompt, nothing else;
 *   - `block_output`  — a draft the judge reads as breaking it is rewritten
 *                       once, then replaced by the safe text (as G7);
 *   - `force_handoff` — a player message that falls under it hands over.
 */
export const GUARDRAIL_RULE_ACTIONS = ['prompt_only', 'block_output', 'force_handoff'] as const;
export type GuardrailRuleAction = (typeof GUARDRAIL_RULE_ACTIONS)[number];

/** A rule is one or two sentences, like a behaviour rule (AI-07). */
export const GUARDRAIL_RULE_TITLE_MAX = 120;
export const GUARDRAIL_RULE_BODY_MAX = 600;
/** The rules one agent may hold — the prompt's second layer stays short. */
export const GUARDRAIL_RULES_PER_AGENT_MAX = 50;

/** A workspace rule's category: the catalogue's five groups. */
export const GUARDRAIL_RULE_CATEGORIES: readonly GuardrailCategory[] = GUARDRAIL_CATEGORIES;

// ---------------------------------------------------------------------------
// Forbidden phrases.
// ---------------------------------------------------------------------------

/**
 * How a phrase matches the folded reply:
 *
 *   - `exact` — anywhere, inside a word too ("kesin" in "kesinlikle");
 *   - `word`  — as whole words ("kesin" in "kesin yatar", not "kesinlikle");
 *   - `regex` — a pattern of the dialect below, case-insensitive, `^`/`$`
 *               at a sentence's edges.
 */
export const FORBIDDEN_PHRASE_MATCHES = ['exact', 'word', 'regex'] as const;
export type ForbiddenPhraseMatch = (typeof FORBIDDEN_PHRASE_MATCHES)[number];

/** `block`: rewritten once, then the safe text and a hand-over. `warn`: recorded only. */
export const FORBIDDEN_PHRASE_ACTIONS = ['block', 'warn'] as const;
export type ForbiddenPhraseAction = (typeof FORBIDDEN_PHRASE_ACTIONS)[number];

export const FORBIDDEN_PHRASE_MAX = 200;
export const FORBIDDEN_PHRASE_REGEX_MAX = 120;
export const FORBIDDEN_PHRASES_PER_AGENT_MAX = 200;
/** Patterns cost more than words on every reply, so fewer of them. */
export const FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX = 20;
/** Every repetition in a pattern stops here: `*` is `{0,30}`, `+` is `{1,30}`. */
export const FORBIDDEN_PHRASE_REPEAT_MAX = 30;
/**
 * The ways one start position can be tried, at most: a repetition's range
 * (`{1,30}` is 30), an optional part's 2 and a group's alternatives multiply.
 * `.*` alone is 31, `\d{1,3} .*` 93; `\d+ .*` (930) is refused — measured,
 * two open repetitions cost seconds on a long reply.
 */
export const FORBIDDEN_PHRASE_CHOICES_MAX = 256;

/** A phrase's language — two lower-case letters; null applies to every reply. */
export const FORBIDDEN_PHRASE_LANG = /^[a-z]{2}$/;

/** Why a phrase was refused (`400 validation`, `details.reason`). */
export const FORBIDDEN_PHRASE_PROBLEMS = [
  'forbidden_phrase_empty',
  'forbidden_phrase_too_long',
  'forbidden_phrase_regex_invalid',
  'forbidden_phrase_regex_unsafe',
  'forbidden_phrase_regex_matches_empty',
] as const;
export type ForbiddenPhraseProblemReason = (typeof FORBIDDEN_PHRASE_PROBLEMS)[number];

export interface ForbiddenPhraseProblem {
  reason: ForbiddenPhraseProblemReason;
  message: string;
}

/** A phrase ready to run: the folded words, or the rewritten pattern. */
export type CompiledForbiddenPhrase =
  | { readonly match: 'exact' | 'word'; readonly folded: string }
  | { readonly match: 'regex'; readonly re: RegExp };

type Compiled =
  { ok: true; phrase: CompiledForbiddenPhrase } | { ok: false; problem: ForbiddenPhraseProblem };

const problem = (reason: ForbiddenPhraseProblemReason, message: string): Compiled => ({
  ok: false,
  problem: { reason, message },
});

const SHORTHAND = 'dDwWsS';
const ASSERTION = 'bB';
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
/** The characters a `u`-mode pattern lets a backslash escape; any other punctuation stands bare. */
const SYNTAX = '^$\\.*+?()[]{}|/';

/** An escaped punctuation character as a `u`-mode pattern accepts it (`\-` only inside a class). */
function escapedPunctuation(next: string, inClass: boolean): string {
  return SYNTAX.includes(next) || (inClass && next === '-') ? `\\${next}` : next;
}

/**
 * The pattern written back in the safe dialect, or why it is not one. One pass,
 * left to right, tracking the last thing a quantifier could apply to.
 */
function rewritePattern(
  source: string,
): { ok: true; source: string } | { ok: false; reason: string } {
  let out = '';
  /** What a quantifier here would apply to; `null` after an assertion, `|`, `(` or a quantifier. */
  let last: 'atom' | 'group' | null = null;
  /**
   * The ways to try one place, per open group (the pattern itself first):
   * the finished alternatives' sum, and the current one's product.
   */
  const frames: Array<{ done: number; branch: number }> = [{ done: 0, branch: 1 }];
  const frame = () => frames[frames.length - 1] as { done: number; branch: number };

  const unsafe = (reason: string) => ({ ok: false as const, reason });
  const multiply = (factor: number): boolean => {
    frame().branch *= factor;
    return frame().done + frame().branch <= FORBIDDEN_PHRASE_CHOICES_MAX;
  };
  const overBudget = () =>
    unsafe(
      `its repetitions, optional parts and alternatives allow more than ${FORBIDDEN_PHRASE_CHOICES_MAX} ` +
        'ways to match at one place — narrow a repetition (\\d{1,3} rather than \\d+) or drop an option',
    );

  for (let i = 0; i < source.length;) {
    const ch = source.charAt(i);

    if (ch === '\\') {
      const next = source.charAt(i + 1);
      if (next === '') return unsafe('a pattern cannot end in a backslash');
      if (SHORTHAND.includes(next)) {
        out += `\\${next}`;
        last = 'atom';
      } else if (ASSERTION.includes(next)) {
        out += `\\${next}`;
        last = null;
      } else if (ASCII_PUNCTUATION.test(next)) {
        out += escapedPunctuation(next, false);
        last = 'atom';
      } else {
        return unsafe(
          `\\${next} is not supported (back-references, \\p, \\u, \\x and control escapes)`,
        );
      }
      i += 2;
      continue;
    }

    if (ch === '[') {
      let j = i + 1;
      let body = '';
      if (source.charAt(j) === '^') {
        body += '^';
        j += 1;
      }
      let closed = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === ']') {
          // A `]` first in the class is one of its members ("[]a]"), as outside `u` mode.
          if (body === '' || body === '^') {
            body += '\\]';
            j += 1;
            continue;
          }
          closed = true;
          break;
        }
        if (c === '\\') {
          const next = source.charAt(j + 1);
          if (SHORTHAND.includes(next)) body += `\\${next}`;
          else if (ASCII_PUNCTUATION.test(next)) body += escapedPunctuation(next, true);
          else return unsafe(`\\${next} is not supported inside a character class`);
          j += 2;
          continue;
        }
        const folded = foldLiteral(c);
        if (folded === null) return unsafe(`"${c}" never appears in folded text`);
        body += folded;
        j += 1;
      }
      if (!closed) return unsafe('a character class is not closed');
      out += `[${body}]`;
      last = 'atom';
      i = j + 1;
      continue;
    }

    if (ch === '(') {
      if (source.startsWith('(?:', i)) {
        out += '(?:';
        i += 3;
      } else if (source.charAt(i + 1) === '?') {
        return unsafe('look-arounds and named groups are not supported');
      } else {
        out += '(';
        i += 1;
      }
      frames.push({ done: 0, branch: 1 });
      last = null;
      continue;
    }

    if (ch === ')') {
      if (frames.length === 1) return unsafe('a group is closed that was never opened');
      const closed = frames.pop() as { done: number; branch: number };
      if (!multiply(closed.done + closed.branch)) return overBudget();
      out += ')';
      last = 'group';
      i += 1;
      continue;
    }

    if (ch === '|') {
      frame().done += frame().branch;
      frame().branch = 1;
      if (frame().done + 1 > FORBIDDEN_PHRASE_CHOICES_MAX) return overBudget();
      out += '|';
      last = null;
      i += 1;
      continue;
    }

    if (ch === '^' || ch === '$') {
      out += ch;
      last = null;
      i += 1;
      continue;
    }

    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      if (last === null) return unsafe(`"${ch}" has nothing to repeat`);
      let min: number;
      let max: number;
      let length = 1;
      if (ch === '*') [min, max] = [0, Infinity];
      else if (ch === '+') [min, max] = [1, Infinity];
      else if (ch === '?') [min, max] = [0, 1];
      else {
        const brace = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(source.slice(i));
        if (!brace) return unsafe('"{" must be a repetition like {2} or {1,5}');
        min = Number(brace[1]);
        max = brace[2] === undefined ? min : brace[3] === '' ? Infinity : Number(brace[3]);
        if (max < min) return unsafe(`{${min},${max}} repeats less than it must`);
        length = brace[0].length;
      }
      i += length;
      const lazy = source.charAt(i) === '?';
      if (lazy) i += 1;

      if (max <= 1) {
        // `?`, `{0,1}`, `{1}`, `{0}`: a choice of at most two, on an atom or a group.
        if (min === 0 && max === 1 && !multiply(2)) return overBudget();
        out += `{${min},${max}}`;
      } else {
        if (last === 'group') return unsafe('a group cannot repeat — only "?" may follow ")"');
        if (
          min > FORBIDDEN_PHRASE_REPEAT_MAX ||
          (max !== Infinity && max > FORBIDDEN_PHRASE_REPEAT_MAX)
        ) {
          return unsafe(`a repetition stops at ${FORBIDDEN_PHRASE_REPEAT_MAX}`);
        }
        const top = max === Infinity ? FORBIDDEN_PHRASE_REPEAT_MAX : max;
        if (!multiply(top - min + 1)) return overBudget();
        out += `{${min},${top}}`;
      }
      if (lazy) out += '?';
      last = null;
      continue;
    }

    if (ch === '.') {
      out += '.';
      last = 'atom';
      i += 1;
      continue;
    }

    if (ch === ']' || ch === '}') return unsafe(`"${ch}" must be escaped`);

    const point = source.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(point);
    const folded = foldLiteral(char);
    if (folded === null) return unsafe(`"${char}" never appears in folded text`);
    // A letter that folds to two ("ß" → "ss") stays one unit for a quantifier.
    out += folded.length > 1 ? `(?:${folded})` : folded;
    last = folded.length > 1 ? 'group' : 'atom';
    i += char.length;
  }

  if (frames.length > 1) return unsafe('a group is opened and never closed');
  return { ok: true, source: out };
}

/**
 * One literal character as it appears in folded text: ASCII lower-cased,
 * anything else folded ("ş" → "s"). Null for a character folding leaves
 * nothing of (a symbol, an apostrophe) — it could never match.
 */
function foldLiteral(char: string): string | null {
  if (char.charCodeAt(0) < 128) return char.toLowerCase();
  const folded = foldGuardrailText(char);
  return folded === '' ? null : folded;
}

/** Folded texts a pattern is tried on for an empty match: edges, a word, a boundary-free gap. */
const EMPTY_MATCH_PROBES = ['', 'a', 'ab', '1', ' ', '  ', 'a b', 'a,b', 'a\nb'];

function compile(phrase: string, match: ForbiddenPhraseMatch): Compiled {
  const trimmed = phrase.trim();
  if (trimmed === '') return problem('forbidden_phrase_empty', 'A phrase cannot be empty.');
  const max = match === 'regex' ? FORBIDDEN_PHRASE_REGEX_MAX : FORBIDDEN_PHRASE_MAX;
  if (trimmed.length > max) {
    return problem('forbidden_phrase_too_long', `A ${match} phrase is at most ${max} characters.`);
  }
  if (match !== 'regex') {
    const folded = foldGuardrailText(trimmed);
    if (folded === '') {
      return problem(
        'forbidden_phrase_empty',
        'Nothing is left of this phrase once punctuation is set aside — it could never match.',
      );
    }
    return { ok: true, phrase: { match, folded } };
  }
  const rewritten = rewritePattern(trimmed);
  if (!rewritten.ok) {
    return problem(
      'forbidden_phrase_regex_unsafe',
      `This pattern is not accepted: ${rewritten.reason}.`,
    );
  }
  let re: RegExp;
  try {
    re = new RegExp(rewritten.source, 'imu');
  } catch (error) {
    return problem(
      'forbidden_phrase_regex_invalid',
      `This pattern is not a valid regular expression: ${(error as Error).message}`,
    );
  }
  // A pattern that can match nothing would match every reply.
  for (const probe of EMPTY_MATCH_PROBES) {
    const found = re.exec(probe);
    if (found && found[0] === '') {
      return problem(
        'forbidden_phrase_regex_matches_empty',
        'This pattern can match an empty piece of text, so it would block every reply.',
      );
    }
  }
  return { ok: true, phrase: { match, re } };
}

/** Why a phrase cannot be stored, or null — what every write runs. */
export function forbiddenPhraseProblem(
  phrase: string,
  match: ForbiddenPhraseMatch,
): ForbiddenPhraseProblem | null {
  const result = compile(phrase, match);
  return result.ok ? null : result.problem;
}

/** The phrase ready to run, or null for one {@link forbiddenPhraseProblem} refuses. */
export function compileForbiddenPhrase(
  phrase: string,
  match: ForbiddenPhraseMatch,
): CompiledForbiddenPhrase | null {
  const result = compile(phrase, match);
  return result.ok ? result.phrase : null;
}

/** One phrase found in a reply, quoted in the reply's own words. */
export interface ForbiddenPhraseHit {
  /** The phrase's place in the list given. */
  readonly index: number;
  /** The matched range in the original text, `[start, end)`. */
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

const WORD_CHAR = /[a-z0-9%]/;

/** The first occurrence of `folded` in `text` standing as whole words, or -1. */
function wordIndex(text: string, folded: string): number {
  for (let at = text.indexOf(folded); at !== -1; at = text.indexOf(folded, at + 1)) {
    const before = at === 0 ? '' : text.charAt(at - 1);
    const after = text.charAt(at + folded.length);
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return at;
  }
  return -1;
}

/**
 * The first match of each phrase in the text, in list order; a phrase that
 * does not match is left out. The text is normalised once for all of them.
 */
export function matchForbiddenPhrases(
  text: string,
  phrases: readonly CompiledForbiddenPhrase[],
): ForbiddenPhraseHit[] {
  const normalized = normalizeGuardrailText(text);
  const folded = normalized.text;
  if (folded === '') return [];
  const hits: ForbiddenPhraseHit[] = [];
  phrases.forEach((phrase, index) => {
    let at: number;
    let length: number;
    if (phrase.match === 'regex') {
      const found = phrase.re.exec(folded);
      if (!found || found[0] === '') return;
      at = found.index;
      length = found[0].length;
    } else {
      at =
        phrase.match === 'word' ? wordIndex(folded, phrase.folded) : folded.indexOf(phrase.folded);
      length = phrase.folded.length;
    }
    if (at === -1) return;
    const start = normalized.starts[at] as number;
    const end = normalized.ends[at + length - 1] as number;
    hits.push({
      index,
      start,
      end,
      quote: text.slice(start, end).trim().slice(0, GUARDRAIL_QUOTE_MAX),
    });
  });
  return hits;
}

// ---------------------------------------------------------------------------
// The record of a hit (`ai_guardrail_hits`).
// ---------------------------------------------------------------------------

/**
 * What the turn did about a hit:
 *
 *   - `handoff`      — handed over (a `force_handoff` rule);
 *   - `crisis_text`  — sent the crisis text verbatim, then handed over (G3);
 *   - `rewrite`      — sent the draft back for its one rewrite;
 *   - `safe_text`    — the rewrite still broke it: the step's verbatim text or
 *                      the safe text went out, and the turn handed over;
 *   - `prompt_block` — put the promotion ban into the prompt (G4);
 *   - `warn`         — recorded, nothing blocked;
 *   - `evidence`     — a lexicon hit kept as evidence the rule did not act on
 *                      alone (G2, G13, G15 without the understanding call).
 */
export const GUARDRAIL_HIT_ACTIONS = [
  'handoff',
  'crisis_text',
  'rewrite',
  'safe_text',
  'prompt_block',
  'warn',
  'evidence',
] as const;
export type GuardrailHitAction = (typeof GUARDRAIL_HIT_ACTIONS)[number];

/** Whose rule a hit is: the platform catalogue's, a workspace rule's or a forbidden phrase's. */
export type GuardrailHitRule =
  | { source: 'platform'; id: GuardrailId }
  | { source: 'rule'; id: string }
  | { source: 'phrase'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `ai_guardrail_hits.rule_key`: `G3`, `rule:<uuid>` or `phrase:<uuid>`. */
export function guardrailHitRuleKey(rule: GuardrailHitRule): string {
  return rule.source === 'platform' ? rule.id : `${rule.source}:${rule.id}`;
}

/** A stored rule key read back, or null for one that is none of the three. */
export function readGuardrailHitRuleKey(key: string): GuardrailHitRule | null {
  if (isGuardrailId(key)) return { source: 'platform', id: key };
  const colon = key.indexOf(':');
  const source = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if ((source === 'rule' || source === 'phrase') && UUID.test(id)) return { source, id };
  return null;
}
