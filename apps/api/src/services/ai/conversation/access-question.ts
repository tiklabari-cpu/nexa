/**
 * Whether a player's message asks how to reach the site (tm 310.4 · owner
 * decision K13 · AI-08 G14): "site açılmıyor", "güncel adres nedir", "siteye
 * nasıl girerim", "VPN mi lazım?", "the site won't open".
 *
 * Such a question is answered only from the workspace's access information
 * (`knowledge-tables/access-info.ts`) — never from a passage the search
 * happened to find, and never from the model's own idea of an address — and
 * handed over when there is none. So the words that make a message one are
 * kept narrow: the site, its address or its access in the same breath as not
 * opening, being blocked, or being new. A payment link that will not open, a
 * login that fails ("hesabıma giremiyorum") or a page of the cashier are not
 * access questions; they go on to the procedures and the knowledge base.
 *
 * Deterministic, no model, over the Turkish fold the slots use (`foldTr`):
 * the understanding call has no access intent, and a question it would read
 * one way today and another tomorrow cannot decide what the AI may say.
 */
import { foldTr } from './slots/normalize-tr.js';

/** Letters and digits only, one space between: "won't" is "won t". */
function wordsOf(text: string): string {
  return foldTr(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SITE_TR = '(site|siteniz|sitenize|siteye|siteyi|sitenizi|adres|adresiniz|adresinize)';
const BROKEN_TR =
  '(acilmiyor|acilmiyo|acilmadi|acamiyorum|acamadim|yuklenmiyor|calismiyor|girilmiyor|girmiyor|giremiyorum|giremedim|giris yapamiyorum|giris yapilmiyor|erisilemiyor|erisemiyorum|ulasilamiyor|ulasamiyorum|baglanamiyorum|kapandi|kapali|kapatildi|engellendi|engelli|engellenmis|yasaklandi|btk)';

const SITE_EN = '(site|website|address|url|domain)';

/** Each pattern runs over {@link wordsOf}; one match is enough. */
const ACCESS_QUESTION: readonly RegExp[] = [
  // "site açılmıyor", "siteye giremiyorum", "adresiniz BTK tarafından engellendi"
  new RegExp(`\\b${SITE_TR}( [a-z0-9]+){0,3} ${BROKEN_TR}\\b`),
  // "güncel adres nedir", "yeni giriş adresiniz", "aktif link", "çalışan domain"
  /\b(guncel|yeni|son|aktif|calisan|gecerli) (giris (adresi|adresiniz|adresini|linki|linkiniz|linkini)|adres|adresi|adresiniz|adresinizi|adresimiz|domain|domaininiz|alan adi|alan adiniz|site adresi|site adresiniz)\b/,
  /\b(guncel|aktif|calisan|gecerli) (link|linki|linkiniz)\b/,
  // "giriş adresi ne", "erişim sorunu"
  /\b(giris (adresi|adresiniz|adresini|linki|linkiniz|linkini)|erisim (sorunu|sorunum|problemi|engeli|sikintisi|adresi|linki))\b/,
  // "siteye nasıl girerim"
  /\b(siteye|sitenize) (nasil|nereden) (girerim|girebilirim|giris yaparim|ulasirim|ulasabilirim|erisirim|erisebilirim)\b/,
  // "the site won't open", "website isn't loading"
  new RegExp(
    `\\b${SITE_EN}( [a-z0-9]+){0,2} (won t|wont|doesn t|does not|isn t|is not|not|can t|cannot) (open|load|work|opening|loading|working|be reached)\\b`,
  ),
  /\b(can t|cannot|can not|unable to|couldn t|could not) (access|open|reach|load|get into|get to|enter) (the |your )?(site|website)\b/,
  /\b(new|current|latest|working|updated|valid) ((site|website|login|access|entry) (address|domain|url|link)|address|domain|url|mirror)\b/,
  /\b(site|website) (is )?(blocked|down|banned)\b/,
  // A VPN, a proxy or a DNS change asked about is an access question in either language.
  /\b(vpn|proxy|proksi|dns)\b/,
];

export function isAccessQuestion(text: string): boolean {
  const words = wordsOf(text);
  if (words === '') return false;
  return ACCESS_QUESTION.some((pattern) => pattern.test(words));
}
