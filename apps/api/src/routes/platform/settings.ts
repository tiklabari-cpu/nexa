/**
 * `/platform/v1/settings/*` — the deployment's settings (tm 389.13 ·
 * FR-ADMIN-15/16 · design.md §C settings).
 *
 *   GET   /settings                   settings.read     the stored values (`null` = not set here)
 *   PATCH /settings                   settings.manage   signup_enabled, trial_days, announcement
 *   PUT   /settings/maintenance       settings.manage   recentTotp — on/off, mode, message
 *   GET   /settings/effective-config  settings.read     the tenant API's published configuration
 *
 * A write records `settings.updated` / `settings.maintenance_changed` in its
 * own transaction with the keys and their before/after (none of these values
 * is a secret), and announces `settings.changed` after the commit; asking for
 * what is already so records and announces nothing. No workspace is named, so
 * there is no tenant entry.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ANNOUNCEMENT_LEVELS, MAINTENANCE_MODES } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import {
  announceSettingsChanged,
  PlatformSettingsStore,
  type PlatformDeploymentSettings,
} from '../../services/platform/settings.js';
import { parse } from './auth.js';

const text = z.string().trim().min(1).max(500);
const noticeText = z.object({ en: text, tr: text }).strict();

const announcement = z
  .object({
    level: z.enum(ANNOUNCEMENT_LEVELS),
    en: text,
    tr: text,
    until: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .transform((value) => (value === null ? null : new Date(value).toISOString())),
  })
  .strict();

// `reason` is the audit plugin's (checked before the handler); `.strict()` so a
// misspelt key is a 400 rather than a silent no-op.
const patchBody = z
  .object({
    reason: z.string(),
    signup_enabled: z.boolean().nullable().optional(),
    trial_days: z.number().int().min(1).max(365).nullable().optional(),
    announcement: announcement.nullable().optional(),
  })
  .strict();

const maintenanceBody = z
  .object({
    reason: z.string(),
    enabled: z.boolean(),
    mode: z.enum(MAINTENANCE_MODES),
    message: noticeText.nullable().optional(),
  })
  .strict();

const SETTINGS_KEYS = ['signup_enabled', 'trial_days', 'announcement'] as const;

export default async function platformSettingsRoutes(
  app: FastifyInstance,
  options: { now?: () => number } = {},
): Promise<void> {
  const store = new PlatformSettingsStore(app.platformDb, app.redis, {
    ...(options.now ? { now: options.now } : {}),
  });
  const read = { platform: { permission: 'settings.read' as const } };

  /** After the commit; a lost announcement costs the tenant cache's 30 seconds. */
  async function announce(keys: readonly string[], log: FastifyInstance['log']): Promise<void> {
    try {
      await announceSettingsChanged(app.redis, keys);
    } catch (error) {
      log.warn({ err: error }, 'settings.changed not announced; tenants refresh within 30 s');
    }
  }

  app.get('/settings', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await store.read()),
  );

  app.patch(
    '/settings',
    {
      config: {
        platform: {
          permission: 'settings.manage',
          audit: { action: 'settings.updated', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(patchBody, request.body);
      const patch = Object.fromEntries(
        SETTINGS_KEYS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]),
      );
      if (Object.keys(patch).length === 0) {
        throw ApiError.validation(`body: name at least one of ${SETTINGS_KEYS.join(', ')}.`);
      }
      const session = request.requirePlatformSession();
      const outcome = await store.patch(patch, session.adminId, async (tx, result) => {
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: result.changed.join(','),
            payload: changes(result.before, result.settings, result.changed),
          }),
          tx,
        );
      });
      // Unchanged: nothing written, nothing to record.
      request.platformAudit!.recorded = true;
      if (outcome.changed.length > 0) await announce(outcome.changed, request.log);
      return reply.header('cache-control', 'no-store').send(outcome.settings);
    },
  );

  app.put(
    '/settings/maintenance',
    {
      config: {
        platform: {
          permission: 'settings.manage',
          recentTotp: true,
          audit: { action: 'settings.maintenance_changed', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(maintenanceBody, request.body);
      const session = request.requirePlatformSession();
      const next = { enabled: body.enabled, mode: body.mode, message: body.message ?? null };
      const outcome = await store.setMaintenance(next, session.adminId, async (tx, result) => {
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: 'maintenance',
            payload: changes(result.before, result.settings, ['maintenance']),
          }),
          tx,
        );
      });
      request.platformAudit!.recorded = true;
      if (outcome.changed) {
        try {
          await store.writeMaintenanceKey(outcome.settings.maintenance);
        } catch (error) {
          request.log.warn(
            { err: error },
            'maintenance key not written; the tenant leader re-writes it within 30 s',
          );
        }
        await announce(['maintenance'], request.log);
      }
      return reply.header('cache-control', 'no-store').send(outcome.settings);
    },
  );

  app.get('/settings/effective-config', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await store.effectiveConfig()),
  );
}

/** `{ key: { from, to } }` for the audit payload — deployment settings, never a secret. */
function changes(
  before: PlatformDeploymentSettings,
  after: PlatformDeploymentSettings,
  keys: readonly (keyof PlatformDeploymentSettings)[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, { from: before[key], to: after[key] }]));
}
