/**
 * The adaptor contract every live Apps card implements (tm 263).
 *
 * A verifier turns a pasted credential into a yes or no from the provider
 * itself — one cheap, read-only call — and, optionally, reads what the chat
 * panel shows about a customer. It never stores, logs or returns the key: the
 * service encrypts it, and every outbound call goes through the one safe client
 * (`lib/safe-fetch.ts`), which carries only the headers the adaptor gives it.
 */
import type { AppCredentialField } from '@siyahtus/types';
import type { SafeHttp } from '../../../lib/safe-fetch.js';
import type { LiveAppId } from '../live-apps.js';

/** What a user pasted, already trimmed and normalised by the route. */
export interface AppCredentials {
  apiKey: string;
  subdomain?: string;
}

/** Where each provider lives. Production uses the real hosts; tests point them at a local fake. */
export interface ProviderEndpoints {
  brevo: string;
  freshdesk: (subdomain: string) => string;
  telegram: string;
}

export const DEFAULT_PROVIDER_ENDPOINTS: ProviderEndpoints = {
  brevo: 'https://api.brevo.com',
  // The subdomain is a validated DNS label (APP_SUBDOMAIN_PATTERN) before it
  // gets here, so this can only ever name a host under freshdesk.com.
  freshdesk: (subdomain) => `https://${subdomain}.freshdesk.com`,
  telegram: 'https://api.telegram.org',
};

export interface ProviderContext {
  http: SafeHttp;
  endpoints: ProviderEndpoints;
}

/**
 * - `invalid_key`    the provider refused the credential (401/403)
 * - `not_found`      the account address does not exist (Freshdesk's 404 for an unknown domain)
 * - `unreachable`    timeout, DNS, TLS, a redirect, or an address the SSRF check refused
 * - `provider_error` 5xx, an answer too large, or one this adaptor cannot read
 */
export type VerifyFailureReason = 'invalid_key' | 'not_found' | 'unreachable' | 'provider_error';

export type VerifyResult =
  | { ok: true; accountLabel: string }
  | { ok: false; reason: VerifyFailureReason; providerMessage?: string };

export interface ChatField {
  label: string;
  value: string;
}

export interface AppVerifier {
  appId: Exclude<LiveAppId, 'telegram'>;
  credentialFields: readonly AppCredentialField[];
  verify(credentials: AppCredentials, context: ProviderContext): Promise<VerifyResult>;
  /**
   * The customer's record at the provider, or `null` when there is none (a
   * person the provider has never heard of is an answer, not a failure).
   * Throws when the provider cannot be read — the caller shows "unavailable",
   * never invented values.
   */
  fetchChatData?(
    credentials: AppCredentials,
    customer: { email: string | null },
    context: ProviderContext,
  ): Promise<ChatField[] | null>;
}

/** Thrown by `fetchChatData` when the provider could not be read. */
export class ProviderReadError extends Error {
  constructor(readonly reason: VerifyFailureReason) {
    super(`provider read failed: ${reason}`);
    this.name = 'ProviderReadError';
  }
}
