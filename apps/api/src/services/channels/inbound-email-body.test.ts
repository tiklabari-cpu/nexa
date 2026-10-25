/**
 * The reply cut from the mail around it (tm 357 · SiyahTuş analysis HD-02).
 *
 * Each client's shape of "here is what came before" is pinned with a mail of
 * its own, the Turkish ones first — they are the mail this product reads. The
 * negatives matter as much: a cut that hides the player's own words is worse
 * than no cut, so a mail that would be left empty, a lone "wrote:" at the end,
 * and answers written between quoted lines all stay whole.
 */
import { describe, expect, it } from 'vitest';
import { clipText } from '../../lib/clip-text.js';
import { prepareInboundBody, splitReply } from './inbound-email-body.js';

const REPLY = 'Yatırımım geçmedi, 2.500 TL, saat 14:42, dekont ektedir.';

describe('splitReply', () => {
  it('cuts a Turkish Gmail quote (HD-02)', () => {
    const mail = [
      REPLY,
      '',
      '20 Eki 2026 Pzt, 14:50 tarihinde SiyahTuş Destek <destek@ornek.com> şunu yazdı:',
      '> Merhaba, işleminizin dekontunu iletir misiniz?',
      '>',
      '> Saygılarımızla',
    ].join('\n');

    const split = splitReply(mail);
    expect(split.text).toBe(REPLY);
    expect(split.full).toBe(mail);
  });

  it('cuts a Gmail attribution wrapped over two lines', () => {
    const mail = [
      'Thanks, attached.',
      '',
      'On Mon, Oct 20, 2026 at 2:50 PM SiyahTuş Support <',
      'support@example.com> wrote:',
      '> Could you send the receipt?',
    ].join('\n');
    expect(splitReply(mail).text).toBe('Thanks, attached.');
  });

  it("cuts Apple Mail's English and Turkish attribution", () => {
    expect(
      splitReply('Ok\n\nOn 20 Oct 2026, at 14:50, Support <s@example.com> wrote:\n\n> Hello').text,
    ).toBe('Ok');
    expect(
      splitReply(
        'Tamam\n\n20 Eki 2026 tarihinde 14:50 saatinde, Destek <d@ornek.com> şunları yazdı:\n\n> Merhaba',
      ).text,
    ).toBe('Tamam');
  });

  it("cuts Outlook's header block, in Turkish and in English", () => {
    const turkish = [
      'Ekte gönderiyorum.',
      '',
      '________________________________',
      'Kimden: SiyahTuş Destek <destek@ornek.com>',
      'Gönderildi: 20 Ekim 2026 Pazartesi 14:50',
      'Kime: Ali Veli <ali@ornek.com>',
      'Konu: Yatırım',
      '',
      'Merhaba,',
    ].join('\n');
    expect(splitReply(turkish).text).toBe('Ekte gönderiyorum.');

    const english = [
      'See below.',
      '',
      'From: Support <s@example.com>',
      'Sent: Monday, October 20, 2026 2:50 PM',
      'To: Jane <j@example.com>',
      'Subject: Deposit',
      '',
      'Hello,',
    ].join('\n');
    expect(splitReply(english).text).toBe('See below.');
  });

  it('cuts "-----Original Message-----"', () => {
    expect(
      splitReply('My answer\n\n-----Original Message-----\nFrom: x@example.com\nOld text').text,
    ).toBe('My answer');
  });

  it('cuts a quoted block that runs to the end of the mail', () => {
    expect(splitReply('New line\n\n> old line 1\n> old line 2\n').text).toBe('New line');
  });

  it('keeps answers written between quoted lines — that is a reply, not a quote', () => {
    const mail = '> Which amount?\n2.500 TL\n> Which time?\n14:42';
    expect(splitReply(mail)).toEqual({ text: mail, full: null });
  });

  it('cuts the signature delimiter and the mobile signatures, keeping the phone in the full text', () => {
    const signed = `${REPLY}\n\n-- \nAli Veli\nTel: 0532 123 45 67`;
    const split = splitReply(signed);
    expect(split.text).toBe(REPLY);
    expect(split.full).toContain('0532 123 45 67');

    expect(splitReply(`${REPLY}\n\niPhone'umdan gönderildi`).text).toBe(REPLY);
    expect(splitReply(`${REPLY}\n\nSent from my iPhone`).text).toBe(REPLY);
    expect(splitReply(`${REPLY}\n\nGet Outlook for Android`).text).toBe(REPLY);
  });

  it('cuts nothing when the cut would leave nothing — a mail that is all quote', () => {
    const allQuote = 'On Mon, 20 Oct 2026 Jane <j@example.com> wrote:\n> everything';
    expect(splitReply(allQuote)).toEqual({ text: allQuote, full: null });
    expect(splitReply('> only a quote')).toEqual({ text: '> only a quote', full: null });
  });

  it('does not take the player\'s own "… wrote:" for an attribution', () => {
    // No date digits, no address: a sentence, not a client's header line.
    const mail = 'Here is what my friend wrote:\nthe bonus never arrived';
    expect(splitReply(mail)).toEqual({ text: mail, full: null });
    // And an attribution-looking last line has nothing under it to quote.
    const last = 'Thanks!\nOn 20 Oct 2026 Jane <j@example.com> wrote:';
    expect(splitReply(last)).toEqual({ text: last, full: null });
  });

  it('normalises CR-LF and drops NUL, which Postgres refuses', () => {
    expect(splitReply('a\r\nb\x00c\r\n')).toEqual({ text: 'a\nbc', full: null });
  });

  it('stays linear on hostile input (a million spaces, a megabyte line)', () => {
    const started = process.hrtime.bigint();
    splitReply(`${' '.repeat(1_000_000)}x`);
    splitReply(`${'>'.repeat(1_000_000)}\n${'a '.repeat(500_000)}wrote:\nx`);
    splitReply('-- \n'.repeat(200_000));
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(5_000);
  });
});

describe('prepareInboundBody', () => {
  it('takes the text from the plain part and sanitises the HTML beside it', () => {
    const body = prepareInboundBody({
      text: `${REPLY}\n\n-- \nAli`,
      html: '<p>Yatırımım geçmedi</p><script>alert(1)</script>',
    });
    expect(body.text).toBe(REPLY);
    expect(body.full).toContain('Ali');
    expect(body.html).toBe('<p>Yatırımım geçmedi</p>');
  });

  it('derives the text from the HTML of a mail with no plain part, quote recognised', () => {
    const body = prepareInboundBody({
      html:
        '<div dir="ltr">Dekont ektedir.<br></div><div class="gmail_quote">' +
        '<div>20 Eki 2026 Pzt, 14:50 tarihinde Destek &lt;d@ornek.com&gt; şunu yazdı:<br></div>' +
        '<blockquote class="gmail_quote">Dekontu iletir misiniz?</blockquote></div>',
    });
    expect(body.text).toBe('Dekont ektedir.');
    expect(body.full).toContain('> Dekontu iletir misiniz?');
  });

  it('is an empty body for a mail that has none', () => {
    expect(prepareInboundBody({})).toEqual({ text: '', full: null, html: null });
  });
});

describe('clipText', () => {
  it('cuts with a marker and never splits a surrogate pair', () => {
    expect(clipText('short', 10)).toBe('short');
    const clipped = clipText('a'.repeat(20), 10);
    expect(clipped).toHaveLength(10);
    expect(clipped.endsWith('\n[…]')).toBe(true);

    // The cut would land between the two halves of an emoji: it moves back one.
    const emoji = String.fromCodePoint(0x1f600);
    expect(clipText(`aaaaa${emoji}${'b'.repeat(10)}`, 10)).toBe('aaaaa\n[…]');
  });
});
