/**
 * The AI-05 intent fixture (tm 297.3 · `test/fixtures/ai-intents-tr.json`):
 * 20 iGaming topics as procedures and 220 held-out player messages, 80 of them
 * misspelled. What this file holds the mock to is a measured floor, not a
 * claim of understanding: the stub reads words (`matchIntent`), so a typo is
 * a word it does not know. The real model's numbers are the optional nightly
 * evaluation's (DoD-outside), over the same file.
 *
 * Measured here, each a floor a regression would cross:
 *   - the stub's top-1 over the whole catalogue;
 *   - the narrowing's recall — whether the right topic is among the 10 a
 *     message's nearest examples keep (lexical embedding, the same function
 *     `ProcedureExamples.rank` computes in SQL: each procedure by its nearest
 *     example);
 *   - that narrowing first costs the stub nothing it had: every message the
 *     whole catalogue read right, the narrowed one reads right too.
 *
 * Measured 2026-10-18 (version 1): top-1 0.736 (misspelled 0.938 — the
 * tokenizer folds diacritics, so "gonderdim" is "gönderdim" to it, and most
 * typos here are that), recall@10 0.95 (misspelled 0.988), top-1 narrowed
 * 0.736, none lost. The floors sit a few points under; a change to the
 * fixture re-measures them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embed, similarity } from '@siyahtus/ai-mock';
import { describe, expect, it } from 'vitest';
import type { RankedSkill } from '../procedure-examples.js';
import { narrowCatalogue, PREFILTER_ABOVE, PREFILTER_KEEP } from './prefilter.js';
import type { CatalogueEntry } from './procedure/understanding.js';
import { mockUnderstanding } from './understand-mock.js';
import { understandCatalogue, understandGrounding, UNDERSTAND_EXAMPLES_MAX } from './understand.js';

interface Topic {
  key: string;
  name: string;
  when_to_use: string;
  examples: string[];
  sentences: string[];
  typos: string[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../test/fixtures/ai-intents-tr.json', import.meta.url)),
    'utf8',
  ),
) as { version: number; topics: Topic[] };

const TOPICS = FIXTURE.topics;
/** Floors under the measured numbers (see the header). */
const FLOORS = { top1: 0.7, top1Typos: 0.85, recall10: 0.92, recall10Typos: 0.95 } as const;

/** The locked platform procedure (AI-15) among the topics. */
const LOCKED = 'self_exclusion';

const CATALOGUE: CatalogueEntry[] = understandCatalogue({
  procedures: TOPICS.map((topic, index) => ({
    entry: {
      key: topic.key,
      name: topic.name,
      whenToUse: topic.when_to_use,
      examples: topic.examples,
      priority: 100 + index,
      locked: topic.key === LOCKED,
    },
  })),
  active: null,
});

const MESSAGES = TOPICS.flatMap((topic) => [
  ...topic.sentences.map((text) => ({ text, key: topic.key, typo: false })),
  ...topic.typos.map((text) => ({ text, key: topic.key, typo: true })),
]);

/** What the stub's understanding call picks among `catalogue`. */
function understood(text: string, catalogue: readonly CatalogueEntry[]): string | null {
  return mockUnderstanding(
    understandGrounding({
      message: text,
      catalogue,
      active: null,
      pending: null,
      now: new Date('2026-10-18T12:00:00Z'),
      timeZone: 'Europe/Istanbul',
      currency: 'TRY',
    }),
  ).intent.procedure_key;
}

const EXAMPLE_VECTORS = TOPICS.map((topic) => ({
  key: topic.key,
  vectors: topic.examples.map((example) => embed(example)),
}));

/** Each procedure by its nearest example — `ProcedureExamples.rank`, in process. */
function ranked(text: string): RankedSkill[] {
  const message = embed(text);
  return EXAMPLE_VECTORS.map(({ key, vectors }) => ({
    skillId: key,
    similarity: Math.max(...vectors.map((vector) => similarity(message, vector))),
  })).sort((a, b) => b.similarity - a.similarity || a.skillId.localeCompare(b.skillId));
}

function narrowed(text: string): CatalogueEntry[] {
  return narrowCatalogue({
    catalogue: CATALOGUE,
    ranked: ranked(text),
    activeKey: null,
    strategy: 'exact',
  }).catalogue;
}

const share = (hits: number, of: number) => Math.round((hits / of) * 1000) / 1000;

describe('the AI-05 intent fixture (tm 297.3)', () => {
  it('holds 20 topics and at least 200 held-out messages, misspelled ones among them', () => {
    expect(TOPICS).toHaveLength(20);
    expect(new Set(TOPICS.map((topic) => topic.key)).size).toBe(20);
    expect(MESSAGES.length).toBeGreaterThanOrEqual(200);
    expect(MESSAGES.filter((message) => message.typo).length).toBeGreaterThanOrEqual(60);
    for (const topic of TOPICS) {
      expect(topic.examples.length, topic.key).toBeGreaterThanOrEqual(1);
      expect(topic.examples.length, topic.key).toBeLessThanOrEqual(UNDERSTAND_EXAMPLES_MAX);
      // Held out: a message that is an example measures nothing.
      for (const text of [...topic.sentences, ...topic.typos]) {
        expect(topic.examples, `${topic.key}: "${text}"`).not.toContain(text);
      }
    }
    // Large enough that the live turn narrows it.
    expect(CATALOGUE.length).toBeGreaterThan(PREFILTER_ABOVE);
  });

  it('AI-05: "havale attım gözükmüyor", "usdt gönderdim düşmedi", "bakiyem gelmedi" → deposit_not_credited, whole and narrowed', () => {
    for (const text of ['havale attım gözükmüyor', 'usdt gönderdim düşmedi', 'bakiyem gelmedi']) {
      expect(understood(text, CATALOGUE), text).toBe('deposit_not_credited');
      expect(understood(text, narrowed(text)), text).toBe('deposit_not_credited');
    }
  });

  it('AI-05: the narrowing keeps 10 by nearness and the locked self-exclusion whatever the message', () => {
    for (const { text } of MESSAGES) {
      const kept = narrowed(text);
      expect(kept.map((entry) => entry.key)).toContain(LOCKED);
      expect(kept.length).toBeLessThanOrEqual(PREFILTER_KEEP + 1);
    }
    expect(understood('hesabımı kapatın', narrowed('hesabımı kapatın'))).toBe(LOCKED);
  });

  it('measures the stub and the narrowing against their floors', () => {
    let whole = 0;
    let wholeTypos = 0;
    let recall = 0;
    let recallTypos = 0;
    let after = 0;
    const lost: string[] = [];
    for (const message of MESSAGES) {
      const right = understood(message.text, CATALOGUE) === message.key;
      const kept = narrowed(message.text);
      const inside = kept.some((entry) => entry.key === message.key);
      const rightAfter = understood(message.text, kept) === message.key;
      if (right) whole += 1;
      if (right && message.typo) wholeTypos += 1;
      if (inside) recall += 1;
      if (inside && message.typo) recallTypos += 1;
      if (rightAfter) after += 1;
      if (right && !rightAfter) lost.push(message.text);
    }
    const typos = MESSAGES.filter((message) => message.typo).length;
    const measured = {
      top1: share(whole, MESSAGES.length),
      top1Typos: share(wholeTypos, typos),
      recall10: share(recall, MESSAGES.length),
      recall10Typos: share(recallTypos, typos),
    };
    for (const [name, floor] of Object.entries(FLOORS)) {
      expect(measured[name as keyof typeof FLOORS], name).toBeGreaterThanOrEqual(floor);
    }
    // Narrowing first loses nothing the whole catalogue had.
    expect(lost).toEqual([]);
    expect(after).toBeGreaterThanOrEqual(whole);
  });
});
