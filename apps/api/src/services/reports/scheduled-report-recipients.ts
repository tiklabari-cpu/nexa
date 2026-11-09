/**
 * Who may receive a scheduled report (tm 440 · the 2026-11-06 audit's F23).
 *
 * One answer, asked twice: when a schedule is saved (`ScheduledReportService`
 * refuses an address outside it) and again when a period is sent (the sweep
 * drops an address that has left it since). The second ask is the reason this
 * file exists — the check used to run only on save, so a member suspended or
 * removed afterwards, or whose report access was taken away, kept receiving
 * the workspace's figures every morning.
 *
 * A recipient is a member of this licence who
 *
 *   - is not suspended and not awaiting approval — both mean "cut off from the
 *     workspace" for every other surface, and
 *   - may read the workspace's reports: the RL-02 capability `reports.view`
 *     resolves to `all` for their role, with this workspace's overrides. A
 *     scheduled report is a workspace-wide CSV, so `team` (a lead's own
 *     teams) is not enough — mailing it would hand a lead figures their panel
 *     refuses them.
 *
 * A removed member has no membership row, so they are simply not on the
 * roster. Addresses are matched case-insensitively (accounts store e-mail as
 * `citext`) and keyed in lower case.
 *
 * The roster is read through the tenant client, so RLS has already narrowed
 * it to the caller's licence.
 */
import { capabilitiesForRole } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { readPermissionMatrix } from '../auth/permission-matrix.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';

export interface ReportRecipient {
  /** The address as the account stores it — the spelling a mail is sent to. */
  email: string;
  /** The member's panel language, for the mail (tm 265). */
  locale: MailLocale;
}

/** Lower-cased address → the member it belongs to. */
export type ReportRecipientRoster = ReadonlyMap<string, ReportRecipient>;

export async function reportRecipientRoster(
  tx: TenantClient,
  licenseId: bigint,
): Promise<ReportRecipientRoster> {
  const members = await tx.agentMembership.findMany({
    where: { licenseId, suspended: false, awaitingApproval: false },
    select: { role: true, locale: true, agent: { select: { email: true } } },
  });
  const matrix = await readPermissionMatrix(tx, licenseId);
  const readsReports = new Map<string, boolean>();
  const roster = new Map<string, ReportRecipient>();
  for (const member of members) {
    let allowed = readsReports.get(member.role);
    if (allowed === undefined) {
      allowed = capabilitiesForRole(member.role, matrix.overrides)['reports.view'] === 'all';
      readsReports.set(member.role, allowed);
    }
    if (!allowed) continue;
    roster.set(member.agent.email.toLowerCase(), {
      email: member.agent.email,
      locale: isMailLocale(member.locale) ? member.locale : 'en',
    });
  }
  return roster;
}

export interface RecipientSplit {
  /** Still on the roster, in the definition's order, each mailbox once. */
  kept: ReportRecipient[];
  /** Configured addresses the roster no longer holds, each once. */
  dropped: string[];
}

/** Split a definition's stored recipients by the roster as it stands now. */
export function splitRecipients(
  recipients: readonly string[],
  roster: ReportRecipientRoster,
): RecipientSplit {
  const kept: ReportRecipient[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const address of recipients) {
    const key = address.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const member = roster.get(key);
    if (member) kept.push(member);
    else dropped.push(address);
  }
  return { kept, dropped };
}

/**
 * An address in the form it may be logged: the first character of the local
 * part and the domain — enough for an operator to tell two dropped recipients
 * apart, not enough to name the person.
 */
export function maskRecipient(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}
