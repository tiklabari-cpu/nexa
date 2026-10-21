/**
 * Which messages are access questions (tm 310.4 · K13 · AI-08 G14): the ones
 * the access information answers, and nothing else — a payment link, a login
 * or the cashier page stay with the procedures and the knowledge base.
 */
import { describe, expect, it } from 'vitest';
import { isAccessQuestion } from './access-question.js';

describe('access questions (K13)', () => {
  it.each([
    'site açılmıyor güncel adres nedir',
    'Siteye giremiyorum',
    'sitenize bir türlü erişemiyorum',
    'Siteniz BTK tarafından engellendi mi?',
    'adresiniz kapandı galiba',
    'Güncel giriş adresiniz nedir?',
    'yeni adresiniz ne',
    'Aktif link atar mısınız',
    'çalışan domain hangisi',
    'giriş linki nedir',
    'erişim sorunu yaşıyorum',
    'Siteye nasıl girerim?',
    'VPN ile mi girmem gerekiyor?',
    'DNS değiştirmem lazım mı',
    "The site won't open",
    'website is not loading',
    "I can't access the site",
    'what is the current address?',
    'is there a new login link',
    'the website is blocked here',
  ])('“%s” is one', (text) => {
    expect(isAccessQuestion(text)).toBe(true);
  });

  it.each([
    'Merhaba, yatırımım hesabıma geçmedi',
    'hesabıma giremiyorum şifremi unuttum',
    'giriş yapamıyorum şifre hatalı diyor',
    'Siteye giriş yaptım ama bakiyem görünmüyor',
    'Papara linki açılmıyor',
    'ödeme sayfası açılmıyor',
    'yeni link gönderir misiniz',
    'adresimi değiştirmek istiyorum',
    'yeni adresime fatura gelsin',
    'ara ara bağlantı kopuyor',
    'slot oyununda takıldı bakiyem düştü',
    'Bonus çevrim şartı nedir?',
    'the payment page will not load',
    'I forgot my password',
    '',
  ])('“%s” is not', (text) => {
    expect(isAccessQuestion(text)).toBe(false);
  });
});
