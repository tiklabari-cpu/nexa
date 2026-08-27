/**
 * The production security profile the two static images serve (M-PROD-CFG-b).
 *
 * `apps/web/nginx.conf` and `apps/widget/nginx.conf` are the only place a
 * response header can be set for the panel and the widget — neither is a Node
 * process, so there is no helmet and no test that can send them a request
 * without a container. This file is the substitute: it reads both configs as
 * text and pins the three things that are easy to get wrong and impossible to
 * notice.
 *
 *   1. nginx's `add_header` inheritance. A block that declares one `add_header`
 *      silently discards *every* one it would otherwise inherit — so the two
 *      locations that set `Cache-Control` are exactly the two that would lose
 *      the security profile if it were declared once at server level. That is
 *      why it is repeated per location, and why a new location added without it
 *      has to fail here rather than in production.
 *   2. The panel's script hash. Its CSP pins `index.html`'s inline theme boot by
 *      hash instead of opening the policy with 'unsafe-inline'. Edit that
 *      script and the hash no longer matches; the browser then refuses to run
 *      it, the panel renders in the wrong theme before the bundle loads, and
 *      nothing in the build says so. The hash is recomputed here from the file.
 *   3. The framing asymmetry. The panel must never be embeddable and the widget
 *      must always be — it lives in a cross-origin iframe on customer sites by
 *      design (NFR-S6). Getting these backwards either kills every install or
 *      opens the console to clickjacking, and both configs look equally
 *      plausible while doing it.
 *
 * The widget's config lives in a sibling package and is read as text rather than
 * imported, the way `apps/api/src/config/env.parity.test.ts` reads the RTM
 * schema: the asymmetry in (3) is a single property of the pair, so testing the
 * two halves apart would not test it at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// apps/web/test → apps/web → apps → repo root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf8');

/** Whole-line `#` comments, dropped so prose about `add_header` never counts as one. */
const stripComments = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

interface LocationBlock {
  /** The match expression, e.g. `/assets/` or `= /index.html`. */
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

const WEB_CONF = read('apps/web/nginx.conf');
const WIDGET_CONF = read('apps/widget/nginx.conf');
const WEB_DOCKERFILE = read('apps/web/Dockerfile');
const WIDGET_DOCKERFILE = read('apps/widget/Dockerfile');

const IMAGES = [
  {
    name: 'web (agent panel)',
    conf: WEB_CONF,
    dockerfile: WEB_DOCKERFILE,
    /** The panel is a console: it must never be put in someone else's frame. */
    headers: [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
    ],
  },
  {
    name: 'widget (customer iframe)',
    conf: WIDGET_CONF,
    dockerfile: WIDGET_DOCKERFILE,
    /** No `X-Frame-Options`: the legacy header has no "anyone may embed" value. */
    headers: [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
    ],
  },
] as const;

describe.each(IMAGES)('$name nginx security profile', ({ conf, dockerfile, headers }) => {
  const blocks = locationBlocks(conf);
  const served = blocks.filter((block) => !/proxy_pass/.test(block.body));

  it('serves something, and knows which blocks those are', () => {
    // Guards the parser itself: a regex that matched nothing would make every
    // per-location assertion below pass vacuously.
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(served.length).toBeGreaterThanOrEqual(3);
  });

  it.each(headers)('sets %s in every location that serves a file', (header) => {
    // The inheritance rule, pinned. A location that declares `Cache-Control` and
    // nothing else would answer with no security headers at all.
    for (const block of served) {
      expect(block.body, `location ${block.match}`).toMatch(
        new RegExp(`^\\s*add_header\\s+${header}\\s`, 'm'),
      );
    }
  });

  it('marks every security header `always`, so an error response carries it too', () => {
    for (const block of served) {
      for (const header of headers) {
        const line = new RegExp(`^\\s*add_header\\s+${header}\\s+.*\\salways;`, 'm');
        expect(block.body, `${header} in location ${block.match}`).toMatch(line);
      }
    }
  });

  it('emits HSTS only when something in front says the request arrived over HTTPS', () => {
    // There is no TLS in this repository, and the header is meaningless over
    // plain http. nginx skips an `add_header` whose value is empty, so mapping
    // the default to "" is what keeps the local stack byte-identical.
    expect(stripComments(conf)).toMatch(/map\s+\$http_x_forwarded_proto\s+\$nexa_hsts/);
    expect(mapDefault(conf, 'nexa_hsts')).toBe('');
    expect(mapDefault(conf, 'nexa_hsts')).not.toContain('max-age');

    const overHttps = /https\s+"([^"]*)"/.exec(stripComments(conf))![1]!;
    expect(overHttps).toMatch(/max-age=\d+/);
    // `preload` is a one-way door for whoever owns the domain, not an image default.
    expect(overHttps).not.toContain('preload');
  });

  it('names no origin the image cannot substitute', () => {
    // Every `${VAR}` in the config is rendered by the stock nginx entrypoint's
    // envsubst pass, which only replaces variables that are actually set. One
    // without a Dockerfile default survives into the served policy as the
    // literal `${VAR}` — a token the browser ignores, silently dropping whatever
    // it was supposed to allow.
    const tokens = [...stripComments(conf).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]!);
    expect(new Set(tokens).size).toBeGreaterThan(0);

    const instructions = stripComments(dockerfile);
    for (const token of new Set(tokens)) {
      expect(instructions, `${token} has no ENV default`).toMatch(
        new RegExp(`(^|\\s)${token}=`, 'm'),
      );
    }
  });

  it('is rendered from a template, or none of the above reaches nginx', () => {
    expect(stripComments(dockerfile)).toMatch(/COPY\s+\S+nginx\.conf\s+\/etc\/nginx\/templates\//);
  });

  it('keeps the policy off responses it does not generate', () => {
    // The API sets its own headers through helmet. A second
    // `Content-Security-Policy` on one response is intersected with the first,
    // not substituted for it, so a proxied route would end up under both.
    for (const block of blocks.filter((b) => /proxy_pass/.test(b.body))) {
      expect(block.body, `location ${block.match}`).not.toMatch(/add_header/);
    }
  });

  it('writes a policy with no escape hatch in it', () => {
    const policy = mapDefault(conf, 'nexa_csp');

    expect(policy).not.toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    // Both apps talk to an API on another origin (the widget always, the panel
    // for RTM), so `connect-src` is the one list a deployment must be able to
    // set — and it is additive, never a replacement for same-origin.
    expect(directive(policy, 'connect-src')).toMatch(/^connect-src 'self' \$\{[A-Z0-9_]+\}$/);
  });
});

describe('the panel and the widget frame in opposite directions', () => {
  const panel = mapDefault(WEB_CONF, 'nexa_csp');
  const widget = mapDefault(WIDGET_CONF, 'nexa_csp');

  it('never lets the agent console be embedded', () => {
    // A console that can be framed is a console that can be clicked through by
    // whatever page framed it.
    expect(directive(panel, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(stripComments(WEB_CONF)).toMatch(/add_header\s+X-Frame-Options\s+"DENY"/);
  });

  it('always lets the widget be embedded', () => {
    // The widget exists to run inside a customer's page. Which customers may
    // embed it is per-workspace, lives in the database and is enforced where it
    // can be — the API checks the embedding origin against the organization's
    // trusted domains before it mints a customer token. A static list here would
    // break every install and protect nothing extra.
    expect(directive(widget, 'frame-ancestors')).toBe('frame-ancestors *');
    // And not through the legacy header either: it has no permissive value, so
    // any `X-Frame-Options` at all would override the CSP above in older
    // browsers and kill the embed.
    expect(stripComments(WIDGET_CONF)).not.toMatch(/X-Frame-Options/);
  });
});

describe("the panel's inline theme boot is pinned by hash, not waved through", () => {
  const html = read('apps/web/index.html');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];

  /**
   * The digest a browser will compute, which is not the digest of the bytes on
   * the wire.
   *
   * The HTML parser normalises CRLF (and a lone CR) to LF while tokenising, so
   * the script text CSP hashes has LF newlines whichever way the file was
   * checked out. Measured rather than reasoned about: the first version of this
   * policy carried the CRLF digest of a Windows working tree and Chromium
   * refused to run the script, naming the LF digest instead. `.gitattributes`
   * commits the file as LF, so the two agree in CI — but a working tree that
   * predates that setting still holds CRLF, which is exactly how the wrong hash
   * got written in the first place.
   */
  const cspDigest = (script: string): string =>
    createHash('sha256').update(script.replace(/\r\n?/g, '\n'), 'utf8').digest('base64');

  it('has exactly one inline script to account for', () => {
    // If a second one appears, its hash has to be added to the policy — and the
    // count is the only thing that will say so.
    expect(inline).toHaveLength(1);
  });

  it('is the hash the policy carries', () => {
    expect(directive(mapDefault(WEB_CONF, 'nexa_csp'), 'script-src')).toContain(
      `'sha256-${cspDigest(inline[0]![1]!)}'`,
    );
  });

  it('would not match a script that changed', () => {
    // Proves the assertion above is not vacuous: the hash is over the script's
    // exact text, so editing the theme boot without updating the policy stops
    // the browser from running it — which is the failure this test exists to
    // turn into a red suite instead of a dark panel for light-theme agents.
    expect(mapDefault(WEB_CONF, 'nexa_csp')).not.toContain(cspDigest(`${inline[0]![1]!} `));
  });

  it('is not the digest of the raw bytes, when those differ', () => {
    // The distinction this whole block turns on. On an LF checkout the two are
    // the same value and there is nothing to assert; on a CRLF one they differ,
    // and the policy must carry the normalised one.
    const raw = createHash('sha256').update(inline[0]![1]!, 'utf8').digest('base64');
    if (raw === cspDigest(inline[0]![1]!)) return;

    expect(mapDefault(WEB_CONF, 'nexa_csp')).not.toContain(raw);
  });
});
