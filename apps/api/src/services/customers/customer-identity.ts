/**
 * Possible matches and agent-confirmed links between customer records
 * (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.4 ·
 * docs/adr/member-recognition.md §10).
 *
 * A member who arrives from another device, or from a browser that dropped its
 * member token, is a new customer — K4 recognises nobody by what they type. The
 * pre-chat username and e-mail are still useful to an agent, as a question:
 * another record of this organization that typed the same username (folded) or
 * the same e-mail is a **possible match**, shown unverified, never acted on by
 * itself. When the agent is satisfied it is the same person, a team lead or
 * above links the two records.
 *
 * **A link joins the agent's history view and nothing else.** The day's
 * conversation (ID-02) is opened by customer number, and the AI's memory
 * (AI-02) is read by customer number — neither of them reads
 * `customer_identity_links`, and nothing in `services/ai` may start to. A
 * username typed on a stranger's phone must never be a way into a member's
 * history, and an agent's mistaken link must never put one person's
 * conversations in front of the AI answering another.
 *
 * Every method runs inside the caller's tenant transaction (`withTenant`):
 * `customers` and `customer_identity_links` are organization-scoped by RLS, so
 * another organization's customer reads as absent — the routes' 404 (NFR-S5).
 * The link table's `WITH CHECK` also wants both customers to be this
 * organization's, so a cross-tenant link cannot be written even by mistake.
 */
import { randomUUID } from 'node:crypto';
import { POSSIBLE_MATCH_LIMIT, type PossibleMatchField } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** Just enough of another record to tell an agent who it is (`CustomerMatchSummary`). */
export interface CustomerMatchSummaryView {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  last_activity_at: string | null;
}

export interface PossibleMatchView {
  customer: CustomerMatchSummaryView;
  matched_on: PossibleMatchField[];
  linked: boolean;
}

export interface PossibleMatchListView {
  items: PossibleMatchView[];
  enabled: boolean;
}

export interface CustomerIdentityLinkView {
  customer_id: string;
  linked_customer: CustomerMatchSummaryView;
  linked_at: string;
  linked_by: string;
}

/** What `link` did: a new (or renewed) link, one that already held, or a missing customer. */
export type LinkOutcome =
  | { kind: 'linked'; link: CustomerIdentityLinkView }
  | { kind: 'already_linked'; link: CustomerIdentityLinkView }
  | { kind: 'not_found' };

interface SummaryRow {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  last_activity_at: Date | null;
}

interface LinkRow extends SummaryRow {
  linked_at: Date;
  linked_by: string;
}

function summary(row: SummaryRow): CustomerMatchSummaryView {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    last_activity_at: row.last_activity_at?.toISOString() ?? null,
  };
}

export class CustomerIdentityService {
  /**
   * Other records of this organization with the same folded pre-chat username
   * or the same e-mail — at most `POSSIBLE_MATCH_LIMIT`, most recently active
   * first. Null when the customer is not this organization's.
   *
   * The licence's switch (Settings › Security › Member recognition) turns the
   * whole list off: `enabled: false` and no rows, without looking.
   *
   * Two lookups joined by `UNION` rather than one `OR`: under RLS a
   * non-leakproof qual cannot become an index condition, and an `OR` whose
   * halves cannot both be index conditions is a filter over the whole
   * organization. The username half is `texteq` on the generated
   * `username_normalized` column — leakproof, served by the partial index
   * `customers_organization_id_username_normalized_idx` (measured as
   * `siyahtus_app`, `customer-identity-links.test.ts`). The e-mail half is
   * `citext` equality, which is **not** leakproof: it reaches the
   * `(organization_id, email)` index on the organization only and filters the
   * e-mail, so it reads every customer of the organization. That is what
   * `email-inbound.ts`' customer lookup already costs; fine at pilot size, and
   * the remedy when a tenant outgrows it is the username one — a generated,
   * folded `text` column with its own partial index (ADR §10).
   */
  async possibleMatches(
    tx: TenantClient,
    input: { licenseId: bigint; customerId: string },
  ): Promise<PossibleMatchListView | null> {
    const [target] = await tx.$queryRaw<
      Array<{ organization_id: string; username_normalized: string | null; email: string | null }>
    >`SELECT organization_id, username_normalized, email::text AS email
      FROM customers WHERE id = ${input.customerId}::uuid`;
    if (!target) return null;

    const settings = await tx.memberRecognitionSettings.findUnique({
      where: { licenseId: input.licenseId },
      select: { possibleMatchesEnabled: true },
    });
    // No row until the first save, and the default is on (`view` reads the same).
    if (settings && !settings.possibleMatchesEnabled) return { items: [], enabled: false };

    // A blank username folds to '' and a blank e-mail is no e-mail: neither
    // says anything about who someone is, and both would match every other
    // visitor who left the field blank.
    const username = target.username_normalized ? target.username_normalized : null;
    const email = target.email?.trim() ? target.email : null;
    if (username === null && email === null) return { items: [], enabled: true };

    const rows = await tx.$queryRaw<
      Array<SummaryRow & { same_username: boolean; same_email: boolean; linked: boolean }>
    >`
      WITH candidates AS (
        SELECT id FROM customers
        WHERE organization_id = ${target.organization_id}::uuid
          AND username_normalized = ${username}::text
          AND id <> ${input.customerId}::uuid
        UNION
        SELECT id FROM customers
        WHERE organization_id = ${target.organization_id}::uuid
          AND email = ${email}::citext
          AND id <> ${input.customerId}::uuid
      )
      SELECT c.id, c.name, c.username, c.email::text AS email, c.last_activity_at,
             COALESCE(c.username_normalized = ${username}::text, false) AS same_username,
             COALESCE(c.email = ${email}::citext, false) AS same_email,
             EXISTS (
               SELECT 1 FROM customer_identity_links l
               WHERE l.customer_a_id = LEAST(c.id, ${input.customerId}::uuid)
                 AND l.customer_b_id = GREATEST(c.id, ${input.customerId}::uuid)
                 AND l.unlinked_at IS NULL
             ) AS linked
      FROM candidates k
      JOIN customers c ON c.id = k.id
      ORDER BY c.last_activity_at DESC NULLS LAST, c.created_at DESC, c.id
      LIMIT ${POSSIBLE_MATCH_LIMIT}`;

    return {
      enabled: true,
      items: rows.map((row) => ({
        customer: summary(row),
        matched_on: [
          ...(row.same_username ? (['username'] as const) : []),
          ...(row.same_email ? (['email'] as const) : []),
        ],
        linked: row.linked,
      })),
    };
  }

  /**
   * The records linked to this one, most recently linked first — what the
   * agent's merged history view reads. Null when the customer is not this
   * organization's. An undone link is not listed.
   */
  async links(tx: TenantClient, customerId: string): Promise<CustomerIdentityLinkView[] | null> {
    if (!(await this.#exists(tx, [customerId]))) return null;
    const rows = await this.#linkRows(tx, customerId, null);
    return rows.map((row) => linkView(customerId, row));
  }

  /**
   * Confirm that `otherId` is the same person as `customerId`. A pair that is
   * already linked is left as it is (`already_linked`); a pair that was linked
   * and undone is linked again, with this confirmation's author and time — a
   * new decision, so a new audit entry. The caller has refused a record linked
   * to itself.
   */
  async link(
    tx: TenantClient,
    input: { organizationId: string; customerId: string; otherId: string; linkedBy: string },
  ): Promise<LinkOutcome> {
    if (!(await this.#exists(tx, [input.customerId, input.otherId]))) return { kind: 'not_found' };

    // The pair is stored in uuid order (`customer_identity_links_order_check`);
    // LEAST/GREATEST order it in the database, by the same comparison the CHECK
    // makes. Concurrent confirmations of one pair meet on the unique index:
    // one inserts, the other finds it live and changes nothing.
    const written = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO customer_identity_links
        (id, organization_id, customer_a_id, customer_b_id, linked_by, linked_at)
      VALUES (
        ${randomUUID()}::uuid, ${input.organizationId}::uuid,
        LEAST(${input.customerId}::uuid, ${input.otherId}::uuid),
        GREATEST(${input.customerId}::uuid, ${input.otherId}::uuid),
        ${input.linkedBy}::uuid, now()
      )
      ON CONFLICT (customer_a_id, customer_b_id) DO UPDATE
        SET linked_by = EXCLUDED.linked_by,
            linked_at = EXCLUDED.linked_at,
            unlinked_by = NULL,
            unlinked_at = NULL
        WHERE customer_identity_links.unlinked_at IS NOT NULL
      RETURNING id`;

    const [row] = await this.#linkRows(tx, input.customerId, input.otherId);
    // Only an erasure of one of the two committing in between gets here, and
    // then the record is gone.
    if (!row) return { kind: 'not_found' };
    const link = linkView(input.customerId, row);
    return written.length > 0 ? { kind: 'linked', link } : { kind: 'already_linked', link };
  }

  /**
   * Undo the link between two records, either named first. False when they are
   * not linked — including when either is another organization's.
   */
  async unlink(
    tx: TenantClient,
    input: { customerId: string; otherId: string; unlinkedBy: string },
  ): Promise<boolean> {
    // Kept, not deleted (the app role cannot delete here): who linked and who
    // undid it stay readable, and the audit trail names both moments.
    const updated = await tx.$executeRaw`
      UPDATE customer_identity_links
      SET unlinked_by = ${input.unlinkedBy}::uuid, unlinked_at = now()
      WHERE customer_a_id = LEAST(${input.customerId}::uuid, ${input.otherId}::uuid)
        AND customer_b_id = GREATEST(${input.customerId}::uuid, ${input.otherId}::uuid)
        AND unlinked_at IS NULL`;
    return updated > 0;
  }

  async #exists(tx: TenantClient, ids: string[]): Promise<boolean> {
    const found = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE id = ANY(${ids}::uuid[])`;
    return found.length === new Set(ids).size;
  }

  /** The live links of `customerId` — to `otherId` only, when given. */
  async #linkRows(
    tx: TenantClient,
    customerId: string,
    otherId: string | null,
  ): Promise<LinkRow[]> {
    return tx.$queryRaw<LinkRow[]>`
      SELECT c.id, c.name, c.username, c.email::text AS email, c.last_activity_at,
             l.linked_at, l.linked_by
      FROM customer_identity_links l
      JOIN customers c ON c.id = CASE WHEN l.customer_a_id = ${customerId}::uuid
                                      THEN l.customer_b_id ELSE l.customer_a_id END
      WHERE (l.customer_a_id = ${customerId}::uuid OR l.customer_b_id = ${customerId}::uuid)
        AND l.unlinked_at IS NULL
        AND (${otherId}::uuid IS NULL OR c.id = ${otherId}::uuid)
      ORDER BY l.linked_at DESC, c.id`;
  }
}

function linkView(customerId: string, row: LinkRow): CustomerIdentityLinkView {
  return {
    customer_id: customerId,
    linked_customer: summary(row),
    linked_at: row.linked_at.toISOString(),
    linked_by: row.linked_by,
  };
}
