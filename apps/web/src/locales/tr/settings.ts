import type { Messages } from '../merge.js';

/** Ayarlar, ilk yarı (I18N-i, tm 133.9): kanallar, widget'lar, etiketler, hazır
 * yanıtlar, özel alanlar, formlar, talep şablonları. See the English file. */
export const settings: Messages = {
  // Bu dosyanın ekranları arasında paylaşılan
  'settings.loading': 'Yükleniyor…',
  'settings.adding': 'Ekleniyor…',
  'settings.saving': 'Kaydediliyor…',
  'settings.copied': 'Kopyalandı',
  'settings.remove': 'Kaldır',
  'settings.delete': 'Sil',
  'settings.cancel': 'İptal',
  'settings.requiredLabel': 'Zorunlu',
  'settings.requiredSuffix': ' · zorunlu',

  // Entegrasyonlar — Integrations.tsx
  'settings.integrations.title': 'Entegrasyonlar',
  'settings.integrations.description':
    'Üçüncü taraf uygulamaları bağlayın — CRM, ödeme, e-ticaret ve daha fazlası. Bağlı bir uygulama verisini doğrudan bir sohbetin içinde gösterir.',
  'settings.integrations.hint':
    'Ekibinizin zaten kullandığı araçları bağlamak için mağazaya göz atın.',
  'settings.integrations.openMarketplace': 'Mağazayı aç',

  // Güvenilir alan adları — TrustedDomains.tsx
  'settings.trustedDomains.title': 'Güvenilir alan adları',
  'settings.trustedDomains.description':
    "Widget'ın kontrol ettiği izin listesi. Yukarıda bir web sitesi eklemek burayı sizin için doldurur; yalnızca alt alan adlarını kapsamak gibi ince ayarlar için burayı elle düzenleyin.",
  'settings.trustedDomains.loadError': 'Güvenilir alan adları yüklenemedi.',
  'settings.trustedDomains.domainLabel': 'Alan adı',
  'settings.trustedDomains.includeSubdomains': 'Alt alan adlarını dahil et',
  'settings.trustedDomains.addButton': 'Alan adı ekle',
  'settings.trustedDomains.empty.title': 'Henüz alan adı yok',
  'settings.trustedDomains.empty.description':
    "Widget'ı istediğiniz siteyi ekleyin. Ekleyene kadar hiçbir yerde sohbet başlatamaz.",

  // Kayıtlı yanıtlar — CannedResponses.tsx
  'settings.cannedResponses.title': 'Kayıtlı yanıtlar',
  'settings.cannedResponses.description': 'Temsilciler bunları yazma alanına # yazarak ekler.',
  'settings.cannedResponses.loadError': 'Kayıtlı yanıtlar yüklenemedi.',
  'settings.cannedResponses.shortcutLabel': 'Kısayol',
  'settings.cannedResponses.shortcutError': 'Bir kısayol girin.',
  'settings.cannedResponses.replyLabel': 'Yanıt',
  'settings.cannedResponses.replyError': 'Yanıt metnini girin.',
  'settings.cannedResponses.saveButton': 'Yanıtı kaydet',
  'settings.cannedResponses.empty.title': 'Henüz kayıtlı yanıt yok',
  'settings.cannedResponses.empty.description': 'Ekibinizin en sık yazdığı yanıtları kaydedin.',
  'settings.cannedResponses.deleteAriaLabel': '#{shortcut} kısayolunu sil',

  // Etiketler — Tags.tsx
  'settings.tags.title': 'Etiketler',
  'settings.tags.description':
    'Temsilcilerin sohbetlere uyguladığı etiketler. Gelen kutusu yazarken bunları önerir.',
  'settings.tags.loadError': 'Etiketler yüklenemedi.',
  'settings.tags.tagLabel': 'Etiket',
  'settings.tags.nameError': 'Bir etiket adı girin.',
  'settings.tags.addButton': 'Etiket ekle',
  'settings.tags.empty.title': 'Henüz etiket yok',
  'settings.tags.empty.description':
    'Ekibinizin sohbetleri etiketlerken kullanacağı sözcüklerde anlaşın.',
  'settings.tags.allTeams': 'Tüm ekipler',
  'settings.tags.teamCount.one': '{count} ekip',
  'settings.tags.teamCount.other': '{count} ekip',
  'settings.tags.inUse': '{count} kullanımda',
  'settings.tags.deleteAriaLabel': '{name} etiketini sil',

  // Talep e-posta şablonları — TicketEmailTemplates.tsx
  'settings.ticketEmailTemplates.title': 'Talep e-posta şablonları',
  'settings.ticketEmailTemplates.description':
    'Markalı, yeniden kullanılabilir yanıtlar. Çift süslü parantezle bir değişken ekleyin, örn. {{ticket.id}}.',
  'settings.ticketEmailTemplates.loadError': 'E-posta şablonları yüklenemedi.',
  'settings.ticketEmailTemplates.nameLabel': 'Şablon adı',
  'settings.ticketEmailTemplates.nameError': 'Şablona bir ad verin.',
  'settings.ticketEmailTemplates.subjectLabel': 'Konu',
  'settings.ticketEmailTemplates.subjectError': 'Bir konu girin.',
  'settings.ticketEmailTemplates.messageLabel': 'Mesaj',
  'settings.ticketEmailTemplates.bodyError': 'Mesaj gövdesini girin.',
  'settings.ticketEmailTemplates.variablesLabel': 'Değişkenler: {list}',
  'settings.ticketEmailTemplates.addButton': 'Şablon ekle',
  'settings.ticketEmailTemplates.empty.title': 'Henüz e-posta şablonu yok',
  'settings.ticketEmailTemplates.empty.description':
    'Ekibinizin bir talepte gönderebileceği markalı, değişkenli bir yanıt yazın.',
  'settings.ticketEmailTemplates.statusOn': 'Açık',
  'settings.ticketEmailTemplates.statusOff': 'Kapalı',
  'settings.ticketEmailTemplates.enable': 'Etkinleştir',
  'settings.ticketEmailTemplates.disable': 'Devre dışı bırak',
  'settings.ticketEmailTemplates.deleteAriaLabel': '{name} şablonunu sil',

  // Özel alanlar — CustomFieldsSettings.tsx
  'settings.customFields.title': 'Özel alanlar',
  'settings.customFields.description':
    "Talep ve kişilerde ekstra alanlar — bir oyuncu kimliği, bir KYC durumu, bir bakiye. Bunlar talebin Ayrıntılar panelinde ve CRM'de görünür.",
  'settings.customFields.loadError': 'Özel alanlar yüklenemedi.',
  'settings.customFields.labelLabel': 'Etiket',
  'settings.customFields.labelError': 'Alana bir ad verin.',
  'settings.customFields.onLabel': 'Nerede',
  'settings.customFields.typeLabel': 'Tür',
  'settings.customFields.entity.ticket': 'Talep',
  'settings.customFields.entity.contact': 'Kişi',
  'settings.customFields.addButton': 'Alan ekle',
  'settings.customFields.empty.title': 'Henüz özel alan yok',
  'settings.customFields.empty.description':
    'Ekibinizin talep ve kişilerde ihtiyaç duyduğu alanları ekleyin — bir oyuncu kimliği ya da KYC durumu gibi.',
  'settings.customFields.deleteAriaLabel': '{label} alanını sil',

  // Sohbet öncesi form — PreChatFormSettings.tsx
  'settings.preChatForm.title': 'Sohbet öncesi form',
  'settings.preChatForm.description':
    "Sohbet başlamadan önce ziyaretçilerden bilgi isteyin. Yanıtlar kişiye kaydedilir ve CRM'de gösterilir.",
  'settings.preChatForm.loadError': 'Sohbet öncesi form yüklenemedi.',
  'settings.preChatForm.labelLabel': 'Etiket',
  'settings.preChatForm.labelError': 'Alana bir ad verin.',
  'settings.preChatForm.typeLabel': 'Tür',
  'settings.preChatForm.addButton': 'Alan ekle',
  'settings.preChatForm.empty.title': 'Henüz sohbet öncesi soru yok',
  'settings.preChatForm.empty.description':
    'Ziyaretçiler sohbete başlamadan önce onlardan bilgi istemek için bir alan ekleyin — bir sipariş numarası, bir hesap kimliği gibi.',
  'settings.preChatForm.deleteAriaLabel': '{label} alanını sil',

  // Kanallar — Channels.tsx
  'settings.channels.title': 'Kanallar',
  'settings.channels.titleWithBrand': 'Kanallar · {brand}',
  'settings.channels.description':
    'Müşterilerinizin size ulaşabileceği her yer. Kullandıklarınızı bağlayın; geri kalanı geldikçe size haber vereceğiz.',
  'settings.channels.loadError': 'Kanal durumları yüklenemedi.',
  'settings.channels.status.connected': 'Bağlı',
  'settings.channels.status.ready': 'Hazır',
  'settings.channels.status.not_connected': 'Bağlı değil',
  'settings.channels.status.coming_soon': 'Yakında',
  'settings.channels.cta.connect': 'Bağlan',
  'settings.channels.cta.manage': 'Yönet',
  'settings.channels.cta.getLink': 'Bağlantı al',
  'settings.channels.cta.getAddress': 'Adres al',
  'settings.channels.cta.getNotified': 'Haberdar ol',
  'settings.channels.cta.disconnect': 'Bağlantıyı kes',
  'settings.channels.notifiedAck': 'Size haber vereceğiz.',
  'settings.channels.connecting': 'Bağlanıyor…',
  'settings.channels.disconnecting': 'Bağlantı kesiliyor…',
  'settings.channels.discardConnectionConfirm': 'Bu bağlantı denemesi vazgeçilsin mi?',
  'settings.channels.website.name': "Web sitesi widget'ı",
  'settings.channels.website.description': 'Kendi sitenizdeki sohbet balonu.',
  'settings.channels.chatPage.name': 'Sohbet sayfası',
  'settings.channels.chatPage.description':
    'Müşterilerin sohbet ettiği barındırılan bir bağlantı — kurulum gerekmez.',
  'settings.channels.email.name': 'E-posta',
  'settings.channels.email.description':
    'Destek gelen kutunuzu buraya yönlendirin, her e-posta bir talebe dönüşsün.',
  'settings.channels.messenger.name': 'Facebook Messenger',
  'settings.channels.messenger.description': 'Messenger sohbetlerini yanıtlayın.',
  'settings.channels.whatsapp.name': 'WhatsApp',
  'settings.channels.whatsapp.description': 'WhatsApp mesajlarını yanıtlayın.',
  'settings.channels.sms.name': 'SMS',
  'settings.channels.sms.description': 'Twilio üzerinden kısa mesajlara yanıt verin.',
  'settings.channels.instagram.name': 'Instagram',
  'settings.channels.instagram.description': 'Instagram doğrudan mesajlarını yanıtlayın.',
  'settings.channels.instagram.connectTitle': "Instagram'ı bağla",
  'settings.channels.instagram.connectDescription':
    'Bu sürüm için sahte yetkilendirme — herhangi bir kod ve kullanıcı kimliği bağlantıyı tamamlar.',
  'settings.channels.instagram.codeLabel': 'Yetkilendirme kodu',
  'settings.channels.instagram.codeError': 'Yetkilendirme kodunu girin.',
  'settings.channels.instagram.userIdLabel': 'Instagram kullanıcı kimliği',
  'settings.channels.instagram.userIdError': 'Instagram kullanıcı kimliğini girin.',
  'settings.channels.instagram.disconnectConfirm':
    'Instagram bağlantısı kesilsin mi? Yeniden bağlanana kadar doğrudan mesajlar gelmeyi durdurur.',
  'settings.channels.telegram.name': 'Telegram',
  'settings.channels.telegram.description': 'Telegram sohbetlerini yanıtlayın.',
  'settings.channels.telegram.connectTitle': "Telegram'ı bağla",
  'settings.channels.telegram.connectDescription':
    "Telegram mesajlarını burada almak için @BotFather'dan aldığınız bot jetonunu ve kullanıcı adını girin.",
  'settings.channels.telegram.tokenLabel': 'Bot jetonu',
  'settings.channels.telegram.tokenError': 'Bot jetonunu girin.',
  'settings.channels.telegram.usernameLabel': 'Bot kullanıcı adı',
  'settings.channels.telegram.usernameError': 'Bot kullanıcı adını girin.',
  'settings.channels.telegram.disconnectConfirm':
    'Telegram bağlantısı kesilsin mi? Yeniden bağlanana kadar mesajlar gelmeyi durdurur.',

  // Web sitesi widget'ları — WebsiteWidgets.tsx
  'settings.websiteWidgets.title': "Web sitesi widget'ları",
  'settings.websiteWidgets.titleWithBrand': "Web sitesi widget'ları · {brand}",
  'settings.websiteWidgets.description':
    "Sohbet widget'ını sitelerinize kurun. Buraya bir site eklemek alan adını da güvenilir yapar, böylece widget orada hemen sohbet başlatabilir.",
  'settings.websiteWidgets.loadError': 'Web siteleriniz yüklenemedi.',
  'settings.websiteWidgets.domainLabel': 'Web sitesi alan adı',
  'settings.websiteWidgets.domainRequiredError': 'Bir web sitesi alan adı girin.',
  'settings.websiteWidgets.domainInvalidError': 'shop.example gibi geçerli bir alan adı girin.',
  'settings.websiteWidgets.installMethodLabel': 'Kurulum yöntemi',
  'settings.websiteWidgets.installMethod.manual': 'Kodu elle yapıştır',
  'settings.websiteWidgets.installMethod.platform': 'Platform (Shopify / WordPress / GTM)',
  'settings.websiteWidgets.addButton': 'Web sitesi ekle',
  'settings.websiteWidgets.empty.title': 'Henüz web sitesi yok',
  'settings.websiteWidgets.empty.description':
    "Widget'ı istediğiniz siteyi ekleyin, ardından kod parçasını kapanış body etiketinden önce yapıştırın.",
  'settings.websiteWidgets.status.connected': 'Bağlı',
  'settings.websiteWidgets.status.pending': 'İlk mesaj bekleniyor',
  'settings.websiteWidgets.status.error': 'Hata',
  'settings.websiteWidgets.testMessageReceived': 'Test mesajı alındı',
  'settings.websiteWidgets.getCode': 'Kodu al',
  'settings.websiteWidgets.hideCode': 'Kodu gizle',
  'settings.websiteWidgets.removeAriaLabel': '{domain} kaldır',
  'settings.websiteWidgets.footerHintPrefix': 'Kod parçasını her sayfada kapanış',
  'settings.websiteWidgets.footerHintSuffix': 'etiketinden hemen önce yapıştırın.',
  'settings.websiteWidgets.customizeWidget': "Widget'ı özelleştir",
  'settings.websiteWidgets.snippet.reportSale':
    'Ödeme tamamlandığında bir satışı bildirmek için kendi betiğinizden izleme kodunu çağırın:',
  'settings.websiteWidgets.snippet.copyCode': 'Kodu kopyala',
  'settings.websiteWidgets.snippet.inviteDeveloper': 'Geliştiriciyi davet et',
  'settings.websiteWidgets.platformInstall': 'Platform kurulumu',
  'settings.websiteWidgets.manualInstall': 'Elle kurulum',
  'settings.websiteWidgets.mailtoSubject': 'Sohbet widget’ımızı {domain} sitesine kurun',
  'settings.websiteWidgets.mailtoBody':
    'Lütfen bu kod parçasını {domain} sitesinde kapanış </body> etiketinden hemen önce yapıştırın:\n\n{snippet}',
};
