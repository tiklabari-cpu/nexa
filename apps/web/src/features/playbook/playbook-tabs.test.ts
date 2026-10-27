import { describe, expect, it } from 'vitest';
import { PLAYBOOK_TABS, PLAYBOOK_VIEWS, resolveView } from './playbook-tabs.js';

describe('playbook tabs registry (tm 390.2)', () => {
  it('lists every view once, General first and Behaviour second', () => {
    expect(PLAYBOOK_TABS.map((tab) => tab.id)).toEqual([...PLAYBOOK_VIEWS]);
    expect(new Set(PLAYBOOK_VIEWS).size).toBe(PLAYBOOK_VIEWS.length);
    expect(PLAYBOOK_VIEWS.slice(0, 2)).toEqual(['general', 'behaviour']);
  });

  it('resolves a known id to itself', () => {
    for (const id of PLAYBOOK_VIEWS) expect(resolveView(id)).toBe(id);
  });

  it('maps the pre-rename ?view=profile to general', () => {
    expect(resolveView('profile')).toBe('general');
  });

  it('returns null for an absent, empty or unknown value', () => {
    expect(resolveView(null)).toBeNull();
    expect(resolveView(undefined)).toBeNull();
    expect(resolveView('')).toBeNull();
    expect(resolveView('nonsense')).toBeNull();
  });
});
