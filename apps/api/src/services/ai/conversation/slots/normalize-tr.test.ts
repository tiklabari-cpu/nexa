/**
 * Turkish player text → slot values (tm 295.2 · AI-04 §4). Table-driven: each
 * row is what a player writes and what the reader must make of it. The clock
 * is fixed — Saturday 17 October 2026, 16:00 in Istanbul — so "dün", "salı"
 * and "2 saat önce" have one right answer.
 */
import { describe, expect, it } from 'vitest';
import {
  SLOT_MAX_AGE_DAYS,
  foldTr,
  isUnknownAnswer,
  parseAmountTr,
  parseBooleanTr,
  parseDateTimeTr,
  parseDigits,
  parseDurationTr,
  parseNumberTr,
  type NormalizeContext,
} from './normalize-tr.js';

const ISTANBUL = 'Europe/Istanbul';
/** Saturday 2026-10-17 16:00 Istanbul (UTC+3). */
const ctx: NormalizeContext = {
  now: new Date('2026-10-17T13:00:00Z'),
  timeZone: ISTANBUL,
  currency: 'TRY',
};

describe('amounts (AI-04 §4: "2,5 bin", "2.500", "2500tl", "₺2.500,00" → 2500 TRY)', () => {
  it.each([
    ['2,5 bin', 2500, 'TRY', '2.500 TRY'],
    ['2.500', 2500, 'TRY', '2.500 TRY'],
    ['2500tl', 2500, 'TRY', '2.500 TRY'],
    ['₺2.500,00', 2500, 'TRY', '2.500 TRY'],
    ['2500', 2500, 'TRY', '2.500 TRY'],
    ['2,500 TL', 2500, 'TRY', '2.500 TRY'],
    ['1.250,50 TL', 1250.5, 'TRY', '1.250,50 TRY'],
    ['1,250.50', 1250.5, 'TRY', '1.250,50 TRY'],
    ['1.250.000 lira', 1_250_000, 'TRY', '1.250.000 TRY'],
    ['2.5k', 2500, 'TRY', '2.500 TRY'],
    ['3K attım', 3000, 'TRY', '3.000 TRY'],
    ['iki bin beş yüz', 2500, 'TRY', '2.500 TRY'],
    ['ikibinbeşyüz tl', 2500, 'TRY', '2.500 TRY'],
    ['iki buçuk bin', 2500, 'TRY', '2.500 TRY'],
    ['bin buçuk lira', 1500, 'TRY', '1.500 TRY'],
    ['yüz elli lira', 150, 'TRY', '150 TRY'],
    ['10 bin 500', 10_500, 'TRY', '10.500 TRY'],
    ['1,5 milyon', 1_500_000, 'TRY', '1.500.000 TRY'],
    ['300 türk lirası', 300, 'TRY', '300 TRY'],
    ["500 TL'yi yatırdım", 500, 'TRY', '500 TRY'],
    ['500 dolar', 500, 'USD', '500 USD'],
    ['$100', 100, 'USD', '100 USD'],
    ['50 euro', 50, 'EUR', '50 EUR'],
    ['100 usdt gönderdim', 100, 'USDT', '100 USDT'],
    ['dün akşam papara ile 2,5 bin attım', 2500, 'TRY', '2.500 TRY'],
    ['2 saat önce 500 attım', 500, 'TRY', '500 TRY'],
    ["13:40'ta 300 tl", 300, 'TRY', '300 TRY'],
    ['13.10.2026 tarihinde 750 TL', 750, 'TRY', '750 TRY'],
  ])('%s → %d %s', (text, amount, currency, display) => {
    expect(parseAmountTr(text, ctx)).toEqual({
      status: 'filled',
      value: { amount, currency },
      display,
    });
  });

  it("takes the tenant's currency when the player names none", () => {
    expect(parseAmountTr('2.500', { currency: 'EUR' })).toMatchObject({
      value: { amount: 2500, currency: 'EUR' },
      display: '2.500 EUR',
    });
  });

  it.each([
    ['500 ile 1000 arası', 'ambiguous'],
    ['500 TL mi 700 TL mi', 'ambiguous'],
    ['0 TL', 'not_positive'],
    ['yatırdım ama tutarı söylemem', 'unreadable'],
    ['2 saat önce', 'unreadable'],
    ['3 kere denedim', 'unreadable'],
    ['bir kere', 'unreadable'],
  ])('%s → invalid %s', (text, reason) => {
    expect(parseAmountTr(text, ctx)).toEqual({ status: 'invalid', reason });
  });

  it('reads separators the Turkish way, and one comma or dot before three digits as thousands', () => {
    expect(parseDigits('2.500')).toBe(2500);
    expect(parseDigits('2,500')).toBe(2500);
    expect(parseDigits('2,5')).toBe(2.5);
    expect(parseDigits('12.50')).toBe(12.5);
    expect(parseDigits('1.250,50')).toBe(1250.5);
    expect(parseDigits('1,250.50')).toBe(1250.5);
    expect(parseDigits('1.250.000')).toBe(1_250_000);
    expect(parseDigits('1.25.000')).toBeNull();
    expect(parseDigits('abc')).toBeNull();
  });
});

describe('dates and times in the tenant zone (AI-04 §4 · ID-04)', () => {
  it.each([
    // [words, date, time, status]
    ['13:40', '2026-10-17', '13:40', 'filled'],
    ["13:40'ta yatırdım", '2026-10-17', '13:40', 'filled'],
    ['saat 13.40', '2026-10-17', '13:40', 'filled'],
    ['13.40', '2026-10-17', '13:40', 'filled'],
    ['09:30', '2026-10-17', '09:30', 'filled'],
    ['bugün 10:15', '2026-10-17', '10:15', 'filled'],
    ['dün 13:40', '2026-10-16', '13:40', 'filled'],
    ['dün akşam 8', '2026-10-16', '20:00', 'filled'],
    ["dün akşam 8'de", '2026-10-16', '20:00', 'filled'],
    ['bu sabah 9da', '2026-10-17', '09:00', 'filled'],
    ['öğleden sonra 3', '2026-10-17', '15:00', 'filled'],
    ['saat üç buçuk', '2026-10-17', '15:30', 'filled'],
    ['9 buçukta', '2026-10-17', '09:30', 'filled'],
    ['yarım saat önce', '2026-10-17', '15:30', 'filled'],
    ['2 saat önce', '2026-10-17', '14:00', 'filled'],
    ['10 dk önce', '2026-10-17', '15:50', 'filled'],
    ['bir buçuk saat önce', '2026-10-17', '14:30', 'filled'],
    ['13.10.2026 13:40', '2026-10-13', '13:40', 'filled'],
    ['13.10 saat 14', '2026-10-13', '14:00', 'filled'],
    ['2026-10-15 22:10', '2026-10-15', '22:10', 'filled'],
    ['dün akşam', '2026-10-16', null, 'partial'],
    ['az önce', '2026-10-17', null, 'partial'],
    ['demin attım', '2026-10-17', null, 'partial'],
    ['evvelki gün', '2026-10-15', null, 'partial'],
    ['3 gün önce', '2026-10-14', null, 'partial'],
    ['salı', '2026-10-13', null, 'partial'],
    ['geçen cumartesi', '2026-10-10', null, 'partial'],
    ['13 ekim', '2026-10-13', null, 'partial'],
    ["13 Ekim'de", '2026-10-13', null, 'partial'],
    ['13/10', '2026-10-13', null, 'partial'],
    ['bu sabah', '2026-10-17', null, 'partial'],
  ])('%s → %s %s (%s)', (text, date, time, status) => {
    const reading = parseDateTimeTr(text, ctx);
    expect(reading).toMatchObject({ status, value: { date, time, time_zone: ISTANBUL } });
  });

  it('a time alone is its latest occurrence that is not in the future', () => {
    // 23:40 has not come yet today at 16:00 → last night.
    expect(parseDateTimeTr('23:40', ctx)).toMatchObject({
      status: 'filled',
      value: { date: '2026-10-16', time: '23:40' },
    });
    // "saat 3" at 16:00 → 15:00, not 03:00; "9:30" → 09:30, since 21:30 is ahead.
    expect(parseDateTimeTr('saat 3', ctx)).toMatchObject({
      value: { date: '2026-10-17', time: '15:00' },
    });
    expect(parseDateTimeTr('9:30', ctx)).toMatchObject({
      value: { date: '2026-10-17', time: '09:30' },
    });
    // "akşam" before the evening has begun is yesterday's.
    expect(parseDateTimeTr('akşam', ctx)).toMatchObject({
      status: 'partial',
      value: { date: '2026-10-16', time: null, part_of_day: 'evening' },
      display: '16.10.2026 akşam',
    });
  });

  it('puts "dün gece 2\'de" on the night that began yesterday', () => {
    expect(parseDateTimeTr("dün gece 2'de", ctx)).toMatchObject({
      status: 'filled',
      value: { date: '2026-10-17', time: '02:00', part_of_day: 'night' },
    });
    expect(parseDateTimeTr('dün gece 11', ctx)).toMatchObject({
      value: { date: '2026-10-16', time: '23:00' },
    });
  });

  it('refuses the future and anything over 30 days back', () => {
    expect(SLOT_MAX_AGE_DAYS).toBe(30);
    expect(parseDateTimeTr('yarın', ctx)).toEqual({ status: 'invalid', reason: 'future' });
    expect(parseDateTimeTr('bugün 18:00', ctx)).toEqual({ status: 'invalid', reason: 'future' });
    expect(parseDateTimeTr('40 gün önce', ctx)).toEqual({ status: 'invalid', reason: 'too_old' });
    expect(parseDateTimeTr('01.09.2026', ctx)).toEqual({ status: 'invalid', reason: 'too_old' });
    expect(parseDateTimeTr('17.09.2026', ctx)).toMatchObject({ status: 'partial' });
    // A clock a few minutes ahead of ours is still now.
    expect(parseDateTimeTr('bugün 16:04', ctx)).toMatchObject({ status: 'filled' });
  });

  it('refuses a day the calendar does not have and words that name no moment', () => {
    expect(parseDateTimeTr('31.02.2026', ctx)).toEqual({ status: 'invalid', reason: 'bad_format' });
    expect(parseDateTimeTr('geçen hafta', ctx)).toEqual({
      status: 'invalid',
      reason: 'unreadable',
    });
    expect(parseDateTimeTr('papara ile', ctx)).toEqual({ status: 'invalid', reason: 'unreadable' });
  });

  it('reads "dün akşam" out of the whole message without taking the amount for an hour', () => {
    expect(parseDateTimeTr('dün akşam papara ile 2,5 bin attım', ctx)).toEqual({
      status: 'partial',
      value: { date: '2026-10-16', time: null, time_zone: ISTANBUL, part_of_day: 'evening' },
      display: '16.10.2026 akşam',
    });
    expect(parseDateTimeTr('akşam 20 TL attım', ctx)).toMatchObject({
      status: 'partial',
      value: { time: null },
    });
  });

  it('lands a time given later on the day of the partial moment it completes', () => {
    const duskYesterday = {
      date: '2026-10-16',
      time: null,
      time_zone: ISTANBUL,
      part_of_day: 'evening' as const,
    };
    expect(parseDateTimeTr('21:30', ctx, { completing: duskYesterday })).toEqual({
      status: 'filled',
      value: { ...duskYesterday, time: '21:30' },
      display: '16.10.2026 21:30',
    });
    // The part of the day comes along: "9 gibi" after "dün akşam" is 21:00.
    expect(parseDateTimeTr('9 gibi', ctx, { completing: duskYesterday })).toMatchObject({
      value: { date: '2026-10-16', time: '21:00' },
    });
    // Words with no time keep nothing of it.
    expect(parseDateTimeTr('papara', ctx, { completing: duskYesterday })).toEqual({
      status: 'invalid',
      reason: 'unreadable',
    });
    // A day of their own wins over the partial one.
    expect(parseDateTimeTr('bugün 10:00', ctx, { completing: duskYesterday })).toMatchObject({
      value: { date: '2026-10-17', time: '10:00' },
    });
    // Further back than yesterday: "salı akşam", then "21:30" — Tuesday, not
    // the latest 21:30 (last night).
    const tuesday = parseDateTimeTr('salı akşam', ctx);
    expect(tuesday).toMatchObject({ status: 'partial', value: { date: '2026-10-13' } });
    if (tuesday.status !== 'partial') throw new Error('expected partial');
    expect(parseDateTimeTr('21:30', ctx, { completing: tuesday.value })).toMatchObject({
      status: 'filled',
      value: { date: '2026-10-13', time: '21:30', part_of_day: 'evening' },
    });
  });

  it("reads the day in the tenant's zone, not the server's", () => {
    // 22:30 UTC on the 17th is 01:30 on the 18th in Istanbul.
    const late = { now: new Date('2026-10-17T22:30:00Z') };
    expect(parseDateTimeTr('bugün', { ...late, timeZone: ISTANBUL })).toMatchObject({
      value: { date: '2026-10-18', time_zone: ISTANBUL },
    });
    expect(parseDateTimeTr('bugün', { ...late, timeZone: 'UTC' })).toMatchObject({
      value: { date: '2026-10-17', time_zone: 'UTC' },
    });
    // "23:40" at 01:30 Istanbul is a moment ago, last night.
    expect(parseDateTimeTr('23:40', { ...late, timeZone: ISTANBUL })).toMatchObject({
      value: { date: '2026-10-17', time: '23:40' },
    });
  });

  it('reads a date slot from the day alone', () => {
    expect(parseDateTimeTr('dün', ctx, { dateOnly: true })).toEqual({
      status: 'filled',
      value: { date: '2026-10-16', time: null, time_zone: ISTANBUL },
      display: '16.10.2026',
    });
    expect(parseDateTimeTr('13.10', ctx, { dateOnly: true })).toMatchObject({
      status: 'filled',
      value: { date: '2026-10-13' },
    });
  });
});

describe('yes / no (AI-04 §4: evet/hayır/var/yok/olmadı → boolean)', () => {
  it.each([
    ['evet', true],
    ['Evet, oluşturdum', true],
    ['evettt', true],
    ['var', true],
    ['oldu', true],
    ['tabii ki', true],
    ['aynen', true],
    ['oluşturdum', true],
    ['kendim gönderdim', true],
    ['hayır', false],
    ['HAYIR', false],
    ['hayir', false],
    ['yok', false],
    ['yoook', false],
    ['olmadı', false],
    ['değil', false],
    ['kendi hesabımdan değil', false],
    ['göndermedim', false],
    ['talep oluşturmadım', false],
    ['kartım yok', false],
  ])('%s → %s', (text, value) => {
    expect(parseBooleanTr(text)).toEqual({
      status: 'filled',
      value,
      display: value ? 'Evet' : 'Hayır',
    });
  });

  it('calls both answers ambiguous and no answer unreadable', () => {
    expect(parseBooleanTr('evet ama olmadı')).toEqual({ status: 'invalid', reason: 'ambiguous' });
    expect(parseBooleanTr('gönderdim ama gelmedi')).toEqual({
      status: 'invalid',
      reason: 'ambiguous',
    });
    expect(parseBooleanTr('papara')).toEqual({ status: 'invalid', reason: 'unreadable' });
  });
});

describe('durations and numbers', () => {
  it.each([
    ['yarım saat', 30, '30 dk'],
    ['çeyrek saat', 15, '15 dk'],
    ['45 dakika', 45, '45 dk'],
    ['1 saat 20 dk', 80, '1 saat 20 dk'],
    ['1,5 saat', 90, '1 saat 30 dk'],
    ['bir buçuk saat', 90, '1 saat 30 dk'],
    ['2 gün', 2880, '2 gün'],
    ['1 saattir bekliyorum', 60, '1 saat'],
  ])('%s → %d minutes', (text, value, display) => {
    expect(parseDurationTr(text)).toEqual({ status: 'filled', value, display });
  });

  it('refuses a duration with no count', () => {
    expect(parseDurationTr('biraz')).toEqual({ status: 'invalid', reason: 'unreadable' });
    expect(parseDurationTr('0 dakika')).toEqual({ status: 'invalid', reason: 'not_positive' });
  });

  it.each([
    ['3', 3, '3'],
    ['üç', 3, '3'],
    ['yirmi beş', 25, '25'],
    ['3 kere', 3, '3'],
    ['2,5', 2.5, '2,5'],
  ])('%s → %d', (text, value, display) => {
    expect(parseNumberTr(text)).toEqual({ status: 'filled', value, display });
  });

  it('calls two numbers ambiguous', () => {
    expect(parseNumberTr('3 ya da 4')).toEqual({ status: 'invalid', reason: 'ambiguous' });
  });
});

describe('the player does not know (AI-04 §5 unknown)', () => {
  it.each(['bilmiyorum', 'Hatırlamıyorum', 'emin değilim', 'fikrim yok', "I don't know"])(
    '%s',
    (text) => {
      expect(isUnknownAnswer(text)).toBe(true);
    },
  );

  it('is not set off by a plain answer', () => {
    expect(isUnknownAnswer('evet')).toBe(false);
    expect(isUnknownAnswer('2500 TL')).toBe(false);
  });

  it('folds Turkish letters and case, keeping digits and punctuation', () => {
    expect(foldTr('  DÜN  Akşam ₺2.500,00  ')).toBe('dun aksam ₺2.500,00');
    expect(foldTr('İŞLEM ÇIKIŞI ĞÜÖ')).toBe('islem cikisi guo');
  });
});
