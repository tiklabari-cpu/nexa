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

  // AI sağlayıcıları (tm 389.17).
  'settings.ai.title': 'AI sağlayıcıları',
  'settings.ai.hint':
    'Her çalışma alanının AI’ının kullandığı model ve embedding sağlayıcısı. Burada ayarlanan bir parça kiracı API’nin ortamını (LLM_*, EMBEDDING_*) geçersiz kılar ve çalışan her sunucuya saniyeler içinde, yeniden başlatmadan ulaşır. Kaydetmek gerekçe ve taze bir doğrulama kodu ister.',
  'settings.ai.loadError': 'AI ayarları yüklenemedi',
  'settings.ai.source.db': 'Burada ayarlı',
  'settings.ai.source.env': 'Ortamdan',
  'settings.ai.llm.title': 'Model',
  'settings.ai.embedding.title': 'Embedding modeli',
  'settings.ai.provider': 'Sağlayıcı',
  'settings.ai.provider.env': 'Ortam ne diyorsa',
  'settings.ai.provider.mock': 'Yerleşik taklit (mock)',
  'settings.ai.provider.openai': 'OpenAI',
  'settings.ai.baseUrl': 'Temel URL',
  'settings.ai.baseUrl.hint':
    'Üretimde: yanındaki bölgenin OpenAI bölgesel adresi — asla api.openai.com değil.',
  'settings.ai.model': 'Model adı',
  'settings.ai.modelFast': 'Hızlı model',
  'settings.ai.modelFast.hint': 'Sınıflandırma ve özetleme. Boş: yukarıdaki model.',
  'settings.ai.region': 'Bölge',
  'settings.ai.region.none': 'Ayarlı değil',
  'settings.ai.region.eu': 'AB',
  'settings.ai.region.us': 'ABD',
  'settings.ai.timeout': 'Zaman aşımı (ms)',
  'settings.ai.maxOutputTokens': 'Yanıt sınırı (token)',
  'settings.ai.limits.hint': 'Boş: ortamın LLM_TIMEOUT_MS ve LLM_MAX_OUTPUT_TOKENS değerleri.',
  'settings.ai.dimensions': 'Vektör genişliği: {n}, veritabanı sabitler.',
  'settings.ai.apiKey': 'API anahtarı',
  'settings.ai.apiKey.stored': '•••• {last4}',
  'settings.ai.apiKey.none':
    'Burada kayıtlı anahtar yok: varsa ortamın anahtarı kullanılır. Kaydedildikten sonra yalnız son dört karakteri gösterilir.',
  'settings.ai.apiKey.hint':
    'Yalnız yazılır: kaydedildikten sonra yalnız son dört karakteri gösterilir.',
  'settings.ai.apiKey.change': 'Anahtarı değiştir',
  'settings.ai.apiKey.remove': 'Anahtarı sil',
  'settings.ai.apiKey.removing': 'Kayıtlı anahtar kaydettiğinizde silinir.',
  'settings.ai.apiKey.undo': 'Anahtarı koru',
  'settings.ai.apiKey.cancel': 'Vazgeç',
  'settings.ai.apiKey.tooShort': 'Bir anahtar en az 8 karakterdir.',
  'settings.ai.required': 'Uzak bir sağlayıcı temel URL, model adı ve bölge ister.',
  'settings.ai.embedding.changeWarning':
    'Yeni bir embedding sağlayıcısı ya da modeli, bilgi tabanının yeniden gömülmesi demektir; o zamana kadar sorular taşınmış bilgiden yanıtlanır.',
  'settings.ai.caps.title': 'Günlük tavanlar (token)',
  'settings.ai.caps.hint':
    'Dağıtımın varsayılanları. Boş: ortamın AI_DAILY_* değerleri. Planın varsayılanı ve çalışma alanının kendi istisnası yine önce gelir.',
  'settings.ai.caps.llmWorkspace': 'Model, çalışma alanı başına',
  'settings.ai.caps.llmGlobal': 'Model, tüm dağıtım',
  'settings.ai.caps.embeddingWorkspace': 'Embedding, çalışma alanı başına',
  'settings.ai.caps.embeddingGlobal': 'Embedding, tüm dağıtım',
  'settings.ai.caps.incomplete': 'Dört tavanın hepsini tam sayıyla doldurun ya da hiçbirini.',
  'settings.ai.prices.title': 'Fiyatlar (milyon token başına USD)',
  'settings.ai.prices.hint':
    'AI kullanım raporunun maliyet tahmini için. Boş: ortamın AI_PRICE_* değerleri.',
  'settings.ai.prices.llmInput': 'Model girdisi',
  'settings.ai.prices.llmOutput': 'Model çıktısı',
  'settings.ai.prices.embedding': 'Embedding',
  'settings.ai.prices.invalid': 'Fiyat 0 ya da daha büyük bir sayıdır.',
  'settings.ai.save': 'AI ayarlarını kaydet',
  'settings.ai.saveTitle': 'AI ayarlarını kaydet',
  'settings.ai.saveDescription':
    'Her kiracı sunucusu AI sağlayıcılarını saniyeler içinde yeniden kurar.',
  'settings.ai.reembedRequired': 'Embedding modeli değişti: aşağıdan bilgi tabanını yeniden gömün.',
  'settings.ai.test.title': 'Bağlantı',
  'settings.ai.test.llm': 'Modeli test et',
  'settings.ai.test.embedding': 'Embedding sağlayıcısını test et',
  'settings.ai.test.description':
    'Tek bir küçük istek gönderir. Dağıtımın günlük hakkına sayılır, hiçbir çalışma alanınınkine değil.',
  'settings.ai.test.target.llm': 'Model',
  'settings.ai.test.target.embedding': 'Embedding',
  'settings.ai.test.ok': '{target}: {ms} ms’de yanıt verdi ({provider}, {source}).',
  'settings.ai.test.failed': '{target}: yanıt yok ({error}).',
  'settings.ai.reembed.title': 'Yeniden gömme',
  'settings.ai.reembed.start': 'Bilgi tabanını yeniden göm',
  'settings.ai.reembed.description':
    'Hâlâ başka bir embedding alanında duran her bilgi kaynağı, şimdiki sağlayıcıyla teker teker yeniden gömülür. Maliyet dağıtımın günlük hakkına sayılır.',
  'settings.ai.reembed.state.idle': 'Kayıtlı yeniden gömme yok.',
  'settings.ai.reembed.state.running':
    'Çalışıyor. Taşınan kaynak: {sources} · parça: {chunks} · başarısız: {failed}.',
  'settings.ai.reembed.state.finished':
    '{date} bitti. Taşınan kaynak: {sources} · parça: {chunks} · başarısız: {failed}.',
  'settings.ai.reembed.state.failed': 'Bitmeden durdu. Yeniden başlatın.',
  'settings.ai.reembed.target': 'Hedef alan: {target}.',
  'settings.ai.reembed.capped':
    'Dağıtımın günlük embedding hakkı doldu. 00:00 UTC’den sonra yeniden başlatın.',
};
