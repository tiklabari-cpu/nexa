/**
 * Every provider call is counted against the daily AI caps (tm 257.20 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(3)).
 *
 * The caps hold only if nothing reaches a model or an embedding provider
 * except through `MeteredLlm` (tm 257.8) and `MeteredEmbeddings` (tm 257.20).
 * A direct `.complete(` or `.embed(` on a provider anywhere else — a new
 * feature, a quick fix, a script folded into the server — spends the
 * deployment's key with nobody counting, and nothing else would notice: the
 * call works, the tests pass, the bill arrives.
 *
 * So every such call in production code is listed here, by file and count,
 * with the reason it is allowed. A call added anywhere — a new file, or a
 * second call in a listed one — turns this red until someone has decided
 * whether it is counted. The reasons are checked where they can be: a file
 * that calls "the wrapper it holds" must hold one, and a file handed a bound
 * provider must only ever be handed `forTenant(...)`.
 *
 * A wrapper built without a budget counts nothing, so the second half checks
 * the other way round: every production place that builds a knowledge
 * service, a re-embedder or an embedding provider builds it metered.
 *
 * Out of the scan, on purpose: tests, and `scripts/` — the measurement tools
 * (`measure:knowledge-recall`, `measure:knowledge-retrieval`) embed a golden
 * set into a throwaway database that is dropped when they end; they are run
 * by an operator on purpose and are not part of any process that serves.
 *
 * Read as text, like `provider/embedding-seam-audit.test.ts`: a call is a fact
 * about a file, and this has to see a file that is new in the working tree.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Allowance {
  /** How many `.complete(` / `.embed(` calls the file makes. */
  calls: number;
  why: string;
  /** Text the file must contain for `why` to be true. */
  holds?: RegExp;
}

const ALLOWED: Readonly<Record<string, Allowance>> = {
  'services/ai/metered-llm.ts': {
    calls: 3,
    why: 'the LLM wrapper itself: the provider’s complete() (straight through on mock), and forTenant binding back to its own counted complete()',
  },
  'services/ai/metered-embeddings.ts': {
    calls: 4,
    why: 'the embedding wrapper itself: the provider’s embed() — straight through when nothing is counted, and counted for a workspace, a hold and the deployment',
  },
  'services/ai/knowledge-service.ts': {
    calls: 2,
    why: 'prepare() and embedQuery() call the MeteredEmbeddings it holds, with the caller’s payer',
    holds: /readonly #embeddings: MeteredEmbeddings;/,
  },
  'services/ai/skill-engine.ts': {
    calls: 1,
    why: 'calls the MeteredLlm it holds with the run’s workspace',
    holds: /readonly #llm: MeteredLlm;/,
  },
  'services/ai/copilot-summary.ts': {
    calls: 1,
    why: 'calls the provider it is handed — only ever MeteredLlm.forTenant(...) (checked below)',
  },
  'services/ai/copilot-enhance.ts': {
    calls: 1,
    why: 'calls the provider it is handed — only ever MeteredLlm.forTenant(...) (checked below)',
  },
  'routes/onboarding.ts': {
    calls: 1,
    why: 'onboarding.complete(): the setup checklist, not a model',
  },
};

/** Writers that take a bound provider, and must be handed nothing but `<metered>.forTenant(...)`. */
const BOUND_WRITERS = ['writeConversationSummary', 'writeEnhancedText'];

function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The text from `open` (an opening parenthesis) to its matching close, inclusive. */
function balanced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced parentheses from offset ${open}`);
}

/** The argument lists of every `name(` call in `source` (a declaration of `name` included). */
function callsOf(source: string, name: string): string[] {
  const pattern = new RegExp(`(?<![\\w.#])${name}\\(`, 'g');
  return [...source.matchAll(pattern)].map((match) =>
    balanced(source, match.index + match[0].length - 1),
  );
}

describe('every model and embedding call goes through the daily AI caps (tm 257.20)', () => {
  const files = productionSources(SRC).map((path) => ({
    path: relative(SRC, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }));
  const byPath = new Map(files.map((file) => [file.path, file.source]));

  it('reads a non-trivial source tree (guards a broken walk passing vacuously)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(byPath.has('services/ai/metered-embeddings.ts')).toBe(true);
    expect(byPath.has('services/ai/metered-llm.ts')).toBe(true);
  });

  it('finds .complete( and .embed( only where the list says, as often as it says', () => {
    const found = Object.fromEntries(
      files
        .map((file) => [file.path, (file.source.match(/\.(?:complete|embed)\(/g) ?? []).length])
        .filter(([, calls]) => (calls as number) > 0),
    );
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED).map(([path, allowance]) => [path, allowance.calls]),
    );
    expect(found).toEqual(allowed);
  });

  it('finds the wrapper each “calls the wrapper it holds” file says it holds', () => {
    for (const [path, allowance] of Object.entries(ALLOWED)) {
      if (!allowance.holds) continue;
      expect(byPath.get(path), path).toMatch(allowance.holds);
    }
  });

  it('hands the Copilot writers nothing but a metered provider bound to a workspace', () => {
    for (const writer of BOUND_WRITERS) {
      const calls = files.flatMap((file) =>
        callsOf(file.source, writer)
          .filter((args) => !/^\(\s*\w+:/.test(args)) // the declaration's parameter list
          .map((args) => ({ path: file.path, args })),
      );
      expect(calls.length, writer).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.args, `${call.path}: ${writer}${call.args}`).toMatch(/^\(\s*\w+\.forTenant\(/);
      }
    }
  });

  it('builds every production knowledge service and re-embedder over a counted provider', () => {
    const sites = files.flatMap((file) =>
      ['new KnowledgeService', 'new KnowledgeReembedder'].flatMap((constructor) =>
        callsOf(file.source, constructor).map((args) => ({ path: file.path, constructor, args })),
      ),
    );
    expect(sites.map((site) => `${site.path}: ${site.constructor}`).sort()).toEqual(
      [
        'server.ts: new KnowledgeService',
        'services/ai/knowledge-refresh-run.ts: new KnowledgeService',
        'services/ai/knowledge-reembed-run.ts: new KnowledgeReembedder',
        'services/scheduler/jobs.ts: new KnowledgeService',
      ].sort(),
    );
    for (const site of sites) {
      expect(site.args, `${site.path}: ${site.constructor}`).toMatch(
        /embeddings: (?:createMeteredEmbeddings\(|new MeteredEmbeddings\(\w+, aiDailyBudget\))/,
      );
    }
  });

  it('builds a provider from the environment only to wrap it in a budget', () => {
    const builders = files
      .filter((file) => callsOf(file.source, 'createEmbeddingProvider').length > 0)
      .map((file) => file.path)
      .sort();
    expect(builders).toEqual(
      [
        // Its own declaration.
        'services/ai/provider/create-embedding-provider.ts',
        // `createMeteredEmbeddings`, which hands it straight to a MeteredEmbeddings.
        'services/ai/metered-embeddings.ts',
        // Wrapped in `new MeteredEmbeddings(embeddings, aiDailyBudget)` (above).
        'server.ts',
      ].sort(),
    );
    expect(byPath.get('services/ai/metered-embeddings.ts')).toMatch(
      /return new MeteredEmbeddings\(\s*createEmbeddingProvider\(/,
    );
  });
});
