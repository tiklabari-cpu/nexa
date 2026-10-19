/**
 * The output check (tm 301.3 · AI-08 §6): what a draft must not say — the
 * locked catalogue's output lexicons, G4 only on a risk-flagged conversation,
 * the workspace's forbidden phrases — and what the rewrite is told.
 */
import { describe, expect, it } from 'vitest';
import type { ForbiddenPhraseConfig } from './config.js';
import { checkOutput, guardrailRewriteNote, type OutputViolation } from './output-check.js';

const ruleOf = (violation: OutputViolation) =>
  violation.rule.source === 'platform'
    ? violation.rule.id
    : `${violation.rule.source}:${violation.rule.id}`;

function phrase(
  id: string,
  text: string,
  extra: Partial<ForbiddenPhraseConfig> = {},
): ForbiddenPhraseConfig {
  return {
    id,
    aiAgentId: 'agent-1',
    phrase: text,
    match: 'word',
    lang: null,
    scope: { all: true },
    action: 'block',
    ...extra,
  };
}

const plain = { riskFlagged: false, phrases: [] };

describe('the locked catalogue’s output lexicons (AI-08 §6)', () => {
  it.each([
    ['Kontrol ettim, hesabınıza geçti.', 'G8', 'Kontrol ettim'],
    ['Çekim talepleri 24 saat içinde işlenir.', 'G7', '24 saat içinde işlenir'],
    ['Yatırımınız kesin yatacak.', 'G7', 'kesin yatacak'],
    ['Bu maçta mutlaka kazanırsınız.', 'G9', 'kazanırsınız'],
    ['Lütfen tekrar yatırın.', 'G10', 'tekrar yatırın'],
    ['Şifrenizi yazar mısınız?', 'G11', 'Şifrenizi yazar mısınız'],
    ['Belgeniz onaylandı.', 'G12', 'Belgeniz onaylandı'],
    ['Hesabınız AML incelemesinde.', 'G13', 'AML'],
    ['VPN kullanabilirsiniz.', 'G14', 'VPN kullanabilirsiniz'],
    ['Ben gerçek bir insanım.', 'G16', 'bir insanım'],
  ] as const)('“%s” breaks %s', (draft, rule, quote) => {
    const { violations, warnings } = checkOutput(draft, plain);
    expect(violations.map(ruleOf)).toContain(rule);
    expect(violations.find((v) => ruleOf(v) === rule)?.quote).toBe(quote);
    expect(warnings).toEqual([]);
  });

  it('a time with "genellikle" is an estimate, not a promise (G7)', () => {
    expect(checkOutput('Çekim talepleri genellikle 24 saat içinde işlenir.', plain)).toEqual({
      violations: [],
      warnings: [],
    });
  });

  it('one violation per rule, however often the draft breaks it', () => {
    const { violations } = checkOutput(
      'Kontrol ettim, hesabınıza geçti. Sistemde görünüyor.',
      plain,
    );
    expect(violations.map(ruleOf)).toEqual(['G8']);
  });

  it('the platform’s own sentences break nothing', () => {
    for (const draft of [
      'Bilgilerinizi ilgili ekibimize iletiyorum.',
      'Sizi bir temsilcimize aktarıyorum.',
      'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.',
      'Size yardımcı olmak istiyorum; lütfen saygılı bir dille devam edelim.',
    ]) {
      expect(checkOutput(draft, plain).violations).toEqual([]);
    }
  });
});

describe('G4 — no promotion to a player at risk (AI-08 §4)', () => {
  const draft = 'Size özel bir bonus tanımlayabiliriz.';

  it('a bonus is an answer on an ordinary conversation', () => {
    expect(checkOutput(draft, plain).violations).toEqual([]);
  });

  it('and a violation on a risk-flagged one', () => {
    const { violations } = checkOutput(draft, { riskFlagged: true, phrases: [] });
    expect(violations.map(ruleOf)).toEqual(['G4']);
  });
});

describe('the workspace’s forbidden phrases', () => {
  it('a `block` phrase is a violation, quoted in the draft’s own words', () => {
    const { violations } = checkOutput('Bu KESİN bir bilgi, merak etmeyin.', {
      riskFlagged: false,
      phrases: [phrase('p-1', 'kesin')],
    });
    expect(violations).toEqual([
      expect.objectContaining({
        rule: { source: 'phrase', id: 'p-1' },
        quote: 'KESİN',
        pattern: null,
      }),
    ]);
  });

  it('a `warn` phrase is a warning, and the draft goes', () => {
    const { violations, warnings } = checkOutput('Hemen bakıyorum.', {
      riskFlagged: false,
      phrases: [phrase('p-2', 'hemen', { action: 'warn' })],
    });
    expect(violations).toEqual([]);
    expect(warnings.map(ruleOf)).toEqual(['phrase:p-2']);
  });

  it('a whole-word phrase leaves a longer word alone; an exact one does not', () => {
    const draft = 'Kesinlikle yardımcı olurum.';
    expect(
      checkOutput(draft, { riskFlagged: false, phrases: [phrase('w', 'kesin')] }).violations,
    ).toEqual([]);
    expect(
      checkOutput(draft, {
        riskFlagged: false,
        phrases: [phrase('e', 'kesin', { match: 'exact' })],
      }).violations.map(ruleOf),
    ).toEqual(['phrase:e']);
  });

  it('a pattern of the safe dialect matches; one it refuses matches nothing', () => {
    const phrases = [
      phrase('r', String.raw`\d+ dakika`, { match: 'regex' }),
      phrase('bad', '(a+)+', { match: 'regex' }),
    ];
    const { violations } = checkOutput('İşlem 5 dakika sürer.', { riskFlagged: false, phrases });
    expect(violations.map(ruleOf)).toEqual(['phrase:r']);
  });
});

describe('the rewrite (AI-08 §8)', () => {
  it('names every rule the draft broke, and quotes it', () => {
    const { violations } = checkOutput('Kontrol ettim. Tekrar yatırın.', plain);
    const note = guardrailRewriteNote(violations);
    expect(note.split('\n')[0]).toContain('Write it again');
    expect(note).toContain('Never speak as if you had verified the account');
    expect(note).toContain('(it said: "Kontrol ettim")');
    expect(note).toContain('(it said: "Tekrar yatırın")');
  });
});
