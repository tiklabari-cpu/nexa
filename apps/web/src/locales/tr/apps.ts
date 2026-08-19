import type { Messages } from '../merge.js';

/** Uygulama mağazası + Geliştirici portalı (I18N-k, tm 133.11). See the English file. */
export const apps: Messages = {
  'apps.common.cancel': 'İptal',
  'apps.common.done': 'Tamam',
  'apps.common.copy': 'Kopyala',
  'apps.common.copied': 'Kopyalandı',
  'apps.common.loading': 'Yükleniyor…',
  'apps.common.deleting': 'Siliniyor…',

  'apps.marketplace.page.title': 'Uygulamalar',
  'apps.marketplace.page.description': 'Çalışma alanınız için üçüncü taraf entegrasyonlar.',

  'apps.marketplace.title': 'Mağaza',
  'apps.marketplace.description':
    'Ekibinizin zaten kullandığı araçları bağlayın. Bağlı uygulamalar verilerini doğrudan sohbetin içinde gösterir.',
  'apps.marketplace.searchLabel': 'Uygulama ara',
  'apps.marketplace.searchPlaceholder': 'Uygulama ara…',
  'apps.marketplace.filterByCategory': 'Kategoriye göre filtrele',
  'apps.marketplace.category.all': 'Tümü',
  'apps.marketplace.category.crm': 'CRM',
  'apps.marketplace.category.support': 'Destek',
  'apps.marketplace.category.ecommerce': 'E-ticaret',
  'apps.marketplace.category.payments': 'Ödemeler',
  'apps.marketplace.category.marketing': 'Pazarlama',
  'apps.marketplace.category.productivity': 'Verimlilik',
  'apps.marketplace.category.analytics': 'Analiz',
  'apps.marketplace.category.channels': 'Kanallar',
  'apps.marketplace.loadError': 'Uygulama mağazası yüklenemedi.',
  'apps.marketplace.empty.noneTitle': 'Henüz uygulama yok',
  'apps.marketplace.empty.noneDescription':
    'Ekibinizin zaten kullandığı araçları mağazadan bağlayın.',
  'apps.marketplace.empty.noMatchTitle': 'Eşleşen uygulama yok',
  'apps.marketplace.empty.noMatchDescription':
    'Daha kısa bir arama deneyin veya farklı bir kategori seçin.',
  'apps.marketplace.listLabel': 'Uygulamalar',
  'apps.marketplace.loadMore': 'Daha fazla yükle',
  'apps.marketplace.loadingMore': 'Yükleniyor…',

  'apps.marketplace.card.connected': 'Bağlı',
  'apps.marketplace.card.notConnected': 'Bağlı değil',
  'apps.marketplace.card.inChannels': 'Kanallarda',
  'apps.marketplace.card.manageInChannels': 'Kanallarda yönet',
  'apps.marketplace.card.connect': 'Bağlan',
  'apps.marketplace.card.disconnect': 'Bağlantıyı kes',
  'apps.marketplace.card.disconnecting': 'Bağlantı kesiliyor…',

  'apps.marketplace.consent.title': '{name} uygulamasını bağla',
  'apps.marketplace.consent.description': 'Bu uygulama aşağıdaki izinleri istiyor:',
  'apps.marketplace.consent.error': 'Uygulama bağlanamadı. Yeniden deneyin.',
  'apps.marketplace.consent.authorize': 'Yetkilendir',
  'apps.marketplace.consent.connecting': 'Bağlanıyor…',

  'apps.developers.page.title': 'Geliştiriciler',
  'apps.developers.page.description':
    'Bu çalışma alanı adına API üzerinden işlem yapabilecek OAuth uygulamaları kaydedin.',
  'apps.developers.notAvailable.title': 'Geliştirici portalı kullanılamıyor',
  'apps.developers.notAvailable.description':
    'Uygulama kaydetmek, bu çalışma alanının erişim kurallarında yazma yetkisi olan sahip ve yöneticilerle sınırlıdır.',
  'apps.developers.registerApp': 'Uygulama kaydet',

  'apps.developers.tablistLabel': 'Geliştirici portalı',
  'apps.developers.tabs.apps': 'Uygulamalar',
  'apps.developers.tabs.webhooks': 'Webhook’lar',
  'apps.developers.tabs.manifest': 'Manifesto',

  'apps.developers.partnerApps.title': 'Ortak uygulamalar',
  'apps.developers.partnerApps.description':
    'Ekibinizin kaydettiği uygulamalar ve her birinin bu çalışma alanında yapabilecekleri.',
  'apps.developers.partnerApps.loadError': 'Ortak uygulamalarınız yüklenemedi.',
  'apps.developers.partnerApps.emptyTitle': 'Henüz ortak uygulama yok',
  'apps.developers.partnerApps.emptyDescription':
    'Bir betiğin, bir Zap’ın veya kendi geliştireceğiniz bir servisin bu çalışma alanı adına Nexa API’sini çağırabilmesi için bir OAuth istemcisi kaydedin.',

  'apps.developers.clientType.confidential': 'Gizli',
  'apps.developers.clientType.public': 'Genel',
  'apps.developers.rotateSecretFor': '{name} için sırrı yenile',
  'apps.developers.rotateSecret': 'Sırrı yenile',
  'apps.developers.deleteFor': '{name} sil',
  'apps.developers.delete': 'Sil',
  'apps.developers.redirectUriCount.one': '{count} yönlendirme URI’si',
  'apps.developers.redirectUriCount.other': '{count} yönlendirme URI’si',
  'apps.developers.scopeCount.one': '{count} kapsam',
  'apps.developers.scopeCount.other': '{count} kapsam',

  'apps.developers.registerModal.title': 'Uygulama kaydet',
  'apps.developers.registerModal.description':
    'Bu çalışma alanı adına API üzerinden işlem yapabilecek bir OAuth istemcisi kaydedin.',
  'apps.developers.form.redirectUrisRequired':
    'Her satıra bir tane olacak şekilde en az bir yönlendirme URI’si girin.',
  'apps.developers.form.appName': 'Uygulama adı',
  'apps.developers.form.appNamePlaceholder': 'Acme Zap Connector',
  'apps.developers.form.nameRequired': 'Bu uygulama için bir ad girin.',
  'apps.developers.form.clientType': 'İstemci türü',
  'apps.developers.form.clientTypePublic': 'Genel (PKCE, sır yok)',
  'apps.developers.form.clientTypeConfidential': 'Gizli (bir sır verir)',
  'apps.developers.form.redirectUris': 'Yönlendirme URI’leri',
  'apps.developers.form.oneUriPerLine': 'Satır başına bir URI.',
  'apps.developers.form.scopes': 'Kapsamlar',
  'apps.developers.form.scopesHint':
    'Uygulamaya yalnızca kendi oturumunuzun zaten sahip olduğu kapsamlar verilebilir.',
  'apps.developers.form.selectScope': 'En az bir kapsam seçin.',
  'apps.developers.form.register': 'Kaydet',
  'apps.developers.form.registering': 'Kaydediliyor…',

  'apps.developers.secret.registeredTitle': '{name} kaydedildi',
  'apps.developers.secret.rotatedTitle': '{name} sırrı yenilendi',
  'apps.developers.secret.description': 'Bu kimlik bilgilerini şimdi kaydedin.',
  'apps.developers.secret.clientId': 'İstemci kimliği',
  'apps.developers.secret.clientSecret': 'İstemci sırrı',
  'apps.developers.secret.warning': 'Bu sır bir daha gösterilmeyecek — şimdi saklayın.',

  'apps.developers.deleteModal.title': '{name} silinsin mi?',
  'apps.developers.deleteModal.description':
    'Bu uygulamanın elindeki tüm etkin belirteçler hemen çalışmayı durdurur. Bu geri alınamaz.',
  'apps.developers.deleteModal.confirm': 'Uygulamayı sil',

  'apps.developers.rotateModal.title': '{name} için sır yenilensin mi?',
  'apps.developers.rotateModal.description':
    'Mevcut sır hemen çalışmayı durdurur. Onu kullanan her entegrasyonu yenisiyle güncelleyin.',
  'apps.developers.rotateModal.rotating': 'Yenileniyor…',

  'apps.developers.webhooks.title': 'Webhook’lar',
  'apps.developers.webhooks.description':
    'Burada bir şey olduğunda POST alacak bir URL abone edin — Zapier ve Make’in kullandığı REST Hooks modeliyle aynı.',
  'apps.developers.webhooks.loadError': 'Webhook’larınız yüklenemedi.',
  'apps.developers.webhooks.emptyTitle': 'Henüz webhook aboneliği yok',
  'apps.developers.webhooks.emptyDescription':
    'Bir sohbet başladığında, bir mesaj geldiğinde veya bir talep açıldığında bildirim almak için bir URL abone edin.',
  'apps.developers.webhooks.enabled': 'Etkin',
  'apps.developers.webhooks.disabled': 'Devre dışı',
  'apps.developers.webhooks.deleteFor': '{url} için webhook’u sil',
  'apps.developers.webhooks.botScoped': 'Bot kapsamlı',
  'apps.developers.webhooks.workspaceWide': 'Çalışma alanı geneli',

  'apps.developers.webhooks.form.urlLabel': 'URL',
  'apps.developers.webhooks.form.urlRequired': 'Webhook’u alacak URL’yi girin.',
  'apps.developers.webhooks.form.eventLabel': 'Olay',
  'apps.developers.webhooks.form.eventRequired': 'Bir olay seçin.',
  'apps.developers.webhooks.form.loadingEvents': 'Olaylar yükleniyor…',
  'apps.developers.webhooks.form.selectEvent': 'Bir olay seçin…',
  'apps.developers.webhooks.form.subscribe': 'Abone ol',
  'apps.developers.webhooks.form.subscribing': 'Abone olunuyor…',

  'apps.developers.webhooks.secret.title': 'Webhook abone edildi',
  'apps.developers.webhooks.secret.description': 'Bu imzalama sırrını şimdi kaydedin.',
  'apps.developers.webhooks.secret.url': 'URL',
  'apps.developers.webhooks.secret.signingSecret': 'İmzalama sırrı',
  'apps.developers.webhooks.secret.warning':
    'Bu sır bir daha gösterilmeyecek — her teslimat bununla imzalanır.',

  'apps.developers.webhooks.deleteModal.title': '{url} için webhook silinsin mi?',
  'apps.developers.webhooks.deleteModal.description':
    'Bu URL’ye teslimatlar hemen durur. Bu geri alınamaz.',
  'apps.developers.webhooks.deleteModal.confirm': 'Webhook’u sil',

  'apps.developers.manifest.loadError': 'Entegrasyon manifestosu yüklenemedi.',
  'apps.developers.manifest.triggersTitle': 'Tetikleyiciler',
  'apps.developers.manifest.triggersDescription':
    'Bir Zapier/Make tetikleyicisinin abone olabileceği çalışma alanı olayları — her webhook eylemi için bir tane.',
  'apps.developers.manifest.actionsTitle': 'Eylemler',
  'apps.developers.manifest.actionsDescription':
    'Bir Zapier/Make eylem adımının çağırabileceği mevcut yazma uçları — yeni bir uç veya kapsam yok.',
  'apps.developers.manifest.requires': 'Gerekli: {scopes}',
  'apps.developers.manifest.orJoiner': ' veya ',
  'apps.developers.manifest.subscribeTitle': 'Abone ol / aboneliği kaldır',
  'apps.developers.manifest.subscribeDescription':
    'Bir REST Hooks entegrasyonunun bir aboneliği nerede kaydettiği ve kaldırdığı.',
};
