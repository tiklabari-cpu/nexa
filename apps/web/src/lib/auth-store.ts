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
  signOut: () => Promise<void>;
  setRoutingStatus: (status: CurrentAgent['routing_status']) => Promise<void>;
}

const REFRESH_KEY = 'nexa.refresh_token';
const CLIENT_ID_KEY = 'nexa.client_id';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

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
  };
});

/** Mirrors the seed's client id convention. */
function slugOf(organizationName: string): string {
  return organizationName.toLowerCase().split(/\s+/)[0] ?? 'app';
}

/** An API client bound to the current session, for use inside components. */
export function useApiClient(): ApiClient {
  const accessToken = useAuth((s) => s.accessToken);
  return new ApiClient({ getAccessToken: () => accessToken });
}
