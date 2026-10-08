/**
 * Turning the audit trail's raw identifiers into words (O8, tm 259.16).
 *
 * The trail stores `auth.login`, an actor UUID and `license:1000006` because
 * those are stable, greppable and what the CSV export must carry for a
 * reviewer. The screen is for a person: it says "Signed in", names the teammate,
 * and says "Workspace". Nothing here ever *replaces* the raw value — each
 * helper returns the words plus, where there is something to copy, the raw
 * value for a second line.
 *
 * Three rules shared by all of them:
 *   - A code, actor or target kind this panel has no wording for is shown as
 *     written. The server's vocabulary grows faster than a panel is released, and
 *     hiding a new action behind a blank would be worse than showing its code.
 *   - Nothing is invented. An agent who is not on the roster (removed, or the
 *     roster could not be read) is a shortened id, never a guessed name.
 *   - Wording lives in the catalogues (`audit.action.*`, `audit.target.*`); a
 *     parity test (`audit-labels.test.ts`) fails when the server writes an
 *     action that has no label.
 */
import { hasMessage, type TFunction } from '../../lib/i18n.js';

/** What `GET /agents` returns for a teammate, as far as this screen reads it. */
export interface RosterMember {
  id: string;
  name: string;
  email: string;
}

export type Roster = ReadonlyMap<string, RosterMember>;

export function buildRoster(items: readonly RosterMember[] | undefined): Roster {
  return new Map((items ?? []).map((member) => [member.id, member]));
}

/** The action's words, or the code itself when no label exists for it. */
export function actionLabel(t: TFunction, code: string): string {
  const key = `audit.action.${code}`;
  return hasMessage('en', key) ? t(key) : code;
}

/** `a1111111-…` → `a1111111…`: enough to tell two ids apart, not enough to read as data. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** One cell of two lines: the words, and (optionally) a quieter line under them. */
export interface CellText {
  primary: string;
  secondary?: string;
  /** The full raw value, for a hover when `primary` or `secondary` shortens it. */
  title?: string;
}

export function actorCell(
  t: TFunction,
  actorType: 'agent' | 'bot' | 'customer' | 'system',
  actorId: string | null,
  roster: Roster,
): CellText {
  const kind = t(`audit.actor.${actorType}`);
  if (!actorId) return { primary: kind };

  const member = actorType === 'agent' ? roster.get(actorId) : undefined;
  if (member) {
    const named = member.name.trim() !== '';
    return {
      primary: named ? member.name : member.email,
      ...(named && member.email ? { secondary: member.email } : {}),
      title: actorId,
    };
  }
  return { primary: kind, secondary: shortId(actorId), title: actorId };
}

/**
 * Target kinds whose id is itself the readable part — an app's client id —
 * read "App: <id>" rather than "App" over the same id.
 */
const ID_IS_THE_NAME = new Set(['client', 'partner_app']);

export function targetCell(t: TFunction, target: string | null, roster: Roster): CellText | null {
  if (target === null) return null;

  const colon = target.indexOf(':');
  const kind = colon > 0 ? target.slice(0, colon) : '';
  const key = `audit.target.${kind}`;
  if (kind === '' || !hasMessage('en', key)) return { primary: target };

  const id = target.slice(colon + 1);
  const label = t(key);
  if (ID_IS_THE_NAME.has(kind)) return { primary: `${label}: ${id}`, secondary: target };
  if (kind === 'account') {
    const member = roster.get(id);
    if (member) {
      return { primary: `${label}: ${member.name.trim() || member.email}`, secondary: target };
    }
  }
  return { primary: label, secondary: target };
}
