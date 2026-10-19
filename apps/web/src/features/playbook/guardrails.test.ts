/**
 * What the guardrails tab decides without drawing anything (tm 301.4 · AI-08):
 * who may write, which sentence answers a refusal, and how a scope survives an edit.
 */
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PHRASE_PROBLEMS } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import { hasMessage } from '../../lib/i18n.js';
import {
  canWriteGuardrails,
  guardrailErrorKey,
  NEW_SCOPE_DRAFT,
  scopeDraftOf,
  scopeIsEmpty,
  scopeOfDraft,
} from './guardrails.js';

function failure(
  type: ConstructorParameters<typeof ApiClientError>[0]['type'],
  reason?: string,
): ApiClientError {
  return new ApiClientError({
    type,
    status: 400,
    message: 'raw english from the server',
    requestId: 'r-1',
    ...(reason ? { details: { reason } } : {}),
  });
}

describe('who writes the guardrails', () => {
  it('is the owner with the AI scope — nobody else, whatever their scope', () => {
    expect(canWriteGuardrails('owner', true)).toBe(true);
    expect(canWriteGuardrails('owner', false)).toBe(false);
    for (const role of ['viceowner', 'admin', 'agent', null]) {
      expect(canWriteGuardrails(role, true), String(role)).toBe(false);
    }
  });
});

describe('the sentence that answers a refusal', () => {
  it('has its own words for a write against the locked platform rules', () => {
    expect(guardrailErrorKey(failure('not_allowed', 'guardrail_platform_locked'))).toBe(
      'playbook.guardrails.error.locked',
    );
    // A 403 for some other reason is the generic one.
    expect(guardrailErrorKey(failure('not_allowed', 'something_else'))).toBe(
      'common.errors.not_allowed',
    );
  });

  it('has a catalogue entry in both languages for every reason the API can give a phrase', () => {
    const reasons = [
      ...FORBIDDEN_PHRASE_PROBLEMS,
      'forbidden_phrase_exists',
      'forbidden_phrases_limit',
      'forbidden_phrase_regex_limit',
    ];
    for (const reason of reasons) {
      const key = guardrailErrorKey(failure('validation', reason));
      expect(key, reason).toBe(`playbook.guardrails.phrases.problem.${reason}`);
      expect(hasMessage('en', key), `en ${key}`).toBe(true);
      expect(hasMessage('tr', key), `tr ${key}`).toBe(true);
    }
  });

  it('names a missing crisis text when approval is asked for without one', () => {
    expect(guardrailErrorKey(failure('validation', 'guardrail_crisis_text_missing'))).toBe(
      'playbook.guardrails.settings.approveNeedsText',
    );
  });

  it('never invents a key from a reason it does not know', () => {
    expect(guardrailErrorKey(failure('validation', 'forbidden_phrase_made_up'))).toBe(
      'common.errors.validation',
    );
    expect(guardrailErrorKey(new Error('boom'))).toBe('common.errors.unknown');
  });
});

describe('a scope through an edit', () => {
  it('reads all, procedures and brands, and anything unreadable as every conversation', () => {
    expect(scopeDraftOf({ all: true })).toEqual({ mode: 'all', skillIds: [] });
    expect(scopeDraftOf({ skill_ids: ['s-1', 's-2'] })).toEqual({
      mode: 'skills',
      skillIds: ['s-1', 's-2'],
    });
    expect(scopeDraftOf({ brand_ids: ['b-1'] })).toEqual({ mode: 'brands', skillIds: [] });
    expect(scopeDraftOf(null)).toEqual(NEW_SCOPE_DRAFT);
    expect(scopeDraftOf({ skill_ids: [] })).toEqual(NEW_SCOPE_DRAFT);
  });

  it('writes back what was picked, and keeps a brand scope it never offered', () => {
    expect(scopeOfDraft({ mode: 'all', skillIds: [] }, null)).toEqual({ all: true });
    expect(scopeOfDraft({ mode: 'skills', skillIds: ['s-1'] }, null)).toEqual({
      skill_ids: ['s-1'],
    });
    const brands = { brand_ids: ['b-1', 'b-2'] };
    expect(scopeOfDraft({ mode: 'brands', skillIds: [] }, brands)).toEqual(brands);
    // No brand scope to carry over: it falls back rather than inventing one.
    expect(scopeOfDraft({ mode: 'brands', skillIds: [] }, null)).toEqual({ all: true });
  });

  it('calls only an empty procedure pick empty', () => {
    expect(scopeIsEmpty({ mode: 'skills', skillIds: [] })).toBe(true);
    expect(scopeIsEmpty({ mode: 'skills', skillIds: ['s-1'] })).toBe(false);
    expect(scopeIsEmpty({ mode: 'all', skillIds: [] })).toBe(false);
  });
});
