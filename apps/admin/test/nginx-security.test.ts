/**
 * The security profile the admin image serves (tm 389.6).
 *
 * `apps/admin/nginx.conf` is the only place a response header can be set for the root panel —
 * it is not a Node process, so there is no helmet and no test that can send it a request
 * without a container. This file reads it as text and pins the things that are easy to get
 * wrong and impossible to notice (the same job apps/web/test/nginx-security.test.ts does for
 * the workspace panel):
 *
 *   1. nginx's `add_header` inheritance. A block that declares one `add_header` silently
 *      discards every one it would otherwise inherit — so the two locations that set
 *      `Cache-Control` are exactly the two that would lose the profile if it were declared once
 *      at server level. That is why it is repeated per location.
 *   2. The script hash. The CSP pins `index.html`'s inline theme boot by hash instead of
 *      opening the policy with 'unsafe-inline'. Edit that script and the hash no longer
 *      matches; the browser then refuses to run it and nothing in the build says so.
 *   3. Never embeddable. A back office that can be framed can be clicked through by whatever
 *      page framed it (`frame-ancestors 'none'` and `X-Frame-Options: DENY`).
 *   4. One origin. The panel talks to `/platform/v1` on its own origin and to nothing else —
 *      no WebSocket, no RTM address, no CDN — so `connect-src` is exactly `'self'`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(resolve(APP_ROOT, path), 'utf8');

/** Whole-line `#` comments, dropped so prose about `add_header` never counts as one. */
const stripComments = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

interface LocationBlock {
  match: string;
  body: string;
}

/** Every `location … { … }` block, brace-counted rather than regex-matched. */
function locationBlocks(conf: string): LocationBlock[] {
  const blocks: LocationBlock[] = [];
  let open: { match: string; lines: string[] } | null = null;
  let depth = 0;

  for (const line of stripComments(conf).split('\n')) {
    if (open === null) {
      const start = /^\s*location\s+(.+?)\s*\{\s*$/.exec(line);
      if (start) {
        open = { match: start[1]!, lines: [] };
        depth = 1;
      }
      continue;
    }
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    if (depth === 0) {
      blocks.push({ match: open.match, body: open.lines.join('\n') });
      open = null;
      continue;
    }
    open.lines.push(line);
  }

  expect(open, 'unbalanced braces in a location block').toBeNull();
  return blocks;
}

/** The `default` value of a `map … $name { default "…"; }` declaration. */
function mapDefault(conf: string, variable: string): string {
  const declaration = new RegExp(
    `map\\s+\\$[a-z_]+\\s+\\$${variable}\\s*\\{[^}]*?default\\s+"([^"]*)"`,
  ).exec(stripComments(conf));
  expect(declaration, `no map for $${variable}`).not.toBeNull();
  return declaration![1]!;
}

/** `script-src`, `img-src`, … out of a policy string. */
function directive(policy: string, name: string): string {
  const found = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  expect(found, `no ${name} in: ${policy}`).toBeDefined();
  return found!;
}

const CONF = read('nginx.conf');
const DOCKERFILE = read('Dockerfile');
const HEADERS = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
] as const;

describe('admin nginx security profile', () => {
  const blocks = locationBlocks(CONF);
  const served = blocks.filter((block) => !/proxy_pass/.test(block.body));

  it('serves something, and knows which blocks those are', () => {
    // Guards the parser itself: a regex that matched nothing would make every per-location
    // assertion below pass vacuously.
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(served.length).toBeGreaterThanOrEqual(3);
  });

  it.each(HEADERS)('sets %s in every location that serves a file', (header) => {
    for (const block of served) {
      expect(block.body, `location ${block.match}`).toMatch(
        new RegExp(`^\\s*add_header\\s+${header}\\s`, 'm'),
      );
    }
  });

  it('marks every security header `always`, so an error response carries it too', () => {
    for (const block of served) {
      for (const header of HEADERS) {
        const line = new RegExp(`^\\s*add_header\\s+${header}\\s+.*\\salways;`, 'm');
        expect(block.body, `${header} in location ${block.match}`).toMatch(line);
      }
    }
  });

  it('emits HSTS only when something in front says the request arrived over HTTPS', () => {
    expect(stripComments(CONF)).toMatch(/map\s+\$http_x_forwarded_proto\s+\$siyahtus_hsts/);
    expect(mapDefault(CONF, 'siyahtus_hsts')).toBe('');

    const overHttps = /https\s+"([^"]*)"/.exec(stripComments(CONF))![1]!;
    expect(overHttps).toMatch(/max-age=\d+/);
    // `preload` is a one-way door for whoever owns the domain, not an image default.
    expect(overHttps).not.toContain('preload');
  });

  it('names no variable the Dockerfile does not give a default', () => {
    // Every `${VAR}` is rendered by the stock nginx entrypoint's envsubst pass, which only
    // replaces variables that are actually set; one without a default survives into the served
    // config as the literal `${VAR}`.
    const tokens = [...stripComments(CONF).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]!);
    expect(new Set(tokens)).toEqual(new Set(['PLATFORM_UPSTREAM']));

    const instructions = stripComments(DOCKERFILE);
    for (const token of new Set(tokens)) {
      expect(instructions, `${token} has no ENV default`).toMatch(
        new RegExp(`(^|\\s)${token}=`, 'm'),
      );
    }
  });

  it('is rendered from a template, or none of the above reaches nginx', () => {
    expect(stripComments(DOCKERFILE)).toMatch(/COPY\s+\S+nginx\.conf\s+\/etc\/nginx\/templates\//);
  });

  it('proxies /platform/ to the platform API and keeps the policy off that response', () => {
    // The API sets its own headers through helmet. A second `Content-Security-Policy` on one
    // response is intersected with the first, not substituted for it.
    const proxied = blocks.filter((block) => /proxy_pass/.test(block.body));
    expect(proxied.map((block) => block.match)).toEqual(['/platform/']);
    expect(proxied[0]!.body).toMatch(/proxy_pass\s+\$platform_upstream;/);
    expect(proxied[0]!.body).toMatch(/set\s+\$platform_upstream\s+\$\{PLATFORM_UPSTREAM\};/);
    expect(proxied[0]!.body).not.toMatch(/add_header/);
    // The operator's address is what the allow-list and the sign-in bucket judge.
    expect(proxied[0]!.body).toMatch(
      /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/,
    );
  });

  it('opens no WebSocket and names no /api/ upstream — the platform surface has neither', () => {
    const conf = stripComments(CONF);
    expect(conf).not.toMatch(/Upgrade/i);
    expect(conf).not.toMatch(/location\s+\/api\//);
    expect(conf).not.toMatch(/RTM_UPSTREAM|API_UPSTREAM/);
  });
});

describe('the admin policy', () => {
  const policy = mapDefault(CONF, 'siyahtus_csp');

  it('writes a policy with no escape hatch in it', () => {
    expect(policy).not.toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
  });

  it('never lets the back office be embedded', () => {
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(stripComments(CONF)).toMatch(/add_header\s+X-Frame-Options\s+"DENY"/);
  });

  it('talks to its own origin and nothing else', () => {
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(policy, 'img-src')).toBe("img-src 'self' data:");
    // No wildcard and no scheme-only source anywhere in the policy.
    expect(policy).not.toMatch(/(^|\s)(\*|https?:|wss?:)(\s|;|$)/);
  });
});

describe("the admin's inline theme boot is pinned by hash, not waved through", () => {
  const html = read('index.html');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];

  /**
   * The digest a browser will compute, which is not the digest of the bytes on the wire: the
   * HTML parser normalises CRLF (and a lone CR) to LF while tokenising, so the script text CSP
   * hashes has LF newlines whichever way the file was checked out.
   */
  const cspDigest = (script: string): string =>
    createHash('sha256').update(script.replace(/\r\n?/g, '\n'), 'utf8').digest('base64');

  it('has exactly one inline script to account for', () => {
    // If a second one appears, its hash has to be added to the policy — and the count is the
    // only thing that will say so.
    expect(inline).toHaveLength(1);
  });

  it('is the hash the policy carries', () => {
    expect(directive(mapDefault(CONF, 'siyahtus_csp'), 'script-src')).toContain(
      `'sha256-${cspDigest(inline[0]![1]!)}'`,
    );
  });

  it('would not match a script that changed', () => {
    expect(mapDefault(CONF, 'siyahtus_csp')).not.toContain(cspDigest(`${inline[0]![1]!} `));
  });
});
