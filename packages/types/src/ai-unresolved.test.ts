import { describe, expect, it } from 'vitest';
import {
  UNRESOLVED_ALERT_KINDS,
  UNRESOLVED_ALERT_REPEAT_HOURS,
  UNRESOLVED_CLUSTER_SIMILARITY,
  UNRESOLVED_EXCLUDED_GUARDRAILS,
  UNRESOLVED_EXCLUDED_HANDOFF_REASONS,
  UNRESOLVED_HANDOFF_REASONS,
  UNRESOLVED_MERGE_SIMILARITY,
  UNRESOLVED_MIN_CHARS,
  UNRESOLVED_REASONS,
  UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
  UNRESOLVED_SPIKE_THRESHOLD_MAX,
  UNRESOLVED_SPIKE_THRESHOLD_MIN,
  UNRESOLVED_SPIKE_WINDOW_MINUTES,
  UNRESOLVED_TEXT_MAX,
  isUnresolvedReason,
  isUnresolvedSuggestedAction,
  unresolvedLabelDue,
  unresolvedLabelOf,
  unresolvedSpaceKind,
  unresolvedTextOf,
} from './ai-unresolved.js';
import { WORKSPACE_NOTICE_PUSHES } from './notifications.js';
import { RTM_PUSH_ACTIONS } from './rtm.js';
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

describe('the clustering vocabulary (AI-22 §4–§8 · tm 317.2)', () => {
  it('tells the stub’s lexical space from a model’s, each with its own τ and a higher τ_merge', () => {
    expect(unresolvedSpaceKind('mock:lexical-v1')).toBe('lexical');
    expect(unresolvedSpaceKind('openai:text-embedding-3-small')).toBe('model');
    expect(UNRESOLVED_CLUSTER_SIMILARITY.model).toBe(0.8);
    expect(UNRESOLVED_MERGE_SIMILARITY.model).toBeGreaterThan(UNRESOLVED_CLUSTER_SIMILARITY.model);
    expect(UNRESOLVED_MERGE_SIMILARITY.lexical).toBeGreaterThan(
      UNRESOLVED_CLUSTER_SIMILARITY.lexical,
    );
  });

  it('keeps AI-22-S2’s alarm: 20 in 60 minutes by default, once in six hours', () => {
    expect(UNRESOLVED_SPIKE_THRESHOLD_DEFAULT).toBe(20);
    expect(UNRESOLVED_SPIKE_WINDOW_MINUTES).toBe(60);
    expect(UNRESOLVED_ALERT_REPEAT_HOURS).toBe(6);
    expect(UNRESOLVED_SPIKE_THRESHOLD_DEFAULT).toBeGreaterThanOrEqual(
      UNRESOLVED_SPIKE_THRESHOLD_MIN,
    );
    expect(UNRESOLVED_SPIKE_THRESHOLD_DEFAULT).toBeLessThanOrEqual(UNRESOLVED_SPIKE_THRESHOLD_MAX);
  });

  it('names the actions a title suggests, and the reasons that are a hand-over in themselves', () => {
    expect(isUnresolvedSuggestedAction('add_knowledge')).toBe(true);
    expect(isUnresolvedSuggestedAction('escalate')).toBe(false);
    expect(UNRESOLVED_REASONS).toEqual(expect.arrayContaining([...UNRESOLVED_HANDOFF_REASONS]));
    expect(UNRESOLVED_HANDOFF_REASONS).not.toContain('player_abandoned');
  });

  it('keeps a title to eight words, without a digit or a mask’s star', () => {
    expect(unresolvedLabelOf('"Papara yatırımı görünmüyor."')).toBe('Papara yatırımı görünmüyor');
    expect(unresolvedLabelOf('a b c d e f g h i j')).toBe('a b c d e f g h');
    expect(unresolvedLabelOf('Kart **** sorunu')).toBeNull();
    expect(unresolvedLabelOf('500 TL yatırım')).toBeNull();
    expect(unresolvedLabelOf(null)).toBeNull();
  });

  it('titles a cluster again once it has grown by half', () => {
    expect(unresolvedLabelDue(1, 0)).toBe(true);
    expect(unresolvedLabelDue(5, 4)).toBe(false);
    expect(unresolvedLabelDue(6, 4)).toBe(true);
  });

  it('announces on a push the gateway relays, listed with the other workspace notices', () => {
    expect(RTM_PUSH_ACTIONS).toContain('ai_unresolved_alert');
    expect(WORKSPACE_NOTICE_PUSHES).toEqual(['ai_usage_alert', 'ai_unresolved_alert']);
    expect(UNRESOLVED_ALERT_KINDS).toEqual(['spike', 'reopened']);
  });
});
