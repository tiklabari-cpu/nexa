import { describe, expect, it } from 'vitest';
import {
  MEMBER_KEY_ROTATION_GRACE,
  MEMBER_TOKEN_COOKIE,
  MEMBER_TOKEN_TTL,
  POSSIBLE_MATCH_FIELDS,
  POSSIBLE_MATCH_LIMIT,
  isPossibleMatchField,
} from './member-recognition.js';

const DAY = 86_400;

describe('MEMBER_TOKEN_TTL (ID-03 · K4)', () => {
  it('keeps a member for at least the rest of the day and at most a year, 30 days by default', () => {
    expect(MEMBER_TOKEN_TTL).toEqual({
      defaultSeconds: 30 * DAY,
      minSeconds: DAY,
      maxSeconds: 365 * DAY,
    });
  });

  it('cannot be edited at runtime — the database CHECK holds the same bounds', () => {
    expect(Object.isFrozen(MEMBER_TOKEN_TTL)).toBe(true);
  });
});

describe('MEMBER_KEY_ROTATION_GRACE (ID-03 · K4)', () => {
  it('allows retiring the old key at once (0) and defaults to a week', () => {
    expect(MEMBER_KEY_ROTATION_GRACE.minSeconds).toBe(0);
    expect(MEMBER_KEY_ROTATION_GRACE.defaultSeconds).toBe(7 * DAY);
    expect(MEMBER_KEY_ROTATION_GRACE.maxSeconds).toBe(30 * DAY);
    expect(Object.isFrozen(MEMBER_KEY_ROTATION_GRACE)).toBe(true);
  });
});

describe('MEMBER_TOKEN_COOKIE', () => {
  it('is a valid cookie name (an RFC 6265 token), so no browser drops or rewrites it', () => {
    expect(MEMBER_TOKEN_COOKIE).toMatch(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/);
  });
});

describe('possible matches', () => {
  it('match on the pre-chat username or the e-mail, ten at most', () => {
    expect([...POSSIBLE_MATCH_FIELDS]).toEqual(['username', 'email']);
    expect(POSSIBLE_MATCH_LIMIT).toBe(10);
  });

  it('recognise exactly the listed fields', () => {
    expect(isPossibleMatchField('username')).toBe(true);
    expect(isPossibleMatchField('email')).toBe(true);
    expect(isPossibleMatchField('name')).toBe(false);
    expect(isPossibleMatchField('Username')).toBe(false);
    expect(isPossibleMatchField(undefined)).toBe(false);
  });
});
