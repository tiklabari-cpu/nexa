/**
 * The permission matrix (RL-02 · tm 325.2): `GET` and `PUT
 * /settings/permissions`.
 *
 * A Yönetici reads it, only the Kurucu changes it (RL-02-S5, K7) — and a
 * change is a security event: it can give a role reach it never had, so it is
 * validated against the catalogue's locks and floors before anything is
 * stored, filed in the audit trail with what moved and why, and mailed to the
 * workspace's Yöneticiler. The rules themselves live in `@siyahtus/types`
 * (`capabilities.ts`); the store in `services/auth/permission-matrix.ts`.
 *
 * Route gates stay the last word: the matrix decides which scopes a role's
 * session holds, and a route's `minimumRole` / `exactRole` still refuses a
 * role below it whatever the matrix says.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_PERMISSION_CHANGES } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { highRiskReason } from '../lib/high-risk-reason.js';
import { withTenant } from '../lib/tenant.js';
import { isCapRefusal, mailFailureFields } from '../services/mail/delivery.js';
import { permissionsChangedMail } from '../services/mail/templates/messages.js';
import {
  applyPermissionChanges,
  permissionChangeRefusal,
  readPermissionMatrix,
  readPermissionNotice,
  serialisePermissionMatrix,
  type PermissionChangeRefusal,
} from '../services/auth/permission-matrix.js';

const updateBody = z.object({
  changes: z
    .array(
      z.object({
        role: z.string().max(32),
        capability: z.string().max(64),
        value: z.string().max(16),
      }),
    )
    .min(1)
    .max(MAX_PERMISSION_CHANGES),
  // Required, unlike the older high-risk writes (GV-06-S1): no integration
  // predates this endpoint, and every change of who may do what is filed with
  // why.
  reason: highRiskReason,
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

const REFUSAL_MESSAGES: Record<PermissionChangeRefusal['reason'], string> = {
  unknown_role: 'is not a column of the permission matrix',
  unknown_capability: 'is not a capability',
  invalid_value: 'is not a value this capability takes',
  locked: 'is locked',
  below_floor: "is below the capability's lowest role",
  duplicate_change: 'is named more than once',
};

export default async function permissionRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;

  app.get(
    '/settings/permissions',
    {
      config: {
        scopes: ['access_rules:ro', 'access_rules:rw'],
        minimumRole: 'admin',
        principals: ['agent'],
      },
    },
    async (request, reply) => {
      const tenant = request.tenant();
      // Read from the primary, not the cache or a replica: this is the screen
      // the Founder saves from, and it must show what is stored. Read-only, as
      // a read should be.
      const snapshot = await withTenant(
        app.db,
        tenant,
        (tx) => readPermissionMatrix(tx, tenant.licenseId),
        { readOnly: true },
      );
      return reply.send(serialisePermissionMatrix(snapshot));
    },
  );

  app.put(
    '/settings/permissions',
    // `exactRole`, so a rank added above owner does not widen it.
    { config: { scopes: ['access_rules:rw'], exactRole: 'owner', principals: ['agent'] } },
    async (request, reply) => {
      const body = parse(updateBody, request.body);
      const refusal = permissionChangeRefusal(body.changes);
      if (refusal) {
        throw ApiError.validation(
          `changes: ${refusal.role} · ${refusal.capability} ${REFUSAL_MESSAGES[refusal.reason]}.`,
          { reason: refusal.reason, role: refusal.role, capability: refusal.capability },
        );
      }
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();
      const tenant = request.tenant();

      const { applied, notice } = await request.withTenant(async (tx) => {
        const applied = await applyPermissionChanges(tx, {
          licenseId: tenant.licenseId,
          actorId: principal.accountId,
          changes: body.changes,
          reason: body.reason,
          audit: request.auditContext(),
        });
        const notice =
          applied.changes.length > 0
            ? await readPermissionNotice(tx, {
                licenseId: tenant.licenseId,
                organizationId: tenant.organizationId,
                actorId: principal.accountId,
              })
            : null;
        return { applied, notice };
      });

      // After the commit — announced before it, a process could re-read the
      // old rows and keep them for a minute.
      if (applied.versionBumped) {
        await app.permissionMatrix.announce(tenant.licenseId, applied.snapshot.version);
      }

      if (notice) {
        for (const recipient of notice.recipients) {
          app.backgroundMail.send(
            {
              to: recipient.email,
              licenseId: tenant.licenseId,
              kind: 'notification',
              ...permissionsChangedMail(
                { locale: recipient.locale, appUrl: env.WEB_APP_URL },
                {
                  workspaceName: notice.workspaceName,
                  actorName: notice.actorName,
                  changes: applied.changes,
                  reason: body.reason,
                  matrixUrl: `${env.WEB_APP_URL}/app/settings/permissions`,
                },
              ),
            },
            (outcome) => {
              if (outcome.status === 'sent' || isCapRefusal(outcome)) return;
              request.log.warn(
                {
                  event: 'permissions_changed.mail',
                  outcome: outcome.status,
                  mail: mailFailureFields(outcome.error),
                },
                'permission change notice not confirmed as sent',
              );
            },
          );
        }
      }

      return reply.send(serialisePermissionMatrix(applied.snapshot));
    },
  );
}
