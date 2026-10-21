/**
 * The iGaming template screen's pure half (tm 311.4 · AI-15).
 */
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import {
  galleryStartsOnIgaming,
  installErrorKey,
  installState,
  packUnfilled,
  routeMappingBody,
  type AiTemplatePackInstallResult,
  type AiTemplateSummary,
} from './ai-templates.js';

function summary(overrides: Partial<AiTemplateSummary> = {}): AiTemplateSummary {
  return {
    key: 'deposit_not_credited',
    name: 'Yatırım hesaba geçmedi',
    summary: 'Özet',
    version: 2,
    locked: false,
    topics: ['finance'],
    tenant_must_fill_count: 1,
    installed_version: null,
    ...overrides,
  };
}

describe('galleryStartsOnIgaming (AI-15)', () => {
  it('is true for gaming and gambling and for no other sector', () => {
    expect(galleryStartsOnIgaming('gaming_gambling')).toBe(true);
    expect(galleryStartsOnIgaming('ecommerce_retail')).toBe(false);
    expect(galleryStartsOnIgaming(null)).toBe(false);
    expect(galleryStartsOnIgaming(undefined)).toBe(false);
  });
});

describe('installState (AI-15)', () => {
  it('tells not installed, installed and "a newer version is out" apart', () => {
    expect(installState(summary({ installed_version: null }))).toBe('available');
    expect(installState(summary({ installed_version: 2 }))).toBe('installed');
    expect(installState(summary({ installed_version: 1 }))).toBe('update');
  });
});

describe('routeMappingBody (AI-15)', () => {
  it('maps the chosen topics to numeric team ids and drops the ones left for later', () => {
    expect(routeMappingBody({ finance: '3', kyc_risk: '' })).toEqual({ finance: 3 });
  });

  it('is undefined when nothing was chosen, so the body carries no mapping at all', () => {
    expect(routeMappingBody({})).toBeUndefined();
    expect(routeMappingBody({ finance: '' })).toBeUndefined();
  });
});

describe('installErrorKey (AI-15)', () => {
  function validation(reason: string): ApiClientError {
    return new ApiClientError({
      type: 'validation',
      status: 400,
      message: 'x',
      requestId: 'r',
      details: { reason },
    });
  }

  it('words a known refusal by its reason', () => {
    expect(installErrorKey(validation('handoff_route_unknown_team'))).toBe(
      'playbook.aiTemplates.error.handoff_route_unknown_team',
    );
    expect(installErrorKey(validation('template_route_unknown_topic'))).toBe(
      'playbook.aiTemplates.error.template_route_unknown_topic',
    );
  });

  it('falls back to the general sentence for a reason this build does not know', () => {
    expect(installErrorKey(validation('something_new'))).toBe('common.errors.validation');
  });
});

describe('packUnfilled (AI-15)', () => {
  it('lists each left-over placeholder once across the pack', () => {
    const template = (unfilled: string[]) => ({
      template_key: 'k',
      skill_id: 's',
      created: true,
      tenant_must_fill: [],
      unfilled_placeholders: unfilled,
      unmapped_topics: [],
    });
    const result = {
      templates: [template(['sikayet_suresi', 'adr_kurumu']), template(['sikayet_suresi'])],
    } as unknown as AiTemplatePackInstallResult;
    expect(packUnfilled(result)).toEqual(['sikayet_suresi', 'adr_kurumu']);
  });
});
