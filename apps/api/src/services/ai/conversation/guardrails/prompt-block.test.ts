/**
 * The guardrails' prompt layers and their record (tm 301.3 · AI-08 §5, §9):
 * the locked lines in the reply's language, G4's only on a risk-flagged
 * conversation, the workspace's rules after them — and the record a turn's
 * hits leave, which keeps rule keys and never the words.
 */
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_GUARDRAILS,
  PLATFORM_GUARDRAILS_VERSION,
  platformGuardrail,
} from '@siyahtus/types';
import { renderLayers } from '../guidance.js';
import { guardrailLang, guardrailLayers } from './prompt-block.js';
import {
  guardrailDetails,
  guardrailHit,
  guardrailHitKeys,
  mergeGuardrailRecords,
} from './record.js';

const RULE = {
  id: 'r-1',
  aiAgentId: 'agent-1',
  title: 'Çekim süresi',
  body: 'Çekim için\n  hiçbir süre söyleme.',
  category: 'money' as const,
  action: 'block_output' as const,
  scope: { all: true as const },
};

describe('the locked layer and the workspace’s (AI-08 §5)', () => {
  it('every locked line but G4’s, in Turkish, then the workspace’s rules — the earlier wins', () => {
    const lines = renderLayers(
      guardrailLayers({ answerIn: 'tr', riskFlagged: false, workspaceRules: [RULE] }),
    );
    expect(lines[0]).toContain('Where two conflict, the earlier one wins.');
    expect(lines[1]).toBe('Platform rules (locked):');
    const locked = PLATFORM_GUARDRAILS.filter((rule) => rule.id !== 'G4');
    expect(lines.slice(2, 2 + locked.length)).toEqual(locked.map((rule) => `- ${rule.prompt.tr}`));
    expect(lines.slice(2 + locked.length)).toEqual([
      "The business's compliance rules:",
      '- Çekim süresi: Çekim için hiçbir süre söyleme.',
    ]);
  });

  it('G4 goes in on a risk-flagged conversation', () => {
    const lines = renderLayers(
      guardrailLayers({ answerIn: 'tr', riskFlagged: true, workspaceRules: [] }),
    );
    expect(lines).toContain(`- ${platformGuardrail('G4').prompt.tr}`);
  });

  it('English for a reply in any other language; Turkish when the language is the player’s', () => {
    expect(guardrailLang('de')).toBe('en');
    expect(guardrailLang('en')).toBe('en');
    expect(guardrailLang(null)).toBe('tr');
    const [locked] = guardrailLayers({ answerIn: 'en', riskFlagged: false, workspaceRules: [] });
    expect(locked!.lines[0]).toBe(`- ${platformGuardrail('G1').prompt.en}`);
  });
});

describe('the record (AI-08 §8, §9)', () => {
  it('one hit per rule, stage and action; flags once each; the version kept', () => {
    const merged = mergeGuardrailRecords(
      {
        catalog_version: PLATFORM_GUARDRAILS_VERSION,
        hits: [guardrailHit({ source: 'platform', id: 'G4' }, 'input', 'prompt_block')],
        risk_flags: ['rg_signal'],
      },
      {
        catalog_version: PLATFORM_GUARDRAILS_VERSION,
        hits: [
          guardrailHit({ source: 'platform', id: 'G4' }, 'input', 'prompt_block'),
          guardrailHit({ source: 'phrase', id: 'p-1' }, 'output', 'rewrite', 'kesin', null),
        ],
        risk_flags: ['rg_signal', 'self_harm'],
      },
    );
    expect(merged?.hits.map((hit) => hit.rule_key)).toEqual(['G4', 'phrase:p-1']);
    expect(merged?.risk_flags).toEqual(['rg_signal', 'self_harm']);
    expect(guardrailHitKeys(merged)).toEqual(['G4', 'phrase:p-1']);
    expect(mergeGuardrailRecords(undefined, undefined)).toBeUndefined();
  });

  it('the decision record keeps keys and actions — the evidence stays out (ID-08)', () => {
    const hit = guardrailHit(
      { source: 'platform', id: 'G1' },
      'input',
      'handoff',
      ' hesabımı kapatın ',
      3,
    );
    expect(hit).toEqual({
      rule_key: 'G1',
      stage: 'input',
      action: 'handoff',
      evidence: 'hesabımı kapatın',
      pattern_index: 3,
    });
    const details = guardrailDetails({
      catalog_version: PLATFORM_GUARDRAILS_VERSION,
      hits: [hit],
      risk_flags: ['self_exclusion_request'],
    });
    expect(details).toEqual({
      catalog_version: PLATFORM_GUARDRAILS_VERSION,
      hits: [{ rule_key: 'G1', stage: 'input', action: 'handoff' }],
    });
    expect(JSON.stringify(details)).not.toContain('hesab');
    expect(
      guardrailDetails({ catalog_version: PLATFORM_GUARDRAILS_VERSION, hits: [], risk_flags: [] }),
    ).toEqual({ catalog_version: PLATFORM_GUARDRAILS_VERSION });
  });
});
