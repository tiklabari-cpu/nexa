/**
 * Copilot BI question → metric + window.
 *
 * The negatives come first, because they are the acceptance criterion: an
 * unplaceable question must not produce a metric. Everything after them checks
 * that refusing to guess did not cost the questions people actually ask.
 */
import { describe, expect, it } from 'vitest';
import { tokenize } from './embedding.js';
import {
  BI_CONFIDENCE_THRESHOLD,
  BI_METRICS,
  biMetricSource,
  resolveBiQuestion,
  type MetricKey,
} from './bi-intent.js';

describe('resolveBiQuestion — refuses to guess', () => {
  it.each([
    ['hayatın anlamı nedir', 'tr'],
    ['What is the meaning of life?', 'en'],
    ['kargom nerede', 'tr'],
    ['can you transfer me to billing', 'en'],
  ])('reports no metric for a question about nothing it measures: %s (%s)', (question) => {
    const result = resolveBiQuestion(question);
    expect(result.metric).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it.each([
    ['manuel çözüm mü otomatik çözüm mü', 'tr'],
    ['manual resolutions or automated resolutions', 'en'],
  ])('reports no metric when two metrics fit equally well: %s (%s)', (question) => {
    expect(resolveBiQuestion(question).metric).toBeNull();
  });

  it('reports no metric for the bare "resolved" question the three-way split shares', () => {
    // manual + assisted + automated all answer "how many were resolved". Naming
    // one of them would be a coin flip presented as a report.
    expect(resolveBiQuestion('kaç sohbet çözüldü').metric).toBeNull();
    expect(resolveBiQuestion('how many chats were resolved').metric).toBeNull();
  });

  it('reports no metric for an empty or whitespace-only question', () => {
    expect(resolveBiQuestion('')).toEqual({ metric: null, range: null, confidence: 0 });
    expect(resolveBiQuestion('   ')).toEqual({ metric: null, range: null, confidence: 0 });
  });

  it('still reads the window of a question whose metric it could not place', () => {
    // The window is independent evidence; the caller ignores it while
    // `metric` is null, and nothing here pretends the metric was understood.
    const result = resolveBiQuestion('bu hafta neler oldu');
    expect(result.metric).toBeNull();
    expect(result.range).toBe('this_week');
  });
});

describe('resolveBiQuestion — metrics', () => {
  it('maps the KK example: "bu hafta kaç sohbet kapandı" → closed, this week', () => {
    expect(resolveBiQuestion('bu hafta kaç sohbet kapandı')).toEqual({
      metric: 'closed',
      range: 'this_week',
      confidence: 1,
    });
  });

  it('maps the KK example: "CSAT ne durumda" → csat', () => {
    const result = resolveBiQuestion('CSAT ne durumda');
    expect(result.metric).toBe('csat');
    // No window named — the caller applies the report's own default.
    expect(result.range).toBeNull();
  });

  it.each<[string, MetricKey]>([
    ['bu ay kaç sohbet başladı', 'chats'],
    ['how many chats did we have', 'chats'],
    ['toplam sohbet sayısı ne', 'chats'],
    ['dün kaç sohbet kapandı', 'closed'],
    ['how many chats closed yesterday', 'closed'],
    ['kaç sohbet manuel çözüldü', 'manual'],
    ['how many chats were resolved manually', 'manual'],
    ['kaç sohbet destekli çözüldü', 'assisted'],
    ['assisted resolutions this week', 'assisted'],
    ['kaç sohbet otomatik çözüldü', 'automated'],
    ['how many chats were resolved automatically', 'automated'],
    ['müşteri memnuniyeti ne durumda', 'csat'],
    ['what is our customer satisfaction score', 'csat'],
  ])('maps %s → %s', (question, metric) => {
    expect(resolveBiQuestion(question).metric).toBe(metric);
  });

  it('prefers the more specific metric when both match fully', () => {
    // "how many chats" and "how many chats closed" both match completely; the
    // second saw one more word, and that word is the whole question.
    expect(resolveBiQuestion('how many chats were closed this week').metric).toBe('closed');
  });

  it('reports confidence at or above the threshold whenever it names a metric', () => {
    const result = resolveBiQuestion('bu hafta kaç sohbet kapandı');
    expect(result.confidence).toBeGreaterThanOrEqual(BI_CONFIDENCE_THRESHOLD);
  });
});

describe('resolveBiQuestion — windows', () => {
  it.each([
    ['dün kaç sohbet kapandı', 'yesterday'],
    ['dünkü sohbet sayısı', 'yesterday'],
    ['how many chats closed yesterday', 'yesterday'],
    ['bugün kaç sohbet kapandı', 'today'],
    ['how many chats closed today', 'today'],
    ['bu hafta kaç sohbet kapandı', 'this_week'],
    ['bu haftaki sohbet sayısı', 'this_week'],
    ['chats closed this week', 'this_week'],
    ['geçen hafta kaç sohbet kapandı', 'last_week'],
    ['chats closed last week', 'last_week'],
    ['bu ay kaç sohbet kapandı', 'this_month'],
    ['chats closed this month', 'this_month'],
    ['son 7 gün kaç sohbet kapandı', 'last_7_days'],
    ['son 7 günde kaç sohbet kapandı', 'last_7_days'],
    ['chats closed in the last 7 days', 'last_7_days'],
    ['son 30 gün kaç sohbet kapandı', 'last_30_days'],
    ['chats closed in the last 30 days', 'last_30_days'],
  ])('reads the window out of %s → %s', (question, range) => {
    expect(resolveBiQuestion(question).range).toBe(range);
  });

  it('reads a window written without its diacritics', () => {
    expect(resolveBiQuestion('bu hafta kac sohbet kapandi').range).toBe('this_week');
    expect(resolveBiQuestion('SON 7 GÜN KAÇ SOHBET KAPANDI').range).toBe('last_7_days');
  });

  it('reports no window when the question names none', () => {
    expect(resolveBiQuestion('kaç sohbet kapandı').range).toBeNull();
  });

  it('reports no window for a period it cannot name exactly', () => {
    // "son 14 gün" is a real window this cannot resolve. Rounding it to the
    // nearest one it knows would answer a different question than the one asked.
    expect(resolveBiQuestion('son 14 gün kaç sohbet kapandı').range).toBeNull();
  });

  it('does not read a month out of a sentence that only starts like one', () => {
    // "bu ayrıca" — "ay" is two letters, so its pattern takes no suffix tail.
    const result = resolveBiQuestion('bu ayrıca kaç sohbet kapandı');
    expect(result.range).toBeNull();
    expect(result.metric).toBe('closed');
  });

  it('does not read a day out of "dünya"', () => {
    expect(resolveBiQuestion('dünya genelinde kaç sohbet kapandı').range).toBeNull();
  });
});

describe('resolveBiQuestion — contract with the caller', () => {
  const CORPUS = [
    'bu hafta kaç sohbet kapandı',
    'CSAT ne durumda',
    'manual resolutions or automated resolutions',
    'hayatın anlamı nedir',
    '',
    'son 30 gün kaç sohbet otomatik çözüldü',
  ];

  it('reports confidence above zero exactly when it names a metric', () => {
    for (const question of CORPUS) {
      const result = resolveBiQuestion(question);
      expect(result.confidence > 0).toBe(result.metric !== null);
    }
  });

  it('is deterministic — the same question resolves the same way every time', () => {
    for (const question of CORPUS) {
      const first = resolveBiQuestion(question);
      for (let run = 0; run < 100; run++) {
        expect(resolveBiQuestion(question)).toEqual(first);
      }
    }
  });

  it('finishes in linear time on a pathological question', () => {
    // Regression for the ReDoS class of §D59: repetition that would blow up a
    // backtracking pattern, at a length no real question reaches.
    const pathological = `${'son 7 gun '.repeat(20_000)}${'a'.repeat(100_000)}`;
    const started = performance.now();
    expect(resolveBiQuestion(pathological).metric).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('ignores anything past the length the contract accepts', () => {
    const padded = `${'x '.repeat(300)}bu hafta kaç sohbet kapandı`;
    expect(resolveBiQuestion(padded).metric).toBeNull();
  });
});

describe('BI_METRICS', () => {
  it('gives every metric a source on the Overview report and at least one phrase', () => {
    for (const metric of BI_METRICS) {
      expect(metric.phrases.length).toBeGreaterThan(0);
      expect(metric.metricSource).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(biMetricSource(metric.key)).toBe(metric.metricSource);
    }
  });

  it('reads each metric from a different field', () => {
    const sources = BI_METRICS.map((metric) => metric.metricSource);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('orders phrases longest-first, which the specificity tie-break depends on', () => {
    for (const metric of BI_METRICS) {
      const lengths = metric.phrases.map((phrase) => tokenize(phrase).length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    }
  });
});
