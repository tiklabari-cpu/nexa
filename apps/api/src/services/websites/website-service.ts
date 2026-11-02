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
  isWidgetUiLocale,
  normalizeWidgetAppearance,
  type WidgetAppearance,
  type WidgetUiLocale,
} from '@siyahtus/types';
import { resolveBrandId } from '../../lib/brand.js';
import { poweredByFor } from '../../lib/entitlements.js';
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
      this.appearance(tx, tenant, brandId),
    ]);
    return rows.map((row) => this.serialise(row, tenant.organizationId, appearance));
  }

  async get(tx: TenantClient, tenant: TenantContext, id: string): Promise<Website | null> {
    const row = await tx.website.findFirst({ where: { id } });
    if (!row) return null;
    // The site's *own* brand appearance — RLS already limited what is visible, so
    // the row's brand is the right one for its snippet.
    return this.serialise(
      row,
      tenant.organizationId,
      await this.appearance(tx, tenant, row.brandId),
    );
  }

  /** Throws Prisma P2002 on a duplicate `[licenseId, brandId, domain]`; the route maps it. */
  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: { domain: string; setup: WebsiteSetup; createdBy: string | null },
  ): Promise<Website> {
    // A website belongs to exactly one brand (brand_id is NOT NULL): the request's
    // brand when `X-SiyahTus-Brand` named one, otherwise the license default — the
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
    return this.serialise(row, tenant.organizationId, await this.appearance(tx, tenant, brandId));
  }

  /**
   * A brand's widget appearance, or the shipped defaults when it has never been
   * customised. Normalised so a value that somehow bypassed the endpoint's
   * validation still cannot carry anything but its declared shape into a snippet.
   *
   * The white-label rule is applied here rather than left to the snippet
   * (FR-MOD-11.5). A snippet is *copied out of the product* and pasted into a
   * customer's HTML, where nothing this deployment does can revisit it — so a
   * `poweredBy: false` emitted while the entitlement was held would keep that
   * page unbranded for as long as the paste survives. `poweredByFor` is what
   * keeps it out of the text in the first place.
   */
  private async appearance(
    tx: TenantClient,
    tenant: TenantContext,
    brandId: string,
  ): Promise<WidgetAppearance> {
    const row = await tx.widgetSettings.findFirst({ where: { brandId } });
    if (!row) return normalizeWidgetAppearance(null);
    return normalizeWidgetAppearance({
      primary_color: row.primaryColor,
      position: row.position as WidgetAppearance['position'],
      theme: row.theme as WidgetAppearance['theme'],
      mobile_fullscreen: row.mobileFullscreen,
      powered_by: await poweredByFor(tx, tenant, row.poweredBy),
      // Only the `<noscript>` line reads these (WG-15): the live widget gets its
      // language from the mint, never from the snippet.
      language: row.language as WidgetAppearance['language'],
      fallback_language: row.fallbackLanguage as WidgetAppearance['fallback_language'],
    });
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
   * It ends with a `<noscript>` link to the hosted Chat page (WG-15), so a visitor
   * whose browser blocks scripts still reaches the team. The link text is one
   * line from a fixed per-language list (`NOSCRIPT_CHAT_LINK`), picked by the
   * workspace's widget language — a pinned language, otherwise the language
   * `auto` falls back to, since a pasted snippet cannot know the visitor's. It
   * is baked in at copy time (an installed snippet never changes); the live
   * widget's language still comes from the mint.
   *
   * `organizationId` is a validated UUID, `widgetBaseUrl` a validated URL and
   * the appearance is normalised — a colour is only ever `#rrggbb`, position and
   * theme only their enums, the language one of eight codes — so nothing here can
   * carry markup into the template.
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
      '<!-- SiyahTuş widget -->',
      '<script>',
      `  window.__siyahtus = { ${fields.join(', ')} };`,
      '</script>',
      `<script async src="${origin}/loader.js"></script>`,
      noscriptLink(origin, organizationId, appearance),
    ].join('\n');
  }
}

/**
 * The anchor text of the `<noscript>` fallback, per widget language (WG-15). A
 * fixed list — the only text the snippet carries that is not code — so there is
 * no user input to escape. `Record` over the locale union: a ninth widget
 * language is a compile error here until it has a line.
 */
const NOSCRIPT_CHAT_LINK: Record<WidgetUiLocale, string> = {
  en: 'Chat with us',
  tr: 'Bizimle sohbet edin',
  de: 'Chatten Sie mit uns',
  fr: 'Discutez avec nous',
  es: 'Chatea con nosotros',
  it: 'Chatta con noi',
  pt: 'Converse conosco',
  ar: 'تحدث معنا',
};

/**
 * What a JavaScript-free page shows in place of the launcher: a link to the
 * hosted Chat page (`apps/widget/chat.html`, FR-MOD-08.5.9) scoped to the
 * workspace. That page is on our own origin, which is why it needs no trusted
 * domain; the link carries only the organization id, nothing about the visitor.
 */
function noscriptLink(
  origin: string,
  organizationId: string,
  appearance: WidgetAppearance,
): string {
  // `auto` is not a locale, so it falls through to the fallback language; a value
  // that is none of the eight (a row the normaliser never saw) to the default.
  const locale =
    [appearance.language, appearance.fallback_language].find(isWidgetUiLocale) ??
    DEFAULT_WIDGET_APPEARANCE.fallback_language;
  const href = `${origin}/chat.html?organization_id=${encodeURIComponent(organizationId)}`;
  const dir = locale === 'ar' ? ' dir="rtl"' : '';
  return `<noscript><a href="${href}" lang="${locale}"${dir}>${NOSCRIPT_CHAT_LINK[locale]}</a></noscript>`;
}

/**
 * The `window.__siyahtus` fields for the appearance, in the loader's camelCase, and
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
