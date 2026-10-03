/**
 * Environment parsing — the region half (C4-a), the provider keys (M-PROV-a)
 * and the production branch (M-PROD-CFG-a).
 *
 * `SIYAHTUS_REGION` was `z.literal('eu')`, so a US deployment could not boot: the
 * process died at `parseEnv` before any of the region logic C4-b goes on to
 * build could run. The gateway carries an identical schema
 * (`apps/rtm/src/config/env.ts`), which is tested separately and for the same
 * reason — the two are separate processes, and one of them being widened alone
 * produces a deployment with an API and no realtime.
 */
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { REGIONS } from '@siyahtus/types';
import { RETRIEVAL_THRESHOLD } from '../services/ai/knowledge-service.js';
import { EMBEDDING_PROVIDERS } from '../services/ai/provider/embedding-provider.js';
import { LLM_PROVIDERS } from '../services/ai/provider/llm-provider.js';
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
  DATABASE_URL: 'postgresql://siyahtus:siyahtus@127.0.0.1:5432/siyahtus',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
  WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
  CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
  UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
  AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
};

describe('SIYAHTUS_REGION', () => {
  it('accepts every region the shared list declares', () => {
    // Driven off REGIONS rather than a literal pair: adding a third region to
    // the list without widening this schema is exactly the failure this file
    // exists to catch, and a hard-coded ['eu','us'] here would not catch it.
    for (const region of REGIONS) {
      expect(parseEnv({ ...BASE, SIYAHTUS_REGION: region }).SIYAHTUS_REGION).toBe(region);
    }
    expect(REGIONS).toContain('us');
  });

  it('defaults to eu when unset', () => {
    expect(parseEnv(BASE).SIYAHTUS_REGION).toBe('eu');
  });

  it('refuses a region that is not one of them', () => {
    // Fail at boot, loudly. A process that shrugged at `apac` would serve
    // requests while claiming a residency guarantee nobody implements.
    expect(() => parseEnv({ ...BASE, SIYAHTUS_REGION: 'apac' })).toThrow(/SIYAHTUS_REGION/);
  });
});

/**
 * The sign-up switch (tm 256.3). Open unless a deployment says otherwise, and
 * only the two literal words count: the value that matters is the one written
 * to close the door, so a spelling that cannot be read stops the boot rather
 * than being taken as "open".
 */
describe('SIGNUP_ENABLED', () => {
  it('is open when unset, so dev, test and the demo keep their sign-up', () => {
    expect(parseEnv(BASE).SIGNUP_ENABLED).toBe(true);
  });

  it('reads true and false', () => {
    expect(parseEnv({ ...BASE, SIGNUP_ENABLED: 'true' }).SIGNUP_ENABLED).toBe(true);
    expect(parseEnv({ ...BASE, SIGNUP_ENABLED: 'false' }).SIGNUP_ENABLED).toBe(false);
  });

  it('refuses an empty value rather than guessing which way it was meant', () => {
    // `SIGNUP_ENABLED=` in a compose `.env` arrives as '' — a line someone
    // wrote, most likely on the way to `false`.
    expect(() => parseEnv({ ...BASE, SIGNUP_ENABLED: '' })).toThrow(/SIGNUP_ENABLED/);
  });

  it.each(['0', '1', 'no', 'off', 'False', 'TRUE', ' false'])(
    'refuses %j instead of reading it as open or closed',
    (value) => {
      expect(() => parseEnv({ ...BASE, SIGNUP_ENABLED: value })).toThrow(/SIGNUP_ENABLED/);
    },
  );
});

/**
 * The pilot switch (tm 257.13 · ADR pilot-public-readiness K-a). Off unless a
 * deployment says otherwise, read the way `SIGNUP_ENABLED` is: the two literal
 * words only, because guessing which way a misspelt line was meant is the one
 * thing the switch must never do.
 */
describe('PILOT_MODE', () => {
  it('is off when unset, so dev, test, the demo and e2e run exactly as before', () => {
    expect(parseEnv(BASE).PILOT_MODE).toBe(false);
  });

  it('reads true and false', () => {
    expect(parseEnv({ ...BASE, PILOT_MODE: 'true' }).PILOT_MODE).toBe(true);
    expect(parseEnv({ ...BASE, PILOT_MODE: 'false' }).PILOT_MODE).toBe(false);
  });

  it.each(['', '0', '1', 'no', 'off', 'False', 'TRUE', ' true'])(
    'refuses %j instead of reading it as on or off',
    (value) => {
      expect(() => parseEnv({ ...BASE, PILOT_MODE: value })).toThrow(/PILOT_MODE/);
    },
  );

  it('takes a contact address, and refuses one that is not an address', () => {
    expect(parseEnv(BASE).PILOT_CONTACT_EMAIL).toBeUndefined();
    expect(
      parseEnv({ ...BASE, PILOT_CONTACT_EMAIL: 'pilot@siyahtus.test' }).PILOT_CONTACT_EMAIL,
    ).toBe('pilot@siyahtus.test');
    for (const value of ['', 'not an address', '<pilot contact address>']) {
      expect(() => parseEnv({ ...BASE, PILOT_CONTACT_EMAIL: value }), value).toThrow(
        /PILOT_CONTACT_EMAIL/,
      );
    }
  });

  it('needs none of the production rules outside production', () => {
    // The integration twins and a developer trying the switch run it on the
    // mock providers; only a production boot has real users behind it.
    expect(() => parseEnv({ ...BASE, PILOT_MODE: 'true' })).not.toThrow();
  });
});

/**
 * Sign-up email verification (tm 257.7 · ADR K-e(1)). Off unless chosen, and
 * read like the two switches above.
 */
describe('SIGNUP_EMAIL_VERIFICATION', () => {
  it('is off when unset, so sign-up answers 201 and signs straight in as before', () => {
    expect(parseEnv(BASE).SIGNUP_EMAIL_VERIFICATION).toBe(false);
  });

  it('reads true and false', () => {
    expect(parseEnv({ ...BASE, SIGNUP_EMAIL_VERIFICATION: 'true' }).SIGNUP_EMAIL_VERIFICATION).toBe(
      true,
    );
    expect(
      parseEnv({ ...BASE, SIGNUP_EMAIL_VERIFICATION: 'false' }).SIGNUP_EMAIL_VERIFICATION,
    ).toBe(false);
  });

  it.each(['', '0', '1', 'no', 'False', 'TRUE', ' true'])(
    'refuses %j instead of reading it as on or off',
    (value) => {
      expect(() => parseEnv({ ...BASE, SIGNUP_EMAIL_VERIFICATION: value })).toThrow(
        /SIGNUP_EMAIL_VERIFICATION/,
      );
    },
  );

  it('keeps a link for a day by default, and between an hour and a week', () => {
    expect(parseEnv(BASE).SIGNUP_VERIFICATION_TTL_HOURS).toBe(24);
    expect(
      parseEnv({ ...BASE, SIGNUP_VERIFICATION_TTL_HOURS: '1' }).SIGNUP_VERIFICATION_TTL_HOURS,
    ).toBe(1);
    expect(
      parseEnv({ ...BASE, SIGNUP_VERIFICATION_TTL_HOURS: '168' }).SIGNUP_VERIFICATION_TTL_HOURS,
    ).toBe(168);
    for (const value of ['0', '-1', '1.5', '169', 'a day']) {
      expect(() => parseEnv({ ...BASE, SIGNUP_VERIFICATION_TTL_HOURS: value }), value).toThrow(
        /SIGNUP_VERIFICATION_TTL_HOURS/,
      );
    }
  });

  it('needs no mail rule outside production', () => {
    expect(() => parseEnv({ ...BASE, SIGNUP_EMAIL_VERIFICATION: 'true' })).not.toThrow();
  });
});

/**
 * The legal links (tm 257.9 · ADR K-f). Unset by default, so sign-up asks for
 * nothing; a version is required wherever terms are named.
 */
describe('PRIVACY_POLICY_URL · TERMS_URL · TERMS_VERSION', () => {
  const LEGAL = {
    PRIVACY_POLICY_URL: 'https://siyahtus.test/privacy',
    TERMS_URL: 'https://siyahtus.test/terms',
    TERMS_VERSION: '2026-10-01',
  };

  it('are unset by default, so dev, the suites, the demo and e2e sign up as before', () => {
    const env = parseEnv(BASE);
    expect(env.PRIVACY_POLICY_URL).toBeUndefined();
    expect(env.TERMS_URL).toBeUndefined();
    expect(env.TERMS_VERSION).toBeUndefined();
  });

  it('reads the three together', () => {
    const env = parseEnv({ ...BASE, ...LEGAL });
    expect(env.PRIVACY_POLICY_URL).toBe(LEGAL.PRIVACY_POLICY_URL);
    expect(env.TERMS_URL).toBe(LEGAL.TERMS_URL);
    expect(env.TERMS_VERSION).toBe('2026-10-01');
  });

  it('stops the boot in every environment when TERMS_URL has no TERMS_VERSION, naming it', () => {
    for (const NODE_ENV of ['test', 'development']) {
      expect(() => parseEnv({ ...BASE, NODE_ENV, TERMS_URL: LEGAL.TERMS_URL })).toThrow(
        /TERMS_VERSION is required when TERMS_URL is set/,
      );
    }
  });

  it.each(['PRIVACY_POLICY_URL', 'TERMS_URL'] as const)(
    'refuses %s that is not an https address, naming it',
    (key) => {
      for (const value of [
        'http://siyahtus.test/legal',
        'siyahtus.test/legal',
        '/legal',
        'ftp://siyahtus.test/legal',
      ]) {
        expect(() => parseEnv({ ...BASE, ...LEGAL, [key]: value }), value).toThrow(new RegExp(key));
      }
    },
  );

  it('refuses a TERMS_VERSION that is empty, has whitespace or is longer than 64', () => {
    for (const value of ['', 'October 2026', ' 2026-10-01', 'v'.repeat(65)]) {
      expect(() => parseEnv({ ...BASE, ...LEGAL, TERMS_VERSION: value }), value).toThrow(
        /TERMS_VERSION/,
      );
    }
    expect(
      parseEnv({ ...BASE, ...LEGAL, TERMS_VERSION: 'v'.repeat(64) }).TERMS_VERSION,
    ).toHaveLength(64);
  });

  it('takes a privacy policy alone — only terms need a version', () => {
    expect(
      parseEnv({ ...BASE, PRIVACY_POLICY_URL: LEGAL.PRIVACY_POLICY_URL }).PRIVACY_POLICY_URL,
    ).toBe(LEGAL.PRIVACY_POLICY_URL);
  });

  it('needs none of them outside production, even with PILOT_MODE=true', () => {
    expect(() => parseEnv({ ...BASE, PILOT_MODE: 'true' })).not.toThrow();
  });
});

/** The `GET /deployment` bucket (tm 257.13). */
describe('RATE_LIMIT_PUBLIC_CONFIG_PER_MIN', () => {
  it('is 600 per minute when unset', () => {
    expect(parseEnv(BASE).RATE_LIMIT_PUBLIC_CONFIG_PER_MIN).toBe(600);
  });

  it.each(['0', '-1', '1.5', 'many'])('refuses %j', (value) => {
    expect(() => parseEnv({ ...BASE, RATE_LIMIT_PUBLIC_CONFIG_PER_MIN: value })).toThrow(
      /RATE_LIMIT_PUBLIC_CONFIG_PER_MIN/,
    );
  });
});

/** The daily AI token caps (tm 257.8). */
describe('AI_DAILY_*_TOKENS_*', () => {
  const DEFAULTS = {
    AI_DAILY_LLM_TOKENS_PER_WORKSPACE: 200_000,
    AI_DAILY_LLM_TOKENS_GLOBAL: 2_000_000,
    AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE: 2_000_000,
    AI_DAILY_EMBEDDING_TOKENS_GLOBAL: 20_000_000,
  } as const;

  it('takes the ADR’s cautious defaults when unset', () => {
    expect(parseEnv(BASE)).toMatchObject(DEFAULTS);
  });

  for (const key of Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>) {
    it(`reads ${key} as a whole number of tokens, at least 1 — no "off"`, () => {
      expect(parseEnv({ ...BASE, [key]: '1' })[key]).toBe(1);
      expect(parseEnv({ ...BASE, [key]: '750000' })[key]).toBe(750_000);
      for (const value of ['0', '-5', '1.5', 'unlimited', '']) {
        expect(() => parseEnv({ ...BASE, [key]: value }), value).toThrow(new RegExp(key));
      }
    });
  }
});

/** Sign-ups per client network per hour (tm 257.14). */
describe('RATE_LIMIT_SIGNUP_PER_HOUR', () => {
  it('is 10 when unset', () => {
    expect(parseEnv(BASE).RATE_LIMIT_SIGNUP_PER_HOUR).toBe(10);
  });

  it('reads a positive whole number, and refuses anything else by name', () => {
    expect(
      parseEnv({ ...BASE, RATE_LIMIT_SIGNUP_PER_HOUR: '250' }).RATE_LIMIT_SIGNUP_PER_HOUR,
    ).toBe(250);
    for (const value of ['0', '-1', '2.5', 'many', '']) {
      expect(() => parseEnv({ ...BASE, RATE_LIMIT_SIGNUP_PER_HOUR: value }), value).toThrow(
        /RATE_LIMIT_SIGNUP_PER_HOUR/,
      );
    }
  });
});

/** The daily outgoing-mail caps (tm 257.14). */
describe('MAIL_DAILY_* and MAIL_SECURITY_RESERVE', () => {
  const DEFAULTS = {
    MAIL_DAILY_PER_WORKSPACE: 200,
    MAIL_DAILY_EXTERNAL_PER_WORKSPACE: 50,
    MAIL_DAILY_GLOBAL: 400,
    MAIL_SECURITY_RESERVE: 50,
  } as const;

  it('takes the ADR’s cautious defaults when unset', () => {
    expect(parseEnv(BASE)).toMatchObject(DEFAULTS);
  });

  for (const key of [
    'MAIL_DAILY_PER_WORKSPACE',
    'MAIL_DAILY_EXTERNAL_PER_WORKSPACE',
    'MAIL_DAILY_GLOBAL',
  ] as const) {
    it(`reads ${key} as a whole number of mails, at least 1 — no "off"`, () => {
      expect(parseEnv({ ...BASE, [key]: '1000' })[key]).toBe(1000);
      for (const value of ['0', '-5', '1.5', 'unlimited', '']) {
        expect(() => parseEnv({ ...BASE, [key]: value }), value).toThrow(new RegExp(key));
      }
    });
  }

  it('reads MAIL_SECURITY_RESERVE as 0 or more, and refuses a blank rather than reading it as 0', () => {
    expect(parseEnv({ ...BASE, MAIL_SECURITY_RESERVE: '0' }).MAIL_SECURITY_RESERVE).toBe(0);
    expect(parseEnv({ ...BASE, MAIL_SECURITY_RESERVE: '120' }).MAIL_SECURITY_RESERVE).toBe(120);
    for (const value of ['', '-1', '2.5', 'some']) {
      expect(() => parseEnv({ ...BASE, MAIL_SECURITY_RESERVE: value }), value).toThrow(
        /MAIL_SECURITY_RESERVE/,
      );
    }
  });

  it('refuses a reserve that leaves no room for workspace mail, in every environment', () => {
    for (const reserve of ['400', '500']) {
      expect(() => parseEnv({ ...BASE, MAIL_SECURITY_RESERVE: reserve }), reserve).toThrow(
        /MAIL_SECURITY_RESERVE must be less than MAIL_DAILY_GLOBAL/,
      );
    }
    expect(() =>
      parseEnv({ ...BASE, MAIL_DAILY_GLOBAL: '10', MAIL_SECURITY_RESERVE: '9' }),
    ).not.toThrow();
  });
});

/** The assignee e-mail window (FR-MOD-13.8 · tm 256.4). */
describe('ASSIGNEE_EMAIL_COOLDOWN_MS', () => {
  it('is fifteen minutes when unset', () => {
    expect(parseEnv(BASE).ASSIGNEE_EMAIL_COOLDOWN_MS).toBe(900_000);
  });

  it('reads 0 as "no window" rather than refusing it', () => {
    expect(parseEnv({ ...BASE, ASSIGNEE_EMAIL_COOLDOWN_MS: '0' }).ASSIGNEE_EMAIL_COOLDOWN_MS).toBe(
      0,
    );
  });

  it.each(['-1', '1.5', 'soon', '86400001'])('refuses %j', (value) => {
    expect(() => parseEnv({ ...BASE, ASSIGNEE_EMAIL_COOLDOWN_MS: value })).toThrow(
      /ASSIGNEE_EMAIL_COOLDOWN_MS/,
    );
  });
});

/** The knowledge retrieval threshold, a setting since tm 256.6. */
describe('RETRIEVAL_THRESHOLD (FR-MOD-06.3.2)', () => {
  it('is the measured stub default when unset', () => {
    expect(parseEnv(BASE).RETRIEVAL_THRESHOLD).toBe(RETRIEVAL_THRESHOLD);
    expect(RETRIEVAL_THRESHOLD).toBe(0.25);
  });

  it.each([
    ['0.42', 0.42],
    ['-1', -1],
    ['1', 1],
    ['0', 0],
  ])('reads %j as %d', (value, expected) => {
    expect(parseEnv({ ...BASE, RETRIEVAL_THRESHOLD: value }).RETRIEVAL_THRESHOLD).toBe(expected);
  });

  it.each(['', '1.01', '-1.5', 'high', '0,3'])('refuses %j at boot', (value) => {
    expect(() => parseEnv({ ...BASE, RETRIEVAL_THRESHOLD: value })).toThrow(/RETRIEVAL_THRESHOLD/);
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
    { key: 'LLM_PROVIDER', vocabulary: LLM_PROVIDERS, fallback: 'mock' },
    { key: 'EMBEDDING_PROVIDER', vocabulary: EMBEDDING_PROVIDERS, fallback: 'mock' },
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
      STORAGE_S3_BUCKET: 'siyahtus-uploads',
      STORAGE_S3_ACCESS_KEY_ID: 'minioadmin',
      STORAGE_S3_SECRET_ACCESS_KEY: 'minioadmin',
    },
  };

  for (const { key, vocabulary, fallback } of PROVIDERS) {
    describe(key, () => {
      it('accepts every value its factory implements', () => {
        // Driven off the factory's own list rather than a literal, for the
        // reason SIYAHTUS_REGION is: widening one side alone is precisely the drift
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
      STORAGE_S3_BUCKET: 'siyahtus-uploads',
      STORAGE_S3_ACCESS_KEY_ID: 'minioadmin',
      STORAGE_S3_SECRET_ACCESS_KEY: 'minioadmin',
    };

    it('assembles the store options once, so no route has to', () => {
      const env = parseEnv({ ...BASE, ...S3, STORAGE_S3_REGION: 'eu-central-1' });

      expect(env.storage).toEqual({
        localDir: '.data/uploads',
        s3: {
          endpoint: 'http://minio:9000',
          bucket: 'siyahtus-uploads',
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

  const PANEL_ORIGIN = 'https://panel.siyahtus.test';
  const WIDGET_ORIGIN = 'https://widget.siyahtus.test';

  const PROD_BASE: NodeJS.ProcessEnv = {
    ...BASE,
    NODE_ENV: 'production',
    // Both spelled out because production refuses a WEB_ORIGIN that does not
    // name the widget's origin (tm 243), and the schema defaults — :5173 and
    // :5174 — are two different origins. Every other assertion in this
    // describe would otherwise fail on that one problem.
    WEB_ORIGIN: `${PANEL_ORIGIN},${WIDGET_ORIGIN}`,
    WIDGET_BASE_URL: WIDGET_ORIGIN,
    DATABASE_APP_URL: 'postgresql://siyahtus_app:app-password@127.0.0.1:5432/siyahtus',
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
    // to reach Postgres as `siyahtus_app`, never as the owner.
    expect(env.runtimeDatabaseUrl).toBe(PROD_BASE['DATABASE_APP_URL']);
    expect(env.runtimeDatabaseUrl).not.toBe(env.DATABASE_URL);
  });

  it('boots with sign-up open or closed — neither is a production requirement (tm 256.3)', () => {
    // The pilot needs it open for its first workspace and closed after, both
    // under NODE_ENV=production, so production must not insist on either.
    expect(parseEnv(PROD_BASE).SIGNUP_ENABLED).toBe(true);
    expect(parseEnv({ ...PROD_BASE, SIGNUP_ENABLED: 'false' }).SIGNUP_ENABLED).toBe(false);
  });

  it('boots without PILOT_MODE exactly as before — the pilot rules are not production rules (tm 257.13)', () => {
    // Helm runs production on the mock model and file mail, and so does this
    // base: tying the pilot's demands to NODE_ENV alone would break both.
    const env = parseEnv(PROD_BASE);
    expect(env.PILOT_MODE).toBe(false);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.MAIL_PROVIDER).toBe('file');
    // Nor are the legal links (tm 257.9): Helm sets none of them.
    expect(env.TERMS_URL).toBeUndefined();
    expect(env.PRIVACY_POLICY_URL).toBeUndefined();
  });

  /**
   * `PILOT_MODE=true` in production (tm 257.13 · ADR K-b). The switch means
   * "real people use this", so a stub model, a stub embedder or mail written
   * to disk is a silent outage there, and the contact address the trial and
   * "closed in the pilot" notes point at has to exist. Each refusal names the
   * key, never the value — the message is what an operator pastes into a chat.
   */
  describe('PILOT_MODE=true', () => {
    const PILOT: NodeJS.ProcessEnv = {
      ...PROD_BASE,
      PILOT_MODE: 'true',
      PILOT_CONTACT_EMAIL: 'pilot-desk@siyahtus.test',
      // The pilot's one region, which its providers have to answer in (tm 257.4).
      SIYAHTUS_REGION: 'us',
      LLM_PROVIDER: 'openai',
      LLM_PROVIDER_REGION: 'us',
      LLM_API_BASE_URL: 'https://us.api.openai.com/v1',
      LLM_MODEL: 'a-model-id',
      LLM_API_KEY: realSecret('llm'),
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_PROVIDER_REGION: 'us',
      EMBEDDING_API_BASE_URL: 'https://us.api.openai.com/v1',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_API_KEY: realSecret('embedding'),
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.siyahtus.test',
      SMTP_PORT: '587',
      SMTP_USERNAME: 'mailer-login',
      SMTP_PASSWORD: realSecret('smtp'),
      SMTP_FROM: 'desk@siyahtus.test',
      // Public sign-up in the pilot verifies the address (tm 257.7).
      SIGNUP_EMAIL_VERIFICATION: 'true',
      // The legal minimum (tm 257.9).
      PRIVACY_POLICY_URL: 'https://siyahtus.test/privacy',
      TERMS_URL: 'https://siyahtus.test/terms',
      TERMS_VERSION: '2026-10-01',
    };

    const problemsOf = (source: NodeJS.ProcessEnv): string => {
      try {
        parseEnv(source);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };

    it('boots with a contact address, the real model, the real embedder and SMTP', () => {
      const env = parseEnv(PILOT);
      expect(env.PILOT_MODE).toBe(true);
      expect(env.PILOT_CONTACT_EMAIL).toBe('pilot-desk@siyahtus.test');
    });

    it('refuses to boot without PILOT_CONTACT_EMAIL, naming it', () => {
      const { PILOT_CONTACT_EMAIL: _omitted, ...withoutContact } = PILOT;
      const message = problemsOf(withoutContact);
      expect(message).toMatch(/PILOT_CONTACT_EMAIL is required/);
      expect(message).toMatch(/PILOT_MODE=true/);
    });

    it.each([
      ['LLM_PROVIDER', { LLM_PROVIDER: 'mock' }],
      ['EMBEDDING_PROVIDER', { EMBEDDING_PROVIDER: 'mock' }],
      ['MAIL_PROVIDER', { MAIL_PROVIDER: 'file' }],
      ['MAIL_PROVIDER', { MAIL_PROVIDER: 'null' }],
    ] as const)('refuses %s at a stub (%o), naming the key', (key, override) => {
      const message = problemsOf({ ...PILOT, ...override });
      expect(message).toMatch(new RegExp(`${key} must be`));
      expect(message).toMatch(/PILOT_MODE=true/);
      // Nothing else in the configuration is wrong, so nothing else is named.
      expect(message.trim().split('\n')).toHaveLength(2);
    });

    it('reports every pilot problem at once', () => {
      const { PILOT_CONTACT_EMAIL: _omitted, ...withoutContact } = PILOT;
      const message = problemsOf({
        ...withoutContact,
        LLM_PROVIDER: 'mock',
        EMBEDDING_PROVIDER: 'mock',
        MAIL_PROVIDER: 'file',
      });
      expect(message).toMatch(
        /PILOT_CONTACT_EMAIL[\s\S]*LLM_PROVIDER[\s\S]*EMBEDDING_PROVIDER[\s\S]*MAIL_PROVIDER/,
      );
      expect(message).not.toContain('pilot-desk@siyahtus.test');
    });

    it.each(['PRIVACY_POLICY_URL', 'TERMS_URL', 'TERMS_VERSION'] as const)(
      'refuses to boot without %s, naming it (tm 257.9)',
      (key) => {
        const source = { ...PILOT };
        delete source[key];
        const message = problemsOf(source);
        expect(message).toMatch(new RegExp(`${key} is required`));
        // TERMS_URL without its version is the every-environment rule's to
        // name; either way the one key that is missing is the only one named.
        expect(message.trim().split('\n')).toHaveLength(2);
      },
    );

    it('names all three legal keys at once when none is set (tm 257.9)', () => {
      const { PRIVACY_POLICY_URL: _p, TERMS_URL: _t, TERMS_VERSION: _v, ...withoutLegal } = PILOT;
      expect(problemsOf(withoutLegal)).toMatch(
        /PRIVACY_POLICY_URL is required[\s\S]*TERMS_URL is required[\s\S]*TERMS_VERSION is required[\s\S]*PILOT_MODE=true/,
      );
    });

    /**
     * One deployment, one region (tm 257.4 · NFR-C9). The sign-up form sends no
     * region in the pilot, so every workspace is filed in `SIYAHTUS_REGION`; a
     * provider declared elsewhere (and the host rule makes the host follow the
     * declaration) would receive their conversations across the border, and the
     * residency check only refuses HIPAA-scoped workspaces.
     */
    describe('provider regions (NFR-C9)', () => {
      it.each([
        [
          'LLM_PROVIDER_REGION',
          { LLM_PROVIDER_REGION: 'eu', LLM_API_BASE_URL: 'https://eu.api.openai.com/v1' },
        ],
        [
          'EMBEDDING_PROVIDER_REGION',
          {
            EMBEDDING_PROVIDER_REGION: 'eu',
            EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
          },
        ],
      ] as const)('refuses a %s that is not SIYAHTUS_REGION, naming the key', (key, override) => {
        // The host follows the declaration, so the host rule is satisfied and
        // only the equality rule is left to speak.
        const message = problemsOf({ ...PILOT, ...override });
        expect(message).toMatch(new RegExp(`${key} must equal SIYAHTUS_REGION`));
        expect(message).toMatch(/PILOT_MODE=true/);
        expect(message.trim().split('\n')).toHaveLength(2);
      });

      it('names both providers when both are elsewhere', () => {
        const message = problemsOf({
          ...PILOT,
          LLM_PROVIDER_REGION: 'eu',
          LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
          EMBEDDING_PROVIDER_REGION: 'eu',
          EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
        });
        expect(message).toMatch(
          /LLM_PROVIDER_REGION must equal[\s\S]*EMBEDDING_PROVIDER_REGION must equal/,
        );
      });

      it('boots when the deployment and both providers are all in the other region', () => {
        expect(() =>
          parseEnv({
            ...PILOT,
            SIYAHTUS_REGION: 'eu',
            LLM_PROVIDER_REGION: 'eu',
            LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
            EMBEDDING_PROVIDER_REGION: 'eu',
            EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
          }),
        ).not.toThrow();
      });

      it('does not compare a stub, which runs in this process and is its region', () => {
        // Each stub is refused on its own rule; the region rule must not add a
        // second line about a region nobody declared.
        const message = problemsOf({
          ...PILOT,
          LLM_PROVIDER: 'mock',
          LLM_PROVIDER_REGION: 'eu',
          EMBEDDING_PROVIDER: 'mock',
          EMBEDDING_PROVIDER_REGION: 'eu',
        });
        expect(message).not.toMatch(/PROVIDER_REGION must equal/);
      });

      it('leaves an ordinary production deployment free to mix regions', () => {
        // Not a pilot, so not this rule: the same mix the provider tests below
        // pin (a host-matched provider region that is not the deployment's own).
        expect(() =>
          parseEnv({
            ...PILOT,
            PILOT_MODE: 'false',
            LLM_PROVIDER_REGION: 'eu',
            LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
          }),
        ).not.toThrow();
      });
    });

    it('asks none of it when the switch is off, even with every stub in place', () => {
      expect(() =>
        parseEnv({
          ...PILOT,
          PILOT_MODE: 'false',
          PILOT_CONTACT_EMAIL: undefined,
          // Its own switch with its own mail rule (tm 257.7), not a pilot rule.
          SIGNUP_EMAIL_VERIFICATION: 'false',
          LLM_PROVIDER: 'mock',
          EMBEDDING_PROVIDER: 'mock',
          MAIL_PROVIDER: 'file',
        }),
      ).not.toThrow();
    });

    it('refuses to boot with SIGNUP_EMAIL_VERIFICATION off, naming it (tm 257.7)', () => {
      const message = problemsOf({ ...PILOT, SIGNUP_EMAIL_VERIFICATION: 'false' });
      expect(message).toMatch(/SIGNUP_EMAIL_VERIFICATION must be true/);
      expect(message).toMatch(/PILOT_MODE=true/);
      expect(message.trim().split('\n')).toHaveLength(2);
    });

    it('names MAIL_PROVIDER once when verification is on and mail is a stub', () => {
      // Both rules want smtp; the pilot's speaks, the verification one stays
      // quiet rather than repeating the key.
      const message = problemsOf({ ...PILOT, MAIL_PROVIDER: 'file' });
      expect(message.match(/MAIL_PROVIDER must be smtp/g)).toHaveLength(1);
    });
  });

  /**
   * `SIGNUP_EMAIL_VERIFICATION=true` in production (tm 257.7 · ADR K-e(1)),
   * outside the pilot as well: the switch is off unless chosen, so Helm and
   * this base are untouched, and once chosen a link that reaches no mailbox
   * locks every new owner out of the workspace they just made.
   */
  describe('SIGNUP_EMAIL_VERIFICATION=true', () => {
    it('refuses file mail, naming MAIL_PROVIDER and the switch', () => {
      let message = '';
      try {
        parseEnv({ ...PROD_BASE, SIGNUP_EMAIL_VERIFICATION: 'true' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/MAIL_PROVIDER must be smtp/);
      expect(message).toMatch(/SIGNUP_EMAIL_VERIFICATION=true/);
      expect(message.trim().split('\n')).toHaveLength(2);
    });

    it('boots on SMTP', () => {
      const env = parseEnv({
        ...PROD_BASE,
        SIGNUP_EMAIL_VERIFICATION: 'true',
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.siyahtus.test',
        SMTP_PORT: '587',
        SMTP_USERNAME: 'mailer-login',
        SMTP_PASSWORD: realSecret('smtp'),
        SMTP_FROM: 'desk@siyahtus.test',
      });
      expect(env.SIGNUP_EMAIL_VERIFICATION).toBe(true);
    });

    it('is not a production requirement on its own', () => {
      expect(parseEnv(PROD_BASE).SIGNUP_EMAIL_VERIFICATION).toBe(false);
    });
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

  /**
   * `MAIL_PROVIDER=smtp` (tm 255.2 · ADR docs/adr/pilot-llm-embedding-provider.md
   * §9.3). Mirrors the `STORAGE_S3_*` pattern above: `smtp` is not the default
   * provider, so the five keys stay optional in the schema, and an incomplete
   * choice has to stop the boot rather than fall back to `file` — which is
   * exactly the M-PROV-a regression this file's header describes, one provider
   * over. Production-only, unlike S3: outside production an incomplete `smtp`
   * still cannot boot, because `env.mail.smtp` stays `null` and
   * `createMailer('smtp', …)` refuses it (see mailer.test.ts) — the schema does
   * not need to refuse it a second time.
   */
  describe('MAIL_PROVIDER=smtp', () => {
    const SMTP: NodeJS.ProcessEnv = {
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'mail.privateemail.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USERNAME: 'info@nolnk.net',
      SMTP_PASSWORD: realSecret('smtp'),
      SMTP_FROM: 'info@nolnk.net',
    };

    it('boots when every required key is present', () => {
      const env = parseEnv({ ...PROD_BASE, ...SMTP });
      expect(env.MAIL_PROVIDER).toBe('smtp');
      expect(env.SMTP_PORT).toBe(587);
      expect(env.SMTP_SECURE).toBe(false);
    });

    it.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM'])(
      'refuses to boot when %s is missing, naming the key and not its value',
      (missing) => {
        const { [missing]: _omitted, ...incomplete } = SMTP;
        const message = (() => {
          try {
            parseEnv({ ...PROD_BASE, ...incomplete });
            return '';
          } catch (error) {
            return (error as Error).message;
          }
        })();

        expect(message).toMatch(new RegExp(missing));
        expect(message).not.toMatch(/mail\.privateemail\.com/);
        expect(message).not.toMatch(/info@nolnk\.net/);
      },
    );

    it('reports every missing key at once', () => {
      expect(() => parseEnv({ ...PROD_BASE, MAIL_PROVIDER: 'smtp' })).toThrow(
        /SMTP_HOST[\s\S]*SMTP_PORT[\s\S]*SMTP_USERNAME[\s\S]*SMTP_PASSWORD[\s\S]*SMTP_FROM/,
      );
    });

    it('refuses the published development placeholder for SMTP_PASSWORD', () => {
      const source = { ...PROD_BASE, ...SMTP, SMTP_PASSWORD: 'dev-only-smtp-0123456789abcdef' };

      expect(() => parseEnv(source)).toThrow(/SMTP_PASSWORD/);
      expect(() => parseEnv(source)).toThrow(/placeholder/i);
    });

    it('does not require any of this outside production', () => {
      // The schema itself does not refuse a developer who sets
      // MAIL_PROVIDER=smtp with nothing else; `createMailer` does, from the
      // `null` assembled below (mailer.test.ts).
      expect(() => parseEnv({ ...BASE, MAIL_PROVIDER: 'smtp' })).not.toThrow();
      expect(parseEnv({ ...BASE, MAIL_PROVIDER: 'smtp' }).mail.smtp).toBeNull();
    });

    /**
     * `env.mail` — what the carrier connects with (tm 255.3). Assembled once,
     * like `env.storage`, and `null` whenever it would be half a configuration.
     */
    describe('env.mail', () => {
      it('assembles the carrier configuration from the seven keys', () => {
        const env = parseEnv({ ...PROD_BASE, ...SMTP, SMTP_TIMEOUT_MS: '2500' });

        expect(env.mail).toEqual({
          dir: env.MAIL_DIR,
          smtp: {
            host: 'mail.privateemail.com',
            port: 587,
            secure: false,
            username: 'info@nolnk.net',
            password: SMTP.SMTP_PASSWORD,
            from: 'info@nolnk.net',
            timeoutMs: 2500,
          },
        });
      });

      it('follows the port when SMTP_SECURE is unset: 465 is TLS from the first byte, anything else STARTTLS', () => {
        const { SMTP_SECURE: _unset, ...withoutSecure } = SMTP;

        expect(
          parseEnv({ ...PROD_BASE, ...withoutSecure, SMTP_PORT: '465' }).mail.smtp?.secure,
        ).toBe(true);
        expect(
          parseEnv({ ...PROD_BASE, ...withoutSecure, SMTP_PORT: '587' }).mail.smtp?.secure,
        ).toBe(false);
        // An explicit value wins over the port.
        expect(
          parseEnv({ ...PROD_BASE, ...SMTP, SMTP_PORT: '465', SMTP_SECURE: 'false' }).mail.smtp
            ?.secure,
        ).toBe(false);
      });

      it('defaults the per-step timeout to 10 s', () => {
        expect(parseEnv({ ...PROD_BASE, ...SMTP }).mail.smtp?.timeoutMs).toBe(10_000);
      });

      it('is null for every other provider, even with the keys set', () => {
        expect(parseEnv({ ...PROD_BASE, ...SMTP, MAIL_PROVIDER: 'file' }).mail.smtp).toBeNull();
        expect(parseEnv({ ...PROD_BASE, ...SMTP, MAIL_PROVIDER: 'null' }).mail.smtp).toBeNull();
      });

      it('offers no key that relaxes TLS — the SMTP surface is exactly the seven keys', () => {
        // Test strategy (8): certificate verification cannot be switched off,
        // because no configuration reaches it. A future SMTP_TLS_REJECT_… or
        // SMTP_INSECURE would have to be added here first, on purpose.
        const smtpKeys = Object.keys(envSchema.shape).filter((key) => key.startsWith('SMTP_'));
        expect(smtpKeys.sort()).toEqual([
          'SMTP_FROM',
          'SMTP_HOST',
          'SMTP_PASSWORD',
          'SMTP_PORT',
          'SMTP_SECURE',
          'SMTP_TIMEOUT_MS',
          'SMTP_USERNAME',
        ]);
      });
    });
  });

  /**
   * `LLM_PROVIDER=openai` in production (tm 255.5 · NFR-C4 · ADR §7).
   *
   * A remote model is a third party the conversation goes to, so production
   * asks for three things the stub never needed: the keys that reach it, a
   * *declared* region (the default, "this process's own", is true only of the
   * stub), and a host that actually answers in the declared region — the
   * residency gate trusts the declaration, so a mismatch would pass a covered
   * workspace's content across the border with the gate reporting it had not.
   */
  describe('LLM_PROVIDER=openai', () => {
    const OPENAI: NodeJS.ProcessEnv = {
      LLM_PROVIDER: 'openai',
      LLM_PROVIDER_REGION: 'eu',
      LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
      LLM_MODEL: 'a-model-id',
      LLM_API_KEY: realSecret('llm'),
    };

    const problemsOf = (source: NodeJS.ProcessEnv): string => {
      try {
        parseEnv(source);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };

    it('boots on a regional host that matches the declared region', () => {
      const env = parseEnv({ ...PROD_BASE, ...OPENAI });
      expect(env.LLM_PROVIDER).toBe('openai');
      expect(env.llm.openai).toEqual({
        baseUrl: 'https://eu.api.openai.com/v1',
        model: 'a-model-id',
        apiKey: OPENAI.LLM_API_KEY,
      });
      expect(
        parseEnv({
          ...PROD_BASE,
          ...OPENAI,
          LLM_PROVIDER_REGION: 'us',
          LLM_API_BASE_URL: 'https://us.api.openai.com/v1',
        }).LLM_PROVIDER_REGION,
      ).toBe('us');
    });

    it.each(['LLM_API_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_PROVIDER_REGION'])(
      'refuses to boot without %s, naming the key',
      (missing) => {
        const { [missing]: _omitted, ...incomplete } = OPENAI;
        expect(problemsOf({ ...PROD_BASE, ...incomplete })).toContain(
          `${missing} is required in production when LLM_PROVIDER=openai.`,
        );
      },
    );

    it('refuses the global host, which no region can truthfully be claimed for', () => {
      const message = problemsOf({
        ...PROD_BASE,
        ...OPENAI,
        LLM_API_BASE_URL: 'https://api.openai.com/v1',
      });
      expect(message).toMatch(/api\.openai\.com, which does not say where/);
      expect(message).toContain('eu.api.openai.com');
    });

    it('refuses a declared region the host does not answer in', () => {
      const message = problemsOf({
        ...PROD_BASE,
        ...OPENAI,
        LLM_PROVIDER_REGION: 'eu',
        LLM_API_BASE_URL: 'https://us.api.openai.com/v1',
      });
      expect(message).toMatch(/LLM_PROVIDER_REGION=eu but LLM_API_BASE_URL is the us host/);
    });

    it('refuses a host that is not an OpenAI regional host, and plain http', () => {
      expect(
        problemsOf({ ...PROD_BASE, ...OPENAI, LLM_API_BASE_URL: 'https://llm.example.test/v1' }),
      ).toMatch(/not an OpenAI regional host/);
      expect(
        problemsOf({ ...PROD_BASE, ...OPENAI, LLM_API_BASE_URL: 'http://eu.api.openai.com/v1' }),
      ).toMatch(/must use https/);
    });

    it('refuses the development placeholder key, and never prints a key it was given', () => {
      const placeholder = 'dev-only-llm-0123456789abcdef';
      const message = problemsOf({
        ...PROD_BASE,
        ...OPENAI,
        LLM_API_KEY: placeholder,
        LLM_API_BASE_URL: 'https://api.openai.com/v1',
      });
      expect(message).toMatch(/LLM_API_KEY still holds its development placeholder value/);
      expect(message).not.toContain(placeholder);
    });

    it('asks nothing of the mock, in production or anywhere else', () => {
      // The stub runs in this process, so its region *is* this process's and
      // there is nothing to reach. `.env.production.example` still ships it.
      const env = parseEnv({ ...PROD_BASE, LLM_PROVIDER: 'mock' });
      expect(env.llm.openai).toBeNull();
      expect(parseEnv({ ...BASE, ...OPENAI, LLM_PROVIDER: 'mock' }).llm.openai).toBeNull();
    });

    it('leaves development free to point anywhere; the factory, not the schema, refuses a half configuration', () => {
      const env = parseEnv({
        ...BASE,
        NODE_ENV: 'development',
        LLM_PROVIDER: 'openai',
        LLM_API_BASE_URL: 'http://127.0.0.1:9999/v1',
      });
      expect(env.llm.openai).toBeNull();
    });

    it('defaults the per-call limits the engine passes on', () => {
      const env = parseEnv(BASE);
      expect(env.LLM_TIMEOUT_MS).toBe(20_000);
      expect(env.LLM_MAX_OUTPUT_TOKENS).toBe(400);
      expect(() => parseEnv({ ...BASE, LLM_TIMEOUT_MS: '0' })).toThrow(/LLM_TIMEOUT_MS/);
      expect(() => parseEnv({ ...BASE, LLM_MAX_OUTPUT_TOKENS: '-1' })).toThrow(
        /LLM_MAX_OUTPUT_TOKENS/,
      );
    });

    it('defaults the prompt ceiling above every ordinary prompt, and refuses one no prompt fits (tm 255.9)', () => {
      // 12,361 is the longest prompt built from ordinary passages (a 10,000-
      // character message, three of them, the instructions); the default leaves
      // room above it (`llm-provider.test.ts` measures it).
      expect(parseEnv(BASE).LLM_MAX_PROMPT_CHARS).toBe(16_000);
      expect(parseEnv({ ...BASE, LLM_MAX_PROMPT_CHARS: '8000' }).LLM_MAX_PROMPT_CHARS).toBe(8_000);
      // Below the instructions and one passage every conversation would go to a
      // human — a misconfiguration, refused at boot rather than in production.
      expect(() => parseEnv({ ...BASE, LLM_MAX_PROMPT_CHARS: '500' })).toThrow(
        /LLM_MAX_PROMPT_CHARS/,
      );
    });
  });

  /**
   * `EMBEDDING_PROVIDER=openai` in production (tm 255.7 · NFR-C4 · ADR §7, §9.2).
   *
   * The same three demands as the chat model, under the embedding provider's
   * own keys: the query path embeds the customer's message, so a remote
   * embedder is a third party the conversation reaches before any model does.
   */
  describe('EMBEDDING_PROVIDER=openai', () => {
    const EMBEDDER: NodeJS.ProcessEnv = {
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_PROVIDER_REGION: 'eu',
      EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_API_KEY: realSecret('embedding'),
    };

    const problemsOf = (source: NodeJS.ProcessEnv): string => {
      try {
        parseEnv(source);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };

    it('boots on a regional host that matches the declared region, apart from the chat model', () => {
      const env = parseEnv({ ...PROD_BASE, ...EMBEDDER });
      expect(env.EMBEDDING_PROVIDER).toBe('openai');
      // Configured apart (ADR §4.2): the chat model can stay the stub.
      expect(env.LLM_PROVIDER).toBe('mock');
      expect(env.embedding.openai).toEqual({
        baseUrl: 'https://eu.api.openai.com/v1',
        model: 'text-embedding-3-small',
        apiKey: EMBEDDER.EMBEDDING_API_KEY,
        timeoutMs: 10_000,
      });
    });

    it.each([
      'EMBEDDING_API_BASE_URL',
      'EMBEDDING_MODEL',
      'EMBEDDING_API_KEY',
      'EMBEDDING_PROVIDER_REGION',
    ])('refuses to boot without %s, naming the key', (missing) => {
      const { [missing]: _omitted, ...incomplete } = EMBEDDER;
      expect(problemsOf({ ...PROD_BASE, ...incomplete })).toContain(
        `${missing} is required in production when EMBEDDING_PROVIDER=openai.`,
      );
    });

    it('refuses the global host and a region the host does not answer in', () => {
      expect(
        problemsOf({
          ...PROD_BASE,
          ...EMBEDDER,
          EMBEDDING_API_BASE_URL: 'https://api.openai.com/v1',
        }),
      ).toMatch(/EMBEDDING_API_BASE_URL points at api\.openai\.com, which does not say where/);
      expect(
        problemsOf({
          ...PROD_BASE,
          ...EMBEDDER,
          EMBEDDING_API_BASE_URL: 'https://us.api.openai.com/v1',
        }),
      ).toMatch(/EMBEDDING_PROVIDER_REGION=eu but EMBEDDING_API_BASE_URL is the us host/);
    });

    it('refuses the development placeholder key, and never prints a key it was given', () => {
      const placeholder = 'dev-only-embedding-0123456789abcdef';
      const message = problemsOf({
        ...PROD_BASE,
        ...EMBEDDER,
        EMBEDDING_API_KEY: placeholder,
        EMBEDDING_API_BASE_URL: 'https://api.openai.com/v1',
      });
      expect(message).toMatch(/EMBEDDING_API_KEY still holds its development placeholder value/);
      expect(message).not.toContain(placeholder);
    });

    it('asks nothing of the mock, and leaves a half configuration to the factory', () => {
      expect(parseEnv({ ...PROD_BASE, EMBEDDING_PROVIDER: 'mock' }).embedding.openai).toBeNull();
      expect(
        parseEnv({
          ...BASE,
          NODE_ENV: 'development',
          EMBEDDING_PROVIDER: 'openai',
          EMBEDDING_API_BASE_URL: 'http://127.0.0.1:9999/v1',
        }).embedding.openai,
      ).toBeNull();
    });

    it('holds EMBEDDING_DIMENSIONS to the column, in every environment (FR-MOD-06.3.2)', () => {
      expect(parseEnv(BASE).EMBEDDING_DIMENSIONS).toBe(1536);
      expect(parseEnv({ ...BASE, EMBEDDING_DIMENSIONS: '1536' }).EMBEDDING_DIMENSIONS).toBe(1536);
      for (const width of ['3072', '1024', '1535']) {
        expect(() => parseEnv({ ...BASE, EMBEDDING_DIMENSIONS: width })).toThrow(
          /EMBEDDING_DIMENSIONS: must be 1536: knowledge_chunks\.embedding is vector\(1536\)/,
        );
      }
      expect(() => parseEnv({ ...BASE, EMBEDDING_DIMENSIONS: 'wide' })).toThrow(
        /EMBEDDING_DIMENSIONS/,
      );
    });

    it('defaults the request timeout, apart from the chat timeout', () => {
      expect(parseEnv(BASE).EMBEDDING_TIMEOUT_MS).toBe(10_000);
      expect(
        parseEnv({ ...BASE, ...EMBEDDER, EMBEDDING_TIMEOUT_MS: '2500' }).embedding.openai
          ?.timeoutMs,
      ).toBe(2_500);
      expect(() => parseEnv({ ...BASE, EMBEDDING_TIMEOUT_MS: '0' })).toThrow(
        /EMBEDDING_TIMEOUT_MS/,
      );
    });
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
    expect(message).toMatch(/WEB_ORIGIN/);
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

  /**
   * The widget's origin has to be on the CORS allowlist (tm 243).
   *
   * The defect this closes was not in any function: `.env.production.example`,
   * `README`, `docs/production-checklist.md` and the Helm production overlay
   * all told an operator to set `WEB_ORIGIN` to the panel's origin, and none of
   * the four mentioned the widget's — which serves everything a *customer* ever
   * loads, and calls this API cross-origin from there. Following those
   * instructions to the letter produced a deployment where the agent panel
   * worked and every conversation failed, with no error anywhere: the browser
   * drops a disallowed cross-origin response.
   *
   * Fixing the four documents alone would have left the next deployment that
   * writes its own configuration exposed to the same thing, so the sentence is
   * a boot check. What the check must NOT do is refuse a topology that is
   * actually fine — that is the point of the two "boots" cases below, and they
   * are the reason this is a membership test on the widget's *origin* rather
   * than a demand for a second entry.
   */
  describe('a production WEB_ORIGIN that forgets the widget', () => {
    it('refuses to boot, naming both keys and the consequence', () => {
      const panelOnly = { ...PROD_BASE, WEB_ORIGIN: PANEL_ORIGIN };

      expect(() => parseEnv(panelOnly)).toThrow(/WEB_ORIGIN/);
      expect(() => parseEnv(panelOnly)).toThrow(/WIDGET_BASE_URL/);
      // The message has to carry the origin that is missing, not only the key
      // name: an operator reading it should be able to paste the fix.
      expect(() => parseEnv(panelOnly)).toThrow(new RegExp(WIDGET_ORIGIN));
    });

    it('refuses the exact configuration the four documents used to describe', () => {
      // `WEB_ORIGIN=https://panel.<your-domain>` beside
      // `WIDGET_BASE_URL=https://widget.<your-domain>`, which is what
      // .env.production.example and values.production.example.yaml shipped.
      expect(() =>
        parseEnv({
          ...PROD_BASE,
          WEB_ORIGIN: 'https://panel.example.com',
          WIDGET_BASE_URL: 'https://widget.example.com',
        }),
      ).toThrow(/widget/i);
    });

    it('refuses the schema defaults too — :5173 and :5174 are different origins', () => {
      const { WEB_ORIGIN: _panel, WIDGET_BASE_URL: _widget, ...defaults } = PROD_BASE;

      expect(() => parseEnv(defaults)).toThrow(/localhost:5174/);
    });

    it('boots when the widget is served from the panel host, with or without a path', () => {
      // The topology the check could plausibly have locked out, and does not:
      // one host serving both, where the widget's origin is already on the list
      // because it IS the panel's. Verified rather than assumed — a check that
      // demanded a second entry would refuse a perfectly correct deployment.
      for (const widgetUrl of [PANEL_ORIGIN, `${PANEL_ORIGIN}/widget/`]) {
        const env = parseEnv({
          ...PROD_BASE,
          WEB_ORIGIN: PANEL_ORIGIN,
          WIDGET_BASE_URL: widgetUrl,
        });
        expect(env.webOrigins, widgetUrl).toEqual([PANEL_ORIGIN]);
      }
    });

    it('boots when the list names the widget among several origins', () => {
      const env = parseEnv({
        ...PROD_BASE,
        WEB_ORIGIN: `${PANEL_ORIGIN}, https://chat.siyahtus.test , ${WIDGET_ORIGIN}/`,
      });

      // Normalisation applies to the membership test as well: a trailing slash
      // and surrounding whitespace are how a real list gets typed.
      expect(env.webOrigins).toContain(WIDGET_ORIGIN);
    });

    it('costs development and test nothing — they boot on the mismatched defaults', () => {
      // `make dev` runs the panel on :5173 and the widget on :5174 and has
      // always been fine, because CORS is only an allowlist under production
      // (`server.ts`). This check must not become a cost paid everywhere.
      for (const nodeEnv of ['development', 'test'] as const) {
        expect(() => parseEnv({ ...BASE, NODE_ENV: nodeEnv })).not.toThrow();
      }
    });
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
      DATABASE_APP_URL: 'postgresql://siyahtus_app:app-password@127.0.0.1:5432/siyahtus',
      DATABASE_POOL_SIZE: '15',
    });
    const url = new URL(env.runtimeDatabaseUrl);
    expect(url.origin + url.pathname).toBe(
      new URL('postgresql://siyahtus_app:app-password@127.0.0.1:5432/siyahtus').origin +
        '/siyahtus',
    );
    expect(url.searchParams.get('connection_limit')).toBe('15');
    expect(new URL(env.DATABASE_URL).searchParams.get('connection_limit')).toBeNull();
  });

  it('leaves an explicit connection_limit already on the url alone', () => {
    const env = parseEnv({
      ...BASE,
      DATABASE_URL: 'postgresql://siyahtus:siyahtus@127.0.0.1:5432/siyahtus?connection_limit=3',
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
  const APP_URL = 'postgresql://siyahtus_app:app-password@127.0.0.1:5432/siyahtus';

  it('is undefined when unset, so reads stay on the primary', () => {
    expect(parseEnv(BASE).replicaDatabaseUrl).toBeUndefined();
    expect(parseEnv({ ...BASE, DATABASE_APP_URL: APP_URL }).replicaDatabaseUrl).toBeUndefined();
  });

  it('is carried through when set', () => {
    const replica = 'postgresql://siyahtus_app:app-password@replica.internal:5432/siyahtus';
    const env = parseEnv({ ...BASE, DATABASE_APP_URL: APP_URL, DATABASE_REPLICA_URL: replica });
    expect(env.replicaDatabaseUrl).toBe(replica);
  });

  it('gets the same pool size as the primary — its connections come out of the same budget', () => {
    const env = parseEnv({
      ...BASE,
      DATABASE_APP_URL: APP_URL,
      DATABASE_REPLICA_URL: 'postgresql://siyahtus_app:app-password@replica.internal:5432/siyahtus',
      DATABASE_POOL_SIZE: '15',
    });
    expect(new URL(env.replicaDatabaseUrl!).searchParams.get('connection_limit')).toBe('15');
    expect(new URL(env.runtimeDatabaseUrl).searchParams.get('connection_limit')).toBe('15');
  });

  it('refuses a replica that connects as the table owner while the primary does not', () => {
    // The failure being bought out: `siyahtus` owns the tables, Postgres exempts
    // owners from RLS, and this URL would be handed to every report query.
    expect(() =>
      parseEnv({
        ...BASE,
        DATABASE_APP_URL: APP_URL,
        DATABASE_REPLICA_URL: 'postgresql://siyahtus:siyahtus@replica.internal:5432/siyahtus',
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
          DATABASE_REPLICA_URL: 'postgresql://siyahtus:siyahtus@replica.internal:5432/siyahtus',
        }),
      ).toThrow(/row level security/);
    }
  });

  it('allows a third read-only role — the rule is "not the owner", not "must be siyahtus_app"', () => {
    const replica =
      'postgresql://siyahtus_reporting:reporting-password@replica.internal:5432/siyahtus';
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
