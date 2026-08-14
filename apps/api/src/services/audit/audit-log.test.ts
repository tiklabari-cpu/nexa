import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, sanitizeAuditMetadata } from './audit-log.js';

describe('sanitizeAuditMetadata', () => {
  it('drops any key that looks like a credential', () => {
    // The callers never pass these; this is the backstop for a future refactor
    // that spreads a request body into metadata by accident.
    const clean = sanitizeAuditMetadata({
      role: 'admin',
      password: 'hunter2',
      password_hash: 'abc',
      access_token: 'nxc1.secret',
      client_secret: 'shh',
      refresh_token: 'r',
      code_verifier: 'v',
      authorization: 'Bearer x',
      cookie: 'sid=1',
      // Telegram's connect body (`08.5.8-b`) — caught by the same generic
      // `token` match, no adapter-specific rule needed.
      bot_token: 'nxc1.telegram-secret',
    });
    expect(clean).toEqual({ role: 'admin' });
  });

  it('keeps the correlation id, which is not a credential', () => {
    expect(sanitizeAuditMetadata({ request_id: 'req-1' })).toEqual({ request_id: 'req-1' });
  });

  it('keeps the SCIM credential id — the only way a connector entry names an actor', () => {
    // A provisioning connector is recorded as `system` with a null actor_id
    // (plugins/audit.ts), so without this the trail cannot say which of a
    // workspace's several live credentials suspended somebody.
    expect(sanitizeAuditMetadata({ scim_token_id: 'tok-1', role: 'agent' })).toEqual({
      scim_token_id: 'tok-1',
      role: 'agent',
    });
  });

  it('exempts those two names only, not everything that looks like an id', () => {
    // The allow-list is a list of names, not a loosening of the pattern: a key
    // nobody has thought about is still dropped.
    expect(
      sanitizeAuditMetadata({
        scim_token: 'nxc1.secret',
        token_id: 'guessed',
        oauth_token_id: 'guessed',
        password_id: 'guessed',
      }),
    ).toEqual({});
  });

  it('omits undefined values rather than storing null holes', () => {
    expect(sanitizeAuditMetadata({ present: 1, absent: undefined })).toEqual({ present: 1 });
  });

  it('treats missing metadata as an empty object', () => {
    expect(sanitizeAuditMetadata(undefined)).toEqual({});
  });

  it('preserves non-sensitive arrays and scalars', () => {
    expect(sanitizeAuditMetadata({ fields: ['a', 'b'], count: 2 })).toEqual({
      fields: ['a', 'b'],
      count: 2,
    });
  });
});

describe('AUDIT_ACTIONS', () => {
  it('is a closed vocabulary with no duplicates', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('records both webhook change actions NFR-S12 names by hand', () => {
    // "webhook değişimi" is one of the four events the requirement enumerates,
    // registration and removal being the changes a webhook actually undergoes.
    expect(AUDIT_ACTIONS).toContain('webhook.created');
    expect(AUDIT_ACTIONS).toContain('webhook.deleted');
  });

  it('records the targeted-delete action NFR-S12 names by hand', () => {
    // "veri silme" is one of the four events the requirement enumerates.
    expect(AUDIT_ACTIONS).toContain('data.deleted');
  });

  it('records the role-change action NFR-S12 names by hand', () => {
    // "rol değişimi" is one of the four events the requirement enumerates.
    expect(AUDIT_ACTIONS).toContain('member.role_changed');
  });
});
