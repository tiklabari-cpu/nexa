import { describe, expect, it } from 'vitest';
import { crawl, htmlToText, mockFetcher } from './web-crawler.js';

describe('htmlToText', () => {
  it('drops script and style bodies and strips tags', () => {
    const text = htmlToText('<p>Hello <b>there</b></p><script>steal()</script><style>a{}</style>');
    expect(text).toBe('Hello there');
    expect(text).not.toContain('steal');
    expect(text).not.toContain('a{}');
  });

  it('decodes the common entities and collapses whitespace', () => {
    expect(htmlToText('<p>Tom &amp; Jerry\n\n  say &quot;hi&quot;</p>')).toBe(
      'Tom & Jerry say "hi"',
    );
  });
});

describe('crawl (deterministic mock fetcher)', () => {
  it('is deterministic — same URL, same text', async () => {
    const url = new URL('https://example.com/help/delivery');
    const a = await crawl(url);
    const b = await crawl(url);
    expect(a.text).toBe(b.text);
    expect(a.text.length).toBeGreaterThan(0);
  });

  it('derives a title and readable text with no leftover markup', async () => {
    const result = await crawl(new URL('https://shop.example/returns-policy'));
    expect(result.title).toMatch(/returns policy/i);
    expect(result.text).toMatch(/returns are accepted/i);
    expect(result.text).not.toContain('<');
    expect(result.text).not.toContain('tracking'); // the <script> body is gone
  });

  it('passes the parsed URL to a custom fetcher', async () => {
    const seen: string[] = [];
    const fetcher = async (url: URL) => {
      seen.push(url.href);
      return { html: '<title>Custom</title><p>Body text here.</p>' };
    };
    const result = await crawl(new URL('https://example.com/x'), fetcher);
    expect(seen).toEqual(['https://example.com/x']);
    expect(result.title).toBe('Custom');
    expect(result.text).toContain('Body text here.');
  });

  it('the mock returns non-trivial content for indexing', async () => {
    const { html } = await mockFetcher(new URL('https://example.com/faq'));
    expect(htmlToText(html).length).toBeGreaterThan(50);
  });
});
