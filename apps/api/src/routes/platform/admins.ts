/**
 * `/platform/v1/admins/*` — operator management (tm 389.4 · FR-ADMIN-03/04 ·
 * design.md §C admins).
 *
 *   GET  /admins                              admins.read
 *   GET  /admins/invites                      admins.read     pending invitations
 *   POST /admins/invites                      admins.manage   recentTotp — mailed, 72 h
 *   POST /admins/invites/{inviteId}/revoke    admins.manage
 *   GET  /admins/{adminId}                    admins.read
 *   POST /admins/{adminId}/role               admins.manage   recentTotp
 *   POST /admins/{adminId}/disable            admins.manage   recentTotp
 *   POST /admins/{adminId}/enable             admins.manage   recentTotp
 *   POST /admins/{adminId}/reset-two-factor   admins.manage   recentTotp
 *   POST /admins/{adminId}/revoke-sessions    admins.manage
 *
 * Operators are disabled, never deleted. The last active superadmin cannot be
 * disabled or moved to another role (409 `platform_last_superadmin`). Every
 * mutation takes a `reason` (3–500 characters) — the platform audit chain
 * (389.5) records it; this task validates it and writes nothing yet.
 *
 * The list is not paged: operators are a handful of people, and a page
 * boundary in a list of eight is only a way to miss one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PLATFORM_ROLES } from '@siyahtus/types';
import type { PlatformEnv } from '../../config/platform-env.js';
import { ApiError } from '../../lib/api-error.js';
import { requestLocale } from '../../lib/request-locale.js';
import { UUID_RE } from '../../lib/tenant.js';
import { deliver, logUnsentMail } from '../../services/mail/delivery.js';
import type { Mailer } from '../../services/mail/mailer.js';
import { platformInvitationMail } from '../../services/mail/templates/messages.js';
import { PLATFORM_INVITE_TTL_HOURS } from '../../services/platform/admin-auth.js';
import { parse } from './auth.js';

const reasonSchema = z.string().trim().min(3).max(500);
const reasonBody = z.object({ reason: reasonSchema });
const roleBody = z.object({ role: z.enum(PLATFORM_ROLES), reason: reasonSchema });
const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(PLATFORM_ROLES),
  reason: reasonSchema,
});

function idParam(params: unknown, name: 'adminId' | 'inviteId'): string {
  const value = (params as Record<string, unknown>)[name];
  // An id that cannot exist is the same answer as one that does not.
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw ApiError.notFound(
      name === 'adminId' ? 'Operator not found.' : 'No pending invitation with that id.',
    );
  }
  return value;
}

export default async function platformAdminsRoutes(
  app: FastifyInstance,
  options: { platform: PlatformEnv; mailer: Mailer },
): Promise<void> {
  const admins = app.platformAdmins;
  const read = { platform: { permission: 'admins.read' as const } };
  const manage = { platform: { permission: 'admins.manage' as const } };
  const manageFresh = { platform: { permission: 'admins.manage' as const, recentTotp: true } };

  app.get('/admins', { config: read }, async () => ({ data: await admins.list() }));

  app.get('/admins/invites', { config: read }, async () => ({ data: await admins.listInvites() }));

  app.post('/admins/invites', { config: manageFresh }, async (request, reply) => {
    const body = parse(inviteBody, request.body);
    const session = request.requirePlatformSession();
    const created = await admins.invite({
      email: body.email,
      role: body.role,
      invitedBy: session.adminId,
    });

    // The token travels in the fragment: it never reaches a server log, the
    // admin SPA reads it from `location.hash` and posts it to /auth/invite/accept.
    const acceptUrl = `${options.platform.adminOrigin}/invite#token=${created.token}`;
    const outcome = await deliver(options.mailer, {
      to: created.invite.email,
      licenseId: null,
      kind: 'platform_invitation',
      ...platformInvitationMail(
        { locale: requestLocale(request), appUrl: options.platform.adminOrigin },
        {
          url: acceptUrl,
          role: created.invite.role,
          inviterEmail: session.email,
          hours: PLATFORM_INVITE_TTL_HOURS,
        },
      ),
    });
    logUnsentMail(request.log, 'platform_invitation.mail', outcome);

    return reply.status(201).send({
      invite: created.invite,
      mail: outcome.status === 'sent' ? 'sent' : 'failed',
      // Only when the mail did not go: the inviting superadmin hands the link
      // over another way. Never otherwise — a response is not where a
      // credential for somebody else should travel by default.
      ...(outcome.status === 'sent' ? {} : { accept_url: acceptUrl }),
    });
  });

  app.post('/admins/invites/:inviteId/revoke', { config: manage }, async (request, reply) => {
    parse(reasonBody, request.body);
    await admins.revokeInvite(idParam(request.params, 'inviteId'));
    return reply.status(204).send();
  });

  app.get('/admins/:adminId', { config: read }, async (request) =>
    admins.get(idParam(request.params, 'adminId')),
  );

  app.post('/admins/:adminId/role', { config: manageFresh }, async (request) => {
    const body = parse(roleBody, request.body);
    return admins.setRole(idParam(request.params, 'adminId'), body.role);
  });

  app.post('/admins/:adminId/disable', { config: manageFresh }, async (request) => {
    parse(reasonBody, request.body);
    return admins.disable(idParam(request.params, 'adminId'));
  });

  app.post('/admins/:adminId/enable', { config: manageFresh }, async (request) => {
    parse(reasonBody, request.body);
    return admins.enable(idParam(request.params, 'adminId'));
  });

  app.post('/admins/:adminId/reset-two-factor', { config: manageFresh }, async (request) => {
    parse(reasonBody, request.body);
    return admins.resetTwoFactor(idParam(request.params, 'adminId'));
  });

  app.post('/admins/:adminId/revoke-sessions', { config: manage }, async (request) => {
    parse(reasonBody, request.body);
    return { ended: await admins.revokeSessions(idParam(request.params, 'adminId')) };
  });
}
