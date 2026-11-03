/**
 * Custom panels (KN-05 · owner decision K29 · tm 379).
 *
 *   - `GET|POST /settings/custom-panels`, `PATCH|DELETE /settings/custom-panels/{id}`,
 *     `POST /settings/custom-panels/{id}/rotate-secret` — Settings ›
 *     Integrations › Custom panels. Read on the workspace-admin scope
 *     (`access_rules`) like the other "what does the console reach" lists;
 *     every write is `access_rules:rw` + owner/admin rank (KN-05: "Tanımlama:
 *     Kurucu, Yönetici") and leaves an audit entry.
 *   - `GET /chats/{chatId}/panels` — the panels a conversation shows, for the
 *     Details pane.
 *   - `POST /chats/{chatId}/panels/{panelId}/context-token` — the signed,
 *     five-minute token the console hands the panel's page once it says it is
 *     ready.
 *
 * The two conversation routes sit behind the conversation's own visibility
 * (`resolveVisibility`) — a conversation the caller may not see is absent,
 * whatever its panels — and then behind the panel's team rule
 * (`CustomPanelService.forChat`). Agents only: a bot has no console to embed
 * a page in, and a customer token never reaches either.
 *
 * Responses that carry a secret or a token are `Cache-Control: no-store`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CUSTOM_PANEL_GROUPS_MAX,
  CUSTOM_PANEL_NAME_MAX,
  CUSTOM_PANEL_TOKEN_DELIVERIES,
  CUSTOM_PANEL_URL_MAX,
  isShortId,
} from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import type { Principal } from '../services/auth/principal.js';
import { canSeeChat, resolveVisibility } from '../services/chat/access.js';
import { CustomPanelService } from '../services/custom-panels/custom-panel-service.js';
import { PanelSecretCodec, signPanelContextToken } from '../services/custom-panels/panel-token.js';
import { seesPlayerContact } from '../services/customers/player-contact.js';

const CHAT_READ = ['chats--all:ro', 'chats--access:ro'];
const SETTINGS_READ = ['access_rules:ro', 'access_rules:rw'];
const SETTINGS_WRITE = ['access_rules:rw'];

const name = z.string().trim().min(1).max(CUSTOM_PANEL_NAME_MAX);
// The shape is the service's (`customPanelUrlProblem`), which says *why* in
// `details.reason`; here only the bound, so no caller sends a megabyte.
const url = z.string().trim().min(1).max(CUSTOM_PANEL_URL_MAX);
const groupIds = z
  .array(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER))
  .max(CUSTOM_PANEL_GROUPS_MAX);

const createBody = z
  .object({
    name,
    url,
    visible_group_ids: groupIds.default([]),
    enabled: z.boolean().default(true),
  })
  .strict();

const patchBody = z
  .object({
    name: name.optional(),
    url: url.optional(),
    visible_group_ids: groupIds.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'name at least one field to change',
  });

const tokenBody = z
  .object({ delivery: z.enum(CUSTOM_PANEL_TOKEN_DELIVERIES).default('frame') })
  .strict();

const panelIdSchema = z.string().uuid();
const chatIdSchema = z.string().refine(isShortId, 'not a valid chat id');

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

/**
 * The conversation's teams and customer, when the caller may see it;
 * otherwise a 404 that says nothing more.
 */
async function visibleChat(
  tx: TenantClient,
  principal: Principal,
  chatId: string,
): Promise<{ groupIds: bigint[]; username: string | null; usernameVerified: boolean }> {
  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: {
      customerId: true,
      access: { select: { groupId: true } },
      users: { select: { userId: true, userType: true } },
      customer: { select: { username: true, usernameVerified: true } },
    },
  });
  if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');
  return {
    groupIds: chat.access.map((row) => row.groupId),
    username: chat.customer.username,
    usernameVerified: chat.customer.usernameVerified,
  };
}

export default async function customPanelRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const panels = new CustomPanelService(new PanelSecretCodec(options.env.CUSTOMER_TOKEN_SECRET));

  // =========================================================================
  // Settings › Integrations › Custom panels
  // =========================================================================

  app.get(
    '/settings/custom-panels',
    { config: { scopes: SETTINGS_READ, principals: ['agent'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const items = await request.withTenant((tx) => panels.list(tx, tenant));
      return reply.send({ items });
    },
  );

  app.post(
    '/settings/custom-panels',
    { config: { scopes: SETTINGS_WRITE, minimumRole: 'admin', principals: ['agent'] } },
    async (request, reply) => {
      const body = parse(createBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const created = await request.withTenant(async (tx) => {
        const result = await panels.create(
          tx,
          tenant,
          {
            name: body.name,
            url: body.url,
            visibleGroupIds: body.visible_group_ids,
            enabled: body.enabled,
          },
          principal.kind === 'agent' ? principal.accountId : null,
        );
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'custom_panel.created',
          target: `custom_panel:${result.panel.id}`,
          metadata: {
            origin: result.panel.origin,
            teams: result.panel.visible_group_ids.length,
            enabled: result.panel.enabled,
          },
        });
        return result;
      });
      return reply
        .status(201)
        .header('cache-control', 'no-store')
        .send({ ...created.panel, signing_secret: created.secret });
    },
  );

  app.patch<{ Params: { panelId: string } }>(
    '/settings/custom-panels/:panelId',
    { config: { scopes: SETTINGS_WRITE, minimumRole: 'admin', principals: ['agent'] } },
    async (request, reply) => {
      const id = parse(panelIdSchema, request.params.panelId);
      const body = parse(patchBody, request.body);
      const tenant = request.tenant();
      const updated = await request.withTenant(async (tx) => {
        const result = await panels.update(tx, tenant, id, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(body.visible_group_ids !== undefined
            ? { visibleGroupIds: body.visible_group_ids }
            : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        // Only a change that happened is an event worth an entry.
        if (result && result.changed.length > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'custom_panel.updated',
            target: `custom_panel:${id}`,
            metadata: { fields: result.changed, origin: result.panel.origin },
          });
        }
        return result;
      });
      // Absent here is indistinguishable from another tenant's (NFR-S5).
      if (!updated) throw ApiError.notFound('Custom panel not found.');
      return reply.send(updated.panel);
    },
  );

  app.delete<{ Params: { panelId: string } }>(
    '/settings/custom-panels/:panelId',
    { config: { scopes: SETTINGS_WRITE, minimumRole: 'admin', principals: ['agent'] } },
    async (request, reply) => {
      const id = parse(panelIdSchema, request.params.panelId);
      const tenant = request.tenant();
      const origin = await request.withTenant(async (tx) => {
        const removed = await panels.remove(tx, tenant, id);
        if (removed !== null) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'custom_panel.deleted',
            target: `custom_panel:${id}`,
            metadata: { origin: removed },
          });
        }
        return removed;
      });
      if (origin === null) throw ApiError.notFound('Custom panel not found.');
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { panelId: string } }>(
    '/settings/custom-panels/:panelId/rotate-secret',
    { config: { scopes: SETTINGS_WRITE, minimumRole: 'admin', principals: ['agent'] } },
    async (request, reply) => {
      const id = parse(panelIdSchema, request.params.panelId);
      const tenant = request.tenant();
      const rotated = await request.withTenant(async (tx) => {
        const result = await panels.rotateSecret(tx, tenant, id);
        if (result) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'custom_panel.secret_rotated',
            target: `custom_panel:${id}`,
            metadata: { origin: result.panel.origin },
          });
        }
        return result;
      });
      if (!rotated) throw ApiError.notFound('Custom panel not found.');
      return reply
        .header('cache-control', 'no-store')
        .send({ ...rotated.panel, signing_secret: rotated.secret });
    },
  );

  // =========================================================================
  // The conversation's panels
  // =========================================================================

  app.get<{ Params: { chatId: string } }>(
    '/chats/:chatId/panels',
    { config: { scopes: CHAT_READ, principals: ['agent'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const principal = request.requirePrincipal();
      const tenant = request.tenant();
      const items = await request.withTenant(async (tx) => {
        const chat = await visibleChat(tx, principal, chatId);
        return panels.forChat(tx, tenant, chat.groupIds);
      });
      return reply.send({ items });
    },
  );

  app.post<{ Params: { chatId: string; panelId: string } }>(
    '/chats/:chatId/panels/:panelId/context-token',
    { config: { scopes: CHAT_READ, principals: ['agent'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const panelId = parse(panelIdSchema, request.params.panelId);
      const body = parse(tokenBody, request.body ?? {});
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();
      const tenant = request.tenant();

      const found = await request.withTenant(async (tx) => {
        const chat = await visibleChat(tx, principal, chatId);
        const panel = await panels.signingPanel(tx, tenant, panelId, chat.groupIds);
        if (!panel) return null;
        // The newest connection of the day — the one the agent is answering.
        const thread = await tx.thread.findFirst({
          where: { chatId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        return { chat, panel, threadId: thread?.id ?? null };
      });
      if (!found) throw ApiError.notFound('Custom panel not found.');

      const { token, claims } = signPanelContextToken(found.panel.secret, {
        panelId: found.panel.id,
        delivery: body.delivery,
        organizationId: tenant.organizationId,
        licenseId: tenant.licenseId,
        chatId,
        threadId: found.threadId,
        agentId: principal.accountId,
        // RL-02 `customers.contact.view`: a role that may not see the username
        // does not hand it to a third-party page either.
        ...(seesPlayerContact(principal)
          ? {
              player: {
                username: found.chat.username,
                // Only an identity the operator's own server signed is verified
                // (ID-03 operator path, K28 · tm 388); a username typed into the
                // pre-chat form never is.
                usernameVerified: found.chat.usernameVerified,
              },
            }
          : {}),
      });
      return reply.header('cache-control', 'no-store').send({
        token,
        expires_at: new Date(claims.exp * 1000).toISOString(),
        delivery: claims.delivery,
      });
    },
  );
}
