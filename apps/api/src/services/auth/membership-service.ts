/**
 * What it *means* to suspend or reinstate a membership — in one place, because
 * there are now two callers (NFR-S11 · S11-f).
 *
 * `PUT /agents/{id}/suspension` is an admin deciding about a colleague;
 * `PATCH /scim/v2/Users/{id}` (and its `DELETE`) is a directory connector
 * deciding about an employee record. They differ entirely in who may ask and
 * how the request is spelled, and not at all in what has to happen afterwards:
 *
 *   1. the `suspended` flag moves — and only if it is actually moving, so a
 *      nightly full-profile sync that restates today's state writes nothing;
 *   2. a presence event is appended, because routing skips a suspended agent
 *      whatever their `routing_status` says (`routing-service.ts`: `AND NOT
 *      m.suspended`), and a staffing forecast reading only `routing_status`
 *      would count every suspended hour as covered;
 *   3. an audit entry is written, in the same transaction as both.
 *
 * Letting the second caller write its own version of that list is how the
 * product ends up with two ways to cut somebody off, one of which forgets step 3
 * — and the one that forgets is always the unattended one, whose entries are the
 * only record that anything happened at all. So the list lives here and the
 * routes bring their own authorisation.
 *
 * ## What stays with the caller
 *
 * Everything about *whether the asker may*. The agent route's privilege ceiling
 * (no suspending yourself, nobody above your own rank) is about one signed-in
 * person's standing; SCIM's owner guard is about a credential's reach. Neither
 * generalises to the other, and folding them together here would produce a
 * function whose refusals nobody could predict from the call site.
 *
 * The one rule this file *does* keep is the one that is about the workspace
 * rather than the asker: reading the membership under RLS, so a row outside the
 * caller's licence is not there to update. The `where` below is keyed on the
 * composite primary key as well, so even a misconfigured policy could not widen
 * it.
 */
import type { TenantClient } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';

/** The membership as the caller has already read it, under its own tenant. */
export interface SuspendableMembership {
  licenseId: bigint;
  agentId: string;
  suspended: boolean;
  role: string;
  routingStatus: string;
}

export interface SuspensionOptions {
  /**
   * Merged into the audit entry alongside the member's role. SCIM uses it to
   * name the credential that ordered the change; the agent route has an
   * `actor_id` and needs nothing.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Move a membership to `suspended`, or report that it was already there.
 *
 * Returns whether anything changed — the caller uses it to decide whether to
 * re-read the row for its reply, and it is the reason a repeated deprovision
 * leaves one audit entry rather than one per retry.
 */
export async function setMembershipSuspension(
  tx: TenantClient,
  audit: AuditContext,
  membership: SuspendableMembership,
  suspended: boolean,
  options: SuspensionOptions = {},
): Promise<boolean> {
  if (membership.suspended === suspended) return false;

  await tx.agentMembership.update({
    where: {
      licenseId_agentId: { licenseId: membership.licenseId, agentId: membership.agentId },
    },
    data: { suspended },
  });

  // `routing_status` is deliberately left alone: it is the agent's own setting,
  // and coming back should return them to the status they chose rather than to
  // one suspension imposed. That is why the event's status is computed rather
  // than copied — suspending records `offline`, reinstating records whatever
  // they still hold. An agent who was already `offline` sees no event either
  // way: nothing about their availability changed.
  if (membership.routingStatus !== 'offline') {
    await tx.agentPresenceEvent.create({
      data: {
        licenseId: membership.licenseId,
        agentId: membership.agentId,
        status: suspended ? 'offline' : membership.routingStatus,
      },
    });
  }

  await writeAuditEntry(tx, audit, {
    action: suspended ? 'member.suspended' : 'member.unsuspended',
    target: `account:${membership.agentId}`,
    metadata: { role: membership.role, ...options.metadata },
  });

  return true;
}
