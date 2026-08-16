/**
 * Registered handsets — the delivery targets push notifications are addressed
 * to (FR-MOD-13.7 · 13.7-c).
 *
 * Three operations, and all three are about *this caller's own* devices. There
 * is deliberately no surface for managing somebody else's: an admin who could
 * register a device on a colleague's behalf could point that colleague's
 * conversations at a phone in their own pocket, and no screen in the product
 * asks for that. The account is taken from the principal and never from the
 * request, so the id in a body cannot move a registration between people.
 *
 * **The token never comes back out.** A push token is a delivery credential
 * held in plain text — see the `DeviceToken` model for why it cannot be hashed
 * — so the compensating control is that the only code that ever reads the
 * column is the sender (13.7-d). Reads here answer "which handsets are live?"
 * with an id, a platform and a last-seen stamp; `serialiseDevice` is the single
 * place that shape is built, so there is one function to check rather than
 * three responses to audit.
 *
 * Sending is 13.7-d; nothing in this file delivers anything. The notification
 * *preferences* that will gate that delivery are on the membership and are
 * managed from `/agents/me/notification-preferences` (`routes/agents.ts`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEVICE_PLATFORMS, DEVICE_TOKEN_MAX_LENGTH } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

/**
 * A registration. `token` is named exactly that because the server's pino
 * redaction list already censors `req.body.token` — renaming the field to
 * something more descriptive (`device_token`, `push_token`) would quietly take
 * it off that list and put a live delivery credential into every request log at
 * trace level.
 */
const registerBody = z.object({
  token: z.string().trim().min(1).max(DEVICE_TOKEN_MAX_LENGTH),
  platform: z.enum(DEVICE_PLATFORMS),
});

const deviceIdSchema = z.string().uuid();

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

interface DeviceRow {
  id: string;
  platform: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

/**
 * The only shape a device is ever returned in.
 *
 * Takes the row's fields one at a time rather than spreading it, so a column
 * added later — including one carrying something secret — cannot reach a client
 * by being picked up automatically.
 */
export function serialiseDevice(row: DeviceRow): {
  id: string;
  platform: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
} {
  return {
    id: row.id,
    platform: row.platform,
    created_at: row.createdAt.toISOString(),
    last_seen_at: row.lastSeenAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

/** Everything the responses need, and nothing else — `token` is not selected. */
const deviceSelect = {
  id: true,
  platform: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
} as const;

export default async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * This account's live handsets, for the settings screen that lists them
   * (13.7-j) and so a person can see what is allowed to buzz at them.
   *
   * Revoked rows are omitted. They are kept in the table as a record that the
   * target existed, but a screen listing them would invite "why is my old phone
   * still here?" about a device that receives nothing.
   */
  app.get(
    '/notifications/devices',
    // `agents--my:ro` only. Expansion means `agents--my:rw`, `agents--all:ro`
    // and `agents--all:rw` all satisfy it, so a wider token is not shut out —
    // it just does not have to be listed to be admitted.
    { config: { scopes: ['agents--my:ro'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const items = await request.withTenant((tx) =>
        tx.deviceToken.findMany({
          where: { accountId: principal.accountId, revokedAt: null },
          select: deviceSelect,
          orderBy: { lastSeenAt: 'desc' },
        }),
      );

      return reply.send({ items: items.map(serialiseDevice) });
    },
  );

  /**
   * Register this handset, or refresh a registration it already has.
   *
   * One call for both because the app cannot tell them apart: it re-registers
   * on every launch, and whether the server has seen this token before is the
   * server's business. Without the upsert, a phone opened daily would collect a
   * row per launch and be sent the same message once per row.
   *
   * The upsert is keyed on `(license, token)` — the unique index — and it moves
   * the row to the current caller. That is the case worth naming: a shared or
   * handed-down handset. When the colleague who had it before signs out, the
   * app revokes first and registers second (§C-A31), but a crash between the
   * two would leave the old row live; re-registering *takes it over* rather
   * than failing, so the device follows whoever last proved they hold it.
   * Reviving `revokedAt` in the same statement is the same decision: a person
   * who signs back in on a phone they revoked is asking for it back.
   */
  app.post(
    '/notifications/devices',
    { config: { scopes: ['agents--my:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const body = parse(registerBody, request.body);
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const tenant = request.tenant();
      const now = new Date();

      const { device, created } = await request.withTenant(async (tx) => {
        const existing = await tx.deviceToken.findUnique({
          where: { licenseId_token: { licenseId: tenant.licenseId, token: body.token } },
          select: { id: true },
        });

        const row = await tx.deviceToken.upsert({
          where: { licenseId_token: { licenseId: tenant.licenseId, token: body.token } },
          create: {
            licenseId: tenant.licenseId,
            accountId: principal.accountId,
            platform: body.platform,
            token: body.token,
            createdAt: now,
            lastSeenAt: now,
          },
          update: {
            accountId: principal.accountId,
            platform: body.platform,
            lastSeenAt: now,
            revokedAt: null,
          },
          select: deviceSelect,
        });

        // Only a *new* delivery target is worth an audit line. An app that
        // re-registers on every launch would otherwise write one entry per
        // launch per phone, and a trail that long is a trail nobody reads —
        // which is how the entries that matter get missed. Metadata carries the
        // platform and the row id; the token is neither passed nor derivable
        // from what is.
        if (!existing) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'device.registered',
            target: `device:${row.id}`,
            metadata: { platform: body.platform },
          });
        }

        return { device: row, created: existing === null };
      });

      // 200 for a refresh, 201 for a first registration. The app does not care,
      // but a status that always said "created" would be a lie the moment the
      // upsert did its job, and this is the surface a debugging session reaches
      // for to find out whether a re-register actually created a duplicate.
      return reply.status(created ? 201 : 200).send(serialiseDevice(device));
    },
  );

  /**
   * Stop delivering to this handset.
   *
   * Marked revoked rather than deleted, so the record that the target existed
   * survives — the same choice `api_tokens` makes, and the one that lets an
   * incident answer "what was this workspace pushing to, and when did it stop?".
   *
   * Idempotent by way of the 404: a device that is already revoked, was never
   * this caller's, or belongs to another workspace is all one answer, so the
   * route cannot be used to find out which. The app's sign-out path treats a
   * failure here as success anyway (§C-A31 rule 1) — it drops the local token
   * whatever the server said — so a second revoke landing on a 404 is the
   * expected shape of a retry, not an error anybody has to handle.
   */
  app.delete<{ Params: { deviceId: string } }>(
    '/notifications/devices/:deviceId',
    { config: { scopes: ['agents--my:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const deviceId = parse(deviceIdSchema, request.params.deviceId);
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      await request.withTenant(async (tx) => {
        // Read under RLS and under the caller's own account id. RLS keeps
        // another workspace's device invisible; the `accountId` filter keeps a
        // *colleague's* device invisible, which RLS alone would not — they share
        // a license.
        const existing = await tx.deviceToken.findFirst({
          where: { id: deviceId, accountId: principal.accountId, revokedAt: null },
          select: { id: true, platform: true },
        });
        if (!existing) throw ApiError.notFound('Device not found.');

        await tx.deviceToken.update({
          where: { id: deviceId },
          data: { revokedAt: new Date() },
        });

        await writeAuditEntry(tx, request.auditContext(), {
          action: 'device.revoked',
          target: `device:${deviceId}`,
          metadata: { platform: existing.platform },
        });
      });

      return reply.status(204).send();
    },
  );
}
