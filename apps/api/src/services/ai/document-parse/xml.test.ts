/**
 * The XML scanner the DOCX reader runs on (tm 313.2 · AI-18): no document
 * type (so no entity expansion of any kind), linear time.
 */
import { describe, expect, it } from 'vitest';
import { DocumentParseError } from './types.js';
import { MAX_XML_DEPTH, decodeEntities, scanXml } from './xml.js';

type Event = ['open', string, Record<string, string>] | ['close', string] | ['text', string];

function events(xml: string | Buffer): Event[] {
  const out: Event[] = [];
  scanXml(Buffer.isBuffer(xml) ? xml : Buffer.from(xml, 'utf8'), {
    open: (name, attributes) => out.push(['open', name, { ...attributes }]),
    close: (name) => out.push(['close', name]),
    text: (text) => out.push(['text', text]),
  });
  return out;
}

function refusal(xml: string): string {
  try {
    events(xml);
  } catch (error) {
    if (error instanceof DocumentParseError) return error.detail;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('scanXml', () => {
  it('reports elements, attributes and decoded text in order', () => {
    expect(
      events(
        '<?xml version="1.0"?><!-- c --><w:p a="1 &amp; 2" b=\'x>y\'><w:t>Fish &amp; chips &lt;3 &#252;&#x15f;</w:t><w:br/></w:p>',
      ),
    ).toEqual([
      ['open', 'w:p', { a: '1 & 2', b: 'x>y' }],
      ['open', 'w:t', {}],
      ['text', 'Fish & chips <3 üş'],
      ['close', 'w:t'],
      ['open', 'w:br', {}],
      ['close', 'w:br'],
      ['close', 'w:p'],
    ]);
  });

  it('passes CDATA through untouched and reads a UTF-16 part', () => {
    expect(events('<a><![CDATA[<b>&amp;</b>]]></a>')).toEqual([
      ['open', 'a', {}],
      ['text', '<b>&amp;</b>'],
      ['close', 'a'],
    ]);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<a>ğ</a>', 'utf16le')]);
    expect(events(utf16)).toEqual([
      ['open', 'a', {}],
      ['text', 'ğ'],
      ['close', 'a'],
    ]);
  });

  it('refuses a document type — no entity is ever defined, let alone expanded', () => {
    const laughs =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>' +
      '<lolz>&lol2;</lolz>';
    expect(refusal(laughs)).toBe('xml_doctype');
    const external = '<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><x>&xxe;</x>';
    expect(refusal(external)).toBe('xml_doctype');
  });

  it('leaves an undefined entity as written', () => {
    expect(decodeEntities('a &nbsp; b &xxe; c & d')).toBe('a &nbsp; b &xxe; c & d');
    expect(decodeEntities('&#xD800; &#1114112; &#x10FFFF;')).toBe('� � \u{10FFFF}');
  });

  it('refuses malformed, unterminated and too deeply nested XML', () => {
    expect(refusal('<a><b></a></b>')).toBe('xml_mismatched_tag');
    expect(refusal('<a><b>')).toBe('xml_unterminated');
    expect(refusal('<a b="1>')).toBe('xml_unterminated');
    expect(refusal('<a b>')).toBe('xml_malformed');
    expect(() => events('<a>'.repeat(MAX_XML_DEPTH) + '</a>'.repeat(MAX_XML_DEPTH))).not.toThrow();
    expect(refusal('<a>'.repeat(MAX_XML_DEPTH + 1) + '</a>'.repeat(MAX_XML_DEPTH + 1))).toBe(
      'xml_too_deep',
    );
  });

  it('stays linear on a million ampersands with no semicolon, and on a million elements', () => {
    const started = Date.now();
    const text = events(`<a>${'&'.repeat(1_000_000)}</a>`);
    expect((text[1] as ['text', string])[1]).toHaveLength(1_000_000);
    let opened = 0;
    scanXml(Buffer.from(`<r>${'<w:r><w:t>x</w:t></w:r>'.repeat(500_000)}</r>`), {
      open: () => (opened += 1),
      close: () => {},
      text: () => {},
    });
    expect(opened).toBe(1_000_001);
    // Quadratic would be ~10^12 steps; linear is well under a second unloaded.
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
