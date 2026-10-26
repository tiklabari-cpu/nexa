/**
 * `/platform/v1/security/*` — the Security page (tm 389.16 · FR-ADMIN-22 ·
 * design.md §C security).
 *
 *   GET    /security/blocklist              security.read    ?kind, ?q, keyset
 *   POST   /security/blocklist              security.manage  {kind, value, reason}
 *   DELETE /security/blocklist/{entryId}    security.manage  {reason}
 *   GET    /security/failed-logins          security.read    ?hours (1–168, 24)
 *   GET    /security/signups-by-ip          security.read    ?days (1–90, 7) — `not_available`
 *   GET    /security/impersonations         security.read    the support list, behind this page's gate
 *   GET    /security/abuse-counters         security.read
 *
 * Reads change nothing and write no audit entry. The two blocklist mutations
 * are recorded once each (`security.blocklist_added` / `_removed`) with the
 * entry's kind and value in the payload — an address masked (`a***@x.com`),
 * since the chain is kept for good and an abuser's mailbox is personal data
 * all the same; a domain or an IP range is written out, which is what the
 * entry is. Superadmin writes; support and readonly read.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PLATFORM_BLOCKLIST_KINDS } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import {
  IMPERSONATION_LIST_MAX,
  ImpersonationCursorError,
  listImpersonations,
} from '../../services/platform/impersonations.js';
import {
  BLOCKLIST_LIST_MAX,
  BLOCKLIST_VALUE_MAX,
  BlocklistCursorError,
  FAILED_LOGINS_HOURS_MAX,
  PlatformSecurity,
  SIGNUPS_BY_IP_DAYS_MAX,
} from '../../services/platform/security.js';
import { parse } from './auth.js';

const LICENSE_ID_RE = /^[1-9]\d{0,18}$/;

const listQuery = z.object({
  kind: z.enum(PLATFORM_BLOCKLIST_KINDS).optional(),
  q: z.string().trim().min(1).max(BLOCKLIST_VALUE_MAX).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(BLOCKLIST_LIST_MAX).optional(),
});

const addBody = z.object({
  kind: z.enum(PLATFORM_BLOCKLIST_KINDS),
  value: z.string().min(1).max(BLOCKLIST_VALUE_MAX),
  reason: z.string(),
});

const hoursQuery = z.object({
  hours: z.coerce.number().int().min(1).max(FAILED_LOGINS_HOURS_MAX).default(24),
});

const daysQuery = z.object({
  days: z.coerce.number().int().min(1).max(SIGNUPS_BY_IP_DAYS_MAX).default(7),
});

const impersonationsQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
  license_id: z.string().regex(LICENSE_ID_RE).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(IMPERSONATION_LIST_MAX).optional(),
});

/** What the audit chain keeps of an entry's value: an address masked, the rest as typed. */
export function auditValueOf(kind: string, value: string): string {
  if (kind !== 'email') return value;
  const at = value.lastIndexOf('@');
  return at <= 0 ? '***' : `${value.slice(0, 1)}***${value.slice(at)}`;
}

export default async function platformSecurityRoutes(
  app: FastifyInstance,
  options: { env: Env; now?: () => number },
): Promise<void> {
  const security = new PlatformSecurity(app.platformDb, app.redis, {
    authFailureLimit: options.env.RATE_LIMIT_AUTH_FAILURES_PER_MIN,
    ...(options.now ? { now: options.now } : {}),
  });
  const read = { platform: { permission: 'security.read' as const } };

  app.get('/security/blocklist', { config: read }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    try {
      const page = await security.listBlocklist({
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
      return reply.header('cache-control', 'no-store').send(page);
    } catch (error) {
      if (error instanceof BlocklistCursorError) {
        throw ApiError.validation('`cursor` is not a cursor of this list. Start again without it.');
      }
      throw error;
    }
  });

  app.post(
    '/security/blocklist',
    {
      config: {
        platform: {
          permission: 'security.manage' as const,
          audit: { action: 'security.blocklist_added' as const, target: 'blocklist' as const },
        },
      },
    },
    async (request, reply) => {
      const body = parse(addBody, request.body);
      const entry = await security.addBlocklist({
        kind: body.kind,
        value: body.value,
        // The audit hook has validated and trimmed it already.
        reason: request.platformAudit!.reason!,
        adminId: request.requirePlatformSession().adminId,
      });
      request.platformAudit!.targetId = entry.id;
      request.platformAudit!.payload = {
        kind: entry.kind,
        value: auditValueOf(entry.kind, entry.value),
      };
      return reply.status(201).header('cache-control', 'no-store').send(entry);
    },
  );

  app.delete(
    '/security/blocklist/:entryId',
    {
      config: {
        platform: {
          permission: 'security.manage' as const,
          audit: {
            action: 'security.blocklist_removed' as const,
            target: 'blocklist' as const,
            targetParam: 'entryId',
          },
        },
      },
    },
    async (request, reply) => {
      const { entryId } = request.params as { entryId: string };
      const removed = await security.removeBlocklist(entryId);
      if (!removed) throw ApiError.notFound('Blocklist entry not found.');
      request.platformAudit!.targetId = removed.id;
      request.platformAudit!.payload = {
        kind: removed.kind,
        value: auditValueOf(removed.kind, removed.value),
      };
      return reply.status(204).send();
    },
  );

  app.get('/security/failed-logins', { config: read }, async (request, reply) => {
    const { hours } = parse(hoursQuery, request.query);
    return reply.header('cache-control', 'no-store').send(await security.failedLogins(hours));
  });

  app.get('/security/signups-by-ip', { config: read }, async (request, reply) => {
    const { days } = parse(daysQuery, request.query);
    return reply.header('cache-control', 'no-store').send(security.signupsByIp(days));
  });

  app.get('/security/impersonations', { config: read }, async (request, reply) => {
    const query = parse(impersonationsQuery, request.query);
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

  app.get('/security/abuse-counters', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await security.abuseCounters()),
  );
}
