import { describe, expect, it } from 'vitest';
import {
  compileForbiddenPhrase,
  FORBIDDEN_PHRASE_CHOICES_MAX,
  FORBIDDEN_PHRASE_MAX,
  FORBIDDEN_PHRASE_REGEX_MAX,
  forbiddenPhraseProblem,
  GUARDRAIL_HIT_ACTIONS,
  GUARDRAIL_RULE_CATEGORIES,
  guardrailHitRuleKey,
  guardrailSetupProblem,
  matchForbiddenPhrases,
  readGuardrailHitRuleKey,
  type CompiledForbiddenPhrase,
  type ForbiddenPhraseMatch,
} from './ai-guardrails.js';
import { GUARDRAIL_CATEGORIES, GUARDRAIL_IDS } from './guardrails.js';

// CPU time of this test process, in ms. Wall clock counts the time the gate's
// other jobs hold the CPU (a 1.8 s run measured 8.8 s under load); CPU time
// does not, so the budget still catches a quadratic pattern without flaking.
// No Node types in this package, hence the narrow cast.
const cpuMs = (): number => {
  const usage = (
    globalThis as unknown as { process: { cpuUsage(): { user: number; system: number } } }
  ).process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/** A backslash, built at run time so no editor or shell can eat it. */
const B = String.fromCharCode(92);

function compiled(phrase: string, match: ForbiddenPhraseMatch): CompiledForbiddenPhrase {
  const result = compileForbiddenPhrase(phrase, match);
  if (!result)
    throw new Error(
      `${match} "${phrase}" was refused: ${JSON.stringify(forbiddenPhraseProblem(phrase, match))}`,
    );
  return result;
}

/** The quotes the phrase finds in the text — empty when it does not match. */
function quotes(text: string, phrase: string, match: ForbiddenPhraseMatch): string[] {
  return matchForbiddenPhrases(text, [compiled(phrase, match)]).map((hit) => hit.quote);
}

describe('guardrail setup (AI-08-S1)', () => {
  it('asks for a crisis text, then for its approval', () => {
    expect(guardrailSetupProblem(null)).toBe('crisis_text_missing');
    expect(guardrailSetupProblem({ crisisText: null, approvedAt: null })).toBe(
      'crisis_text_missing',
    );
    expect(guardrailSetupProblem({ crisisText: '   ', approvedAt: new Date() })).toBe(
      'crisis_text_missing',
    );
    expect(guardrailSetupProblem({ crisisText: 'Yardım hattı: 182', approvedAt: null })).toBe(
      'crisis_text_not_approved',
    );
    expect(
      guardrailSetupProblem({
        crisisText: 'Yardım hattı: 182',
        approvedAt: '2026-10-19T10:00:00Z',
      }),
    ).toBeNull();
  });
});

describe('a workspace rule', () => {
  it('takes the catalogue’s five categories', () => {
    expect(GUARDRAIL_RULE_CATEGORIES).toEqual(GUARDRAIL_CATEGORIES);
  });
});

describe('forbidden phrases — exact and word', () => {
  it('folds the phrase and the reply alike: "KESİN", "kesin" and "Kesin!" are one phrase', () => {
    expect(quotes('Bu iş KESİN olur.', 'kesin', 'word')).toEqual(['KESİN']);
    expect(quotes('kesin yatacak', 'KESİN', 'word')).toEqual(['kesin']);
    expect(quotes('Ödemeniz kesin yatacak', 'Kesin!', 'word')).toEqual(['kesin']);
    expect(quotes('Hesabınıza geçti, kontrol ettim.', 'hesabınıza geçti', 'word')).toEqual([
      'Hesabınıza geçti',
    ]);
  });

  it('a word phrase stands as whole words; an exact one matches inside a word too', () => {
    expect(quotes('Kesinlikle yardımcı olurum.', 'kesin', 'word')).toEqual([]);
    expect(quotes('Kesinlikle yardımcı olurum.', 'kesin', 'exact')).toEqual(['Kesin']);
    expect(quotes('Bu kesin.', 'kesin', 'word')).toEqual(['kesin']);
    expect(quotes('garantili kazanç', 'garanti', 'word')).toEqual([]);
    expect(quotes('garantili kazanç', 'garanti', 'exact')).toEqual(['garanti']);
  });

  it('a phrase does not reach across a sentence or a clause', () => {
    expect(quotes('Bu kesin. Yatacak mı bilmiyorum.', 'kesin yatacak', 'word')).toEqual([]);
    expect(quotes('Bu kesin, yatacak mı bilmiyorum.', 'kesin yatacak', 'word')).toEqual([]);
  });

  it('refuses a phrase nothing is left of, and one too long', () => {
    expect(forbiddenPhraseProblem('   ', 'word')?.reason).toBe('forbidden_phrase_empty');
    expect(forbiddenPhraseProblem('!!! …', 'exact')?.reason).toBe('forbidden_phrase_empty');
    expect(forbiddenPhraseProblem('a'.repeat(FORBIDDEN_PHRASE_MAX), 'word')).toBeNull();
    expect(forbiddenPhraseProblem('a'.repeat(FORBIDDEN_PHRASE_MAX + 1), 'word')?.reason).toBe(
      'forbidden_phrase_too_long',
    );
  });

  it('reports each phrase once, at its first match, by its place in the list', () => {
    const hits = matchForbiddenPhrases('Garanti veriyoruz, kesin yatar, kesin.', [
      compiled('kesin', 'word'),
      compiled('bonus', 'word'),
      compiled('garanti', 'exact'),
    ]);
    expect(hits.map((hit) => [hit.index, hit.quote, hit.start])).toEqual([
      [0, 'kesin', 19],
      [2, 'Garanti', 0],
    ]);
  });
});

describe('forbidden phrases — the regex dialect', () => {
  it('runs case-insensitive on folded text, ^ and $ at a sentence’s edges', () => {
    expect(quotes('Ödemeniz 5 dakika içinde yatar.', `${B}d+ dakika icinde`, 'regex')).toEqual([
      '5 dakika içinde',
    ]);
    expect(quotes('KESİN YATAR', 'kesin yatar', 'regex')).toEqual(['KESİN YATAR']);
    expect(quotes('Merhaba. Kesin olur.', '^kesin', 'regex')).toEqual(['Kesin']);
    expect(quotes('Merhaba kesin olur.', '^kesin', 'regex')).toEqual([]);
    // A Turkish letter in the pattern is folded too.
    expect(quotes('hesabınıza geçti', 'hesabınıza geçti', 'regex')).toEqual(['hesabınıza geçti']);
  });

  it('reads `*` as at most 30: "kesin.*yatar" spans a clause, not a page', () => {
    expect(quotes('kesin bugün içinde yatar', 'kesin.*yatar', 'regex')).toEqual([
      'kesin bugün içinde yatar',
    ]);
    // Not "x" forty times: folding squashes a letter run to one.
    expect(quotes(`kesin ${'abcdefghij '.repeat(4)}yatar`, 'kesin.*yatar', 'regex')).toEqual([]);
    const re = compiled(`kesin.*yatar|${B}d+ dk`, 'regex');
    expect(re.match === 'regex' && re.re.source).toBe(`kesin.{0,30}yatar|${B}d{1,30} dk`);
  });

  it('accepts the shapes a forbidden phrase is written in', () => {
    for (const pattern of [
      'kesin(likle)? yatacak',
      `${B}d{1,3} (dk|dakika) .*yatar`,
      '(vpn|proxy) (kullan|indir)',
      'garanti[a-z]*',
      `kazan${B}w+`,
      `${B}bbonus${B}b`,
      '[0-9]+ ?tl',
      `%${B}d+`,
      'a.b',
      `${B}.com`,
      `[a${B}-z]`,
    ]) {
      expect(forbiddenPhraseProblem(pattern, 'regex'), pattern).toBeNull();
    }
  });

  it('refuses what could run away or never mean what it says', () => {
    const unsafe: string[] = [
      `(a)${B}1`, // back-reference
      '(?=kesin)yatar', // look-ahead
      '(?<!x)kesin', // look-behind
      '(?<n>kesin)', // named group
      '(kesin)+', // a repeated group
      '(ab|a)*c',
      '(a|aa){2}b',
      'a{31}',
      'a{0,100}',
      'a{40,}',
      '.*.*x', // 31 × 31 ways to try one place
      `${B}d+ .*yatar`,
      'a?b?c?d?e?f?g?h?i?', // 2⁹
      '(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)x', // 2⁹
      `${B}p{L}+`,
      `${B}u0041`,
      `${B}x41`,
      `${B}k<n>`,
      `${B}n`,
      'kesin ₺',
      '[abc',
      '(abc',
      'abc)',
      'a{,3}',
      '*a',
      'a**',
      'a]',
    ];
    for (const pattern of unsafe) {
      expect(forbiddenPhraseProblem(pattern, 'regex')?.reason, pattern).toBe(
        'forbidden_phrase_regex_unsafe',
      );
    }
    expect(forbiddenPhraseProblem('[z-a]', 'regex')?.reason).toBe('forbidden_phrase_regex_invalid');
    expect(
      forbiddenPhraseProblem('a'.repeat(FORBIDDEN_PHRASE_REGEX_MAX + 1), 'regex')?.reason,
    ).toBe('forbidden_phrase_too_long');
  });

  it(`counts the ways to try one place against ${FORBIDDEN_PHRASE_CHOICES_MAX}: a branch multiplies, alternatives add`, () => {
    const accepted = (pattern: string) => forbiddenPhraseProblem(pattern, 'regex') === null;
    expect(accepted('a?b?c?.*x')).toBe(true); // 8 × 31 = 248
    expect(accepted('a?b?c?d?.*x')).toBe(false); // 496
    expect(accepted('(a|b|c|d|e|f|g|h)(a|b|c|d|e|f|g|h)')).toBe(true); // 8 × 8
    expect(accepted('(a|b|c|d|e|f|g|h)(a|b|c|d|e|f|g|h)x?y?z?')).toBe(false); // 512
    expect(accepted(`kesin.*yatar|${B}d+ dk`)).toBe(true); // 31 + 30
    expect(accepted('.*a|.*b|.*c|.*d|.*e|.*f|.*g|.*h')).toBe(true); // 8 × 31
    expect(accepted('.*a|.*b|.*c|.*d|.*e|.*f|.*g|.*h|.*i')).toBe(false); // 279
    expect(accepted('(x|.*a|.*b|.*c|.*d|.*e|.*f|.*g|.*h)?')).toBe(false); // 2 × 249
  });

  it('refuses a pattern that can match nothing — it would block every reply', () => {
    for (const pattern of ['a?', `${B}b`, `${B}B`, '^', 'x{0}', 'kesin|', '(?:)']) {
      expect(forbiddenPhraseProblem(pattern, 'regex')?.reason, pattern).toBe(
        'forbidden_phrase_regex_matches_empty',
      );
    }
  });

  it(
    'stays linear on long hostile replies, at the edge of the budget',
    { timeout: 120_000 },
    () => {
      const n = 250_000;
      const texts = [
        'a '.repeat(n / 2),
        '1'.repeat(n),
        '1 '.repeat(n / 2),
        `${'ab'.repeat(n / 2)}`,
      ];
      const patterns = [
        compiled('a?b?c?.*x', 'regex'),
        compiled('[1 ]{0,30}[1 ]{0,7}z', 'regex'),
        compiled('(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)(1|11)x', 'regex'),
        compiled(`${B}d{0,30}${B}d{0,7}x`, 'regex'),
        compiled('kesin', 'word'),
        compiled('ab', 'exact'),
      ];
      for (const text of texts) {
        for (const pattern of patterns) {
          const started = cpuMs();
          matchForbiddenPhrases(text, [pattern]);
          const label = `${pattern.match === 'regex' ? pattern.re.source : pattern.folded} on ${text.slice(0, 6)}`;
          expect(cpuMs() - started, label).toBeLessThan(5_000);
        }
      }
    },
  );
});

describe('the record of a hit', () => {
  it('keys a hit by its rule: G3, rule:<id>, phrase:<id> — and reads them back', () => {
    const id = '0b4f7e8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(guardrailHitRuleKey({ source: 'platform', id: 'G3' })).toBe('G3');
    expect(guardrailHitRuleKey({ source: 'rule', id })).toBe(`rule:${id}`);
    expect(guardrailHitRuleKey({ source: 'phrase', id })).toBe(`phrase:${id}`);
    for (const key of [...GUARDRAIL_IDS, `rule:${id}`, `phrase:${id}`]) {
      const read = readGuardrailHitRuleKey(key);
      expect(read && guardrailHitRuleKey(read), key).toBe(key);
    }
    for (const key of [
      'G0',
      'G20',
      'g3',
      'rule:',
      `rules:${id}`,
      'phrase:not-a-uuid',
      `rule:${id.toUpperCase()}`,
    ]) {
      expect(readGuardrailHitRuleKey(key), key).toBeNull();
    }
  });

  it('closes the actions a turn may take', () => {
    expect(GUARDRAIL_HIT_ACTIONS).toEqual([
      'handoff',
      'crisis_text',
      'rewrite',
      'safe_text',
      'prompt_block',
      'warn',
      'evidence',
    ]);
  });
});
