import type { Messages } from '../merge.js';

/** Chrome that surrounds every screen: the shell header, the rail, the palette. */
export const shell: Messages = {
  // Shell chrome
  'shell.modules': 'Modüller',
  'shell.subscribe': 'Abone Ol',
  'shell.trial.ended': 'Deneme süreniz sona erdi — yeni sohbetler başlatmak için abone olun.',
  // Turkish does not inflect a noun after a numeral, so both plural categories
  // read the same. Both are still written out: `Intl.PluralRules('tr')` does
  // return `one` for 1, and a locale that answered only `other` would quietly
  // fall back to English for every count of one.
  'shell.trial.remaining.one': 'Deneme sürenizde {count} gün kaldı.',
  'shell.trial.remaining.other': 'Deneme sürenizde {count} gün kaldı.',
  'shell.account': 'Hesap',
  'shell.account.agentFallback': 'Temsilci',
  'shell.account.signOut': 'Çıkış Yap',
  'shell.account.language': 'Dil',
  'shell.account.theme': 'Tema',
  'shell.account.theme.dark': 'Koyu',
  'shell.account.theme.light': 'Açık',
  'shell.brand': 'Marka',
  'shell.sandbox.notice':
    'Kum havuzu çalışma alanı — burada hiçbir şey faturalandırılmaz ve hiçbiri gerçek veri değildir.',
  'shell.nav.expand': 'Gezinmeyi genişlet',
  'shell.nav.collapse': 'Gezinmeyi daralt',

  // Presence (FR-MOD-01.1.4). Both plural categories are written out for the
  // reason the trial countdown above states.
  'shell.presence.label': 'Çevrimiçi ekip arkadaşları',
  'shell.presence.accepting': 'sohbet kabul ediyor',
  'shell.presence.away': 'çevrimiçi, sohbet kabul etmiyor',
  'shell.presence.member': '{name} — {status}',
  'shell.presence.more.one': '{count} kişi daha çevrimiçi: {names}',
  'shell.presence.more.other': '{count} kişi daha çevrimiçi: {names}',

  // Navigation
  'nav.home': 'Ana Sayfa',
  'nav.inbox': 'Gelen Kutusu',
  'nav.customers': 'Müşteriler',
  'nav.team': 'Ekip',
  'nav.playbook': 'Senaryolar',
  'nav.reports': 'Raporlar',
  'nav.billing': 'Faturalandırma',
  'nav.settings': 'Ayarlar',
  'nav.developers': 'Geliştiriciler',

  // Command palette
  'palette.label': 'Komut paleti',
  'palette.search': 'Ara veya git',
  'palette.placeholder': 'Metin ara veya git…',
  'palette.searching': 'Aranıyor…',
  'palette.noMatches': 'Eşleşme yok.',
  'palette.group.goTo': 'Git',
  'palette.group.actions': 'Aksiyonlar',
  'palette.group.customers': 'Müşteriler',
  'palette.group.conversations': 'Sohbetler',
  'palette.group.tickets': 'Talepler',
  'palette.unnamedVisitor': 'İsimsiz ziyaretçi',
  'palette.visitor': 'Ziyaretçi',
  'palette.action.failed': 'Bu aksiyon gerçekleşmedi.',
  'palette.action.failedFallback': 'Hiçbir şey değişmedi — yeniden deneyin.',
  'palette.action.failedDismiss': 'Kapat',
  'palette.group.ai': "AI'ya Sor",
  'palette.ai.ask': `AI'ya sor: "{query}"`,
  'palette.ai.source': 'Kaynak: {source}',
  'palette.ai.noData.title': 'Henüz veri yok',
  'palette.ai.notUnderstood.title': 'Ne demek istediğinizden emin değilim',
  'palette.ai.error': 'Cevap alınamadı — yeniden deneyin.',
};
