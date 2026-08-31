/**
 * Environment parsing — the region half (C4-a), the provider keys (M-PROV-a)
 * and the production branch (M-PROD-CFG-a).
 *
 * `NEXA_REGION` was `z.literal('eu')`, so a US deployment could not boot: the
 * process died at `parseEnv` before any of the region logic C4-b goes on to
 * build could run. The gateway carries an identical schema
 * (`apps/rtm/src/config/env.ts`), which is tested separately and for the same
 * reason — the two are separate processes, and one of them being widened alone
 * produces a deployment with an API and no realtime.
 */
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { REGIONS } from '@nexa/types';
import { SIEM_PROVIDERS } from '../services/audit/siem-target.js';
import { PAYMENT_PROVIDERS } from '../services/billing/payment-provider.js';
import { MAIL_PROVIDERS } from '../services/mail/mailer.js';
import { PUSH_PROVIDERS } from '../services/push/push-provider.js';
import { STORAGE_PROVIDERS } from '../services/storage/object-store.js';
import { OTEL_EXPORTERS } from '../telemetry/telemetry.js';
import { SECRET_KEYS, envSchema, parseEnv } from './env.js';

/** The minimum a boot needs, so a failure below is about the region and nothing else. */
const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nexa:nexa@127.0.0.1:5432/nexa',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
  WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
  CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
  UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
  AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
};

describe('NEXA_REGION', () => {
  it('accepts every region the shared list declares', () => {
    // Driven off REGIONS rather than a literal pair: adding a third region to
    // the list without widening this schema is exactly the failure this file
    // exists to catch, and a hard-coded ['eu','us'] here would not catch it.
    for (const region of REGIONS) {
      expect(parseEnv({ ...BASE, NEXA_REGION: region }).NEXA_REGION).toBe(region);
    }
    expect(REGIONS).toContain('us');
  });

  it('defaults to eu when unset', () => {
    expect(parseEnv(BASE).NEXA_REGION).toBe('eu');
  });

  it('refuses a region that is not one of them', () => {
    // Fail at boot, loudly. A process that shrugged at `apac` would serve
    // requests while claiming a residency guarantee nobody implements.
    expect(() => parseEnv({ ...BASE, NEXA_REGION: 'apac' })).toThrow(/NEXA_REGION/);
  });
});

/**
 * The provider keys (M-PROV-a · §D113/K3).
 *
 * §D113/K3 found `MAIL_PROVIDER`, `STORAGE_PROVIDER` and `STRIPE_PROVIDER`
 * "doğrulanıp okunmuyor" — parsed here, and then ignored by a `server.ts` that
 * branched on `NODE_ENV`. The factories are what closed that (each has its own
 * test); what this file owns is the other half of the same promise: the schema's
 * vocabulary is the factories' vocabulary, so a value that parses is a value
 * something can actually build, and a value that does not parse stops the boot
 * instead of silently becoming a default.
 */
describe('provider selection', () => {
  const PROVIDERS = [
    { key: 'MAIL_PROVIDER', vocabulary: MAIL_PROVIDERS, fallback: 'file' },
    { key: 'PUSH_PROVIDER', vocabulary: PUSH_PROVIDERS, fallback: 'file' },
    { key: 'STORAGE_PROVIDER', vocabulary: STORAGE_PROVIDERS, fallback: 'local' },
    { key: 'STRIPE_PROVIDER', vocabulary: PAYMENT_PROVIDERS, fallback: 'mock' },
    { key: 'SIEM_PROVIDER', vocabulary: SIEM_PROVIDERS, fallback: 'file' },
    { key: 'OTEL_EXPORTER', vocabulary: OTEL_EXPORTERS, fallback: 'console' },
  ] as const;

  /**
   * Settings a provider cannot boot without (M-STORE-a).
   *
   * `s3` is the first provider whose selection is not self-sufficient: it needs
   * a bucket to talk to, and `parseEnv` refuses to start without one rather
   * than falling back to pod-local disk. So the vocabulary sweep below supplies
   * them — the sweep is about the vocabulary, and the conditional requirement
   * has its own tests further down.
   */
  const COMPANIONS: Record<string, NodeJS.ProcessEnv> = {
    s3: {
      STORAGE_S3_ENDPOINT: 'http://localhost:9000',
      STORAGE_S3_BUCKET: 'nexa-uploads',
      STORAGE_S3_ACCESS_KEY_ID: 'minioadmin',
      STORAGE_S3_SECRET_ACCESS_KEY: 'minioadmin',
    },
  };

  for (const { key, vocabulary, fallback } of PROVIDERS) {
    describe(key, () => {
      it('accepts every value its factory implements', () => {
        // Driven off the factory's own list rather than a literal, for the
        // reason NEXA_REGION is: widening one side alone is precisely the drift
        // this pair of readers exists to prevent.
        for (const value of vocabulary) {
          expect(parseEnv({ ...BASE, ...COMPANIONS[value], [key]: value })[key]).toBe(value);
        }
      });

      it('falls back to the mock when unset', () => {
        expect(parseEnv(BASE)[key]).toBe(fallback);
        expect(vocabulary).toContain(fallback);
      });

      it('refuses a value nothing implements, at boot', () => {
        // Loudly, and before the first request. A process that shrugged at
        // `smtp` would keep writing files while an operator believed mail was
        // being sent — the failure mode that is only ever noticed by whoever
        // did not get the e-mail.
        expect(() => parseEnv({ ...BASE, [key]: 'nonesuch' })).toThrow(new RegExp(key));
      });
    });
  }

  /**
   * `STORAGE_PROVIDER=s3` (M-STORE-a · NFR-R1).
   *
   * The one provider whose selection is not self-sufficient, and the one whose
   * silent fallback would be expensive: pod-local uploads under an HPA that
   * scales to four replicas means an attachment that lands on pod A is, to pod
   * B, a file nobody uploaded. So an incomplete `s3` configuration stops the
   * boot instead of quietly becoming `local`.
   */
  describe('STORAGE_S3_*', () => {
    const S3: NodeJS.ProcessEnv = {
      STORAGE_PROVIDER: 's3',
      STORAGE_S3_ENDPOINT: 'http://minio:9000',
      STORAGE_S3_BUCKET: 'nexa-uploads',
      STORAGE_S3_ACCESS_KEY_ID: 'minioadmin',
      STORAGE_S3_SECRET_ACCESS_KEY: 'minioadmin',
    };

    it('assembles the store options once, so no route has to', () => {
      const env = parseEnv({ ...BASE, ...S3, STORAGE_S3_REGION: 'eu-central-1' });

      expect(env.storage).toEqual({
        localDir: '.data/uploads',
        s3: {
          endpoint: 'http://minio:9000',
          bucket: 'nexa-uploads',
          region: 'eu-central-1',
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin',
          forcePathStyle: true,
          timeoutMs: 10_000,
        },
      });
    });

    it('leaves s3 null on a local deployment, even one carrying stray S3 keys', () => {
      // Half a bucket's worth of settings on a `local` deployment must not look
      // to anything downstream like a configured bucket.
      const env = parseEnv({ ...BASE, ...S3, STORAGE_PROVIDER: 'local' });

      expect(env.storage).toEqual({ localDir: '.data/uploads', s3: null });
    });

    it.each([
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
    ])('refuses to boot when %s is missing', (missing) => {
      const { [missing]: _omitted, ...incomplete } = S3;

      expect(() => parseEnv({ ...BASE, ...incomplete })).toThrow(new RegExp(missing));
    });

    it('reports every missing key at once rather than one per attempt', () => {
      // Same reasoning as `productionProblems`: whoever is deploying should
      // learn everything that is wrong before any traffic arrives.
      expect(() => parseEnv({ ...BASE, STORAGE_PROVIDER: 's3' })).toThrow(
        /STORAGE_S3_ENDPOINT[\s\S]*STORAGE_S3_SECRET_ACCESS_KEY/,
      );
    });

    it('refuses an endpoint that is not an origin', () => {
      // A path would silently prefix every object key and the signature would
      // commit to a path the request never used; userinfo would put a
      // credential somewhere SigV4 does not cover.
      for (const endpoint of [
        'http://minio:9000/uploads',
        'https://user:pw@minio:9000',
        'minio:9000',
        'ftp://minio:9000',
      ]) {
        expect(() => parseEnv({ ...BASE, ...S3, STORAGE_S3_ENDPOINT: endpoint })).toThrow(
          /STORAGE_S3_ENDPOINT/,
        );
      }
    });

    it('refuses a bucket name that is not one', () => {
      // The name is concatenated into a URL path (or a hostname); `..` and `/`
      // must not survive that.
      for (const name of ['../other', 'a/b', 'UPPER', 'x', 'has space']) {
        expect(() => parseEnv({ ...BASE, ...S3, STORAGE_S3_BUCKET: name })).toThrow(
          /STORAGE_S3_BUCKET/,
        );
      }
    });

    it('keeps the S3 secret out of SECRET_KEYS on purpose', () => {
      // MinIO ships with `minioadmin`; a 32-character floor would refuse the
      // deployment this provider is first used against. It is a credential the
      // bucket issues, not key material this process mints.
      expect(SECRET_KEYS).not.toContain('STORAGE_S3_SECRET_ACCESS_KEY');
      expect(parseEnv({ ...BASE, ...S3 }).storage.s3?.secretAccessKey).toBe('minioadmin');
    });
  });

  it('does not accept the pre-seam spelling of MAIL_PROVIDER', () => {
    // `mock` used to be the only value, and named the environment rather than
    // the implementation — there are two mocks now. A stale `.env` has to fail
    // at boot rather than quietly getting whichever one is the default.
    expect(() => parseEnv({ ...BASE, MAIL_PROVIDER: 'mock' })).toThrow(/MAIL_PROVIDER/);
  });
});

/**
 * The production branch (M-PROD-CFG-a).
 *
 * This code had never run. `NODE_ENV` is `production` nowhere in this repo —
 * the container stack sets `development` on purpose — so the block that refuses
 * an unsafe deployment was, until now, asserted only by reading it. That is a
 * poor way to hold two failures that are silent by construction: connecting as
 * the table owner disables every RLS policy without raising anything, and
 * booting on the secrets published in `.env.example` produces a process that
 * works perfectly and trusts tokens anyone can mint.
 *
 * Nothing here touches `process.env`. `parseEnv` takes its source as an
 * argument, so a production environment is an ordinary object and the suites
 * that run alongside this one are undisturbed — mutating the real `NODE_ENV`
 * mid-run would change what every other file under test believes it is.
 */
describe('production configuration', () => {
  /** What a real deployment sets: long enough, and not the published placeholder. */
  const realSecret = (label: string): string => `${label}-0123456789abcdef0123456789abcdef`;

  const PROD_BASE: NodeJS.ProcessEnv = {
    ...BASE,
    NODE_ENV: 'production',
    DATABASE_APP_URL: 'postgresql://nexa_app:app-password@127.0.0.1:5432/nexa',
    INBOUND_EMAIL_SECRET: 'an-inbound-webhook-shared-secret',
    JWT_SIGNING_KEY: realSecret('jwt'),
    WEBHOOK_HMAC_SEED: realSecret('webhook'),
    CUSTOMER_TOKEN_SECRET: realSecret('customer'),
    UPLOAD_SIGNING_KEY: realSecret('upload'),
    AUDIT_CHAIN_SECRET: realSecret('audit'),
  };

  it('boots on a fully configured production environment', () => {
    const env = parseEnv(PROD_BASE);

    expect(env.isProduction).toBe(true);
    expect(env.isTest).toBe(false);
    // The whole reason DATABASE_APP_URL is mandatory above: the request path has
    // to reach Postgres as `nexa_app`, never as the owner.
    expect(env.runtimeDatabaseUrl).toBe(PROD_BASE['DATABASE_APP_URL']);
    expect(env.runtimeDatabaseUrl).not.toBe(env.DATABASE_URL);
  });

  it('runs the sweeps and telemetry by default, where test does not', () => {
    // Both follow NODE_ENV unless set explicitly, and the difference matters in
    // opposite directions: a production instance that silently stopped sweeping
    // would never archive an idle chat or mark an SLA breach, and a test that
    // accidentally boots this env gets background writes under its fixtures.
    const env = parseEnv(PROD_BASE);
    expect(env.schedulerEnabled).toBe(true);
    expect(env.otelEnabled).toBe(true);

    expect(
      parseEnv({ ...PROD_BASE, SCHEDULER_ENABLED: 'false', OTEL_ENABLED: 'false' }),
    ).toMatchObject({ schedulerEnabled: false, otelEnabled: false });
  });

  it('drains on shutdown in production and nowhere else (M-OPS-b)', () => {
    // The window is only worth anything where an orchestrator is watching
    // readiness. Defaulting it on everywhere would add five seconds to every
    // Ctrl-C and to every one of the hundreds of server closes the suites do,
    // and buy nothing in return.
    expect(parseEnv(PROD_BASE).shutdownDrainMs).toBe(5_000);
    expect(parseEnv(BASE).shutdownDrainMs).toBe(0);
    expect(parseEnv({ ...BASE, NODE_ENV: 'development' }).shutdownDrainMs).toBe(0);

    // Explicit wins in either direction — including zero, which is how a
    // deployment behind a load balancer that drains for itself opts out.
    expect(parseEnv({ ...PROD_BASE, SHUTDOWN_DRAIN_MS: '0' }).shutdownDrainMs).toBe(0);
    expect(parseEnv({ ...BASE, SHUTDOWN_DRAIN_MS: '250' }).shutdownDrainMs).toBe(250);

    // Capped: past a couple of minutes the orchestrator's own grace period
    // expires first and SIGKILL lands mid-drain, so the value would be a lie.
    expect(() => parseEnv({ ...BASE, SHUTDOWN_DRAIN_MS: '600000' })).toThrow(/SHUTDOWN_DRAIN_MS/);
  });

  it('refuses to boot without DATABASE_APP_URL, and says why', () => {
    const { DATABASE_APP_URL: _omitted, ...withoutAppUrl } = PROD_BASE;

    // The message has to carry the reason, not just the key: "DATABASE_APP_URL
    // is required" invites someone to point it at the owner connection, which is
    // the exact failure the check exists to prevent.
    expect(() => parseEnv(withoutAppUrl)).toThrow(/DATABASE_APP_URL/);
    expect(() => parseEnv(withoutAppUrl)).toThrow(/row level security/i);
  });

  for (const key of SECRET_KEYS) {
    it(`refuses the published development placeholder for ${key}`, () => {
      // `.env.example` is in the repository, so `dev-only-…` is not a weak
      // secret — it is a public one.
      const source = { ...PROD_BASE, [key]: `dev-only-${key.toLowerCase()}-0123456789abcdef` };

      expect(() => parseEnv(source)).toThrow(new RegExp(key));
      expect(() => parseEnv(source)).toThrow(/placeholder/i);
    });
  }

  it('checks every secret the schema declares, not a list that drifts from it', () => {
    // Derived from the schema by behaviour rather than by reading SECRET_KEYS
    // back: a sixth secret added to `envSchema` and forgotten in the production
    // check would otherwise ship able to boot on its placeholder, and nothing
    // would say so. Matches both the helper's message and zod's default one, so
    // a secret declared without `secret()` is caught too.
    const shape: Record<string, ZodTypeAny> = envSchema.shape;
    const declared = Object.keys(shape).filter((key) => {
      const result = shape[key]!.safeParse('too-short');
      return (
        !result.success && result.error.issues.some((i) => /at least 32 character/.test(i.message))
      );
    });

    expect(declared.sort()).toEqual([...SECRET_KEYS].sort());
    expect(declared).toHaveLength(5);
  });

  it('refuses an inbound mail webhook that authenticates nobody', () => {
    const { INBOUND_EMAIL_SECRET: _omitted, ...withoutSecret } = PROD_BASE;

    // Unset, `routes/channels.ts` skips the check and the endpoint is public:
    // the recipient address is the only routing key, and it is an address the
    // workspace publishes to its own customers.
    expect(() => parseEnv(withoutSecret)).toThrow(/INBOUND_EMAIL_SECRET/);
    // Empty is the same hole spelled differently — `INBOUND_EMAIL_SECRET=` in a
    // unit file parses to '', which the route reads as "no secret configured".
    expect(() => parseEnv({ ...PROD_BASE, INBOUND_EMAIL_SECRET: '' })).toThrow(
      /INBOUND_EMAIL_SECRET/,
    );
  });

  it('reports every problem at once rather than one per deploy', () => {
    // A misconfigured deployment should be one readable failure, not a queue of
    // them: fix, redeploy, wait, discover the next line.
    const message = (() => {
      try {
        parseEnv({ ...BASE, NODE_ENV: 'production' });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(message).toMatch(/DATABASE_APP_URL/);
    expect(message).toMatch(/INBOUND_EMAIL_SECRET/);
    for (const key of SECRET_KEYS) expect(message).toMatch(new RegExp(key));
  });

  it('leaves development and test exactly as they were', () => {
    // None of the above may become a cost paid everywhere: `make dev` and every
    // suite in this repo run on the placeholders and on a single connection
    // string, and must keep doing so.
    for (const nodeEnv of ['development', 'test'] as const) {
      const env = parseEnv({ ...BASE, NODE_ENV: nodeEnv });
      expect(env.isProduction).toBe(false);
      expect(env.runtimeDatabaseUrl).toBe(env.DATABASE_URL);
    }
  });
});

/**
 * The Prisma pool size (M-SCALE-b).
 *
 * The behaviour worth pinning is not that the number parses — it's where it
 * lands: as `connection_limit` on `runtimeDatabaseUrl`, and only when the URL
 * does not already name one, because a URL set by hand (or by the test
 * harness's `withTestConnectionBudget`) is a more specific choice than this
 * deployment-wide default.
 */
describe('DATABASE_POOL_SIZE', () => {
  it('leaves the connection string untouched when unset', () => {
    expect(parseEnv(BASE).runtimeDatabaseUrl).toBe(BASE['DATABASE_URL']);
  });

  it('applies as connection_limit on the runtime url', () => {
    const url = new URL(parseEnv({ ...BASE, DATABASE_POOL_SIZE: '15' }).runtimeDatabaseUrl);
    expect(url.searchParams.get('connection_limit')).toBe('15');
  });

  it('applies to DATABASE_APP_URL when one is configured, not the owner url', () => {
    const env = parseEnv({
      ...BASE,
      DATABASE_APP_URL: 'postgresql://nexa_app:app-password@127.0.0.1:5432/nexa',
      DATABASE_POOL_SIZE: '15',
    });
    const url = new URL(env.runtimeDatabaseUrl);
    expect(url.origin + url.pathname).toBe(
      new URL('postgresql://nexa_app:app-password@127.0.0.1:5432/nexa').origin + '/nexa',
    );
    expect(url.searchParams.get('connection_limit')).toBe('15');
    expect(new URL(env.DATABASE_URL).searchParams.get('connection_limit')).toBeNull();
  });

  it('leaves an explicit connection_limit already on the url alone', () => {
    const env = parseEnv({
      ...BASE,
      DATABASE_URL: 'postgresql://nexa:nexa@127.0.0.1:5432/nexa?connection_limit=3',
      DATABASE_POOL_SIZE: '15',
    });
    expect(new URL(env.runtimeDatabaseUrl).searchParams.get('connection_limit')).toBe('3');
  });

  it('refuses zero, negative or fractional pool sizes', () => {
    for (const bad of ['0', '-1', '2.5']) {
      expect(() => parseEnv({ ...BASE, DATABASE_POOL_SIZE: bad })).toThrow(/DATABASE_POOL_SIZE/);
    }
  });
});

/**
 * The read replica seam (M-SCALE-c).
 *
 * Two properties, and only one of them is about parsing. The first is that an
 * unset key changes nothing — the whole design rests on the primary staying the
 * read path everywhere this repo runs. The second is the one worth a boot
 * failure: a replica connecting as the table owner is exempt from row level
 * security, so it would answer report queries with every tenant's rows and look
 * like a working replica doing it. That is refused, and refused in every
 * environment rather than only under `production`, because a developer who
 * wires it up that way is testing tenant isolation that is not there.
 */
describe('DATABASE_REPLICA_URL', () => {
  const APP_URL = 'postgresql://nexa_app:app-password@127.0.0.1:5432/nexa';

  it('is undefined when unset, so reads stay on the primary', () => {
    expect(parseEnv(BASE).replicaDatabaseUrl).toBeUndefined();
    expect(parseEnv({ ...BASE, DATABASE_APP_URL: APP_URL }).replicaDatabaseUrl).toBeUndefined();
  });

  it('is carried through when set', () => {
    const replica = 'postgresql://nexa_app:app-password@replica.internal:5432/nexa';
    const env = parseEnv({ ...BASE, DATABASE_APP_URL: APP_URL, DATABASE_REPLICA_URL: replica });
    expect(env.replicaDatabaseUrl).toBe(replica);
  });

  it('gets the same pool size as the primary — its connections come out of the same budget', () => {
    const env = parseEnv({
      ...BASE,
      DATABASE_APP_URL: APP_URL,
      DATABASE_REPLICA_URL: 'postgresql://nexa_app:app-password@replica.internal:5432/nexa',
      DATABASE_POOL_SIZE: '15',
    });
    expect(new URL(env.replicaDatabaseUrl!).searchParams.get('connection_limit')).toBe('15');
    expect(new URL(env.runtimeDatabaseUrl).searchParams.get('connection_limit')).toBe('15');
  });

  it('refuses a replica that connects as the table owner while the primary does not', () => {
    // The failure being bought out: `nexa` owns the tables, Postgres exempts
    // owners from RLS, and this URL would be handed to every report query.
    expect(() =>
      parseEnv({
        ...BASE,
        DATABASE_APP_URL: APP_URL,
        DATABASE_REPLICA_URL: 'postgresql://nexa:nexa@replica.internal:5432/nexa',
      }),
    ).toThrow(/DATABASE_REPLICA_URL/);
  });

  it('refuses it under development and test too, not only production', () => {
    for (const nodeEnv of ['development', 'test', 'production'] as const) {
      expect(() =>
        parseEnv({
          ...BASE,
          NODE_ENV: nodeEnv,
          DATABASE_APP_URL: APP_URL,
          DATABASE_REPLICA_URL: 'postgresql://nexa:nexa@replica.internal:5432/nexa',
        }),
      ).toThrow(/row level security/);
    }
  });

  it('allows a third read-only role — the rule is "not the owner", not "must be nexa_app"', () => {
    const replica = 'postgresql://nexa_reporting:reporting-password@replica.internal:5432/nexa';
    const env = parseEnv({ ...BASE, DATABASE_APP_URL: APP_URL, DATABASE_REPLICA_URL: replica });
    expect(env.replicaDatabaseUrl).toBe(replica);
  });

  it('says nothing about the owner role when the primary is already the owner', () => {
    // No DATABASE_APP_URL: development and the test suites, where the runtime
    // connection is the owner and RLS is already off. Refusing here would
    // forbid a configuration that gives up nothing that was there to lose.
    const env = parseEnv({ ...BASE, DATABASE_REPLICA_URL: BASE['DATABASE_URL']! });
    expect(env.replicaDatabaseUrl).toBe(BASE['DATABASE_URL']);
  });
});

/**
 * The trusted proxy hop count (M-PROD-CFG-b).
 *
 * `server.ts` used to hard-code `trustProxy: 1` under a comment that declared
 * the assumption behind it — "the API is reached through exactly one trusted
 * reverse proxy". A deployment that does not match cannot change the assumption
 * without changing the image, and both directions of being wrong are bad in
 * ways nothing reports: too high hands the caller control of `request.ip`, too
 * low collapses every caller onto the proxy's address. What the count *does* to
 * an authorization decision is measured end to end in
 * `test/integration/trust-proxy.test.ts`; this is the parsing half.
 */
describe('TRUST_PROXY_HOPS', () => {
  it('defaults to a single reverse proxy — the topology the code assumed before it was a knob', () => {
    expect(parseEnv(BASE).TRUST_PROXY_HOPS).toBe(1);
  });

  it('takes a count from the environment, where everything is a string', () => {
    expect(parseEnv({ ...BASE, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
  });

  it('accepts zero, which is a topology and not an off switch', () => {
    // A process reached directly has nothing appending to `X-Forwarded-For`, so
    // the only address it may believe is the socket peer. Leaving the default 1
    // there is what would be unsafe — the header would then be the caller's.
    expect(parseEnv({ ...BASE, TRUST_PROXY_HOPS: '0' }).TRUST_PROXY_HOPS).toBe(0);
  });

  it('refuses anything that is not a whole, non-negative count', () => {
    for (const bad of ['-1', '1.5', 'one']) {
      expect(() => parseEnv({ ...BASE, TRUST_PROXY_HOPS: bad }), bad).toThrow(/TRUST_PROXY_HOPS/);
    }
  });

  it('refuses an empty value rather than reading it as zero', () => {
    // `TRUST_PROXY_HOPS=` in a unit file means "leave it alone" to whoever wrote
    // it; `Number('')` is 0. Behind a proxy that difference locks every agent
    // out of a workspace with an IP allow-list, since all of them would suddenly
    // appear to be the proxy.
    expect(() => parseEnv({ ...BASE, TRUST_PROXY_HOPS: '' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('refuses a count big enough to mean "trust the whole chain"', () => {
    // At runtime a fat-fingered 100 is indistinguishable from `trustProxy: true`
    // — proxy-addr walks past every real hop and returns the left-most entry,
    // the one the caller wrote — which is the single failure this key exists to
    // prevent. Better a boot that stops than an allow-list that does not.
    expect(() => parseEnv({ ...BASE, TRUST_PROXY_HOPS: '100' })).toThrow(/TRUST_PROXY_HOPS/);
  });
});

/**
 * The CORS allowlist (M-PROD-CFG-b).
 *
 * Production answers exactly these origins with `credentials: true`, so the
 * value is an authorization boundary rather than a convenience: an origin on
 * this list can read the API with a signed-in agent's session. It used to be a
 * single unvalidated string wrapped in an array at the point of use, which made
 * both of the interesting cases impossible to express — a deployment serving
 * the panel and the hosted chat page from different hosts, and a value that is
 * not an origin at all.
 */
describe('WEB_ORIGIN', () => {
  const origins = (value?: string): string[] =>
    parseEnv(value === undefined ? BASE : { ...BASE, WEB_ORIGIN: value }).webOrigins;

  it('defaults to the dev panel, as one origin', () => {
    expect(origins()).toEqual(['http://localhost:5173']);
  });

  it('takes a comma-separated list, because a deployment has more than one front door', () => {
    // The agent panel and the hosted chat page (FR-MOD-08.5.9) are routinely
    // separate hosts; naming only one of them silently breaks the other.
    expect(origins('https://panel.example.com,https://chat.example.com')).toEqual([
      'https://panel.example.com',
      'https://chat.example.com',
    ]);
  });

  it('normalises what a person actually pastes', () => {
    // Whitespace around a separator, a trailing slash `new URL` would add
    // anyway, a mixed-case host, and the same origin written twice. All four
    // reach `@fastify/cors` as the exact string a browser puts in `Origin`,
    // which is the only spelling that ever matches.
    expect(origins(' https://panel.example.com/ , HTTPS://Panel.Example.com ')).toEqual([
      'https://panel.example.com',
    ]);
    expect(origins('https://panel.example.com:8443')).toEqual(['https://panel.example.com:8443']);
  });

  it('refuses a value that is not an origin, at boot', () => {
    // Fail closed, and loudly. Every one of these parses today as a plain
    // string, and the allowlist built from it would match nothing a browser
    // sends — which looks exactly like CORS being broken for no reason.
    for (const bad of [
      '',
      '   ',
      ',',
      'panel.example.com', // no scheme
      'https://panel.example.com/app', // a URL, not an origin
      'https://panel.example.com?x=1',
      'https://user:pw@panel.example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://ok.example.com,not-an-origin',
    ]) {
      expect(() => parseEnv({ ...BASE, WEB_ORIGIN: bad }), JSON.stringify(bad)).toThrow(
        /WEB_ORIGIN/,
      );
    }
  });

  it('is only ever a list, so no caller has to remember to wrap it', () => {
    // `server.ts` used to write `[env.WEB_ORIGIN]`. The array now comes from
    // here, which is what makes the multi-origin case reachable at all.
    expect(Array.isArray(parseEnv(BASE).webOrigins)).toBe(true);
  });
});
