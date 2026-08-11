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
import {
  DEFAULT_WIDGET_APPEARANCE,
  normalizeWidgetAppearance,
  type WidgetAppearance,
} from '@nexa/types';
import { resolveBrandId } from '../../lib/brand.js';
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
  /** The brand this site belongs to (Multibrand, PRD §5.3). */
  brand_id: string;
  domain: string;
  setup: WebsiteSetup;
  status: WebsiteStatus;
  connected_at: string | null;
  created_at: string;
  snippet: string;
}

interface WebsiteRow {
  id: string;
  brandId: string;
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

  /**
   * The appearance is read once and threaded into every snippet, so a customised
   * launch (FR-MOD-11.7) is baked into the code a customer pastes. Read here from
   * the same tenant transaction; a workspace that has never customised it gets
   * the shipped defaults and the minimal snippet it always had.
   */
  async list(tx: TenantClient, tenant: TenantContext): Promise<Website[]> {
    // RLS narrows the rows to the caller's license and — under a brand context —
    // to that one brand; the order gives the table a stable shape rather than
    // insertion order. The snippet appearance is the active brand's (or the
    // license default's), resolved once and shared, since a snippet is identical
    // across a workspace's sites (FR-MOD-11.7).
    const brandId = await resolveBrandId(tx, tenant.brandId);
    const [rows, appearance] = await Promise.all([
      tx.website.findMany({ orderBy: { domain: 'asc' } }),
      this.appearance(tx, brandId),
    ]);
    return rows.map((row) => this.serialise(row, tenant.organizationId, appearance));
  }

  async get(tx: TenantClient, tenant: TenantContext, id: string): Promise<Website | null> {
    const row = await tx.website.findFirst({ where: { id } });
    if (!row) return null;
    // The site's *own* brand appearance — RLS already limited what is visible, so
    // the row's brand is the right one for its snippet.
    return this.serialise(row, tenant.organizationId, await this.appearance(tx, row.brandId));
  }

  /** Throws Prisma P2002 on a duplicate `[licenseId, brandId, domain]`; the route maps it. */
  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: { domain: string; setup: WebsiteSetup; createdBy: string | null },
  ): Promise<Website> {
    // A website belongs to exactly one brand (brand_id is NOT NULL): the request's
    // brand when `X-Nexa-Brand` named one, otherwise the license default — the
    // sole brand of a single-brand workspace.
    const brandId = await resolveBrandId(tx, tenant.brandId);
    const row = await tx.website.create({
      data: {
        licenseId: tenant.licenseId,
        brandId,
        domain: input.domain,
        setup: input.setup,
        createdBy: input.createdBy,
      },
    });
    return this.serialise(row, tenant.organizationId, await this.appearance(tx, brandId));
  }

  /**
   * A brand's widget appearance, or the shipped defaults when it has never been
   * customised. Normalised so a value that somehow bypassed the endpoint's
   * validation still cannot carry anything but its declared shape into a snippet.
   */
  private async appearance(tx: TenantClient, brandId: string): Promise<WidgetAppearance> {
    const row = await tx.widgetSettings.findFirst({ where: { brandId } });
    return normalizeWidgetAppearance(
      row
        ? {
            primary_color: row.primaryColor,
            position: row.position as WidgetAppearance['position'],
            theme: row.theme as WidgetAppearance['theme'],
            mobile_fullscreen: row.mobileFullscreen,
            powered_by: row.poweredBy,
          }
        : null,
    );
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

  serialise(row: WebsiteRow, organizationId: string, appearance: WidgetAppearance): Website {
    return {
      id: row.id,
      brand_id: row.brandId,
      domain: row.domain,
      setup: row.setup as WebsiteSetup,
      status: row.status as WebsiteStatus,
      connected_at: row.connectedAt ? row.connectedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      snippet: this.snippet(organizationId, appearance),
    };
  }

  /**
   * The code a customer pastes before `</body>`. Identical across a workspace's
   * sites — the embedding origin is resolved at runtime against trusted domains,
   * so the snippet only needs to name the tenant, where to load the widget, and
   * how it should look.
   *
   * Only appearance that differs from the shipped defaults is emitted, so a
   * workspace that has never customised the widget still gets the minimal
   * snippet, and a customised one carries just its overrides (FR-MOD-11.7).
   *
   * `organizationId` is a validated UUID, `widgetBaseUrl` a validated URL and
   * the appearance is normalised — a colour is only ever `#rrggbb`, position and
   * theme only their enums — so nothing here can carry markup into the template.
   */
  snippet(
    organizationId: string,
    appearance: WidgetAppearance = DEFAULT_WIDGET_APPEARANCE,
  ): string {
    const origin = this.widgetBaseUrl.replace(/\/+$/, '');
    const fields = [
      `organizationId: "${organizationId}"`,
      `widgetOrigin: "${origin}"`,
      ...appearanceFields(appearance),
    ];
    return [
      '<!-- Nexa widget -->',
      '<script>',
      `  window.__nexa = { ${fields.join(', ')} };`,
      '</script>',
      `<script async src="${origin}/loader.js"></script>`,
    ].join('\n');
  }
}

/**
 * The `window.__nexa` fields for the appearance, in the loader's camelCase, and
 * only where they differ from the defaults. Booleans and enum strings, both
 * already normalised, so each renders as a safe literal.
 */
function appearanceFields(appearance: WidgetAppearance): string[] {
  const fields: string[] = [];
  if (appearance.primary_color !== DEFAULT_WIDGET_APPEARANCE.primary_color) {
    fields.push(`primaryColor: "${appearance.primary_color}"`);
  }
  if (appearance.position !== DEFAULT_WIDGET_APPEARANCE.position) {
    fields.push(`position: "${appearance.position}"`);
  }
  if (appearance.theme !== DEFAULT_WIDGET_APPEARANCE.theme) {
    fields.push(`theme: "${appearance.theme}"`);
  }
  if (appearance.mobile_fullscreen !== DEFAULT_WIDGET_APPEARANCE.mobile_fullscreen) {
    fields.push(`mobileFullscreen: ${appearance.mobile_fullscreen}`);
  }
  if (appearance.powered_by !== DEFAULT_WIDGET_APPEARANCE.powered_by) {
    fields.push(`poweredBy: ${appearance.powered_by}`);
  }
  return fields;
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
