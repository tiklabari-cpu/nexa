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
    // The pilot is the public pilot (tm 257.13): the switch is on, and the
    // address it shows pilot users is the template's fill-in, filled.
    expect(env.PILOT_MODE).toBe(true);
    expect(env.PILOT_CONTACT_EMAIL).toBe('pilot@siyahtus.test');
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
    'PILOT_CONTACT_EMAIL',
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

  // tm 257.3: the panel's three other public addresses are baked in as well, or
  // the pilot shows localhost on the Chat page link, the KB article link and
  // the e-mail domain (the web Dockerfile used to know only VITE_RTM_URL).
  it('bakes the Chat page, KB and e-mail addresses into the panel bundle too', () => {
    const web = block(/^ {2}web:$/);
    expect(web).toMatch(/VITE_WIDGET_URL: \$\{WIDGET_BASE_URL:\?[^}]*\}\s*$/m);
    expect(web).toMatch(/VITE_KB_PUBLIC_BASE: \$\{API_BASE_URL:\?[^}]*\}\/api\/v1\s*$/m);
    expect(web).toMatch(/VITE_INBOUND_EMAIL_DOMAIN: \$\{INBOUND_EMAIL_DOMAIN:\?[^}]*\}\s*$/m);
    // The three source keys exist in the template the compose reads from.
    const entries = templateEntries();
    for (const key of ['WIDGET_BASE_URL', 'API_BASE_URL', 'INBOUND_EMAIL_DOMAIN']) {
      expect(entries).toHaveProperty([key]);
    }
    // Compose fills in a build arg only if the Dockerfile declares it.
    const dockerfile = read('apps/web/Dockerfile');
    for (const key of ['VITE_WIDGET_URL', 'VITE_KB_PUBLIC_BASE', 'VITE_INBOUND_EMAIL_DOMAIN']) {
      expect(dockerfile).toContain(`\nARG ${key}=`);
      expect(dockerfile).toContain(`\nENV ${key}=\${${key}}\n`);
    }
  });

  // An empty default would not fall back to the source's own localhost (`??`
  // only catches undefined) and would turn the Chat page link into a relative
  // '/chat.html'; the demo compose passes none of the three, so it needs them.
  it('keeps the web Dockerfile defaults at the localhost values the demo build has always had', () => {
    const dockerfile = read('apps/web/Dockerfile');
    expect(dockerfile).toMatch(/^ARG VITE_WIDGET_URL=http:\/\/localhost:5174$/m);
    expect(dockerfile).toMatch(/^ARG VITE_KB_PUBLIC_BASE=http:\/\/localhost:4000\/api\/v1$/m);
    expect(dockerfile).toMatch(/^ARG VITE_INBOUND_EMAIL_DOMAIN=inbound\.siyahtus\.localhost$/m);
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

/** The host port compose publishes a service on by default. */
function publishedPort(service: string): string {
  const port = /- '127\.0\.0\.1:\$\{SIYAHTUS_[A-Z]+_HOST_PORT:-(\d+)\}:\d+'/.exec(
    block(new RegExp(`^ {2}${service}:$`)),
  )?.[1];
  if (!port) throw new Error(`docker-compose.pilot.yml publishes no port for ${service}`);
  return port;
}

describe("the pilot's edge and operations (tm 256.5)", () => {
  const CADDYFILE = read('infra/pilot/Caddyfile.example');
  const sites = caddySites(CADDYFILE);

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

/** One cloudflared ingress rule — first match wins, as cloudflared reads them. */
type TunnelRule = { hostname?: string; path?: string; service?: string };
const TUNNEL_RULE_KEYS = new Set(['hostname', 'path', 'service']);

/**
 * `infra/pilot/cloudflared/config.example.yml`, read without a YAML parser
 * (apps/api has none, and the guard is not worth a dependency). The shape is
 * held to what the example uses — top-level `key: value` lines and an
 * `ingress:` list of flat `- key: value` rules — and any other line is an
 * error: a guard that skipped a line it did not understand could pass a file
 * whose routing it never read.
 */
function tunnelConfig(source: string): { top: Record<string, string>; ingress: TunnelRule[] } {
  const top: Record<string, string> = {};
  const ingress: TunnelRule[] = [];
  let inIngress = false;
  const addKey = (rule: TunnelRule, key: string, value: string, raw: string): void => {
    if (!TUNNEL_RULE_KEYS.has(key) || key in rule) {
      throw new Error(`config.example.yml: unexpected or repeated rule key in: ${raw}`);
    }
    rule[key as keyof TunnelRule] = value;
  };
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    const topLevel = /^([a-z][a-z-]*):(?: (\S+))?$/.exec(line);
    const opens = /^ {2}- ([a-zA-Z]+): (\S+)$/.exec(line);
    const continues = /^ {4}([a-zA-Z]+): (\S+)$/.exec(line);
    if (topLevel) {
      inIngress = topLevel[1] === 'ingress' && topLevel[2] === undefined;
      if (!inIngress) top[topLevel[1]!] = topLevel[2] ?? '';
    } else if (inIngress && opens) {
      const rule: TunnelRule = {};
      addKey(rule, opens[1]!, opens[2]!, raw);
      ingress.push(rule);
    } else if (inIngress && continues && ingress.length > 0) {
      addKey(ingress.at(-1)!, continues[1]!, continues[2]!, raw);
    } else {
      throw new Error(`config.example.yml: a line this guard does not understand: ${raw}`);
    }
  }
  return { top, ingress };
}

describe("the pilot's Cloudflare Tunnel edge (tm 257.10)", () => {
  // Read lazily: a missing file is a failed test with the path in it, not a
  // collection error that hides every other test in this file.
  const TUNNEL_PATH = 'infra/pilot/cloudflared/config.example.yml';
  const tunnelText = (): string => read(TUNNEL_PATH);
  const tunnel = () => tunnelConfig(tunnelText());
  const caddyNames = (): string[] => [...caddySites(read('infra/pilot/Caddyfile.example')).keys()];
  const origin = (service: string): string => `http://127.0.0.1:${publishedPort(service)}`;
  const rulesFor = (hostname: string): TunnelRule[] =>
    tunnel().ingress.filter((rule) => rule.hostname === hostname);

  it('is a locally managed tunnel whose identity lives outside the repository', () => {
    // A tunnel created in the dashboard ignores this file's ingress, so the
    // rules guarded below would be guarding nothing; `tunnel` +
    // `credentials-file` is what makes the file the one cloudflared obeys.
    const { top, ingress } = tunnel();
    expect(top).toEqual({
      tunnel: '<tunnel-uuid>',
      'credentials-file': '/etc/cloudflared/<tunnel-uuid>.json',
    });
    expect(ingress).toHaveLength(6);
  });

  it('serves the same four names as the Caddyfile — the edge can change, the names cannot', () => {
    // API_BASE_URL and RTM_BASE_URL are baked into the widget and panel
    // bundles at build time (docker-compose.pilot.yml, VITE_API_BASE_URL and
    // VITE_RTM_URL), so moving to the other edge must not move a name.
    const names = [
      ...new Set(tunnel().ingress.flatMap((rule) => (rule.hostname ? [rule.hostname] : []))),
    ];
    expect(names.sort()).toEqual(caddyNames().sort());
    expect(names).toHaveLength(4);
  });

  it("dials each name's published port on 127.0.0.1", () => {
    expect(rulesFor('api.example.com')).toEqual([
      { hostname: 'api.example.com', service: origin('api') },
    ]);
    expect(rulesFor('rtm.example.com')).toEqual([
      { hostname: 'rtm.example.com', service: origin('rtm') },
    ]);
    expect(rulesFor('widget.example.com')).toEqual([
      { hostname: 'widget.example.com', service: origin('widget') },
    ]);
  });

  it('never names localhost, which may resolve to ::1 where compose publishes nothing', () => {
    const uncommented = tunnelText()
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(uncommented).not.toMatch(/localhost/i);
  });

  it("sends the panel's /api/ to the api before the panel's catch-all — one hop, as TRUST_PROXY_HOPS=1 says", () => {
    // First match wins. Below the catch-all, the panel's /api/ would reach the
    // api through the panel's nginx — a second hop, and every panel user on
    // one address (PLAN §D197).
    expect(rulesFor('panel.example.com')).toEqual([
      { hostname: 'panel.example.com', path: '^/api/', service: origin('api') },
      { hostname: 'panel.example.com', service: origin('web') },
    ]);
    expect(TEMPLATE_ENTRIES['TRUST_PROXY_HOPS']).toBe('1');
  });

  it('ends in a nameless 404, and no earlier rule is nameless', () => {
    // A nameless rule matches every request, so one above the end would take
    // the traffic of every rule after it.
    const { ingress } = tunnel();
    expect(ingress.at(-1)).toEqual({ service: 'http_status:404' });
    for (const rule of ingress.slice(0, -1)) expect(rule.hostname, rule.service).toBeDefined();
  });

  it('keeps a tunnel credential out of .env, which compose hands whole to api and rtm', () => {
    for (const key of Object.keys(TEMPLATE_ENTRIES)) {
      expect(key).not.toMatch(/TUNNEL|CLOUDFLARE/);
    }
    const composeUncommented = COMPOSE.split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(composeUncommented).not.toMatch(/TUNNEL|CLOUDFLARE/i);
  });

  const lines = (path: string): string[] => read(path).split(/\r?\n/);

  it.each([
    ['.gitignore', '**/.cloudflared/'],
    ['.gitignore', 'infra/pilot/cloudflared/*.json'],
    ['.gitignore', 'infra/pilot/cloudflared/config.yml'],
    ['.dockerignore', '**/.env'],
    ['.dockerignore', '**/.env.*'],
    ['.dockerignore', '**/*.pem'],
    ['.dockerignore', '**/*.key'],
    ['.dockerignore', '**/secrets/'],
    ['.dockerignore', '**/.cloudflared/'],
    ['.dockerignore', '**/cloudflared/*.json'],
    ['.dockerignore', 'backups/'],
  ])('%s carries the line %s', (file, line) => {
    expect(lines(file)).toContain(line);
  });

  it('.dockerignore still lets .env.example in, after the patterns that would drop it', () => {
    // Docker applies the last matching line, so the exception only works below them.
    const docker = lines('.dockerignore');
    expect(docker.indexOf('**/.env.*')).toBeGreaterThanOrEqual(0);
    expect(docker.lastIndexOf('!.env.example')).toBeGreaterThan(docker.indexOf('**/.env.*'));
  });
});
