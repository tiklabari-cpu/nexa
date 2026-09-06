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
 */
import { Buffer } from 'node:buffer';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  APP_API_KEY_MAX_LENGTH,
  APP_API_KEY_MIN_LENGTH,
  APP_CATALOG,
  appApiKeyLastFour,
  appApiKeyProblem,
  appChatData,
  filterAppCatalog,
  findApp,
  isChannelApp,
  maskApiKey,
  paginateApps,
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

/** A catalogue card joined with this workspace's connection, if any. */
function toListItem(entry: AppCatalogEntry, row: InstallationRow | null): AppListItem {
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
        }
      : null,
  };
}

export class AppService {
  readonly #secret: string;

  constructor(secret: string) {
    this.#secret = secret;
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

    return {
      items: page.page.map((entry) => toListItem(entry, byApp.get(entry.id) ?? null)),
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
    return toListItem(entry, row);
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
    return toListItem(entry, row);
  }

  /** Disconnect an app. Returns the number of rows removed — 0 means not connected. */
  async disconnect(tx: TenantClient, tenant: TenantContext, appId: string): Promise<number> {
    requireConnectableApp(appId);
    const { count } = await tx.appInstallation.deleteMany({
      where: { licenseId: tenant.licenseId, appId },
    });
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
    return (
      installed
        .map((row) => findApp(row.appId))
        // Only data apps surface in-chat; channel apps never reach here (they are
        // not connectable in the marketplace), but keep the filter explicit.
        .filter((entry): entry is AppCatalogEntry => entry !== undefined && !isChannelApp(entry))
        .map((entry) => appChatData(entry, seed))
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
