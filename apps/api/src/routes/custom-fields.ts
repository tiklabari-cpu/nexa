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
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, FORM_PLACEMENTS } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';

const listQuery = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES).optional(),
});

const createBody = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  label: z.string().trim().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean().optional(),
  /** Ask this contact field on the widget's pre-chat form (FR-MOD-08.7.7). */
  form_placement: z.enum(FORM_PLACEMENTS).nullable().optional(),
});

const updateBody = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    required: z.boolean().optional(),
    form_placement: z.enum(FORM_PLACEMENTS).nullable().optional(),
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
    { config: { scopes: ['access_rules:rw'] } },
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
        }),
      );
      return reply.status(201).send(definition);
    },
  );

  app.patch<{ Params: { fieldId: string } }>(
    '/settings/custom-fields/:fieldId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const id = parse(fieldIdSchema, request.params.fieldId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      const definition = await request.withTenant((tx) =>
        fields.updateDefinition(tx, tenant, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.required !== undefined ? { required: body.required } : {}),
          ...(body.form_placement !== undefined ? { formPlacement: body.form_placement } : {}),
        }),
      );
      return reply.send(definition);
    },
  );

  app.delete<{ Params: { fieldId: string } }>(
    '/settings/custom-fields/:fieldId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const id = parse(fieldIdSchema, request.params.fieldId);
      const tenant = request.tenant();
      await request.withTenant((tx) => fields.removeDefinition(tx, tenant, id));
      return reply.status(204).send();
    },
  );
}
