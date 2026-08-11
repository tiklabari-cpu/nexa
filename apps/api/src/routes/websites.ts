/**
 * Website widgets — FR-MOD-08.5.2.
 *
 * "Add website", the install snippet, and the Connected status. Guarded by the
 * same scope as trusted domains (`access_rules`): both answer "how does the
 * widget reach my sites", and an admin who can manage one can manage the other.
 *
 * A duplicate domain is a conflict, not a server error: the `[license, domain]`
 * unique index raises Prisma P2002, which is caught and returned as an ADR-06
 * `website_exists` envelope rather than surfacing as a raw 500.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import type { Env } from '../config/env.js';
import { normaliseTrustedDomain } from '../lib/origin.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { WebsiteService, WEBSITE_SETUPS } from '../services/websites/website-service.js';

const addBody = z.object({
  domain: z.string().trim().min(1).max(253),
  setup: z.enum(WEBSITE_SETUPS as unknown as [string, ...string[]]).default('manual'),
});

const uuid = z.string().uuid();

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

/** Prisma's unique-violation code, raised by `[license_id, domain]` here. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export default async function websiteRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const websites = new WebsiteService(options.env.WIDGET_BASE_URL);

  app.get(
    '/websites',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const items = await request.withTenant((tx) => websites.list(tx, tenant));
      return reply.send({ items });
    },
  );

  app.post('/websites', { config: { scopes: ['access_rules:rw'] } }, async (request, reply) => {
    const body = parse(addBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    // Normalised with the same rule the token endpoint applies to an Origin
    // header, so the domain stored here is the exact string a widget handshake
    // will later match when flipping this site to Connected.
    const domain = normaliseTrustedDomain(body.domain);
    if (!domain) {
      throw ApiError.validation(
        'Enter a hostname such as shop.example, or a URL to take one from.',
      );
    }

    try {
      const created = await request.withTenant((tx) =>
        websites.create(tx, tenant, {
          domain,
          setup: body.setup as (typeof WEBSITE_SETUPS)[number],
          createdBy: principal.kind === 'agent' ? principal.accountId : null,
        }),
      );
      return reply.status(201).send(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError('website_exists', `${domain} is already added.`);
      }
      throw error;
    }
  });

  app.get<{ Params: { websiteId: string } }>(
    '/websites/:websiteId',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.websiteId);
      const tenant = request.tenant();

      const website = await request.withTenant((tx) => websites.get(tx, tenant, id));
      // Also the answer for a website in another tenant: RLS returns nothing and
      // 404 keeps ids un-enumerable (NFR-S5).
      if (!website) throw ApiError.notFound('Website not found.');

      return reply.send(website);
    },
  );

  app.delete<{ Params: { websiteId: string } }>(
    '/websites/:websiteId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.websiteId);

      const removed = await request.withTenant(async (tx) => {
        const count = await websites.remove(tx, id);
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `website:${id}`,
            metadata: { kind: 'website' },
          });
        }
        return count;
      });
      if (removed === 0) throw ApiError.notFound('Website not found.');

      return reply.status(204).send();
    },
  );
}
