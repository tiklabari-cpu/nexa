import type { Messages } from '../merge.js';

/** Chrome that surrounds every screen: the shell header, the rail, the palette. */
export const shell: Messages = {
  // Shell chrome
  // Availability notices (WG-03 · tm 340.3) — PresenceNotices.tsx
  'shell.presence.title': 'Durumunuz değişti',
  'shell.presence.unresponsive':
    'Size atanan bir sohbet {duration} boyunca yanıtsız kaldı; sohbet bir ekip arkadaşınıza aktarıldı ve durumunuz “Kabul etmiyor” yapıldı.',
  'shell.presence.unresponsive.noDuration':
    'Size atanan bir sohbet çok uzun süre yanıtsız kaldı; sohbet bir ekip arkadaşınıza aktarıldı ve durumunuz “Kabul etmiyor” yapıldı.',
  'shell.presence.disconnected':
    'Konsolunuz {duration} boyunca hiçbir pencerede bağlı değildi; durumunuz “Çevrimdışı” yapıldı ve yeni sohbetler başkalarına gitti.',
  'shell.presence.disconnected.noDuration':
    'Konsolunuz bir süre hiçbir pencerede bağlı değildi; durumunuz “Çevrimdışı” yapıldı ve yeni sohbetler başkalarına gitti.',
  'shell.presence.changedWhileAway':
    'Bağlantınız koptuğu sırada durumunuz “{status}” olarak değişti.',
  'shell.presence.acceptAgain': 'Yeniden sohbet kabul et',
  'shell.presence.acceptFailed': 'Durumunuz değiştirilemedi. Yeniden deneyin.',
  'shell.presence.dismiss': 'Bu bildirimi kapat',
  'shell.presence.duration.minutes.one': '{count} dakika',
  'shell.presence.duration.minutes.other': '{count} dakika',
  'shell.presence.duration.seconds.one': '{count} saniye',
  'shell.presence.duration.seconds.other': '{count} saniye',
  'shell.presence.alert.title': 'Yanıtsız bekleyen bir sohbet var',
  'shell.presence.alert.noAgent':
    '{agent} yeni bir sohbete zamanında yanıt vermedi ve ekipte boş kimse yoktu. Sohbet ekibin kuyruğunun başında bekliyor.',
  'shell.presence.alert.transferLimit.one':
    'Yeni bir sohbet {count} ajan tarafından yanıtsız bırakıldı. Kararınız için ekibin kuyruğunun başında bekliyor.',
  'shell.presence.alert.transferLimit.other':
    'Yeni bir sohbet art arda {count} ajan tarafından yanıtsız bırakıldı. Kararınız için ekibin kuyruğunun başında bekliyor.',
  'shell.presence.alert.unclaimed':
    'Manuel atamalı bir ekibin kuyruğundaki sohbeti kimse almadı. Hâlâ orada bekliyor.',
  'shell.presence.alert.someone': 'Bir ajan',
  'shell.presence.alert.open': 'Sohbeti aç',
  'shell.modules': 'Modüller',
  'shell.skipToContent': 'İçeriğe atla',
  'shell.notFound.title': 'Sayfa bulunamadı',
  'shell.notFound.description':
    'Bu adreste bir sayfa yok. Taşınmış olabilir ya da bağlantı yanlış yazılmış olabilir.',
  'shell.notFound.back': 'Gelen kutusuna git',
  'shell.narrow.title': 'Panel masaüstü için tasarlandı',
  'shell.narrow.body':
    'Bu ekran panelin düzeninden dar; bazı sütunlar sığmayacak ve sayfanın bir kısmı yana kaydırma gerektirebilir.',
  'shell.narrow.mobileApp':
    'Telefonda sohbetleri yanıtlamak için SiyahTuş mobil uygulaması daha uygundur.',
  'shell.narrow.continue': 'Yine de devam et',
  'shell.maintenance.readOnly':
    'Bakım sürüyor — konsol şimdilik salt okunur, değişiklikler kaydedilmez.',
  'shell.maintenance.title': 'Bakımdayız',
  'shell.maintenance.body': 'SiyahTuş bakımda ve şu an kullanılamıyor. Verileriniz güvende.',
  'shell.maintenance.autoRetry': 'Bu sayfa her dakika kendiliğinden yeniden kontrol eder.',
  // Bir SiyahTuş operatörü bu üye olarak giriş yaptı (tm 389.15): kırmızı şerit.
  'shell.impersonation.label': 'Destek oturumu',
  'shell.impersonation.readOnly':
    '{email} olarak giriş yapıldı — salt okunur, hiçbir şey değiştirilemez.',
  'shell.impersonation.full':
    '{email} olarak giriş yapıldı — tam erişim: değişiklikler bu üye adına yapılır.',
  'shell.impersonation.endsIn': 'Kalan süre {time}',
  'shell.impersonation.end': 'Oturumu bitir',
  'shell.impersonation.ending': 'Bitiriliyor…',
  'shell.subscribe': 'Abone Ol',
  'shell.trial.ended': 'Deneme süreniz sona erdi — yeni sohbetler başlatmak için abone olun.',
  'shell.pilotTrial.remaining.one':
    'Pilot denemeniz {count} gün sonra bitiyor — devam için {email}.',
  'shell.pilotTrial.remaining.other':
    'Pilot denemeniz {count} gün sonra bitiyor — devam için {email}.',
  'shell.pilotTrial.ended': 'Pilot denemeniz bitti — devam için {email} ile iletişime geçin.',
  'shell.pilotTrial.noContact.remaining.one': 'Pilot denemeniz {count} gün sonra bitiyor.',
  'shell.pilotTrial.noContact.remaining.other': 'Pilot denemeniz {count} gün sonra bitiyor.',
  'shell.pilotTrial.noContact.ended': 'Pilot denemeniz bitti.',
  // Turkish does not inflect a noun after a numeral, so both plural categories
  // read the same. Both are still written out: `Intl.PluralRules('tr')` does
  // return `one` for 1, and a locale that answered only `other` would quietly
  // fall back to English for every count of one.
  'shell.trial.remaining.one': 'Deneme sürenizde {count} gün kaldı.',
  'shell.trial.remaining.other': 'Deneme sürenizde {count} gün kaldı.',
  'shell.account': 'Hesap',
  'shell.account.agentFallback': 'Temsilci',
  'shell.account.signOut': 'Çıkış Yap',
  'shell.account.profile': 'Profilim',
  'shell.account.language': 'Dil',
  'shell.account.theme': 'Tema',
  'shell.account.theme.dark': 'Koyu',
  'shell.account.theme.light': 'Açık',
  // Panel yazı tipi ön ayarları (sahip, 2026-10-13). Adlar fontların kendi
  // adıdır, her dilde Latin harfleriyle kalır.
  'shell.account.font': 'Yazı tipi',
  'shell.account.font.workspaceDefault': 'Çalışma alanı varsayılanı',
  'shell.account.font.source.builtin': 'Yerleşik: {font}',
  'shell.account.font.source.workspace': 'Çalışma alanı varsayılanı: {font} · {date}',
  'shell.account.font.source.user': 'Senin seçimin: {font} · {date}',
  'shell.account.font.saveError': 'Yazı tipi kaydedilemedi.',
  'shell.font.inter': 'Inter (varsayılan)',
  'shell.font.plus-jakarta': 'Plus Jakarta Sans',
  'shell.font.manrope-dm-sans': 'Manrope + DM Sans',
  'shell.font.nunito': 'Nunito',
  'shell.font.figtree': 'Figtree',
  'shell.font.inter.description': 'Net ve nötr — panelin kendi görünümü.',
  'shell.font.plus-jakarta.description': 'Geometrik ve sıcak, biraz daha ferah.',
  'shell.font.manrope-dm-sans.description':
    'Yumuşak Manrope başlıklar, rahat okunan DM Sans gövde.',
  'shell.font.nunito.description': 'Yuvarlak hatlı ve sıcak; beşi içinde en büyük gövde yazısı.',
  'shell.font.figtree.description': "Temiz ve modern, Inter'den daha yumuşak.",
  'shell.brand': 'Marka',
  // Uygulama menüsü (FR-MOD-01.1.1). Logonun tetikleyici etiketi + panelindeki,
  // rayda kendi ikonu olmayan tek hedef.
  'shell.menu': 'Uygulama menüsü',
  'shell.menu.apps': 'Uygulamalar',
  'shell.sandbox.notice':
    'Kum havuzu çalışma alanı — burada hiçbir şey faturalandırılmaz ve hiçbiri gerçek veri değildir.',
  'shell.nav.expand': 'Gezinmeyi genişlet',
  'shell.nav.collapse': 'Gezinmeyi daralt',

  // Ray rozetleri (FR-MOD-01.2). Yalnız sayının söylenen hâli — `RailButton`
  // erişilebilir adı kurarken modülün kendi etiketiyle birleştirir.
  'shell.nav.badge.inbox.one': '{count} okunmamış',
  'shell.nav.badge.inbox.other': '{count} okunmamış',
  'shell.nav.badge.team.one': '{count} bekleyen davet',
  'shell.nav.badge.team.other': '{count} bekleyen davet',

  // Hızlı oluştur (FR-MOD-04.1). Rayın "+" menüsü — bir ekip arkadaşı davet
  // et, ya da yeni bir ekip başlat.
  'shell.quickCreate.label': 'Hızlı oluştur',

  // Davet (FR-MOD-01.1.5). "+N" boş koltuk sayısıdır — henüz bilinmiyorsa
  // (ya da bildirecek bir şey yoksa) düz etikete düşer.
  'shell.invite.label': 'Davet et',
  'shell.invite.labelWithCount': 'Davet et +{count}',

  // Leads rozeti (FR-MOD-01.1.2). Sayı 0 iken gizli — bkz. AppShell.tsx LeadsPill.
  'shell.leads.label.one': '{count} nitelikli lead',
  'shell.leads.label.other': '{count} nitelikli lead',

  // Presence (FR-MOD-01.1.4). Both plural categories are written out for the
  // reason the trial countdown above states.
  'shell.presence.label': 'Çevrimiçi ekip arkadaşları',
  'shell.presence.accepting': 'sohbet kabul ediyor',
  'shell.presence.away': 'çevrimiçi, sohbet kabul etmiyor',
  'shell.presence.member': '{name} — {status}',
  'shell.presence.more.one': '{count} kişi daha çevrimiçi: {names}',
  'shell.presence.more.other': '{count} kişi daha çevrimiçi: {names}',

  // Desktop notification — features/notifications/useNotifications.ts (not a
  // component: it reads the active locale at the moment the push arrives)
  'shell.notification.title': 'Yeni mesaj',
  'shell.notification.fallbackBody': 'Bir ziyaretçi yeni bir mesaj gönderdi.',

  // Navigation
  'nav.home': 'Ana Sayfa',
  'nav.inbox': 'Gelen Kutusu',
  'nav.archive': 'Arşiv',
  'nav.customers': 'Müşteriler',
  'nav.team': 'Ekip',
  'nav.playbook': 'Senaryolar',
  'nav.aiAgent': 'AI Ajanı',
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
  // Arşiv modu (ID-07 · tm 333.4)
  'palette.archive.group': 'Arşiv',
  'palette.archive.enter': 'Arşivde ara',
  'palette.archive.enterFor': 'Arşivde ara: "{query}"',
  'palette.archive.placeholder': 'Arşivde mesaj metni ara…',
  'palette.archive.leave': 'Arşiv aramasından çık',
  'palette.archive.error': 'Arşiv araması başarısız oldu — yeniden deneyin.',
  'palette.ai.error': 'Cevap alınamadı — yeniden deneyin.',
  'shell.nav.badge.suggestions.one': 'İncelenecek {count} öneri',
  'shell.nav.badge.suggestions.other': 'İncelenecek {count} öneri',
  // Klavye kısayolları penceresi (IN-08)
  'shell.shortcuts.title': 'Klavye kısayolları',
  'shell.shortcuts.description': 'Konsolun yanıt verdiği tuşlar. Kapatmak için Esc’e basın.',
  'shell.shortcuts.search': 'Kısayol ara',
  'shell.shortcuts.none': 'Eşleşen kısayol yok.',
  'shell.shortcuts.group.global': 'Her yerde',
  'shell.shortcuts.group.inbox': 'Gelen kutusu',
  'shell.shortcuts.group.composer': 'Yanıt yazarken',
  'shell.shortcuts.palette': 'Komut paletini aç',
  'shell.shortcuts.help': 'Bu listeyi göster',
  'shell.shortcuts.nextChat': 'Listedeki sonraki sohbeti aç',
  'shell.shortcuts.prevChat': 'Listedeki önceki sohbeti aç',
  'shell.shortcuts.copilot': 'Copilot’u göster veya gizle',
  'shell.shortcuts.addTag': 'Sohbete etiket ekle',
  'shell.shortcuts.attachFile': 'Dosya ekle',
};
