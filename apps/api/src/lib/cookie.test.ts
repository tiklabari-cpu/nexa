import { describe, expect, it } from 'vitest';
import { cookieNames, readCookie, serializeCookie } from './cookie.js';

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('a=1; siyahtus_member=nxm1.1.b.s; c=3', 'siyahtus_member')).toBe(
      'nxm1.1.b.s',
    );
  });

  it('takes the first of two with the same name — the one with the longer path', () => {
    expect(readCookie('m=first; m=second', 'm')).toBe('first');
  });

  it('does not match a name that only ends the same way', () => {
    expect(readCookie('old_siyahtus_member=x', 'siyahtus_member')).toBeNull();
  });

  it('strips the quotes a value may be wrapped in', () => {
    expect(readCookie('m="v"', 'm')).toBe('v');
  });

  it('reads a header split across lines, and treats an empty value as none', () => {
    expect(readCookie(['a=1', 'm=v'], 'm')).toBe('v');
    expect(readCookie('m=', 'm')).toBeNull();
    expect(readCookie(undefined, 'm')).toBeNull();
    expect(readCookie('garbage', 'm')).toBeNull();
  });
});

describe('cookieNames', () => {
  it('lists every name once, in order, and never a value', () => {
    expect(cookieNames('a=1; siyahtus_member_x=t; a=2; b="q=r"')).toEqual([
      'a',
      'siyahtus_member_x',
      'b',
    ]);
  });

  it('reads a header split across lines and skips what is not a pair', () => {
    expect(cookieNames(['a=1', 'garbage; =v; b=2'])).toEqual(['a', 'b']);
    expect(cookieNames(undefined)).toEqual([]);
    expect(cookieNames('')).toEqual([]);
  });
});

describe('serializeCookie', () => {
  it('writes the member cookie the contract describes', () => {
    expect(
      serializeCookie('siyahtus_member', 'nxm1.1.b.s', {
        maxAgeSeconds: 2_592_000,
        path: '/api/v1/customer/token',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
        partitioned: true,
      }),
    ).toBe(
      'siyahtus_member=nxm1.1.b.s; Max-Age=2592000; Path=/api/v1/customer/token; Secure; HttpOnly; SameSite=None; Partitioned',
    );
  });

  it('refuses a value a cookie cannot carry, rather than writing a second header into it', () => {
    expect(() => serializeCookie('m', 'a;b', { maxAgeSeconds: 1, path: '/' })).toThrow();
    expect(() =>
      serializeCookie('m', 'a\r\nSet-Cookie: x=y', { maxAgeSeconds: 1, path: '/' }),
    ).toThrow();
    expect(() => serializeCookie('bad name', 'v', { maxAgeSeconds: 1, path: '/' })).toThrow();
  });
});
