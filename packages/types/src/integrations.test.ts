import { describe, expect, it } from 'vitest';
import { INTEGRATION_ACTIONS, INTEGRATION_TRIGGERS } from './integrations.js';
import { isScope } from './scopes.js';

describe('integration manifest catalogue (FR-MOD-09.4)', () => {
  it('has one trigger per action, all unique', () => {
    expect(INTEGRATION_TRIGGERS.length).toBeGreaterThan(0);
    const actions = INTEGRATION_TRIGGERS.map((t) => t.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('every trigger has a label, a description and a sample payload', () => {
    for (const trigger of INTEGRATION_TRIGGERS) {
      expect(trigger.label).not.toBe('');
      expect(trigger.description).not.toBe('');
      expect(trigger.sample_payload).toMatchObject({ action: trigger.action });
      expect(trigger.sample_payload['data']).toBeTruthy();
    }
  });

  it('has at least one action, all unique ids', () => {
    expect(INTEGRATION_ACTIONS.length).toBeGreaterThan(0);
    const ids = INTEGRATION_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every action carries only real scopes', () => {
    for (const action of INTEGRATION_ACTIONS) {
      expect(action.label).not.toBe('');
      expect(action.path.startsWith('/')).toBe(true);
      expect(action.required_scopes.length).toBeGreaterThan(0);
      for (const scope of action.required_scopes) {
        expect(isScope(scope)).toBe(true);
      }
    }
  });
});
