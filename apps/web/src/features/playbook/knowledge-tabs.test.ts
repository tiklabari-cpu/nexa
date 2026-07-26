import { describe, expect, it } from 'vitest';
import type { KnowledgeSource } from './types.js';
import {
  countSourcesByTab,
  filterSourcesByTab,
  isKnowledgeType,
  KNOWLEDGE_TYPES,
} from './knowledge-tabs.js';

function source(type: string, id = type): KnowledgeSource {
  return {
    id,
    ai_agent_id: 'agent',
    name: `${type} source`,
    type,
    status: 'ready',
    source_url: null,
    chunk_count: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const SOURCES: KnowledgeSource[] = [
  source('website', 'w1'),
  source('website', 'w2'),
  source('file', 'f1'),
  source('article', 'a1'),
  source('faq', 'q1'),
];

describe('knowledge sub-tabs', () => {
  it('each kind tab returns only sources of that type', () => {
    for (const type of KNOWLEDGE_TYPES) {
      const shown = filterSourcesByTab(SOURCES, type);
      expect(shown.every((s) => s.type === type)).toBe(true);
    }
    expect(filterSourcesByTab(SOURCES, 'website').map((s) => s.id)).toEqual(['w1', 'w2']);
    expect(filterSourcesByTab(SOURCES, 'faq').map((s) => s.id)).toEqual(['q1']);
  });

  it('All shows every source and never loses one', () => {
    expect(filterSourcesByTab(SOURCES, 'all')).toHaveLength(SOURCES.length);
  });

  it('the kind tabs partition All exactly — no overlap, nothing dropped', () => {
    const counts = countSourcesByTab(SOURCES);
    expect(counts.all).toBe(SOURCES.length);
    expect(counts.website + counts.file + counts.article + counts.faq).toBe(counts.all);
    expect(counts).toMatchObject({ website: 2, file: 1, article: 1, faq: 1 });
  });

  it('keeps an unknown type visible under All but out of the kind counts', () => {
    const withOdd = [...SOURCES, source('podcast', 'p1')];
    const counts = countSourcesByTab(withOdd);
    expect(isKnowledgeType('podcast')).toBe(false);
    expect(counts.all).toBe(withOdd.length);
    // The odd one is in All but counted under no kind tab.
    expect(counts.website + counts.file + counts.article + counts.faq).toBe(SOURCES.length);
  });
});
