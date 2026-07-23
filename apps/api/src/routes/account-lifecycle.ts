/**
 * Signup, password recovery and team invitations.
 * PRD FR-MOD-00.2, 00.3, 04.3.1, 04.4.
 *
 * The security-shaped part of this file is `POST /auth/password-reset`: it must
 * answer identically whether or not the address is real, in body, in status and
 * as closely as it can in time. Everything it does — generate a token, hash it,
 * call the database, hand the mailer a job — happens on both branches, so the
 * only difference is whether the mailer had a recipient.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { withTenant } from '../lib/tenant.js';
import { LifecycleService } from '../services/auth/lifecycle-service.js';
import type { AgentRole } from '@nexa/types';
import { roleAtLeast } from '../services/auth/principal.js';
import type { Mailer } from '../services/mail/mailer.js';

const NEUTRAL_RESET_MESSAGE = 'If an account exists for that address, we sent a link.';

const signupBody = z.object({
  email: z.string().trim().email().max(320),
  // Length is the only rule. Composition rules ("one symbol, one digit") push
  // people towards predictable substitutions and buy very little.
  password: z.string().min(12).max(200),
  name: z.string().trim().min(1).max(120),
  organization_name: z.string().trim().min(1).max(120),
});

const resetRequestBody = z.object({ email: z.string().trim().max(320) });
const resetConfirmBody = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(12).max(200),
});

const inviteBody = z.object({
  emails: z.array(z.string().trim().max(320)).min(1).max(50),
  role: z.enum(['admin', 'agent']).default('admin'),
});

const acceptBody = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(12).max(200).optional(),
});

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

export default async function accountLifecycleRoutes(
  app: FastifyInstance,
  options: { env: Env; mailer: Mailer },
): Promise<void> {
  const { env, mailer } = options;
  const lifecycle = new LifecycleService(app.db, env.WEB_APP_URL);

  app.post('/auth/signup', { config: { public: true } }, async (request, reply) => {
    const body = parse(signupBody, request.body);
    const session = await lifecycle.signup({
      email: body.email,
      password: body.password,
      name: body.name,
      organizationName: body.organization_name,
    });
    return reply.code(201).send(session);
  });

  app.post('/auth/password-reset', { config: { public: true } }, async (request, reply) => {
    const body = parse(resetRequestBody, request.body);

    const token = await lifecycle.requestPasswordReset(body.email);
    if (token) {
      await mailer.send({
        to: body.email,
        kind: 'password_reset',
        subject: 'Reset your Nexa password',
        body: `Open this link to choose a new password:\n\n${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(token)}\n\nIt expires in one hour and works once.`,
      });
    }

    // Same body, same status, either way (FR-MOD-00.3). The branch above is the
    // only difference and it is invisible from here.
    return reply.code(202).send({ message: NEUTRAL_RESET_MESSAGE });
  });

  app.post('/auth/password-reset/confirm', { config: { public: true } }, async (request, reply) => {
    const body = parse(resetConfirmBody, request.body);
    await lifecycle.confirmPasswordReset(body.token, body.password);
    return reply.code(204).send();
  });

  app.get('/auth/invitations/preview', { config: { public: true } }, async (request, reply) => {
    const query = parse(z.object({ token: z.string().min(20).max(200) }), request.query);
    return reply.send(await lifecycle.previewInvitation(query.token));
  });

  app.post('/auth/invitations/accept', { config: { public: true } }, async (request, reply) => {
    const body = parse(acceptBody, request.body);
    return reply.send(
      await lifecycle.acceptInvitation({
        token: body.token,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.password !== undefined ? { password: body.password } : {}),
      }),
    );
  });

  app.get('/invitations', { config: { scopes: ['accounts--all:rw'] } }, async (request, reply) => {
    const tenant = request.tenant();
    const items = await withTenant(app.db, tenant, (tx) =>
      tx.invitation.findMany({
        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        include: { invitedBy: { select: { name: true } } },
      }),
    );

    return reply.send({
      items: items.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        invited_by_name: invite.invitedBy.name,
        expires_at: invite.expiresAt.toISOString(),
        created_at: invite.createdAt.toISOString(),
        // No `accept_url`: only the hash is stored, so there is no link to
        // re-issue — and a list endpoint that handed out working links would
        // turn read access to the team page into workspace access.
      })),
    });
  });

  app.post('/invitations', { config: { scopes: ['accounts--all:rw'] } }, async (request, reply) => {
    const body = parse(inviteBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    if (principal.kind !== 'agent') {
      throw ApiError.authorization('Only a signed-in teammate can invite others.');
    }

    // Both gates, as everywhere else: the scope says the token may, the role
    // says the person may.
    if (!roleAtLeast(principal.role as AgentRole, 'admin')) {
      throw ApiError.authorization('Only an admin or owner can invite teammates.');
    }

    const invalid = body.emails.filter((email) => !z.string().email().safeParse(email).success);
    if (invalid.length > 0) {
      // Named individually so the modal can mark the offending row rather than
      // rejecting the whole list (FR-MOD-04.4).
      throw ApiError.validation('Some addresses are not valid email addresses.', {
        invalid_emails: invalid,
      });
    }

    const created = await withTenant(app.db, tenant, (tx) =>
      lifecycle.createInvitations(
        tx,
        tenant,
        { accountId: principal.accountId, role: principal.role as AgentRole },
        body.emails,
        body.role,
      ),
    );

    await Promise.all(
      created.map((invite) =>
        mailer.send({
          to: invite.email,
          kind: 'invitation',
          subject: 'You have been invited to a Nexa workspace',
          body: `Open this link to join:\n\n${invite.accept_url}\n\nIt expires in seven days and works once.`,
        }),
      ),
    );

    return reply.code(201).send({ items: created });
  });

  app.delete<{ Params: { invitationId: string } }>(
    '/invitations/:invitationId',
    { config: { scopes: ['accounts--all:rw'] } },
    async (request, reply) => {
      const invitationId = parse(z.string().uuid(), request.params.invitationId);
      const tenant = request.tenant();

      const deleted = await withTenant(app.db, tenant, (tx) =>
        tx.invitation.deleteMany({ where: { id: invitationId, acceptedAt: null } }),
      );
      // RLS already scopes this to the licence; a miss is 404 rather than 403
      // so ids stay un-enumerable (NFR-S5).
      if (deleted.count === 0) throw ApiError.notFound('Invitation not found.');

      return reply.code(204).send();
    },
  );
}
