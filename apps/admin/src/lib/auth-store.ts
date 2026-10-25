/**
 * The operator session (tm 389.6 · FR-ADMIN-01/02).
 *
 * Two steps, one opaque token: `POST /auth/login` answers with a `password`-stage token and
 * says what is owed next (`totp_enroll` for an operator with no authenticator yet,
 * `totp_verify` otherwise); the code step answers with a **new** token under which the
 * session is `active`, and the password-stage one stops working. There is no refresh and no
 * PKCE — a session simply ends (8 h absolute, 15 min idle) and the operator signs in again.
 *
 * The token lives in `sessionStorage`: it dies with the tab, and nothing — no cookie, no
 * localStorage — outlives it. A reload with a token in hand asks `GET /auth/me`, which answers
 * the operator (active), 403 `platform_totp_required` with `details.next` (still at the code
 * step — that is how a reloaded tab learns which screen to show), or 401 (over).
 */
import { create } from 'zustand';
import { ApiClient, ApiClientError } from './api-client.js';
import type {
  PlatformMe,
  PlatformSessionEnvelope,
  PlatformSignIn,
  PlatformTotpActivation,
  PlatformTotpEnrollment,
  PlatformTotpVerification,
} from './platform-types.js';

export const SESSION_STORAGE_KEY = 'siyahtus.platform.session';

/** `unknown` until the first `restore()` answers; `challenge` between the password and the code. */
export type AuthStatus = 'unknown' | 'signed-out' | 'challenge' | 'signed-in';

export type ChallengeStep = 'totp_enroll' | 'totp_verify';

function readToken(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) globalThis.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
    else globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // A token that cannot be remembered simply ends with the page — not fatal.
  }
}

let token: string | null = readToken();

/** Replace the token held in memory and in the tab's storage. */
function setToken(next: string | null): void {
  token = next;
  writeToken(next);
}

/** The enrolment request in flight, shared by every caller (see `startEnrollment`). */
let enrolling: Promise<void> | null = null;

function nextStep(value: unknown): ChallengeStep | null {
  return value === 'totp_enroll' || value === 'totp_verify' ? value : null;
}

interface AuthState {
  status: AuthStatus;
  /** What the operator owes while `status` is `challenge`. */
  step: ChallengeStep | null;
  me: PlatformMe | null;
  /** The secret to import, while the enrolment screen is up. */
  enrollment: PlatformTotpEnrollment | null;
  /**
   * The recovery sheet an activation just issued. Shown once: while this is set the shell is
   * held back behind the sheet, and `acknowledgeRecoveryCodes` drops it from memory.
   */
  recoveryCodes: string[] | null;
  /** How many recovery codes the last code check left — a hint to regenerate the sheet. */
  recoveryCodesRemaining: number | null;
  /** The last session ended on its own (idle/absolute expiry, revoked) rather than by sign-out. */
  sessionEnded: boolean;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  acceptInvite: (inviteToken: string, password: string) => Promise<void>;
  startEnrollment: () => Promise<void>;
  activate: (code: string) => Promise<void>;
  verify: (input: { code: string } | { recoveryCode: string }) => Promise<void>;
  /** A fresh code for a route that wants one (`platform_recent_totp_required`). */
  reverify: (code: string) => Promise<void>;
  acknowledgeRecoveryCodes: () => void;
  /** Back to the password screen from the code step, discarding the half-open session. */
  cancelChallenge: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SIGNED_OUT: Pick<
  AuthState,
  'status' | 'step' | 'me' | 'enrollment' | 'recoveryCodes' | 'recoveryCodesRemaining'
> = {
  status: 'signed-out',
  step: null,
  me: null,
  enrollment: null,
  recoveryCodes: null,
  recoveryCodesRemaining: null,
};

/**
 * The one client. Its 401 handler is the store's own: a token the server turned away ends the
 * session wherever the request came from, and the sign-in screen says why.
 */
export const api = new ApiClient({
  getAccessToken: () => token,
  onSessionEnded: (refused) => {
    // A stale 401 for a token already replaced (a late response after the code step minted a
    // new one) must not end the new session.
    if (refused !== token) return;
    setToken(null);
    useAuth.setState({ ...SIGNED_OUT, sessionEnded: true });
  },
});

export const useAuth = create<AuthState>((set, get) => {
  /** Adopt a token and read the operator it belongs to. */
  async function enter(nextToken: string): Promise<void> {
    setToken(nextToken);
    const me = await api.get<PlatformMe>('/auth/me');
    set({ status: 'signed-in', step: null, me, enrollment: null, sessionEnded: false });
  }

  /**
   * After a code was refused, find out whether the session is still there to try again in.
   * A 401 on `/auth/me` ends the session through the client's handler (a dead token must not
   * leave the operator retrying a code that can never work); anything else changes nothing.
   */
  async function probeSession(): Promise<void> {
    try {
      await api.get<PlatformMe>('/auth/me');
    } catch {
      // 403 `platform_totp_required` is the healthy answer here; a 401 was handled by the client.
    }
  }

  return {
    status: 'unknown',
    step: null,
    me: null,
    enrollment: null,
    recoveryCodes: null,
    recoveryCodesRemaining: null,
    sessionEnded: false,

    async restore() {
      if (token === null) {
        set({ ...SIGNED_OUT });
        return;
      }
      try {
        const me = await api.get<PlatformMe>('/auth/me');
        set({ status: 'signed-in', step: null, me, sessionEnded: false });
      } catch (error) {
        if (error instanceof ApiClientError && error.type === 'platform_totp_required') {
          set({ status: 'challenge', step: nextStep(error.details?.['next']) ?? 'totp_verify' });
          return;
        }
        // 401 was already turned into `sessionEnded` by the client; anything else (the server
        // unreachable) leaves nothing to resume.
        if (get().status === 'unknown') {
          setToken(null);
          set({ ...SIGNED_OUT });
        }
      }
    },

    async signIn(email, password) {
      const result = await api.post<PlatformSignIn>('/auth/login', { email, password });
      setToken(result.token);
      set({ status: 'challenge', step: result.next, sessionEnded: false });
    },

    async acceptInvite(inviteToken, password) {
      const result = await api.post<PlatformSignIn>('/auth/invite/accept', {
        token: inviteToken,
        password,
      });
      setToken(result.token);
      set({ status: 'challenge', step: result.next, sessionEnded: false });
    },

    startEnrollment() {
      // Once per screen: the server replaces an unconfirmed secret on every call, so a second
      // request (a dev server runs every effect twice) would make the secret on screen the
      // wrong one. The promise is shared while a request is in flight.
      if (get().enrollment) return Promise.resolve();
      enrolling ??= api
        .post<PlatformTotpEnrollment>('/auth/totp/enroll')
        .then((enrollment) => set({ enrollment }))
        .finally(() => {
          enrolling = null;
        });
      return enrolling;
    },

    async activate(code) {
      let result: PlatformTotpActivation;
      try {
        result = await api.post<PlatformTotpActivation>('/auth/totp/activate', { code });
      } catch (error) {
        await probeSession();
        throw error;
      }
      // Hold the sheet before the shell: `enter` flips the status, and the recovery screen
      // must already be waiting when it does.
      set({ recoveryCodes: result.recovery_codes });
      await enter(result.token);
    },

    async verify(input) {
      let result: PlatformTotpVerification;
      try {
        result = await api.post<PlatformTotpVerification>(
          '/auth/totp/verify',
          'code' in input ? { code: input.code } : { recovery_code: input.recoveryCode },
        );
      } catch (error) {
        await probeSession();
        throw error;
      }
      set({ recoveryCodesRemaining: result.recovery_codes_remaining });
      await enter(result.token);
    },

    async reverify(code) {
      const { session } = await api.post<PlatformSessionEnvelope>('/auth/totp/reverify', { code });
      const me = get().me;
      if (me) set({ me: { ...me, session } });
    },

    acknowledgeRecoveryCodes() {
      set({ recoveryCodes: null });
    },

    async cancelChallenge() {
      await get().signOut();
    },

    async signOut() {
      const current = token;
      // Cleared first: the screen must not stay "signed in" because a logout request is slow.
      setToken(null);
      set({ ...SIGNED_OUT, sessionEnded: false });
      if (current === null) return;
      try {
        // Its own client: the shared one reads `token`, which was just cleared.
        const client = new ApiClient({ getAccessToken: () => current });
        await client.post('/auth/logout');
      } catch {
        // The token is gone from this tab either way; the server drops an idle one itself.
      }
    },
  };
});

/** Whether the signed-in operator's role holds `permission`. The server's gate is the rule. */
export function hasPermission(me: PlatformMe | null, permission: string): boolean {
  return me !== null && (me.permissions as readonly string[]).includes(permission);
}
