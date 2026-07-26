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
import type { TicketEmailTemplate } from '@nexa/types';
import { findTemplateProblemsIn } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

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

  /** Delete a template. Scoped by licence so an id alone cannot reach another tenant's. */
  async remove(tx: TenantClient, tenant: TenantContext, id: string): Promise<void> {
    const { count } = await tx.ticketEmailTemplate.deleteMany({
      where: { id, licenseId: tenant.licenseId },
    });
    if (count === 0) throw ApiError.notFound('Ticket e-mail template not found.');
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
