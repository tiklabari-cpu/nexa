/**
 * Environment parsing. Validated once at boot so a misconfigured deployment
 * fails immediately with a readable message, rather than at the first request
 * that happens to touch the missing value.
 */
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '@siyahtus/types';
import { TENANT_TRANSACTION_TIMEOUT_MS } from '../lib/tenant.js';
import { consoleRedirectUri, DEV_CONSOLE_REDIRECT } from '../lib/console-redirect.js';
// The provider vocabularies live with their factories, not here: a value this
// schema accepts and no factory implements is exactly the drift M-PROV-a exists
// to close, and one list read from both ends cannot drift. None of these
// modules reaches back into this one, so there is no import cycle.
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDERS,
  type EmbeddingProviderOptions,
} from '../services/ai/provider/embedding-provider.js';
import { LLM_PROVIDERS, type LlmProviderOptions } from '../services/ai/provider/llm-provider.js';
import {
  embeddingEndpointProblem,
  llmEndpointProblem,
} from '../services/ai/provider/provider-hosts.js';
import { SIEM_PROVIDERS } from '../services/audit/siem-target.js';
import { PAYMENT_PROVIDERS } from '../services/billing/payment-provider.js';
import { MAIL_PROVIDERS, type MailerOptions } from '../services/mail/mailer.js';
import { SMTP_DEFAULT_TIMEOUT_MS } from '../services/mail/smtp-mailer.js';
import { PUSH_PROVIDERS } from '../services/push/push-provider.js';
import { type ObjectStoreOptions, STORAGE_PROVIDERS } from '../services/storage/object-store.js';
import { OTEL_EXPORTERS } from '../telemetry/telemetry.js';

const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !/^(changeme|secret|password)$/i.test(v), 'must not be a placeholder value');

/**
 * Reads `WEB_ORIGIN` as a comma-separated origin list, or `null` if any entry is
 * not an origin (M-PROD-CFG-b).
 *
 * Returning `null` rather than throwing lets the schema report the failure the
 * way it reports every other one — `WEB_ORIGIN: <reason>` inside the single
 * "Invalid environment" message — and it is what makes a malformed value
 * fail *closed*: the process does not start, instead of starting with an
 * allowlist that matches nothing (every panel request refused) or, worse, one
 * silently widened by an entry a browser will never send.
 *
 * An origin is `scheme://host[:port]` and nothing more, because that is exactly
 * what a browser puts in `Origin` and what `@fastify/cors` compares against. A
 * trailing slash is accepted and normalised away — `new URL()` gives `/` a
 * pathname whether or not one was typed, so refusing it would only punish a
 * paste — but a real path, query, fragment or userinfo is refused: it means
 * whoever set this pasted a URL, and the value would never match anything.
 */
function parseOriginList(value: string): string[] | null {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return null;

  const origins: string[] = [];
  for (const entry of entries) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
    if (url.username !== '' || url.password !== '') return null;
    origins.push(url.origin);
  }
  return [...new Set(origins)];
}

/**
 * A single `scheme://host[:port]` and nothing else — the same shape
 * `parseOriginList` accepts, reused for `STORAGE_S3_ENDPOINT`.
 *
 * Reusing it is the point rather than a saving: an endpoint carrying a path
 * would silently prefix every object key, and one carrying userinfo would put a
 * credential somewhere the SigV4 signature does not cover.
 */
function isOrigin(value: string): boolean {
  return parseOriginList(value)?.length === 1;
}

/**
 * The `scheme://host[:port]` a browser puts in `Origin` for a page loaded from
 * this URL, or `null` if no browser ever would (tm 243).
 *
 * Separate from `parseOriginList` because the value it reads — `WIDGET_BASE_URL`
 * — is a base *URL*, not an origin: serving the widget from a path on an
 * existing host (`https://panel.example.com/widget/`) is a real deployment, and
 * the allowlist question is about the host it lands on, not the path.
 */
function originOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.origin;
}

/** Exported so `env.parity.test.ts` can enumerate keys off `.shape` rather than re-parsing this file as text. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Which region *this process* serves (C4-a). Not the region of any workspace
   * it happens to hold — a workspace carries its own on `organizations.region`,
   * and reconciling the two is C4-b's job, where a mismatch becomes a 421.
   * Widened from `z.literal('eu')`: `us` has to pass here and in the RTM
   * gateway's identical schema, or a US deployment cannot boot at all.
   */
  SIYAHTUS_REGION: z.enum(REGIONS).default(DEFAULT_REGION),

  DATABASE_URL: z.string().url(),
  /**
   * Runtime connection. Uses the non-owner `siyahtus_app` role, because Postgres
   * exempts table owners and superusers from row level security — connecting as
   * the owner would silently disable every tenant isolation policy.
   */
  DATABASE_APP_URL: z.string().url().optional(),
  /**
   * Prisma connection pool size for this process, applied as the
   * `connection_limit` query parameter on {@link Env.runtimeDatabaseUrl}
   * (M-SCALE-b · NFR-R4).
   *
   * Unset, Prisma sizes the pool from the CPU count
   * (`num_physical_cpus * 2 + 1`) — a sensible default for one process against
   * a database nobody else uses, and the wrong one once pod count becomes a
   * scaling knob: every pod's default pool grows with cluster capacity, not
   * with a budget anyone chose, while Postgres enforces a hard
   * `max_connections` (200 in `docker-compose.yml`) regardless of what any
   * client asks for. See "Connection pool budget" in README.md for the
   * arithmetic before raising pod count in production.
   *
   * A connection string that already names `connection_limit` is left alone —
   * this is a deployment default, not a way to override an explicit one.
   */
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().optional(),
  /**
   * Optional read replica for the heavy, read-only report path
   * (M-SCALE-c · NFR-P7 · NFR-R4). Unset — the normal case, and every
   * deployment in this repo — reads fall back to the primary and behaviour is
   * byte-for-byte what it has always been.
   *
   * Two things it is not. It is not a general read/write split: only the
   * surfaces named in `plugins/database.ts` route here, and everything that
   * has to read its own writes (billing counters, ADR-09's `ai_resolutions`,
   * every mutation path) stays on the primary, because a replica is behind by
   * an amount nobody controls.
   *
   * And it is not an escape from row level security. This connection must use
   * the same non-owner role as {@link Env.runtimeDatabaseUrl}: PostgreSQL
   * exempts table owners from RLS, so a replica URL carrying the owner's
   * credentials would answer report queries with every tenant's rows and look
   * exactly like a working replica while doing it. `parseEnv` refuses that
   * combination outright rather than trusting a deployment to notice.
   */
  DATABASE_REPLICA_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  /**
   * How many reverse-proxy hops in front of this process are trusted, and so
   * how far into `X-Forwarded-For` `request.ip` is allowed to read
   * (NFR-S9 · M-PROD-CFG-b). See `server.ts`, which hands it to Fastify.
   *
   * A count, not a comfort setting: `request.ip` decides the anonymous
   * rate-limit bucket, the customer IP ban and the agent IP allow-list, and
   * proxy-addr returns the entry `hops` places from the right of the chain. Set
   * it *higher* than the number of proxies that actually append to the header
   * and that entry becomes one the caller wrote — the allow-list is then
   * bypassed by a header anyone can send. Set it lower and every request appears
   * to come from your own proxy, which quietly collapses all three decisions
   * onto one address.
   *
   * `0` is the right value for a process reached directly, with no proxy in
   * front: the header is ignored entirely and the socket peer is used. It is not
   * a disabled state — it is the correct topology for a deployment that has no
   * proxy, and leaving the default `1` there is what would be unsafe.
   *
   * Capped: past a handful this stops describing a topology and starts meaning
   * "trust the whole chain", which is the failure it exists to prevent, so a
   * fat-fingered `TRUST_PROXY_HOPS=100` fails at boot rather than becoming it.
   */
  TRUST_PROXY_HOPS: z
    .preprocess(
      // `z.coerce.number()` reads '' as 0, and 0 is a real value here rather
      // than an absent one. Someone who wrote a bare `TRUST_PROXY_HOPS=` in a
      // unit file meant "leave it at the default", not "ignore
      // `X-Forwarded-For`" — and behind a proxy the difference is every agent
      // being shut out by their own IP allow-list, because every request would
      // appear to come from the proxy. Refuse it rather than guess.
      (value) => (value === '' ? Number.NaN : value),
      z.coerce.number().int().min(0).max(8),
    )
    .default(1),
  /**
   * How long a shutting-down process keeps answering before it starts closing
   * (M-OPS-b). Milliseconds.
   *
   * The window sits between "readiness turns false" and "stop accepting": an
   * orchestrator only stops routing to an instance after its next readiness
   * probe fails, and anything it routed in the meantime has to land somewhere.
   * Close immediately and those requests meet a socket that is already gone —
   * which is the connection reset a rolling deploy shows up as, and the whole
   * reason this key exists. Size it at or above the readiness probe period of
   * whatever runs this (Kubernetes defaults to 10s).
   *
   * Unset it follows the environment, the way `SCHEDULER_ENABLED` does: the
   * window is production's, and zero everywhere else. There is no orchestrator
   * watching a `make dev` or a test, so waiting there would only add seconds to
   * every Ctrl-C and to every suite that closes a server — and the suites close
   * hundreds. An explicit value overrides in any environment, which is how the
   * integration test drives the real wait without waiting the real length.
   *
   * Capped: past a couple of minutes the orchestrator's own grace period
   * (`terminationGracePeriodSeconds`, 30s by default) expires first and SIGKILL
   * lands mid-drain — a value that large does not do what it says.
   */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(120_000).optional(),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  /// Where invitation links point. The agent app, not the API. Its origin is
  /// also the console callback every first-party OAuth client registers
  /// (`consoleRedirectUri` below · tm 255.17).
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  /// Outgoing mail is written here rather than sent (PLAN A4).
  MAIL_DIR: z.string().default('.data/mail'),
  /// Push notifications are written here rather than delivered — there is no
  /// APNs/FCM key to hold (13.7-d). Partitioned by license underneath, so a
  /// cross-tenant delivery would be visible as a file in the wrong directory.
  PUSH_DIR: z.string().default('.data/push'),
  RTM_BASE_URL: z.string().default('ws://localhost:4001'),
  /**
   * Origins the API answers cross-origin, as a comma-separated list
   * (M-PROD-CFG-b). Read through `webOrigins` below; only production consults
   * it, where `server.ts` hands the list to `@fastify/cors` as the allowlist.
   *
   * A list rather than one value because a deployment routinely serves the
   * agent panel and the hosted chat page (FR-MOD-08.5.9) from separate hosts,
   * and with `credentials: true` the alternative to naming them is reflecting
   * whatever origin asks — which would let any page a signed-in agent visits
   * read this API with that agent's session.
   *
   * The list is not only about the panel: `productionProblems` refuses to boot
   * unless it also contains `WIDGET_BASE_URL`'s origin (tm 243). Everything a
   * customer ever sees is served from there.
   */
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .refine((value) => parseOriginList(value) !== null, {
      message:
        'must be one or more comma-separated origins of the form scheme://host[:port] (e.g. "https://panel.example.com,https://chat.example.com") — no path, query or fragment',
    }),
  /// Origin serving the widget loader + iframe. The install snippet points
  /// `window.__siyahtus.widgetOrigin` and the async `loader.js` at it. In
  /// production its origin has to appear in `WEB_ORIGIN` above, or the widget's
  /// own calls to this API are refused by CORS — see `productionProblems`.
  WIDGET_BASE_URL: z.string().url().default('http://localhost:5174'),
  /// Domain a workspace forwards its support mail to (FR-MOD-08.5.3). The
  /// per-workspace address is `<organization_id>@<domain>`; the inbound webhook
  /// reads the local part back to route the message. Must match what the web
  /// app shows on the Email channel card (`VITE_INBOUND_EMAIL_DOMAIN`).
  INBOUND_EMAIL_DOMAIN: z.string().default('inbound.siyahtus.localhost'),
  /// Shared secret the mail provider presents on the inbound webhook, standing
  /// in for a signed request. Optional in dev/test, where leaving it unset keeps
  /// the endpoint open (the recipient address is the only routing key) and the
  /// alternative would be a key nobody has. **Required in production** — see
  /// `productionProblems` below, which is where "optional" stops being safe.
  INBOUND_EMAIL_SECRET: z.string().optional(),

  JWT_SIGNING_KEY: secret(32),
  WEBHOOK_HMAC_SEED: secret(32),
  CUSTOMER_TOKEN_SECRET: secret(32),
  UPLOAD_SIGNING_KEY: secret(32),
  /**
   * Root of the audit chain's per-workspace HMAC keys (NFR-C6 · C6-c).
   *
   * The one secret in this list that must survive a database restore: it is
   * held here precisely so that whoever holds the database does not hold it,
   * which is what makes a hash chain evidence of tampering rather than a
   * checksum against corruption. Rotating it does not invalidate the trail —
   * entries already written keep verifying under the old value — but it does
   * mean the old value has to be kept to verify them, so treat a rotation as
   * archiving a key rather than replacing one.
   */
  AUDIT_CHAIN_SECRET: secret(32),

  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().max(3600).default(3600),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
  CUSTOMER_TOKEN_TTL: z.coerce.number().int().positive().default(28_800),
  AUTH_CODE_TTL: z.coerce.number().int().positive().max(600).default(120),
  /**
   * How long the two-factor enrollment ticket lives (NFR-S11 · S11-2FA-k).
   *
   * Longer than `AUTH_CODE_TTL` because a person is doing more than a redirect:
   * installing an authenticator app, typing or scanning a secret, waiting for
   * the next code. Ten minutes is enough for that on a first attempt and short
   * enough that a ticket left in a closed tab is dead before anyone could go
   * looking for it. Capped at half an hour — past that it stops being a step in
   * a sign-in and starts being a session, which is the one thing it must not be.
   */
  TWO_FACTOR_ENROLLMENT_TICKET_TTL: z.coerce.number().int().positive().max(1800).default(600),

  RATE_LIMIT_AGENT_PER_MIN: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_AGENT_BURST: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_CUSTOMER_PER_MIN: z.coerce.number().int().positive().default(60),
  /** Unauthenticated callers, per IP: sign-in, token exchange, widget tokens. */
  RATE_LIMIT_ANON_PER_MIN: z.coerce.number().int().positive().default(30),
  /**
   * Failed token resolutions, per IP (M-SEC-c1 · §D116 LOW/1).
   *
   * Not a traffic bucket like the others — this one bounds a *cost*. Every
   * bearer token that is not a customer token is resolved by an indexed lookup
   * in `auth_resolve_token`, and until this existed a flood of invalid ones
   * bought that lookup per request without ever reaching a limit, because
   * authentication refuses in `onRequest` and the limits ran in `preHandler`.
   * The budget is spent by failures and read before the next credential from
   * the same address is looked up at all, so a flood costs at most this many
   * queries a minute instead of as many as it cares to send.
   *
   * 60 rather than the anon bucket's 30, and it is a different question: a
   * correct client produces a failed *resolution* only when a token has just
   * died, so this is one refusal a second for an address that is producing
   * nothing but refusals — while leaving an order of magnitude of headroom for
   * a shared office address where a deploy expired everyone's session at once.
   * An address that does trip it recovers on its own within the 60s window, is
   * told when by `Retry-After`, and can re-authenticate meanwhile: sign-in and
   * token exchange are public routes that carry no `Authorization` header, so
   * this budget never touches them.
   */
  RATE_LIMIT_AUTH_FAILURES_PER_MIN: z.coerce.number().int().positive().default(60),
  /**
   * Anonymous public-KB reads, per IP (PUBKB-c). Higher than the general anon
   * limit because this is the SEO surface a search crawler indexes — the shared
   * 30/min would throttle a legitimate crawl. Its own `rl:pubkb:<ip>` bucket.
   */
  RATE_LIMIT_PUBKB_PER_MIN: z.coerce.number().int().positive().default(300),
  /**
   * SCIM provisioning connectors, per token (NFR-S11 · ADR-07). Higher than the
   * agent limit because a directory sync is bursty by nature — a full
   * reconciliation pages the whole workspace and then patches everyone who
   * changed — and one connector's burst must not be able to throttle another
   * workspace's, which the per-token key already guarantees. Still bounded: a
   * stolen SCIM token is the credential for an entire organisation's user
   * lifecycle, so it gets a ceiling like everything else.
   */
  RATE_LIMIT_SCIM_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_RTM_PER_SEC: z.coerce.number().int().positive().default(10),
  /**
   * `/health`, per IP (M-SEC-b2 · §D116 MEDIUM (b)). Anonymous, but no longer
   * `skipRateLimit` — a bare probe is unauthenticated by nature, so it shares
   * the anon bucket's shape (keyed by IP) rather than the anon bucket itself:
   * a monitor polling every few seconds must never compete with sign-in/token
   * traffic for the same 30/min. High on purpose — this ceiling exists only to
   * bound abuse of a public endpoint, not to throttle legitimate polling; set
   * it too low and an orchestrator's own liveness probe starts failing the
   * instance it is trying to keep in rotation.
   */
  RATE_LIMIT_HEALTH_PER_MIN: z.coerce.number().int().positive().default(600),
  /**
   * Second-factor code presentations at `/auth/authorize`, per **account** and
   * per **hour** (NFR-S11 · S11-2FA-e).
   *
   * Keyed by account rather than by IP because the thing being guessed belongs
   * to an account: a six-digit code with a one-step drift window either side is
   * three live values in a million, and spreading the guesses across addresses
   * is the first thing anyone would do. Unreachable without the password —
   * the gate runs after it has been verified — so this cannot be used to lock a
   * stranger out; whoever can spend a slot could, before this existed, have
   * signed in outright.
   *
   * An hour, not a minute, and that is the whole point. Every other bucket here
   * shapes traffic, where a short window is right; this one has to *bound a
   * search*, and a window that resets every minute bounds nothing — 20/min is
   * 28,800 guesses a day and a six-digit code inside a fortnight. At 20/hour the
   * same search runs for years, while a person mistyping their code three times
   * and a client retrying on a flaky connection never come close.
   */
  RATE_LIMIT_TWO_FACTOR_PER_HOUR: z.coerce.number().int().positive().default(20),

  /**
   * Data retention windows in days (NFR-C8). Each is a positive integer; the
   * pruning job hard-deletes data older than its window. Defaults sit at the top
   * of the PRD's configurable tiers (conversations 365) and tighter for pure
   * telemetry and transient mail. See services/retention/policy.ts.
   */
  RETENTION_THREAD_DAYS: z.coerce.number().int().positive().default(365),
  RETENTION_VISIT_DAYS: z.coerce.number().int().positive().default(90),
  RETENTION_MAIL_DAYS: z.coerce.number().int().positive().default(30),
  /** Audit log window (NFR-S12: "last 30 days" of basic audit, every plan). */
  RETENTION_AUDIT_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * How far behind "now" the SIEM export stops (NFR-C6 · C6-b), in
   * milliseconds.
   *
   * Not a throttle — a correctness bound. An audit row's `created_at` is
   * `CURRENT_TIMESTAMP`, which Postgres fixes at the *start* of the writing
   * transaction, so a row can become visible with a timestamp already behind
   * one the export has passed. Exporting right up to `now()` would therefore
   * step over entries written by transactions still in flight, and step over
   * them permanently: the cursor only moves forward. The default is
   * `TENANT_TRANSACTION_TIMEOUT_MS` — the longest a tenant transaction may run
   * before Prisma rolls it back, and so the longest an entry's timestamp can
   * precede its commit.
   *
   * Zero disables the horizon. Legitimate where nothing writes concurrently
   * with the export (the integration suites, a single-user e2e run); a
   * deployment that sets it is choosing to lose entries under load.
   */
  SIEM_EXPORT_HORIZON_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(TENANT_TRANSACTION_TIMEOUT_MS),
  /**
   * Where the scheduled sink writes the mock SIEM target (NFR-C6 · C6-d).
   * Inside `.data/`, like `MAIL_DIR` and `STORAGE_LOCAL_DIR` — ignored, and the
   * whole of what this deployment can honestly offer in place of a real
   * Splunk/Sentinel/Datadog connector (a project boundary).
   */
  SIEM_DIR: z.string().default('.data/siem'),
  /**
   * Where the scheduled sink delivers (NFR-C6 · C6-d · M-PROV-a). `file` writes
   * the sealed NDJSON page plus its `.sig` sidecar under `SIEM_DIR`. A workspace
   * may only choose a `SIEM_EXPORT_TARGETS` value this deployment implements —
   * the sink fails loudly on a row naming anything else, rather than quietly
   * shipping nothing. See services/audit/siem-target.ts.
   */
  SIEM_PROVIDER: z.enum(SIEM_PROVIDERS).default('file'),

  /**
   * Length of a new workspace's trial, in days (FR-MOD-10.2). Read at sign-up
   * (`LifecycleService`) — until tm 256.1 this key was parsed and then ignored,
   * and every trial was the hard-coded 14. It only shapes workspaces created
   * after a change; an existing trial keeps the end date it was given. Capped at
   * ten years: past that it stops describing a trial.
   */
  TRIAL_DAYS: z.coerce.number().int().positive().max(3650).default(14),
  UNIT_PRICE_CENTS: z.coerce.number().int().nonnegative().default(9900),
  AI_RESOLUTIONS_INCLUDED: z.coerce.number().int().nonnegative().default(200),
  AI_OVERAGE_CENTS: z.coerce.number().int().nonnegative().default(50),
  // API-call metering (FR-MOD-10.1.5). Overage is sold by the block: $29.50 per
  // 100,000 calls beyond the included allowance (PRD §10.1.5). The defaults are
  // the same numbers the seed stamps onto a usage record, so the meter and the
  // seeded demo can never quote different figures.
  API_CALLS_INCLUDED: z.coerce.number().int().nonnegative().default(100_000),
  API_CALL_OVERAGE_CENTS: z.coerce.number().int().nonnegative().default(2_950),

  /**
   * Who writes AI text (tm 255.5 · ADR docs/adr/pilot-llm-embedding-provider.md
   * §9.1). `mock` is the in-process deterministic stub and stays the default —
   * every test suite and any deployment without a model runs on it. `openai`
   * is the chat adapter (tm 255.6, `services/ai/provider/openai-llm-provider.ts`)
   * and needs the three `LLM_API_*`/`LLM_MODEL` keys below; without them it
   * refuses to boot rather than quietly running the stub (`createLlmProvider`).
   */
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('mock'),
  /**
   * Where `LLM_PROVIDER` runs the inference (NFR-C4 · C4-e). Unset means "the
   * same region as this process", which is the truth for the in-process stub and
   * the only honest default: a deployment pointing at a model service somewhere
   * else has to say so, because a workspace under a signed BAA may not have its
   * content inferred outside its own region. See services/ai/inference.ts.
   */
  LLM_PROVIDER_REGION: z.enum(REGIONS).optional(),
  /**
   * The provider's `/v1` base URL. Its host has to be the regional host that
   * matches `LLM_PROVIDER_REGION` in production (`productionProblems`,
   * `services/ai/provider/provider-hosts.ts`); the schema only asks for a URL,
   * so a developer can point it anywhere locally.
   */
  LLM_API_BASE_URL: z.string().url().optional(),
  /** The model id. The operator's choice; the code names none. */
  LLM_MODEL: z.string().min(1).optional(),
  /**
   * Bearer key for `LLM_PROVIDER≠mock`. A credential the provider issues, not
   * key material this process mints — so not a `secret()`, for `SMTP_PASSWORD`'s
   * reason. Its value is never logged, echoed or written anywhere but `.env`.
   */
  LLM_API_KEY: z.string().min(1).optional(),
  /**
   * How long one inference may take before it is abandoned. Handed to the
   * provider on every call (`LlmCompletionRequest.timeoutMs`).
   */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(20_000),
  /**
   * Reply ceiling per call, in tokens. 400 covers the longest persona budget
   * (`long`: 1,200 characters, roughly 300 tokens) with room for a language
   * that tokenises worse than English.
   */
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(16_384).default(400),
  /**
   * Prompt ceiling per call, in characters (tm 255.9 · ADR §9.1): a prompt
   * longer than this is never sent — the conversation goes to a human, the way
   * any other failed call does. Characters rather than tokens because the
   * server has no tokenizer, and a character is a conservative upper bound on
   * a token. 16,000 admits every prompt built from passages the chunker cut to
   * its 600-character target: the longest — a 10,000-character customer
   * message, three such passages and the instructions — measures 12,361, and
   * 14,161 when every passage character is one JSON has to escape. What it
   * stops is the passage the chunker could not cut (it breaks only between
   * sentences, so an unpunctuated page stays one piece of any length), which
   * would otherwise reach the model whole on every question it matched. Below
   * 2,000 not even the instructions and one passage fit, and every
   * conversation would be refused.
   */
  LLM_MAX_PROMPT_CHARS: z.coerce.number().int().min(2_000).max(500_000).default(16_000),
  /**
   * Who turns text into vectors for knowledge retrieval (tm 255.7 · ADR
   * docs/adr/pilot-llm-embedding-provider.md §9.2). Configured apart from
   * `LLM_PROVIDER`: its own key, host, model and region. `mock` is the lexical
   * stub every test and the seed use; `openai` is the adapter in
   * `services/ai/provider/openai-embedding-provider.ts` and needs the three
   * keys below, or it refuses to boot rather than quietly embedding with the
   * stub. Changing it moves new vectors into another space — the knowledge
   * already stored is re-embedded with `knowledge:reembed` (PLAN §D182).
   */
  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDERS).default('mock'),
  /**
   * Where `EMBEDDING_PROVIDER` embeds (NFR-C4). The query path embeds the
   * customer's own message, so this is held to the rule `LLM_PROVIDER_REGION`
   * is: unset means "this process's region", true only of the stub, and a
   * covered workspace refuses every AI feature when either provider is out of
   * its region (`services/ai/inference.ts`).
   */
  EMBEDDING_PROVIDER_REGION: z.enum(REGIONS).optional(),
  /** The provider's `/v1` base URL; the regional host for the region in production. */
  EMBEDDING_API_BASE_URL: z.string().url().optional(),
  /** The model id (pilot: `text-embedding-3-small`). Part of the space vectors are stored in. */
  EMBEDDING_MODEL: z.string().min(1).optional(),
  /** Bearer key for `EMBEDDING_PROVIDER≠mock`; `LLM_API_KEY`'s rules. May hold the same value. */
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  /**
   * Not a setting — an assertion (ADR §9.2). `knowledge_chunks.embedding` is
   * `vector(1536)`, so any other value is refused here, at boot, instead of
   * as a failed insert on the first upload. A model that is not 1536 wide
   * needs a migration and a full re-embed (ADR §4.3), not a new number.
   */
  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .refine(
      (value) => value === EMBEDDING_DIMENSIONS,
      `must be ${EMBEDDING_DIMENSIONS}: knowledge_chunks.embedding is vector(${EMBEDDING_DIMENSIONS}), and a model of another width needs a migration and a full re-embed, not a setting`,
    )
    .default(EMBEDDING_DIMENSIONS),
  /**
   * How long one embedding request — its retries included — may take. Separate
   * from `LLM_TIMEOUT_MS` (ADR §9.2): on the query path it is added to the
   * customer's wait before the model is even asked, and a question embeds in a
   * fraction of a second, so it is kept well under the chat timeout.
   */
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(10_000),
  /**
   * Outgoing mail (M-PROV-a). `file` writes each message under `MAIL_DIR`
   * instead of sending it (PLAN A4); `null` discards, which is what the test
   * fixture asks for so a suite that sends hundreds of invitations leaves
   * nothing behind. Named after what the implementation does rather than after
   * the environment that wants it: `server.ts` used to pick off `NODE_ENV`,
   * which made this key validated-but-unread.
   */
  MAIL_PROVIDER: z.enum(MAIL_PROVIDERS).default('file'),
  /**
   * PrivateEmail SMTP settings `MAIL_PROVIDER=smtp` sends with (ADR
   * docs/adr/pilot-llm-embedding-provider.md §9.3). The contract opened here
   * in tm 255.2 — schema, four-source parity and the production boot check —
   * and the carrier that reads it is `services/mail/smtp-mailer.ts` (tm 255.3),
   * through `env.mail` below.
   *
   * All optional at the schema level: which of them is actually required
   * depends on `MAIL_PROVIDER` (see `productionProblems` below), and a
   * `file`/`null` deployment — including every test suite and CI — should
   * not have to carry six settings for a provider it never selects.
   */
  SMTP_HOST: z.string().min(1).optional(),
  /** 465 (implicit TLS) or 587 (STARTTLS) — PrivateEmail supports both. */
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /**
   * `true` connects with TLS from the first byte (port 465); `false` starts
   * plaintext and upgrades with STARTTLS (port 587). There is no third,
   * unencrypted value — PrivateEmail refuses a plaintext session either way,
   * and the carrier refuses a server that does not offer STARTTLS. Unset, it
   * follows the port: `true` on 465, STARTTLS otherwise. Nothing here, or
   * anywhere, turns certificate verification off.
   */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** PrivateEmail authenticates with the full mailbox address as the username. */
  SMTP_USERNAME: z.string().min(1).optional(),
  /**
   * Not declared with `secret()`: unlike `SECRET_KEYS`, this is a credential
   * the mail provider issues rather than key material this process mints, and
   * `smtp` is not the default provider, so there is no `file`/`null`
   * deployment to protect from a floor it can never meet. The `dev-only-`
   * placeholder is still refused in production, by `productionProblems` below.
   */
  SMTP_PASSWORD: z.string().min(1).optional(),
  /** Pilot: `info@nolnk.net` — an address, not a secret. */
  SMTP_FROM: z.string().min(1).optional(),
  /**
   * Applied to the connection and to every reply the carrier waits for, not to
   * the message as a whole. Unset: 10 s (`SMTP_DEFAULT_TIMEOUT_MS`).
   */
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  /**
   * Outgoing push (M-PROV-a). Same pair of mocks as the mailer, spooling under
   * `PUSH_DIR` (13.7-d). A newer key than the rest — this channel arrived after
   * the others had theirs, and inherited the `NODE_ENV` branch instead.
   */
  PUSH_PROVIDER: z.enum(PUSH_PROVIDERS).default('file'),
  STORAGE_PROVIDER: z.enum(STORAGE_PROVIDERS).default('local'),
  /** Where the `local` provider keeps uploads. Inside `.data/`, which is ignored. */
  STORAGE_LOCAL_DIR: z.string().default('.data/uploads'),
  /**
   * The S3-compatible bucket the `s3` provider uses (M-STORE-a · NFR-R1).
   *
   * All optional here and none optional in practice: `STORAGE_PROVIDER=s3`
   * without them is refused at boot by `storageProblems` below. Declaring them
   * required outright would make every `local` deployment — which is the
   * default, CI included — carry five settings for a provider it never builds.
   *
   * The endpoint is an origin, checked the way `WEB_ORIGIN` is: a pasted path
   * or query would otherwise end up prefixing every object key, and the
   * signature would commit to a path the request never used.
   */
  STORAGE_S3_ENDPOINT: z
    .string()
    .refine((value) => isOrigin(value), 'must be a scheme://host[:port] origin')
    .optional(),
  /**
   * Bucket names are DNS labels, and this one is concatenated into a URL path
   * (or a hostname). The pattern is what keeps a stray `..` or `/` out of both.
   */
  STORAGE_S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name')
    .optional(),
  /** Signed into every request; S3 rejects a signature scoped elsewhere. */
  STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  /**
   * Not declared with `secret()`: MinIO ships with `minioadmin`, a 32-character
   * floor would refuse the very deployment this is first used against, and this
   * is a credential the bucket issues rather than key material this process
   * mints. It is never logged — `s3-store.ts` keeps it out of every error it
   * raises.
   */
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** `<endpoint>/<bucket>/<key>`. On by default: MinIO cannot do bucket subdomains. */
  STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Ceiling on one bucket request. Sized for the 25 MiB the PUT route buffers. */
  STORAGE_S3_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(10_000),
  /** How long a signed upload URL stays usable. One shot, so this is short. */
  UPLOAD_URL_TTL: z.coerce.number().int().positive().max(3600).default(300),
  /**
   * The payment processor (M-PROV-a). `mock` accepts any unexpired card and
   * charges nothing (ADR-13); a real Stripe provider slots in behind
   * `PaymentProvider`. See services/billing/payment-provider.ts.
   */
  STRIPE_PROVIDER: z.enum(PAYMENT_PROVIDERS).default('mock'),
  /**
   * Upload virus scanning (FR-MOD-08.9.4). `mock` flags the EICAR test file and
   * passes the rest; `unavailable` is always-down, for exercising the fail-closed
   * path in tests and drills. A real ClamAV provider slots in here later.
   */
  VIRUS_SCANNER: z.enum(['mock', 'unavailable']).default('mock'),

  /**
   * Background job scheduler (M-SCHED · §D113/K1). Unset it follows the
   * environment: on in dev/prod, off under test — the suites must not have a
   * sweep archiving their fixtures underneath them, and every one of them boots
   * a server. `true`/`false` overrides either way.
   *
   * Off does not mean the sweeps are unreachable: each one keeps its
   * `pnpm --filter @siyahtus/api <job>:run` script, which is also how a deployment
   * that would rather drive them from a host cron does it.
   */
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /**
   * How far each interval is spread, in percent. Instances that came up from one
   * deploy would otherwise tick in lockstep forever, and every tick but one
   * would be a wasted round trip to the lock. Capped well below 100 because a
   * spread wide enough to reorder intervals is no longer jitter.
   */
  SCHEDULE_JITTER_PCT: z.coerce.number().int().min(0).max(50).default(10),
  /**
   * Per-job intervals in milliseconds (see services/scheduler/intervals.ts).
   *
   * The minute-scale ones are latency budgets a person can feel: an idle chat
   * that stays open, an SLA breach that is not yet marked, a scheduled report
   * that has not gone out. SIEM is coarser because its consumer batches anyway,
   * and retention is hourly because it deletes — there is nothing to gain from
   * looking more often, and a tight loop over every tenant's old rows is real
   * database load.
   */
  SCHEDULE_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SCHEDULE_SLA_MS: z.coerce.number().int().positive().default(60_000),
  SCHEDULE_SIEM_MS: z.coerce.number().int().positive().default(300_000),
  SCHEDULE_SCHEDULED_REPORTS_MS: z.coerce.number().int().positive().default(60_000),
  SCHEDULE_RETENTION_MS: z.coerce.number().int().positive().default(3_600_000),
  SCHEDULE_WEBHOOK_REDELIVERY_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * The knowledge-source freshness sweep (FR-MOD-06.3.3, tm 198.4). Hourly by
   * default, like retention: the windows it acts on are day-granularity, so
   * there is nothing to gain from checking more often.
   */
  SCHEDULE_KNOWLEDGE_REFRESH_MS: z.coerce.number().int().positive().default(3_600_000),
  /**
   * The billing period-close sweep (FR-MOD-10.3, tm 230). Hourly, and the
   * coarsest thing on this list would be defensible too: it acts on a calendar
   * month boundary, so all an interval buys is how soon after midnight on the
   * first the previous month stops being an estimate and becomes a statement.
   * Hourly keeps that under an hour without a per-tenant query every minute for
   * a condition that changes twelve times a year. A pass with nothing to close
   * is one indexed anti-join per workspace.
   */
  SCHEDULE_INVOICE_CLOSE_MS: z.coerce.number().int().positive().default(3_600_000),
  /**
   * Lets the retention job actually run its scheduled pass (M-SCHED-b ·
   * `services/scheduler/types.ts`'s `JobDefinition.enabled`). Off by default:
   * this is the one sweep that hard-deletes data, and there is no operator
   * here to type `--apply` the way `retention:run` asks for outside a
   * scheduler. The job is registered either way, so `/health` always shows
   * it — `disabled` until this is set, never simply absent.
   */
  RETENTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Attempts a webhook delivery gets in total — the three inside the triggering
   * request plus every scheduled redelivery after them (M-SCHED-e).
   *
   * Eight covers roughly four hours of the backoff curve
   * (`webhook-dispatcher.ts`), which is long enough to ride out a receiver's
   * deploy or a brief outage and short enough that a permanently dead endpoint
   * is declared dead the same day. Lowering it takes effect on rows already
   * queued: the sweep will not retry past a cap the deployment has withdrawn.
   */
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * OpenTelemetry tracing + metrics (NFR-M5). Left unset it follows the
   * environment: on in dev/prod (console exporter — there is no collector here,
   * a project boundary), off under test so the suites stay fast. Set it to
   * `true`/`false` to override either way.
   */
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /**
   * Which exporter the OpenTelemetry stack uses once `OTEL_ENABLED` turns it
   * on (M-OTEL-a · M-PROV-a). See `OTEL_EXPORTERS` in telemetry.ts for what
   * each value does — in short, `console` (default, today's behaviour) prints
   * to stdout, `otlp` sends to a real collector, `none` keeps the
   * instrumentation running (spans still carry `request_id`) but exports
   * nothing, at no cost. The vocabulary is imported rather than duplicated
   * here for the same reason `MAIL_PROVIDER` is: a value this schema accepts
   * and no factory implements is exactly the drift M-PROV-a exists to close.
   */
  OTEL_EXPORTER: z.enum(OTEL_EXPORTERS).default('console'),
  /**
   * The collector `OTEL_EXPORTER=otlp` sends to. OpenTelemetry's own standard
   * key, not one invented here — this is the base URL; the per-signal path
   * (`/v1/traces`, `/v1/metrics`) is appended by the factory. Optional even
   * when `otlp` is chosen: the OTLP exporter's own default
   * (`http://localhost:4318`) is a reasonable one for a collector running
   * alongside this process, and reaching a live collector is out of scope
   * here regardless (a project boundary — see telemetry.ts).
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema> & {
  /** Connection string the request path should use — app role when available. */
  runtimeDatabaseUrl: string;
  /**
   * Connection string the read-only report path should use, or undefined when
   * no replica is configured and those reads stay on the primary (M-SCALE-c).
   */
  replicaDatabaseUrl: string | undefined;
  /** `WEB_ORIGIN` parsed and normalised — the CORS allowlist production uses. */
  webOrigins: string[];
  /**
   * The agent console's OAuth callback — `WEB_APP_URL`'s origin +
   * `/auth/callback` (tm 255.17). What a new workspace's first-party client
   * registers at signup, and what boot adds to every existing one.
   *
   * Outside production a `WEB_APP_URL` that cannot be a redirect (plain `http`
   * on a LAN address, say — set for the links in mail) falls back to the
   * development callback rather than refusing to boot: the panel on
   * `localhost:5173` keeps working as it did. Production refuses such a value
   * in `productionProblems`, so this fallback never reaches a real deployment.
   */
  consoleRedirectUri: string;
  /**
   * Everything `createObjectStore` needs, gathered in one place (M-STORE-a).
   *
   * The three routes that build a store used to write `{ localDir:
   * env.STORAGE_LOCAL_DIR }` by hand, which was fine while `local` was the only
   * provider and became a trap the moment it was not: `STORAGE_PROVIDER` is
   * read at runtime, so a call site cannot know which provider's settings it is
   * expected to carry, and each new one would have had to be threaded through
   * all three. Derived here instead, so that was the last time they change.
   */
  storage: ObjectStoreOptions;
  /**
   * Everything `createMailer` needs (tm 255.3), on `storage`'s terms: the four
   * call sites pass this whole, so a provider that needs more settings changes
   * this assembly, not them.
   */
  mail: MailerOptions;
  /** Everything `createLlmProvider` needs (tm 255.5), on `mail`'s terms. */
  llm: LlmProviderOptions;
  /** Everything `createEmbeddingProvider` needs (tm 255.7), on `llm`'s terms. */
  embedding: EmbeddingProviderOptions;
  isProduction: boolean;
  isTest: boolean;
  /** Whether OpenTelemetry instrumentation is active for this process. */
  otelEnabled: boolean;
  /** Whether this process runs the background sweeps (M-SCHED). */
  schedulerEnabled: boolean;
  /** Resolved shutdown drain window in milliseconds (M-OPS-b). */
  shutdownDrainMs: number;
};

/**
 * The keys `secret()` builds — everything this schema treats as key material.
 *
 * Exported so the production check below and its test read one list rather than
 * two that drift: a sixth secret added to the schema and not here would boot in
 * production still holding its published `dev-only-` placeholder, and
 * `env.test.ts` derives the same set from `envSchema.shape`, so the omission
 * fails the suite instead of shipping.
 */
export const SECRET_KEYS = [
  'JWT_SIGNING_KEY',
  'WEBHOOK_HMAC_SEED',
  'CUSTOMER_TOKEN_SECRET',
  'UPLOAD_SIGNING_KEY',
  'AUDIT_CHAIN_SECRET',
] as const;

/**
 * A `<…>` fill-in from `.env.production.example` (`<owner_password>`,
 * `<üret: openssl rand -hex 32>`, `<from your provider>`). No configuration
 * value this process reads has a legitimate use for angle brackets — even
 * `SMTP_FROM` has to be a bare address (`smtp-mailer.ts`).
 */
export const TEMPLATE_PLACEHOLDER = /<[^<>]+>/;

/**
 * What production refuses, and why each one is a refusal rather than a default.
 *
 * Every problem is collected before anything is thrown. Failing on the first
 * would turn a misconfigured deployment into a queue of one-line failures —
 * fix, redeploy, discover the next — which defeats the reason this runs at boot
 * at all: whoever is deploying should learn everything that is wrong before any
 * traffic arrives, not one thing per attempt.
 */
function productionProblems(env: z.infer<typeof envSchema>): string[] {
  const problems: string[] = [];

  if (!env.DATABASE_APP_URL) {
    problems.push(
      'DATABASE_APP_URL is required in production: Postgres exempts table owners from row level security, so connecting as the owner silently disables every tenant policy.',
    );
  }

  for (const key of SECRET_KEYS) {
    if (env[key].startsWith('dev-only-')) {
      problems.push(`${key} still holds its development placeholder value.`);
    }
  }

  // `.env.production.example` marks everything a deployer has to supply as
  // `<…>`, and the pilot's `.env` starts life as a copy of it (tm 255.15). Most
  // of those keys are plain strings to the schema, so a copy with one left
  // unfilled booted: `INBOUND_EMAIL_SECRET=<üret: …>` authenticated the inbound
  // webhook with a key printed in this repository, and `LLM_API_KEY=<from your
  // provider>` got as far as the provider's 401. Key name only — the rest of
  // the value can be real.
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && TEMPLATE_PLACEHOLDER.test(value)) {
      problems.push(`${key} still holds a .env.production.example placeholder (<…>).`);
    }
  }

  // `smtp` is not the default provider, so these five stay optional in the
  // schema above; choosing it is what makes them stop being optional. Reported
  // by key name only, never by value — the same discipline as the SECRET_KEYS
  // loop above, for the same reason: this message is exactly what a deployer
  // pastes into a chat asking for help.
  if (env.MAIL_PROVIDER === 'smtp') {
    const required = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'SMTP_FROM',
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        problems.push(`${key} is required in production when MAIL_PROVIDER=smtp.`);
      }
    }
    if (env.SMTP_PASSWORD?.startsWith('dev-only-')) {
      problems.push('SMTP_PASSWORD still holds its development placeholder value.');
    }
  }

  // A remote model is a third party the conversation is sent to, so the three
  // keys that reach it are required and the region it answers in has to be
  // *declared*: unset, `LLM_PROVIDER_REGION` defaults to this process's own,
  // which is true for the stub and an unchecked claim about anyone else
  // (NFR-C4 · ADR §7). The declaration is then checked against the host the
  // requests actually go to. Key names only, never values — as above.
  if (env.LLM_PROVIDER !== 'mock') {
    const required = [
      'LLM_API_BASE_URL',
      'LLM_MODEL',
      'LLM_API_KEY',
      'LLM_PROVIDER_REGION',
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        problems.push(`${key} is required in production when LLM_PROVIDER=${env.LLM_PROVIDER}.`);
      }
    }
    if (env.LLM_API_KEY?.startsWith('dev-only-')) {
      problems.push('LLM_API_KEY still holds its development placeholder value.');
    }
    if (env.LLM_API_BASE_URL && env.LLM_PROVIDER_REGION) {
      const endpoint = llmEndpointProblem(
        env.LLM_PROVIDER,
        env.LLM_API_BASE_URL,
        env.LLM_PROVIDER_REGION,
      );
      if (endpoint) problems.push(endpoint);
    }
  }

  // The same rule for the embedding provider, under its own keys (tm 255.7 ·
  // ADR §7): the query path embeds the customer's message, so a remote
  // embedder is as much a third party the conversation reaches as a model is.
  if (env.EMBEDDING_PROVIDER !== 'mock') {
    const required = [
      'EMBEDDING_API_BASE_URL',
      'EMBEDDING_MODEL',
      'EMBEDDING_API_KEY',
      'EMBEDDING_PROVIDER_REGION',
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        problems.push(
          `${key} is required in production when EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER}.`,
        );
      }
    }
    if (env.EMBEDDING_API_KEY?.startsWith('dev-only-')) {
      problems.push('EMBEDDING_API_KEY still holds its development placeholder value.');
    }
    if (env.EMBEDDING_API_BASE_URL && env.EMBEDDING_PROVIDER_REGION) {
      const endpoint = embeddingEndpointProblem(
        env.EMBEDDING_PROVIDER,
        env.EMBEDDING_API_BASE_URL,
        env.EMBEDDING_PROVIDER_REGION,
      );
      if (endpoint) problems.push(endpoint);
    }
  }

  // Unset, `routes/channels.ts` skips its check entirely and the inbound mail
  // webhook authenticates nobody: the recipient address is the only routing key,
  // and a workspace hands that address to the customers it asks to forward mail
  // to. Fine in development, where the alternative is a key nobody has; in
  // production it is an open door into any workspace whose address is known.
  // Every workspace's first-party OAuth client registers this deployment's own
  // panel address (tm 255.17). One the redirect check can never accept — plain
  // `http` off loopback — would boot fine and then refuse every sign-in with
  // "redirect_uri is not registered", which is the failure this names instead.
  if (consoleRedirectUri(env.WEB_APP_URL) === null) {
    problems.push(
      `WEB_APP_URL must be an https address (or http on localhost / 127.0.0.1) the panel is served from: its origin + /auth/callback is the OAuth redirect every workspace registers, and ${env.WEB_APP_URL} cannot be one.`,
    );
  }

  if (!env.INBOUND_EMAIL_SECRET) {
    problems.push(
      'INBOUND_EMAIL_SECRET is required in production: unset, the inbound mail webhook accepts anyone who knows a workspace address.',
    );
  }

  // The widget half of the product is cross-origin by construction, and the
  // allowlist above is the only thing that lets it through (tm 243).
  //
  // `apps/widget` ships a browser bundle with no same-origin backend at all —
  // its nginx image proxies nothing (`apps/widget/nginx.conf`'s `connect-src`
  // comment) and `loader.ts` refuses to open the widget when its origin matches
  // the page embedding it, so every REST call it makes is cross-origin to this
  // API. A production `WEB_ORIGIN` naming only the panel therefore serves
  // agents and refuses customers, and refuses them the quiet way: the browser
  // drops the response, this process logs a request it answered normally, and
  // `/health` stays green. The repository already measured this once — the full
  // container stack runs `NODE_ENV=development` partly because production CORS
  // cut the widget off (tm 140.3) — and wrote it into a compose comment instead
  // of into the boot, which is how four separate deployment documents went on
  // telling operators to list the panel alone.
  //
  // Naming a *second* origin is not what this demands: a deployment serving the
  // widget from the panel's own host (or from a path on it) already satisfies
  // it, because that origin is on the list. What it forbids is leaving the
  // widget's origin off, whatever that origin turns out to be.
  const widgetOrigin = originOf(env.WIDGET_BASE_URL);
  if (widgetOrigin === null || !(parseOriginList(env.WEB_ORIGIN) ?? []).includes(widgetOrigin)) {
    problems.push(
      `WEB_ORIGIN must include the widget's own origin (${widgetOrigin ?? env.WIDGET_BASE_URL}, from WIDGET_BASE_URL): the widget's browser code calls this API cross-origin, so an allowlist without it answers the agent panel and silently refuses every customer conversation.`,
    );
  }

  return problems;
}

/**
 * Applies `DATABASE_POOL_SIZE` to a Postgres connection string as Prisma's
 * `connection_limit` query parameter. A URL that already names
 * `connection_limit` — set by hand, or by the test harness's
 * `withTestConnectionBudget` — is left alone; this is a deployment default,
 * not a way to fight a more specific override.
 */
function withPoolSize(url: string, poolSize: number | undefined): string {
  if (poolSize === undefined) return url;
  const parsed = new URL(url);
  if (parsed.searchParams.has('connection_limit')) return url;
  parsed.searchParams.set('connection_limit', String(poolSize));
  return parsed.toString();
}

/**
 * The replica may not be a way to reconnect as the table owner (M-SCALE-c).
 *
 * The failure this refuses is silent by construction. PostgreSQL exempts table
 * owners from row level security, so a `DATABASE_REPLICA_URL` carrying the
 * owner's credentials produces report responses that are *bigger* — every
 * tenant's rows, through an endpoint whose only isolation is RLS — and nothing
 * anywhere errors, logs or looks unusual. It is the same class of mistake
 * `DATABASE_APP_URL` exists to prevent, arriving through a second door.
 *
 * The comparison is against the primary rather than against a hard-coded
 * `siyahtus_app`: a replica connecting as some third read-only role is a perfectly
 * reasonable deployment, and this should not forbid it. What it forbids is a
 * replica that is *more* privileged than the connection the request path
 * already uses. Which is also why a deployment with no `DATABASE_APP_URL` at
 * all (development, the test suites) is exempt: there the primary is already
 * the owner, RLS is already off, and a replica on the same credentials takes
 * nothing away that was there to lose.
 */
/**
 * `STORAGE_S3_*` keys that `STORAGE_PROVIDER=s3` cannot do without.
 *
 * Checked in every environment rather than only in production, for the reason
 * `replicaEscalatesPrivilege` is: the failure is silent where it lands. Zod
 * cannot express it — the schema has to keep these optional so the `local`
 * default does not demand five settings for a provider it never builds — so
 * the conditional half lives here, and reports the same way, by key.
 */
function storageProblems(env: z.infer<typeof envSchema>): string[] {
  if (env.STORAGE_PROVIDER !== 's3') return [];
  return (
    [
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
    ] as const
  )
    .filter((key) => !env[key])
    .map((key) => `${key} is required when STORAGE_PROVIDER=s3.`);
}

/**
 * `env.storage` — the single assembly of `ObjectStoreOptions` (M-STORE-a).
 *
 * `s3` is `null` unless the provider is actually `s3`, so a half-filled set of
 * `STORAGE_S3_*` on a `local` deployment cannot be mistaken for a configured
 * bucket by anything downstream. When it is not null, `storageProblems` has
 * already established every field is there — which is what lets this assert
 * rather than guess.
 */
function storageOptions(env: z.infer<typeof envSchema>): ObjectStoreOptions {
  if (env.STORAGE_PROVIDER !== 's3') {
    return { localDir: env.STORAGE_LOCAL_DIR, s3: null };
  }
  return {
    localDir: env.STORAGE_LOCAL_DIR,
    s3: {
      endpoint: env.STORAGE_S3_ENDPOINT!,
      bucket: env.STORAGE_S3_BUCKET!,
      region: env.STORAGE_S3_REGION,
      accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
      timeoutMs: env.STORAGE_S3_TIMEOUT_MS,
    },
  };
}

/**
 * `env.mail` — the single assembly of `MailerOptions` (tm 255.3).
 *
 * `smtp` is `null` unless the provider is `smtp` *and* every key it needs is
 * present, for `storageOptions`'s reason: half a configuration must not look
 * like a configured server downstream. `createMailer` refuses to boot on a
 * `null`, and in production `productionProblems` has already named the missing
 * keys before that.
 */
function mailOptions(env: z.infer<typeof envSchema>): MailerOptions {
  const { SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM } = env;
  if (
    env.MAIL_PROVIDER !== 'smtp' ||
    !SMTP_HOST ||
    !SMTP_PORT ||
    !SMTP_USERNAME ||
    !SMTP_PASSWORD ||
    !SMTP_FROM
  ) {
    return { dir: env.MAIL_DIR, smtp: null };
  }
  return {
    dir: env.MAIL_DIR,
    smtp: {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: env.SMTP_SECURE ?? SMTP_PORT === 465,
      username: SMTP_USERNAME,
      password: SMTP_PASSWORD,
      from: SMTP_FROM,
      timeoutMs: env.SMTP_TIMEOUT_MS ?? SMTP_DEFAULT_TIMEOUT_MS,
    },
  };
}

/**
 * `env.llm` — the single assembly of `LlmProviderOptions` (tm 255.5), on
 * `mailOptions`' terms: `openai` is `null` unless it is the provider and all
 * three of its keys are present, and `createLlmProvider` refuses a `null`.
 */
function llmOptions(env: z.infer<typeof envSchema>): LlmProviderOptions {
  const { LLM_API_BASE_URL, LLM_MODEL, LLM_API_KEY } = env;
  if (env.LLM_PROVIDER !== 'openai' || !LLM_API_BASE_URL || !LLM_MODEL || !LLM_API_KEY) {
    return { openai: null };
  }
  return { openai: { baseUrl: LLM_API_BASE_URL, model: LLM_MODEL, apiKey: LLM_API_KEY } };
}

/**
 * `env.embedding` — the single assembly of `EmbeddingProviderOptions`
 * (tm 255.7), on `llmOptions`' terms: `openai` is `null` unless it is the
 * provider and all three of its keys are present, and
 * `createEmbeddingProvider` refuses a `null`.
 */
function embeddingOptions(env: z.infer<typeof envSchema>): EmbeddingProviderOptions {
  const { EMBEDDING_API_BASE_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY } = env;
  if (
    env.EMBEDDING_PROVIDER !== 'openai' ||
    !EMBEDDING_API_BASE_URL ||
    !EMBEDDING_MODEL ||
    !EMBEDDING_API_KEY
  ) {
    return { openai: null };
  }
  return {
    openai: {
      baseUrl: EMBEDDING_API_BASE_URL,
      model: EMBEDDING_MODEL,
      apiKey: EMBEDDING_API_KEY,
      timeoutMs: env.EMBEDDING_TIMEOUT_MS,
    },
  };
}

function replicaEscalatesPrivilege(env: z.infer<typeof envSchema>): boolean {
  if (!env.DATABASE_REPLICA_URL || !env.DATABASE_APP_URL) return false;
  const owner = new URL(env.DATABASE_URL).username;
  if (new URL(env.DATABASE_APP_URL).username === owner) return false;
  return new URL(env.DATABASE_REPLICA_URL).username === owner;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = result.data;

  // Checked in every environment, unlike the production list below: this is not
  // a deployment default someone might reasonably want to override locally, it
  // is a configuration that turns tenant isolation off on the report path. A
  // developer who wires it up that way should learn at boot, not from a support
  // ticket.
  // Same reasoning, same place in the boot: a deployment that asked for the
  // shared bucket and did not say which one must not start. Falling back to
  // pod-local disk is precisely the NFR-R1 breakage the `s3` provider exists to
  // fix, and it would fail one attachment download in four rather than loudly.
  const storage = storageProblems(env);
  if (storage.length > 0) {
    throw new Error(`Invalid environment:\n${storage.map((p) => `  ${p}`).join('\n')}`);
  }

  if (replicaEscalatesPrivilege(env)) {
    throw new Error(
      "Invalid environment:\n  DATABASE_REPLICA_URL connects as the table owner while DATABASE_APP_URL does not: Postgres exempts owners from row level security, so report queries on the replica would return every tenant's rows.",
    );
  }

  if (env.NODE_ENV === 'production') {
    const problems = productionProblems(env);
    if (problems.length > 0) {
      throw new Error(
        `Invalid environment for NODE_ENV=production:\n${problems.map((p) => `  ${p}`).join('\n')}`,
      );
    }
  }

  return {
    ...env,
    runtimeDatabaseUrl: withPoolSize(
      env.DATABASE_APP_URL ?? env.DATABASE_URL,
      env.DATABASE_POOL_SIZE,
    ),
    // The same pool size as the primary, for the same reason it exists: the
    // replica's connections are drawn from a `max_connections` ceiling too, and
    // a second pool that sized itself from the CPU count would put the budget in
    // README's "Connection pool budget" table quietly back out of reach.
    replicaDatabaseUrl:
      env.DATABASE_REPLICA_URL === undefined
        ? undefined
        : withPoolSize(env.DATABASE_REPLICA_URL, env.DATABASE_POOL_SIZE),
    // Non-null by construction: the schema's `refine` above already refused
    // every value this returns `null` for, so the boot is over before here.
    webOrigins: parseOriginList(env.WEB_ORIGIN) ?? [],
    consoleRedirectUri: consoleRedirectUri(env.WEB_APP_URL) ?? DEV_CONSOLE_REDIRECT,
    storage: storageOptions(env),
    mail: mailOptions(env),
    llm: llmOptions(env),
    embedding: embeddingOptions(env),
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    otelEnabled: env.OTEL_ENABLED ?? env.NODE_ENV !== 'test',
    schedulerEnabled: env.SCHEDULER_ENABLED ?? env.NODE_ENV !== 'test',
    shutdownDrainMs: env.SHUTDOWN_DRAIN_MS ?? (env.NODE_ENV === 'production' ? 5_000 : 0),
  };
}
