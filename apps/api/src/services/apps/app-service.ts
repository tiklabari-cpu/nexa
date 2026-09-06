/**
 * Apps marketplace (FR-MOD-09.1 / 09.2).
 *
 * The catalogue of available integrations is static — it lives in @nexa/types
 * (`APP_CATALOG`) so the grid, this service and the tests agree on which apps
 * exist. This service owns only the *connections*: listing the catalogue joined
 * with what a workspace has connected, the (mock) OAuth handshake that connects
 * one, disconnecting, and reading a connected app's data into a conversation.
 *
 * The OAuth flow is mocked (MASTER-PROMPT §5): no real provider is contacted.
 * What is *not* mocked away is the CSRF binding — `start` issues an HMAC-signed
 * `state` and `callback` verifies it, so a tampered or replayed state is refused
 * exactly as a real OAuth client would refuse one. The surfaced in-chat data is
 * a deterministic stub keyed off the customer (`appChatData`), never a live call.
 *
 * There are **two** ways to connect, because the catalogue has two kinds of card
 * and 09.2's acceptance criterion asks for both ("Her biri OAuth/API key"):
 * `provider: 'oauth'` goes through `oauthStart` → `oauthCallback`, and
 * `provider: 'api_key'` goes through {@link AppService.connectWithApiKey}. Each
 * refuses the other's card. That refusal is the point: while both kinds went
 * down the same mock handshake, `provider` changed no behaviour at all and the
 * API-key half of the criterion never reached a user.
 *
 * The pasted key is **hashed, never stored** (`hashToken`, the personal
 * access-token treatment) alongside its last four characters. Reversible
 * storage would be the wrong trade for a mock that never calls the provider
 * back: nothing downstream ever needs the key again, and a hash cannot be
 * leaked by a query, a log line or a backup.
 *
 * Two cards are not mocked at all. Zapier and Make (`isAutomationApp`,
 * FR-MOD-09.4) report what the workspace has genuinely wired up — the count of
 * webhook subscriptions attached to the card and the last one that delivered —
 * because for an automation platform those two numbers *are* the integration.
 * They used to be drawn from a fixed option list like every other card's, which
 * is the finding this closed: a card that looked like it was reporting and was
 * not.
 */
import { Buffer } from 'node:buffer';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  APP_API_KEY_MAX_LENGTH,
  APP_API_KEY_MIN_LENGTH,
  APP_CATALOG,
  NO_AUTOMATION_STATS,
  appApiKeyLastFour,
  appApiKeyProblem,
  appAutomationChatData,
  appChatData,
  filterAppCatalog,
  findApp,
  isAutomationApp,
  isChannelApp,
  maskApiKey,
  paginateApps,
  type AppAutomationStats,
  type AppCatalogEntry,
  type AppCategory,
  type AppChatData,
  type AppListItem,
  type AppOAuthStart,
  type AppProvider,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import { hashToken } from '../../lib/crypto.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { WebhookService } from '../webhooks/webhook-service.js';

/** A start's `state` is good for ten minutes — long enough for a consent, not to replay. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** What the signed `state` carries: the app, the licence, a nonce and an expiry. */
interface StatePayload {
  a: string;
  l: string;
  n: string;
  e: number;
}

interface InstallationRow {
  appId: string;
  externalAccount: string;
  connectedAt: Date;
  apiKeyLastFour: string | null;
}

/** How {@link AppService.list} narrows the catalogue — the query contract, parsed. */
export interface AppListOptions {
  limit: number;
  query?: string;
  category?: AppCategory;
  /** Keyset cursor: the `id` of the last card on the previous page. */
  pageId?: string;
}

/** One page of the catalogue joined with this workspace's connections. */
export interface AppListPage {
  items: AppListItem[];
  /** Matching the current filter, across all pages — not this page's length. */
  total: number;
  nextPageId?: string;
}

/** The catalogue entry for an id, or a 404 — an unknown app cannot be enumerated. */
function requireApp(appId: string): AppCatalogEntry {
  const entry = findApp(appId);
  if (!entry) throw ApiError.notFound('App not found.');
  return entry;
}

/**
 * The catalogue entry for an id that can be connected *here* (09.2). A
 * channel-typed app is managed in Settings → Channels, not the marketplace, so
 * the connect/disconnect paths refuse it — one surface owns a channel's state.
 */
function requireConnectableApp(appId: string): AppCatalogEntry {
  const entry = requireApp(appId);
  if (isChannelApp(entry)) {
    throw ApiError.validation('This integration is a channel — manage it in Settings → Channels.');
  }
  return entry;
}

/**
 * The catalogue entry for an id that connects *this* way (09.2).
 *
 * The channel check runs first and stays first: a channel-typed card is not
 * connectable here at all, whichever provider it names, so `telegram`
 * (`provider: 'api_key'`) has to be turned away by the same sentence as
 * `whatsapp` rather than being let one step further because its provider
 * happens to match the path being called.
 *
 * The message names the other path, because a caller on the wrong one has
 * somewhere to go — and a 400 that only says "no" would leave the two halves of
 * the criterion looking like one broken endpoint.
 */
function requireProvider(appId: string, provider: AppProvider): AppCatalogEntry {
  const entry = requireConnectableApp(appId);
  if (entry.provider !== provider) {
    throw ApiError.validation(
      provider === 'oauth'
        ? 'This app connects with an API key — send it to /settings/apps/{appId}/connect.'
        : 'This app connects with OAuth — start the flow at /settings/apps/{appId}/oauth/start.',
    );
  }
  return entry;
}

/**
 * A catalogue card joined with this workspace's connection, if any.
 *
 * `automation` is the one field that is not derivable from the two arguments'
 * static halves: an automation card carries what the workspace has actually
 * wired up (FR-MOD-09.4), and every other card carries null. A connected
 * automation card with no stats read yet gets {@link NO_AUTOMATION_STATS} — the
 * honest zero — rather than being left null, which would read as "this is not
 * an automation card".
 */
function toListItem(
  entry: AppCatalogEntry,
  row: InstallationRow | null,
  automation?: AppAutomationStats,
): AppListItem {
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    provider: entry.provider,
    icon: entry.icon,
    description: entry.description,
    scopes: [...entry.scopes],
    channel: entry.channel ?? null,
    installed: row !== null,
    installation: row
      ? {
          app_id: entry.id,
          status: 'connected',
          external_account: row.externalAccount,
          scopes: [...entry.scopes],
          connected_at: row.connectedAt.toISOString(),
          api_key_last_four: row.apiKeyLastFour,
          automation: isAutomationApp(entry) ? (automation ?? NO_AUTOMATION_STATS) : null,
        }
      : null,
  };
}

export class AppService {
  readonly #secret: string;
  /**
   * The registry an automation card's two figures are read from (FR-MOD-09.4).
   * Reused rather than re-queried here so there is exactly one definition of
   * what "active zaps" and "last run" mean — the same one the developer
   * portal's subscription list is built from.
   */
  readonly #webhooks = new WebhookService();

  constructor(secret: string) {
    this.#secret = secret;
  }

  /**
   * Live automation figures for whichever of `entries` are automation cards.
   *
   * Returns an empty map when none of them is, which is the overwhelmingly
   * common case: a page of ninety CRM cards costs no extra query at all.
   */
  async #automationStats(
    tx: TenantClient,
    entries: readonly AppCatalogEntry[],
  ): Promise<Map<string, AppAutomationStats>> {
    const appIds = entries.filter(isAutomationApp).map((entry) => entry.id);
    if (appIds.length === 0) return new Map();
    return this.#webhooks.automationStats(tx, appIds);
  }

  /**
   * One page of catalogue cards, each flagged with whether this workspace
   * connected it.
   *
   * Order matters, and it is: narrow the *catalogue* first, then cut the page,
   * and only then join the installations for the ids on that page. The
   * narrowing step is deliberately tenant-independent — which integrations
   * exist is the same for every workspace, so no caller-supplied `query` or
   * `category` ever reaches a tenant-scoped predicate. What stays scoped is the
   * only thing that is per-tenant, the `app_installation` read: still filtered
   * on `tenant.licenseId` under the same RLS transaction, so a page can carry
   * another licence's `installed: true` no more than the unpaginated list could
   * (NFR-S5).
   *
   * Joining after the cut also keeps the read proportional to `limit` rather
   * than to the workspace's whole connection set (NFR-P2).
   */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    options: AppListOptions,
  ): Promise<AppListPage> {
    const matches = filterAppCatalog(APP_CATALOG, {
      ...(options.query !== undefined ? { query: options.query } : {}),
      ...(options.category !== undefined ? { category: options.category } : {}),
    });

    const page = paginateApps(matches, {
      limit: options.limit,
      ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
    });
    // A cursor that names no card in the current result set is a bad request,
    // not an empty page: silently restarting (or returning nothing) would hide
    // a caller pairing last page's cursor with a different filter.
    if (!page) throw ApiError.validation('page_id: unknown cursor.');

    const rows = await tx.appInstallation.findMany({
      where: { licenseId: tenant.licenseId, appId: { in: page.page.map((entry) => entry.id) } },
    });
    const byApp = new Map(rows.map((row) => [row.appId, row]));
    // Only for the automation cards that are actually connected on this page:
    // an unconnected Zapier has nothing wired by definition, and reading the
    // registry for it would be a query whose answer is already known.
    const stats = await this.#automationStats(
      tx,
      page.page.filter((entry) => byApp.has(entry.id)),
    );

    return {
      items: page.page.map((entry) =>
        toListItem(entry, byApp.get(entry.id) ?? null, stats.get(entry.id)),
      ),
      total: page.total,
      ...(page.nextPageId !== undefined ? { nextPageId: page.nextPageId } : {}),
    };
  }

  /**
   * Begin the (mock) OAuth flow. Returns where to send the user and a signed
   * `state` that binds the callback to this app, this licence and this moment.
   * Pure — no write happens until the app is actually connected.
   *
   * Refuses an `api_key` card (09.2): its key is pasted, not granted, so there
   * is no consent screen to send anyone to.
   */
  oauthStart(tenant: TenantContext, appId: string): AppOAuthStart {
    const entry = requireProvider(appId, 'oauth');
    const payload: StatePayload = {
      a: entry.id,
      l: String(tenant.licenseId),
      n: randomUUID(),
      e: Date.now() + STATE_TTL_MS,
    };
    const state = this.#sign(payload);
    const authorizeUrl = `https://apps.nexa.local/oauth/${entry.id}/authorize?state=${encodeURIComponent(state)}`;
    return { authorize_url: authorizeUrl, state };
  }

  /**
   * Complete the flow: verify the `state` came from a `start` for this app and
   * licence and has not expired, then record the connection. Idempotent — a
   * second callback re-connects rather than erroring, so a retried consent is
   * safe.
   *
   * Refuses an `api_key` card before it looks at the state, so a state minted
   * for one is worth nothing even if `start` ever stopped refusing them.
   */
  async oauthCallback(
    tx: TenantClient,
    tenant: TenantContext,
    appId: string,
    input: { state: string; code: string },
  ): Promise<AppListItem> {
    const entry = requireProvider(appId, 'oauth');

    const payload = this.#verify(input.state);
    if (!payload || payload.a !== entry.id || payload.l !== String(tenant.licenseId)) {
      throw ApiError.validation('Invalid or mismatched OAuth state.');
    }
    if (payload.e < Date.now()) {
      throw ApiError.validation('The authorization expired — start the connection again.');
    }
    if (!input.code.trim()) {
      throw ApiError.validation('Missing authorization code.');
    }

    // The account label a real grant would return, stood in for deterministically.
    const externalAccount = `nexa+${tenant.licenseId}@${entry.id}.example`;
    const row = await tx.appInstallation.upsert({
      where: { licenseId_appId: { licenseId: tenant.licenseId, appId: entry.id } },
      update: { status: 'connected', externalAccount },
      create: {
        licenseId: tenant.licenseId,
        appId: entry.id,
        status: 'connected',
        externalAccount,
      },
    });
    // Read rather than assumed zero: re-connecting a card whose subscriptions
    // are still in place must not report it as having none.
    return toListItem(entry, row, (await this.#automationStats(tx, [entry])).get(entry.id));
  }

  /**
   * Connect an `api_key` card with the key an admin pasted (09.2 KK "Her biri
   * OAuth/API key").
   *
   * Three things are deliberate here:
   *
   *   * **Only the hash is written.** `hashToken` is the same one-way digest a
   *     personal access token gets. The service never needs the key again — the
   *     integration is mocked, so nothing calls the provider — which makes
   *     "cannot be read back" a free property rather than a cost.
   *   * **The clear key never leaves this method.** It is not returned, not put
   *     on the installation row, and not carried into the audit entry; what the
   *     card shows is `••••` plus four characters, derived here.
   *   * **Re-connecting replaces the key.** The upsert makes rotating a key the
   *     same call as connecting, and a retried submit harmless.
   */
  async connectWithApiKey(
    tx: TenantClient,
    tenant: TenantContext,
    appId: string,
    input: { apiKey: string },
  ): Promise<AppListItem> {
    const entry = requireProvider(appId, 'api_key');

    const apiKey = input.apiKey.trim();
    // Restated rather than trusted from the route: the shared rule is the one
    // the form validates against too, so a caller that skips the console cannot
    // store something the console would have refused.
    const problem = appApiKeyProblem(apiKey);
    if (problem) {
      throw ApiError.validation(
        problem === 'required'
          ? 'api_key: an API key is required.'
          : `api_key: must be between ${APP_API_KEY_MIN_LENGTH} and ${APP_API_KEY_MAX_LENGTH} characters.`,
      );
    }

    const lastFour = appApiKeyLastFour(apiKey);
    const row = await tx.appInstallation.upsert({
      where: { licenseId_appId: { licenseId: tenant.licenseId, appId: entry.id } },
      update: {
        status: 'connected',
        // A pasted key names no account, so the label says which key is stored.
        externalAccount: maskApiKey(apiKey),
        apiKeyHash: hashToken(apiKey),
        apiKeyLastFour: lastFour,
      },
      create: {
        licenseId: tenant.licenseId,
        appId: entry.id,
        status: 'connected',
        externalAccount: maskApiKey(apiKey),
        apiKeyHash: hashToken(apiKey),
        apiKeyLastFour: lastFour,
      },
    });
    // Same reason as the OAuth path: rotating Make's key leaves its scenarios
    // wired, so the card has to keep saying so.
    return toListItem(entry, row, (await this.#automationStats(tx, [entry])).get(entry.id));
  }

  /**
   * Disconnect an app. Returns the number of rows removed — 0 means not connected.
   *
   * For an automation card this also removes its subscriptions (FR-MOD-09.4),
   * in the same transaction. That is what makes the negative gate a property
   * rather than a promise: after a disconnect there is no row left for the
   * dispatcher to find, so the workspace event that used to reach the zap
   * reaches nothing at all — and a later reconnect cannot silently resurrect a
   * target the admin last saw months ago.
   */
  async disconnect(tx: TenantClient, tenant: TenantContext, appId: string): Promise<number> {
    const entry = requireConnectableApp(appId);
    const { count } = await tx.appInstallation.deleteMany({
      where: { licenseId: tenant.licenseId, appId },
    });
    if (count > 0 && isAutomationApp(entry)) {
      await this.#webhooks.unregisterForApp(tx, entry.id);
    }
    return count;
  }

  /**
   * A conversation's connected-app data (KK "bağlanınca veri sohbet içinde"):
   * for each connected app, the (mock) data it exposes about this chat's
   * customer, keyed off the customer's identity so it is stable per person.
   */
  async chatData(tx: TenantClient, tenant: TenantContext, chatId: string): Promise<AppChatData[]> {
    const chat = await tx.chat.findFirst({
      where: { id: chatId, licenseId: tenant.licenseId },
      select: { customer: { select: { id: true, email: true } } },
    });
    // Absent here is indistinguishable from another tenant's chat — 404 either
    // way, so a chat id cannot be probed across tenants (NFR-S5).
    if (!chat) throw ApiError.notFound('Chat not found.');

    const installed = await tx.appInstallation.findMany({ where: { licenseId: tenant.licenseId } });
    const seed = chat.customer.email ?? chat.customer.id;
    const entries = installed
      .map((row) => findApp(row.appId))
      // Only data apps surface in-chat; channel apps never reach here (they are
      // not connectable in the marketplace), but keep the filter explicit.
      .filter((entry): entry is AppCatalogEntry => entry !== undefined && !isChannelApp(entry));

    // An automation card is not a data source about this customer, so its two
    // figures come from the workspace's own registry (FR-MOD-09.4) and never
    // from the deterministic customer stub. Routing one through `appChatData`
    // is exactly the defect this closed — it used to answer with a plausible
    // number drawn from a fixed list.
    const stats = await this.#automationStats(tx, entries);
    return entries.map((entry) =>
      isAutomationApp(entry)
        ? appAutomationChatData(entry, stats.get(entry.id) ?? NO_AUTOMATION_STATS)
        : appChatData(entry, seed),
    );
  }

  // --- OAuth state signing ---------------------------------------------------

  #sign(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = this.#mac(body);
    return `${body}.${mac}`;
  }

  #verify(state: string): StatePayload | null {
    const dot = state.indexOf('.');
    if (dot <= 0) return null;
    const body = state.slice(0, dot);
    const mac = state.slice(dot + 1);

    const expected = this.#mac(body);
    const provided = Buffer.from(mac);
    const wanted = Buffer.from(expected);
    // Constant-time compare, so a forged state cannot be tuned a byte at a time.
    if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null;

    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    } catch {
      return null;
    }
  }

  #mac(body: string): string {
    return createHmac('sha256', this.#secret).update(`apps:oauth:${body}`).digest('base64url');
  }
}
