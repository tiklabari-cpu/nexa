/**
 * Why a sign-in could not proceed, as a code the screen words (O14, tm 259.18).
 *
 * `auth-store.ts` used to throw `new Error('Workspace not found.')` and the
 * sign-in pages printed `error.message`, so a Turkish console showed English
 * sentences from a store that has no business choosing a language. The store
 * now throws an {@link AuthFlowError} carrying only a code; the page turns it
 * into a sentence with {@link authFailureMessage}. Its own module so a test
 * that replaces the whole store with a stub still has the class to match on.
 */
import { ApiClientError, errorMessageKey } from './api-client.js';
import type { TFunction } from './i18n.js';

export type AuthFlowCode = 'workspace_not_found' | 'no_app' | 'sso_not_started';

export class AuthFlowError extends Error {
  readonly code: AuthFlowCode;

  constructor(code: AuthFlowCode) {
    // The code, not a sentence: nothing should ever print this.
    super(code);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

/** A short code for the store's `error` field — never prose. */
export function authFailureCode(cause: unknown, fallback: string): string {
  if (cause instanceof AuthFlowError) return cause.code;
  if (cause instanceof ApiClientError) return cause.type;
  return fallback;
}

/**
 * The sentence for a failed sign-in step, in the console's language: the
 * store's own refusals by code, the API's by error type, and anything else —
 * a thrown value of unknown shape — as `fallbackKey`.
 */
export function authFailureMessage(t: TFunction, cause: unknown, fallbackKey: string): string {
  if (cause instanceof AuthFlowError) return t(`auth.flow.${cause.code}`);
  if (cause instanceof ApiClientError) return t(errorMessageKey(cause));
  return t(fallbackKey);
}
