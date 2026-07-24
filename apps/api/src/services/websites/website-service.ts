/**
 * Website widgets — FR-MOD-08.5.2.
 *
 * The sites a workspace has installed the widget on. Deliberately separate from
 * trusted domains (FR-MOD-08.9.1): a website is the install record ("I pasted
 * the snippet on shop.example"), a trusted domain is the security allowlist that
 * decides whether the widget may mint a token there. Adding a website does not
 * authorise its origin — the two are stored and reasoned about independently.
 *
 * A site starts `pending` and flips to `connected` the first time the widget
 * completes a handshake from its domain. That signal is written from the
 * customer-token route (`markWebsiteConnected`), the earliest server-side proof
 * the widget is actually live on the page, rather than from the UI.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/**
 * How the widget was installed. `platform` covers a hosted integration
 * (Shopify/WordPress/GTM), `manual` a pasted snippet. Constrained to these two
 * by the `websites_setup_check` DB invariant and PRD §8.4; the finer platform
 * icon the UI shows (FR-MOD-08.5.2) is a presentation mapping, not stored here.
 */
export type WebsiteSetup = 'manual' | 'platform';
export const WEBSITE_SETUPS: readonly WebsiteSetup[] = ['manual', 'platform'];

/** DB `websites_status_check`: pending until the first handshake, then connected. */
export type WebsiteStatus = 'pending' | 'connected' | 'error';

export interface Website {
  id: string;
  domain: string;
  setup: WebsiteSetup;
  status: WebsiteStatus;
  connected_at: string | null;
  created_at: string;
  snippet: string;
}

interface WebsiteRow {
  id: string;
  domain: string;
  setup: string;
  status: string;
  connectedAt: Date | null;
  createdAt: Date;
}

export class WebsiteService {
  /**
   * @param widgetBaseUrl Origin serving `loader.js` and the iframe. Injected so
   *   the snippet points at whatever a deployment actually serves the widget on.
   */
  constructor(private readonly widgetBaseUrl: string) {}

  async list(tx: TenantClient, organizationId: string): Promise<Website[]> {
    // RLS narrows to the caller's license; the order gives the table a stable
    // shape rather than insertion order.
    const rows = await tx.website.findMany({ orderBy: { domain: 'asc' } });
    return rows.map((row) => this.serialise(row, organizationId));
  }

  async get(tx: TenantClient, organizationId: string, id: string): Promise<Website | null> {
    const row = await tx.website.findFirst({ where: { id } });
    return row ? this.serialise(row, organizationId) : null;
  }

  /** Throws Prisma P2002 on a duplicate `[licenseId, domain]`; the route maps it. */
  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: { domain: string; setup: WebsiteSetup; createdBy: string | null },
  ): Promise<Website> {
    const row = await tx.website.create({
      data: {
        licenseId: tenant.licenseId,
        domain: input.domain,
        setup: input.setup,
        createdBy: input.createdBy,
      },
    });
    return this.serialise(row, tenant.organizationId);
  }

  /**
   * Scoped delete rather than `delete by id`: the id alone would let a caller
   * remove another tenant's website if RLS were ever misconfigured. Returns the
   * number of rows removed so the route can answer 404 vs 204.
   */
  async remove(tx: TenantClient, id: string): Promise<number> {
    const { count } = await tx.website.deleteMany({ where: { id } });
    return count;
  }

  serialise(row: WebsiteRow, organizationId: string): Website {
    return {
      id: row.id,
      domain: row.domain,
      setup: row.setup as WebsiteSetup,
      status: row.status as WebsiteStatus,
      connected_at: row.connectedAt ? row.connectedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      snippet: this.snippet(organizationId),
    };
  }

  /**
   * The code a customer pastes before `</body>`. Identical across a workspace's
   * sites — the embedding origin is resolved at runtime against trusted domains,
   * so the snippet only needs to name the tenant and where to load the widget.
   *
   * `organizationId` is a validated UUID and `widgetBaseUrl` a validated URL, so
   * neither can carry markup into the template.
   */
  snippet(organizationId: string): string {
    const origin = this.widgetBaseUrl.replace(/\/+$/, '');
    return [
      '<!-- Nexa widget -->',
      '<script>',
      `  window.__nexa = { organizationId: "${organizationId}", widgetOrigin: "${origin}" };`,
      '</script>',
      `<script async src="${origin}/loader.js"></script>`,
    ].join('\n');
  }
}

/**
 * Flip a `pending` website to `connected` on the widget's first handshake.
 *
 * Called from the customer-token route once the origin has been proven to be on
 * the license's allowlist, so `domain` is already the canonical hostname. The
 * `status: 'pending'` guard makes it idempotent and keeps `connected_at` at the
 * *first* handshake — every later token mint matches zero rows and writes
 * nothing. Best-effort by contract: the caller must not let a failure here break
 * token issuance, and a domain with no website row (installed via trusted
 * domains only) simply matches nothing.
 */
export async function markWebsiteConnected(tx: TenantClient, domain: string): Promise<void> {
  await tx.website.updateMany({
    where: { domain, status: 'pending' },
    data: { status: 'connected', connectedAt: new Date() },
  });
}
