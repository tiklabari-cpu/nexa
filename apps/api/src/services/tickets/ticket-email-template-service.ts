/**
 * Ticket e-mail templates — branded, variabled ticket mail (FR-MOD-08.7.5).
 *
 * The CRUD half: list, create, edit and delete the templates a workspace
 * authors. The one property that carries the requirement is the KK "Geçersiz
 * değişken/format engeli": a template's subject and body may only contain
 * `{{ group.field }}` placeholders naming variables the product can fill, and
 * only through well-formed braces. That judgement is not made here — it lives in
 * `@nexa/types` so the authoring form and this endpoint agree on it — but it is
 * *enforced* here, on every create and on every edit that touches the text, so a
 * template that would render broken mail can never reach the table.
 */
import type { Prisma } from '@prisma/client';
import type { TicketEmailTemplate, TicketStatus } from '@nexa/types';
import { findTemplateProblemsIn } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { type AuditContext, writeAuditEntry } from '../audit/audit-log.js';
import { renderTicketEmail, type RenderedTicketEmail } from './ticket-email.js';

export interface TicketEmailTemplateInput {
  name: string;
  subject: string;
  body: string;
  enabled?: boolean;
}

export interface TicketEmailTemplatePatch {
  name?: string;
  subject?: string;
  body?: string;
  enabled?: boolean;
}

interface TicketEmailTemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class TicketEmailTemplateService {
  /** Every template in the tenant, oldest first — the order they were authored. */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
  ): Promise<{ items: TicketEmailTemplate[]; total: number }> {
    const rows = await tx.ticketEmailTemplate.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: [{ createdAt: 'asc' }],
    });
    const items = rows.map(toDto);
    return { items, total: items.length };
  }

  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: TicketEmailTemplateInput,
  ): Promise<TicketEmailTemplate> {
    const name = input.name.trim();
    if (!name) throw ApiError.validation('name: a template needs a name.');
    assertPlaceholdersValid(input.subject, input.body);

    const created = await tx.ticketEmailTemplate.create({
      data: {
        licenseId: tenant.licenseId,
        name,
        subject: input.subject,
        body: input.body,
        enabled: input.enabled ?? true,
      },
    });
    return toDto(created);
  }

  /**
   * Edit a template or toggle it on/off. Only the keys supplied change. When
   * either the subject or the body is touched, the *resulting* pair is
   * re-validated — an edit can no more introduce an unknown or malformed
   * placeholder than a create can.
   */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: TicketEmailTemplatePatch,
  ): Promise<TicketEmailTemplate> {
    const existing = await tx.ticketEmailTemplate.findFirst({
      where: { id, licenseId: tenant.licenseId },
    });
    if (!existing) throw ApiError.notFound('Ticket e-mail template not found.');

    if (patch.subject !== undefined || patch.body !== undefined) {
      assertPlaceholdersValid(patch.subject ?? existing.subject, patch.body ?? existing.body);
    }

    const data: Prisma.TicketEmailTemplateUpdateInput = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw ApiError.validation('name: a template needs a name.');
      data.name = name;
    }
    if (patch.subject !== undefined) data.subject = patch.subject;
    if (patch.body !== undefined) data.body = patch.body;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;

    const updated = await tx.ticketEmailTemplate.update({ where: { id }, data });
    return toDto(updated);
  }

  /**
   * Turn one stored template into the message a ticket transition should send,
   * or refuse (FR-MOD-08.7.5 — the consuming half).
   *
   * Runs *inside* the caller's transaction, before the transition is applied, so
   * every refusal below rolls the whole change back. That ordering is the point:
   * an agent who asked to solve a ticket *and* tell the customer must not end up
   * with a solved ticket and a silent customer. Either both happen or neither
   * does, and the reason is on the response.
   *
   * The lookup is licence-scoped, so a template id from another workspace is
   * simply not found — the same 404 an invented id gets (NFR-S5: absent, not
   * forbidden). RLS says the same thing underneath; the `where` is the belt.
   *
   * Nothing is sent from here. The rendered message goes back to the caller to
   * be handed to the mailer *after* the commit, because a mail is a side effect
   * that must not be able to hold a transaction open or be undone by a rollback.
   */
  async prepareTicketEmail(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      templateId: string;
      ticket: {
        id: string;
        subject: string;
        priority: number;
        customer_name: string | null;
        customer_email: string | null;
      };
      /** The status the ticket is moving to — what the notice is about. */
      nextStatus: TicketStatus;
      /** The account behind the change, or null when the caller names no person. */
      agentAccountId: string | null;
    },
  ): Promise<RenderedTicketEmail> {
    const template = await tx.ticketEmailTemplate.findFirst({
      where: { id: input.templateId, licenseId: tenant.licenseId },
      select: { id: true, subject: true, body: true, enabled: true },
    });
    if (!template) throw ApiError.notFound('Ticket e-mail template not found.');

    // The two names a *branded* notice needs: who is writing, and on whose
    // behalf. Both are best-effort — a template that names neither renders
    // identically either way, and a missing account is not a reason to refuse a
    // message the customer is waiting for.
    const [agent, organization] = await Promise.all([
      input.agentAccountId
        ? tx.account.findUnique({ where: { id: input.agentAccountId }, select: { name: true } })
        : Promise.resolve(null),
      tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { name: true },
      }),
    ]);

    const outcome = renderTicketEmail(template, {
      ticketId: input.ticket.id,
      subject: input.ticket.subject,
      status: input.nextStatus,
      priority: input.ticket.priority,
      customerName: input.ticket.customer_name,
      customerEmail: input.ticket.customer_email,
      agentName: agent?.name ?? null,
      companyName: organization?.name ?? null,
    });

    if (outcome.ok) return outcome.message;

    // Each refusal names what the sender has to change, and none of them leaks
    // the rendered text — the messages talk about the *template*, never about
    // the customer.
    switch (outcome.refusal.reason) {
      case 'disabled':
        throw ApiError.validation(
          'email_template_id: this template is turned off; enable it before sending with it.',
        );
      case 'invalid_template':
        throw ApiError.validation(
          `email_template_id: ${outcome.refusal.problem.field}: ${outcome.refusal.problem.message}`,
        );
      case 'no_recipient':
        throw ApiError.validation(
          'email_template_id: this ticket has no customer e-mail address to write to.',
        );
    }
  }

  /** Delete a template. Scoped by licence so an id alone cannot reach another tenant's. */
  async remove(
    tx: TenantClient,
    tenant: TenantContext,
    audit: AuditContext,
    id: string,
  ): Promise<void> {
    const { count } = await tx.ticketEmailTemplate.deleteMany({
      where: { id, licenseId: tenant.licenseId },
    });
    if (count === 0) throw ApiError.notFound('Ticket e-mail template not found.');
    // Only a delete that actually happened is worth an entry.
    await writeAuditEntry(tx, audit, {
      action: 'data.deleted',
      target: `ticket_email_template:${id}`,
      metadata: { kind: 'ticket_email_template' },
    });
  }
}

/**
 * Reject a subject/body pair that names a variable the product cannot fill, or
 * that carries a malformed placeholder — the KK, enforced. The judgement is the
 * shared one from `@nexa/types`; here it is turned into the first offending
 * problem's message so the author sees what to fix.
 */
function assertPlaceholdersValid(subject: string, body: string): void {
  const problems = findTemplateProblemsIn({ subject, body });
  const problem = problems[0];
  if (problem) throw ApiError.validation(`${problem.field}: ${problem.message}`);
}

function toDto(row: TicketEmailTemplateRow): TicketEmailTemplate {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
