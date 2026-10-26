/**
 * The support desk's lookup (tm 389.9 · FR-ADMIN-10 · design.md §C support): a
 * customer quotes an identifier, the operator learns which workspace it belongs
 * to — and nothing else.
 *
 * What a customer can quote:
 *
 *   - a **Thread ID** — the panel's name for `chats.id` (the day's conversation
 *     cap, #284 glossary K1 = A);
 *   - a **Chat ID** — the panel's name for `threads.id`;
 *   - a **ticket** number (`tickets.id`);
 *   - their own **email**, which is a `customers` row of every workspace they
 *     wrote to, so it can name several.
 *
 * The three ids share one shape (`SHORT_ID_RE`: ten Crockford Base32
 * characters), so an id is looked for in all three tables. The answer carries
 * the licence number, the organization's name and what matched — never a
 * subject, a message, a customer's name: the operator who needs those enters
 * the workspace through impersonation (389.15), on the record.
 *
 * **No existence oracle.** "Unknown" and "not an identifier at all" are the
 * same empty answer, and every lookup runs the same four probes whatever the
 * input looks like — a probe the input cannot match is run with a value no row
 * holds — so neither the result nor the work done says which probe hit. The
 * route adds a fixed floor on the answer time (`LOOKUP_FLOOR_MS`), which covers
 * the difference a hit's one extra row makes.
 *
 * Reads as `siyahtus_platform` (BYPASSRLS): each probe returns licence numbers
 * only, and the names come from `organizations` by those numbers.
 */
import type { PrismaClient } from '@prisma/client';
import { SHORT_ID_RE } from '@siyahtus/types';

export const LOOKUP_KINDS = ['thread_id', 'chat_id', 'ticket', 'customer_email'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

/** The answer is never sooner than this after the request arrived. */
export const LOOKUP_FLOOR_MS = 250;

export const LOOKUP_QUERY_MAX = 320;

/** A shape no id has — the value a probe the input cannot match is run with. */
const NO_ID = '';
const NO_EMAIL = '';

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export interface LookupMatch {
  kind: LookupKind;
  license_id: string;
  organization_name: string;
}

/** What the input could be: an id (upper-cased), an email, or neither. */
export function classifyLookup(raw: string): { id: string; email: string } {
  const text = raw.trim();
  const upper = text.toUpperCase();
  if (SHORT_ID_RE.test(upper)) return { id: upper, email: NO_EMAIL };
  if (text.length <= LOOKUP_QUERY_MAX && EMAIL_RE.test(text)) return { id: NO_ID, email: text };
  return { id: NO_ID, email: NO_EMAIL };
}

export async function supportLookup(db: PrismaClient, raw: string): Promise<LookupMatch[]> {
  const { id, email } = classifyLookup(raw);

  const [chats, threads, tickets, customers] = await Promise.all([
    db.$queryRaw<Array<{ license_id: bigint }>>`
      SELECT license_id FROM chats WHERE id = ${id}`,
    db.$queryRaw<Array<{ license_id: bigint }>>`
      SELECT license_id FROM threads WHERE id = ${id}`,
    db.$queryRaw<Array<{ license_id: bigint }>>`
      SELECT license_id FROM tickets WHERE id = ${id}`,
    db.$queryRaw<Array<{ license_id: bigint }>>`
      SELECT DISTINCT l.id AS license_id FROM customers c
      JOIN licenses l ON l.organization_id = c.organization_id
      WHERE c.email = ${email}::citext`,
  ]);

  const hits: Array<{ kind: LookupKind; licenseId: bigint }> = [
    ...chats.map((row) => ({ kind: 'thread_id' as const, licenseId: row.license_id })),
    ...threads.map((row) => ({ kind: 'chat_id' as const, licenseId: row.license_id })),
    ...tickets.map((row) => ({ kind: 'ticket' as const, licenseId: row.license_id })),
    ...customers.map((row) => ({ kind: 'customer_email' as const, licenseId: row.license_id })),
  ];

  // Always asked, an empty list included — the same statement either way.
  const ids = [...new Set(hits.map((hit) => hit.licenseId))];
  const names = await db.$queryRaw<Array<{ id: bigint; name: string }>>`
    SELECT l.id, o.name FROM licenses l JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = ANY(${ids}::bigint[])`;
  const nameOf = new Map(names.map((row) => [row.id, row.name]));

  const seen = new Set<string>();
  const matches: LookupMatch[] = [];
  for (const hit of hits) {
    const name = nameOf.get(hit.licenseId);
    const key = `${hit.kind}:${hit.licenseId}`;
    if (name === undefined || seen.has(key)) continue;
    seen.add(key);
    matches.push({ kind: hit.kind, license_id: hit.licenseId.toString(), organization_name: name });
  }
  return matches;
}
