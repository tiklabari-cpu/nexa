/**
 * Dependency advisories on the server paths (tm 456 · F38).
 *
 * CI had no vulnerability scan: when a new high advisory landed on a package in
 * the api, the build stayed green. This runs `pnpm audit --prod --json` and keeps
 * only what matters for a deployment: a high/critical advisory that is reachable
 * from `apps/api`, `apps/rtm`, `apps/web`, `apps/widget` or `apps/admin`. The
 * mobile tree (`apps/mobile`, an Expo app) and dev-only chains are out of scope.
 *
 * Allowlist: `scripts/audit-allowlist.json` — `{ entries: [{ ghsa, reason, expires }] }`.
 * An entry silences one GHSA id until `expires` (YYYY-MM-DD). An expired entry no
 * longer silences anything and is reported; an entry that matches nothing is
 * reported as stale (the advisory was fixed — delete the entry).
 *
 *   node scripts/audit/dependency-audit.mjs            warn mode: prints a summary, exit 0
 *   node scripts/audit/dependency-audit.mjs --strict   exit 1 on any non-allowlisted finding
 *                                                      (or if the audit could not run)
 *   --input <file>       read `pnpm audit --json` output from a file (no network)
 *   --allowlist <file>   another allowlist file
 *   --json               print the result as JSON
 *
 * Pinned by `scripts/audit/dependency-audit.test.mjs` (fixture JSON, no network).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SERVER_ROOTS = ['api', 'rtm', 'web', 'widget', 'admin'];
export const GATED_SEVERITIES = ['high', 'critical'];

/** `apps__api>fastify>fast-uri` → `api`; a path outside `apps__*` → its first segment. */
export function rootOf(path) {
  const first = String(path).split('>')[0];
  return first.startsWith('apps__') ? first.slice('apps__'.length) : first;
}

function today(now) {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

/**
 * @param audit      parsed `pnpm audit --json` output (`{ advisories }`)
 * @param allowlist  `{ entries: [{ ghsa, reason, expires }] }`
 * @returns {{ findings, allowed, expired, stale, problems }}
 *   findings — gated advisories on a server root, not allowlisted (these fail --strict)
 *   allowed  — gated advisories silenced by a live allowlist entry
 *   expired  — allowlist entries past `expires` that still matched an advisory
 *   stale    — allowlist entries that matched no advisory on a server root
 *   problems — malformed allowlist entries (no ghsa / reason / valid date)
 */
export function analyze(audit, allowlist, { now, roots = SERVER_ROOTS } = {}) {
  const day = today(now);
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : [];
  const problems = [];
  const byGhsa = new Map();
  for (const entry of entries) {
    const ok =
      typeof entry?.ghsa === 'string' &&
      /^GHSA(-[a-z0-9]{4}){3}$/.test(entry.ghsa) &&
      typeof entry.reason === 'string' &&
      entry.reason.trim() !== '' &&
      typeof entry.expires === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.expires);
    if (!ok) {
      problems.push(
        `allowlist entry needs ghsa, reason and expires (YYYY-MM-DD): ${JSON.stringify(entry)}`,
      );
      continue;
    }
    byGhsa.set(entry.ghsa, entry);
  }

  const findings = [];
  const allowed = [];
  const expired = new Map();
  const matched = new Set();
  for (const advisory of Object.values(audit?.advisories ?? {})) {
    if (!GATED_SEVERITIES.includes(advisory.severity)) continue;
    const reached = new Set();
    for (const finding of advisory.findings ?? []) {
      for (const path of finding.paths ?? []) {
        const root = rootOf(path);
        if (roots.includes(root)) reached.add(root);
      }
    }
    if (reached.size === 0) continue;
    const row = {
      ghsa: advisory.github_advisory_id,
      module: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
      vulnerable: advisory.vulnerable_versions,
      patched: advisory.patched_versions,
      roots: [...reached].sort(),
    };
    const entry = byGhsa.get(row.ghsa);
    if (entry) matched.add(row.ghsa);
    if (entry && entry.expires >= day) {
      allowed.push({ ...row, reason: entry.reason, expires: entry.expires });
    } else {
      if (entry) expired.set(row.ghsa, entry);
      findings.push(row);
    }
  }
  // One GHSA can span several advisory ids (one per affected range); report each once.
  const dedupe = (rows) => [...new Map(rows.map((r) => [`${r.ghsa}|${r.module}`, r])).values()];
  const stale = [...byGhsa.values()].filter((e) => !matched.has(e.ghsa));
  return {
    findings: dedupe(findings),
    allowed: dedupe(allowed),
    expired: [...expired.values()],
    stale,
    problems,
  };
}

export function formatSummary(result, { strict }) {
  const lines = [];
  const { findings, allowed, expired, stale, problems } = result;
  lines.push(
    `dependency audit (${SERVER_ROOTS.join(', ')}; ${GATED_SEVERITIES.join('/')}): ` +
      `${findings.length} not allowlisted, ${allowed.length} allowlisted`,
  );
  for (const f of findings) {
    lines.push(
      `  x ${f.ghsa} ${f.severity} ${f.module} ${f.vulnerable} (patched ${f.patched}) - ${f.roots.join(', ')}`,
    );
  }
  for (const a of allowed) {
    lines.push(`  ~ ${a.ghsa} ${a.module} allowed until ${a.expires}: ${a.reason}`);
  }
  for (const e of expired)
    lines.push(`  ! allowlist entry ${e.ghsa} expired ${e.expires}: ${e.reason}`);
  for (const s of stale) lines.push(`  ? allowlist entry ${s.ghsa} matches nothing - delete it`);
  for (const p of problems) lines.push(`  ! ${p}`);
  if (!strict && (findings.length > 0 || problems.length > 0)) {
    lines.push('warn mode: exit 0 (add --strict to fail on the "x" lines)');
  }
  return lines.join('\n');
}

function parseAudit(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON in `pnpm audit` output');
  return JSON.parse(text.slice(start));
}

function runPnpmAudit() {
  // `pnpm audit` exits 1 when it finds anything, so the exit code is not an error signal;
  // JSON on stdout is.
  const r = spawnSync('pnpm audit --prod --json', {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  try {
    return parseAudit(r.stdout ?? '');
  } catch {
    throw new Error(
      `pnpm audit produced no JSON (exit ${r.status}): ${String(r.stderr).slice(0, 300)}`,
    );
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const strict = process.argv.includes('--strict');
  const json = process.argv.includes('--json');
  const allowlistPath = resolve(
    arg('--allowlist') ?? resolve(ROOT, 'scripts/audit-allowlist.json'),
  );
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  let audit;
  try {
    const input = arg('--input');
    audit = input ? parseAudit(readFileSync(resolve(input), 'utf8')) : runPnpmAudit();
  } catch (err) {
    // No network / registry down: say so loudly; only --strict turns it into a failure.
    console.error(`dependency audit could not run: ${err.message}`);
    process.exitCode = strict ? 1 : 0;
    return;
  }
  const result = analyze(audit, allowlist);
  console.log(json ? JSON.stringify(result, null, 2) : formatSummary(result, { strict }));
  if (strict && (result.findings.length > 0 || result.problems.length > 0)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
