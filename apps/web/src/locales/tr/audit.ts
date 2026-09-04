import type { Messages } from '../merge.js';

/** Denetim günlüğü ekranı (I18N-j, tm 133.10). See the English file. */
export const audit: Messages = {
  'audit.title': 'Denetim günlüğü',
  'audit.description':
    'Oturum açmalar, rol değişiklikleri, silmeler ve webhook değişiklikleri — varsayılan olarak son 30 gün.',
  'audit.notAvailable.title': 'Denetim günlüğü kullanılamıyor',
  'audit.notAvailable.description':
    'Güvenlik izini görüntülemek, bu çalışma alanının denetim günlüğüne okuma erişimi olan sahip ve yöneticilerle sınırlıdır.',
  'audit.loadError':
    "Denetim günlüğü yüklenemedi. API'ye ulaşılabildiğini kontrol edip yeniden deneyin.",
  'audit.empty.title': 'Henüz etkinlik yok',
  'audit.empty.description':
    'Oturum açmalar, rol değişiklikleri, silmeler ve webhook değişiklikleri gerçekleştikçe burada görünecek.',
  'audit.actor.agent': 'Temsilci',
  'audit.actor.bot': 'Bot',
  'audit.actor.customer': 'Müşteri',
  'audit.actor.system': 'Sistem',
  'audit.filterByActionAriaLabel': 'Eyleme göre filtrele',
  'audit.allActions': 'Tüm eylemler',
  'audit.fromDateAriaLabel': 'Başlangıç tarihi',
  'audit.toDateAriaLabel': 'Bitiş tarihi',
  'audit.loading': 'Yükleniyor…',
  'audit.loadMore': 'Daha fazla yükle',
  'audit.column.time': 'Zaman',
  'audit.column.action': 'Eylem',
  'audit.column.actor': 'Aktör',
  'audit.column.target': 'Hedef',
  'audit.column.ip': 'IP',
  'audit.column.detail': 'Ayrıntı',
  'audit.detail.toggleAriaLabel': '{time} tarihindeki {action} kaydının ayrıntısı',
  'audit.detail.entryId': 'Kayıt kimliği',
  'audit.detail.chainPosition': 'Zincir konumu',
  'audit.detail.chainUnavailable':
    'Zincirlenmemiş — bu çalışma alanının denetim zinciri oluşmadan önce yazılmış',
  'audit.detail.recordedDetail': 'Kaydedilen ayrıntı',
  'audit.detail.noMetadata': 'Bu eylem başka ayrıntı kaydetmiyor.',
  'audit.detail.minimalNote':
    'Denetim kayıtları bilerek yalnız alan adlarını, sayıları ve rolleri tutar — değerleri, sırları veya mesaj içeriğini asla. Bazı eylemler kaynak adresi de bilerek yazmaz.',
  'audit.detail.linkedEntry': 'Bağlantı verilen kayıt — geçerli filtrenin veya sayfanın dışında',
  'audit.detail.loadError':
    'Bu kayıt yüklenemedi. Çalışma alanının saklama penceresini geçmiş olabilir.',
  'audit.group.authentication': 'Kimlik doğrulama',
  'audit.group.team': 'Ekip',
  'audit.group.settings': 'Ayarlar',
  'audit.group.compliance': 'Uyumluluk',
  'audit.group.salesTracking': 'Satış takibi',
  'audit.group.billing': 'Faturalandırma',
  'audit.group.webhooks': 'Webhook’lar',
  'audit.group.tickets': 'Talepler',
  'audit.group.credentials': 'Kimlik bilgileri',
  'audit.group.data': 'Veri',
};
