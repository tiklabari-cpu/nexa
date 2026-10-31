/**
 * The one search fold (IN-06 · IN-08 · IN-11): Turkish case first, then marks
 * off, and a ranking helper that folds both sides itself.
 */
import { describe, expect, it } from 'vitest';
import { foldForSearch, matchRank } from './text-fold.js';

describe('foldForSearch', () => {
  it('folds Turkish capitals the Turkish way, so "İKİ" and "IKI" both reach "iki"', () => {
    expect(foldForSearch('İKİ ADIMLI')).toBe('iki adimli');
    // English `toLowerCase` turns İ into "i" + a combining dot and I into "i";
    // here I is ı, which then maps to i — the same word either way.
    expect(foldForSearch('IKI ADIMLI')).toBe('iki adimli');
  });

  it('drops Turkish marks from both the typed text and the stored text', () => {
    expect(foldForSearch('Şifre ÇÖZÜM ğ')).toBe('sifre cozum g');
    expect(foldForSearch('sifre')).toBe(foldForSearch('şifre'));
    expect(foldForSearch('Hazır yanıtlar')).toBe(foldForSearch('hazir yanitlar'));
  });
});

describe('matchRank', () => {
  it('ranks a label start 0, a label inside 1, an alias 2, anything else null', () => {
    expect(matchRank('iki', 'İki adımlı doğrulama', ['mfa'])).toBe(0);
    expect(matchRank('adimli', 'İki adımlı doğrulama', ['mfa'])).toBe(1);
    expect(matchRank('mfa', 'İki adımlı doğrulama', ['mfa'])).toBe(2);
    expect(matchRank('fatura', 'İki adımlı doğrulama', ['mfa'])).toBeNull();
  });

  it('folds the alias as well as the label', () => {
    expect(matchRank('SIFRE', 'Profilim', ['şifre'])).toBe(2);
  });

  it('matches nothing for a blank query', () => {
    expect(matchRank('', 'Profilim')).toBeNull();
    expect(matchRank('   ', 'Profilim')).toBeNull();
  });
});
