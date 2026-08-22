/**
 * Brands — the Multibrand surface (PRD §5.3 · NFR-S4/S5).
 *
 * One license may run several brands under a single subscription. The resources
 * a brand *contains* (channels, websites, widget/security/inbox settings) are
 * brand-scoped through `X-Nexa-Brand`; the brand catalogue itself is not — it is
 * the list you choose a brand *from*. So every handler here runs license-wide,
 * dropping any `X-Nexa-Brand` the caller sent, and reads/writes only the `brands`
 * table (license-scoped RLS, added in 78.1). That also makes the dependency check
 * on delete see the *whole* license rather than one brand's slice.
 *
 * Shaped after `websites.ts`: the same zod-parse helper, the same P2002→409
 * mapping, and the same rule that a foreign or unknown id is a 404 (`brand_not_found`)
 * so ids stay un-enumerable across licenses (NFR-S5). Two brand-specific rules:
 * the license default cannot be deleted, and neither can a brand that still owns
 * data — a delete is refused (`not_allowed`) rather than cascading a channel or
 * website away.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { withTenant, type TenantClient, type TenantContext } from '../lib/tenant.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const name = z.string().trim().min(1).max(120);
const slug = z.string().trim().min(1).max(120).regex(SLUG_RE, 'slug must be lowercase, hyphenated');
const logoUrl = z.string().trim().max(2048).nullable();

const createBody = z.object({
  name,
  slug: slug.optional(),
  logo_url: logoUrl.optional(),
});

const patchBody = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    logo_url: logoUrl.optional(),
  })
  .refine((b) => b.name !== undefined || b.slug !== undefined || b.logo_url !== undefined, {
    message: 'Provide at least one of name, slug or logo_url.',
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

/** Prisma's unique-violation code, raised by `[license_id, slug]` here. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Derive a URL-safe slug from a name: lowercased, every run of non-alphanumerics
 * (spaces, punctuation, accented letters) collapsed to a single hyphen, ends
 * trimmed. May come back empty (a name with no ASCII letters or digits), in which
 * case the caller must supply a slug explicitly.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isDefault: boolean;
  createdAt: Date;
}

function serialise(row: BrandRow): {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_default: boolean;
  created_at: string;
} {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo_url: row.logoUrl,
    is_default: row.isDefault,
    created_at: row.createdAt.toISOString(),
  };
}

const brandNotFound = () => new ApiError('brand_not_found', 'Brand not found.');
const brandExists = (value: string) =>
  new ApiError('brand_exists', `A brand with the slug "${value}" already exists.`);

export default async function brandRoutes(app: FastifyInstance): Promise<void> {
  // The brand catalogue is license-level, so every query runs in the license-wide
  // context — the caller's `X-Nexa-Brand` (if any) is deliberately dropped.
  const licenseWide = (request: { tenant: () => TenantContext }): TenantContext => {
    const { licenseId, organizationId } = request.tenant();
    return { licenseId, organizationId };
  };
  const run = <T>(
    request: { tenant: () => TenantContext },
    fn: (tx: TenantClient) => Promise<T>,
  ): Promise<T> => withTenant(app.db, licenseWide(request), fn);

  app.get(
    '/brands',
    { config: { scopes: ['brands--all:ro', 'brands--all:rw'] } },
    async (request, reply) => {
      const items = await run(request, (tx) =>
        // Default first, then alphabetical — a stable order rather than insertion.
        tx.brand.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      );
      return reply.send({ items: items.map(serialise) });
    },
  );

  app.post(
    '/brands',
    { config: { scopes: ['brands--all:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(createBody, request.body);
      const tenant = request.tenant();

      const wanted = body.slug ?? slugify(body.name);
      if (!wanted) {
        throw ApiError.validation('Could not derive a slug from the name; provide one explicitly.');
      }

      try {
        const created = await run(request, (tx) =>
          // A new brand is never the default — the license keeps the one it has.
          tx.brand.create({
            data: {
              licenseId: tenant.licenseId,
              name: body.name,
              slug: wanted,
              logoUrl: body.logo_url ?? null,
            },
          }),
        );
        return reply.status(201).send(serialise(created));
      } catch (error) {
        if (isUniqueViolation(error)) throw brandExists(wanted);
        throw error;
      }
    },
  );

  app.get<{ Params: { brandId: string } }>(
    '/brands/:brandId',
    { config: { scopes: ['brands--all:ro', 'brands--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.brandId);
      const brand = await run(request, (tx) => tx.brand.findFirst({ where: { id } }));
      // Also the answer for another license's brand: RLS returns nothing and a
      // 404 keeps ids un-enumerable (NFR-S5).
      if (!brand) throw brandNotFound();
      return reply.send(serialise(brand));
    },
  );

  app.patch<{ Params: { brandId: string } }>(
    '/brands/:brandId',
    { config: { scopes: ['brands--all:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const id = parse(uuid, request.params.brandId);
      const body = parse(patchBody, request.body);

      const data: Prisma.BrandUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.slug !== undefined) data.slug = body.slug;
      if (body.logo_url !== undefined) data.logoUrl = body.logo_url;

      try {
        const updated = await run(request, async (tx) => {
          // Confirm visibility under RLS first, so a cross-license id is a clean
          // 404 rather than a P2025 surfacing as a 500.
          const existing = await tx.brand.findFirst({ where: { id }, select: { id: true } });
          if (!existing) return null;
          return tx.brand.update({ where: { id }, data });
        });
        if (!updated) throw brandNotFound();
        return reply.send(serialise(updated));
      } catch (error) {
        if (isUniqueViolation(error)) throw brandExists(body.slug ?? '');
        throw error;
      }
    },
  );

  app.delete<{ Params: { brandId: string } }>(
    '/brands/:brandId',
    { config: { scopes: ['brands--all:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const id = parse(uuid, request.params.brandId);

      const outcome = await run(request, async (tx) => {
        const brand = await tx.brand.findFirst({
          where: { id },
          select: { id: true, isDefault: true },
        });
        if (!brand) return 'not_found' as const;
        // The license default is the brand a header-less request resolves to; it
        // must always exist, so it cannot be deleted.
        if (brand.isDefault) return 'default' as const;

        // Refuse rather than cascade: a brand that still owns a channel or website
        // keeps its data until that data is moved or removed. The count runs in the
        // license-wide context, so it sees every brand's rows, not one brand's slice.
        const [channels, websites] = await Promise.all([
          tx.channel.count({ where: { brandId: id } }),
          tx.website.count({ where: { brandId: id } }),
        ]);
        if (channels + websites > 0) return 'has_data' as const;

        await tx.brand.delete({ where: { id } });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'data.deleted',
          target: `brand:${id}`,
          metadata: { kind: 'brand' },
        });
        return 'deleted' as const;
      });

      if (outcome === 'not_found') throw brandNotFound();
      if (outcome === 'default') {
        throw new ApiError('not_allowed', 'The default brand cannot be deleted.');
      }
      if (outcome === 'has_data') {
        throw new ApiError(
          'not_allowed',
          'This brand still has data (a channel or website). Move or remove it first.',
        );
      }
      return reply.status(204).send();
    },
  );
}
