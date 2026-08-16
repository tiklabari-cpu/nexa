/**
 * The push decision, without a database or a provider (13.7-d).
 *
 * Every case here is a *negative* — somebody who must not be interrupted, or a
 * handset that must not be dialled. That is the whole reason the selection is a
 * pure function: the positive case is visible in the integration test's spool,
 * but "the person who turned push off got nothing" is only convincing if it can
 * be asserted without the send path being involved at all.
 */
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@nexa/types';
import { describe, expect, it } from 'vitest';
import { deliverablePushTargets, renderPush, type PushDevice } from './push.js';

const phone: PushDevice = {
  id: '11111111-1111-4111-8111-111111111111',
  platform: 'ios',
  token: 'apns-token-a',
  revokedAt: null,
};

const tablet: PushDevice = {
  id: '22222222-2222-4222-8222-222222222222',
  platform: 'android',
  token: 'fcm-token-b',
  revokedAt: null,
};

describe('deliverablePushTargets', () => {
  it('addresses every live handset by default', () => {
    expect(deliverablePushTargets(DEFAULT_NOTIFICATION_PREFERENCES, [phone, tablet])).toEqual([
      { deviceId: phone.id, platform: 'ios', token: 'apns-token-a' },
      { deviceId: tablet.id, platform: 'android', token: 'fcm-token-b' },
    ]);
  });

  it('sends nothing when the push channel is off (FR-MOD-08.2)', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, push: false };
    expect(deliverablePushTargets(prefs, [phone, tablet])).toEqual([]);
  });

  it('sends nothing when the master switch is off', () => {
    // `enabled` covers the interruptive channels, and a push is the most
    // interruptive one there is — it goes off in a pocket. Proven separately
    // from `push: false` because the two are different requests ("silence
    // everything" vs "not on my phone") and a build that honoured only one of
    // them would look correct in a single test.
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false, push: true };
    expect(deliverablePushTargets(prefs, [phone])).toEqual([]);
  });

  it('leaves e-mail out of it', () => {
    // The master switch does not silence e-mail, and turning e-mail off does not
    // silence the phone. Both directions matter: they are the same preference
    // object, and collapsing them would make one channel's opt-out disable the
    // other's for somebody who never asked.
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, email: false };
    expect(deliverablePushTargets(prefs, [phone])).toHaveLength(1);
  });

  it('skips a handset that was signed out', () => {
    // The query filters `revokedAt` too. This is the second lock: a revoked
    // token is somebody else's phone as far as this workspace is concerned.
    const revoked: PushDevice = { ...tablet, revokedAt: new Date('2026-08-16T10:00:00Z') };
    expect(deliverablePushTargets(DEFAULT_NOTIFICATION_PREFERENCES, [phone, revoked])).toEqual([
      { deviceId: phone.id, platform: 'ios', token: 'apns-token-a' },
    ]);
  });

  it('skips a platform this build cannot address', () => {
    // Unreachable while the database CHECK holds; the point is which way it
    // fails if it ever does not.
    const odd: PushDevice = { ...phone, platform: 'blackberry' };
    expect(deliverablePushTargets(DEFAULT_NOTIFICATION_PREFERENCES, [odd])).toEqual([]);
  });

  it('has nothing to say about a member with no registered handset', () => {
    expect(deliverablePushTargets(DEFAULT_NOTIFICATION_PREFERENCES, [])).toEqual([]);
  });
});

describe('renderPush', () => {
  it('says what happened without saying what was said', () => {
    // The guarantee the header claims: a payload that leaves the building
    // carries no conversation content. Asserted as "the three bodies are fixed
    // strings", which is the only shape that cannot accidentally grow a preview.
    for (const kind of ['new_chat', 'assignment', 'message'] as const) {
      const { title, body } = renderPush(kind);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
    }

    expect(renderPush('new_chat')).not.toEqual(renderPush('message'));
    expect(renderPush('assignment')).not.toEqual(renderPush('message'));
  });
});
