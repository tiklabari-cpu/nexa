import { describe, expect, it } from 'vitest';
import { parseRichText } from './rich-text.js';

describe('parseRichText — the shared markdown subset (FR-MOD-02.3.5 · FR-MOD-11.4)', () => {
  it('splits **bold** and *italic* out of the surrounding text', () => {
    expect(parseRichText('a **b** and *c*')).toEqual([
      { type: 'text', content: 'a ' },
      { type: 'bold', content: 'b' },
      { type: 'text', content: ' and ' },
      { type: 'italic', content: 'c' },
    ]);
  });

  it('reads the double marker as bold, never as two italics', () => {
    expect(parseRichText('**both**')).toEqual([{ type: 'bold', content: 'both' }]);
  });

  it('closes each marker at the nearest partner, not the last one on the line', () => {
    // The lazy quantifier is the whole reason this holds: a greedy one would
    // swallow "one** plain **two" into a single emphasis.
    expect(parseRichText('**one** plain **two**')).toEqual([
      { type: 'bold', content: 'one' },
      { type: 'text', content: ' plain ' },
      { type: 'bold', content: 'two' },
    ]);
  });

  it('substitutes a bullet glyph for a `- ` line prefix', () => {
    expect(parseRichText('- first\n- second')).toEqual([
      { type: 'text', content: '• first\n• second' },
    ]);
  });

  it('needs the space — a hyphenated line is not a list', () => {
    expect(parseRichText('-5 degrees')).toEqual([{ type: 'text', content: '-5 degrees' }]);
  });

  it('leaves an unclosed marker as literal text instead of throwing', () => {
    expect(parseRichText('half **open')).toEqual([{ type: 'text', content: 'half **open' }]);
  });

  it('does not let a marker span two lines', () => {
    expect(parseRichText('**start\nend**')).toEqual([{ type: 'text', content: '**start\nend**' }]);
  });

  it('returns nothing for an empty string rather than an empty segment', () => {
    expect(parseRichText('')).toEqual([]);
  });

  it('carries markup through as text — the subset has no syntax for it', () => {
    // The guarantee both renderers rest on: whatever a segment holds is
    // *content*, so `<img src=x onerror=alert(1)>` can only ever become
    // characters. Nothing in this module can emit an element (NFR-S6).
    expect(parseRichText('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', content: '<img src=x onerror=alert(1)>' },
    ]);
    expect(parseRichText('**<script>alert(1)</script>**')).toEqual([
      { type: 'bold', content: '<script>alert(1)</script>' },
    ]);
  });
});
