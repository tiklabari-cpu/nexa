import { describe, expect, it } from 'vitest';
import { AGENT_COMPOSING_TTL_SECONDS, composerStateKey } from './realtime-bus.js';
import { RTM_PUSH_ACTIONS } from './rtm.js';

describe('composerStateKey', () => {
  it('scopes the key by licence id so the same chat id never collides across tenants', () => {
    expect(composerStateKey('1', 'ABC')).not.toBe(composerStateKey('2', 'ABC'));
  });

  it('is stable for the same licence and chat id', () => {
    expect(composerStateKey('1', 'ABC')).toBe(composerStateKey('1', 'ABC'));
  });
});

describe('AGENT_COMPOSING_TTL_SECONDS', () => {
  it('is a positive number of seconds', () => {
    expect(AGENT_COMPOSING_TTL_SECONDS).toBeGreaterThan(0);
  });
});

describe('RTM_PUSH_ACTIONS', () => {
  it('carries a push action for the multi-agent conflict warning', () => {
    expect(RTM_PUSH_ACTIONS).toContain('agent_conflict_warning');
  });
});
