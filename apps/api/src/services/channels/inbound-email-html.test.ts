/**
 * The HTML of a received mail, made safe to keep (tm 357 · HD-02).
 *
 * The sanitiser is an allow list, so the tests are mostly the attacks it has
 * to drop — each a known way markup has run script or reached out of a mail:
 * a script element, an event handler, a `javascript:` link (also hidden
 * behind entities and control characters), an iframe, a style sheet, SVG and
 * MathML, a form, a remote image. Then what it must keep, or the "formatted
 * view" is worthless: paragraphs, emphasis, lists, tables, safe links, inline
 * images.
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeInboundHtml } from './inbound-email-html.js';

describe('sanitizeInboundHtml', () => {
  it('drops a script element with its source (HD-02)', () => {
    expect(sanitizeInboundHtml('<p>Merhaba</p><script>alert(document.cookie)</script>')).toBe(
      '<p>Merhaba</p>',
    );
  });

  it('drops every event handler, style and class', () => {
    const out = sanitizeInboundHtml(
      '<p onclick="alert(1)" onmouseover="x()" style="position:fixed" class="a" id="b">Hi</p>' +
        '<img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)">',
    );
    expect(out).toBe('<p>Hi</p><img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(out).not.toMatch(/on\w+=|style=|class=|id=/);
  });

  it('keeps only web and mail links, however the scheme is disguised', () => {
    expect(sanitizeInboundHtml('<a href="https://ornek.com/a?b=1&c=2">site</a>')).toBe(
      '<a href="https://ornek.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">site</a>',
    );
    expect(sanitizeInboundHtml('<a href="mailto:destek@ornek.com">mail</a>')).toContain(
      'href="mailto:destek@ornek.com"',
    );
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      '&#106;avascript:alert(1)',
      'java\tscript:alert(1)',
      ' \x01javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(sanitizeInboundHtml(`<a href="${href}">x</a>`), href).toBe('<a>x</a>');
    }
  });

  it('drops embedded documents, style sheets, forms and the foreign namespaces with their content', () => {
    const out = sanitizeInboundHtml(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">' +
        '<style>body{display:none}</style><svg><script>alert(1)</script></svg>' +
        '<math><mtext><script>alert(1)</script></mtext></math>' +
        '<form action="https://evil.example"><input name="pw"><button>Gönder</button>Kalan</form>' +
        '<template><script>alert(1)</script></template><noscript><img src=x></noscript>',
    );
    expect(out).toBe('Kalan');
  });

  it('parks a remote image in data-src, so it is never fetched', () => {
    expect(sanitizeInboundHtml('<img src="https://tracker.example/open.gif?u=1" alt="logo">')).toBe(
      '<img alt="logo" data-src="https://tracker.example/open.gif?u=1">',
    );
    // An image with nowhere safe to come from is dropped.
    expect(sanitizeInboundHtml('<img src="cid:image001.png">')).toBe('');
    expect(sanitizeInboundHtml('<img src="javascript:alert(1)">')).toBe('');
  });

  it('keeps the formatting a mail is made of', () => {
    const html =
      '<h2>Başlık</h2><p><b>kalın</b> <i>eğik</i> <u>altı</u></p>' +
      '<ul><li>bir</li><li>iki</li></ul>' +
      '<table border="1"><tbody><tr><td colspan="2">hücre</td></tr></tbody></table>' +
      '<blockquote>alıntı</blockquote><br><hr>';
    expect(sanitizeInboundHtml(html)).toBe(html);
  });

  it('unwraps an unknown tag but keeps its text, and escapes what it keeps', () => {
    expect(sanitizeInboundHtml('<o:p>Ofis</o:p><custom-tag>metin</custom-tag>')).toBe('Ofismetin');
    expect(sanitizeInboundHtml('<p title="a&quot;b<c">1 &lt; 2 &amp; 3</p>')).toBe(
      '<p title="a&quot;b&lt;c">1 &lt; 2 &amp; 3</p>',
    );
  });

  it('cannot be tricked into an unescaped tag by attribute or comment games', () => {
    for (const html of [
      '<p title="</p><script>alert(1)</script>">x</p>',
      '<!--<script>alert(1)</script>-->',
      '<p><!-- --><script>alert(1)</script></p>',
      '<textarea><script>alert(1)</script></textarea>',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    ]) {
      expect(sanitizeInboundHtml(html), html).not.toMatch(/<script|onerror|<img src=x/i);
    }
  });

  it('survives a mail nested ten thousand levels deep', () => {
    const deep = `${'<div>'.repeat(10_000)}derin${'</div>'.repeat(10_000)}`;
    expect(sanitizeInboundHtml(deep)).toContain('derin');
  });
});

describe('htmlToText', () => {
  it('reads blocks as lines, lists as dashes and a quote as `>`', () => {
    expect(
      htmlToText(
        '<p>Merhaba,</p><p>Dekont <b>ektedir</b>.<br>Saat 14:42.</p>' +
          '<ul><li>2.500 TL</li><li>Havale</li></ul><blockquote>eski metin</blockquote>',
      ),
    ).toBe('Merhaba,\n\nDekont ektedir.\nSaat 14:42.\n\n- 2.500 TL\n- Havale\n\n> eski metin');
  });

  it('collapses whitespace outside <pre> and keeps it inside', () => {
    expect(htmlToText('<div>a   b\n\n c</div><pre>x  y\nz</pre>')).toBe('a b c\nx  y\nz');
  });

  it('never makes text of what the sanitiser drops', () => {
    expect(
      htmlToText('<style>p{}</style><script>alert(1)</script><p>görünen</p><title>t</title>'),
    ).toBe('görünen');
  });
});
