import { describe, expect, it } from 'vitest';
import { acceptLanguageLocale, headerLocale, requestLocale } from './request-locale.js';

const req = (headers: Record<string, string | string[] | undefined>) => ({ headers });

describe('which language a request reads (tm 265)', () => {
  it('takes the panel language first, whatever the browser prefers', () => {
    expect(requestLocale(req({ 'x-siyahtus-locale': 'tr', 'accept-language': 'en-US,en' }))).toBe(
      'tr',
    );
    expect(requestLocale(req({ 'x-siyahtus-locale': 'en', 'accept-language': 'tr-TR' }))).toBe(
      'en',
    );
  });

  it('falls back to the browser preference, by weight, then English', () => {
    expect(requestLocale(req({ 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' }))).toBe('tr');
    expect(requestLocale(req({ 'accept-language': 'de-DE,en;q=0.5,tr;q=0.7' }))).toBe('tr');
    expect(requestLocale(req({ 'accept-language': 'de-DE,fr' }))).toBe('en');
    expect(requestLocale(req({}))).toBe('en');
  });

  it('ignores a language the templates are not written in, and a malformed header', () => {
    expect(headerLocale('de')).toBeNull();
    expect(headerLocale('')).toBeNull();
    expect(headerLocale(['tr-TR'])).toBe('tr');
    expect(acceptLanguageLocale('tr;q=0')).toBeNull();
    expect(acceptLanguageLocale('*')).toBeNull();
    expect(requestLocale(req({ 'x-siyahtus-locale': 'xx', 'accept-language': 'tr' }))).toBe('tr');
  });
});
