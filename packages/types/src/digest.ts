/**
 * Daily / weekly summary e-mails (RP-05 · tm 372): the vocabulary the member's
 * switch, the workspace default and the sweep share.
 *
 * A summary is sent at 08:00 in the company's time zone — each Monday for the
 * weekly one — to the people who run the support desk and would otherwise have
 * to open the panel to learn what happened overnight. What a summary says is
 * decided by the server from the recipient's report reach (RP-01 · RL-02); the
 * e-mail carries counts and panel links by id, never a player's name, user
 * name or message text.
 *
 * Plain literals and function declarations only: this module reaches the widget
 * loader through the barrel, and a top-level call would keep it in that bundle.
 */
import type { AgentRole } from './domain.js';

export const DIGEST_FREQUENCIES = ['daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export function isDigestFrequency(value: unknown): value is DigestFrequency {
  return typeof value === 'string' && (DIGEST_FREQUENCIES as readonly string[]).includes(value);
}

/** The local hour a summary is due, in the company's time zone. */
export const DIGEST_SEND_HOUR = 8;

/**
 * How long after it is due a weekly summary is still sent. A daily summary is
 * never older than a day (the next one replaces it); a weekly one would
 * otherwise go out days late when the server was away, or the moment somebody
 * switched it on in mid-week.
 */
export const DIGEST_WEEKLY_GRACE_HOURS = 48;

/**
 * Which roles receive each summary until a workspace says otherwise: the
 * Founder, the Administrators and the Team Leads the daily one (a Team Lead's
 * covers only the teams they lead), nobody the weekly one, and a plain Agent
 * neither. A member's own switch beats this.
 */
export const DEFAULT_DIGEST_ROLES: Readonly<Record<DigestFrequency, readonly AgentRole[]>> = {
  daily: ['owner', 'viceowner', 'admin', 'team_lead'],
  weekly: [],
};

/** The workspace default as `GET /settings/digests` states it. */
export interface DigestSettings {
  daily_roles: AgentRole[];
  weekly_roles: AgentRole[];
}

/** Whether `role` receives a summary by default under `roles` (the workspace's, or the shipped ones). */
export function digestOnByDefault(
  role: string,
  frequency: DigestFrequency,
  roles: Readonly<Record<DigestFrequency, readonly string[]>> = DEFAULT_DIGEST_ROLES,
): boolean {
  return roles[frequency].includes(role);
}

/**
 * The switch a member ends up with: their own choice, or — while they have made
 * none (`null`) — the workspace default for their role.
 */
export function effectiveDigestSwitch(
  own: boolean | null | undefined,
  role: string,
  frequency: DigestFrequency,
  roles: Readonly<Record<DigestFrequency, readonly string[]>> = DEFAULT_DIGEST_ROLES,
): boolean {
  return own ?? digestOnByDefault(role, frequency, roles);
}

/** `digest_deliveries.period_key`: `D2026-10-31` (a day) or `W2026-10-26` (the week opening that Monday). */
export const DIGEST_PERIOD_KEY_PATTERN = /^[DW]\d{4}-\d{2}-\d{2}$/;
