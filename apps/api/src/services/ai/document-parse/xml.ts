/**
 * A small XML scanner for the parts of a Word document (tm 313.2 · AI-18) —
 * not a general XML parser, and deliberately so.
 *
 * OOXML parts are plain XML with no document type, so the features that make
 * XML parsers dangerous have no use here and are refused rather than
 * supported: a `<!DOCTYPE` (and with it every entity definition, external
 * entity and billion-laughs expansion) is `parse_failed`. Character
 * references and the five predefined entities are decoded; any other `&name;`
 * is left as written.
 *
 * It walks the bytes once with `indexOf`, never a backtracking expression, so
 * time is linear in the part's size; only text and attribute values are
 * decoded to strings, so memory is the part's bytes plus what the handler
 * keeps. Nesting is capped: depth is the one thing a hostile file could grow
 * without growing the file much.
 */
import { DocumentParseError } from './types.js';

export interface XmlHandler {
  open(name: string, attributes: Readonly<Record<string, string>>, selfClosing: boolean): void;
  close(name: string): void;
  text(text: string): void;
}

/** Deeper than any Word document nests (tables in tables in text boxes run to a few dozen). */
export const MAX_XML_DEPTH = 512;

const LT = 0x3c;
const GT = 0x3e;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const SLASH = 0x2f;

function refuse(detail: string): never {
  throw new DocumentParseError('parse_failed', detail);
}

/** UTF-8 bytes of `xml`, from UTF-16 when it starts with that byte-order mark, without a UTF-8 one. */
function asUtf8(xml: Buffer): Buffer {
  if (xml[0] === 0xef && xml[1] === 0xbb && xml[2] === 0xbf) return xml.subarray(3);
  if (xml[0] === 0xff && xml[1] === 0xfe) {
    return Buffer.from(new TextDecoder('utf-16le').decode(xml.subarray(2)), 'utf8');
  }
  if (xml[0] === 0xfe && xml[1] === 0xff) {
    return Buffer.from(new TextDecoder('utf-16be').decode(xml.subarray(2)), 'utf8');
  }
  return xml;
}

export function scanXml(input: Buffer, handler: XmlHandler): void {
  const xml = asUtf8(input);
  const stack: string[] = [];
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf(LT, at);
    if (lt === -1) {
      emitText(xml, at, xml.length, handler);
      break;
    }
    if (lt > at) emitText(xml, at, lt, handler);

    const next = xml[lt + 1];
    if (next === 0x3f /* ? */) {
      at = endOf(xml, '?>', lt + 2);
    } else if (next === 0x21 /* ! */) {
      if (startsWith(xml, lt, '<!--')) {
        at = endOf(xml, '-->', lt + 4);
      } else if (startsWith(xml, lt, '<![CDATA[')) {
        const end = xml.indexOf(']]>', lt + 9, 'latin1');
        if (end === -1) refuse('xml_unterminated');
        if (end > lt + 9) handler.text(xml.toString('utf8', lt + 9, end));
        at = end + 3;
      } else if (startsWith(xml, lt, '<!DOCTYPE')) {
        refuse('xml_doctype');
      } else {
        refuse('xml_malformed');
      }
    } else if (next === SLASH) {
      const gt = xml.indexOf(GT, lt + 2);
      if (gt === -1) refuse('xml_unterminated');
      const name = xml.toString('utf8', lt + 2, gt).trim();
      if (stack.pop() !== name) refuse('xml_mismatched_tag');
      handler.close(name);
      at = gt + 1;
    } else {
      const gt = tagEnd(xml, lt + 1);
      const selfClosing = xml[gt - 1] === SLASH;
      const body = xml.toString('utf8', lt + 1, selfClosing ? gt - 1 : gt);
      const { name, attributes } = parseTag(body);
      if (!selfClosing) {
        if (stack.length >= MAX_XML_DEPTH) refuse('xml_too_deep');
        stack.push(name);
      }
      handler.open(name, attributes, selfClosing);
      if (selfClosing) handler.close(name);
      at = gt + 1;
    }
  }
  if (stack.length > 0) refuse('xml_unterminated');
}

function startsWith(xml: Buffer, at: number, literal: string): boolean {
  return xml.toString('latin1', at, at + literal.length) === literal;
}

function endOf(xml: Buffer, terminator: string, from: number): number {
  const end = xml.indexOf(terminator, from, 'latin1');
  if (end === -1) refuse('xml_unterminated');
  return end + terminator.length;
}

/** The `>` that closes the tag opened before `from` — one inside a quoted attribute value does not. */
function tagEnd(xml: Buffer, from: number): number {
  let quote = 0;
  for (let at = from; at < xml.length; at += 1) {
    const byte = xml[at]!;
    if (quote !== 0) {
      if (byte === quote) quote = 0;
    } else if (byte === QUOTE || byte === APOSTROPHE) {
      quote = byte;
    } else if (byte === GT) {
      return at;
    } else if (byte === LT) {
      refuse('xml_malformed');
    }
  }
  refuse('xml_unterminated');
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function parseTag(body: string): { name: string; attributes: Record<string, string> } {
  let at = 0;
  while (at < body.length && !isSpace(body.charCodeAt(at))) at += 1;
  const name = body.slice(0, at);
  if (name === '') refuse('xml_malformed');
  const attributes: Record<string, string> = {};
  while (at < body.length) {
    while (at < body.length && isSpace(body.charCodeAt(at))) at += 1;
    if (at >= body.length) break;
    const eq = body.indexOf('=', at);
    if (eq === -1) refuse('xml_malformed');
    const key = body.slice(at, eq).trim();
    let valueStart = eq + 1;
    while (valueStart < body.length && isSpace(body.charCodeAt(valueStart))) valueStart += 1;
    const quote = body[valueStart];
    if (quote !== '"' && quote !== "'") refuse('xml_malformed');
    const valueEnd = body.indexOf(quote, valueStart + 1);
    if (valueEnd === -1 || key === '') refuse('xml_malformed');
    attributes[key] = decodeEntities(body.slice(valueStart + 1, valueEnd));
    at = valueEnd + 1;
  }
  return { name, attributes };
}

function emitText(xml: Buffer, from: number, to: number, handler: XmlHandler): void {
  handler.text(decodeEntities(xml.toString('utf8', from, to)));
}

/** `#x10FFFF` is the longest reference this decodes; a `;` further on is not this `&`'s. */
const MAX_ENTITY_LENGTH = 12;

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Character references and the five predefined entities; anything else stays as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  let out = '';
  let at = 0;
  for (;;) {
    const amp = text.indexOf('&', at);
    if (amp === -1) return out + text.slice(at);
    out += text.slice(at, amp);
    // An entity name is short: look for its `;` in the next few characters
    // only. Searching the rest of the text from every `&` would make a text of
    // a million `&`s and no `;` quadratic.
    const offset = text.slice(amp + 1, amp + 1 + MAX_ENTITY_LENGTH).indexOf(';');
    if (offset === -1) {
      out += '&';
      at = amp + 1;
      continue;
    }
    const semi = amp + 1 + offset;
    const ref = text.slice(amp + 1, semi);
    const decoded = ref.startsWith('#') ? fromCodePoint(ref) : NAMED[ref];
    out += decoded ?? text.slice(amp, semi + 1);
    at = semi + 1;
  }
}

function fromCodePoint(ref: string): string | undefined {
  const hex = ref[1] === 'x' || ref[1] === 'X';
  const digits = ref.slice(hex ? 2 : 1);
  if (digits === '' || !(hex ? /^[0-9a-f]+$/i : /^[0-9]+$/).test(digits)) return undefined;
  const code = Number.parseInt(digits, hex ? 16 : 10);
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(code);
}
