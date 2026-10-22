/**
 * Member recognition — the licence's controls over how a returning visitor is
 * recognised (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.2 ·
 * docs/adr/member-recognition.md).
 *
 * The recognising itself happens in `POST /customer/token` (`routes/auth.ts`);
 * these are the doors that steer it:
 *
 *   - Settings › Security › Member recognition — the token lifetime and the
 *     possible-match switch, the signing key's rotation, and forgetting every
 *     returning visitor at once. `access_rules` plus `minimumRole: admin`, the
 *     gate of every other Security setting.
 *   - Forgetting one member's browsers, from the customer's side. `customers:rw`
 *     — admins and above today; the Agent role reaches it when the RL-02
 *     permission matrix grants it.
 *   - The other records a customer may be (tm 287.4): the unverified possible
 *     matches every agent sees (`customers:ro`), and the links a team lead or
 *     above confirms and undoes (`customers:rw` plus `minimumRole: admin` until
 *     RL-03 bounds the team lead to their teams — ID-03-S4). A link joins the agent's history
 *     view only; see `services/customers/customer-identity.ts`.
 *
 * Licence-scoped, not brand-scoped: the member token and the key that signs it
 * are the licence's, and a member is the same person on every brand's site.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MEMBER_KEY_ROTATION_GRACE, MEMBER_TOKEN_TTL } from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { selfAccountId } from '../services/auth/principal.js';
import { CustomerIdentityService } from '../services/customers/customer-identity.js';

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

/** Only the fields sent change; at least one has to be. */
const settingsBody = z
  .object({
    token_ttl_seconds: z
      .number()
      .int()
      .min(MEMBER_TOKEN_TTL.minSeconds)
      .max(MEMBER_TOKEN_TTL.maxSeconds)
      .optional(),
    possible_matches_enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const rotateBody = z.object({
  grace_period_seconds: z
    .number()
    .int()
    .min(MEMBER_KEY_ROTATION_GRACE.minSeconds)
    .max(MEMBER_KEY_ROTATION_GRACE.maxSeconds)
    .default(MEMBER_KEY_ROTATION_GRACE.defaultSeconds),
});

// Lower-cased once here: a uuid is the same uuid in either case, and the link
// table's ordered pair (and "is this the same record") compare it as a value.
const customerIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

const linkBody = z.object({ customer_id: customerIdSchema });

export default async function memberRecognitionRoutes(app: FastifyInstance): Promise<void> {
  const members = app.memberRecognition;
  const identities = new CustomerIdentityService();

  app.get(
    '/settings/member-recognition',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const { licenseId } = request.tenant();
      return reply.send(await request.withTenant((tx) => members.view(tx, licenseId)));
    },
  );

  app.patch(
    '/settings/member-recognition',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(settingsBody, request.body);
      const { licenseId } = request.tenant();
      const data = {
        ...(body.token_ttl_seconds !== undefined
          ? { tokenTtlSeconds: body.token_ttl_seconds }
          : {}),
        ...(body.possible_matches_enabled !== undefined
          ? { possibleMatchesEnabled: body.possible_matches_enabled }
          : {}),
      };

      const view = await request.withTenant(async (tx) => {
        const before = await members.view(tx, licenseId);
        // Upsert: no row exists until the first save, and reading never
        // creates one (`inbox_settings` pattern).
        await tx.memberRecognitionSettings.upsert({
          where: { licenseId },
          create: { licenseId, ...data },
          update: data,
        });
        const after = await members.view(tx, licenseId);

        // The values as well as the names, like the retention entry: "how long
        // did this workspace remember its visitors, and since when" is the
        // question the trail is asked. Flat keys without the word "token" —
        // `sanitizeAuditMetadata` drops a key that looks like a credential.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.security_updated',
          target: `member_recognition:${licenseId}`,
          metadata: {
            resource: 'member_recognition',
            operation: 'updated',
            fields: Object.keys(body),
            ...(body.token_ttl_seconds !== undefined
              ? {
                  ttl_seconds_before: before.token_ttl_seconds,
                  ttl_seconds_after: after.token_ttl_seconds,
                }
              : {}),
            ...(body.possible_matches_enabled !== undefined
              ? {
                  possible_matches_before: before.possible_matches_enabled,
                  possible_matches_after: after.possible_matches_enabled,
                }
              : {}),
          },
        });
        return after;
      });

      return reply.send(view);
    },
  );

  app.post(
    '/settings/member-recognition/rotate-key',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      // The body is optional: no body is the routine rotation, 7 days' grace.
      const body = parse(rotateBody, request.body ?? {});
      const { licenseId } = request.tenant();

      const view = await request.withTenant(async (tx) => {
        const rotated = await members.rotate(tx, licenseId, body.grace_period_seconds);
        // Versions and the window — never the key, which no response or
        // entry carries.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'member_token_key.rotated',
          target: `member_recognition:${licenseId}`,
          metadata: {
            version: rotated.version,
            previous_version: rotated.previousVersion,
            grace_period_seconds: body.grace_period_seconds,
          },
        });
        return members.view(tx, licenseId);
      });

      return reply.send(view);
    },
  );

  app.post(
    '/settings/member-recognition/revoke-all',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const { licenseId } = request.tenant();
      const revokedBy = selfAccountId(request.requirePrincipal());

      const view = await request.withTenant(async (tx) => {
        const revocation = await members.revokeAll(tx, { licenseId, revokedBy });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'member_tokens.revoked',
          target: `member_recognition:${licenseId}`,
          metadata: { scope: 'all', revoked_at: revocation.revoked_at },
        });
        return members.view(tx, licenseId);
      });

      return reply.send(view);
    },
  );

  app.post<{ Params: { customerId: string } }>(
    '/customers/:customerId/revoke-member-tokens',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const { licenseId } = request.tenant();
      const revokedBy = selfAccountId(request.requirePrincipal());

      const revocation = await request.withTenant(async (tx) => {
        const revoked = await members.revokeCustomer(tx, { licenseId, customerId, revokedBy });
        // Also the answer for another organization's customer: RLS hides the
        // row, and 404 keeps ids un-enumerable (NFR-S5).
        if (!revoked) throw ApiError.notFound('Customer not found.');
        // No name, e-mail or reason — the customer id is the target.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'member_tokens.revoked',
          target: `customer:${customerId}`,
          metadata: { scope: 'customer', revoked_at: revoked.revoked_at },
        });
        return revoked;
      });

      return reply.send(revocation);
    },
  );

  // --- Possible matches and links (tm 287.4) --------------------------------

  app.get<{ Params: { customerId: string } }>(
    '/customers/:customerId/possible-matches',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const { licenseId } = request.tenant();

      const matches = await request.withTenant((tx) =>
        identities.possibleMatches(tx, { licenseId, customerId }),
      );
      // Another organization's customer reads as absent (NFR-S5).
      if (!matches) throw ApiError.notFound('Customer not found.');
      return reply.send(matches);
    },
  );

  app.get<{ Params: { customerId: string } }>(
    '/customers/:customerId/links',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);

      const items = await request.withTenant((tx) => identities.links(tx, customerId));
      if (!items) throw ApiError.notFound('Customer not found.');
      return reply.send({ items });
    },
  );

  app.post<{ Params: { customerId: string } }>(
    '/customers/:customerId/links',
    { config: { scopes: ['customers:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const { customer_id: otherId } = parse(linkBody, request.body);
      if (otherId === customerId) {
        throw ApiError.validation('customer_id: a record cannot be linked to itself.');
      }
      const { organizationId } = request.tenant();
      // `minimumRole` has already required an agent principal, so there is an
      // account to name; the column has no FK, the audit trail is the record.
      const linkedBy = selfAccountId(request.requirePrincipal())!;

      const outcome = await request.withTenant(async (tx) => {
        const result = await identities.link(tx, { organizationId, customerId, otherId, linkedBy });
        // Either record being another organization's is the same 404, so the
        // answer never says which of the two ids exists (NFR-S5).
        if (result.kind === 'not_found') throw ApiError.notFound('Customer not found.');
        // A new decision only: confirming a link that already holds changes
        // nothing and writes nothing. Ids only — no name, e-mail or username,
        // which are what the visitor typed and what the agent judged by.
        if (result.kind === 'linked') {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'customer.identity_linked',
            target: `customer:${customerId}`,
            metadata: { linked_customer_id: otherId },
          });
        }
        return result;
      });

      return reply.code(outcome.kind === 'linked' ? 201 : 200).send(outcome.link);
    },
  );

  app.delete<{ Params: { customerId: string; linkedCustomerId: string } }>(
    '/customers/:customerId/links/:linkedCustomerId',
    { config: { scopes: ['customers:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const otherId = parse(customerIdSchema, request.params.linkedCustomerId);
      const unlinkedBy = selfAccountId(request.requirePrincipal())!;

      await request.withTenant(async (tx) => {
        const undone = await identities.unlink(tx, { customerId, otherId, unlinkedBy });
        if (!undone) throw ApiError.notFound('These records are not linked.');
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'customer.identity_unlinked',
          target: `customer:${customerId}`,
          metadata: { linked_customer_id: otherId },
        });
      });

      return reply.code(204).send();
    },
  );
}
