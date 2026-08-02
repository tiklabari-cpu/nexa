/**
 * Custom fields for tickets and contacts (FR-MOD-08.7.6).
 *
 * Two halves. The definition CRUD is the admin surface: a workspace declares the
 * extra fields it wants — a player id, a KYC status — each with the `type` and
 * `required` flag the requirement turns on (KK "Tip/zorunluluk"). The value
 * half is what an agent touches: reading every field for a ticket or contact
 * (set or not), and writing values that are validated against their definition
 * before they are stored.
 *
 * The value validation is not made here — it lives in `@nexa/types`
 * (`checkCustomFieldValue`) so the authoring form and this endpoint agree on
 * what a valid value is — but it is *enforced* here, so a value of the wrong
 * type, or a blank on a required field, is refused rather than stored.
 */
import type { Prisma } from '@prisma/client';
import {
  CUSTOM_FIELD_TYPES,
  checkCustomFieldValue,
  isCustomFieldProblem,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
  type CustomFieldValue,
  type FormPlacement,
  type PreChatFormField,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { type AuditContext, writeAuditEntry } from '../audit/audit-log.js';

export interface DefinitionInput {
  entity: CustomFieldEntity;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  /** Ask this contact field on the widget's pre-chat form (FR-MOD-08.7.7). */
  formPlacement?: FormPlacement | null;
}

export interface DefinitionPatch {
  label?: string;
  required?: boolean;
  formPlacement?: FormPlacement | null;
}

interface DefinitionRow {
  id: string;
  entity: string;
  label: string;
  type: string;
  required: boolean;
  formPlacement: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The column a value hangs off, per entity — one place decides the mapping. */
function entityColumn(entity: CustomFieldEntity): 'ticketId' | 'customerId' {
  return entity === 'ticket' ? 'ticketId' : 'customerId';
}

/**
 * Every field defined for an entity, joined with what this ticket/contact has
 * stored — one entry per definition, `value` null when nothing is set. Standalone
 * (rather than a method) so the ticket and customer services can embed
 * `custom_fields` in their detail responses without depending on the whole
 * service, keeping the field present everywhere a detail is produced.
 */
export async function readCustomFieldValues(
  tx: TenantClient,
  licenseId: bigint,
  entity: CustomFieldEntity,
  entityId: string,
): Promise<CustomFieldValue[]> {
  const column = entityColumn(entity);
  const [definitions, values] = await Promise.all([
    tx.customFieldDefinition.findMany({
      where: { licenseId, entity },
      orderBy: [{ createdAt: 'asc' }],
    }),
    tx.customFieldValue.findMany({
      where: { licenseId, [column]: entityId },
      select: { definitionId: true, value: true },
    }),
  ]);

  const stored = new Map(values.map((row) => [row.definitionId, row.value]));
  return definitions.map((definition) => ({
    definition_id: definition.id,
    label: definition.label,
    type: definition.type as CustomFieldType,
    required: definition.required,
    value: stored.get(definition.id) ?? null,
  }));
}

export class CustomFieldService {
  // --- Definitions -----------------------------------------------------------

  /** Every definition in the tenant, optionally one entity's, oldest first. */
  async listDefinitions(
    tx: TenantClient,
    tenant: TenantContext,
    entity?: CustomFieldEntity,
  ): Promise<{ items: CustomFieldDefinition[]; total: number }> {
    const rows = await tx.customFieldDefinition.findMany({
      where: { licenseId: tenant.licenseId, ...(entity ? { entity } : {}) },
      orderBy: [{ createdAt: 'asc' }],
    });
    const items = rows.map(toDefinitionDto);
    return { items, total: items.length };
  }

  async createDefinition(
    tx: TenantClient,
    tenant: TenantContext,
    input: DefinitionInput,
  ): Promise<CustomFieldDefinition> {
    const label = input.label.trim();
    if (!label) throw ApiError.validation('label: a custom field needs a label.');
    if (!CUSTOM_FIELD_TYPES.includes(input.type)) {
      throw ApiError.validation(`type: must be one of ${CUSTOM_FIELD_TYPES.join(', ')}.`);
    }
    // A form placement only makes sense on a contact field: the pre-chat form
    // runs before any ticket exists, so a ticket field has nothing to write to.
    if (input.formPlacement && input.entity !== 'contact') {
      throw ApiError.validation('form_placement: only a contact field can be a pre-chat form field.');
    }

    try {
      const created = await tx.customFieldDefinition.create({
        data: {
          licenseId: tenant.licenseId,
          entity: input.entity,
          label,
          type: input.type,
          required: input.required ?? false,
          formPlacement: input.formPlacement ?? null,
        },
      });
      return toDefinitionDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.validation(`A ${input.entity} field named “${label}” already exists.`);
      }
      throw error;
    }
  }

  /**
   * Rename a field or flip its required flag. The `entity` and `type` are
   * deliberately immutable: changing a field's type would leave every stored
   * value validated against a rule that no longer holds, so a re-typed field is
   * a new field, not an edit.
   */
  async updateDefinition(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: DefinitionPatch,
  ): Promise<CustomFieldDefinition> {
    const existing = await tx.customFieldDefinition.findFirst({
      where: { id, licenseId: tenant.licenseId },
    });
    if (!existing) throw ApiError.notFound('Custom field not found.');

    const data: Prisma.CustomFieldDefinitionUpdateInput = {};
    if (patch.label !== undefined) {
      const label = patch.label.trim();
      if (!label) throw ApiError.validation('label: a custom field needs a label.');
      data.label = label;
    }
    if (patch.required !== undefined) data.required = patch.required;
    if (patch.formPlacement !== undefined) {
      if (patch.formPlacement && existing.entity !== 'contact') {
        throw ApiError.validation(
          'form_placement: only a contact field can be a pre-chat form field.',
        );
      }
      data.formPlacement = patch.formPlacement;
    }

    try {
      const updated = await tx.customFieldDefinition.update({ where: { id }, data });
      return toDefinitionDto(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.validation(`A ${existing.entity} field with that label already exists.`);
      }
      throw error;
    }
  }

  /** Delete a field. Its stored values cascade away with it (see the migration). */
  async removeDefinition(
    tx: TenantClient,
    tenant: TenantContext,
    audit: AuditContext,
    id: string,
  ): Promise<void> {
    const { count } = await tx.customFieldDefinition.deleteMany({
      where: { id, licenseId: tenant.licenseId },
    });
    if (count === 0) throw ApiError.notFound('Custom field not found.');
    // Only a delete that actually happened is worth an entry.
    await writeAuditEntry(tx, audit, {
      action: 'data.deleted',
      target: `custom_field:${id}`,
      metadata: { kind: 'custom_field' },
    });
  }

  /**
   * The workspace's pre-chat form (FR-MOD-08.7.7): the contact fields flagged
   * `pre_chat`, in creation order, shaped for the widget to render one input per
   * row. Read on every widget token mint, so it stays a single indexed query and
   * returns only what the widget needs — never the whole definition.
   */
  async listPreChatForm(tx: TenantClient, tenant: TenantContext): Promise<PreChatFormField[]> {
    const rows = await tx.customFieldDefinition.findMany({
      where: { licenseId: tenant.licenseId, entity: 'contact', formPlacement: 'pre_chat' },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, label: true, type: true, required: true },
    });
    return rows.map((row) => ({
      definition_id: row.id,
      label: row.label,
      type: row.type as CustomFieldType,
      required: row.required,
    }));
  }

  // --- Values ----------------------------------------------------------------

  /**
   * Every field defined for an entity, joined with what this ticket/contact has
   * stored. Delegates to the standalone reader the detail responses use, so the
   * value shape is identical whether it arrives on a detail or through this call.
   */
  valuesFor(
    tx: TenantClient,
    tenant: TenantContext,
    entity: CustomFieldEntity,
    entityId: string,
  ): Promise<CustomFieldValue[]> {
    return readCustomFieldValues(tx, tenant.licenseId, entity, entityId);
  }

  /**
   * Set (or clear) values for an entity. Each entry is validated against its
   * definition; an unknown field, a value of the wrong type, or a blank on a
   * required field is refused. A `null` (or blank) on an optional field clears
   * it. Only the definitions named in `values` are touched — the rest are left
   * as they were.
   */
  async setValues(
    tx: TenantClient,
    tenant: TenantContext,
    entity: CustomFieldEntity,
    entityId: string,
    values: Record<string, string | null>,
  ): Promise<void> {
    const column = entityColumn(entity);
    const definitions = await tx.customFieldDefinition.findMany({
      where: { licenseId: tenant.licenseId, entity },
    });
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));

    for (const [definitionId, raw] of Object.entries(values)) {
      const definition = byId.get(definitionId);
      if (!definition) {
        throw ApiError.validation(`Unknown custom field for this ${entity}.`);
      }

      const result = checkCustomFieldValue(
        { label: definition.label, type: definition.type as CustomFieldType, required: definition.required },
        raw,
      );
      if (isCustomFieldProblem(result)) throw ApiError.validation(result.problem.message);

      const existing = await tx.customFieldValue.findFirst({
        where: { definitionId, [column]: entityId },
        select: { id: true },
      });

      if (result.value === null) {
        // Clearing an optional field: drop the row so "unset" and "empty" are
        // one state, not two.
        if (existing) await tx.customFieldValue.delete({ where: { id: existing.id } });
        continue;
      }

      if (existing) {
        await tx.customFieldValue.update({ where: { id: existing.id }, data: { value: result.value } });
      } else {
        await tx.customFieldValue.create({
          data: {
            licenseId: tenant.licenseId,
            definitionId,
            [column]: entityId,
            value: result.value,
          },
        });
      }
    }
  }
}

function toDefinitionDto(row: DefinitionRow): CustomFieldDefinition {
  return {
    id: row.id,
    entity: row.entity as CustomFieldEntity,
    label: row.label,
    type: row.type as CustomFieldType,
    required: row.required,
    form_placement: (row.formPlacement as FormPlacement | null) ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
