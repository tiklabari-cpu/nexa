/**
 * Custom field definitions (FR-MOD-08.7.6).
 *
 * Managed under `/settings/custom-fields`, on the workspace-admin scopes
 * (`access_rules:ro`/`:rw`) rather than a ticket- or customer-specific one: a
 * definition spans both entities, and deciding a workspace's extra fields is an
 * admin act, not something a group-scoped agent does. The *values* live on the
 * ticket and customer resources themselves — this file only shapes the fields.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_OPTIONS_MAX,
  CUSTOM_FIELD_OPTION_LABEL_MAX,
  CUSTOM_FIELD_TYPES,
  FORM_PLACEMENTS,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';

/**
 * A choice field's options (WG-04). Shape only — the rules that need the type
 * (how many, distinct, only a topic routes) and the team lookup live in the
 * service, so the create and edit paths cannot judge them differently.
 */
const optionsSchema = z
  .array(
    z
      .object({
        value: z.string().max(CUSTOM_FIELD_OPTION_LABEL_MAX),
        label: z.string().max(CUSTOM_FIELD_OPTION_LABEL_MAX),
        target_group_id: z.number().int().positive().nullable().optional(),
      })
      .strict(),
  )
  .max(CUSTOM_FIELD_OPTIONS_MAX);

const listQuery = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES).optional(),
});

const createBody = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  label: z.string().trim().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean().optional(),
  /**
   * Ask this field on one of the widget's four forms (FR-MOD-08.7.7). The
   * placement decides which entity its answers land on, so the service refuses
   * one that disagrees with `entity` rather than correcting either half.
   */
  form_placement: z.enum(FORM_PLACEMENTS).nullable().optional(),
  /** Render this contact field as a Contacts table column (FR-MOD-03.2.3). */
  show_in_table: z.boolean().optional(),
  options: optionsSchema.nullable().optional(),
});

const updateBody = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    required: z.boolean().optional(),
    form_placement: z.enum(FORM_PLACEMENTS).nullable().optional(),
    show_in_table: z.boolean().optional(),
    options: optionsSchema.optional(),
    /** Move the field within its form (WG-04); past the end means last. */
    position: z.number().int().min(0).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const fieldIdSchema = z.string().uuid();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function customFieldRoutes(app: FastifyInstance): Promise<void> {
  const fields = new CustomFieldService();

  app.get(
    '/settings/custom-fields',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();
      const result = await request.withTenant((tx) =>
        fields.listDefinitions(tx, tenant, query.entity),
      );
      return reply.send(result);
    },
  );

  app.post(
    '/settings/custom-fields',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(createBody, request.body);
      const tenant = request.tenant();
      const definition = await request.withTenant((tx) =>
        fields.createDefinition(tx, tenant, {
          entity: body.entity,
          label: body.label,
          type: body.type,
          ...(body.required !== undefined ? { required: body.required } : {}),
          ...(body.form_placement !== undefined ? { formPlacement: body.form_placement } : {}),
          ...(body.show_in_table !== undefined ? { showInTable: body.show_in_table } : {}),
          ...(body.options !== undefined ? { options: body.options } : {}),
        }),
      );
      return reply.status(201).send(definition);
    },
  );

  app.patch<{ Params: { fieldId: string } }>(
    '/settings/custom-fields/:fieldId',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const id = parse(fieldIdSchema, request.params.fieldId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      const definition = await request.withTenant((tx) =>
        fields.updateDefinition(tx, tenant, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.required !== undefined ? { required: body.required } : {}),
          ...(body.form_placement !== undefined ? { formPlacement: body.form_placement } : {}),
          ...(body.show_in_table !== undefined ? { showInTable: body.show_in_table } : {}),
          ...(body.options !== undefined ? { options: body.options } : {}),
          ...(body.position !== undefined ? { position: body.position } : {}),
        }),
      );
      return reply.send(definition);
    },
  );

  app.delete<{ Params: { fieldId: string } }>(
    '/settings/custom-fields/:fieldId',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const id = parse(fieldIdSchema, request.params.fieldId);
      const tenant = request.tenant();
      await request.withTenant((tx) =>
        fields.removeDefinition(tx, tenant, request.auditContext(), id),
      );
      return reply.status(204).send();
    },
  );
}
