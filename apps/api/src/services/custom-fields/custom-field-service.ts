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
 * The value validation is not made here — it lives in `@siyahtus/types`
 * (`checkCustomFieldValue`) so the authoring form and this endpoint agree on
 * what a valid value is — but it is *enforced* here, so a value of the wrong
 * type, or a blank on a required field, is refused rather than stored.
 */
import type { Prisma } from '@prisma/client';
import {
  CUSTOM_FIELD_TYPES,
  checkCustomFieldValue,
  customFieldOptionsProblem,
  formPlacementEntity,
  isChoiceFieldType,
  isCustomFieldProblem,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldOption,
  type CustomFieldType,
  type CustomFieldValue,
  type FormPlacement,
  type WidgetFormField,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { type AuditContext, writeAuditEntry } from '../audit/audit-log.js';

export interface DefinitionInput {
  entity: CustomFieldEntity;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  /** Ask this contact field on one of the widget's forms (FR-MOD-08.7.7). */
  formPlacement?: FormPlacement | null;
  /** Render this contact field as a row-inline Contacts table column (FR-MOD-03.2.3). */
  showInTable?: boolean;
  /** The choices of a `select` / `multiselect` / `topic` field (WG-04). */
  options?: CustomFieldOption[] | null;
}

export interface DefinitionPatch {
  label?: string;
  required?: boolean;
  formPlacement?: FormPlacement | null;
  showInTable?: boolean;
  options?: CustomFieldOption[];
  /** The field's new place in its form, 0 first; past the end means last. */
  position?: number;
}

interface DefinitionRow {
  id: string;
  entity: string;
  label: string;
  type: string;
  required: boolean;
  formPlacement: string | null;
  showInTable: boolean;
  options: Prisma.JsonValue;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The order every list of fields is read in (WG-04): the admin's `position`,
 * and among equals the order they were written in — which is all there was
 * before positions existed.
 */
export const FIELD_ORDER = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.CustomFieldDefinitionOrderByWithRelationInput[];

/** A stored `options` column as the API shape (null for a non-choice field). */
export function definitionOptions(stored: Prisma.JsonValue): CustomFieldOption[] | null {
  if (!Array.isArray(stored)) return null;
  return stored.map((item) => {
    const option = item as { value: string; label: string; target_group_id?: number | null };
    return {
      value: option.value,
      label: option.label,
      ...(option.target_group_id != null ? { target_group_id: option.target_group_id } : {}),
    };
  });
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
      orderBy: FIELD_ORDER,
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
    form_placement: (definition.formPlacement as FormPlacement | null) ?? null,
    // Carried through from the definition, same as `form_placement` above —
    // lets a reader (the Contacts table) pick out its columns from a full
    // custom-field list without a second lookup.
    show_in_table: definition.showInTable,
    options: definitionOptions(definition.options),
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
      orderBy: FIELD_ORDER,
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
    // A placement decides which entity its answers land on (FR-MOD-08.7.7), so
    // the two have to agree: the three forms that ask a visitor about
    // *themselves* are contact fields, and the `ticket` form — which asks about
    // the request they are leaving — is a ticket field. Refused rather than
    // silently corrected, because either half could be the typo.
    if (input.formPlacement) {
      assertPlacementEntity(input.formPlacement, input.entity);
    }
    // Same restriction as `formPlacement`, for the same reason: the Contacts
    // table has one row per contact, so a ticket field has no row to render a
    // column value into.
    if (input.showInTable && input.entity !== 'contact') {
      throw ApiError.validation(
        'show_in_table: only a contact field can show in the Contacts table.',
      );
    }
    const options = await checkOptions(tx, tenant, input.type, input.options);
    if (input.type === 'topic') {
      assertTopicPlacement(input.formPlacement ?? null);
      const other = await tx.customFieldDefinition.findFirst({
        where: { licenseId: tenant.licenseId, type: 'topic' },
        select: { id: true },
      });
      if (other) throw ApiError.validation(TOPIC_TAKEN);
    }

    await lockFieldOrder(tx, tenant.licenseId);
    const formPlacement = input.formPlacement ?? null;
    try {
      const created = await tx.customFieldDefinition.create({
        data: {
          licenseId: tenant.licenseId,
          entity: input.entity,
          label,
          type: input.type,
          required: input.required ?? false,
          formPlacement,
          showInTable: input.showInTable ?? false,
          ...(options ? { options: options as unknown as Prisma.InputJsonValue } : {}),
          // A new question joins the end of its form.
          position: await groupSize(tx, tenant.licenseId, input.entity, formPlacement),
        },
      });
      return toDefinitionDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The label index, or — two admins adding a topic at once — the
        // one-topic index the pre-check above could not see yet.
        throw ApiError.validation(
          input.type === 'topic'
            ? TOPIC_TAKEN
            : `A ${input.entity} field named “${label}” already exists.`,
        );
      }
      throw error;
    }
  }

  /**
   * Rename a field, flip its required flag, move it between forms, replace its
   * options or move it within its form (WG-04). The `entity` and `type` are
   * deliberately immutable: changing a field's type would leave every stored
   * value validated against a rule that no longer holds, so a re-typed field is
   * a new field, not an edit.
   *
   * Options can be reworded or dropped; an answer stored under a dropped
   * option stays as stored (shown by its value) rather than being erased —
   * the visitor did give it.
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
    const type = existing.type as CustomFieldType;
    const entity = existing.entity as CustomFieldEntity;

    const data: Prisma.CustomFieldDefinitionUpdateInput = {};
    if (patch.options !== undefined) {
      if (!isChoiceFieldType(type)) {
        throw ApiError.validation(`options: a ${type} field has no options.`);
      }
      const options = await checkOptions(tx, tenant, type, patch.options);
      data.options = options as unknown as Prisma.InputJsonValue;
    }
    if (type === 'topic' && patch.formPlacement !== undefined) {
      assertTopicPlacement(patch.formPlacement);
    }
    if (patch.label !== undefined) {
      const label = patch.label.trim();
      if (!label) throw ApiError.validation('label: a custom field needs a label.');
      data.label = label;
    }
    if (patch.required !== undefined) data.required = patch.required;
    if (patch.formPlacement !== undefined) {
      // The same agreement `createDefinition` enforces, read against the row's
      // own entity — which is immutable, so a field cannot be moved between the
      // chat forms and the ticket form by an edit.
      if (patch.formPlacement) {
        assertPlacementEntity(patch.formPlacement, existing.entity as CustomFieldEntity);
      }
      data.formPlacement = patch.formPlacement;
    }
    if (patch.showInTable !== undefined) {
      if (patch.showInTable && existing.entity !== 'contact') {
        throw ApiError.validation(
          'show_in_table: only a contact field can show in the Contacts table.',
        );
      }
      data.showInTable = patch.showInTable;
    }

    const from = (existing.formPlacement as FormPlacement | null) ?? null;
    const to = patch.formPlacement !== undefined ? patch.formPlacement : from;
    const reorders = to !== from || patch.position !== undefined;
    if (reorders) await lockFieldOrder(tx, tenant.licenseId);

    try {
      const updated = await tx.customFieldDefinition.update({ where: { id }, data });
      if (!reorders) return toDefinitionDto(updated);
      // Moved to another form: the old one closes the gap, and the field
      // joins the new one at the end unless a position says where.
      if (to !== from) await placeInGroup(tx, tenant.licenseId, entity, from, null);
      await placeInGroup(tx, tenant.licenseId, entity, to, {
        id,
        index: patch.position ?? Number.MAX_SAFE_INTEGER,
      });
      const placed = await tx.customFieldDefinition.findUniqueOrThrow({ where: { id } });
      return toDefinitionDto(placed);
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
   * One of the workspace's widget forms (FR-MOD-08.7.7): the fields flagged
   * with this placement, in creation order, shaped for the widget to render one
   * input per row. Read on every widget token mint, so it stays a single
   * indexed query and returns only what the widget needs — never the whole
   * definition.
   *
   * The entity comes from the placement rather than being passed in: it is the
   * placement that decides where an answer lands, and a caller free to name a
   * different one could offer a ticket question on the pre-chat form.
   */
  async listFormFields(
    tx: TenantClient,
    tenant: TenantContext,
    placement: FormPlacement,
  ): Promise<WidgetFormField[]> {
    const rows = await tx.customFieldDefinition.findMany({
      where: {
        licenseId: tenant.licenseId,
        entity: formPlacementEntity(placement),
        formPlacement: placement,
      },
      orderBy: FIELD_ORDER,
      select: { id: true, label: true, type: true, required: true, options: true },
    });
    return rows.map((row) => {
      const options = definitionOptions(row.options);
      return {
        definition_id: row.id,
        label: row.label,
        type: row.type as CustomFieldType,
        required: row.required,
        // The choice and its label only: a topic's team stays on the server,
        // the visitor picks what they need, not which queue serves it.
        ...(options ? { options: options.map(({ value, label }) => ({ value, label })) } : {}),
      };
    });
  }

  /**
   * The team a topic answer routes a new conversation to (WG-04), or
   * `undefined` when there is none to follow: no topic question, not
   * answered, or an option without a team. The id is passed to routing as a
   * request, not checked here — a team deleted since the option was saved is
   * ignored there and the routing rules decide (`#selectGroup`), so a stale
   * option never refuses the visitor's chat.
   */
  async topicGroupFor(
    tx: TenantClient,
    tenant: TenantContext,
    answers: Record<string, string | null>,
  ): Promise<bigint | undefined> {
    const topic = await tx.customFieldDefinition.findFirst({
      where: { licenseId: tenant.licenseId, type: 'topic', formPlacement: 'pre_chat' },
      select: { id: true, options: true },
    });
    const answer = topic ? answers[topic.id]?.trim() : undefined;
    if (!topic || !answer) return undefined;
    const option = definitionOptions(topic.options)?.find((o) => o.value === answer);
    return option?.target_group_id != null ? BigInt(option.target_group_id) : undefined;
  }

  /** The fields asked before the conversation starts. */
  listPreChatForm(tx: TenantClient, tenant: TenantContext): Promise<WidgetFormField[]> {
    return this.listFormFields(tx, tenant, 'pre_chat');
  }

  /** The fields asked once it ends, alongside the CSAT prompt. */
  listPostChatForm(tx: TenantClient, tenant: TenantContext): Promise<WidgetFormField[]> {
    return this.listFormFields(tx, tenant, 'post_chat');
  }

  /** The questions about the request, asked when a visitor leaves a message. */
  listTicketForm(tx: TenantClient, tenant: TenantContext): Promise<WidgetFormField[]> {
    return this.listFormFields(tx, tenant, 'ticket');
  }

  /** The questions about the person, asked on that same screen. */
  listProspectForm(tx: TenantClient, tenant: TenantContext): Promise<WidgetFormField[]> {
    return this.listFormFields(tx, tenant, 'prospect');
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
   * Answers to one of the widget's forms (FR-MOD-08.7.7), written to whichever
   * entity that placement's answers belong to — the contact for the pre-chat,
   * post-chat and prospect forms, the ticket the visitor just opened for the
   * ticket form.
   *
   * The narrowing over `setValues` is the point: the party filling this in is a
   * visitor, not an agent, so it may only answer what it was actually *asked*.
   * A custom field the workspace keeps for internal use — a KYC status, an
   * account tier, a refund amount an agent fills in later — is a field like any
   * other and `setValues` would happily take it; here an id without this
   * placement reads as unknown and is refused. That refusal is also what keeps
   * the two forms asked in the same breath apart: a `prospect` id sent as a
   * ticket answer is as unknown here as an invented one, so a question about
   * the person can never be written onto the request or the other way round. A
   * required field left blank is refused by `setValues` below, the same rule the
   * pre-chat path applies.
   */
  async setFormValues(
    tx: TenantClient,
    tenant: TenantContext,
    placement: FormPlacement,
    entityId: string,
    values: Record<string, string | null>,
  ): Promise<void> {
    const entity = formPlacementEntity(placement);
    const asked = await tx.customFieldDefinition.findMany({
      where: { licenseId: tenant.licenseId, entity, formPlacement: placement },
      select: { id: true },
    });
    const askedIds = new Set(asked.map((row) => row.id));

    for (const definitionId of Object.keys(values)) {
      if (!askedIds.has(definitionId)) {
        // Same wording whether the id is another tenant's, a CRM-only field or
        // pure invention: the visitor learns nothing about what exists.
        throw ApiError.validation('Unknown field for this form.');
      }
    }

    await this.setValues(tx, tenant, entity, entityId, values);
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
        {
          label: definition.label,
          type: definition.type as CustomFieldType,
          required: definition.required,
          // A choice must be one of these (WG-04) — anything else is a 400.
          options: definitionOptions(definition.options),
        },
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
        await tx.customFieldValue.update({
          where: { id: existing.id },
          data: { value: result.value },
        });
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

/**
 * Refuse a definition whose placement and entity disagree (FR-MOD-08.7.7).
 *
 * The same rule the migration's CHECK holds, stated here so the caller gets a
 * sentence naming the entity the placement needs rather than a constraint
 * violation. One function for both create and update: a rule enforced in two
 * places is a rule that eventually holds in one.
 */
function assertPlacementEntity(placement: FormPlacement, entity: CustomFieldEntity): void {
  const required = formPlacementEntity(placement);
  if (entity !== required) {
    throw ApiError.validation(
      `form_placement: the ${placement} form asks a ${required} field, not a ${entity} one.`,
    );
  }
}

const TOPIC_TAKEN = 'type: a workspace has one topic question — edit the one it has.';

/**
 * A topic is a pre-chat question (WG-04): it is answered before the
 * conversation exists, which is the moment routing decides who takes it. The
 * migration's CHECK holds the same rule.
 */
function assertTopicPlacement(placement: FormPlacement | null): void {
  if (placement !== 'pre_chat') {
    throw ApiError.validation('form_placement: a topic is asked on the pre-chat form.');
  }
}

/**
 * A definition's options, trimmed and checked (`customFieldOptionsProblem`),
 * with every topic option's team confirmed to be one of this workspace's —
 * an id from another workspace, or invented, is a 400 rather than a routing
 * that silently never happens. Null for a type that takes none.
 */
async function checkOptions(
  tx: TenantClient,
  tenant: TenantContext,
  type: CustomFieldType,
  raw: readonly CustomFieldOption[] | null | undefined,
): Promise<CustomFieldOption[] | null> {
  const options = raw?.map((option) => ({
    value: option.value.trim(),
    label: option.label.trim(),
    ...(option.target_group_id != null ? { target_group_id: option.target_group_id } : {}),
  }));
  const problem = customFieldOptionsProblem(type, options);
  if (problem) throw ApiError.validation(problem);
  if (!options || !isChoiceFieldType(type)) return null;

  const teamIds = [
    ...new Set(options.flatMap((o) => (o.target_group_id ? [o.target_group_id] : []))),
  ];
  if (teamIds.length > 0) {
    const found = await tx.group.count({
      where: { licenseId: tenant.licenseId, id: { in: teamIds.map((teamId) => BigInt(teamId)) } },
    });
    if (found !== teamIds.length) throw ApiError.validation('options: unknown team.');
  }
  return options;
}

/**
 * One writer of a workspace's field order at a time, to its commit: two admins
 * dragging fields at once would otherwise both renumber from the same read.
 */
async function lockFieldOrder(tx: TenantClient, licenseId: bigint): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('siyahtus.custom-field-order'), hashtext(${String(licenseId)}))`;
}

/** How many fields one form (or the entity's CRM-only list) holds. */
function groupSize(
  tx: TenantClient,
  licenseId: bigint,
  entity: CustomFieldEntity,
  placement: FormPlacement | null,
): Promise<number> {
  return tx.customFieldDefinition.count({
    where: { licenseId, entity, formPlacement: placement },
  });
}

/**
 * Renumber one form 0…n-1 in its current order, with `move` (when given)
 * taken out and put back at `index` — clamped, so past the end means last.
 * Only rows whose number changes are written.
 */
async function placeInGroup(
  tx: TenantClient,
  licenseId: bigint,
  entity: CustomFieldEntity,
  placement: FormPlacement | null,
  move: { id: string; index: number } | null,
): Promise<void> {
  const rows = await tx.customFieldDefinition.findMany({
    where: { licenseId, entity, formPlacement: placement },
    orderBy: FIELD_ORDER,
    select: { id: true, position: true },
  });
  const order = rows.filter((row) => row.id !== move?.id);
  const moved = move ? rows.find((row) => row.id === move.id) : undefined;
  if (move && moved) order.splice(Math.min(Math.max(move.index, 0), order.length), 0, moved);
  for (const [position, row] of order.entries()) {
    if (row.position !== position) {
      await tx.customFieldDefinition.update({ where: { id: row.id }, data: { position } });
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
    show_in_table: row.showInTable,
    options: definitionOptions(row.options),
    position: row.position,
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
