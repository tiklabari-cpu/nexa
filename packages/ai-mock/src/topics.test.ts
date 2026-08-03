/**
 * Deterministic topic clustering (FR-MOD-07.6).
 *
 * The acceptance criteria are two phrases — "AI kümeleme" and "yeterli veri
 * yoksa empty" — and the tests pin both: the same conversations always cluster
 * the same way regardless of order (so the report does not reshuffle on
 * refresh), and too few conversations produce an honest empty state rather than
 * an invented topic. The failures that matter here are a wrong merge and, above
 * all, a customer's order or card number leaking into a topic label — so those
 * get tested from the negative side first.
 */
import { describe, expect, it } from 'vitest';
import {
  TOPIC_MIN_CLUSTER_SIZE,
  TOPIC_MIN_CONVERSATIONS,
  TOPIC_SIMILARITY_THRESHOLD,
  clusterTopics,
  type TopicDoc,
} from './topics.js';

// Within a topic the conversations share the topic's vocabulary, as the demo
// seed (07.6-d) crafts them; the lexical embedding groups on shared terms.
const DELIVERY = [
  'Where is my delivery? The order tracking has not updated in days.',
  'My order delivery is late, the tracking number shows no movement.',
  'Delivery delayed — the tracking on my order still says pending.',
  'Late delivery again, my order tracking has been stuck all week.',
];
const REFUND = [
  'I want a refund for my order, please return the payment to my card.',
  'How do I get a refund? The payment for my order should be returned.',
  'Refund requested — return my payment, the order arrived damaged.',
];
const BILLING = [
  'My invoice is wrong, the billing charge does not match my subscription plan.',
  'Billing overcharged my subscription, the invoice shows the wrong plan price.',
  'Wrong billing on my invoice — my subscription plan was charged twice over.',
];

/** Build docs from texts with stable, zero-padded ids. */
function docsOf(texts: string[], prefix = 'c'): TopicDoc[] {
  return texts.map((text, i) => ({ id: `${prefix}${String(i).padStart(3, '0')}`, text }));
}

/** Cycle `texts` to `count` docs — a single-theme corpus at any size. */
function repeat(texts: string[], count: number, prefix = 'c'): TopicDoc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(3, '0')}`,
    text: texts[i % texts.length]!,
  }));
}

describe('clusterTopics — determinism ("AI kümeleme" repeatable)', () => {
  it('produces an identical result no matter the input order', () => {
    const docs = [...docsOf(DELIVERY, 'd'), ...docsOf(REFUND, 'r'), ...docsOf(BILLING, 'b')];
    const forward = clusterTopics(docs, { minConversations: 2 });
    const reversed = clusterTopics([...docs].reverse(), { minConversations: 2 });
    // Interleave to shuffle harder than a simple reverse.
    const interleaved = clusterTopics(
      docs.flatMap((_, i) => (i % 2 === 0 ? [docs[i]!] : [])).concat(docs.filter((_, i) => i % 2 === 1)),
      { minConversations: 2 },
    );

    expect(reversed).toEqual(forward);
    expect(interleaved).toEqual(forward);
  });

  it('is a pure function — it does not mutate or reorder the caller array', () => {
    const docs = docsOf(DELIVERY, 'd');
    const snapshot = docs.map((d) => ({ ...d }));
    clusterTopics(docs, { minConversations: 2 });
    expect(docs).toEqual(snapshot);
  });
});

describe('clusterTopics — clustering ("really groups")', () => {
  it('puts same-topic conversations together and different ones apart', () => {
    const delivery = docsOf(DELIVERY, 'd');
    const refund = docsOf(REFUND, 'r');
    const result = clusterTopics([...delivery, ...refund], { minConversations: 2 });

    expect(result.sufficient).toBe(true);
    expect(result.analyzed).toBe(delivery.length + refund.length);
    expect(result.topics).toHaveLength(2);

    const topicOf = (id: string) => result.topics.find((t) => t.docIds.includes(id));
    // Every delivery chat lands in one topic; every refund chat in another.
    const deliveryTopics = new Set(delivery.map((d) => topicOf(d.id)));
    const refundTopics = new Set(refund.map((d) => topicOf(d.id)));
    expect(deliveryTopics.size).toBe(1);
    expect(refundTopics.size).toBe(1);
    expect([...deliveryTopics][0]).not.toBe([...refundTopics][0]);

    // Volumes and their member ids are the two topics' sizes, ascending ids.
    for (const topic of result.topics) {
      expect(topic.volume).toBe(topic.docIds.length);
      expect([...topic.docIds]).toEqual([...topic.docIds].sort());
    }
  });

  it('separates three distinct themes into three topics', () => {
    const docs = [...docsOf(DELIVERY, 'd'), ...docsOf(REFUND, 'r'), ...docsOf(BILLING, 'b')];
    const result = clusterTopics(docs, { minConversations: 2 });
    expect(result.topics).toHaveLength(3);
    expect(result.topics.reduce((sum, t) => sum + t.volume, 0)).toBe(docs.length);
  });

  it('keeps a lone off-topic conversation out of the topics but still counts it', () => {
    const docs = [
      ...docsOf(DELIVERY, 'd'),
      { id: 'z000', text: 'Do you have a store location in Berlin with opening hours?' },
    ];
    const result = clusterTopics(docs, { minConversations: 2 });
    // The singleton is below TOPIC_MIN_CLUSTER_SIZE, so it is not its own topic…
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0]!.volume).toBe(DELIVERY.length);
    // …but it was clusterable, so it is still part of `analyzed`.
    expect(result.analyzed).toBe(DELIVERY.length + 1);
  });
});

describe('clusterTopics — ordering & tie-break', () => {
  it('orders topics by volume desc, then label ascending, stably across order', () => {
    // Two equal-volume topics: the tie is broken by label, deterministically.
    const docs = [...docsOf(REFUND, 'r'), ...docsOf(BILLING, 'b')];
    const a = clusterTopics(docs, { minConversations: 2 });
    const b = clusterTopics([...docs].reverse(), { minConversations: 2 });
    expect(b.topics).toEqual(a.topics);

    for (let i = 1; i < a.topics.length; i++) {
      const prev = a.topics[i - 1]!;
      const cur = a.topics[i]!;
      expect(prev.volume).toBeGreaterThanOrEqual(cur.volume);
      if (prev.volume === cur.volume) expect(prev.label <= cur.label).toBe(true);
    }
  });

  it('gives every topic a distinct, stable id within one response', () => {
    const docs = [...docsOf(DELIVERY, 'd'), ...docsOf(REFUND, 'r'), ...docsOf(BILLING, 'b')];
    const { topics } = clusterTopics(docs, { minConversations: 2 });
    const ids = topics.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of topics) expect(topic.id.length).toBeGreaterThan(0);
  });
});

describe('clusterTopics — "yeterli veri yoksa empty"', () => {
  it('returns an empty, insufficient result below the conversation floor', () => {
    const result = clusterTopics(docsOf(DELIVERY, 'd')); // 4 < default floor of 20
    expect(result.sufficient).toBe(false);
    expect(result.topics).toEqual([]);
    expect(result.analyzed).toBe(DELIVERY.length);
  });

  it('treats an empty window as insufficient with nothing analyzed', () => {
    const result = clusterTopics([]);
    expect(result).toEqual({ sufficient: false, analyzed: 0, topics: [] });
  });

  it('treats a single conversation as insufficient', () => {
    const result = clusterTopics(docsOf([DELIVERY[0]!], 'd'));
    expect(result.sufficient).toBe(false);
    expect(result.topics).toEqual([]);
  });

  it('flips to sufficient once the floor is reached, clustering all of one theme together', () => {
    const docs = repeat(DELIVERY, TOPIC_MIN_CONVERSATIONS + 1, 'd');
    const result = clusterTopics(docs);
    expect(result.analyzed).toBe(TOPIC_MIN_CONVERSATIONS + 1);
    expect(result.sufficient).toBe(true);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0]!.volume).toBe(TOPIC_MIN_CONVERSATIONS + 1);
  });
});

describe('clusterTopics — no PII in a label (pure-number tokens dropped)', () => {
  it('never lets a 16-digit number reach a topic label or keywords', () => {
    const texts = [
      'My order 1234567890123456 was double charged on my billing invoice.',
      'The billing invoice double charged my card 1234 5678 9012 3456 by mistake.',
      'Charged twice — order 1234567890123456 on my billing invoice statement.',
      'Billing invoice for order 1234567890123456 shows a double charge again.',
    ];
    const result = clusterTopics(docsOf(texts, 'p'), { minConversations: 2 });
    expect(result.topics.length).toBeGreaterThanOrEqual(1);
    for (const topic of result.topics) {
      expect(topic.label).not.toMatch(/\d/);
      expect(topic.label).not.toContain('1234567890123456');
      for (const keyword of topic.keywords) expect(keyword).not.toMatch(/\d/);
    }
  });
});

describe('clusterTopics — robustness', () => {
  it('does not crash on empty, whitespace-only or punctuation-only text, and excludes it', () => {
    const docs: TopicDoc[] = [
      ...docsOf(DELIVERY, 'd'),
      { id: 'e000', text: '' },
      { id: 'e001', text: '   \n\t  ' },
      { id: 'e002', text: '!!! ??? ... —' },
    ];
    const result = clusterTopics(docs, { minConversations: 2 });
    // The three empties carry no token and are not clusterable.
    expect(result.analyzed).toBe(DELIVERY.length);
    expect(result.sufficient).toBe(true);
  });

  it('returns nothing rather than throwing when every doc is empty', () => {
    const docs = docsOf(['', '   ', '\n\n'], 'e');
    const result = clusterTopics(docs, { minConversations: 1 });
    expect(result).toEqual({ sufficient: false, analyzed: 0, topics: [] });
  });
});

describe('clusterTopics — calibrated constants', () => {
  it('keeps the similarity threshold in the empty band between within- and cross-topic', () => {
    expect(TOPIC_SIMILARITY_THRESHOLD).toBeGreaterThan(0.2);
    expect(TOPIC_SIMILARITY_THRESHOLD).toBeLessThan(0.38);
  });

  it('needs at least two conversations for a topic', () => {
    expect(TOPIC_MIN_CLUSTER_SIZE).toBeGreaterThanOrEqual(2);
  });
});
