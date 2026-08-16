/**
 * The mobile session: where it is kept, how it is renewed, and what happens
 * when it is gone.
 *
 * One indivisible piece by design (PLAN §6.1 · 13.7-b). Split storage from
 * renewal and the halves drift into "safely stored but never expires" or
 * "renewed, in the clear" — both are the same breach wearing different clothes,
 * so both live here.
 *
 * What it is not: a second way to get a token. Every credential comes from the
 * `/auth/authorize` -> `/auth/token` pair the console already uses, with the
 * same mandatory S256 PKCE, the same single-use codes, the same rotating
 * refresh tokens. The phone's only additions are a private-use redirect the
 * operating system routes back (`MOBILE_REDIRECT_URI`) and a store with a lock
 * on it (`SessionStore`).
 *
 * The system browser, not an embedded one (§C-A29). A `WebView` rendering an
 * identity provider's login page is a text field the host app can read, which
 * makes "sign in with your company account" a credential-harvesting screen the
 * person has no way to distinguish. `openAuthSessionAsync` hands the URL to
 * ASWebAuthenticationSession / Chrome Custom Tabs — a browser this app cannot
 * see into, carrying the cookies the identity provider already trusts, which is
 * also what makes a second sign-in silent.
 */
import { MOBILE_REDIRECT_URI } from '@nexa/types';

import { ApiClient, ApiClientError } from '../lib/api-client';
import { createPkcePair, createState, type PkcePair } from './pkce';
import { DeviceTokenLifecycle } from './device-token';
import { SessionStore, type PersistedSession } from './secure-store';

export type SessionStatus = 'unknown' | 'signed-out' | 'signed-in';

/** A workspace this account may enter, as `/auth/login` describes it. */
export interface Workspace {
  license_id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  license_status?: string;
  client_id?: string | null;
  sso_enforced_connection_id?: string | null;
  password_login_available?: boolean;
}

/** The signed-in principal, from `/auth/me`. */
export interface SessionPrincipal {
  account_id?: string;
  email?: string;
  name?: string;
  role?: string;
  organization_id: string;
  license_id: string;
  scopes: string[];
  routing_status?: 'accepting_chats' | 'not_accepting_chats' | 'offline';
}

export interface SessionState {
  status: SessionStatus;
  /** In memory only, for at most an hour (§D2). Never written to disk. */
  accessToken: string | null;
  principal: SessionPrincipal | null;
}

/**
 * The system browser leg, as one function so a test can be the browser.
 *
 * Mirrors `WebBrowser.openAuthSessionAsync`: resolves with the callback URL when
 * the operating system routes one back, and with `null` when the person
 * dismissed the sheet.
 */
export interface AuthBrowser {
  open(url: string, redirectUri: string): Promise<string | null>;
}

export interface MobileSessionOptions {
  /** Absolute, e.g. `https://api.example.com/api/v1` — see `src/config.ts`. */
  apiBaseUrl: string;
  store?: SessionStore;
  browser?: AuthBrowser;
  deviceTokens?: DeviceTokenLifecycle;
  /** Overridable so session tests need no native crypto module. */
  pkce?: () => Promise<PkcePair>;
  createState?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

/**
 * The password was right and the workspace still said no, because it federates
 * sign-in (NFR-S11 · S11-h). Carries the connection so the screen can offer the
 * other door rather than an error nobody can act on.
 */
export class SsoRequiredError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string, message: string) {
    super(message);
    this.name = 'SsoRequiredError';
    this.connectionId = connectionId;
  }
}

export class MobileSession {
  readonly #store: SessionStore;
  readonly #browser: AuthBrowser | null;
  readonly #deviceTokens: DeviceTokenLifecycle;
  readonly #pkce: () => Promise<PkcePair>;
  readonly #newState: () => Promise<string>;
  readonly #apiBaseUrl: string;
  readonly #fetchImpl: typeof fetch | undefined;
  /** Token-free client for the anonymous endpoints (`/auth/login`, `/auth/token`). */
  readonly #anonymous: ApiClient;

  #current: SessionState = { status: 'unknown', accessToken: null, principal: null };
  #persisted: PersistedSession | null = null;
  readonly #listeners = new Set<(state: SessionState) => void>();
  /**
   * The one in-flight renewal, shared by every caller that arrives while it
   * runs. Without it, three screens hitting 401 at once would present the same
   * refresh token three times — and the second and third presentations are
   * precisely what the server reads as a stolen token, revoking the family and
   * signing the person out for being fast (OAuth 2.1 §4.3.1).
   */
  #refreshing: Promise<string | null> | null = null;

  constructor(options: MobileSessionOptions) {
    this.#apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.#fetchImpl = options.fetchImpl;
    this.#store = options.store ?? new SessionStore();
    this.#browser = options.browser ?? null;
    this.#deviceTokens = options.deviceTokens ?? new DeviceTokenLifecycle({ store: this.#store });
    this.#pkce = options.pkce ?? createPkcePair;
    this.#newState = options.createState ?? createState;
    this.#anonymous = this.#clientFor(null);
  }

  // --- Reading ---------------------------------------------------------------

  getState(): SessionState {
    return this.#current;
  }

  getAccessToken(): string | null {
    return this.#current.accessToken;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  // --- Starting --------------------------------------------------------------

  /**
   * Launch. Turn whatever is in the protected store into a live session, or
   * decide there is not one.
   *
   * A refresh token that no longer works is not an error to show anybody: it
   * expired, or its family was revoked because somebody else presented it. Both
   * end the same way — clean slate, sign-in screen — and looping on it would be
   * the worst outcome, so the local copy goes before the screen is told.
   */
  async restore(): Promise<void> {
    const persisted = await this.#store.read();
    if (persisted === null) {
      this.#set({ status: 'signed-out', accessToken: null, principal: null });
      return;
    }

    this.#persisted = persisted;
    const accessToken = await this.#rotate(persisted);
    if (accessToken === null) {
      await this.#drop();
      return;
    }

    this.#set({
      status: 'signed-in',
      accessToken,
      principal: await this.#loadPrincipal(accessToken),
    });
  }

  /** Which workspaces this password opens. Issues no token (`/auth/login`). */
  async listWorkspaces(email: string, password: string): Promise<Workspace[]> {
    const result = await this.#anonymous.request('post', '/auth/login', {
      body: { email, password },
    });
    return result.memberships as Workspace[];
  }

  /**
   * Password sign-in against one workspace.
   *
   * `/auth/authorize` is a JSON POST here as everywhere — the agent app is
   * first party, there is no consent screen to render, and no browser is
   * involved in a password login. The redirect URI still travels and is still
   * exact-matched: it is what the code is bound to, so `/auth/token` refuses an
   * exchange that names a different one.
   */
  async signIn(input: {
    email: string;
    password: string;
    licenseId: string;
    clientId: string;
  }): Promise<void> {
    const { verifier, challenge } = await this.#pkce();

    let code: string;
    try {
      const authorized = await this.#anonymous.request('post', '/auth/authorize', {
        body: {
          client_id: input.clientId,
          redirect_uri: MOBILE_REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          email: input.email,
          password: input.password,
          license_id: input.licenseId,
        },
      });
      code = authorized.code;
    } catch (error) {
      const connectionId = ssoConnectionOf(error);
      if (connectionId !== null) {
        throw new SsoRequiredError(connectionId, (error as Error).message);
      }
      throw error;
    }

    await this.#redeem({ code, verifier, clientId: input.clientId });
  }

  /**
   * Federated sign-in, through the device's own browser (§C-A29 · S11-i).
   *
   * The verifier never leaves this object — it is held on the stack across the
   * browser round trip rather than persisted, because unlike the web app there
   * is no page reload to survive: this app is still running behind the sheet.
   * That is strictly better than the web's `sessionStorage` hand-off, and it is
   * why an intercepted callback is worthless.
   */
  async signInWithSso(input: { connectionId: string; clientId: string }): Promise<void> {
    if (!this.#browser) throw new Error('No browser is available for single sign-on.');

    const { verifier, challenge } = await this.#pkce();
    const state = await this.#newState();

    const query = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: MOBILE_REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    const loginUrl =
      `${this.#apiBaseUrl}/auth/saml/${encodeURIComponent(input.connectionId)}/login` +
      `?${query.toString()}`;

    const callback = await this.#browser.open(loginUrl, MOBILE_REDIRECT_URI);
    if (callback === null) throw new Error('Sign-in was cancelled.');

    const returned = new URL(callback);
    // A callback carrying somebody else's state — or none — is not the login
    // this app started, and its code is not one this verifier could redeem
    // anyway. Refusing it here says so plainly instead of spending a round trip.
    if (returned.searchParams.get('state') !== state) {
      throw new Error('This sign-in did not start in this app.');
    }
    const code = returned.searchParams.get('code');
    if (code === null) {
      throw new Error('The identity provider did not return an authorization code.');
    }

    await this.#redeem({ code, verifier, clientId: input.clientId });
  }

  // --- Keeping ---------------------------------------------------------------

  /**
   * Renew the access token, once, however many callers ask at the same time.
   *
   * Returns the new token, or `null` when the session is over — in which case it
   * has already been dropped and every subscriber told. Callers do not have to
   * handle that failure; they only have to notice they got nothing back.
   */
  async refresh(): Promise<string | null> {
    if (this.#refreshing) return this.#refreshing;

    const persisted = this.#persisted;
    if (persisted === null) return null;

    this.#refreshing = (async () => {
      const accessToken = await this.#rotate(persisted);
      if (accessToken === null) {
        await this.#drop();
        return null;
      }
      this.#set({ ...this.#current, status: 'signed-in', accessToken });
      return accessToken;
    })().finally(() => {
      this.#refreshing = null;
    });

    return this.#refreshing;
  }

  // --- Ending ----------------------------------------------------------------

  /**
   * Deliberate sign-out: revoke both tokens server-side, drop the device token,
   * clear the store.
   *
   * The revocations are best-effort and the local clear is not. A person who
   * taps "sign out" on a train must end up signed out of this phone whatever the
   * network thinks — the server-side tokens expire on their own, and the refresh
   * token is gone from the only place it was ever written down.
   */
  async signOut(): Promise<void> {
    const accessToken = this.#current.accessToken;
    const refreshToken = this.#persisted?.refreshToken ?? null;

    // Before the access token is revoked, because revoking the device token is
    // what that credential is still needed for (§C-A31).
    await this.#deviceTokens.onSignedOut(accessToken);
    await Promise.allSettled([
      accessToken === null ? Promise.resolve() : this.#revoke(accessToken),
      refreshToken === null ? Promise.resolve() : this.#revoke(refreshToken),
    ]);
    await this.#drop();
  }

  /**
   * Sign out of one workspace and into another on the same device.
   *
   * Not `signOut()` then `signIn()` at the call site, because the ordering
   * between them is a rule rather than a convenience: the outgoing account's
   * push token must be revoked and forgotten before the incoming one registers
   * anything (§C-A31). Expressing it as one method is what stops a future screen
   * from getting the order wrong.
   */
  async switchAccount(input: {
    email: string;
    password: string;
    licenseId: string;
    clientId: string;
  }): Promise<void> {
    await this.signOut();
    await this.signIn(input);
  }

  // --- Internals -------------------------------------------------------------

  /** Redeem a code and become signed in. Shared by the password and SSO legs. */
  async #redeem(input: { code: string; verifier: string; clientId: string }): Promise<void> {
    const grant = await this.#anonymous.request('post', '/auth/token', {
      body: {
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.verifier,
        client_id: input.clientId,
        redirect_uri: MOBILE_REDIRECT_URI,
      },
    });

    const principal = await this.#loadPrincipal(grant.access_token);
    this.#persisted = {
      refreshToken: grant.refresh_token,
      clientId: input.clientId,
      licenseId: grant.license_id,
      accountId: grant.account_id,
    };
    // Written before the screen is told, so a crash between the two costs a
    // refresh rather than a session.
    await this.#store.write(this.#persisted);
    this.#set({ status: 'signed-in', accessToken: grant.access_token, principal });

    await this.#deviceTokens.onSignedIn(grant.access_token);
  }

  /**
   * Present the refresh token, take the new pair, persist the successor.
   *
   * `null` means the session is over; a thrown error means the network is. The
   * distinction is the whole reason this is not a boolean: an app that signed
   * people out whenever a tunnel swallowed a request would sign them out daily,
   * so only the server's own refusal ends a session.
   */
  async #rotate(persisted: PersistedSession): Promise<string | null> {
    try {
      const grant = await this.#anonymous.request('post', '/auth/token', {
        body: {
          grant_type: 'refresh_token',
          refresh_token: persisted.refreshToken,
          client_id: persisted.clientId,
        },
      });

      // Stored before it is returned: the server has already invalidated the
      // presented token, so the copy on disk is stale the moment this resolves
      // and leaving it there would spend the next launch on a token that is
      // guaranteed to be refused.
      this.#persisted = { ...persisted, refreshToken: grant.refresh_token };
      await this.#store.write(this.#persisted);
      return grant.access_token;
    } catch (error) {
      if (error instanceof ApiClientError && error.isRetryable) throw error;
      return null;
    }
  }

  async #loadPrincipal(accessToken: string): Promise<SessionPrincipal> {
    const client = this.#clientFor(accessToken);
    return (await client.request('get', '/auth/me')) as SessionPrincipal;
  }

  async #revoke(token: string): Promise<void> {
    await this.#anonymous.request('post', '/auth/revoke', { body: { token } });
  }

  #clientFor(accessToken: string | null): ApiClient {
    return new ApiClient({
      baseUrl: this.#apiBaseUrl,
      getAccessToken: () => accessToken,
      ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
    });
  }

  /**
   * The session is over — expired, revoked, or signed out of.
   *
   * Everything goes: the in-memory token, the persisted refresh token, and the
   * device push token. That last one is the reason this is a single method
   * rather than a `set` call at three call sites (§C-A31).
   */
  async #drop(): Promise<void> {
    await this.#deviceTokens.onSignedOut(null);
    await this.#store.clearAll();
    this.#persisted = null;
    this.#set({ status: 'signed-out', accessToken: null, principal: null });
  }

  #set(state: SessionState): void {
    this.#current = state;
    for (const listener of this.#listeners) listener(state);
  }
}

/**
 * The connection id `/auth/authorize` names when it refuses a password because
 * the workspace federates sign-in (S11-h). Absent on every other refusal.
 */
function ssoConnectionOf(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || error.type !== 'not_allowed') return null;
  const id = error.details?.['sso_connection_id'];
  return typeof id === 'string' ? id : null;
}
