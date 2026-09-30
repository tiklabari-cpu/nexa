/**
 * The pilot's configuration against the production gate (tm 255.15).
 *
 * The pilot runs `docker-compose.pilot.yml` with a `.env` copied from
 * `.env.production.example` and filled in. So the environment the api actually
 * boots with is those two files together: the template's keys with every
 * `<…>` replaced, under the compose file's own `environment:` (which wins,
 * the way Compose applies it). This suite builds exactly that from the two
 * files in the repository — not from a hand-written fixture that could drift
 * away from them — and asks `parseEnv` the production question:
 *
 *   - filled in, it boots, with the three real providers the pilot chose;
 *   - every key the gate requires, taken away alone, refuses the boot and the
 *     refusal names it;
 *   - every `<…>` the template ships, left in alone, refuses the boot and
 *     names its key.
 *
 * `env.test.ts` covers each rule in isolation; this file is the join between
 * those rules and the files an operator actually copies.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEmbeddingProvider } from '../services/ai/provider/create-embedding-provider.js';
import { createLlmProvider } from '../services/ai/provider/llm-provider.js';
import { createMailer } from '../services/mail/mailer.js';
import { parseEnv, SECRET_KEYS, TEMPLATE_PLACEHOLDER } from './env.js';

// src/config → apps/api → apps → repo root (same resolution as env.parity.test.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf8');

const TEMPLATE = read('.env.production.example');
const COMPOSE = read('docker-compose.pilot.yml');

/** Uncommented `KEY=value` lines — what a copy of the template sets. */
function templateEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const match of TEMPLATE.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
    entries[match[1]!] = match[2]!.trim();
  }
  return entries;
}

/**
 * One `<…>` fill-in replaced the way an operator would: generated secrets get
 * 64 hex characters, everything else a hostname-safe word, so a URL built
 * around the placeholder (`https://panel.<your-domain>`) stays a URL.
 */
function fillIn(value: string): string {
  return value.replace(/<[^<>]+>/g, (placeholder) =>
    placeholder.includes('openssl rand -hex 32')
      ? 'ab'.repeat(32)
      : placeholder.includes('address')
        ? 'pilot@siyahtus.test'
        : placeholder
            .slice(1, -1)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
  );
}

/** The lines of one top-level (`x-…:`) or service (`  name:`) block. */
function block(header: RegExp): string {
  const lines = COMPOSE.split('\n');
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) throw new Error(`docker-compose.pilot.yml has no block matching ${header}`);
  const indent = /^\s*/.exec(lines[start]!)![0].length;
  const end = lines.findIndex(
    (line, i) => i > start && line.trim() !== '' && /^\s*/.exec(line)![0].length <= indent,
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** `KEY: value` pairs of a flat environment map, `${VAR…}` resolved from `.env`. */
function composeEnvironment(
  source: string,
  dotenv: Record<string, string>,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const match of source.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*(.+)$/gm)) {
    entries[match[1]!] = match[2]!
      .trim()
      .replace(/\$\{([A-Z][A-Z0-9_]*)(?::[?-][^}]*)?\}/g, (_, name: string) => {
        const value = dotenv[name];
        if (value === undefined) throw new Error(`compose reads \${${name}}, .env has no ${name}`);
        return value;
      });
  }
  return entries;
}

const TEMPLATE_ENTRIES = templateEntries();

const filledDotenv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(TEMPLATE_ENTRIES).map(([key, value]) => [key, fillIn(value)]));

/** What the api container's process sees: `env_file`, then `environment:` over it. */
function pilotEnvFrom(dotenv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...dotenv,
    ...composeEnvironment(block(/^x-app-environment:/), dotenv),
    ...composeEnvironment(block(/^ {2}api:$/).split(/^ {4}ports:/m)[0]!, dotenv),
  };
  delete env['<<'];
  return env;
}

const dotenv = filledDotenv();
const PILOT_ENV = pilotEnvFrom(dotenv);

/**
 * Keys `.env` only feeds to Compose's own `${…}`: a fill-in left in one of
 * them reaches the api inside the URL the compose file builds from it.
 */
const COMPOSE_ONLY: Record<string, string> = {
  POSTGRES_PASSWORD: 'DATABASE_URL',
  SIYAHTUS_APP_DB_PASSWORD: 'DATABASE_APP_URL',
};
/** Template lines the compose file overrides — not what the pilot's api reads. */
const OVERRIDDEN = ['DATABASE_URL', 'DATABASE_APP_URL', 'REDIS_URL'];

describe('the pilot configuration passes the production gate (tm 255.15)', () => {
  it('reads a real configuration out of the two files (guards a vacuous parse)', () => {
    expect(Object.keys(dotenv).length).toBeGreaterThan(30);
    expect(PILOT_ENV['NODE_ENV']).toBe('production');
    expect(PILOT_ENV['DATABASE_APP_URL']).toMatch(
      /^postgresql:\/\/siyahtus_app:[0-9a-f]{64}@db:5432\/siyahtus$/,
    );
    // The compose values win over the template's own database lines.
    expect(PILOT_ENV['DATABASE_URL']).not.toContain('db-host');
  });

  it('boots, filled in, with the real providers the pilot chose', () => {
    const env = parseEnv(PILOT_ENV);

    expect(env.isProduction).toBe(true);
    expect(new URL(env.runtimeDatabaseUrl).username).toBe('siyahtus_app');
    expect(env.mail.smtp).not.toBeNull();
    expect(env.llm.openai).not.toBeNull();
    expect(env.embedding.openai).not.toBeNull();
    expect(env.webOrigins).toContain(new URL(env.WIDGET_BASE_URL).origin);
  });

  const REQUIRED = [
    'DATABASE_URL',
    'DATABASE_APP_URL',
    'REDIS_URL',
    ...SECRET_KEYS,
    'INBOUND_EMAIL_SECRET',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USERNAME',
    'SMTP_PASSWORD',
    'SMTP_FROM',
    'LLM_API_BASE_URL',
    'LLM_MODEL',
    'LLM_API_KEY',
    'LLM_PROVIDER_REGION',
    'EMBEDDING_API_BASE_URL',
    'EMBEDDING_MODEL',
    'EMBEDDING_API_KEY',
    'EMBEDDING_PROVIDER_REGION',
  ];

  it.each(REQUIRED)('refuses to boot without %s, and says so by name', (key) => {
    const source = { ...PILOT_ENV };
    delete source[key];

    expect(() => parseEnv(source)).toThrow(key);
  });

  it('refuses a WEB_ORIGIN that drops the widget, naming WEB_ORIGIN', () => {
    const panelOnly = PILOT_ENV['WEB_APP_URL']!;
    expect(() => parseEnv({ ...PILOT_ENV, WEB_ORIGIN: panelOnly })).toThrow(
      /WEB_ORIGIN must include/,
    );
  });

  it("registers the pilot's own panel address as the console callback (tm 255.17)", () => {
    const env = parseEnv(PILOT_ENV);
    expect(env.consoleRedirectUri).toBe(`${new URL(env.WEB_APP_URL).origin}/auth/callback`);
    expect(env.consoleRedirectUri).toMatch(/^https:\/\//);
  });

  it('refuses a WEB_APP_URL no sign-in could ever be redirected to, naming WEB_APP_URL', () => {
    // Plain http off loopback: `isRegisteredRedirect` refuses it, so every
    // owner would be turned away at /auth/authorize by a server that booted.
    expect(() => parseEnv({ ...PILOT_ENV, WEB_APP_URL: 'http://panel.example.com' })).toThrow(
      /WEB_APP_URL must be an https address/,
    );
  });

  it.each(SECRET_KEYS)('refuses %s holding the dev-only placeholder', (key) => {
    const source = { ...PILOT_ENV, [key]: `dev-only-${'x'.repeat(40)}` };
    expect(() => parseEnv(source)).toThrow(`${key} still holds its development placeholder`);
  });

  const templated = Object.entries(TEMPLATE_ENTRIES).filter(([, value]) =>
    TEMPLATE_PLACEHOLDER.test(value),
  );

  it('finds the fill-ins the pilot has to supply (guards a vacuous list below)', () => {
    const keys = templated.map(([key]) => key);
    for (const key of [
      'LLM_API_KEY',
      'EMBEDDING_API_KEY',
      'SMTP_PASSWORD',
      'INBOUND_EMAIL_SECRET',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it.each(templated)('refuses %s left at its template value, naming the key', (key, value) => {
    const source = pilotEnvFrom({ ...filledDotenv(), [key]: value });

    if (OVERRIDDEN.includes(key)) {
      // The compose file assembles these itself; the template's line is for a
      // database run elsewhere, and is refused there by the same rule.
      expect(() => parseEnv(source)).not.toThrow();
      expect(() => parseEnv({ ...PILOT_ENV, [key]: value })).toThrow(key);
      return;
    }
    expect(() => parseEnv(source), `${key}=${value} booted`).toThrow(COMPOSE_ONLY[key] ?? key);
  });

  it('constructs the three real providers the way buildServer does', () => {
    // The first rehearsal of this stack got past `parseEnv` and died here:
    // `SMTP_FROM=Name <addr>` is a valid string to the schema and refused by
    // `SmtpMailer`'s constructor, so "the gate passes" has to include this step.
    // Construction opens no connection; nothing here reaches a provider.
    const env = parseEnv(PILOT_ENV);

    expect(() => createMailer(env.MAIL_PROVIDER, env.mail)).not.toThrow();
    expect(() => createLlmProvider(env.LLM_PROVIDER, env.llm)).not.toThrow();
    expect(() => createEmbeddingProvider(env.EMBEDDING_PROVIDER, env.embedding)).not.toThrow();
    expect(() =>
      createMailer(env.MAIL_PROVIDER, {
        ...env.mail,
        smtp: { ...env.mail.smtp!, from: 'SiyahTuş <pilot@siyahtus.test>' },
      }),
    ).toThrow('SMTP_FROM must be a bare email address');
  });
});

describe('docker-compose.pilot.yml runs the product the production way (tm 255.15)', () => {
  const uncommented = COMPOSE.split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  it('sets NODE_ENV=production for api and rtm, and development nowhere', () => {
    expect(block(/^x-app-environment:/)).toMatch(/^\s+NODE_ENV: production$/m);
    expect(block(/^ {2}api:$/)).toContain('<<: *app-environment');
    expect(block(/^ {2}rtm:$/)).toContain('environment: *app-environment');
    expect(uncommented).not.toMatch(/NODE_ENV:\s*development/);
  });

  it('loads the real .env, never .env.example', () => {
    expect(block(/^x-app-env-file:/)).toMatch(/path: \$\{SIYAHTUS_ENV_FILE:-\.env\}/);
    expect(block(/^ {2}api:$/)).toContain('env_file: *app-env-file');
    expect(block(/^ {2}rtm:$/)).toContain('env_file: *app-env-file');
    expect(uncommented).not.toContain('.env.example');
  });

  it('publishes every port on 127.0.0.1 only — the reverse proxy is the public side', () => {
    const published = [...uncommented.matchAll(/^\s+- '([^']*:\d+)'$/gm)].map((m) => m[1]!);
    expect(published).toHaveLength(4);
    for (const mapping of published) expect(mapping.startsWith('127.0.0.1:')).toBe(true);
  });

  it('does not seed: a deployment database is not a demo (CONVENTIONS §6.1)', () => {
    expect(uncommented).not.toMatch(/seed/i);
    expect(uncommented).not.toMatch(/^ {2}init:$/m);
  });

  it('keeps the database on a named volume, and replaces the published siyahtus_app password', () => {
    const db = block(/^ {2}db:$/);
    expect(db).toContain('- siyahtus_pilot_pgdata:/var/lib/postgresql/data');
    expect(block(/^volumes:/)).toMatch(/^\s+siyahtus_pilot_pgdata:$/m);
    expect(db).toContain('infra/db/pilot/10-app-role-password.sh');
    expect(read('infra/db/pilot/10-app-role-password.sh')).toContain(
      "ALTER ROLE siyahtus_app PASSWORD :'app_password'",
    );
  });

  it('bakes the public addresses into the two browser bundles', () => {
    expect(block(/^ {2}web:$/)).toMatch(
      /VITE_RTM_URL: \$\{RTM_BASE_URL[^}]*\}\/v1\/agent\/rtm\/ws/,
    );
    expect(block(/^ {2}widget:$/)).toMatch(/VITE_API_BASE_URL: \$\{API_BASE_URL[^}]*\}\/api\/v1/);
  });
});

/** Lines of a Caddyfile with its `#` comments dropped. */
function caddyLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trimEnd())
    .filter((line) => line.trim() !== '');
}

/** Top-level site blocks (`name {` … `}` at column 0), by site address. */
function caddySites(source: string): Map<string, string[]> {
  const sites = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of caddyLines(source)) {
    const open = /^(\S+) \{$/.exec(line);
    if (open) sites.set(open[1]!, (current = []));
    else if (line === '}') current = null;
    else current?.push(line.trim());
  }
  return sites;
}

describe("the pilot's edge and operations (tm 256.5)", () => {
  const CADDYFILE = read('infra/pilot/Caddyfile.example');
  const sites = caddySites(CADDYFILE);

  /** The host port compose publishes a service on by default. */
  function publishedPort(service: string): string {
    const port = /- '127\.0\.0\.1:\$\{SIYAHTUS_[A-Z]+_HOST_PORT:-(\d+)\}:\d+'/.exec(
      block(new RegExp(`^ {2}${service}:$`)),
    )?.[1];
    if (!port) throw new Error(`docker-compose.pilot.yml publishes no port for ${service}`);
    return port;
  }

  /** Every upstream a site's `reverse_proxy` lines dial. */
  const upstreams = (site: string): string[] =>
    (sites.get(site) ?? []).flatMap((line) => /^reverse_proxy (\S+)$/.exec(line)?.[1] ?? []);

  it("rotates every service's log: json-file, bounded size and file count", () => {
    const logging = block(/^x-logging:/);
    expect(logging).toMatch(/^\s+driver: json-file$/m);
    expect(logging).toMatch(/^\s+max-size: \d+m$/m);
    expect(logging).toMatch(/^\s+max-file: '\d+'$/m);
    for (const service of ['db', 'redis', 'api', 'rtm', 'web', 'widget']) {
      expect(block(new RegExp(`^ {2}${service}:$`)), service).toContain('logging: *logging');
    }
    // A seventh service added without it fails here.
    const services = COMPOSE.match(/^ {4}restart: /gm) ?? [];
    expect(COMPOSE.match(/^ {4}logging: \*logging$/gm)).toHaveLength(services.length);
  });

  it('serves the four public names, each to the published port of its service', () => {
    expect([...sites.keys()]).toEqual([
      'panel.example.com',
      'widget.example.com',
      'api.example.com',
      'rtm.example.com',
    ]);
    expect(upstreams('widget.example.com')).toEqual([`127.0.0.1:${publishedPort('widget')}`]);
    expect(upstreams('api.example.com')).toEqual([`127.0.0.1:${publishedPort('api')}`]);
    expect(upstreams('rtm.example.com')).toEqual([`127.0.0.1:${publishedPort('rtm')}`]);
  });

  it("sends the panel's /api/* straight to the api — one hop on every path, as TRUST_PROXY_HOPS=1 says", () => {
    const panel = (sites.get('panel.example.com') ?? []).join('\n');
    expect(panel).toContain(`handle /api/* {\nreverse_proxy 127.0.0.1:${publishedPort('api')}\n}`);
    expect(panel).toContain(`handle {\nreverse_proxy 127.0.0.1:${publishedPort('web')}\n}`);
    // Nothing else on the panel's name reaches the api by another route.
    expect(upstreams('panel.example.com')).toEqual([
      `127.0.0.1:${publishedPort('api')}`,
      `127.0.0.1:${publishedPort('web')}`,
    ]);
    expect(TEMPLATE_ENTRIES['TRUST_PROXY_HOPS']).toBe('1');
  });

  it('never believes an X-Forwarded-For the client sent', () => {
    const uncommented = caddyLines(CADDYFILE).join('\n');
    expect(uncommented).not.toContain('trusted_proxies');
    expect(uncommented).not.toMatch(/header_up\s+\+?X-Forwarded-For/i);
  });
});
