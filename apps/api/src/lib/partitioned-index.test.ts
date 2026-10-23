import { describe, expect, it } from 'vitest';
import { childIndexName, childIndexStatement } from './partitioned-index.js';

describe('childIndexName', () => {
  it('swaps the table prefix for the partition name — the name migration 20261023100000 gives', () => {
    expect(childIndexName('events_text_search_idx', 'events', 'events_2026_10')).toBe(
      'events_2026_10_text_search_idx',
    );
    expect(childIndexName('events_text_search_idx', 'events', 'events_default')).toBe(
      'events_default_text_search_idx',
    );
  });

  it('keeps the whole parent name when it does not start with the table', () => {
    expect(childIndexName('idx_search', 'events', 'events_2026_10')).toBe(
      'events_2026_10_idx_search',
    );
  });

  it('refuses a name PostgreSQL would silently truncate', () => {
    expect(() => childIndexName(`events_${'x'.repeat(60)}`, 'events', 'events_2026_10')).toThrow(
      /63 bytes/,
    );
  });
});

describe('childIndexStatement', () => {
  const head = { index: 'events_text_search_idx', table: 'public.events' };
  const child = { index: 'events_2026_10_text_search_idx', table: 'public.events_2026_10' };

  it("rewrites the parent's own definition into a concurrent build on the partition", () => {
    expect(
      childIndexStatement(
        "CREATE INDEX events_text_search_idx ON ONLY public.events USING gin (siyahtus_search_fold(text) gin_trgm_ops) WHERE (type = 'message'::text)",
        head,
        child,
      ),
    ).toBe(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS events_2026_10_text_search_idx ON public.events_2026_10 ' +
        "USING gin (siyahtus_search_fold(text) gin_trgm_ops) WHERE (type = 'message'::text)",
    );
  });

  it('keeps UNIQUE', () => {
    expect(
      childIndexStatement(
        'CREATE UNIQUE INDEX events_text_search_idx ON ONLY public.events USING btree (id)',
        head,
        child,
      ),
    ).toMatch(/^CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS events_2026_10_text_search_idx ON /);
  });

  it('refuses a definition whose head it does not recognise', () => {
    // Not `ON ONLY`, or another index's name: rewriting by guesswork could build
    // an index the parent will not accept — or on the wrong table.
    expect(() =>
      childIndexStatement(
        'CREATE INDEX events_text_search_idx ON public.events USING gin (x)',
        head,
        child,
      ),
    ).toThrow(/unexpected partitioned index definition/);
    expect(() =>
      childIndexStatement(
        'CREATE INDEX other_idx ON ONLY public.events USING gin (x)',
        head,
        child,
      ),
    ).toThrow(/unexpected partitioned index definition/);
  });
});
