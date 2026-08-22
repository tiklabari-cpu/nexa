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
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { LifecycleService } from '../services/auth/lifecycle-service.js';
import { REGIONS, servesRegion, type AgentRole } from '@nexa/types';
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
  // Optional, and the only request that may carry it: the database refuses to
  // change a region afterwards (C4-a). Omitted means the region this deployment
  // serves — see the gate in the route below for why it cannot mean a fixed
  // `eu` any more (C4-h).
  region: z.enum(REGIONS).optional(),
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

    // --- Data residency (NFR-C4 · C4-h) --------------------------------------
    // The only anonymous route that creates a tenant, and therefore the one the
    // region gate in `plugins/auth.ts` structurally cannot cover: that gate
    // compares against the region carried by a *credential*, and here there is
    // neither a credential nor a workspace to have issued one.
    //
    // Left ungated it did not merely answer wrongly — it wrote. A European
    // deployment accepted `region: 'us'` and created the organization, the owner
    // account and the licence in the European database, and only then began
    // refusing (421) every identified request that workspace would ever make
    // (C4-b). The founder could not get in, the rows sat on the wrong side of
    // the border, and nothing in the product could move them: `region` is
    // immutable by trigger (C4-a). NFR-C4 was breached by the first write, not
    // by a later read.
    //
    // Refusal, not redirection, and not a narrowed selector. A second
    // deployment's address does not exist in this repository (ADR-12 · single
    // deployment, mocked) so `Location` would point nowhere, and offering only
    // this region's value would quietly retire the choice NFR-C4 is sold on.
    // In a real multi-region estate a redirect is built *on top of* this
    // refusal, never instead of it.
    //
    // Before `lifecycle.signup`, for the reason `POST /customer/token` checks
    // before it mints a visitor row: reporting a violation after committing it
    // is not reporting it.
    //
    // `X-Region` is deliberately NOT honoured here, unlike the authenticated
    // gate. There the header can only narrow, and the reason is that *neither*
    // side of the comparison is anything the caller wrote: the left is the
    // process's own configuration, the right is read from the database. It was
    // not always so — the header used to be the left-hand side, which made
    // naming the workspace's own region a way straight through, and the
    // right-hand side being safe was no help at all (tm 145). Here no row exists
    // yet, so a header would become the right-hand side and any caller could
    // reinstate this exact bug by asserting the region it wanted.
    const region = body.region ?? env.NEXA_REGION;
    if (!servesRegion(env.NEXA_REGION, region)) {
      // Regions only. Not the address, not the email, not the workspace name:
      // this line is written by the deployment that must not be holding these
      // people, so naming one of them here is the thing the refusal exists to
      // prevent (`security.region_rejected` withholds the same fields). There
      // is no audit entry for the same reason there is no workspace — the trail
      // is tenant-scoped and this request has no tenant to scope one to.
      request.log.warn(
        { requested_region: region, served_region: env.NEXA_REGION },
        'signup refused: workspace region is not served by this deployment',
      );

      // 421, matching the three doors C4-b already guards: nothing is wrong
      // with the request and no permission is missing — it arrived at the wrong
      // address. `details.region` keeps its contract-wide meaning ("the region
      // to retry against"), and `details.served_region` is added because at
      // signup it is the only fact the caller cannot already know: there is no
      // workspace whose home they could look up, and the form needs to be able
      // to say which choice would work here.
      throw new ApiError(
        'misdirected_request',
        'Workspaces in that region are created by the deployment that serves it.',
        { details: { region, served_region: env.NEXA_REGION } },
      );
    }

    const session = await lifecycle.signup({
      email: body.email,
      password: body.password,
      name: body.name,
      organizationName: body.organization_name,
      region,
    });

    // Best-effort, like the password-reset confirmation below: a completed
    // signup must not be undone because the trail could not be written. A
    // brand-new account has exactly one membership — its own workspace.
    const membership = session.memberships[0];
    if (membership) {
      try {
        const tenant = {
          licenseId: BigInt(membership.license_id),
          organizationId: membership.organization_id,
        };
        await withTenant(app.db, tenant, (tx) =>
          writeAuditEntry(
            tx,
            request.auditContext({
              licenseId: tenant.licenseId,
              actorId: session.account.id,
              actorType: 'agent',
            }),
            {
              action: 'workspace.created',
              target: `organization:${membership.organization_id}`,
              // `auth_signup` always lands a new workspace on the `growth`
              // plan (see the migration) — there is no other value yet to read
              // back. The region is the resolved one, which the gate above has
              // already proven is this deployment's.
              metadata: { region, plan: 'growth' },
            },
          ),
        );
      } catch (err) {
        request.log.warn({ err }, 'failed to record workspace creation in audit log');
      }
    }

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
    const accountId = await lifecycle.confirmPasswordReset(body.token, body.password);

    // A password is account-level, but the audit log is tenant-scoped — so the
    // change is recorded once in each workspace the account can reach. The actor
    // is the account itself (a self-service reset). Best-effort: a completed
    // reset must not be undone because the trail could not be written.
    try {
      const tenants = await lifecycle.membershipTenants(accountId);
      for (const tenant of tenants) {
        await withTenant(app.db, tenant, (tx) =>
          writeAuditEntry(
            tx,
            request.auditContext({
              licenseId: tenant.licenseId,
              actorId: accountId,
              actorType: 'agent',
            }),
            { action: 'auth.password_reset', metadata: { via: 'reset_link' } },
          ),
        );
      }
    } catch (err) {
      request.log.warn({ err }, 'failed to record password reset in audit log');
    }

    return reply.code(204).send();
  });

  app.get('/auth/invitations/preview', { config: { public: true } }, async (request, reply) => {
    const query = parse(z.object({ token: z.string().min(20).max(200) }), request.query);
    return reply.send(await lifecycle.previewInvitation(query.token));
  });

  app.post('/auth/invitations/accept', { config: { public: true } }, async (request, reply) => {
    const body = parse(acceptBody, request.body);
    const { session, licenseId } = await lifecycle.acceptInvitation({
      token: body.token,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.password !== undefined ? { password: body.password } : {}),
    });

    const membership = session.memberships.find((m) => m.license_id === licenseId.toString());
    // Best-effort, like signup and the password-reset confirmation below: a
    // completed join must not be undone because the trail could not be
    // written.
    if (membership) {
      try {
        const tenant = { licenseId, organizationId: membership.organization_id };
        await withTenant(app.db, tenant, async (tx) => {
          // The invitation record — already looked up under this tenant's RLS
          // — is where the role and the invitation id live; neither travels
          // back through `acceptInvitation`'s SECURITY DEFINER return.
          const invitation = await tx.invitation.findFirst({
            where: { email: session.account.email, acceptedAt: { not: null } },
            orderBy: { acceptedAt: 'desc' },
            select: { id: true, role: true },
          });
          if (!invitation) return;
          await writeAuditEntry(
            tx,
            request.auditContext({
              licenseId: tenant.licenseId,
              actorId: session.account.id,
              actorType: 'agent',
            }),
            {
              action: 'member.joined',
              target: `account:${session.account.id}`,
              metadata: { role: invitation.role, via: 'invitation', invitation_id: invitation.id },
            },
          );
        });
      } catch (err) {
        request.log.warn({ err }, 'failed to record member join in audit log');
      }
    }

    return reply.send(session);
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

    const created = await withTenant(app.db, tenant, async (tx) => {
      const records = await lifecycle.createInvitations(
        tx,
        tenant,
        { accountId: principal.accountId, role: principal.role as AgentRole },
        body.emails,
        body.role,
      );
      // One entry per invitation, in the same transaction the invitations are
      // written. The invitee's address is *not* recorded — the invitation row
      // (referenced by id) already holds it, and copying it into an append-only
      // log would spread that person's email further than they agreed to.
      for (const invite of records) {
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'member.invited',
          target: `invitation:${invite.id}`,
          metadata: { role: invite.role },
        });
      }
      return records;
    });

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

      const deleted = await withTenant(app.db, tenant, async (tx) => {
        const result = await tx.invitation.deleteMany({
          where: { id: invitationId, acceptedAt: null },
        });
        if (result.count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'member.invitation_revoked',
            target: `invitation:${invitationId}`,
          });
        }
        return result;
      });
      // RLS already scopes this to the licence; a miss is 404 rather than 403
      // so ids stay un-enumerable (NFR-S5).
      if (deleted.count === 0) throw ApiError.notFound('Invitation not found.');

      return reply.code(204).send();
    },
  );
}
