import { describe, expect, it } from 'vitest';
import {
  UNRESOLVED_EXCLUDED_GUARDRAILS,
  UNRESOLVED_EXCLUDED_HANDOFF_REASONS,
  UNRESOLVED_MIN_CHARS,
  UNRESOLVED_REASONS,
  UNRESOLVED_TEXT_MAX,
  isUnresolvedReason,
  unresolvedTextOf,
} from './ai-unresolved.js';
import { GUARDRAIL_IDS, PLATFORM_GUARDRAILS } from './guardrails.js';
import { HANDOFF_REASONS } from './handoff.js';

describe('the unresolved questions vocabulary (AI-22 · tm 317.1)', () => {
  it('names the nine reasons, once each', () => {
    expect(UNRESOLVED_REASONS).toHaveLength(9);
    expect(new Set(UNRESOLVED_REASONS).size).toBe(UNRESOLVED_REASONS.length);
    expect(isUnresolvedReason('no_procedure_match')).toBe(true);
    expect(isUnresolvedReason('no_passages')).toBe(false);
  });

  it('keeps out every compliance rule the analysis names, and their hand-over reasons', () => {
    // 05 § AI-22 §1: G1–G5, G13 and G15 are never on the list; G6 shares G1's reason.
    for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G13', 'G15']) {
      expect(UNRESOLVED_EXCLUDED_GUARDRAILS).toContain(id);
    }
    expect(GUARDRAIL_IDS).toEqual(expect.arrayContaining([...UNRESOLVED_EXCLUDED_GUARDRAILS]));
    expect(HANDOFF_REASONS).toEqual(
      expect.arrayContaining([...UNRESOLVED_EXCLUDED_HANDOFF_REASONS]),
    );
    // Every excluded rule that hands over does it for an excluded reason.
    for (const rule of PLATFORM_GUARDRAILS) {
      if (!(UNRESOLVED_EXCLUDED_GUARDRAILS as readonly string[]).includes(rule.id)) continue;
      if (rule.handoffReason === null) continue;
      expect(UNRESOLVED_EXCLUDED_HANDOFF_REASONS).toContain(rule.handoffReason);
    }
    // A knowledge gap is not excluded.
    expect(UNRESOLVED_EXCLUDED_HANDOFF_REASONS).not.toContain('no_knowledge');
    expect(UNRESOLVED_EXCLUDED_HANDOFF_REASONS).not.toContain('not_understood');
  });

  describe('unresolvedTextOf — what is worth grouping (AI-22 §2)', () => {
    it('keeps a question, whitespace collapsed', () => {
      expect(unresolvedTextOf('  Papara ile   yatırdım\ngözükmüyor ')).toBe(
        'Papara ile yatırdım gözükmüyor',
      );
      expect(unresolvedTextOf('Canlı casino ne zaman açık?')).toBe('Canlı casino ne zaman açık?');
    });

    it('drops a greeting, a single word, emoji, punctuation and the blank', () => {
      for (const text of ['merhaba', '?', '??? !!', '👍', '😀 😀', 'ok', '   ', '', 'Papara?']) {
        expect(unresolvedTextOf(text)).toBeNull();
      }
      expect(unresolvedTextOf(null)).toBeNull();
      expect(unresolvedTextOf(undefined)).toBeNull();
    });

    it(`drops two words with fewer than ${UNRESOLVED_MIN_CHARS} letters and digits between them`, () => {
      expect(unresolvedTextOf('a b')).toBeNull();
      expect(unresolvedTextOf('a bc')).toBe('a bc');
    });

    it(`cuts a long message to ${UNRESOLVED_TEXT_MAX} characters`, () => {
      const kept = unresolvedTextOf(`soru ${'x'.repeat(2 * UNRESOLVED_TEXT_MAX)}`);
      expect(kept).toHaveLength(UNRESOLVED_TEXT_MAX);
    });
  });
});
