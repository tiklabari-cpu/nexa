/**
 * The message the SMTP carrier puts on the wire (tm 255.3).
 *
 * Every assertion decodes what was encoded and compares it with the input,
 * rather than comparing encoded strings with other encoded strings: an encoder
 * checked against its own output agrees with itself about every bug it has.
 * The decoders below are written from the RFCs, independently of `mime.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  composeMessage,
  encodeQuotedPrintable,
  encodedWords,
  foldSubject,
  rfc5322Date,
} from './mime.js';
import { dotStuff } from './smtp-session.js';

/** RFC 2045 §6.7, decoding direction: soft breaks vanish, `=XX` is one octet. */
function decodeQuotedPrintable(encoded: string): string {
  const joined = encoded.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** RFC 2047 `B` words; whitespace between adjacent encoded words is not part of the text (§6.2). */
function decodeHeader(value: string): string {
  const unfolded = value.replace(/\r\n /g, ' ');
  if (!unfolded.includes('=?')) return unfolded;
  return unfolded
    .split(' ')
    .map((word) => {
      const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/.exec(word);
      if (!match) throw new Error(`not an encoded word: ${word}`);
      return Buffer.from(match[1]!, 'base64').toString('utf8');
    })
    .join('');
}

function headerValue(message: string, name: string): string {
  const head = message.slice(0, message.indexOf('\r\n\r\n'));
  const match = new RegExp(`^${name}: (.*(?:\\r\\n .*)*)`, 'm').exec(head);
  if (!match) throw new Error(`no ${name} header`);
  return match[1]!;
}

const BASE = {
  from: 'info@nolnk.test',
  to: 'jane.customer@example.test',
  subject: 'Reset your password',
  body: 'Hello',
  date: new Date('2026-09-22T21:54:00Z'),
  messageId: '0b8c1e3a-1111-4222-8333-944455556666@nolnk.test',
};

describe('composeMessage', () => {
  it('writes the headers a single text/plain message needs, CRLF throughout', () => {
    const message = composeMessage(BASE);

    expect(headerValue(message, 'From')).toBe('info@nolnk.test');
    expect(headerValue(message, 'To')).toBe('jane.customer@example.test');
    expect(headerValue(message, 'Subject')).toBe('Reset your password');
    expect(headerValue(message, 'Date')).toBe('Tue, 22 Sep 2026 21:54:00 +0000');
    expect(headerValue(message, 'Message-ID')).toBe(`<${BASE.messageId}>`);
    expect(headerValue(message, 'MIME-Version')).toBe('1.0');
    expect(headerValue(message, 'Content-Type')).toBe('text/plain; charset=utf-8');
    expect(headerValue(message, 'Content-Transfer-Encoding')).toBe('quoted-printable');
    // No bare LF or CR anywhere: SMTP lines end in CRLF (RFC 5321 §2.3.8).
    expect(message.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(message.endsWith('\r\n')).toBe(true);
  });

  it('carries a Turkish subject and body intact, and keeps every line 7-bit and within its limit', () => {
    const subject = 'Şifre sıfırlama bağlantınız — SiyahTuş çalışma alanı "Ağaç İşleri" için 🔐';
    const body = [
      'Merhaba Çağla,',
      '',
      'Şifrenizi sıfırlamak için aşağıdaki bağlantıyı kullanın. Bağlantı bir saat geçerlidir ve yalnızca bir kez kullanılabilir.',
      'https://app.example.test/reset-password?token=AbC123=xyz',
      'Satır sonunda boşluk ',
      '\tsekme ile başlayan satır',
    ].join('\n');

    const message = composeMessage({ ...BASE, subject, body });
    const [head, encodedBody] = [
      message.slice(0, message.indexOf('\r\n\r\n')),
      message.slice(message.indexOf('\r\n\r\n') + 4),
    ];

    expect(decodeHeader(headerValue(message, 'Subject'))).toBe(subject);
    expect(decodeQuotedPrintable(encodedBody!)).toBe(`${body.replace(/\n/g, '\r\n')}\r\n`);
    // Nothing but 7-bit on the wire, headers and body alike.
    expect(message).toMatch(/^[\t\n\r -~]*$/);
    // RFC 2047 §2: a header line carrying an encoded word is at most 76 long.
    for (const line of head!.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    // RFC 2045 §6.7 rule 5: an encoded body line is at most 76 long.
    for (const line of encodedBody!.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('turns a line break in the subject into a space instead of a new header', () => {
    // A `ticket_notice` subject is text a workspace wrote (FR-MOD-08.7.5).
    const message = composeMessage({
      ...BASE,
      subject: 'Your ticket\r\nBcc: attacker@example.test\nX-Injected: yes',
    });
    const head = message.slice(0, message.indexOf('\r\n\r\n'));

    expect(head).not.toMatch(/^Bcc:/m);
    expect(head).not.toMatch(/^X-Injected:/m);
    expect(decodeHeader(headerValue(message, 'Subject'))).toBe(
      'Your ticket Bcc: attacker@example.test X-Injected: yes',
    );
  });
});

describe('encodedWords / foldSubject (RFC 2047)', () => {
  it('never splits a character across two words', () => {
    // Four-byte emoji and two-byte Turkish letters, chosen so a byte-counting
    // cut would land inside a character if the encoder cut by bytes alone.
    const text = 'ğ'.repeat(25) + '😀'.repeat(15) + 'ı'.repeat(30);
    const words = encodedWords(text, 39);

    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      const decoded = Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(word)![1]!, 'base64');
      // A word that ended mid-character would not survive a UTF-8 round trip.
      expect(Buffer.from(decoded.toString('utf8'), 'utf8').equals(decoded)).toBe(true);
      expect(decoded.length).toBeLessThanOrEqual(39);
    }
    expect(decodeHeader(words.join(' '))).toBe(text);
  });

  it('leaves plain ASCII alone and encodes anything a decoder could misread', () => {
    expect(foldSubject('Reset your password')).toBe('Subject: Reset your password');
    // `=?` in plain text would be parsed as the start of an encoded word.
    expect(foldSubject('Price =?100')).toMatch(/^Subject: =\?UTF-8\?B\?/);
    expect(decodeHeader(foldSubject('Price =?100').slice('Subject: '.length))).toBe('Price =?100');
  });

  it('folds an ASCII subject too long for one header line', () => {
    const subject = 'ticket '.repeat(200).trim();
    const folded = foldSubject(subject);

    for (const line of folded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(decodeHeader(folded.slice('Subject: '.length))).toBe(subject);
  });
});

describe('encodeQuotedPrintable (RFC 2045 §6.7)', () => {
  it('encodes "=", non-ASCII and trailing whitespace, and nothing else', () => {
    expect(encodeQuotedPrintable('a=b')).toBe('a=3Db');
    expect(encodeQuotedPrintable('é')).toBe('=C3=A9');
    expect(encodeQuotedPrintable('ends in space ')).toBe('ends in space=20');
    expect(encodeQuotedPrintable('ends in tab\t')).toBe('ends in tab=09');
    expect(encodeQuotedPrintable('inner space\tand tab')).toBe('inner space\tand tab');
  });

  it('breaks long lines softly without cutting an =XX triplet', () => {
    const line = 'ş'.repeat(100);
    const encoded = encodeQuotedPrintable(line);

    for (const physical of encoded.split('\r\n')) {
      expect(physical.length).toBeLessThanOrEqual(76);
      // Everything before a trailing soft-break `=` is whole triplets.
      expect(physical.replace(/=$/, '')).toMatch(/^(=[0-9A-F]{2})*$/);
    }
    expect(decodeQuotedPrintable(encoded)).toBe(line);
  });
});

describe('dotStuff (RFC 5321 §4.5.2)', () => {
  it('doubles a leading dot and ends the stream with the terminator', () => {
    expect(dotStuff('a\r\n.b\r\n..c\r\n')).toBe('a\r\n..b\r\n...c\r\n.\r\n');
    expect(dotStuff('.first\r\n')).toBe('..first\r\n.\r\n');
    // A lone "." line is exactly what would end the message early.
    expect(dotStuff('before\r\n.\r\nafter\r\n')).toBe('before\r\n..\r\nafter\r\n.\r\n');
  });
});

describe('rfc5322Date', () => {
  it('writes the numeric zone RFC 5322 §3.3 asks for', () => {
    expect(rfc5322Date(new Date('2026-01-05T03:04:05Z'))).toBe('Mon, 05 Jan 2026 03:04:05 +0000');
  });
});

describe('composeMessage with HTML and attachments (tm 265)', () => {
  const HTML = '<p>Merhaba <strong>dünya</strong></p>';

  it('keeps a text-only message exactly one text/plain part', () => {
    const message = composeMessage(BASE);
    expect(message).not.toContain('multipart/');
    expect(headerValue(message, 'Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('sends text first and HTML last in a multipart/alternative', () => {
    const message = composeMessage({ ...BASE, body: 'Merhaba dünya', html: HTML });
    const type = headerValue(message, 'Content-Type');
    expect(type).toMatch(/^multipart\/alternative; boundary="=_siyahtus_[A-Za-z0-9]+"$/);
    const boundary = /boundary="([^"]+)"/.exec(type)![1]!;
    const sections = message.split(`--${boundary}`);
    // Preamble, text, HTML, and the close delimiter.
    expect(sections).toHaveLength(4);
    expect(sections[1]).toContain('Content-Type: text/plain; charset=utf-8');
    expect(sections[2]).toContain('Content-Type: text/html; charset=utf-8');
    expect(sections[3]!.startsWith('--')).toBe(true);
    const html = sections[2]!.slice(sections[2]!.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
    expect(decodeQuotedPrintable(html)).toBe(HTML);
    // Every line on the wire stays within the limits, 7-bit.
    for (const line of message.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(998);
      expect(line).toMatch(/^[\x20-\x7e]*$/);
    }
  });

  it('wraps an attachment in multipart/mixed, base64 in 76-character lines', () => {
    const csv = `\uFEFFname,city\r\nAyşe,İstanbul\r\n${'x'.repeat(200)}\r\n`;
    const message = composeMessage({
      ...BASE,
      html: HTML,
      attachments: [
        { filename: 'rapor "q3".csv', contentType: 'text/csv; charset=utf-8', content: csv },
      ],
    });
    expect(headerValue(message, 'Content-Type')).toMatch(/^multipart\/mixed; boundary=/);
    expect(message).toContain('Content-Type: multipart/alternative; boundary=');
    // A quote in the name cannot end the parameter early.
    expect(message).toContain('Content-Disposition: attachment; filename="rapor _q3_.csv"');
    const start = message.indexOf('Content-Disposition: attachment');
    const body = message.slice(message.indexOf('\r\n\r\n', start) + 4);
    const base64Lines = body.split('\r\n').filter((line) => /^[A-Za-z0-9+/=]+$/.test(line));
    expect(base64Lines.length).toBeGreaterThan(1);
    for (const line of base64Lines) expect(line.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(base64Lines.join(''), 'base64').toString('utf8')).toBe(csv);
  });

  it('names the language, and refuses one that is not a language tag', () => {
    expect(headerValue(composeMessage({ ...BASE, language: 'tr' }), 'Content-Language')).toBe('tr');
    expect(composeMessage({ ...BASE, language: 'tr\r\nBcc: x@y.test' })).not.toContain('Bcc:');
  });
});
