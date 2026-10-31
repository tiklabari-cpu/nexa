/**
 * Saved-reply variables (IN-06).
 *
 * A saved reply may carry `{{customer.name}}`-style placeholders — the same
 * spelling ticket e-mail templates use (`template-variables.ts`), so a
 * workspace learns one syntax and the validator is one function. The two
 * catalogues differ because the two are filled in different places: a template
 * is rendered on the server when the mail goes out, a saved reply in the agent's
 * composer the moment it is inserted, where the agent reads the finished text
 * and can still change it before it is sent.
 *
 * Plain literals and functions only: this module reaches the widget loader
 * through the barrel, and a top-level call would keep it in that bundle.
 */
import { findPlaceholderProblems, type PlaceholderProblem } from './template-variables.js';

/**
 * What a saved reply may name. `chat.id` is the code's chat (the member's day,
 * shown under the ids catalogue's thread label) and `thread.id` one connection
 * (the catalogue's chat label) — K1 = A; the code names do not change.
 */
export const CANNED_VARIABLES = [
  'customer.name',
  'customer.first_name',
  'customer.username',
  'customer.email',
  'agent.name',
  'agent.first_name',
  'chat.id',
  'thread.id',
  'company.name',
] as const;

export type CannedVariable = (typeof CANNED_VARIABLES)[number];

/** The values the composer has for one conversation; a missing or blank one gets the fallback. */
export type CannedValues = Partial<Record<CannedVariable, string | null>>;

/** Every placeholder problem in a saved reply's text — empty means it may be stored. */
export function findCannedResponseProblems(text: string): PlaceholderProblem[] {
  return findPlaceholderProblems(text, CANNED_VARIABLES);
}

/** Longest a filled-in value may be; a pasted paragraph as a "name" is cut, not inserted whole. */
export const CANNED_VALUE_MAX = 120;

/**
 * A value as it may enter the reply. It can be whatever the player typed as
 * their name, so it is neutralised before it is spliced in:
 *  - line breaks and runs of whitespace collapse to one space (a name cannot
 *    start a `- ` bullet line or split the reply);
 *  - `*` becomes `∗` (U+2217), so a name cannot open or close the composer's
 *    `**bold**` / `*italic*` markers;
 *  - control characters go;
 *  - it is cut to {@link CANNED_VALUE_MAX}.
 * Braces need nothing: filling is one pass over the reply's own placeholders,
 * so a `{{agent.name}}` typed as a name is never expanded.
 */
export function escapeCannedValue(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\*/g, '∗')
      .trim()
      .slice(0, CANNED_VALUE_MAX)
      .trim()
  );
}

/** The first word of a name — `agent.first_name` / `customer.first_name`. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** A filled reply, and where the fallback phrase landed in it (the composer selects the first). */
export interface FilledCannedResponse {
  text: string;
  /** `[start, end)` offsets of every fallback phrase in `text`, in order. */
  fallbacks: Array<{ start: number; end: number }>;
}

/**
 * Fill a saved reply's placeholders. A variable with a value gets the value
 * (escaped); one without — no name given, a hidden e-mail — gets `fallback`,
 * and its position is returned so the composer can select it for the agent to
 * overtype. A placeholder that names no known variable (a row stored before
 * validation) is left exactly as written rather than guessed at.
 */
export function fillCannedResponse(
  text: string,
  values: CannedValues,
  fallback: string,
): FilledCannedResponse {
  const pattern = /\{\{\s*([^{}]*?)\s*\}\}/g;
  const fallbacks: FilledCannedResponse['fallbacks'] = [];
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = (match[1] ?? '').trim();
    out += text.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    if (!(CANNED_VARIABLES as readonly string[]).includes(name)) {
      out += match[0];
      continue;
    }
    const raw = values[name as CannedVariable];
    const value = raw ? escapeCannedValue(raw) : '';
    if (value) {
      out += value;
    } else {
      fallbacks.push({ start: out.length, end: out.length + fallback.length });
      out += fallback;
    }
  }
  out += text.slice(cursor);
  return { text: out, fallbacks };
}
