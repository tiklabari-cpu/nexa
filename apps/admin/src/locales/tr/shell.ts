import type { Messages } from '../merge.js';

/**
 * Her kök panel sayfasının çevresindeki kabuk: PLATFORM şeridi, yan menü (`nav.*`), hesap menüsü,
 * boş sayfa iskeletleri ve gerekçe penceresi (tm 389.6).
 */
export const shell: Messages = {
  'shell.strip.label': 'PLATFORM · {region}',
  'shell.strip.labelUnknown': 'PLATFORM',
  'shell.narrow.notice':
    'Bu panel en az 1280 piksel genişliğindeki ekranlar için tasarlandı. Bazı sayfalar sığmayabilir.',
  'shell.skipToContent': 'İçeriğe geç',
  'shell.nav.label': 'Ana menü',
  'shell.account.label': 'Hesap',
  'shell.account.signedInAs': '{email} olarak giriş yapıldı',
  'shell.account.signOut': 'Çıkış yap',
  'shell.account.language': 'Dil',
  'shell.account.theme': 'Tema',
  'shell.account.theme.light': 'Açık',
  'shell.account.theme.dark': 'Koyu',
  'shell.role.superadmin': 'Süper yönetici',
  'shell.role.support': 'Destek',
  'shell.role.billing': 'Faturalama',
  'shell.role.readonly': 'Salt okunur',

  'nav.dashboard': 'Panel',
  'nav.workspaces': 'Çalışma alanları',
  'nav.accounts': 'Hesaplar',
  'nav.billing': 'Faturalama',
  'nav.usage': 'Kullanım',
  'nav.settings': 'Ayarlar',
  'nav.ai': 'Yapay zekâ',
  'nav.operations': 'Operasyonlar',
  'nav.audit': 'Denetim',
  'nav.security': 'Güvenlik',
  'nav.admins': 'Yöneticiler',
  'nav.support': 'Destek',

  'shell.pages.empty.title': 'Burada henüz bir şey yok',
  'shell.pages.empty.description':
    'Bu sayfa şimdilik bir yer tutucu. İçeriğini onu kuran görevler buraya ekleyecek.',
  'shell.pages.dashboard.description': 'Platformun sağlığı, kayıtlar ve temel göstergeler.',
  'shell.pages.workspaces.description': 'Bu kurulumdaki tüm çalışma alanları.',
  'shell.pages.accounts.description': 'Kişiler, giriş durumları ve oturumları.',
  'shell.pages.billing.description': 'Planlar, abonelikler, faturalar ve ödeme kuyrukları.',
  'shell.pages.usage.description': 'Platform genelinde ve çalışma alanı başına tüketim.',
  'shell.pages.settings.description': 'Kayıt, deneme, duyurular ve bakım.',
  'shell.pages.ai.description': 'Sağlayıcılar, modeller, anahtarlar, tavanlar ve kataloglar.',
  'shell.pages.operations.description': 'Zamanlayıcı, webhook’lar, bölümler ve arka plan işleri.',
  'shell.pages.audit.description': 'Her operatör işleminin imzalı kaydı.',
  'shell.pages.security.description':
    'Engel listesi, başarısız girişler ve kötüye kullanım sayaçları.',
  'shell.pages.admins.description': 'Operatörler, rolleri ve davetleri.',
  'shell.pages.support.description': 'Bir çalışma alanını bulun ve sahibi olarak girin.',

  'shell.forbidden.title': 'Bu sayfaya erişiminiz yok',
  'shell.forbidden.description':
    'Rolünüz ({role}) bunu içermiyor. Erişim gerekiyorsa bir süper yöneticiye başvurun.',
  'shell.forbidden.serverDescription':
    'Sunucu bu isteği rolünüz için reddetti. Erişim gerekiyorsa bir süper yöneticiye başvurun.',
  'shell.forbidden.back': 'Panele dön',

  'shell.notFound.title': 'Sayfa bulunamadı',
  'shell.notFound.description': 'Bu adreste bir sayfa yok.',
  'shell.notFound.back': 'Panele dön',

  'shell.reason.label': 'Gerekçe',
  'shell.reason.hint': 'Zorunlu, 3 ile 500 karakter. Platform denetim kaydına yazılır.',
  'shell.reason.totpLabel': 'Doğrulayıcı kodu',
  'shell.reason.totpHint': 'Bu işlem yeni bir altı haneli kod ister.',
  'shell.reason.confirm': 'Onayla',
  'shell.reason.totpInvalid': 'Bu kod çalışmadı. Kodu ve cihazınızın saatini kontrol edin.',
};
