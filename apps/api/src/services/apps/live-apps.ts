/**
 * Which Apps cards can talk to their real provider (tm 263).
 *
 * The vocabulary `APPS_LIVE_PROVIDERS` accepts lives here, beside nothing heavy,
 * so `config/env.ts` can import it without pulling the verifiers (and their
 * HTTP client) into every module that reads the environment. A value the schema
 * accepts and no verifier implements is exactly the drift this one list closes:
 * `verifiers/registry.ts` is typed against it.
 *
 * Every card not listed — and every listed card the deployment has not switched
 * on — keeps the mock behaviour it had before this existed: the key is checked
 * for shape, hashed, and the chat panel shows the deterministic demo record.
 */
export const LIVE_APP_IDS = ['brevo', 'freshdesk', 'telegram'] as const;
export type LiveAppId = (typeof LIVE_APP_IDS)[number];

export function isLiveAppId(value: string): value is LiveAppId {
  return (LIVE_APP_IDS as readonly string[]).includes(value);
}

/**
 * The development value `.env.example` publishes for `APPS_CREDENTIAL_KEY`.
 * Public, so production refuses it (`productionProblems`): a credential
 * encrypted under a key printed in this repository is not encrypted.
 */
export const DEV_APPS_CREDENTIAL_KEY = '0123456789abcdef'.repeat(4);
