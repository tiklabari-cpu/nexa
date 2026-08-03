import { describe, expect, it } from 'vitest';
import { renderArticleBody, renderPlainExcerpt } from './kb-render.js';

/**
 * Negatives are written and asserted first: the whole point of an escape-first
 * renderer is what it REFUSES to emit. Positives follow, once nothing dangerous
 * can get through.
 */
describe('renderArticleBody — security (nothing dangerous is emitted)', () => {
  it('never emits a script/img/iframe/style/svg tag from raw HTML input', () => {
    const cases = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<style>body{color:red}</style>',
      '<svg onload=alert(1)></svg>',
    ];
    for (const input of cases) {
      const out = renderArticleBody(input);
      expect(out).not.toContain('<script');
      expect(out).not.toContain('<img');
      expect(out).not.toContain('<iframe');
      expect(out).not.toContain('<style');
      expect(out).not.toContain('<svg');
      // The angle brackets came back as inert, escaped text.
      expect(out).toContain('&lt;');
      expect(out).toContain('&gt;');
    }
  });

  it('rejects non-http(s) link schemes — the link falls back to plain text', () => {
    const bad = [
      '[x](javascript:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](vbscript:msgbox(1))',
      '[x](//evil.example)',
      '[x](/relative/path)',
    ];
    for (const input of bad) {
      const out = renderArticleBody(input);
      expect(out).not.toContain('<a ');
      expect(out).not.toContain('<script');
    }
  });

  it('does not decode nested/double encoding back into a tag', () => {
    expect(renderArticleBody('&lt;script&gt;alert(1)&lt;/script&gt;')).not.toContain('<script');
    // the leading & was itself escaped, proving we escape and never decode
    expect(renderArticleBody('&lt;script&gt;')).toContain('&amp;lt;script&amp;gt;');
    expect(renderArticleBody('&#60;script&#62;')).not.toContain('<script');
    expect(renderArticleBody('%3Cscript%3E')).not.toContain('<script');
    expect(renderArticleBody('%3Cscript%3E')).toContain('%3Cscript%3E');
  });

  it('cannot be tricked into breaking out of the href attribute or the anchor tag', () => {
    // A quote/onmouseover buried in the LINK TEXT stays inert text, not an attribute.
    const text = renderArticleBody('[click"onmouseover=alert(1)](https://safe.example)');
    expect(text).toContain('<a href="https://safe.example"');
    expect(text).toContain('&quot;onmouseover');
    expect(text).not.toContain('"onmouseover'); // no raw quote closed the attribute

    // Angle brackets/quotes in an ALLOWED (https) URL are escaped, so even a valid
    // scheme cannot smuggle a tag or an attribute break out of the href.
    const url = renderArticleBody('[x](https://safe.example/"><script>alert(1)</script>)');
    expect(url).not.toContain('<script');
    expect(url).not.toContain('"><');
    expect(url).toContain('href="https://safe.example/&quot;&gt;&lt;script&gt;alert(1"');
  });

  it('has no catastrophic backtracking on large or degenerate input (time-bounded)', () => {
    const inputs = [
      '**' + 'a'.repeat(80_000), // unclosed bold
      '`'.repeat(80_000), // run of backticks
      '*'.repeat(80_000), // run of stars
      '[x]('.repeat(20_000), // many partial links
      '['.repeat(80_000), // run of open brackets
    ];
    for (const input of inputs) {
      const start = performance.now();
      renderArticleBody(input);
      renderPlainExcerpt(input);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });

  it('bounds work and output for very long input', () => {
    const out = renderArticleBody('word '.repeat(50_000)); // 250k chars, over the cap
    // Output stays bounded (cap + a constant escape/markup factor), not unbounded.
    expect(out.length).toBeLessThan(400_000);
  });
});

describe('renderArticleBody — KK validation (task acceptance)', () => {
  it('(1) `## Başlık` renders as an <h2> and keeps non-ASCII prose', () => {
    const out = renderArticleBody('## Başlık');
    expect(out).toBe('<h2>Başlık</h2>');
  });

  it('(2) `<script>alert(1)</script>` appears escaped, never as a tag', () => {
    const out = renderArticleBody('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script');
  });

  it('(3) `[x](javascript:alert(1))` produces no link, falls to plain text', () => {
    const out = renderArticleBody('[x](javascript:alert(1))');
    expect(out).not.toContain('<a ');
    expect(out).toContain('[x](javascript:');
  });

  it('(4) renderPlainExcerpt output contains no `<` character', () => {
    const out = renderPlainExcerpt('<script>alert(1)</script> intro text');
    expect(out).not.toContain('<');
  });
});

describe('renderArticleBody — formatting (positive)', () => {
  it('renders `##` and `###` headings', () => {
    expect(renderArticleBody('## Title')).toBe('<h2>Title</h2>');
    expect(renderArticleBody('### Subtitle')).toBe('<h3>Subtitle</h3>');
  });

  it('renders a paragraph, soft-wrapping single newlines with a space', () => {
    expect(renderArticleBody('Hello world')).toBe('<p>Hello world</p>');
    expect(renderArticleBody('Line one\nLine two')).toBe('<p>Line one Line two</p>');
    expect(renderArticleBody('A\n\nB')).toBe('<p>A</p>\n<p>B</p>');
  });

  it('renders a `-` list as a single <ul>', () => {
    expect(renderArticleBody('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders bold and inline code', () => {
    expect(renderArticleBody('this is **bold** text')).toBe('<p>this is <strong>bold</strong> text</p>');
    expect(renderArticleBody('run `npm test` now')).toBe('<p>run <code>npm test</code> now</p>');
  });

  it('renders an http(s) link with a nofollow/noopener/ugc rel', () => {
    expect(renderArticleBody('[docs](https://example.com/help)')).toBe(
      '<p><a href="https://example.com/help" rel="nofollow noopener ugc">docs</a></p>',
    );
  });

  it('escapes an ampersand inside a link URL (valid attribute encoding)', () => {
    const out = renderArticleBody('[q](https://x.example/?a=1&b=2)');
    expect(out).toContain('href="https://x.example/?a=1&amp;b=2"');
  });

  it('applies inline formatting inside a heading', () => {
    expect(renderArticleBody('## See **this**')).toBe('<h2>See <strong>this</strong></h2>');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(renderArticleBody('')).toBe('');
    expect(renderArticleBody('   \n\n  ')).toBe('');
  });

  it('is deterministic — the same input yields the same output', () => {
    const input = '## Heading\n\nBody with **bold**, `code` and [a](https://x.example).\n\n- item';
    expect(renderArticleBody(input)).toBe(renderArticleBody(input));
  });
});

describe('renderPlainExcerpt', () => {
  it('strips markdown markers down to plain prose', () => {
    const out = renderPlainExcerpt(
      '## Title\n\nSome **bold** body with a [link](https://x.example) and `code`.',
    );
    expect(out).toBe('Title Some bold body with a link and code.');
    expect(out).not.toContain('#');
    expect(out).not.toContain('**');
    expect(out).not.toContain('[');
  });

  it('removes tag-like spans and every angle bracket', () => {
    const out = renderPlainExcerpt('<script>alert(1)</script>Hello <b>world</b>');
    expect(out).not.toContain('<');
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('never leaves a `<` in the output, whatever the input', () => {
    for (const nasty of ['<script>', '<<<', 'a<b', '[x](javascript:<)', '<img onerror=x>']) {
      expect(renderPlainExcerpt(nasty)).not.toContain('<');
    }
  });

  it('truncates on a word boundary with an ellipsis', () => {
    const out = renderPlainExcerpt('word '.repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('<');
  });

  it('returns an empty string for empty input', () => {
    expect(renderPlainExcerpt('')).toBe('');
  });
});
