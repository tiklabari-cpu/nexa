/**
 * `safeHref` — a visitor-supplied address is a link only when it is an
 * absolute http(s) URL (tm 451).
 */
import { describe, expect, it } from 'vitest';
import { safeHref } from './safe-href.js';

describe('safeHref', () => {
  it('passes an http or https address through unchanged', () => {
    expect(safeHref('https://shop.example/bikes?x=1#top')).toBe(
      'https://shop.example/bikes?x=1#top',
    );
    expect(safeHref('http://shop.example/')).toBe('http://shop.example/');
  });

  it('refuses every other scheme, however it is spelled', () => {
    for (const value of [
      'javascript:alert(document.domain)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeHref(value), value).toBeNull();
    }
  });

  it('refuses what is not an absolute URL, and nothing at all', () => {
    expect(safeHref('/bikes')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});
