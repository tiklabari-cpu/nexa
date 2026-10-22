import { describe, expect, it } from 'vitest';
import { capabilitiesForRole } from '@siyahtus/types';
import type { AgentPrincipal, BotPrincipal } from '../auth/principal.js';
import { maskPlayerContact, redactPlayerContact, seesPlayerContact } from './player-contact.js';

function agent(value: 'on' | 'off'): AgentPrincipal {
  return {
    kind: 'agent',
    accountId: '00000000-0000-4000-8000-000000000001',
    licenseId: 1n,
    organizationId: '00000000-0000-4000-8000-000000000002',
    role: 'agent',
    scopes: ['customers:ro'],
    capabilities: capabilitiesForRole('agent', [
      { role: 'agent', capability: 'customers.contact.view', value },
    ]),
    tokenId: 't',
    tokenKind: 'oauth',
  };
}

describe('seesPlayerContact', () => {
  it('reads the person’s resolved capability, on by default', () => {
    expect(
      seesPlayerContact({ ...agent('on'), capabilities: capabilitiesForRole('agent', []) }),
    ).toBe(true);
    expect(seesPlayerContact(agent('on'))).toBe(true);
    expect(seesPlayerContact(agent('off'))).toBe(false);
  });

  it('refuses a snapshot that does not answer — a check that cannot be read masks', () => {
    const principal = agent('on');
    const { 'customers.contact.view': _gone, ...rest } = principal.capabilities;
    expect(
      seesPlayerContact({ ...principal, capabilities: rest as typeof principal.capabilities }),
    ).toBe(false);
  });

  it('leaves a bot to its scopes: it belongs to no role', () => {
    const bot: BotPrincipal = {
      kind: 'bot',
      botId: 'b',
      licenseId: 1n,
      organizationId: 'o',
      scopes: ['customers:ro'],
      tokenId: 't',
      tokenKind: 'bot',
    };
    expect(seesPlayerContact(bot)).toBe(true);
  });
});

describe('maskPlayerContact', () => {
  it('nulls email and username, and only them', () => {
    const row = { id: 'c', name: 'Ali', email: 'ali@x.test', username: 'ali123', phone: '1' };
    expect(maskPlayerContact(row, true)).toBe(row);
    expect(maskPlayerContact(row, false)).toEqual({ ...row, email: null, username: null });
  });

  it('adds no username to a shape that has none', () => {
    expect(maskPlayerContact({ customer_id: 'c', email: 'a@x.test' }, false)).toEqual({
      customer_id: 'c',
      email: null,
    });
  });
});

describe('redactPlayerContact', () => {
  it('blanks every occurrence, whatever its case, and treats the value as text', () => {
    const text = 'Oyuncu: kullanıcı adı "a.b+1" · Ali · ALI@X.test (ali@x.test)';
    expect(redactPlayerContact(text, ['a.b+1', 'ali@x.test', null, ' '], false)).toBe(
      'Oyuncu: kullanıcı adı "•••" · Ali · ••• (•••)',
    );
    expect(redactPlayerContact(text, ['ali@x.test'], true)).toBe(text);
    // `.` and `+` are not patterns: "axb1" is not "a.b+1".
    expect(redactPlayerContact('axbb1', ['a.b+1'], false)).toBe('axbb1');
  });
});
