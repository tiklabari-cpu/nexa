/**
 * §F.1/7, second half — contract operations with no UI. Every operation is
 * looked for in the three clients (web, widget, mobile); one nobody calls is
 * either headless by design, reached through a URL the client assembles, or a
 * gap. The difference is settled here, in writing, instead of being re-argued
 * from scratch every time the script runs.
 *
 * ## Why this counts (path, method) and not path (tm 215)
 *
 * Until this round it counted paths. A path was "covered" the moment any client
 * mentioned it, so `/chats/{chatId}/supervise` never appeared in the report:
 * `POST` was called from the Traffic board and that was enough — the `DELETE`
 * that ends supervision had no caller in any client and this audit called the
 * surface complete. tm 213 found that by reading, not by measuring, which is
 * the failure mode of a scanner answering a coarser question than the one being
 * asked. An HTTP surface is (path, method); a report that collapses the pair
 * reports on something that is not the surface.
 *
 * Two other blind spots went with it. Test files were part of the corpus, so a
 * `fetch` mock in `DeveloperPortal.test.tsx` was enough to call
 * `GET /partner/apps/{clientId}` covered — a path the product itself never
 * requests. And the path matcher required only that each static run appear
 * *somewhere*, so `/kb-categories/` and `/events` matching in unrelated files
 * answered for a path built from both.
 *
 * The number therefore GREW: 205 paths → 287 operations, and 14 uncalled paths
 * → 50 uncalled operations. That is the measurement getting better, not the
 * product getting worse. The same three clients, the same commit.
 *
 * ## How a call is recognised
 *
 * Two steps, both textual — there is no type information here and none is
 * wanted; the point is to see what a reader would see.
 *
 *   1. **Mention.** The path template becomes a regex: static segments match
 *      literally, `{param}` matches exactly one non-empty segment, which covers
 *      both idioms in this repo — the web/widget template literal
 *      (`` `/chats/${chatId}/events` ``) and the mobile typed client's literal
 *      placeholder (`'/chats/{chatId}/events'`). Nothing path-like may follow,
 *      so `/kb-categories` does not answer for `/kb-categories/{categoryId}`,
 *      while `/chats?view=…` still answers for `/chats`.
 *
 *   2. **Method.** Around each mention the NEAREST marker within `WINDOW` lines
 *      decides the verb. Markers are the shapes this repo's clients use:
 *      `api.post(` / `api.delete<` and a chained `.post(` under its receiver
 *      (web), `client.request('delete', …)` / `#request('POST', …)` (mobile,
 *      widget), and `method: 'PUT'` (raw `fetch`). A mention with no marker
 *      near it is a GET: the URL builders that sit apart from their call site
 *      (`chatListUrl`, `transcriptUrl`, every `usePagedQuery` `buildUrl`) are
 *      read requests by construction, and treating them so is what keeps this
 *      from reporting half the console as dead.
 *
 * Nearest-marker-wins matters. Taking every marker in the window would credit
 * a `DELETE` six lines away to whichever path is mentioned in between — the
 * same blindness this round removed, one scope smaller.
 *
 * ## The three lists
 *
 * An operation no client calls is in exactly one of them, and each entry
 * carries the reason. A bare exclusion list is where debt goes to hide, so the
 * three are shaped to make hiding awkward:
 *
 *   - `HEADLESS` — there is no client and there should not be one: an infra
 *     probe, an identity provider's callback, a provider webhook, a SIEM pull,
 *     an API-consumer read. `reason` required.
 *   - `INDIRECT` — a client DOES call it, through a URL assembled at runtime
 *     (`` `/reports/${kind}` ``) that no textual scanner can resolve. `site`
 *     names the file and a snippet, and the script checks that the snippet is
 *     still there and that the verb next to it is this operation's verb. Delete
 *     the call and the entry goes red.
 *   - `TRACKED` — a real gap in the console's surface, with the Task Master id
 *     that owns it. `owner` required. This is the §D145 discipline: a debt with
 *     a name and an owner is recorded, not waived.
 *
 * Anything uncalled and unlisted is a dead end and sets the exit code, as does
 * a stale entry (an operation the contract dropped, or one that has since
 * acquired a caller). An audit that always exits 0 stops nothing — the
 * `unpaged-lists.cjs` argument, same conclusion.
 *
 * Read-only, like its siblings. `pnpm contract:generate` must have run first.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const SPEC = 'packages/contract/dist/openapi.json';
const CLIENT_ROOTS = ['apps/web/src', 'apps/widget/src', 'apps/mobile/src'];

/** The verbs an OpenAPI path item may carry; anything else there is metadata. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** How far from a mention a method marker may sit and still describe it. */
const WINDOW = 6;

/** Shared reasons, so a family of operations answers with one sentence. */
const SCIM =
  "SCIM 2.0 provisioning (RFC 7644). The caller is the customer's identity provider — Okta, " +
  'Entra — reconciling its directory against ours. The console manages people through ' +
  '`/agents`; a second write path from the same UI is how two sources of truth start.';
const PUBLIC_KB =
  "the public knowledge base's own read surface (PRD v2 — the SEO-indexed self-service KB, " +
  'not a marketing site). It is served to visitors and crawlers by the public renderer; the ' +
  'agent console reads the authoring endpoints (`/kb-articles`) instead.';
const BY_ID_READ =
  'the collection the console reads already carries the whole row, so no screen fetches this ' +
  'one by id. The read exists for the API consumers this product sells to — PATs, partner ' +
  'apps, MCP (FR-MOD-09.4) — which are a first-class client without a screen.';

/** Operations with no client, and why that is the design rather than a gap. */
const HEADLESS = [
  {
    op: 'GET /health/live',
    reason:
      "the liveness probe. Its caller is the orchestrator (`infra/helm/nexa`'s deployments); " +
      'a browser asking whether the process is alive has already had its answer.',
  },
  { op: 'GET /health/ready', reason: 'the readiness probe — same caller as `GET /health/live`.' },
  {
    op: 'POST /auth/saml/{connectionId}/acs',
    reason:
      "the SAML assertion consumer service. The caller is the customer's identity provider, " +
      'which POSTs the browser here once it has authenticated the person; one of our own ' +
      'clients calling it is the thing the endpoint must refuse.',
  },
  { op: 'GET /scim/v2/Users', reason: SCIM },
  { op: 'POST /scim/v2/Users', reason: SCIM },
  { op: 'GET /scim/v2/Users/{userId}', reason: SCIM },
  { op: 'PATCH /scim/v2/Users/{userId}', reason: SCIM },
  { op: 'DELETE /scim/v2/Users/{userId}', reason: SCIM },
  { op: 'GET /scim/v2/Groups', reason: SCIM },
  { op: 'POST /scim/v2/Groups', reason: SCIM },
  { op: 'GET /scim/v2/Groups/{groupId}', reason: SCIM },
  { op: 'PATCH /scim/v2/Groups/{groupId}', reason: SCIM },
  { op: 'PUT /scim/v2/Groups/{groupId}', reason: SCIM },
  { op: 'DELETE /scim/v2/Groups/{groupId}', reason: SCIM },
  {
    op: 'POST /mcp/tools/{tool}',
    reason:
      'the Model Context Protocol tool surface. Its client is another agent runtime holding a ' +
      'PAT, which is the entire product of the endpoint; there is no screen to build.',
  },
  {
    op: 'POST /channels/email/inbound',
    reason:
      'the inbound mail webhook. The caller is the mail provider, authenticated by ' +
      '`INBOUND_EMAIL_SECRET`, not a browser.',
  },
  {
    op: 'POST /channels/{type}/webhook',
    reason:
      "the channel provider's delivery callback (`config: { public: true }` — no session " +
      'exists when it arrives). Same shape as the mail webhook above.',
  },
  {
    op: 'GET /channels/{type}/messages',
    reason:
      'the wire-level message log (M-CHOBS-a). Its own handler says what it is for: the table ' +
      'had a writer and no reader, so "did that reply really go out" was a question only a ' +
      'psql prompt could answer. The console shows the conversation; this shows what crossed ' +
      'the channel, and is read by e2e and by channel-administration integrations.',
  },
  {
    op: 'POST /channels/{type}/messages',
    reason:
      'the direct outbound path. An agent replies through the inbox composer ' +
      '(`POST /chats/{chatId}/events`); this one also accepts an `external_id` with no chat at ' +
      "all — addressing a channel identity directly, which is an integration's shape, not a " +
      "screen's.",
  },
  {
    op: 'GET /audit-log/export',
    reason:
      'the SIEM pull: NDJSON, resumable cursor, gated on `audit_log--export:ro` AND the ' +
      'Enterprise `siem_export` entitlement. `AuditLogPage.tsx` records the decision not to ' +
      'put a button on it — "a one-click copy of the whole record on the ungated viewer would ' +
      'be a second export path with no gate of its own. Reading is not exporting."',
  },
  {
    op: 'GET /notifications/devices',
    reason:
      'the registered push devices. A phone registers its own token and holds it; nothing in ' +
      'either client lists the others, and the roster is read by support and by the API.',
  },
  { op: 'GET /brands/{brandId}', reason: BY_ID_READ },
  { op: 'GET /websites/{websiteId}', reason: BY_ID_READ },
  { op: 'GET /partner/apps/{clientId}', reason: BY_ID_READ },
  { op: 'GET /kb-articles/{articleId}', reason: BY_ID_READ },
  { op: 'GET /public/kb/{workspaceSlug}/articles', reason: PUBLIC_KB },
  { op: 'GET /public/kb/{workspaceSlug}/articles/{articleSlug}', reason: PUBLIC_KB },
  { op: 'GET /public/kb/{workspaceSlug}/categories', reason: PUBLIC_KB },
  {
    op: 'GET /public/kb/{workspaceSlug}/sitemap.xml',
    reason:
      'a sitemap is read by crawlers. A client fetching it would be fetching a list of the ' +
      'pages it already has.',
  },
  {
    op: 'GET /public/kb/{workspaceSlug}/robots.txt',
    reason: 'same as the sitemap — written for crawlers, at the address they look at.',
  },
];

/**
 * Operations a client DOES call through a URL it assembles at runtime.
 *
 * `site.contains` is checked against the file, and the verb beside it against
 * this operation's verb, so the entry cannot outlive the call it points at.
 */
const INDIRECT = [
  {
    op: 'POST /settings/sso/{connectionId}/domains/{domain}/challenge',
    reason:
      'the last segment is the action, chosen by the caller — `SsoConnection.tsx` builds ' +
      '`` `…/domains/${domain}/${action}` `` once and both mutations go through it.',
    site: {
      file: 'apps/web/src/features/settings/SsoConnection.tsx',
      contains: "api.post<SsoDomainRecord>(path(domain, 'challenge')",
    },
  },
  {
    op: 'POST /settings/sso/{connectionId}/domains/{domain}/verify',
    reason: 'the other half of the same builder — see the `challenge` entry.',
    site: {
      file: 'apps/web/src/features/settings/SsoConnection.tsx',
      contains: "api.post<SsoDomainRecord>(path(input.domain, 'verify')",
    },
  },
  {
    op: 'GET /reports/breakdown',
    reason:
      '`useReport(kind)` requests `` `/reports/${kind}?…` `` — one call site for every report ' +
      'tab, with the tab id as the segment.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /reports/reviews',
    reason: 'same `useReport(kind)` call site as `GET /reports/breakdown`.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /reports/topics',
    reason: 'same `useReport(kind)` call site as `GET /reports/breakdown`.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /reports/cases',
    reason: 'same `useReport(kind)` call site as `GET /reports/breakdown`.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /reports/leads',
    reason: 'same `useReport(kind)` call site as `GET /reports/breakdown`.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /reports/sales',
    reason: 'same `useReport(kind)` call site as `GET /reports/breakdown`.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /reports/staffing-forecast',
    reason: 'same `useReport(kind)` call site as `GET /reports/breakdown`.',
    site: {
      file: 'apps/web/src/features/reports/ReportsPage.tsx',
      contains: '`/reports/${kind}?${reportQuery(',
    },
  },
  {
    op: 'GET /uploads/{key}',
    reason:
      "an attachment's bytes are fetched from the `attachment_url` the event carries, with the " +
      '`/api/v1` prefix stripped — the key never appears as a literal in the client.',
    site: {
      file: 'apps/web/src/features/inbox/Attachment.tsx',
      contains: '.getBlob(path)',
    },
  },
  {
    op: 'PUT /uploads/{key}',
    reason:
      'the second half of the grant-then-upload pair: `POST /uploads` returns a signed ' +
      '`upload_url` and the bytes are PUT to exactly that, so the client never spells the path.',
    site: {
      file: 'apps/web/src/features/inbox/uploadAttachment.ts',
      contains: 'await fetch(grant.upload_url, {',
    },
  },
];

/**
 * Real gaps in the console's surface, each with the task that owns it.
 *
 * Every one of these is the same shape as the finding that opened tm 215: the
 * collection endpoint has a screen and one verb on the item does not, so a
 * thing can be made but not changed, or made but not removed.
 */
const TRACKED = [
  {
    op: 'DELETE /skills/{skillId}',
    owner: 'tm 246',
    reason:
      'a playbook skill can be created and edited and deactivated, never deleted; the console ' +
      'accumulates them.',
  },
  {
    op: 'DELETE /kb-articles/{articleId}',
    owner: 'tm 246',
    reason:
      'a KB article can be unpublished but not removed. Unpublishing hides it; a wrong article ' +
      'still cannot be taken off the workspace.',
  },
  {
    op: 'PUT /kb-settings',
    owner: 'tm 246',
    reason:
      'the public knowledge base cannot be switched on from the console at all. ' +
      '`KbArticleEditor` READS `/kb-settings` and disables authoring when it is off, so the ' +
      'one screen that knows about the setting is the one blocked by it.',
  },
];

/** `/chats/{chatId}/events` -> a regex matching how the clients write it. */
function pathMatcher(path) {
  // One path segment: no quote, whitespace or slash. Matches `${chatId}` in a
  // template literal and `{chatId}` in the mobile client's typed literal alike.
  const PARAM = '[^\'"`\\s/]+';
  const literal = path
    .split(/\{[^}]+\}/)
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(PARAM);
  return new RegExp(literal + '(?![A-Za-z0-9_-])');
}

/**
 * The method markers, most specific first. `get[A-Za-z]*` covers the web
 * client's `getBlob`/`getFile`, which are GETs that hand back a download.
 */
const MARKERS = [
  // `api.post(`, `api.delete<`, `client.get<`, `anonymous.post(` — the HTTP
  // receivers this repo has. Narrow on purpose: a bare `.delete(` would match
  // `map.delete(` and credit a verb nobody sent.
  /\b(?:api|client|anonymous|apiClient)\.(get[A-Za-z]*|post|put|patch|delete)\s*[<(]/g,
  // The same call with its receiver on the line above — `apiRef.current` then a
  // chained `.post(…)`. Anchored at the start of the line, which is what keeps
  // it from re-admitting `map.delete(`.
  /^\s*\.(get[A-Za-z]*|post|put|patch|delete)\s*[<(]/gm,
  // `client.request('delete', …)` (mobile), `this.#request('POST', …)` (widget)
  // and `api.request<undefined>('DELETE', …)` (web, for the verbs with no
  // shorthand). The generic argument is optional and has to be skipped.
  /\brequest\s*(?:<[^>]*>)?\s*\(\s*['"](get|post|put|patch|delete)['"]/gi,
  // A raw `fetch` with an explicit method.
  /\bmethod\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/gi,
];

/** Every method marker on one line, normalised to a lowercase verb. */
function markersOn(line) {
  const found = [];
  for (const pattern of MARKERS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const verb = match[1].toLowerCase();
      found.push(verb.startsWith('get') ? 'get' : verb);
    }
  }
  return found;
}

/** The nearest markers to `index`, or `['get']` if there are none in range. */
function verbsNear(lines, index) {
  for (let distance = 0; distance <= WINDOW; distance += 1) {
    const above = index - distance >= 0 ? markersOn(lines[index - distance]) : [];
    const below =
      distance === 0 || index + distance >= lines.length ? [] : markersOn(lines[index + distance]);
    const found = [...above, ...below];
    if (found.length > 0) return found;
  }
  return ['get'];
}

/**
 * Blank out comments, keeping line numbers.
 *
 * A path named in a docblock is documentation, not a call — counting it is how
 * a scanner reports the paragraph explaining a decision as the decision. `//`
 * is only stripped where it is not preceded by `:`, so a `http://` inside a
 * string survives (the `unpaged-lists.cjs` treatment, same reasoning).
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Which verbs the clients send to this path, and the first place each showed.
 */
function verbsForPath(path, sources) {
  const matcher = pathMatcher(path);
  const seen = new Map();

  for (const { file, lines } of sources) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!matcher.test(lines[index])) continue;
      for (const verb of verbsNear(lines, index)) {
        if (!seen.has(verb)) seen.set(verb, `${file}:${index + 1}`);
      }
    }
  }
  return seen;
}

/**
 * The three clients' shipped source. Tests are excluded: a path named in a
 * fixture or a `fetch` mock is one the product's tests know about, not a
 * surface the product uses — counting them let `GET /partner/apps/{clientId}`
 * read as covered on the strength of `DeveloperPortal.test.tsx` alone. Same
 * exclusion, same reason, as `unpaged-lists.cjs`.
 */
function readSources() {
  return execSync(`git ls-files ${CLIENT_ROOTS.join(' ')}`, { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file))
    .map((file) => ({ file, lines: fs.readFileSync(file, 'utf8').split(/\r?\n/) }));
}

/** Does `site` still point at a call, with this operation's verb beside it? */
function checkSite(entry, method, sources) {
  const source = sources.find((candidate) => candidate.file === entry.site.file);
  if (!source) return `indirect: ${entry.op} names ${entry.site.file}, which is not client source`;

  const index = source.lines.findIndex((line) => line.includes(entry.site.contains));
  if (index === -1) {
    return `indirect: ${entry.op} — \`${entry.site.contains}\` is no longer in ${entry.site.file}`;
  }

  const verbs = verbsNear(source.lines, index);
  if (!verbs.includes(method)) {
    return (
      `indirect: ${entry.op} — the call at ${entry.site.file}:${index + 1} sends ` +
      `${verbs.join('/')}, not ${method}`
    );
  }
  return null;
}

/**
 * @param {{spec?: object, sources?: {file: string, lines: string[]}[],
 *          headless?: typeof HEADLESS, indirect?: typeof INDIRECT,
 *          tracked?: typeof TRACKED}} input
 */
function analyse(input = {}) {
  const spec = input.spec ?? JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  // Comments are blanked here rather than at read time, so that a caller
  // passing its own corpus (the unit test) exercises the same rule the repo
  // scan does instead of a helper the script no longer uses on its own input.
  const sources = (input.sources ?? readSources()).map((source) => ({
    file: source.file,
    lines: stripComments(source.lines.join('\n')).split('\n'),
  }));
  const headless = input.headless ?? HEADLESS;
  const indirect = input.indirect ?? INDIRECT;
  const tracked = input.tracked ?? TRACKED;

  const paths = Object.keys(spec.paths || {});
  const operations = [];
  for (const path of paths) {
    for (const method of Object.keys(spec.paths[path] || {})) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      operations.push({
        op: `${method.toUpperCase()} ${path}`,
        path,
        method: method.toLowerCase(),
      });
    }
  }

  const verbsByPath = new Map(paths.map((path) => [path, verbsForPath(path, sources)]));

  const called = [];
  const uncalled = [];
  for (const operation of operations) {
    const at = verbsByPath.get(operation.path).get(operation.method);
    if (at) called.push({ ...operation, at });
    else uncalled.push(operation);
  }

  // The old, path-level answer, kept so the two measurements can be compared.
  const uncalledPaths = paths.filter((path) => verbsByPath.get(path).size === 0);

  const listed = new Map();
  const errors = [];
  const groups = [
    { kind: 'headless', entries: headless },
    { kind: 'indirect', entries: indirect },
    { kind: 'tracked', entries: tracked },
  ];

  for (const { kind, entries } of groups) {
    for (const entry of entries) {
      if (listed.has(entry.op)) {
        errors.push(`${kind}: ${entry.op} is listed twice`);
        continue;
      }
      listed.set(entry.op, { ...entry, kind });

      if (!entry.reason || !entry.reason.trim()) {
        errors.push(`${kind}: ${entry.op} has no reason`);
      }
      if (kind === 'tracked' && !/^tm \d+/.test(entry.owner || '')) {
        errors.push(`tracked: ${entry.op} names no owning task`);
      }
      const operation = operations.find((candidate) => candidate.op === entry.op);
      if (!operation) {
        errors.push(`${kind}: ${entry.op} is not an operation in the contract`);
        continue;
      }
      if (called.some((candidate) => candidate.op === entry.op)) {
        errors.push(`${kind}: ${entry.op} IS called now — the surface arrived, drop the entry`);
        continue;
      }
      if (kind === 'indirect') {
        const failure = checkSite(entry, operation.method, sources);
        if (failure) errors.push(failure);
      }
    }
  }

  const explained = { headless: [], indirect: [], tracked: [] };
  const dead = [];
  for (const operation of uncalled) {
    const entry = listed.get(operation.op);
    if (entry) explained[entry.kind].push({ ...operation, ...entry });
    else dead.push(operation);
  }
  for (const operation of dead) {
    errors.push(`dead end: ${operation.op} — no client calls it, and no list says why`);
  }

  return { paths, operations, called, uncalled, uncalledPaths, explained, dead, errors };
}

function main(argv) {
  const result = analyse();

  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          paths: result.paths.length,
          operations: result.operations.length,
          called: result.called.length,
          headless: result.explained.headless.map((entry) => entry.op),
          indirect: result.explained.indirect.map((entry) => entry.op),
          tracked: result.explained.tracked.map((entry) => `${entry.op}  (${entry.owner})`),
          dead: result.dead.map((entry) => entry.op),
          errors: result.errors,
        },
        null,
        2,
      ),
    );
    return result.errors.length > 0 ? 1 : 0;
  }

  console.log(`contract paths: ${result.paths.length}`);
  console.log(`contract operations (path + method): ${result.operations.length}`);
  console.log(`called by web/widget/mobile: ${result.called.length}`);
  console.log(`   headless by design: ${result.explained.headless.length}`);
  console.log(`   called through an assembled URL: ${result.explained.indirect.length}`);
  console.log(`   TRACKED surface debt: ${result.explained.tracked.length}`);
  console.log(`   UNEXPLAINED: ${result.dead.length}`);
  console.log(
    `   (path-level, the pre-tm-215 measure: ${result.uncalledPaths.length} of ${result.paths.length} paths)\n`,
  );

  for (const kind of ['headless', 'indirect', 'tracked']) {
    console.log(`### ${kind} = ${result.explained[kind].length}`);
    for (const entry of result.explained[kind]) {
      const owner = entry.owner ? ` [${entry.owner}]` : '';
      console.log(`   ${entry.op}${owner}\n      ${entry.reason}`);
    }
    console.log('');
  }

  console.log(`### UNEXPLAINED = ${result.dead.length}`);
  for (const operation of result.dead) console.log('   ' + operation.op);

  if (result.errors.length > 0) {
    console.log(`\n### errors = ${result.errors.length}`);
    for (const error of result.errors) console.log('   ' + error);
    console.log(
      '\nGive the operation a client, or put it in HEADLESS / INDIRECT / TRACKED with the ' +
        'reason it has none.',
    );
    return 1;
  }
  return 0;
}

module.exports = {
  analyse,
  pathMatcher,
  markersOn,
  verbsNear,
  stripComments,
  verbsForPath,
  HEADLESS,
  INDIRECT,
  TRACKED,
  WINDOW,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
