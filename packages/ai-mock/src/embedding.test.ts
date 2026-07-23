/**
 * The embedding stub carries the whole weight of retrieval, so it is tested for
 * the two properties the rest of the system relies on rather than for its
 * numbers: identical text must produce an identical vector, and overlapping
 * text must score higher than unrelated text.
 *
 * The seed's previous approach derived a vector from a chunk's *position*. It
 * satisfied neither, and retrieval looked like it worked only because the demo
 * had a single source.
 */
import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  chunk,
  embed,
  similarity,
  tokenize,
  toVectorLiteral,
} from './embedding.js';

describe('tokenize', () => {
  it('lowercases and drops punctuation', () => {
    expect(tokenize('Delivery, returns & refunds!')).toEqual(['delivery', 'return', 'refund']);
  });

  it('stems so a query and a document meet on the same token', () => {
    // "How long does delivery take?" must reach "delivery takes 3 to 5 days".
    expect(tokenize('takes')).toEqual(tokenize('take'));
    expect(tokenize('deliveries')).toEqual(tokenize('delivery'));
    expect(tokenize('shipping')).toEqual(tokenize('shipped'));
  });

  it('leaves short words alone rather than mangling them', () => {
    expect(tokenize('bus gas')).toEqual(['bus', 'gas']);
  });

  it('drops stop words and single characters', () => {
    expect(tokenize('where is my order')).toEqual(['order']);
  });

  it('keeps non-Latin scripts', () => {
    // A support product that silently discarded Turkish or Greek text would be
    // useless for exactly the customers this seed models.
    expect(tokenize('kargo nerede')).toEqual(['kargo', 'nerede']);
    expect(tokenize('παραγγελία')).toEqual(['παραγγελια']);
  });

  it('folds diacritics so accented and unaccented spellings match', () => {
    // Deliberate, and matching-only: what an agent reads keeps its accents.
    expect(tokenize('café')).toEqual(tokenize('cafe'));
    expect(tokenize('kargó')).toEqual(tokenize('kargo'));
    expect(tokenize('sipariş')).toEqual(tokenize('siparis'));
  });

  it('returns nothing for text made only of stop words', () => {
    expect(tokenize('is it the')).toEqual([]);
  });
});

describe('embed', () => {
  it('produces a vector of the column width', () => {
    expect(embed('delivery takes three days')).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('is deterministic', () => {
    // Reproducible demos and stable tests both depend on this.
    expect(embed('delivery takes three days')).toEqual(embed('delivery takes three days'));
  });

  it('is a unit vector', () => {
    const magnitude = Math.sqrt(embed('refund policy').reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 4);
  });

  it('returns zeros for text with no signal, rather than throwing', () => {
    // An empty or stop-word-only source should index as "matches nothing", not
    // break the indexing run for every other source alongside it.
    expect(embed('   ')).toEqual(new Array(EMBEDDING_DIMENSIONS).fill(0));
    expect(embed('the it is')).toEqual(new Array(EMBEDDING_DIMENSIONS).fill(0));
  });

  it('ignores case and punctuation differences', () => {
    expect(embed('Refund policy.')).toEqual(embed('refund policy'));
  });
});

describe('similarity', () => {
  const delivery = embed('Standard delivery takes three to five working days.');
  const deliveryQuery = embed('How long does delivery take?');
  const refunds = embed('Refunds are issued to the original payment method.');

  it('scores overlapping text above unrelated text', () => {
    // The property retrieval actually needs: a delivery question must rank the
    // delivery chunk above the refunds chunk.
    expect(similarity(delivery, deliveryQuery)).toBeGreaterThan(similarity(refunds, deliveryQuery));
  });

  it('scores identical text at 1', () => {
    expect(similarity(delivery, delivery)).toBeCloseTo(1, 4);
  });

  it('scores text with nothing in common near zero', () => {
    const score = similarity(embed('bicycle wheel truing'), embed('invoice tax exemption'));
    expect(Math.abs(score)).toBeLessThan(0.3);
  });

  it('refuses to compare vectors of different widths', () => {
    // Silently returning a number here would let a dimension mismatch corrupt
    // ranking with no error anywhere.
    expect(() => similarity([1, 0], [1, 0, 0])).toThrow(/length mismatch/);
  });
});

describe('chunk', () => {
  it('splits on paragraphs, which are already the units of meaning', () => {
    expect(chunk('First para.\n\nSecond para.')).toEqual(['First para.', 'Second para.']);
  });

  it('keeps a short document whole', () => {
    expect(chunk('Just one line.')).toEqual(['Just one line.']);
  });

  it('splits an oversized paragraph by sentence', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunk(long, 200);

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) expect(piece.length).toBeLessThanOrEqual(260);
  });

  it('overlaps one sentence so an answer on a boundary is not lost', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Fact ${i} is important.`).join(' ');
    const chunks = chunk(long, 120);

    // The last sentence of one chunk should reappear at the start of the next.
    const tail = chunks[0]!.split(/(?<=\.)\s+/).at(-1);
    expect(chunks[1]).toContain(tail);
  });

  it('drops empty input rather than emitting a blank chunk', () => {
    expect(chunk('')).toEqual([]);
    expect(chunk('\n\n  \n')).toEqual([]);
  });
});

describe('toVectorLiteral', () => {
  it('formats for pgvector', () => {
    expect(toVectorLiteral([0.1, -0.2, 0])).toBe('[0.1,-0.2,0]');
  });
});
