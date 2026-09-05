/**
 * E-mail forwarding addresses (FR-MOD-08.5.3).
 *
 * A workspace used to have exactly one address, `<organization_id>@<domain>`,
 * conjured from the local part of whatever a provider addressed. Nothing stored
 * it, so nothing could hold a second one — support, billing and returns all
 * arrived in the same undifferentiated queue — and no ticket recorded which
 * address it came in on.
 *
 * The scheme here keeps the organization id in front and appends a label:
 *
 *     <organization_id>@<domain>          the default address (label === null)
 *     <organization_id>+support@<domain>  a defined address
 *
 * Two properties fall out of that, and both matter more than the syntax:
 *
 *  - **No two workspaces can hold the same address.** The organization id makes
 *    a collision arithmetically impossible, and `local_part` is UNIQUE across
 *    the whole table, so the database refuses one independently of any parsing
 *    rule. The refusal never names the holder (NFR-S5).
 *  - **A real provider keeps working.** `a+b@d` is ordinary sub-addressing, so a
 *    catch-all forward set up before labels existed still delivers.
 *
 * The default address is materialised lazily rather than backfilled: every
 * workspace has one conceptually, so `ensureDefault` writes its row the first
 * time anybody looks — listing the addresses, or a message arriving at it. That
 * keeps a workspace created before this feature, or by a path that never heard
 * of it, from being one with no default address at all.
 */
import { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/**
 * The label vocabulary, matching `inbound_email_addresses_label_check`.
 *
 * Lowercase only: routing lower-cases the local part before comparing it, so an
 * uppercase label would be an address that can never be addressed. Refused
 * rather than folded — see `create`. Kept in step with the CHECK by the
 * integration suite, which asserts the database refuses what this refuses.
 */
export const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

/** Labels the product reserves — they read as system mail, not as a queue. */
const RESERVED_LABELS = new Set(['default', 'noreply', 'no-reply', 'postmaster', 'abuse']);

export interface InboundEmailAddressRow {
  id: string;
  label: string | null;
  address: string;
  is_default: boolean;
  ticket_count: number;
  last_received_at: string | null;
  created_at: string;
}

/** The local part an address resolves from: `<org>` or `<org>+<label>`. */
export function localPartFor(organizationId: string, label: string | null): string {
  return (label ? `${organizationId}+${label}` : organizationId).toLowerCase();
}

/** The whole address, as it is pasted into a mail provider's forwarding rule. */
export function addressFor(organizationId: string, label: string | null, domain: string): string {
  return `${localPartFor(organizationId, label)}@${domain}`;
}

/**
 * The refusal a taken address raises.
 *
 * Says only that the address is taken, never by whom — the same shape and the
 * same reasoning as `channel-service.ts`'s `addressTaken()`. That an address is
 * unavailable is unavoidable (it is the rejection), but naming the workspace
 * behind it would turn a guessable label into a lookup for who uses Nexa.
 * `validation` (400) rather than a new error type, because the contract already
 * documents 400 here and the client story is unchanged.
 */
function addressTaken(): ApiError {
  return ApiError.validation('That forwarding address is already taken.');
}

/** A unique-index violation, as Prisma reports it (same probe as websites.ts). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class InboundEmailAddressService {
  constructor(private readonly domain: string) {}

  /**
   * The workspace's default address row, created if this is the first ask.
   *
   * Racy by nature — two requests may both find nothing — so the insert tolerates
   * a duplicate and re-reads rather than pretending it won. The unique key on
   * `local_part` is what makes that safe.
   */
  async ensureDefault(tx: TenantClient, tenant: TenantContext): Promise<{ id: string }> {
    const existing = await tx.inboundEmailAddress.findFirst({
      where: { label: null },
      select: { id: true },
    });
    if (existing) return existing;

    try {
      return await tx.inboundEmailAddress.create({
        data: {
          licenseId: tenant.licenseId,
          label: null,
          localPart: localPartFor(tenant.organizationId, null),
        },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Somebody else created it between the read and the write.
      return await tx.inboundEmailAddress.findFirstOrThrow({
        where: { label: null },
        select: { id: true },
      });
    }
  }

  /**
   * Every address, default first, each with its own activity.
   *
   * The counts come from `tickets.inbound_address_id` in one grouped query
   * rather than one per address: a workspace may hold many addresses, and the
   * console reads this every time the Email card is opened.
   */
  async list(tx: TenantClient, tenant: TenantContext): Promise<InboundEmailAddressRow[]> {
    await this.ensureDefault(tx, tenant);

    const rows = await tx.inboundEmailAddress.findMany({
      orderBy: [{ label: { sort: 'asc', nulls: 'first' } }],
      select: { id: true, label: true, createdAt: true },
    });

    const activity = await tx.ticket.groupBy({
      by: ['inboundAddressId'],
      where: { inboundAddressId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const byAddress = new Map(activity.map((entry) => [entry.inboundAddressId, entry]));

    return rows.map((row) => {
      const stats = byAddress.get(row.id);
      return {
        id: row.id,
        label: row.label,
        address: addressFor(tenant.organizationId, row.label, this.domain),
        is_default: row.label === null,
        ticket_count: stats?._count._all ?? 0,
        last_received_at: stats?._max.createdAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  /** Define `<organization_id>+<label>@<domain>`. */
  async create(
    tx: TenantClient,
    tenant: TenantContext,
    label: string,
  ): Promise<InboundEmailAddressRow> {
    // Validated as typed, not after folding: the label is echoed straight back
    // inside the address, so quietly turning `Support` into `support` would show
    // the caller an address they did not ask for. The contract's pattern, this
    // rule and `inbound_email_addresses_label_check` all say the same sentence.
    const normalized = label.trim();
    if (!LABEL_RE.test(normalized)) {
      throw ApiError.validation(
        'label: use 1-32 lowercase letters, digits or interior hyphens (for example `support`).',
      );
    }
    if (RESERVED_LABELS.has(normalized)) {
      throw ApiError.validation('label: that name is reserved.');
    }

    try {
      const created = await tx.inboundEmailAddress.create({
        data: {
          licenseId: tenant.licenseId,
          label: normalized,
          localPart: localPartFor(tenant.organizationId, normalized),
        },
        select: { id: true, label: true, createdAt: true },
      });
      return {
        id: created.id,
        label: created.label,
        address: addressFor(tenant.organizationId, created.label, this.domain),
        is_default: false,
        ticket_count: 0,
        last_received_at: null,
        created_at: created.createdAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }
  }

  /** The address a route names, or a 404 indistinguishable from another tenant's. */
  async load(tx: TenantClient, addressId: string): Promise<{ id: string; label: string | null }> {
    const row = await tx.inboundEmailAddress.findUnique({
      where: { id: addressId },
      select: { id: true, label: true },
    });
    if (!row) throw ApiError.notFound('Forwarding address not found.');
    return row;
  }

  /**
   * Stop accepting mail at an address.
   *
   * The default is refused: it is the address every forwarding rule already
   * points at, and deleting it would drop support mail silently rather than
   * loudly. The tickets it produced survive — the FK is `ON DELETE SET NULL`.
   */
  async remove(tx: TenantClient, addressId: string): Promise<{ label: string }> {
    const row = await this.load(tx, addressId);
    if (row.label === null) {
      throw ApiError.validation('The default forwarding address cannot be removed.');
    }
    await tx.inboundEmailAddress.delete({ where: { id: row.id } });
    return { label: row.label };
  }
}
