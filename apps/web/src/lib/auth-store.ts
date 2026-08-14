/**
 * Session state.
 *
 * The access token lives in memory, not localStorage: anything in localStorage
 * is readable by any script that ends up on the page, and an access token is
 * the one credential worth protecting that hard. The refresh token is stored
 * so a page reload does not force a re-login, and it rotates on every use — a
 * stolen one is detectable and revokes its whole family server-side.
 */
import { create } from 'zustand';
import { ApiClient } from './api-client.js';

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
   * The e-mail notification channel (FR-MOD-13.8). Account-level and per license,
   * so unlike the browser-side sound/desktop toggles it follows the agent. Absent
   * on older tokens — treat as on, matching the server default.
   */
  notify_email?: boolean;
  /** First-run setup gate (FR-MOD-00.4). Absent on older tokens — treat as done. */
  onboarding_completed?: boolean;
}

interface AuthState {
  accessToken: string | null;
  agent: CurrentAgent | null;
  status: 'unknown' | 'signed-out' | 'signed-in';
  error: string | null;
  busy: boolean;

  restore: () => Promise<void>;
  listWorkspaces: (email: string, password: string) => Promise<Membership[]>;
  signIn: (email: string, password: string, licenseId: string) => Promise<void>;
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
  /** Turn the e-mail notification channel on or off for the caller (FR-MOD-13.8). */
  setNotifyEmail: (email: boolean) => Promise<void>;
  /** Flip the local gate once the wizard has told the server setup is done. */
  markOnboarded: () => void;
}

const REFRESH_KEY = 'nexa.refresh_token';
const CLIENT_ID_KEY = 'nexa.client_id';
const BRAND_KEY = 'nexa.brand_id';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

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
const SSO_PENDING_KEY = 'nexa.sso_login';

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

  async function loadAgent(accessToken: string): Promise<CurrentAgent> {
    const client = new ApiClient({ getAccessToken: () => accessToken });
    return client.get<CurrentAgent>('/auth/me');
  }

  return {
    accessToken: null,
    agent: null,
    status: 'unknown',
    error: null,
    busy: false,

    async restore() {
      const refreshToken = readStored(REFRESH_KEY);
      const clientId = readStored(CLIENT_ID_KEY);
      if (!refreshToken || !clientId) {
        set({ status: 'signed-out' });
        return;
      }

      try {
        const grant = await anonymous.post<{ access_token: string; refresh_token: string }>(
          '/auth/token',
          { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
        );
        writeStored(REFRESH_KEY, grant.refresh_token);
        set({
          accessToken: grant.access_token,
          agent: await loadAgent(grant.access_token),
          status: 'signed-in',
        });
      } catch {
        // A refresh token that no longer works means the family was revoked, or
        // it simply expired. Either way, start clean rather than looping.
        writeStored(REFRESH_KEY, null);
        set({ status: 'signed-out' });
      }
    },

    async listWorkspaces(email, password) {
      set({ busy: true, error: null });
      try {
        const result = await anonymous.post<{ memberships: Membership[] }>('/auth/login', {
          email,
          password,
        });
        return result.memberships;
      } finally {
        set({ busy: false });
      }
    },

    async signIn(email, password, licenseId) {
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
          membership.client_id ?? `nexa-agent-app-${slugOf(membership.organization_name)}`;
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
        });

        const grant = await anonymous.post<{ access_token: string; refresh_token: string }>(
          '/auth/token',
          {
            grant_type: 'authorization_code',
            code: authorized.code,
            code_verifier: verifier,
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
          },
        );

        writeStored(REFRESH_KEY, grant.refresh_token);
        writeStored(CLIENT_ID_KEY, clientId);

        set({
          accessToken: grant.access_token,
          agent: await loadAgent(grant.access_token),
          status: 'signed-in',
          error: null,
        });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Sign-in failed.' });
        throw error;
      } finally {
        set({ busy: false });
      }
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

        const grant = await anonymous.post<{ access_token: string; refresh_token: string }>(
          '/auth/token',
          {
            grant_type: 'authorization_code',
            code,
            code_verifier: pending.verifier,
            client_id: pending.clientId,
            redirect_uri: REDIRECT_URI,
          },
        );

        writeStored(REFRESH_KEY, grant.refresh_token);
        writeStored(CLIENT_ID_KEY, pending.clientId);
        set({
          accessToken: grant.access_token,
          agent: await loadAgent(grant.access_token),
          status: 'signed-in',
          error: null,
        });
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

      // Revoke both, and do not let a failure strand the user in a signed-in
      // shell they cannot use.
      await Promise.allSettled([
        accessToken ? anonymous.post('/auth/revoke', { token: accessToken }) : null,
        refreshToken ? anonymous.post('/auth/revoke', { token: refreshToken }) : null,
      ]);

      writeStored(REFRESH_KEY, null);
      set({ accessToken: null, agent: null, status: 'signed-out' });
    },

    async setRoutingStatus(status) {
      const { accessToken, agent } = get();
      if (!accessToken || !agent) return;

      const client = new ApiClient({ getAccessToken: () => accessToken });
      await client.request('PUT', '/agents/me/routing-status', { routing_status: status });
      set({ agent: { ...agent, routing_status: status } });
    },

    async setNotifyEmail(email) {
      const { accessToken, agent } = get();
      if (!accessToken || !agent) return;

      // Optimistic: reflect the toggle immediately, then roll back if the write
      // fails so the switch never lies about the server state.
      const previous = agent.notify_email ?? true;
      set({ agent: { ...agent, notify_email: email } });
      try {
        const client = new ApiClient({ getAccessToken: () => accessToken });
        await client.request('PUT', '/agents/me/notification-preferences', { email });
      } catch (error) {
        set({ agent: { ...get().agent!, notify_email: previous } });
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

/** An API client bound to the current session and selected brand, for use inside components. */
export function useApiClient(): ApiClient {
  const accessToken = useAuth((s) => s.accessToken);
  const brandId = useBrandStore((s) => s.brandId);
  return new ApiClient({ getAccessToken: () => accessToken, getBrandId: () => brandId });
}
