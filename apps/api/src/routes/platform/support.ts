/**
 * `/platform/v1/support/*` — the support desk (tm 389.9 · FR-ADMIN-10 ·
 * design.md §C support) and "enter as the customer" (tm 389.15 · FR-ADMIN-21 ·
 * design.md §G).
 *
 *   GET  /support/lookup?q=                          workspaces.read       Thread ID / Chat ID / ticket / email → workspace
 *   GET  /support/impersonations                     workspaces.read       ?active, ?license_id, keyset
 *   POST /support/impersonations                     support.impersonate   {license_id, account_id, mode, reason}
 *   GET  /support/impersonations/{impersonationId}   workspaces.read
 *   POST /support/impersonations/{impersonationId}/end   support.impersonate   {reason}
 *
 * The lookup's gate is the workspace list's: the answer is a licence number
 * and an organization name, which every role that may list workspaces already
 * reads. A miss and a malformed `q` are the same 404, after the same probes
 * and no sooner than `LOOKUP_FLOOR_MS` (`services/platform/support-lookup.ts`).
 *
 * Starting a session is `support.impersonate` for `read_only`; `full` adds
 * `support.impersonate_full` (superadmin) and a code younger than five
 * minutes, checked here because the mode is in the body. The session and both
 * audit entries (the platform chain with the reason; the workspace's trail
 * without it) commit together; the Founders' notice goes after the commit and
 * never undoes the session. The handoff URL is in the answer only — the code
 * is stored as a digest, and nothing here logs either.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IMPERSONATION_CONSOLE_PATH, IMPERSONATION_MODES, platformRoleHas } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import type { PlatformEnv } from '../../config/platform-env.js';
import { ApiError } from '../../lib/api-error.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { deliver, logUnsentMail } from '../../services/mail/delivery.js';
import type { Mailer } from '../../services/mail/mailer.js';
import { isMailLocale } from '../../services/mail/templates/layout.js';
import { formatDateTime, impersonationNoticeMail } from '../../services/mail/templates/messages.js';
import {
  endImpersonation,
  ImpersonationCursorError,
  IMPERSONATION_LIST_MAX,
  listImpersonations,
  readImpersonation,
  startImpersonation,
} from '../../services/platform/impersonations.js';
import {
  LOOKUP_FLOOR_MS,
  LOOKUP_QUERY_MAX,
  supportLookup,
} from '../../services/platform/support-lookup.js';
import { parse } from './auth.js';

const LICENSE_ID_RE = /^[1-9]\d{0,18}$/;

const lookupQuery = z.object({ q: z.string().min(1).max(LOOKUP_QUERY_MAX) });

const startBody = z.object({
  license_id: z.string().regex(LICENSE_ID_RE),
  account_id: z.string().uuid(),
  mode: z.enum(IMPERSONATION_MODES).default('read_only'),
  reason: z.string(),
});

const listQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
  license_id: z.string().regex(LICENSE_ID_RE).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(IMPERSONATION_LIST_MAX).optional(),
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async function platformSupportRoutes(
  app: FastifyInstance,
  options: {
    env: Env;
    platform: PlatformEnv;
    mailer: Mailer;
    floorMs?: number;
  },
): Promise<void> {
  const { env, platform, mailer } = options;
  const floorMs = options.floorMs ?? LOOKUP_FLOOR_MS;
  const read = { platform: { permission: 'workspaces.read' as const } };

  app.get('/support/lookup', { config: read }, async (request, reply) => {
    const { q } = parse(lookupQuery, request.query);
    const started = performance.now();
    const matches = await supportLookup(app.platformDb, q);
    const left = floorMs - (performance.now() - started);
    if (left > 0) await sleep(left);
    reply.header('cache-control', 'no-store');
    if (matches.length === 0) throw ApiError.notFound('Nothing matches that identifier.');
    return { data: matches };
  });

  app.get('/support/impersonations', { config: read }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    try {
      const page = await listImpersonations(app.platformDb, {
        ...(query.active === 'true' ? { active: true } : {}),
        ...(query.license_id ? { licenseId: BigInt(query.license_id) } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
      return reply.header('cache-control', 'no-store').send(page);
    } catch (error) {
      if (error instanceof ImpersonationCursorError) {
        throw ApiError.validation('`cursor` is not a cursor of this list. Start again without it.');
      }
      throw error;
    }
  });

  app.get('/support/impersonations/:impersonationId', { config: read }, async (request, reply) => {
    const id = (request.params as { impersonationId: string }).impersonationId;
    const impersonation = await readImpersonation(app.platformDb, id);
    if (!impersonation) throw ApiError.notFound('Impersonation session not found.');
    return reply.header('cache-control', 'no-store').send({ impersonation });
  });

  app.post(
    '/support/impersonations',
    {
      config: {
        platform: {
          permission: 'support.impersonate',
          audit: { action: 'impersonation.started', target: 'impersonation' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(startBody, request.body);
      const session = request.requirePlatformSession();
      // `full` acts as the member: superadmin only, and a code shown in the
      // last five minutes — the same pair every destructive route asks for.
      if (body.mode === 'full') {
        if (!platformRoleHas(session.role, 'support.impersonate_full')) {
          throw ApiError.authorization('Your operator role does not allow a full session.', {
            permission: 'support.impersonate_full',
          });
        }
        if (!app.platformAuth.hasRecentTotp(session)) {
          throw new ApiError(
            'platform_recent_totp_required',
            'Confirm with a fresh code from your authenticator app, then try again.',
          );
        }
      }

      const licenseId = BigInt(body.license_id);
      const code = generateToken();
      const started = await app.platformDb.$transaction(
        async (tx) => {
          const opened = await startImpersonation(tx, {
            adminId: session.adminId,
            licenseId,
            accountId: body.account_id.toLowerCase(),
            mode: body.mode,
            ttlS: platform.impersonationTtlS,
            codeHash: hashToken(code),
          });
          await app.platformAuditLog.record(
            request.platformAuditEntry({
              targetId: opened.session.id,
              licenseId,
              payload: {
                mode: body.mode,
                account_id: opened.session.account_id,
                ends_at: opened.session.ends_at,
              },
            }),
            tx,
          );
          return opened;
        },
        { timeout: 30_000 },
      );

      // After the commit: the session stands whatever the mail does.
      const endsAt = new Date(started.session.ends_at);
      const minutes = Math.round(platform.impersonationTtlS / 60);
      const statuses = await Promise.all(
        started.owners.map(async (owner) => {
          const locale = isMailLocale(owner.locale) ? owner.locale : 'en';
          const outcome = await deliver(mailer, {
            to: owner.email,
            licenseId,
            kind: 'impersonation_notice',
            ...impersonationNoticeMail(
              { locale, appUrl: env.WEB_APP_URL },
              {
                workspaceName: started.organizationName,
                memberEmail: started.memberEmail,
                mode: body.mode,
                endsAt: formatDateTime(endsAt, locale, 'UTC'),
                minutes,
              },
            ),
          });
          logUnsentMail(request.log, 'impersonation_notice.mail', outcome);
          return outcome.status;
        }),
      );
      const mail =
        statuses.length === 0 ? 'none' : statuses.every((s) => s === 'sent') ? 'sent' : 'failed';

      return reply
        .code(201)
        .header('cache-control', 'no-store')
        .send({
          impersonation: started.session,
          handoff_url: `${env.WEB_APP_URL.replace(/\/+$/, '')}${IMPERSONATION_CONSOLE_PATH}#code=${encodeURIComponent(code)}`,
          handoff_expires_at: started.handoffExpiresAt.toISOString(),
          mail,
        });
    },
  );

  app.post(
    '/support/impersonations/:impersonationId/end',
    {
      config: {
        platform: {
          permission: 'support.impersonate',
          audit: {
            action: 'impersonation.ended',
            target: 'impersonation',
            targetParam: 'impersonationId',
          },
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const id = (request.params as { impersonationId: string }).impersonationId;
      const outcome = await app.platformDb.$transaction(
        async (tx) => {
          const ended = await endImpersonation(tx, id);
          if (!ended.unchanged) {
            await app.platformAuditLog.record(
              request.platformAuditEntry({
                targetId: ended.session.id,
                licenseId: BigInt(ended.session.license_id),
                payload: { mode: ended.session.mode, account_id: ended.session.account_id },
              }),
              tx,
            );
          }
          return ended;
        },
        { timeout: 30_000 },
      );
      request.platformAudit!.recorded = true;
      return reply
        .header('cache-control', 'no-store')
        .send({ unchanged: outcome.unchanged, impersonation: outcome.session });
    },
  );
}
