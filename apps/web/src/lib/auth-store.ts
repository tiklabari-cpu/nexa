/**
 * Session state.
 *
 * The access token lives in memory, not localStorage: anything in localStorage
 * is readable by any script that ends up on the page, and an access token is
 * the one credential worth protecting that hard. The refresh token is stored
 * so a page reload does not force a re-login, and it rotates on every use — a
 * stolen one is detectable and revokes its whole family server-side.
 *
 * The access token lives an hour at most (`ACCESS_TOKEN_TTL`), so an open
 * panel renews it (tm 259.1, `docs/adr/agent-session-refresh.md`): ahead of
 * time on a timer, at once when a tab comes back from sleep past that moment,
 * and on the first request the server refuses. Every renewal — and the restore
 * a page load does — goes through {@link AuthState.refreshSession}, the one
 * place that spends the refresh token.
 */
import { create } from 'zustand';
import { readNotificationPreferences, type NotificationPreferences } from '@siyahtus/types';
import { ApiClient, ApiClientError } from './api-client.js';
import { savePrefs } from '../features/notifications/notifications.js';

export interface Membership {
  license_id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  license_status: string;
  /** The workspace's OAuth client, from the server rather than guessed. */
  client_id?: string | null;
  /**
   * The SAML connection that has closed this workspace's password door, or null
   * while passwords still work (NFR-S11 · S11-h).
   */
  sso_enforced_connection_id?: string | null;
  /**
   * Whether `/auth/authorize` will still accept a password here. Server-derived
   * — the break-glass rule (owners keep a password door so a broken identity
   * provider is not terminal) lives there, and a copy of it in the UI is a copy
   * that goes stale. Absent on an older server: treat as available, which is
   * what it was before enforcement existed.
   */
  password_login_available?: boolean;
}

export interface CurrentAgent {
  account_id: string;
  email: string | null;
  name: string | null;
  role: string;
  organization_id: string;
  license_id: string;
  scopes: string[];
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
  /**
   * Every channel this agent can be reached through (FR-MOD-13.8), per user and
   * per license. All five live on the account since 13.7-c — sound, desktop and
   * the tab badge moved off `localStorage` when push arrived, because the server
   * picks the handset and cannot read a browser's opinion. Absent from an older
   * server's profile, which `readNotificationPreferences` reads as the defaults.
   */
  notification_preferences?: NotificationPreferences;
  /** First-run setup gate (FR-MOD-00.4). Absent on older tokens — treat as done. */
  onboarding_completed?: boolean;
  /**
   * What the workspace may do right now, for every role (tm 257.15) — the
   * public pilot's trial strip reads it here, because `/billing/subscription`
   * is behind a billing scope an agent does not carry. Read once with the
   * profile; absent from an older server, which the strip reads as "say
   * nothing".
   */
  license?: {
    access: 'trialing' | 'active' | 'read_only';
    trial_ends_at: string | null;
  };
}

/** What `POST /auth/2fa/enroll` hands back — the authenticator app's half. */
export interface TwoFactorEnrollment {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account_name: string;
}

export type WorkspaceList = Membership[] & { emailVerified?: boolean };

interface AuthState {
  accessToken: string | null;
  agent: CurrentAgent | null;
  status: 'unknown' | 'signed-out' | 'signed-in';
  error: string | null;
  busy: boolean;
  /**
   * The server ended a session this tab was in the middle of — it refused to
   * renew it, or refused a token minted a moment ago (tm 259.1). The sign-in
   * page says so; without it the agent would read the form as a glitch. Never
   * set by a sign-out, nor by a page load that finds a dead token.
   */
  sessionEnded: boolean;

  restore: () => Promise<void>;
  /**
   * Spend the stored refresh token for a new access token — the only place
   * that does, for the restore, the timer and every refused request alike.
   *
   * `stale` is the access token the caller found wanting (refused by the
   * server, or due for renewal). When the session has already moved past it —
   * an earlier caller in this tab, or a sibling tab whose renewal arrived over
   * the channel — the newer token comes back and nothing is spent.
   *
   * Resolves with the token to use, or `null` when the session is over (it has
   * then already been signed out, and `sessionEnded` set if it was live).
   * Rejects with the `ApiClientError` when the renewal failed for a reason that
   * says nothing about the session — the network, a 5xx, a 429 — leaving the
   * stored token and the session untouched; tm 259.2 widens that branch.
   */
  refreshSession: (stale?: string) => Promise<string | null>;
  /**
   * A request repeated with a just-renewed `token` was refused as well: the
   * membership or the workspace behind the session is gone. Ends the session
   * if `token` is still the one in use.
   */
  rejectSession: (token: string) => void;
  /**
   * The workspaces these credentials open. `emailVerified` is `false` only when
   * the server says the account has not confirmed its address (tm 257.7) —
   * absent on an older server, and read as "verified" then. It rides on the list
   * rather than changing the return type, so a caller that only wants the
   * workspaces is untouched.
   */
  listWorkspaces: (email: string, password: string) => Promise<WorkspaceList>;
  /**
   * `code` is the second factor (NFR-S11 · S11-2FA-g) — a TOTP digit string or a
   * recovery sheet entry, the server tells the two apart. Omitted rather than
   * sent empty on a first attempt, so the server reads "no code offered yet"
   * and answers with its protocol prompt (`two_factor_required`, no code error)
   * instead of a wrong-code refusal.
   */
  signIn: (email: string, password: string, licenseId: string, code?: string) => Promise<void>;
  /**
   * The two calls an enrollment ticket can make (NFR-S11 · S11-2FA-k).
   *
   * They live here rather than on `useApiClient()` because that client sends
   * the *session's* bearer token, and the whole point of this pair is that
   * there is no session — the ticket arrives inside the `two_factor_required`
   * refusal `signIn` threw, and is the only credential the caller holds.
   * `anonymous` is the client that sends none, so the header passed here is
   * the one that reaches the server.
   */
  enrollWithTicket: (ticket: string) => Promise<TwoFactorEnrollment>;
  activateWithTicket: (ticket: string, code: string) => Promise<string[]>;
  /**
   * Hand the browser to the workspace's identity provider (NFR-S11 · S11-i).
   *
   * Never returns on the happy path — it navigates away. `clientId` may be
   * omitted when the caller does not know it (an IdP-initiated arrival holds
   * only a connection id); it is then read from `GET /auth/sso/{id}`.
   */
  startSsoLogin: (connectionId: string, clientId?: string | null) => Promise<void>;
  /** Finish the leg above from `/auth/callback` — see {@link SSO_PENDING_KEY}. */
  completeSsoLogin: (code: string, state: string | null) => Promise<void>;
  signOut: () => Promise<void>;
  setRoutingStatus: (status: CurrentAgent['routing_status']) => Promise<void>;
  /**
   * Change one or more notification channels for the caller (FR-MOD-13.8).
   * Partial: send what moved. The server answers with the complete set, which
   * becomes both the store's value and the synchronous cache the inbox reads.
   */
  setNotificationPreferences: (patch: Partial<NotificationPreferences>) => Promise<void>;
  /** Flip the local gate once the wizard has told the server setup is done. */
  markOnboarded: () => void;
}

const REFRESH_KEY = 'siyahtus.refresh_token';
const CLIENT_ID_KEY = 'siyahtus.client_id';
const BRAND_KEY = 'siyahtus.brand_id';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

/** The Web Lock every tab of this browser holds while it spends the stored refresh token. */
const REFRESH_LOCK = 'siyahtus.refresh';
/** Where a tab tells its siblings about the access token it has just been given. */
const SESSION_CHANNEL = 'siyahtus.session';
/** Renew once this share of the access token's remaining life has gone… */
const RENEW_AT = 0.8;
/** …brought forward by up to this share, at random, so the tabs of one browser rarely wake together. */
const RENEW_SPREAD = 0.1;

/** What `POST /auth/token` answers, for both grants. */
interface TokenGrant {
  access_token: string;
  refresh_token: string;
  /** Seconds the access token lives from the moment it was minted. */
  expires_in?: number;
  account_id?: string;
  license_id?: string;
}

/** What a tab posts on {@link SESSION_CHANNEL} once it holds a new access token. */
interface SiblingToken {
  kind: 'siyahtus.access_token';
  accessToken: string;
  /** Wall-clock milliseconds. One machine, one clock: the tabs can compare these. */
  expiresAt: number;
  accountId: string;
  licenseId: string;
}

function isSiblingToken(value: unknown): value is SiblingToken {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<SiblingToken>;
  return (
    message.kind === 'siyahtus.access_token' &&
    typeof message.accessToken === 'string' &&
    typeof message.expiresAt === 'number' &&
    typeof message.accountId === 'string' &&
    typeof message.licenseId === 'string'
  );
}

/**
 * Run `task` holding the refresh lock of this whole browser profile.
 *
 * The stored refresh token is single-use, and every tab reads the same copy of
 * it. Two tabs spending it at once is a replayed token as far as the server
 * can tell, and its answer is to revoke the family — both tabs signed out at
 * once. A Web Lock is the one primitive all tabs share: the second tab waits,
 * then reads the token the first one stored. The lock is released when the
 * task settles or the tab goes away, so a closed tab cannot strand the others.
 *
 * Without Web Locks — an insecure origin, or a browser older than 2022 — tabs
 * are not coordinated and the race is back; each tab still never overlaps with
 * itself (`refreshSession`'s single flight).
 */
async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks: LockManager | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return task();
  // Held until `task` settles; `request` then resolves with what it resolved with.
  return await locks.request(REFRESH_LOCK, task);
}

/**
 * Where a federated sign-in parks the half of itself that must survive leaving
 * the page (NFR-S11 · S11-i).
 *
 * `sessionStorage`, not `localStorage`: this is one tab's in-flight login, and
 * it must not be readable by a second tab starting its own, nor outlive the tab
 * that began it. The PKCE verifier inside is the reason the exchange is safe —
 * it stays with the browser that started the login, so a code intercepted
 * anywhere along the way (a proxy log, a shared machine) cannot be redeemed.
 * Storing it at all is unavoidable: the browser leaves for the identity
 * provider and comes back to a fresh page with no memory.
 */
const SSO_PENDING_KEY = 'siyahtus.sso_login';

interface PendingSsoLogin {
  verifier: string;
  clientId: string;
  /** Echoed back by the server untouched; a callback that does not match is not ours. */
  state: string;
}

/** PKCE verifier: 43–128 unreserved characters (RFC 7636 §4.1). */
function createVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function deriveChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked — the session simply will not survive a reload.
  }
}

/** Same round-trip as {@link readStored}, against the per-tab store. */
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked — a federated sign-in cannot complete, and says so at the
    // callback rather than silently half-working.
  }
}

/** Read the persisted brand selection without React — mirrors `detectLocale`. */
export function readBrandId(): string | null {
  return readStored(BRAND_KEY);
}

interface BrandState {
  brandId: string | null;
  setBrandId: (id: string | null) => void;
}

/**
 * The selected brand for a multi-brand license (PRD §5.3-Marka), persisted the
 * same way as the locale preference (`lib/i18n.ts`): a plain localStorage
 * round-trip. `null` means license-wide — the switcher clears back to this
 * when a license has one brand, or when the remembered id no longer matches
 * any brand the license has (deleted since the last visit).
 */
export const useBrandStore = create<BrandState>((set) => ({
  brandId: readBrandId(),
  setBrandId: (id) => {
    writeStored(BRAND_KEY, id);
    set({ brandId: id });
  },
}));

/** `{ brandId, setBrandId }` for the brand switcher. */
export function useBrand(): { brandId: string | null; setBrandId: (id: string | null) => void } {
  const brandId = useBrandStore((s) => s.brandId);
  const setBrandId = useBrandStore((s) => s.setBrandId);
  return { brandId, setBrandId };
}

export const useAuth = create<AuthState>((set, get) => {
  // A client with no token, for the endpoints that take none.
  const anonymous = new ApiClient();

  /**
   * The restore in flight, or null.
   *
   * A refresh token is single-use: the server rotates it and treats a second
   * presentation as a stolen credential, revoking the whole family — including
   * the access token the *successful* rotation has just minted. So two
   * overlapping restores do not merely spend a wasted round trip, they end the
   * session, and the agent lands back on the sign-in form.
   *
   * They do overlap. `App` restores from an effect, StrictMode mounts every
   * effect twice in development, and neither call sets a status the other could
   * see until its round trip is over — measured in a real browser, a signed-in
   * reload sent two `POST /auth/token` carrying the same token. Both answered
   * 200 only because neither rotation had committed when the other read;
   * widening that gap (a loaded machine, a long test run) makes the second one
   * reuse detection instead. The same single-use hazard is already guarded at
   * the other exchange, in `AuthCallbackPage`.
   *
   * Single-flight rather than once-only: a later restore — a sign-out and back,
   * a second session in the same tab — must still be able to refresh.
   *
   * Two tabs share `localStorage` and each has its own copy of this module, so
   * this cannot see them. `withRefreshLock` is the half that can (tm 259.1).
   */
  let restoring: Promise<void> | null = null;

  /**
   * The renewal in flight in this tab, or null — shared by every caller that
   * arrives while it runs: the restore, the timer, a burst of refused requests.
   * Each presenting the stored token on its own is the replay `restoring`
   * describes, and the server answers it by revoking the family.
   */
  let refreshing: Promise<string | null> | null = null;

  /**
   * Bumped whenever this tab's session ends. A renewal that was already on its
   * way when the agent signed out must not bring the session back — nor store
   * a successor token the sign-out has just cleared.
   */
  let generation = 0;

  // --- Keeping the access token fresh (tm 259.1) ---------------------------
  //
  // None of this lives in React. An effect's lifetime is a component's, not
  // the session's, and StrictMode starts every effect twice; a renewal timer
  // started twice is two renewals racing for one token. It starts when a token
  // is accepted and stops when the session ends.

  /** Wall-clock milliseconds at which the access token in hand stops working. */
  let expiresAt: number | null = null;
  /** Wall-clock milliseconds at which it is due for renewal. */
  let renewDueAt: number | null = null;
  let renewTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: BroadcastChannel | null = null;
  let keeping = false;

  function startKeeping(): void {
    if (keeping) return;
    keeping = true;
    document.addEventListener('visibilitychange', renewIfOverdue);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(SESSION_CHANNEL);
      channel.onmessage = (event: MessageEvent) => adoptSiblingToken(event.data);
    }
  }

  function stopKeeping(): void {
    if (renewTimer !== null) clearTimeout(renewTimer);
    renewTimer = null;
    renewDueAt = null;
    expiresAt = null;
    if (!keeping) return;
    keeping = false;
    document.removeEventListener('visibilitychange', renewIfOverdue);
    channel?.close();
    channel = null;
  }

  /**
   * Arm the renewal of the token in hand: `RENEW_AT` of what is left of its
   * life, brought forward by up to `RENEW_SPREAD`. The spread is for siblings:
   * a tab that took its token from another wakes at a different moment, finds
   * the other tab's renewal already arrived, and spends nothing.
   */
  function scheduleRenewal(): void {
    if (renewTimer !== null) clearTimeout(renewTimer);
    renewTimer = null;
    renewDueAt = null;
    const token = get().accessToken;
    if (expiresAt === null || token === null) return;

    const share = RENEW_AT - RENEW_SPREAD * Math.random();
    const delay = Math.max(0, (expiresAt - Date.now()) * share);
    renewDueAt = Date.now() + delay;
    renewTimer = setTimeout(() => {
      renewTimer = null;
      void renewQuietly(token);
    }, delay);
  }

  /**
   * Back from sleep. Timers do not run while a laptop is closed, and some
   * browsers do not count the closed hours towards a pending timer at all — but
   * the wall clock moved on, and coming back to the tab is when that shows.
   */
  function renewIfOverdue(): void {
    if (document.visibilityState !== 'visible') return;
    const { status, accessToken } = get();
    if (status !== 'signed-in' || accessToken === null) return;
    if (renewDueAt === null || Date.now() < renewDueAt) return;
    void renewQuietly(accessToken);
  }

  /**
   * A renewal nobody is waiting on. A failure costs nothing yet — the token
   * still has a fifth of its life, and the first request refused after that
   * renews on its own (`sessionClient`). How to wait out a 429, a 5xx or a dead
   * network before trying again is tm 259.2's to decide.
   */
  async function renewQuietly(stale: string): Promise<void> {
    try {
      await get().refreshSession(stale);
    } catch {
      // See above: the next refused request tries again.
    }
  }

  /**
   * Take the access token a sibling tab was just given, if it is for this same
   * person and workspace and outlives the one in hand. Then this tab's own
   * renewal, when it comes, finds itself behind and spends nothing.
   */
  function adoptSiblingToken(message: unknown): void {
    if (!isSiblingToken(message)) return;
    const { status, agent, accessToken } = get();
    if (status !== 'signed-in' || agent === null || accessToken === null) return;
    // A sibling signed in as somebody else holds a token this tab must never
    // act with — every request would land in another person's workspace.
    if (message.accountId !== agent.account_id || message.licenseId !== agent.license_id) return;
    if (expiresAt !== null && message.expiresAt <= expiresAt) return;

    expiresAt = message.expiresAt;
    set({ accessToken: message.accessToken });
    scheduleRenewal();
  }

  /** Hold `grant`'s access token: set it, arm its renewal, tell the sibling tabs. */
  function acceptGrant(grant: TokenGrant): void {
    startKeeping();
    expiresAt =
      typeof grant.expires_in === 'number' && grant.expires_in > 0
        ? Date.now() + grant.expires_in * 1000
        : null;
    set({ accessToken: grant.access_token });
    scheduleRenewal();

    if (expiresAt === null || grant.account_id === undefined || grant.license_id === undefined) {
      return;
    }
    // Same origin, same browser profile: a script that could read this could
    // already read the refresh token in `localStorage`, which is worth more.
    const message: SiblingToken = {
      kind: 'siyahtus.access_token',
      accessToken: grant.access_token,
      expiresAt,
      accountId: grant.account_id,
      licenseId: grant.license_id,
    };
    channel?.postMessage(message);
  }

  /** Forget the session in this tab. Nothing is sent; the stored token is the caller's call. */
  function forgetSession(sessionEnded: boolean): void {
    generation += 1;
    stopKeeping();
    set({ accessToken: null, agent: null, status: 'signed-out', sessionEnded });
  }

  /** The server ended the session: forget it, and if it was live, say so on the sign-in page. */
  function endSession(): void {
    forgetSession(get().status === 'signed-in');
  }

  /** The body of {@link AuthState.refreshSession}, run holding the refresh lock. */
  async function rotate(stale: string | undefined): Promise<string | null> {
    // Getting the lock meant waiting for whoever held it. If that was this
    // tab's earlier renewal, or a sibling's that has since arrived over the
    // channel, the token asked about is already behind us.
    const current = get().accessToken;
    if (stale !== undefined) {
      if (current === null) return null;
      if (current !== stale) return current;
    }

    const refreshToken = readStored(REFRESH_KEY);
    const clientId = readStored(CLIENT_ID_KEY);
    if (!refreshToken || !clientId) {
      // Signed out in another tab: there is nothing left to spend.
      endSession();
      return null;
    }

    const started = generation;
    let grant: TokenGrant;
    try {
      grant = await anonymous.post<TokenGrant>('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });
    } catch (error) {
      if (generation !== started) return null;
      if (error instanceof ApiClientError && error.isRetryable) throw error;
      // Refused: the family was revoked (signed out elsewhere, or a replay) or
      // the token expired. Forget it — unless a sign-in in another tab has
      // stored a different one meanwhile, which is that tab's to keep.
      if (readStored(REFRESH_KEY) === refreshToken) writeStored(REFRESH_KEY, null);
      endSession();
      return null;
    }
    if (generation !== started) return null;

    // Stored before anything else: the server has already spent the token we
    // presented, and every other tab reads this copy next.
    writeStored(REFRESH_KEY, grant.refresh_token);

    const { agent } = get();
    if (agent !== null && !sameSession(agent, grant)) {
      // The stored token was another sign-in's — a second tab signed in as
      // somebody else, and a browser keeps one. Its successor is stored for
      // that tab now; what it bought is not this tab's to act with.
      endSession();
      return null;
    }

    acceptGrant(grant);
    return grant.access_token;
  }

  async function loadAgent(accessToken: string): Promise<CurrentAgent> {
    const client = new ApiClient({ getAccessToken: () => accessToken });
    const agent = await client.get<CurrentAgent>('/auth/me');
    // Prime the synchronous cache the inbox's alerting decision reads. It runs
    // inside a realtime push handler that cannot await a fetch, so the profile
    // request the app already makes on every sign-in and restore is where the
    // value has to arrive.
    cachePreferences(agent.notification_preferences);
    return agent;
  }

  /** The body of {@link AuthState.restore}, wrapped by the single-flight above. */
  async function runRestore(): Promise<void> {
    if (!readStored(REFRESH_KEY) || !readStored(CLIENT_ID_KEY)) {
      set({ status: 'signed-out' });
      return;
    }

    try {
      const accessToken = await get().refreshSession();
      // Refused: `refreshSession` has already forgotten the token and signed out.
      if (accessToken === null) return;
      set({ agent: await loadAgent(accessToken), status: 'signed-in', sessionEnded: false });
    } catch {
      // Anything else — until tm 259.2 tells a passing failure from a final
      // one — starts clean rather than looping.
      writeStored(REFRESH_KEY, null);
      forgetSession(false);
    }
  }

  /** Mirror the server's answer into `localStorage` for `loadPrefs`. */
  function cachePreferences(prefs: NotificationPreferences | undefined): NotificationPreferences {
    const resolved = readNotificationPreferences(prefs);
    savePrefs(resolved);
    return resolved;
  }

  return {
    accessToken: null,
    agent: null,
    status: 'unknown',
    error: null,
    busy: false,
    sessionEnded: false,

    restore() {
      // See `restoring` above: overlapping callers share one rotation instead
      // of each spending the same token.
      restoring ??= runRestore().finally(() => {
        restoring = null;
      });
      return restoring;
    },

    refreshSession(stale) {
      // Already past `stale`: no lock, no round trip.
      const current = get().accessToken;
      if (stale !== undefined && current !== null && current !== stale) {
        return Promise.resolve(current);
      }
      refreshing ??= withRefreshLock(() => rotate(stale)).finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    rejectSession(token) {
      // A newer token has arrived since: the refusal was about the old one.
      if (get().accessToken !== token) return;
      endSession();
    },

    async listWorkspaces(email, password) {
      set({ busy: true, error: null });
      try {
        const result = await anonymous.post<{
          memberships: Membership[];
          account?: { email_verified?: boolean };
        }>('/auth/login', { email, password });
        return Object.assign(result.memberships, {
          emailVerified: result.account?.email_verified,
        });
      } finally {
        set({ busy: false });
      }
    },

    async signIn(email, password, licenseId, code) {
      set({ busy: true, error: null });
      try {
        // The client id is per-organization, and the workspace list is what
        // tells us which organization this is.
        const memberships = await anonymous
          .post<{ memberships: Membership[] }>('/auth/login', { email, password })
          .then((r) => r.memberships);
        const membership = memberships.find((m) => m.license_id === licenseId);
        if (!membership) throw new Error('Workspace not found.');

        // The server tells us which client to use. Deriving it from the
        // organisation name used to work only because the seed named clients to
        // match: a workspace created through signup had no such client, and two
        // organisations sharing a first word would have collided.
        const clientId =
          membership.client_id ?? `siyahtus-agent-app-${slugOf(membership.organization_name)}`;
        const verifier = createVerifier();
        const challenge = await deriveChallenge(verifier);

        const authorized = await anonymous.post<{ code: string }>('/auth/authorize', {
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          email,
          password,
          license_id: licenseId,
          // `undefined` drops the key entirely (JSON.stringify) rather than
          // sending an empty string — see the field's doc comment above.
          code,
        });

        const grant = await anonymous.post<TokenGrant>('/auth/token', {
          grant_type: 'authorization_code',
          code: authorized.code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
        });

        writeStored(REFRESH_KEY, grant.refresh_token);
        writeStored(CLIENT_ID_KEY, clientId);

        const agent = await loadAgent(grant.access_token);
        acceptGrant(grant);
        set({ agent, status: 'signed-in', error: null, sessionEnded: false });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Sign-in failed.' });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    enrollWithTicket(ticket) {
      return anonymous.post<TwoFactorEnrollment>('/auth/2fa/enroll', undefined, {
        headers: { Authorization: `Bearer ${ticket}` },
      });
    },

    async activateWithTicket(ticket, code) {
      const result = await anonymous.post<{ recovery_codes: string[] }>(
        '/auth/2fa/activate',
        { code },
        { headers: { Authorization: `Bearer ${ticket}` } },
      );
      return result.recovery_codes;
    },

    async startSsoLogin(connectionId, clientId) {
      set({ busy: true, error: null });
      try {
        // An IdP-initiated arrival knows the connection and nothing else. The
        // password path already holds the client id from `/auth/login`, so it
        // passes it and spends no extra round trip.
        const resolved =
          clientId ??
          (
            await anonymous.get<{ client_id: string | null }>(
              `/auth/sso/${encodeURIComponent(connectionId)}`,
            )
          ).client_id;
        if (!resolved) throw new Error('This workspace has no app to sign in to.');

        const verifier = createVerifier();
        const pending: PendingSsoLogin = {
          verifier,
          clientId: resolved,
          state: createVerifier(),
        };
        // Written before navigating, not after: once `assign` runs this page is
        // gone, and a verifier saved "on the way out" would not exist.
        writeSession(SSO_PENDING_KEY, JSON.stringify(pending));

        const query = new URLSearchParams({
          client_id: resolved,
          redirect_uri: REDIRECT_URI,
          code_challenge: await deriveChallenge(verifier),
          code_challenge_method: 'S256',
          state: pending.state,
        });
        // A full navigation, not fetch: the identity provider needs the browser
        // itself — its session cookie there is what makes the second leg silent.
        window.location.assign(
          `/api/v1/auth/saml/${encodeURIComponent(connectionId)}/login?${query.toString()}`,
        );
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Could not start single sign-on.' });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    async completeSsoLogin(code, state) {
      set({ busy: true, error: null });
      try {
        const raw = readSession(SSO_PENDING_KEY);
        // Spent on sight, whatever happens next. A verifier that survives its
        // own callback is one a second visit to this URL could try to reuse.
        writeSession(SSO_PENDING_KEY, null);
        if (!raw) throw new Error('This sign-in did not start in this browser.');

        const pending = JSON.parse(raw) as PendingSsoLogin;
        // The state is ours and the server returns it untouched, so a callback
        // carrying somebody else's — or none — is not the login we started.
        if (!pending.state || pending.state !== state) {
          throw new Error('This sign-in did not start in this browser.');
        }

        const grant = await anonymous.post<TokenGrant>('/auth/token', {
          grant_type: 'authorization_code',
          code,
          code_verifier: pending.verifier,
          client_id: pending.clientId,
          redirect_uri: REDIRECT_URI,
        });

        writeStored(REFRESH_KEY, grant.refresh_token);
        writeStored(CLIENT_ID_KEY, pending.clientId);
        const agent = await loadAgent(grant.access_token);
        acceptGrant(grant);
        set({ agent, status: 'signed-in', error: null, sessionEnded: false });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Sign-in failed.' });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    async signOut() {
      const refreshToken = readStored(REFRESH_KEY);
      const { accessToken } = get();
      // No renewal may fire — or land — while the tokens are being revoked.
      generation += 1;
      stopKeeping();

      // Revoke both, and do not let a failure strand the user in a signed-in
      // shell they cannot use.
      await Promise.allSettled([
        accessToken ? anonymous.post('/auth/revoke', { token: accessToken }) : null,
        refreshToken ? anonymous.post('/auth/revoke', { token: refreshToken }) : null,
      ]);

      writeStored(REFRESH_KEY, null);
      forgetSession(false);
    },

    async setRoutingStatus(status) {
      const { accessToken, agent } = get();
      if (!accessToken || !agent) return;

      await sessionClient().request('PUT', '/agents/me/routing-status', { routing_status: status });
      const current = get().agent;
      if (current) set({ agent: { ...current, routing_status: status } });
    },

    async setNotificationPreferences(patch) {
      const { accessToken, agent } = get();
      if (!accessToken || !agent) return;

      // Optimistic: reflect the toggle immediately, then roll back if the write
      // fails so the switch never lies about the server state. The cache moves
      // with it in both directions — a rolled-back toggle that left the cache
      // flipped would go on silencing the inbox for a preference the account
      // does not hold.
      const previous = readNotificationPreferences(agent.notification_preferences);
      const optimistic = { ...previous, ...patch };
      set({ agent: { ...agent, notification_preferences: optimistic } });
      savePrefs(optimistic);
      try {
        const confirmed = await sessionClient().request<NotificationPreferences>(
          'PUT',
          '/agents/me/notification-preferences',
          patch,
        );
        // The server's answer, not the guess: it carries every channel, so a
        // change made in another tab arrives here too.
        const resolved = cachePreferences(confirmed);
        const current = get().agent;
        if (current) set({ agent: { ...current, notification_preferences: resolved } });
      } catch (error) {
        // The session may have ended under the write (a refused renewal); then
        // there is no agent left to roll back.
        const current = get().agent;
        if (current) set({ agent: { ...current, notification_preferences: previous } });
        savePrefs(previous);
        throw error;
      }
    },

    markOnboarded() {
      const { agent } = get();
      if (!agent) return;
      set({ agent: { ...agent, onboarding_completed: true } });
    },
  };
});

/** Mirrors the seed's client id convention. */
function slugOf(organizationName: string): string {
  return organizationName.toLowerCase().split(/\s+/)[0] ?? 'app';
}

/**
 * Whether `grant` continues the session `agent` is in. A grant from an older
 * server names nobody; before grants named anybody it was always this one.
 */
function sameSession(agent: CurrentAgent, grant: TokenGrant): boolean {
  if (grant.account_id === undefined || grant.license_id === undefined) return true;
  return grant.account_id === agent.account_id && grant.license_id === agent.license_id;
}

/**
 * An API client bound to the live session, for calls made outside React.
 *
 * The token is read per request rather than captured, so a renewal that
 * happened a moment ago is already in effect; and a request the server refuses
 * for its credential is renewed once and repeated (tm 259.1). Components use
 * {@link useApiClient}, which is this plus the selected brand.
 */
export function sessionClient(getBrandId: () => string | null = () => null): ApiClient {
  return new ApiClient({
    getAccessToken: () => useAuth.getState().accessToken,
    getBrandId,
    renewAccessToken: (refused) => useAuth.getState().refreshSession(refused),
    onSessionRejected: (token) => useAuth.getState().rejectSession(token),
  });
}

/**
 * An API client bound to the current session and selected brand, for use
 * inside components. It does not subscribe to the token: a renewal is not a
 * reason to re-render every screen, and the client reads the token per request.
 */
export function useApiClient(): ApiClient {
  const brandId = useBrandStore((s) => s.brandId);
  return sessionClient(() => brandId);
}
