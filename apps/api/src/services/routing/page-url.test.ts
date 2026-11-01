/**
 * The comparison form of a page address for a routing rule's "URL is exactly"
 * condition (AU-02 · tm 373 · AU-02-S1).
 */
import { describe, expect, it } from 'vitest';
import { normalisePageUrl, normalisePageUrls } from './page-url.js';

describe('normalisePageUrl', () => {
  it('lower-cases scheme and host, keeps the path as written', () => {
    expect(normalisePageUrl('HTTPS://Site.COM/TR/Para-Yatir')).toBe(
      'https://site.com/TR/Para-Yatir',
    );
  });

  it('drops the query string and the fragment', () => {
    expect(normalisePageUrl('https://site.com/tr/para-yatir?utm_source=a&b=1#top')).toBe(
      'https://site.com/tr/para-yatir',
    );
    expect(normalisePageUrl('https://site.com/tr#x')).toBe('https://site.com/tr');
  });

  it('treats a trailing slash as no trailing slash, also on the bare host', () => {
    expect(normalisePageUrl('https://site.com/tr/')).toBe('https://site.com/tr');
    expect(normalisePageUrl('https://site.com/')).toBe('https://site.com');
    expect(normalisePageUrl('https://site.com')).toBe('https://site.com');
    expect(normalisePageUrl('https://site.com/?a=1')).toBe('https://site.com');
  });

  it('drops a default port and credentials, keeps a real port', () => {
    expect(normalisePageUrl('https://site.com:443/a')).toBe('https://site.com/a');
    expect(normalisePageUrl('https://user:pw@site.com:8443/a')).toBe('https://site.com:8443/a');
  });

  it('does not equate different pages', () => {
    expect(normalisePageUrl('https://site.com/a')).not.toBe(normalisePageUrl('https://site.com/b'));
    expect(normalisePageUrl('http://site.com/a')).not.toBe(normalisePageUrl('https://site.com/a'));
    expect(normalisePageUrl('https://site.com/A')).not.toBe(normalisePageUrl('https://site.com/a'));
  });

  it('falls back to stripping query, fragment and trailing slash when there is no scheme', () => {
    expect(normalisePageUrl('  site.com/tr/?x=1#y ')).toBe('site.com/tr');
    expect(normalisePageUrl('/pricing/')).toBe('/pricing');
  });
});

describe('normalisePageUrls', () => {
  it('normalises, de-duplicates and drops blanks', () => {
    expect(
      normalisePageUrls([
        'https://Site.com/a/',
        'https://site.com/a?x=1',
        '  ',
        'https://site.com/b',
      ]),
    ).toEqual(['https://site.com/a', 'https://site.com/b']);
  });
});
