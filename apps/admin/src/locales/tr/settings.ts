import type { Messages } from '../merge.js';

/** Dağıtım ayarları, duyuru, bakım modu ve etkin yapılandırma (tm 389.13). */
export const settings: Messages = {
  'settings.loading': 'Yükleniyor…',
  'settings.loadError': 'Ayarlar yüklenemedi',
  'settings.updatedAt': 'Son değişiklik: {date}',
  'settings.on': 'Açık',
  'settings.off': 'Kapalı',

  'settings.general.title': 'Kayıt ve deneme',
  'settings.general.signup': 'Herkese açık kayıt',
  'settings.general.signup.env': 'Ortam değişkenine göre (SIGNUP_ENABLED)',
  'settings.general.signup.open': 'Açık',
  'settings.general.signup.closed': 'Kapalı',
  'settings.general.signup.hint':
    'Buradan kapatmak kaydı hemen kapatır. Buradan açmak SIGNUP_ENABLED=false değerini aşamaz: ikisinden sıkı olan geçerlidir. Davetler her zaman çalışır.',
  'settings.general.trialDays': 'Deneme süresi (gün)',
  'settings.general.trialDays.env': 'Ortam değişkenine göre (TRIAL_DAYS)',
  'settings.general.trialDays.hint':
    'Bundan sonra açılan çalışma alanlarına uygulanır; 1 ile {max} arası. Boş: ortamdaki TRIAL_DAYS.',

  'settings.announcement.title': 'Duyuru',
  'settings.announcement.hint':
    'Her çalışma alanı konsolunun üstünde, kişinin okuduğu dilde gösterilir. İki dili de yazın.',
  'settings.announcement.expired': 'Bitiş zamanı geçti: artık gösterilmiyor.',
  'settings.announcement.enabled': 'Duyuru göster',
  'settings.announcement.level': 'Seviye',
  'settings.announcement.level.info': 'Bilgi',
  'settings.announcement.level.warning': 'Uyarı',
  'settings.announcement.level.critical': 'Kritik',
  'settings.announcement.until': 'Şu zamandan sonra gizle',
  'settings.announcement.until.hint': 'Yerel saatiniz. Boş: siz kaldırana kadar gösterilir.',
  'settings.announcement.en': 'İngilizce metin',
  'settings.announcement.tr': 'Türkçe metin',
  'settings.announcement.preview': 'Önizleme',
  'settings.announcement.preview.empty': '(boş)',

  'settings.maintenance.title': 'Bakım modu',
  'settings.maintenance.state.off': 'Kapalı — her çalışma alanı normal çalışıyor.',
  'settings.maintenance.state.read_only':
    'Açık, salt okunur: çalışma alanları okuyabilir ve giriş yapabilir, her değişiklik reddedilir.',
  'settings.maintenance.state.full':
    'Açık, tam: çalışma alanları çevrim dışı, gerçek zamanlı geçit bağlantıları reddediyor.',
  'settings.maintenance.hint':
    'Her değişiklik bir gerekçe ve yeni bir doğrulayıcı kodu ister. Çalışma alanı konsolları birkaç saniye içinde fark eder.',
  'settings.maintenance.turnOn': 'Bakım modunu aç',
  'settings.maintenance.change': 'Bakım modunu değiştir',
  'settings.maintenance.turnOff': 'Bakım modunu kapat',
  'settings.maintenance.consequence.read_only':
    'Her çalışma alanı salt okunur olur: okuma ve giriş çalışır, her değişiklik reddedilir.',
  'settings.maintenance.consequence.full':
    'Her çalışma alanı çevrim dışı olur: API oturum kapatma dışında her şeyi reddeder, açık gerçek zamanlı bağlantılar kapatılır.',
  'settings.maintenance.consequence.off': 'Her çalışma alanı yeniden normal çalışır.',
  'settings.maintenance.mode': 'Mod',
  'settings.maintenance.mode.read_only': 'Salt okunur — okuma çalışır, değişiklikler reddedilir',
  'settings.maintenance.mode.full': 'Tam — hizmet çevrim dışı',
  'settings.maintenance.message.hint':
    'İsteğe bağlı: konsollar için kendi cümleniz, iki dilde. Boş: konsolun kendi cümlesi.',
  'settings.maintenance.message.en': 'İngilizce mesaj',
  'settings.maintenance.message.tr': 'Türkçe mesaj',
  'settings.maintenance.message.bothLanguages': 'Mesajı iki dilde de yazın ya da hiç yazmayın.',

  'settings.config.title': 'Etkin yapılandırma',
  'settings.config.hint':
    'Kiracı API’nin çalıştığı haliyle ayarları, her 30 saniyede yayımlanır. Sırlar yalnız tanımlı olup olmadıklarını gösterir; adresler kimlik bilgilerini kaybeder. Ortamda tanımlı değerler burada değil, ortamda değiştirilir.',
  'settings.config.notReporting.title': 'Kiracı API bildirmiyor',
  'settings.config.notReporting.body':
    'Hiç yapılandırma yayımlanmadı. Kiracı API’nin zamanlayıcısı durmuş ya da Redis okunamıyor olabilir.',
  'settings.config.stale.title': 'Bu yapılandırma güncel değil',
  'settings.config.stale.body': 'Son yayım: {date}.',
  'settings.config.filter': 'Yapılandırmayı süz',
  'settings.config.search': 'Anahtar ve değerlerde ara',
  'settings.config.source': 'Kaynak',
  'settings.config.source.all': 'Her kaynak',
  'settings.config.source.db': 'Bu panel',
  'settings.config.source.env': 'Ortam',
  'settings.config.source.default': 'Varsayılan',
  'settings.config.notableOnly':
    'Yalnız dağıtım düğmeleri: kayıt, pilot, AI, captcha, canlı uygulamalar, ticket e-postası',
  'settings.config.loadError': 'Yapılandırma yüklenemedi',
  'settings.config.empty': 'Eşleşen ayar yok.',
  'settings.config.key': 'Anahtar',
  'settings.config.value': 'Değer',
  'settings.config.panel': 'burada ayarlanır',
  'settings.config.set': 'tanımlı',
  'settings.config.unset': 'tanımlı değil',
  'settings.config.none': 'yok',
};
