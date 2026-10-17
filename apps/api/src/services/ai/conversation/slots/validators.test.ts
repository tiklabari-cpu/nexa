/**
 * Slot formats and `readSlot` (tm 295.2 · AI-04 §4): a TXID per network, a
 * wallet address where a TXID was asked, IBAN last four, e-mail, phone, URL,
 * tokens, enum options matched fuzzily, and the slot's own rules on top —
 * `min`/`max` flag, the author's `regex` narrows, "bilmiyorum" is `unknown`.
 */
import { validateSlotDef, type SlotDef } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { SLOT_TEXT_MAX } from './normalize-tr.js';
import {
  asCryptoNetwork,
  matchEnumOption,
  readCryptoNetwork,
  readEmail,
  readIbanLast4,
  readPhone,
  readSlot,
  readTxid,
  readUrl,
  walletAddressNetwork,
  type SlotReadContext,
} from './validators.js';

/** Saturday 2026-10-17 16:00 Istanbul. */
const ctx: SlotReadContext = {
  now: new Date('2026-10-17T13:00:00Z'),
  timeZone: 'Europe/Istanbul',
  currency: 'TRY',
};

/** A definition as the save-time validator would have stored it. */
function slot(def: Record<string, unknown>): SlotDef {
  const result = validateSlotDef({ label: 'Label', ask: 'Question?', ...def });
  if (result.slot === null) throw new Error(JSON.stringify(result.problems));
  return result.slot;
}

const TRON_TXID = 'b3c5a8f1d2e4c6a8b0d1f3e5a7c9b1d3f5e7a9c1b3d5f7e9a1c3b5d7f9e1a3c5';
const EVM_TXID = `0x${TRON_TXID}`;
const TRON_ADDRESS = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const EVM_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

describe('TXID per network (AI-04 §4: TRC20 64 hex; ERC20/BEP20 0x + 64 hex)', () => {
  it('fills a TRC20 id on TRON and an 0x id on an EVM chain, lower-cased', () => {
    expect(readTxid(TRON_TXID, 'TRC20')).toEqual({
      status: 'filled',
      value: TRON_TXID,
      display: TRON_TXID,
    });
    expect(
      readTxid(`işlem no: ${EVM_TXID.toUpperCase().replace('0X', '0x')}`, 'ERC20'),
    ).toMatchObject({
      status: 'filled',
      value: EVM_TXID,
    });
    expect(readTxid(EVM_TXID, 'BEP20')).toMatchObject({ status: 'filled' });
    // From an explorer link.
    expect(readTxid(`https://tronscan.org/#/transaction/${TRON_TXID}`, 'TRC20')).toMatchObject({
      value: TRON_TXID,
    });
  });

  it("refuses an id of the other network's shape", () => {
    expect(readTxid(EVM_TXID, 'TRC20')).toEqual({ status: 'invalid', reason: 'network_mismatch' });
    expect(readTxid(TRON_TXID, 'ERC20')).toEqual({ status: 'invalid', reason: 'network_mismatch' });
    expect(readTxid(TRON_TXID, 'BEP20')).toEqual({ status: 'invalid', reason: 'network_mismatch' });
  });

  it('takes either shape before the network is known', () => {
    expect(readTxid(TRON_TXID, null)).toMatchObject({ status: 'filled' });
    expect(readTxid(EVM_TXID, null)).toMatchObject({ status: 'filled' });
  });

  it('tells a wallet address, a cut-off id and two ids apart', () => {
    expect(readTxid(TRON_ADDRESS, 'TRC20')).toEqual({
      status: 'invalid',
      reason: 'address_not_txid',
    });
    expect(readTxid(EVM_ADDRESS, 'ERC20')).toEqual({
      status: 'invalid',
      reason: 'address_not_txid',
    });
    expect(readTxid(TRON_TXID.slice(1), 'TRC20')).toEqual({
      status: 'invalid',
      reason: 'bad_format',
    });
    expect(readTxid(`${TRON_TXID}ab`, 'TRC20')).toEqual({
      status: 'invalid',
      reason: 'bad_format',
    });
    expect(readTxid(`${TRON_TXID} ${TRON_TXID.replace('b3', 'c4')}`, null)).toEqual({
      status: 'invalid',
      reason: 'ambiguous',
    });
    expect(readTxid('gönderdim ama numarayı bulamadım', null)).toEqual({
      status: 'invalid',
      reason: 'unreadable',
    });
  });

  it('checks the network only for a network-aware slot', () => {
    const aware = slot({ name: 'txid', type: 'txid', validate: { network_aware: true } });
    const plain = slot({ name: 'txid', type: 'txid' });
    expect(readSlot(aware, EVM_TXID, { ...ctx, network: 'TRC20' })).toEqual({
      status: 'invalid',
      reason: 'network_mismatch',
    });
    expect(readSlot(plain, EVM_TXID, { ...ctx, network: 'TRC20' })).toMatchObject({
      status: 'filled',
    });
    expect(readSlot(aware, EVM_TXID, ctx)).toMatchObject({ status: 'filled' });
  });
});

describe('crypto network and wallet addresses (AI-04 §4 · research §3.2)', () => {
  it.each([
    ['USDT TRC-20 ile gönderdim', 'TRC20'],
    ['tron ağı', 'TRC20'],
    ['trc20den', 'TRC20'],
    ['ERC20', 'ERC20'],
    ["ethereum'dan", 'ERC20'],
    ['BSC', 'BEP20'],
    ['bep-20', 'BEP20'],
    [`adres ${TRON_ADDRESS}`, 'TRC20'],
  ])('%s → %s', (text, network) => {
    expect(readCryptoNetwork(text)).toEqual({ status: 'filled', value: network, display: network });
  });

  it('names no network for an EVM address, two networks or none', () => {
    expect(readCryptoNetwork(EVM_ADDRESS)).toEqual({ status: 'invalid', reason: 'unreadable' });
    expect(readCryptoNetwork('trc20 mi erc20 mi bilmiyorum')).toEqual({
      status: 'invalid',
      reason: 'ambiguous',
    });
    expect(readCryptoNetwork('usdt')).toEqual({ status: 'invalid', reason: 'unreadable' });
  });

  it('tells the address prefixes apart: T for TRON, 0x for EVM', () => {
    expect(walletAddressNetwork(TRON_ADDRESS)).toBe('TRC20');
    expect(walletAddressNetwork(EVM_ADDRESS)).toBe('EVM');
    expect(walletAddressNetwork(TRON_TXID)).toBeNull();
    expect(asCryptoNetwork('BEP20')).toBe('BEP20');
    expect(asCryptoNetwork('SOL')).toBeNull();
  });
});

describe('IBAN last four (AI-04 §2 iban_last4)', () => {
  it.each([
    ['8841', '8841'],
    ['son 4 hanesi 8841', '8841'],
    ['****8841', '****8841'.slice(-4)],
    ['TR33 0006 1005 1978 6457 8413 26 numaralı hesap', '1326'],
    ['tr330006100519786457841326', '1326'],
  ])('%s → %s', (text, last4) => {
    expect(readIbanLast4(text)).toEqual({ status: 'filled', value: last4, display: last4 });
  });

  it('never keeps more than the last four of a pasted IBAN', () => {
    const reading = readIbanLast4('TR33 0006 1005 1978 6457 8413 26');
    expect(JSON.stringify(reading)).not.toContain('0006');
  });

  it('refuses another length and two fours', () => {
    expect(readIbanLast4('88412')).toEqual({ status: 'invalid', reason: 'bad_format' });
    expect(readIbanLast4('8841 ya da 1326')).toEqual({ status: 'invalid', reason: 'ambiguous' });
    expect(readIbanLast4('hatırlamıyorum')).toEqual({ status: 'invalid', reason: 'unreadable' });
  });
});

describe('e-mail, phone, URL', () => {
  it('reads an e-mail, lower-cased', () => {
    expect(readEmail('mailim Ali.Veli@Example.com.')).toEqual({
      status: 'filled',
      value: 'ali.veli@example.com',
      display: 'ali.veli@example.com',
    });
    expect(readEmail('ali@')).toEqual({ status: 'invalid', reason: 'bad_format' });
    expect(readEmail('a@b.co veya c@d.co')).toEqual({ status: 'invalid', reason: 'ambiguous' });
  });

  it.each([
    ['0532 123 45 67', '+905321234567'],
    ['532 123 45 67', '+905321234567'],
    ['+90 (532) 123-4567', '+905321234567'],
    ['905321234567', '+905321234567'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('reads %s as %s', (text, phone) => {
    expect(readPhone(text)).toMatchObject({ status: 'filled', value: phone });
  });

  it('shows a Turkish number grouped and refuses a short one', () => {
    expect(readPhone('05321234567')).toMatchObject({ display: '+90 532 123 45 67' });
    expect(readPhone('123 45 67')).toEqual({ status: 'invalid', reason: 'bad_format' });
  });

  it('reads an http(s) URL; www. is https', () => {
    expect(readUrl('şu sayfa: https://site.example/odeme?id=5.')).toMatchObject({
      value: 'https://site.example/odeme?id=5',
    });
    expect(readUrl('www.site.example')).toMatchObject({ value: 'https://www.site.example/' });
    expect(readUrl('sayfa yok')).toEqual({ status: 'invalid', reason: 'unreadable' });
  });
});

describe('enum options, matched fuzzily (AI-04 §4 · AI-13)', () => {
  const methods = [
    { value: 'papara', label: 'Papara', aliases: ['PPR'] },
    { value: 'havale', label: 'Banka Havalesi', aliases: ['EFT', 'FAST'] },
    { value: 'usdt_trc20', label: 'USDT (TRC20)', aliases: ['tether'] },
  ];

  it.each([
    ['papara', 'papara'],
    ['Papara ile attım', 'papara'],
    ['paparayla', 'papara'],
    ["papara'dan", 'papara'],
    ['PPR', 'papara'],
    ['parpara', 'papara'],
    ['banka havalesi', 'havale'],
    ['havaleyle gönderdim', 'havale'],
    ['eft', 'havale'],
    ['tether', 'usdt_trc20'],
  ])('%s → %s', (text, value) => {
    expect(matchEnumOption(text, methods)).toMatchObject({ status: 'filled', value });
  });

  it('shows the option label, and refuses two options or none', () => {
    expect(matchEnumOption('havale', methods)).toMatchObject({ display: 'Banka Havalesi' });
    expect(matchEnumOption('papara mı havale mi', methods)).toEqual({
      status: 'invalid',
      reason: 'ambiguous',
    });
    expect(matchEnumOption('kredi kartı', methods)).toEqual({
      status: 'invalid',
      reason: 'not_an_option',
    });
    // A short alias is matched whole, never as a prefix or one edit away.
    expect(matchEnumOption('pprx', methods)).toEqual({
      status: 'invalid',
      reason: 'not_an_option',
    });
  });

  it("reads an author's enum_values from the definition and table options from the context", () => {
    const game = slot({
      name: 'oyun',
      type: 'enum',
      validate: { enum_values: ['Slot', 'Casino', 'Spor'] },
    });
    expect(readSlot(game, 'casinoda kaybettim', ctx)).toMatchObject({
      status: 'filled',
      value: 'Casino',
    });
    const method = slot({
      name: 'yontem',
      type: 'enum',
      validate: { enum_source: 'payment_methods.deposit' },
    });
    expect(readSlot(method, 'papara', { ...ctx, options: methods })).toMatchObject({
      value: 'papara',
    });
    // No table rows yet (#310): nothing to match against.
    expect(readSlot(method, 'papara', ctx)).toEqual({ status: 'invalid', reason: 'not_an_option' });
  });
});

describe('readSlot — by type, with the slot rules on top', () => {
  it('reads "dün akşam papara ile 2,5 bin attım": method and amount filled, the moment partial (AI-04 kabul)', () => {
    const message = 'dün akşam papara ile 2,5 bin attım';
    const yontem = slot({
      name: 'yontem',
      type: 'enum',
      validate: { enum_values: ['Papara', 'Havale', 'Kripto'] },
    });
    const tutar = slot({ name: 'tutar', type: 'money' });
    const zaman = slot({ name: 'islem_zamani', type: 'datetime' });
    expect(readSlot(yontem, message, ctx)).toEqual({
      status: 'filled',
      value: 'Papara',
      display: 'Papara',
    });
    expect(readSlot(tutar, message, ctx)).toEqual({
      status: 'filled',
      value: { amount: 2500, currency: 'TRY' },
      display: '2.500 TRY',
    });
    expect(readSlot(zaman, message, ctx)).toEqual({
      status: 'partial',
      value: {
        date: '2026-10-16',
        time: null,
        time_zone: 'Europe/Istanbul',
        part_of_day: 'evening',
      },
      display: '16.10.2026 akşam',
    });
    // The time asked next lands on that evening.
    const partial = readSlot(zaman, message, ctx);
    if (partial.status !== 'partial') throw new Error('expected partial');
    expect(readSlot(zaman, '21:40', { ...ctx, completing: partial.value as never })).toMatchObject({
      status: 'filled',
      display: '16.10.2026 21:40',
    });
  });

  it('flags a quantity outside min/max as out_of_range and keeps it', () => {
    const tutar = slot({ name: 'tutar', type: 'money', validate: { min: 100, max: 50_000 } });
    expect(readSlot(tutar, '50 TL', ctx)).toMatchObject({
      status: 'filled',
      value: { amount: 50 },
      out_of_range: 'below_min',
    });
    expect(readSlot(tutar, '60 bin', ctx)).toMatchObject({ out_of_range: 'above_max' });
    expect(readSlot(tutar, '2.500', ctx)).not.toHaveProperty('out_of_range');
    // A bound is in the tenant's currency: 50 USD is not compared.
    expect(readSlot(tutar, '50 dolar', ctx)).not.toHaveProperty('out_of_range');
    const count = slot({ name: 'deneme', type: 'number', validate: { max: 3 } });
    expect(readSlot(count, '5', ctx)).toMatchObject({ out_of_range: 'above_max' });
  });

  it("narrows free text, a username and a reference code with the author's regex (u flag)", () => {
    const user = slot({
      name: 'kullanici_adi',
      type: 'username',
      validate: { regex: '^[a-z0-9_]+$' },
    });
    expect(readSlot(user, 'kullanıcı adım: ali_123', ctx)).toEqual({
      status: 'filled',
      value: 'ali_123',
      display: 'ali_123',
    });
    expect(readSlot(user, '"Ali123"', ctx)).toEqual({
      status: 'invalid',
      reason: 'pattern_mismatch',
    });
    expect(readSlot(user, 'ali 123', ctx)).toEqual({ status: 'invalid', reason: 'ambiguous' });
    const code = slot({
      name: 'bonus_kodu',
      type: 'reference_code',
      validate: { regex: '^\\p{Lu}{3}-\\d+$' },
    });
    expect(readSlot(code, 'kodu: HOS-2026', ctx)).toMatchObject({
      status: 'filled',
      value: 'HOS-2026',
    });
    const note = slot({ name: 'not', type: 'text' });
    expect(readSlot(note, '  hesabım   kilitlendi ', ctx)).toMatchObject({
      value: 'hesabım kilitlendi',
    });
  });

  it('is unknown when the player does not know and gave nothing of the kind', () => {
    const zaman = slot({ name: 'islem_zamani', type: 'datetime' });
    const talep = slot({ name: 'talep_olusturuldu', type: 'boolean' });
    expect(readSlot(zaman, 'hatırlamıyorum', ctx)).toEqual({ status: 'unknown' });
    // "bilmiyorum" reads as a negated verb; for a yes/no it is still "does not know".
    expect(readSlot(talep, 'bilmiyorum', ctx)).toEqual({ status: 'unknown' });
    // A value beside it wins.
    expect(readSlot(zaman, 'tam saati hatırlamıyorum, dün akşam 9 gibi', ctx)).toMatchObject({
      status: 'filled',
      value: { date: '2026-10-16', time: '21:00' },
    });
  });

  it('reads every other type through its own reader', () => {
    expect(readSlot(slot({ name: 'gun', type: 'date' }), 'dün', ctx)).toMatchObject({
      status: 'filled',
    });
    expect(readSlot(slot({ name: 'sure', type: 'duration' }), 'yarım saat', ctx)).toMatchObject({
      value: 30,
    });
    expect(readSlot(slot({ name: 'ag', type: 'crypto_network' }), 'trc20', ctx)).toMatchObject({
      value: 'TRC20',
    });
    expect(readSlot(slot({ name: 'iban_son4', type: 'iban_last4' }), '8841', ctx)).toMatchObject({
      value: '8841',
    });
    expect(readSlot(slot({ name: 'eposta', type: 'email' }), 'a@b.co', ctx)).toMatchObject({
      value: 'a@b.co',
    });
    expect(readSlot(slot({ name: 'tel', type: 'phone' }), '05321234567', ctx)).toMatchObject({
      value: '+905321234567',
    });
    expect(readSlot(slot({ name: 'link', type: 'url' }), 'https://a.example', ctx)).toMatchObject({
      status: 'filled',
    });
    expect(readSlot(slot({ name: 'talep', type: 'boolean' }), 'evet', ctx)).toMatchObject({
      value: true,
    });
    expect(readSlot(slot({ name: 'dekont', type: 'file' }), 'gönderdim', ctx)).toEqual({
      status: 'invalid',
      reason: 'attachment_only',
    });
  });

  it('refuses words longer than a span', () => {
    expect(
      readSlot(slot({ name: 'not', type: 'text' }), 'a'.repeat(SLOT_TEXT_MAX + 1), ctx),
    ).toEqual({
      status: 'invalid',
      reason: 'too_long',
    });
  });
});
