/**
 * A crawled page's knowledge (tm 312.2 · AI-17): what text is kept, in what
 * shape, and what else a page says about itself.
 */
import { describe, expect, it } from 'vitest';
import { chunk } from '@siyahtus/ai-mock';
import {
  decodeHtmlBytes,
  extractPage,
  MARKUP_MAX_DEPTH,
  NEEDS_JS_TEXT_CHARS,
  PAGE_TITLE_MAX_CHARS,
  PageExtractError,
} from './extract.js';

const PAGE = 'https://example.com/yardim/bonus';
const filler = 'Bu metin sayfanın asıl içeriğidir ve yeterince uzundur. '.repeat(6);

describe('extractPage — the content a visitor reads, with its structure (FR-MOD-06.3.2)', () => {
  it('drops scripts, styles, navigation, page chrome, forms and cookie banners', () => {
    const html = `<!doctype html><html lang="tr-TR"><head><title> Bonus  Kuralları </title>
      <style>.x{color:red}</style><script>var secret = 'tracking';</script></head>
      <body>
        <header><a href="/">Logo</a> Site başlığı</header>
        <nav><a href="/yardim">Yardım</a> <a href="/bonus">Bonuslar</a></nav>
        <div id="cookie-banner">Çerezleri kabul ediyor musunuz? <button>Kabul</button></div>
        <div class="kvkk-popup">KVKK aydınlatma uyarısı</div>
        <div id="onetrust-consent-sdk">Consent vendor</div>
        <p>Hoş geldin bonusu ilk yatırımda verilir.</p>
        <form action="/ara"><label>Ara</label><input name="q"></form>
        <aside>Reklam alanı</aside>
        <noscript>JavaScript açın</noscript>
        <footer>© 2026 Telif</footer>
      </body></html>`;
    const page = extractPage(html, PAGE);
    expect(page.text).toBe('Hoş geldin bonusu ilk yatırımda verilir.');
    expect(page.title).toBe('Bonus Kuralları');
    expect(page.lang).toBe('tr');
  });

  it('keeps a page that a form wraps whole, the way ASP.NET WebForms pages are', () => {
    const html = `<body><form id="aspnetForm"><input type="hidden" name="__VIEWSTATE" value="x">
      <h1>Ödeme yöntemleri</h1><p>Havale ve kripto ile ödeme yapılabilir.</p></form></body>`;
    expect(extractPage(html, PAGE).text).toBe(
      '# Ödeme yöntemleri\nHavale ve kripto ile ödeme yapılabilir.',
    );
  });

  it('keeps a cookie-policy page’s own content', () => {
    const html =
      '<body><div class="cookie-policy-content"><p>Çerez politikamız şöyledir.</p></div></body>';
    expect(extractPage(html, PAGE).text).toBe('Çerez politikamız şöyledir.');
  });

  it('prefers <main>, then a lone <article>, and keeps an article’s own header', () => {
    const withMain = `<body><div>Kenar metni ${filler}</div><main><h2>Ana</h2><p>${filler}</p></main></body>`;
    expect(extractPage(withMain, PAGE).text.startsWith('## Ana\n')).toBe(true);
    expect(extractPage(withMain, PAGE).text).not.toContain('Kenar metni');

    const withArticle = `<body><p>Dış ${filler}</p><article><header><h1>Başlık</h1></header><p>${filler}</p><footer>Yazar: Ece</footer></article></body>`;
    const text = extractPage(withArticle, PAGE).text;
    expect(text.startsWith('# Başlık\n')).toBe(true);
    expect(text).toContain('Yazar: Ece');
    expect(text).not.toContain('Dış');
  });

  it('falls back to the body when the chosen part says less', () => {
    const html = `<body><main><p>Kısa.</p></main><div><p>${filler}</p></div></body>`;
    expect(extractPage(html, PAGE).text).toContain('asıl içeriğidir');
  });

  it('writes headings as #, ##, ### lines kept on the line above their paragraph', () => {
    const html = '<body><h1>Bir</h1><p>a</p><h2>İki</h2><p>b</p><h4>Dört</h4><p>c</p></body>';
    expect(extractPage(html, PAGE).text).toBe('# Bir\na\n\n## İki\nb\n\n### Dört\nc');
  });

  it('writes list items as - lines, nested ones indented, one list one block', () => {
    const html = `<body><p>Koşullar:</p><ul><li>18 yaş üstü</li><li>Tek hesap<ul><li>aynı IP</li></ul></li></ul>
      <ol><li><p>Birinci</p><p>devamı</p></li></ol></body>`;
    expect(extractPage(html, PAGE).text).toBe(
      'Koşullar:\n\n- 18 yaş üstü\n- Tek hesap\n  - aynı IP\n\n- Birinci\n  devamı',
    );
  });

  it('writes a table as | a | b | rows, a header row underlined, so a bonus keeps its numbers', () => {
    const html = `<body><table>
      <thead><tr><th>Bonus</th><th>Oran</th><th>Çevrim</th></tr></thead>
      <tbody><tr><td>Hoş geldin</td><td>%100</td><td>35x</td></tr>
      <tr><td>Kayıp | iade</td><td>%10</td><td><p>yok</p><br>ama</td></tr>
      <tr><td></td><td></td></tr></tbody></table><p>Sonraki paragraf</p></body>`;
    const text = extractPage(html, PAGE).text;
    expect(text).toBe(
      [
        '| Bonus | Oran | Çevrim |',
        '| --- | --- | --- |',
        '| Hoş geldin | %100 | 35x |',
        '| Kayıp \\| iade | %10 | yok ama |',
        '',
        'Sonraki paragraf',
      ].join('\n'),
    );
    // The chunker splits on blank lines only: the table stays one chunk.
    expect(chunk(text)[0]).toContain('| Hoş geldin | %100 | 35x |');
    expect(chunk(text)[0]).toContain('| Bonus | Oran | Çevrim |');
  });

  it('flattens a table nested in a cell into the cell', () => {
    const html =
      '<body><table><tr><td>Dış</td><td><table><tr><td>iç1</td><td>iç2</td></tr></table></td></tr></table></body>';
    expect(extractPage(html, PAGE).text).toBe('| Dış | iç1 iç2 |');
  });

  it('keeps <pre> as written and collapses whitespace elsewhere, <br> a line break', () => {
    const html = '<body><p>a   b\n\tc<br>d</p><pre>  satır 1\n    satır 2\n</pre></body>';
    expect(extractPage(html, PAGE).text).toBe('a b c\nd\n\n  satır 1\n    satır 2');
  });

  it('keeps the collapsed answers of a FAQ', () => {
    const html =
      '<body><details><summary>Çekim ne kadar sürer?</summary><p>24 saat.</p></details><div hidden><p>Gizli cevap</p></div></body>';
    expect(extractPage(html, PAGE).text).toBe('Çekim ne kadar sürer?\n\n24 saat.\n\nGizli cevap');
  });

  it('decodes entities the way a browser does', () => {
    expect(
      extractPage('<body><p>A &amp; B &lt;3 &nbsp;&#x130;&ccedil;</p></body>', PAGE).text,
    ).toBe('A & B <3 İç');
  });

  it('marks a script-drawn page needs_js, and a short plain page not', () => {
    const spa = '<html><body><div id="root"></div><script src="/a.js"></script></body></html>';
    expect(extractPage(spa, PAGE).needsJs).toBe(true);
    const scripted = `<body><p>Yükleniyor</p>${'<script>x()</script>'.repeat(3)}</body>`;
    expect(extractPage(scripted, PAGE).needsJs).toBe(true);
    expect(extractPage('<body><p>Kısa ama gerçek.</p></body>', PAGE).needsJs).toBe(false);
    const long = `<body><p>${'a'.repeat(NEEDS_JS_TEXT_CHARS)}</p>${'<script></script>'.repeat(9)}</body>`;
    expect(extractPage(long, PAGE).needsJs).toBe(false);
  });

  it('finds the title in <title>, else the first <h1>, clipped to the column', () => {
    expect(extractPage('<body><h1>Yalnız başlık</h1></body>', PAGE).title).toBe('Yalnız başlık');
    expect(extractPage('<body><p>x</p></body>', PAGE).title).toBeNull();
    const long = extractPage(`<title>${'t'.repeat(900)}</title>`, PAGE).title!;
    expect(long).toHaveLength(PAGE_TITLE_MAX_CHARS);
  });

  it('reads only a primary language subtag', () => {
    expect(extractPage('<html lang="EN-us"><body></body></html>', PAGE).lang).toBe('en');
    expect(extractPage('<html lang="x-klingon"><body></body></html>', PAGE).lang).toBeNull();
    expect(extractPage('<html><body></body></html>', PAGE).lang).toBeNull();
  });

  it('resolves the canonical and every link against <base href>, http(s) only, once each', () => {
    const html = `<html><head><base href="https://example.com/yardim/"><link rel="Canonical" href="bonus?ref=x"></head>
      <body><nav><a href="sss">SSS</a></nav><a href="/odeme#ust">Ödeme</a><a href="/odeme">Ödeme</a>
      <a href="mailto:a@example.com">Mail</a><a href="javascript:void(0)">x</a><a href="#top">üst</a>
      <a href="tel:+90">tel</a><map><area href="https://other.example/x"></map>
      <svg><a href="https://svg.example/">svg</a></svg></body></html>`;
    const page = extractPage(html, PAGE);
    expect(page.canonical).toBe('https://example.com/yardim/bonus?ref=x');
    expect(page.links).toEqual([
      'https://example.com/yardim/sss',
      'https://example.com/odeme',
      'https://other.example/x',
    ]);
  });

  it('follows a meta refresh like a link, and reads meta robots', () => {
    const html =
      '<head><meta http-equiv="refresh" content="0; URL=\'/yeni\'"><meta name="robots" content="noindex, nofollow"></head>';
    const page = extractPage(html, PAGE);
    expect(page.links).toEqual(['https://example.com/yeni']);
    expect(page.noindex).toBe(true);
    expect(page.nofollow).toBe(true);
    expect(extractPage('<meta name="SiyahTusBot" content="none">', PAGE).noindex).toBe(true);
  });

  it('reads markup nested up to the depth limit, iteratively', () => {
    const depth = MARKUP_MAX_DEPTH;
    const html = `<body>${'<div>'.repeat(depth)}derin${'</div>'.repeat(depth)}</body>`;
    expect(extractPage(html, PAGE).text).toBe('derin');
  });

  it('refuses markup nested past the limit before parsing it, in linear time', () => {
    const cases = [
      `<body>${'<div>'.repeat(100_000)}derin`,
      // End tags that close nothing open do not make it shallower.
      `<body>${'<div></span>'.repeat(100_000)}`,
      `<body>${'<b id=x>'.repeat(MARKUP_MAX_DEPTH + 1)}`,
      `<body>${'<ul><li>'.repeat(MARKUP_MAX_DEPTH + 1)}`,
    ];
    for (const html of cases) {
      const started = process.cpuUsage();
      expect(() => extractPage(html, PAGE)).toThrow(PageExtractError);
      const { user, system } = process.cpuUsage(started);
      expect((user + system) / 1000).toBeLessThan(2000);
    }
    try {
      extractPage(cases[0]!, PAGE);
    } catch (error) {
      expect((error as PageExtractError).code).toBe('markup_too_deep');
    }
  });

  it('does not count what never nests: void elements, siblings that close each other, raw text', () => {
    const many = MARKUP_MAX_DEPTH * 4;
    const html = `<body><ul>${'<li>madde'.repeat(many)}</ul><p>${'<br><img src=x>'.repeat(many)}</p>
      ${'<p>paragraf'.repeat(many)}<svg>${'<path d="M0"/>'.repeat(many)}</svg>
      <script>${'<div>'.repeat(many)}</script><!-- ${'<div>'.repeat(many)} --></body>`;
    const page = extractPage(html, PAGE);
    expect(page.text.startsWith('- madde\n- madde')).toBe(true);
  });

  it('extracts a 5 MB page in linear time', () => {
    const row = '<tr><td>a</td><td>b &amp; c</td></tr>';
    const html = `<body><table>${row.repeat(Math.floor((5 * 1024 * 1024) / row.length))}</table></body>`;
    const started = process.cpuUsage();
    const page = extractPage(html, PAGE);
    const { user, system } = process.cpuUsage(started);
    expect(page.text.startsWith('| a | b & c |')).toBe(true);
    expect((user + system) / 1000).toBeLessThan(15_000);
  });
});

describe('decodeHtmlBytes — the page’s own charset (FR-MOD-06.3.2)', () => {
  // "Şağlık" in windows-1254: Ş = 0xDE, ğ = 0xF0, ı = 0xFD.
  const turkish = Buffer.from([0x3c, 0x70, 0x3e, 0xde, 0x61, 0xf0, 0x6c, 0xfd, 0x6b]);

  it('reads the Content-Type charset', () => {
    expect(decodeHtmlBytes(turkish, 'text/html; charset=windows-1254')).toBe('<p>Şağlık');
    expect(decodeHtmlBytes(turkish, 'text/html; charset="ISO-8859-9"')).toBe('<p>Şağlık');
  });

  it('reads a <meta charset> when the header says none', () => {
    const meta = Buffer.concat([Buffer.from('<meta charset="windows-1254">'), turkish]);
    expect(decodeHtmlBytes(meta, 'text/html')).toBe('<meta charset="windows-1254"><p>Şağlık');
    const httpEquiv = Buffer.concat([
      Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-9">'),
      turkish,
    ]);
    expect(decodeHtmlBytes(httpEquiv, null)).toContain('Şağlık');
  });

  it('lets a byte-order mark win, and falls back to UTF-8 for an unknown charset', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('İç', 'utf8')]);
    expect(decodeHtmlBytes(bom, 'text/html; charset=windows-1254')).toBe('İç');
    expect(decodeHtmlBytes(Buffer.from('İç', 'utf8'), 'text/html; charset=x-nonsense')).toBe('İç');
    expect(decodeHtmlBytes(Buffer.from('İç', 'utf8'), null)).toBe('İç');
  });
});
