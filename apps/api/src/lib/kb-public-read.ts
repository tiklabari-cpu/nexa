/**
 * Shared read core for the public knowledge base (PUBKB-c · PUBKB-e).
 *
 * The anonymous KB has two faces: the JSON reader API (`routes/public-kb.ts`) and
 * the server-rendered SEO HTML surface (`routes/public-kb-html.ts`). Both derive
 * their tenant from a `{workspaceSlug}` path segment, and both may serve only
 * *published* articles. Those two decisions are the security boundary, so they
 * live here in one place and are **called, never copied** — a second copy of the
 * resolver or the published-filter is a second thing to keep in step, and the day
 * they drift is the day one surface leaks what the other hides.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { TenantContext } from './tenant.js';

/**
 * Turn a public KB slug into a tenant context, or `null` for every miss.
 *
 * Runs the SECURITY DEFINER `kb_resolve_public_slug` outside any tenant
 * transaction (there is none yet) — exactly as the email-inbound and hosted-Chat
 * paths resolve a licence before a session exists. A disabled KB, a cancelled
 * licence and an unknown slug all come back as no row, so this returns one
 * uniform `null`; the caller turns it into the single indistinguishable 404
 * (NFR-S5). Which of the misses occurred never reaches this layer, so it cannot
 * leak past it.
 */
export async function resolvePublicKbWorkspace(
  db: PrismaClient,
  slug: string,
): Promise<TenantContext | null> {
  const rows = await db.$queryRaw<Array<{ license_id: bigint; organization_id: string }>>(
    Prisma.sql`SELECT * FROM kb_resolve_public_slug(${slug})`,
  );
  const match = rows[0];
  if (!match) return null;
  return { licenseId: match.license_id, organizationId: match.organization_id };
}

/**
 * The published-only predicate — the "yalnız yayınlanan" half of the boundary.
 * A row is public only when it is both marked `published` *and* carries a stamped
 * `published_at`; a draft satisfies neither. Defined once so both surfaces filter
 * identically: RLS (the tenant match) and this predicate together are the only
 * gate between a draft and an anonymous reader.
 */
export function publishedArticleWhere(): Prisma.KbArticleWhereInput {
  return { status: 'published', publishedAt: { not: null } };
}
