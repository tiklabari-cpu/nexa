import { createHash } from 'node:crypto';
import { type SensitivePolicy, type SensitiveType } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { BIP39_ENGLISH } from './bip39-english.js';
import { maskCardNumbers } from './cc-mask.js';
import {
  SECRET_MASK,
  maskDeep,
  maskForWrite,
  maskSensitive,
  sensitiveAuthorOf,
} from './sensitive-mask.js';

/**
 * tm 300.1 · AI-26 — the sensitive-data masker on its own: what is masked, what
 * must stay readable, and that no input makes it slow.
 *
 * The negatives matter as much as the positives. A masker that hides "Şifrem
 * çalışmıyor" or the TXID a deposit hand-off needs turns a privacy control into
 * a support outage, so every detector below is pinned from both sides, in the
 * Turkish a player actually types.
 */

const customer = (text: string) => maskSensitive(text, { author: 'customer' });
const agent = (text: string) => maskSensitive(text, { author: 'agent' });
const bot = (text: string) => maskSensitive(text, { author: 'bot' });
const types = (result: { detections: { type: SensitiveType }[] }) =>
  result.detections.map((d) => d.type);

/** Asserts `text` comes back untouched, with nothing detected. */
function expectUntouched(text: string, mask = customer) {
  const result = mask(text);
  expect(result.text).toBe(text);
  expect(result.detections).toEqual([]);
}

const SEED_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED_24 =
  'legal winner thank year wave sausage worth useful legal winner thank year ' +
  'wave sausage worth useful legal winner thank year wave sausage worth title';
/** The first Bitcoin transaction's hash — a TXID, which the deposit hand-off needs whole. */
const TXID = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';
/** A valid TR IBAN whose first four groups ("0006 1010 0519 7868") pass Luhn on their own. */
const IBAN_WITH_CARD_WINDOW = 'TR33 0006 1010 0519 7868 0000 00';

describe('maskSensitive — the AI-26 acceptance criteria', () => {
  it('masks "Şifrem Ali1234!", "SMS kodu 482913" and keeps the last four of a TR IBAN', () => {
    expect(customer('Şifrem Ali1234!').text).toBe(`Şifrem ${SECRET_MASK}`);
    expect(customer('SMS kodu 482913').text).toBe(`SMS kodu ${SECRET_MASK}`);
    expect(customer('TR33 0006 1005 1978 6457 8413 26').text).toBe(
      'TR** **** **** **** **** **13 26',
    );
  });

  it('leaves a reference number, an amount, a phone number and a TXID alone — even beside a keyword', () => {
    expectUntouched('İşlem no PPR-20261014-482913');
    // "Kodum" sits 19 characters before 482913 — well inside the OTP window.
    expectUntouched('Kodum yok, PPR-20261014-482913');
    expectUntouched('2.500 TL');
    expectUntouched('Onay kodu bekliyorum, 2.500 TL yatırdım');
    expectUntouched('05321234567');
    expectUntouched('SMS kodu bu numaraya gelmiyor: 05321234567');
    expectUntouched(TXID);
    expectUntouched(`USDT gönderdim, kod istemediniz ama TXID: ${TXID}`);
  });

  it('masks a 12-word BIP-39 phrase and leaves an ordinary Turkish sentence alone', () => {
    const masked = customer(`Cüzdanımın kelimeleri: ${SEED_12} lütfen yardım edin`);
    expect(masked.text).toBe(`Cüzdanımın kelimeleri: ${SECRET_MASK} lütfen yardım edin`);
    expect(types(masked)).toEqual(['seed_phrase']);

    expectUntouched(
      'Merhaba, dün akşam Papara ile 500 TL yatırdım ama hesabıma hâlâ geçmedi. Kontrol eder misiniz?',
    );
  });
});

describe('card (FR-MOD-08.9.5)', () => {
  it('masks a Luhn-valid card in any grouping, keeping the last four', () => {
    expect(customer('Kart numaram 4111 1111 1111 1111').text).toBe(
      'Kart numaram **** **** **** 1111',
    );
    expect(customer('4111-1111-1111-1111 ile ödedim').text).toBe('**** **** **** 1111 ile ödedim');
    expect(customer('kartım 5555555555554444').text).toBe('kartım **** **** **** 4444');
  });

  it('leaves a 16-digit number that fails Luhn alone', () => {
    expectUntouched('Sipariş no 1234567890123456');
  });

  it('is masked in a staff or bot message too', () => {
    expect(agent('Kartınız 4111111111111111 olarak görünüyor').text).toBe(
      'Kartınız **** **** **** 1111 olarak görünüyor',
    );
    expect(types(bot('4111111111111111'))).toEqual(['card']);
  });

  it('does not take a Luhn-valid run inside a hex string (a TXID) for a card', () => {
    const txid = 'ab4111111111111111cdefcdefcdefcdefcdefcdefcdefcdefcdefcdefcdefcd';
    expect(txid).toHaveLength(64);
    expectUntouched(`TXID ${txid}`);
  });

  it('leaves a number its label names as a reference, even beside a code keyword (tm 300.2)', () => {
    expectUntouched('SMS order 680112: where is my bike?');
    expectUntouched('SMS ile sipariş no 482913 geldi mi?');
    expectUntouched('Kod sordular, fatura #204155 için');
    // The word right before the number decides: these are still codes.
    expect(types(customer('SMS kodu 482913'))).toEqual(['otp']);
    expect(types(customer('sipariş için SMS kodu: 482913'))).toEqual(['otp']);
  });

  it('leaves a UUID whole, though its last groups pass Luhn (tm 300.2)', () => {
    // `8000-000000000011` is sixteen Luhn-valid digits; the GL-5 window used to
    // carve it out of the id — harmless in a message, fatal to an id in a prompt.
    const id = '00000000-0000-4000-8000-000000000011';
    expectUntouched(`skill ${id}`);
    expectUntouched(`doğrulama kodu ${id}`);
    expect(customer(`kart 4111 1111 1111 1111 skill ${id}`).text).toBe(
      `kart **** **** **** 1111 skill ${id}`,
    );
  });
});

describe('iban', () => {
  it('masks a contiguous or lower-case TR IBAN the same way', () => {
    expect(customer('IBAN: TR330006100519786457841326').text).toBe(
      'IBAN: TR** **** **** **** **** **13 26',
    );
    expect(customer('ibanım tr33 0006 1005 1978 6457 8413 26 bu').text).toBe(
      'ibanım TR** **** **** **** **** **13 26 bu',
    );
  });

  it('masks other countries by their own length and mod-97', () => {
    expect(customer('DE89 3704 0044 0532 0130 00').text).toBe('DE** **** **** **** **30 00');
    expect(customer('GB82 WEST 1234 5698 7654 32').text).toBe('GB** **** **** **** **54 32');
  });

  it('leaves a wrong check digit, a wrong length and an unknown country alone', () => {
    expectUntouched('TR34 0006 1005 1978 6457 8413 26');
    expectUntouched('TR33 0006 1005 1978 6457 8413 2');
    expectUntouched('TR33 0006 1005 1978 6457 8413 261');
    expectUntouched('ZZ33 0006 1005 1978 6457 8413 26');
  });

  it('shows an IBAN an agent or the bot shares in full (AI-26-S2)', () => {
    expectUntouched('Yatırım için IBAN: TR33 0006 1005 1978 6457 8413 26', agent);
    expectUntouched('IBAN: TR33 0006 1005 1978 6457 8413 26', bot);
  });

  it('keeps an agent IBAN whole even when four of its groups pass Luhn', () => {
    // The old card masker would have turned this into "TR33 **** **** **** 7868 0000 00".
    expectUntouched(`IBAN: ${IBAN_WITH_CARD_WINDOW}`, agent);
    expect(customer(IBAN_WITH_CARD_WINDOW)).toEqual({
      text: 'TR** **** **** **** **** **00 00',
      detections: [{ type: 'iban', start: 0, end: 32 }],
    });
  });
});

describe('cvv', () => {
  it('masks 3–4 digits near cvv / cvc / güvenlik kodu / arkadaki 3 hane', () => {
    expect(customer('CVV 123').text).toBe(`CVV ${SECRET_MASK}`);
    expect(customer('cvc: 987').text).toBe(`cvc: ${SECRET_MASK}`);
    expect(customer('Kartın arkasındaki 3 hane 456').text).toBe(
      `Kartın arkasındaki 3 hane ${SECRET_MASK}`,
    );
    expect(customer('Güvenlik kodu 7890')).toMatchObject({ detections: [{ type: 'cvv' }] });
  });

  it('masks a card and its CVV as two values, the card keeping its last four', () => {
    const result = customer('kart 4111 1111 1111 1111 skt 12/27 cvv 123');
    expect(result.text).toBe(`kart **** **** **** 1111 skt 12/27 cvv ${SECRET_MASK}`);
    expect(types(result)).toEqual(['card', 'cvv']);
  });

  it('leaves a number with no CVV keyword within 30 characters alone', () => {
    expectUntouched('Masa 123 numarada oturuyorum');
    expectUntouched('CVV bilgisini sormadınız, siparişimde ise tam 123 ürün var');
  });
});

describe('otp', () => {
  it('masks 4–8 digits near kod / sms / otp / doğrulama / şifre, before or after', () => {
    expect(customer('Doğrulama kodu: 4829').text).toBe(`Doğrulama kodu: ${SECRET_MASK}`);
    expect(customer('onay kodum 12345678').text).toBe(`onay kodum ${SECRET_MASK}`);
    expect(customer('482913 kodunu girdim olmadı').text).toBe(
      `${SECRET_MASK} kodunu girdim olmadı`,
    );
    expect(customer('DOGRULAMA KODU 482913').text).toBe(`DOGRULAMA KODU ${SECRET_MASK}`);
    expect(customer('sms ile gelen 482913').text).toBe(`sms ile gelen ${SECRET_MASK}`);
    expect(customer('OTP 4829 geldi').text).toBe(`OTP ${SECRET_MASK} geldi`);
    expect(customer('my code is 482913').text).toBe(`my code is ${SECRET_MASK}`);
  });

  it('is masked in an agent message too', () => {
    expect(agent('Size gelen kod 482913 mü?').text).toBe(`Size gelen kod ${SECRET_MASK} mü?`);
  });

  it('leaves a bare number, an amount, a phone and a too-long or too-short number alone (AI-26-S3)', () => {
    expectUntouched('482913');
    expectUntouched('Kod gelmedi, 2500 TL yatırdım');
    expectUntouched('Kod gelmedi, ₺2500 yatırdım');
    expectUntouched('SMS gelmiyor, numaram 0532 123 45 67');
    expectUntouched('SMS gelmiyor, numaram +90 532 123 45 67');
    expectUntouched('kod 123456789');
    expectUntouched('kodu 2 kez denedim, 3 dakika bekledim');
    expectUntouched('kod 2.500 TL değil 2,500 TL');
    expectUntouched('SMS kodu 14.10.2026 tarihinde gelmedi');
    expectUntouched('Kod 14/10/2026 günü geldi');
  });

  it('leaves a number further than 30 characters from the keyword alone', () => {
    expectUntouched('SMS geldi ama hesabıma hâlâ para geçmedi, dekont 482913');
  });
});

describe('password', () => {
  it('masks the token after şifrem / parolam / password / pw', () => {
    expect(customer('Şifrem Ali1234!').detections).toEqual([
      { type: 'password', start: 7, end: 15 },
    ]);
    expect(customer('sifrem Gs1905 idi').text).toBe(`sifrem ${SECRET_MASK} idi`);
    expect(customer('parolam GalataSaray').text).toBe(`parolam ${SECRET_MASK}`);
    expect(customer('my password is Hunter2').text).toBe(`my password is ${SECRET_MASK}`);
    expect(customer('pw=abc123').text).toBe(`pw=${SECRET_MASK}`);
    expect(customer('Şifrem:\nAli1234!').text).toBe(`Şifrem:\n${SECRET_MASK}`);
  });

  it('masks any token after an explicit colon, the bare noun included', () => {
    expect(customer('ŞİFREM: ankara').text).toBe(`ŞİFREM: ${SECRET_MASK}`);
    expect(customer('şifre: galatasaray').text).toBe(`şifre: ${SECRET_MASK}`);
    expect(customer('şifrem şu: kediler').text).toBe(`şifrem şu: ${SECRET_MASK}`);
  });

  it('masks a temporary password an agent sends', () => {
    expect(agent('Geçici şifreniz: K7x9Qp').text).toBe(`Geçici şifreniz: ${SECRET_MASK}`);
  });

  it('leaves the everyday sentences about a password readable', () => {
    for (const sentence of [
      'Şifrem çalışmıyor',
      'ŞİFREM ÇALIŞMIYOR YARDIM EDİN',
      'Şifremi unuttum',
      'Şifrem 3 kez yanlış girildi',
      'Şifre sıfırlama linki gelmedi',
      // The bare noun needs a colon, even before a word that looks like a credential.
      'Şifre E-Devlet şifresiyle aynı mı?',
      'Şifrem e-postama gelmedi',
      "Şifrem SMS'le gelmedi",
      'şifrem doğru ama giremiyorum',
      'my password is not working',
    ]) {
      expectUntouched(sentence);
    }
    expectUntouched('Şifreniz sıfırlandı, yeni şifrenizi e-postanızda bulabilirsiniz.', agent);
  });

  it('labels "şifrem 482913" a password, not an OTP (equal spans: more context wins)', () => {
    expect(types(customer('şifrem 482913'))).toEqual(['password']);
  });
});

describe('seed_phrase', () => {
  it('masks a 24-word phrase, upper-cased or numbered', () => {
    expect(customer(SEED_24).text).toBe(SECRET_MASK);
    expect(customer(SEED_12.toUpperCase()).text).toBe(SECRET_MASK);
    const numbered = SEED_12.split(' ')
      .map((word, i) => `${i + 1}. ${word}`)
      .join('\n');
    expect(customer(`kelimeler:\n${numbered}`).text).toBe(`kelimeler:\n1. ${SECRET_MASK}`);
    expect(customer(SEED_12.split(' ').join(', ')).text).toBe(SECRET_MASK);
  });

  it('is masked in an agent message too', () => {
    expect(types(agent(`Örnek: ${SEED_12}`))).toEqual(['seed_phrase']);
  });

  it('leaves 11 BIP-39 words and an English sentence alone', () => {
    expectUntouched(SEED_12.split(' ').slice(0, 11).join(' '));
    expectUntouched(
      'Hello, I made a deposit about an hour ago and my account balance still shows zero.',
    );
  });
});

describe('private_key', () => {
  it('masks a WIF key (5…, K…, L…) on its own', () => {
    const uncompressed = '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ';
    const compressed = 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617';
    expect(uncompressed).toHaveLength(51);
    expect(compressed).toHaveLength(52);
    expect(customer(`anahtar ${uncompressed}`).text).toBe(`anahtar ${SECRET_MASK}`);
    expect(types(agent(compressed))).toEqual(['private_key']);
  });

  it('masks 64 hex digits only near "private key" / "özel anahtar"', () => {
    const key = '0C28FCA386C7A227600B2FE50B7CAE11EC86D3BF1FBE471BE89827E19D72AA1D';
    expect(customer(`Özel anahtarım: ${key}`).text).toBe(`Özel anahtarım: ${SECRET_MASK}`);
    expect(customer(`private key 0x${key.toLowerCase()}`).text).toBe(`private key ${SECRET_MASK}`);
    expectUntouched(`İşlem hash'i 0x${TXID}`);
    // The keyword is in the message, but more than 30 characters from the hash.
    expectUntouched(
      `Özel anahtarımı kimseyle paylaşmadım, yalnız işlem hash'ini iletiyorum: ${TXID}`,
    );
  });
});

describe('banking_credential', () => {
  it('masks the customer number and the password after müşteri no / internet şubesi', () => {
    const result = customer('İnternet şubesi müşteri no 12345678 şifre 4321');
    expect(result.text).toBe(`İnternet şubesi müşteri no ${SECRET_MASK} şifre ${SECRET_MASK}`);
    expect(types(result)).toEqual(['banking_credential', 'banking_credential']);
    expect(customer('Müşteri numaram 12345678, şifrem Ab12cd').text).toBe(
      `Müşteri numaram ${SECRET_MASK}, şifrem ${SECRET_MASK}`,
    );
  });

  it('leaves a customer number with no password after it alone', () => {
    expectUntouched('Müşteri no 12345678 olan hesabım kilitlendi');
  });
});

describe('policy (AI-26-S2)', () => {
  it('masks every type for the customer and the account secrets only for staff', () => {
    const message =
      'TR33 0006 1005 1978 6457 8413 26 · kart 4111111111111111 · cvv 123 · SMS kodu 482913';
    expect(types(customer(message))).toEqual(['iban', 'card', 'cvv', 'otp']);
    expect(types(agent(message))).toEqual(['card', 'cvv', 'otp']);
    expect(agent(message).text.startsWith('TR33 0006 1005 1978 6457 8413 26 · ')).toBe(true);
  });

  it('honours a narrower policy', () => {
    const cardsOnly: SensitivePolicy = { customer: ['card'], agent: ['card'], bot: ['card'] };
    const result = maskSensitive('SMS kodu 482913, kart 4111111111111111', {
      author: 'customer',
      policy: cardsOnly,
    });
    expect(result.text).toBe('SMS kodu 482913, kart **** **** **** 1111');
  });
});

describe('detections', () => {
  it('reports each mask by its offsets in the masked text, in order', () => {
    const result = customer('Şifrem Ali1234! ve SMS kodu 482913, kart 4111111111111111');
    expect(result.text).toBe(
      `Şifrem ${SECRET_MASK} ve SMS kodu ${SECRET_MASK}, kart **** **** **** 1111`,
    );
    expect(types(result)).toEqual(['password', 'otp', 'card']);
    for (const detection of result.detections) {
      expect(result.text.slice(detection.start, detection.end)).toMatch(/^\*[* \d]*$/);
    }
  });

  it('returns empty text and text with nothing sensitive unchanged', () => {
    expectUntouched('');
    expectUntouched('Merhaba, bonusum ne zaman yüklenir?');
  });
});

describe('cc-mask wrapper (backward compatible)', () => {
  it('still masks only cards', () => {
    expect(maskCardNumbers('Şifrem Ali1234!, kart 4111111111111111, SMS kodu 482913')).toBe(
      'Şifrem Ali1234!, kart **** **** **** 1111, SMS kodu 482913',
    );
  });

  it('no longer cuts a card-shaped window out of an IBAN or a TXID', () => {
    expect(maskCardNumbers(IBAN_WITH_CARD_WINDOW)).toBe(IBAN_WITH_CARD_WINDOW);
    const txid = 'ab4111111111111111cdefcdefcdefcdefcdefcdefcdefcdefcdefcdefcdefcd';
    expect(maskCardNumbers(txid)).toBe(txid);
  });
});

describe('BIP-39 wordlist', () => {
  it('is the canonical English list, byte for byte', () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    const digest = createHash('sha256')
      .update(BIP39_ENGLISH.join('\n') + '\n')
      .digest('hex');
    expect(digest).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });
});

/**
 * Backtracking (ReDoS). Every input is a hundred times the 10,000-character
 * message cap and built to hurt a specific pattern: long digit runs and digit
 * groups (card, OTP, phone chain), hex (TXID / private key), letters and
 * keywords (password lead, seed scan), IBAN starts and WIF prefixes. A linear
 * masker finishes each in about a tenth of a second; a pattern that backtracks
 * quadratically or worse takes a minute or more at this size. The size is
 * measured, not guessed: with the password token's 65-character bound removed
 * (a quadratic scan), "password colons" took 0.8 s at 100,000 characters —
 * under any sane ceiling — and only at 1,000,000 does the gap become
 * unmistakable. The ceiling only has to tell the two apart, so it is generous
 * enough for a loaded machine.
 */
describe('maskSensitive — linear on adversarial input', () => {
  const SIZE = 1_000_000;
  /** Every keyword up front, so each keyword-gated detector scans the whole input. */
  const KEYWORDS = 'cvv kod özel anahtar müşteri no şifrem: ';
  const fill = (unit: string) =>
    KEYWORDS + unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);

  /** A deterministic mix of every character class the detectors care about. */
  function noise(): string {
    const alphabet = '0123456789 -.,:=/abcdefKLx5 şifrem kod cvv TR ';
    let state = 42;
    let out = '';
    for (let i = 0; i < SIZE; i += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      out += alphabet.charAt(state % alphabet.length);
    }
    return out;
  }

  const inputs: Record<string, string> = {
    digits: fill('1'),
    'digit groups': fill('1 '),
    'hyphen groups': fill('12-'),
    'dot groups': fill('1.'),
    'phone-ish chain then letter': fill('0532 123 45 67x'),
    hex: fill('f'),
    'hex with digits': fill('a1'),
    letters: fill('a'),
    'otp keyword and digits': fill('kod 1 '),
    'password keywords': fill('şifrem '),
    'password colons': fill('pw:'),
    'password leads': fill('şifrem şu de: '),
    'cvv keywords': fill('cvv 12 '),
    'seed run': fill('abandon '),
    'iban starts': fill('TR33 '),
    'iban-like': fill('TR33 0006 '),
    'wif prefix': `5${fill('H').slice(1)}`,
    'banking keywords': fill('müşteri no 12345 '),
    'uuid-like groups': fill('00000000-0000-4000-8000-'),
    noise: noise(),
  };

  for (const [name, input] of Object.entries(inputs)) {
    it(`handles ${SIZE.toLocaleString('en')} characters of "${name}" in linear time`, () => {
      const started = performance.now();
      const result = maskSensitive(input, { author: 'customer' });
      const elapsed = performance.now() - started;
      expect(typeof result.text).toBe('string');
      expect(elapsed).toBeLessThan(5000);
    });
  }
});

describe('what the write paths see (tm 300.2)', () => {
  it('returns the masked text and the types once each, in catalogue order', () => {
    expect(
      maskForWrite('SMS kodu 482913, şifrem Ali1234! kart 4111 1111 1111 1111', 'customer'),
    ).toEqual({
      text: `SMS kodu ${SECRET_MASK}, şifrem ${SECRET_MASK} kart **** **** **** 1111`,
      types: ['card', 'otp', 'password'],
    });
  });

  it('passes an absent value or a clean text through untouched', () => {
    expect(maskForWrite(undefined, 'customer')).toEqual({ text: undefined, types: [] });
    expect(maskForWrite(null, 'agent')).toEqual({ text: null, types: [] });
    expect(maskForWrite('param yatmadı', 'customer')).toEqual({
      text: 'param yatmadı',
      types: [],
    });
  });

  it("keeps an agent's IBAN whole and masks the player's (AI-26-S2)", () => {
    const iban = 'TR33 0006 1005 1978 6457 8413 26';
    expect(maskForWrite(`IBAN: ${iban}`, 'agent').text).toBe(`IBAN: ${iban}`);
    expect(maskForWrite(`IBAN: ${iban}`, 'customer').types).toEqual(['iban']);
  });

  it('maps an author type to its policy, and the system to none', () => {
    expect(sensitiveAuthorOf('customer')).toBe('customer');
    expect(sensitiveAuthorOf('agent')).toBe('agent');
    expect(sensitiveAuthorOf('bot')).toBe('bot');
    expect(sensitiveAuthorOf('system')).toBeNull();
  });

  it('masks every string in a JSON value, keys and non-strings untouched', () => {
    const when = new Date(0);
    expect(
      maskDeep(
        {
          'şifrem 123abc!': 'şifrem 123abc!',
          slots: { otp: 'SMS kodu 482913', amount: 2500, ok: true, at: when },
          list: ['kart 4111 1111 1111 1111', null],
        },
        'customer',
      ),
    ).toEqual({
      'şifrem 123abc!': `şifrem ${SECRET_MASK}`,
      slots: { otp: `SMS kodu ${SECRET_MASK}`, amount: 2500, ok: true, at: when },
      list: ['kart **** **** **** 1111', null],
    });
  });
});
