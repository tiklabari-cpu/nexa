import { describe, expect, it } from 'vitest';
import { foldForSearch, rankCannedResponses } from './cannedSearch.js';
import { activeShortcutQuery, insertCannedReply } from './useCannedResponses.js';

const reply = (id: string, shortcut: string, text: string, visibility?: 'all' | 'private') => ({
  id,
  shortcut,
  text,
  ...(visibility ? { visibility } : {}),
});

describe('saved-reply search (IN-06)', () => {
  it('folds Turkish letters both ways', () => {
    expect(foldForSearch('ÇEKİM')).toBe('cekim');
    expect(foldForSearch('çekim')).toBe('cekim');
    expect(foldForSearch('IBAN')).toBe('iban');
    expect(foldForSearch('Şifre Güncelleme Öğrenci')).toBe('sifre guncelleme ogrenci');
  });

  it('finds "çekim" when the agent types "cekim"', () => {
    const items = [reply('1', 'withdraw', 'Çekim talebiniz alındı.'), reply('2', 'hi', 'Selam')];
    expect(rankCannedResponses(items, 'cekim').map((r) => r.id)).toEqual(['1']);
  });

  it('lists every reply that mentions the word — no cap of six', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      reply(String(i), `yatirim${i}`, `Papara ile yatırım ${i}`),
    );
    expect(rankCannedResponses(items, 'papara')).toHaveLength(10);
  });

  it('orders shortcut start, then shortcut inside, then text', () => {
    const items = [
      reply('text', 'aaa', 'papara süresi'),
      reply('inside', 'hizli-papara', 'x'),
      reply('start', 'papara', 'x'),
    ];
    expect(rankCannedResponses(items, 'papara').map((r) => r.id)).toEqual([
      'start',
      'inside',
      'text',
    ]);
  });

  it('puts a personal reply above a shared one with the same shortcut', () => {
    const items = [reply('shared', 'selam', 'Merhaba'), reply('mine', 'selam', 'Selam', 'private')];
    expect(rankCannedResponses(items, 'sel').map((r) => r.id)).toEqual(['mine', 'shared']);
  });

  it('offers every reply for a bare #', () => {
    const items = [reply('b', 'b', 'x'), reply('a', 'a', 'y')];
    expect(rankCannedResponses(items, '').map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps the picker open for a Turkish letter after #', () => {
    expect(activeShortcutQuery('Merhaba #çek', 12)).toEqual({ query: 'çek', from: 8 });
    expect(activeShortcutQuery('renk#fff', 8)).toBeNull();
  });

  it('fills the variables on insertion and selects the fallback phrase', () => {
    const value = 'Önce #sel';
    const result = insertCannedReply(
      value,
      value.length,
      5,
      'Merhaba {{customer.name}}, ben {{agent.first_name}}.',
      { 'customer.name': null, 'agent.first_name': 'Mert' },
      'Değerli üyemiz',
    );
    expect(result.text).toBe('Önce Merhaba Değerli üyemiz, ben Mert. ');
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('Değerli üyemiz');
  });

  it('puts the caret after the reply when every variable had a value', () => {
    const result = insertCannedReply(
      '#x',
      2,
      0,
      'Hi {{customer.name}}',
      { 'customer.name': 'Ece' },
      'F',
    );
    expect(result.text).toBe('Hi Ece ');
    expect(result.selectionStart).toBe(result.text.length);
    expect(result.selectionEnd).toBe(result.text.length);
  });
});
