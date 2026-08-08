/**
 * Scheduled report exports — the definitions (PRD §5.3-Reports).
 *
 * This is the CRUD half: the standing instructions a workspace configures for
 * "mail me the Leads report every Monday". The scheduler that *runs* them —
 * period keys, the single-delivery claim, the mail itself — lands separately
 * (07.9-sched-e), so the settings surface and the delivery hot-path share the
 * table and nothing else.
 *
 * Two validations carry the weight here, and both are about what a definition
 * can be pointed at:
 *
 *   - `group` is resolved against the report catalogue (`REPORT_GROUPS`), the
 *     same one `GET /reports/export` uses. A schedule naming a group that does
 *     not exist would sit inert until its first run, then fail forever.
 *   - `recipients` must be mailboxes of active agents on this same license. A
 *     schedule is the one place report data leaves the workspace unattended; if
 *     it accepted free text, "define a schedule" would become a way to mail the
 *     workspace's numbers anywhere, to anyone, on a timer. Bounding the list by
 *     the roster keeps the blast radius inside the tenant.
 */
import type { ScheduledExport, ScheduledExportFrequency } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { reportGroup } from '../../routes/reports-export.js';

export interface ScheduledExportInput {
  group: string;
  frequency: ScheduledExportFrequency;
  format: 'csv';
  recipients: string[];
  enabled?: boolean;
  /** The agent defining the schedule, kept as a soft reference for the UI. */
  createdByAgentId?: string;
}

/** Every field optional; only what is supplied changes. */
export interface ScheduledExportPatch {
  group?: string;
  frequency?: ScheduledExportFrequency;
  format?: 'csv';
  recipients?: string[];
  enabled?: boolean;
}

interface ScheduledReportRow {
  id: string;
  groupId: string;
  frequency: string;
  format: string;
  recipients: string[];
  enabled: boolean;
  createdAt: Date;
  lastRunAt: Date | null;
}

export class ScheduledReportService {
  /** Every definition in the tenant, newest last so the list reads as a history. */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
  ): Promise<{ items: ScheduledExport[]; total: number }> {
    const rows = await tx.scheduledReport.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: [{ createdAt: 'asc' }],
    });
    const items = rows.map(toDto);
    return { items, total: items.length };
  }

  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: ScheduledExportInput,
  ): Promise<ScheduledExport> {
    // A 400, not a 404, for the same reason the export endpoint gives one: the
    // group is a request parameter the caller got wrong, not a resource whose
    // existence is a tenant secret.
    const group = reportGroup(input.group);
    if (!group) throw ApiError.validation(`group: unknown report group: ${input.group}.`);

    const recipients = await resolveRecipients(tx, tenant, input.recipients);

    const created = await tx.scheduledReport.create({
      data: {
        licenseId: tenant.licenseId,
        groupId: group.id,
        frequency: input.frequency,
        format: input.format,
        recipients,
        enabled: input.enabled ?? true,
        ...(input.createdByAgentId ? { createdByAgentId: input.createdByAgentId } : {}),
      },
    });
    return toDto(created);
  }

  /**
   * One definition by id.
   *
   * Scoped by licence in the `where` even though RLS already narrows the table:
   * belt and braces, and it makes the miss a `not found` rather than a row this
   * code would otherwise have had to check afterwards. Another tenant's id is
   * indistinguishable from an id that never existed — a 403 would confirm the
   * schedule is real, which is itself something one workspace should not learn
   * about another.
   */
  async get(tx: TenantClient, tenant: TenantContext, id: string): Promise<ScheduledExport> {
    const row = await tx.scheduledReport.findFirst({
      where: { id, licenseId: tenant.licenseId },
    });
    if (!row) throw ApiError.notFound('Scheduled export not found.');
    return toDto(row);
  }

  /**
   * Edit a definition. Only the supplied fields change.
   *
   * Every value that can be changed is re-validated exactly as `create`
   * validates it: a new `group` against the catalogue, a new `recipients` list
   * against the licence's roster. This is not defensive duplication — the roster
   * check is the boundary that keeps report data inside the workspace, and a
   * PATCH that skipped it would reopen the leak `create` closes, since anyone
   * who can create a schedule can immediately edit it.
   */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: ScheduledExportPatch,
  ): Promise<ScheduledExport> {
    const existing = await tx.scheduledReport.findFirst({
      where: { id, licenseId: tenant.licenseId },
    });
    if (!existing) throw ApiError.notFound('Scheduled export not found.');

    const data: {
      groupId?: string;
      frequency?: string;
      format?: string;
      recipients?: string[];
      enabled?: boolean;
    } = {};

    if (patch.group !== undefined) {
      const group = reportGroup(patch.group);
      if (!group) throw ApiError.validation(`group: unknown report group: ${patch.group}.`);
      data.groupId = group.id;
    }
    if (patch.frequency !== undefined) data.frequency = patch.frequency;
    if (patch.format !== undefined) data.format = patch.format;
    if (patch.recipients !== undefined) {
      data.recipients = await resolveRecipients(tx, tenant, patch.recipients);
    }
    if (patch.enabled !== undefined) data.enabled = patch.enabled;

    const updated = await tx.scheduledReport.update({ where: { id }, data });
    return toDto(updated);
  }

  /**
   * Cancel a definition.
   *
   * `deleteMany` with the licence in the filter rather than `delete` by id: a
   * delete keyed on the primary key alone would reach across tenants if RLS were
   * ever misconfigured, and the zero-row result is exactly the `not found` this
   * wants to answer. The definition's runs go with it through the composite FK's
   * cascade (07.9-sched-a) — a cancelled schedule leaves no orphaned history
   * pointing at a definition nobody can read.
   */
  async remove(tx: TenantClient, tenant: TenantContext, id: string): Promise<void> {
    const { count } = await tx.scheduledReport.deleteMany({
      where: { id, licenseId: tenant.licenseId },
    });
    if (count === 0) throw ApiError.notFound('Scheduled export not found.');
  }
}

/**
 * Turn the requested addresses into the licence's own stored spellings, or
 * refuse.
 *
 * The roster is read through the tenant client, so RLS has already narrowed it
 * to the caller's licence — another workspace's agent fails here exactly as an
 * invented address does, and the error says the same thing either way, so the
 * endpoint never becomes an oracle for "does this person work at that company".
 *
 * A suspended member is refused too: they have been cut off from the workspace,
 * and a schedule naming them would keep mailing them its reports indefinitely.
 * Addresses are matched case-insensitively (accounts store e-mail as `citext`)
 * and stored in the roster's spelling, so the delivery step never has to guess
 * which of two casings is the real mailbox. Duplicates collapse — a list that
 * named someone twice would mail them twice.
 */
async function resolveRecipients(
  tx: TenantClient,
  tenant: TenantContext,
  requested: readonly string[],
): Promise<string[]> {
  const memberships = await tx.agentMembership.findMany({
    where: { licenseId: tenant.licenseId, suspended: false },
    select: { agent: { select: { email: true } } },
  });
  const roster = new Map(memberships.map((m) => [m.agent.email.toLowerCase(), m.agent.email]));

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const address of requested) {
    const key = address.trim().toLowerCase();
    const known = roster.get(key);
    if (!known) {
      throw ApiError.validation(
        `recipients: ${address} is not an active agent on this licence. ` +
          'A scheduled export may only be delivered to this workspace’s team.',
      );
    }
    if (seen.has(known)) continue;
    seen.add(known);
    resolved.push(known);
  }

  // Unreachable through the route (zod enforces a non-empty array), but the
  // database CHECK says the same thing and this keeps the service honest on its
  // own: a definition with no recipients still claims its delivery period and
  // then mails nobody, silently, forever.
  if (resolved.length === 0) throw ApiError.validation('recipients: at least one is required.');
  return resolved;
}

function toDto(row: ScheduledReportRow): ScheduledExport {
  return {
    id: row.id,
    group: row.groupId,
    frequency: row.frequency as ScheduledExportFrequency,
    format: row.format as 'csv',
    recipients: row.recipients,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    last_run_at: row.lastRunAt?.toISOString() ?? null,
  };
}
