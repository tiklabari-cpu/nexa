/**
 * The hand-written half of the public API documentation (KN-04 · tm 376).
 *
 * The operation reference is generated from the contract; the four things a
 * contract cannot say on its own are written here — how to authenticate, how the
 * webhook signature is verified, what the rate limits are and what an error
 * looks like. Each of them is anchored to code so it cannot drift silently:
 *
 *   - the error table is built from `ERROR_TYPES` / `ERROR_STATUS`;
 *   - the webhook sample is the file `docs-examples/verify-webhook.mjs`, which the
 *     API's test suite runs against the real signer (`signature.ts`);
 *   - the test vector below is checked against the real signer too;
 *   - the rate limits are checked against the API's configuration defaults.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_STATUS, ERROR_TYPES } from '@siyahtus/types';
import type { GuideSection } from './public-spec.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Where the runnable webhook verification sample lives. */
export const WEBHOOK_EXAMPLE_PATH = resolve(here, '../docs-examples/verify-webhook.mjs');

/**
 * Default per-minute ceilings (ADR-07 · NFR-S8). A deployment may configure
 * others; the API's test pins these to its own defaults.
 */
export const PUBLISHED_RATE_LIMITS = {
  /** Personal access token, per account. */
  agentPerMinute: 180,
  /** Requests without a credential, per IP address. */
  anonymousPerMinute: 30,
} as const;

/** A worked signature, for implementers in any language. Verified against the real signer. */
export const WEBHOOK_TEST_VECTOR = {
  secret: 'whsec_example_secret',
  timestamp: '1700000000',
  nonce: '0b5a3c1e-7d2f-4c8a-9e61-3f4a5b6c7d8e',
  body: '{"action":"chat_started","chat_id":"TJ1H8CFKRV"}',
  signature: '6facf83dea0c7c323988938158ca7dfb5bb5a26227664ce82c00572b531a9d13',
} as const;

/** Error types that name the platform's own back office; never part of a public table. */
export const INTERNAL_ERROR_TYPE_PATTERNS: readonly RegExp[] = [
  /^platform_/,
  /^impersonation_/,
  /^sandbox_/,
  /^maintenance$/,
];

export function isPublicErrorType(type: string): boolean {
  return !INTERNAL_ERROR_TYPE_PATTERNS.some((pattern) => pattern.test(type));
}

/** The error types a public client can meet, with their HTTP status. */
export function publicErrorTypes(): Array<{ type: string; status: number }> {
  return ERROR_TYPES.filter(isPublicErrorType)
    .map((type) => ({ type, status: ERROR_STATUS[type] }))
    .sort((a, b) => a.status - b.status || a.type.localeCompare(b.type));
}

function authentication(): GuideSection {
  return {
    id: 'authentication',
    title: 'Authentication',
    markdown: `Every request except the health checks carries a credential in the \`Authorization\` header. For a server-to-server integration that credential is a personal access token.

### Personal access token (server to server)

Create a token under **Settings → Integrations → Personal access tokens** in the panel, or with \`POST /auth/personal-access-tokens\`. The plaintext token is shown **once**; only its hash is stored, so a lost token is replaced, not recovered. Pick the narrowest scopes that do the job — a token can never be granted a scope its creator does not hold.

A personal access token is sent with HTTP Basic authentication: the username is your **account id** (\`account_id\` from \`GET /auth/me\`), the password is the token.

\`\`\`bash
curl -u "$ACCOUNT_ID:$SIYAHTUS_PAT" \\
  "https://api.example.com/api/v1/chats?limit=10"
\`\`\`

\`\`\`js
const credentials = Buffer.from(\`\${accountId}:\${token}\`).toString('base64');
const response = await fetch('https://api.example.com/api/v1/chats?limit=10', {
  headers: { Authorization: \`Basic \${credentials}\` },
});
\`\`\`

### Regions

A workspace lives in one region (\`eu\` or \`us\`) for good. A request that reaches the wrong region is answered \`421 misdirected_request\`; \`error.details.region\` names the right one.`,
  };
}

function webhooks(): GuideSection {
  const example = readFileSync(WEBHOOK_EXAMPLE_PATH, 'utf8').trimEnd();
  const vector = WEBHOOK_TEST_VECTOR;
  return {
    id: 'webhooks',
    title: 'Webhook signatures',
    markdown: `A webhook is a \`POST\` of \`{ "action": "...", "data": { ... } }\` to the URL you registered with \`POST /webhooks\`. Anyone can send a request to that URL, so verify the signature before you trust it.

The registration response carries the signing **secret** once. Store it; there is no way to read it again.

### The scheme

Every delivery carries three headers:

| Header | Content |
| --- | --- |
| \`X-Webhook-Timestamp\` | Unix time, in seconds, when the delivery was signed. |
| \`X-Webhook-Nonce\` | A unique value per delivery. |
| \`X-Webhook-Signature\` | \`sha256=\` followed by the hex digest below. |

\`\`\`text
signature = HMAC-SHA256(secret, "{timestamp}.{nonce}.{body}")
\`\`\`

\`body\` is the raw request body exactly as received. Then:

- reject a timestamp more than **300 seconds** from your clock (replay window);
- reject a nonce you have already accepted;
- compare the digests in constant time.

### A reference verifier (Node.js)

\`\`\`js
${example}
\`\`\`

### A test vector

Use it to check an implementation in any language. With this input the signature must be exactly the value shown.

| Part | Value |
| --- | --- |
| secret | \`${vector.secret}\` |
| timestamp | \`${vector.timestamp}\` |
| nonce | \`${vector.nonce}\` |
| body | \`${vector.body}\` |
| signature | \`sha256=${vector.signature}\` |

### Delivery and retries

A \`2xx\` answer is a success. Anything else, or no answer within the timeout, is a failed attempt and is retried automatically;\`GET /webhooks/{webhookId}/deliveries\` shows every attempt, \`POST …/redeliver\` sends one again and \`POST /webhooks/{webhookId}/test\` sends a signed test event.`,
  };
}

function rateLimits(): GuideSection {
  const limits = PUBLISHED_RATE_LIMITS;
  return {
    id: 'rate-limits',
    title: 'Rate limits',
    markdown: `Requests are counted per credential in a sliding one-minute window.

| Caller | Default limit |
| --- | --- |
| Personal access token | ${limits.agentPerMinute} requests per minute per account |
| No credential | ${limits.anonymousPerMinute} requests per minute per IP address |

A deployment can set other values, so read the headers rather than hard-coding the numbers. A request over the limit is answered \`429 too_many_requests\`.

| Header | Meaning |
| --- | --- |
| \`X-RateLimit-Limit\` | The ceiling for the window. |
| \`X-RateLimit-Remaining\` | Requests left in the window. |
| \`X-RateLimit-Reset\` | Unix time, in seconds, when the window resets. |
| \`Retry-After\` | On a \`429\`: seconds to wait before retrying. |

Back off for \`Retry-After\` seconds and retry; do not retry in a tight loop. Failed credentials count too, so a client with a bad token should stop, not keep trying.`,
  };
}

function errors(): GuideSection {
  const rows = publicErrorTypes()
    .map(({ type, status }) => `| \`${type}\` | ${status} |`)
    .join('\n');
  return {
    id: 'errors',
    title: 'Errors',
    markdown: `Every error has the same envelope. Switch on \`error.type\`; the HTTP status follows from it and the two never disagree.

\`\`\`json
{
  "error": {
    "type": "validation",
    "message": "limit must be between 1 and 100",
    "request_id": "01JAB2…",
    "details": { "field": "limit" }
  }
}
\`\`\`

Quote \`request_id\` when you contact support. \`details\` is optional and depends on the type.

| Type | HTTP status |
| --- | --- |
${rows}`,
  };
}

/** The guides in reading order. */
export function buildPublicGuides(): GuideSection[] {
  return [authentication(), webhooks(), rateLimits(), errors()];
}
