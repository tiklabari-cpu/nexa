/**
 * The rule bot is LLM-free *by construction*, and this is where that is
 * measured rather than asserted in prose (FR-MOD-06.6).
 *
 * PRD:577 asks for a bot that is "AI Agent'tan ayrı, LLM'siz". The existing AI
 * path is already deterministic — but only because `@nexa/ai-mock` is a stub
 * (MASTER-PROMPT §5), which is a property of this build and not of the design.
 * A test that merely ran the engine and saw a fixed answer would pass just as
 * happily if the engine called `matchIntent`, so it would prove nothing.
 *
 * So the claim is checked structurally: walk the module graph reachable from the
 * bot's entry points, following every relative import, and look at what is in
 * it. An AI import anywhere in that closure fails this test — including one
 * added three files deep by somebody who never read this comment.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');

/** The two modules the customer's message path actually enters through. */
const ENTRY_POINTS = ['rule-bot-responder.ts', 'rule-bot-engine.ts'].map((f) => join(HERE, f));

/** `import … from '<specifier>'` / `export … from '<specifier>'`, in source order. */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

interface Graph {
  /** Repo-relative paths of every first-party module in the closure. */
  files: string[];
  /** Every bare package specifier anything in the closure imports. */
  packages: Set<string>;
}

function walk(entries: readonly string[]): Graph {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1]!;
      if (!specifier.startsWith('.')) {
        packages.add(specifier);
        continue;
      }
      // Source is ESM-with-extensions (`./x.js`), compiled from `./x.ts`.
      const resolved = resolve(dirname(file), specifier).replace(/\.js$/, '.ts');
      if (existsSync(resolved)) queue.push(resolved);
      else throw new Error(`unresolvable import ${specifier} in ${file}`);
    }
  }

  return {
    files: [...seen].map((f) => relative(SRC, f).replace(/\\/g, '/')).sort(),
    packages,
  };
}

describe('the rule bot reaches no AI at all (FR-MOD-06.6)', () => {
  const graph = walk(ENTRY_POINTS);

  it('walks a graph that is actually there', () => {
    // Guards the measurement itself: a walker that resolved nothing would make
    // every assertion below vacuously true.
    expect(graph.files.length).toBeGreaterThan(3);
    expect(graph.files).toContain('services/bots/rule-bot-matching.ts');
    expect(graph.files).toContain('services/bots/rule-bot-engine.ts');
  });

  it('never imports @nexa/ai-mock', () => {
    // The single most load-bearing assertion in this file: `@nexa/ai-mock` is
    // where `matchIntent`, `embed` and `compileInstruction` live, i.e. every
    // probabilistic decision in this product.
    expect([...graph.packages]).not.toContain('@nexa/ai-mock');
  });

  it('pulls in no module from the AI service directory', () => {
    // Covers the transitive route the package check alone would miss: importing
    // `services/ai/knowledge-service.ts` would bring retrieval and embeddings in
    // without ever naming the package here.
    const aiModules = graph.files.filter((f) => f.startsWith('services/ai/'));
    expect(aiModules).toEqual([]);
  });

  it('names no AI entry point anywhere in its closure', () => {
    const forbidden = ['matchIntent', 'embed(', 'shapeAnswer', 'SkillEngine', 'knowledgeSource'];
    const offenders = graph.files
      .map((file) => ({ file, source: readFileSync(join(SRC, file), 'utf8') }))
      .flatMap(({ file, source }) =>
        forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`),
      );
    expect(offenders).toEqual([]);
  });

  it('keeps the matcher free of the database and the clock as well', () => {
    // The part a unit test can pin down exactly stays pinnable: no Prisma, no
    // Fastify, no `new Date()`. The service around it owns all three.
    const matcher = walk([join(HERE, 'rule-bot-matching.ts')]);
    expect(matcher.files).toEqual(['services/bots/rule-bot-matching.ts']);
    expect([...matcher.packages]).toEqual(['@nexa/types']);
    const source = readFileSync(join(HERE, 'rule-bot-matching.ts'), 'utf8');
    expect(source).not.toContain('new Date(');
    expect(source).not.toContain('Date.now(');
  });
});
