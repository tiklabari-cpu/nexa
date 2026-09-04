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
  // I18N-j'nin ekranları arasında da paylaşılan (tm 133.10)
  'settings.save': 'Kaydet',
  'settings.copy': 'Kopyala',
  'settings.on': 'Açık',
  'settings.off': 'Kapalı',
  'settings.never': 'Hiç',
  'settings.enable': 'Etkinleştir',
  'settings.disable': 'Devre dışı bırak',
  'settings.andJoiner': ' ve ',
  'settings.pageTitle': 'Ayarlar',
  'settings.pageDescription': 'Widget kurulumu, kayıtlı yanıtlar ve yönlendirme.',

  // Şirket bilgileri — CompanyDetails.tsx (FR-MOD-08.3)
  'settings.company.title': 'Şirket bilgileri',
  'settings.company.description':
    'Bu çalışma alanının kim olduğu: faturalardaki ve widget üzerindeki ad, raporların altında grupladığı sektör, posta adresi ve ekibin çalıştığı saat.',
  'settings.company.loadError': 'Şirket bilgileri yüklenemedi.',
  'settings.company.nameLabel': 'Şirket adı',
  'settings.company.nameRequiredError': 'Şirket adını girin.',
  'settings.company.nameTooLongError': 'En fazla 200 karakter kullanın.',
  'settings.company.sectorLabel': 'Sektör',
  'settings.company.sectorUnset': 'Belirlenmedi',
  'settings.company.sectorHint':
    'Sabit bir liste, böylece raporlar çalışma alanlarını buna göre gruplayabilir. Hiçbiri uymuyorsa Diğer’i seçin.',
  'settings.company.sector.ecommerce_retail': 'E-ticaret ve perakende',
  'settings.company.sector.saas_technology': 'SaaS ve teknoloji',
  'settings.company.sector.financial_services': 'Finansal hizmetler',
  'settings.company.sector.healthcare': 'Sağlık',
  'settings.company.sector.travel_hospitality': 'Seyahat ve konaklama',
  'settings.company.sector.education': 'Eğitim',
  'settings.company.sector.real_estate': 'Gayrimenkul',
  'settings.company.sector.telecommunications': 'Telekomünikasyon',
  'settings.company.sector.media_entertainment': 'Medya ve eğlence',
  'settings.company.sector.gaming_gambling': 'Oyun ve bahis',
  'settings.company.sector.nonprofit_government': 'Kâr amacı gütmeyen ve kamu',
  'settings.company.sector.professional_services': 'Profesyonel hizmetler',
  'settings.company.sector.manufacturing_logistics': 'Üretim ve lojistik',
  'settings.company.sector.other': 'Diğer',
  'settings.company.addressLabel': 'Adres',
  'settings.company.addressPlaceholder': 'Sokak, şehir, posta kodu, ülke',
  'settings.company.addressTooLongError': 'En fazla {max} karakter kullanın.',
  'settings.company.timezoneLabel': 'Saat dilimi',
  'settings.company.timezoneHintPrefix':
    'Çalışma alanının saati. Yeni bir çalışma programı bu saat diliminde başlar; başka bir saat diliminde çalışan bir temsilci bunu Ekip →',
  'settings.company.timezoneHintLink': 'Çalışma programı',
  'settings.company.timezoneHintSuffix': ' bölümünden değiştirebilir.',
  'settings.company.timezoneSavedNote':
    'Kaydedildi. Halihazırda kayıtlı çalışma programları kaydedildikleri saat dilimini korur — bunu değiştirmek bir temsilcinin mevcut saatlerini asla kaydırmaz.',

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
  'settings.trustedDomains.domainRequiredError': 'Bir alan adı girin.',
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
  'settings.tags.teamsLabel': 'Ekipler',
  'settings.tags.teamsHint':
    'Bu etiketin tüm ekiplere uygulanması için hiçbir kutuyu işaretlemeyin.',
  'settings.tags.editTeamsButton': 'Ekipleri düzenle',
  'settings.tags.editTeamsAriaLabel': '{name} etiketinin ekiplerini düzenle',

  // Sohbet zaman aşımı — ChatTimeout.tsx
  'settings.chatTimeout.title': 'Sohbet zaman aşımı',
  'settings.chatTimeout.description':
    'Bir süredir sessiz kalan sohbetleri otomatik olarak kapatır.',
  'settings.chatTimeout.loadError': 'Sohbet zaman aşımı ayarı yüklenemedi.',
  'settings.chatTimeout.enableLabel': 'Boşta kalan sohbetleri otomatik kapat',
  'settings.chatTimeout.enableHint':
    'Varsayılan olarak kapalı. Açıkken, aşağıdaki süre boyunca hiçbir hareket olmayan bir sohbet otomatik olarak kapanır.',
  'settings.chatTimeout.amountLabel': 'Şu süre boşta kalınca',
  'settings.chatTimeout.unitLabel': 'Birim',
  'settings.chatTimeout.unitMinutes': 'Dakika',
  'settings.chatTimeout.unitHours': 'Saat',
  'settings.chatTimeout.amountError':
    "0'dan büyük, toplam en fazla 30 gün olan tam bir sayı girin.",

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

  // Sohbet formları (öncesi/sonrası) — ChatFormsSettings.tsx
  'settings.chatForms.title': 'Sohbet formları',
  'settings.chatForms.description':
    "Sohbet başlamadan önce ya da bittikten sonra ziyaretçilerden bilgi isteyin. Yanıtlar kişiye kaydedilir ve CRM'de gösterilir.",
  'settings.chatForms.loadError': 'Sohbet formları yüklenemedi.',
  'settings.chatForms.labelLabel': 'Etiket',
  'settings.chatForms.labelError': 'Alana bir ad verin.',
  'settings.chatForms.typeLabel': 'Tür',
  'settings.chatForms.placementLabel': 'Sorulma anı',
  'settings.chatForms.placement.preChat': 'Sohbetten önce',
  'settings.chatForms.placement.postChat': 'Sohbetten sonra',
  'settings.chatForms.addButton': 'Alan ekle',
  'settings.chatForms.empty.title': 'Henüz sohbet sorusu yok',
  'settings.chatForms.empty.description':
    'Ziyaretçiler sohbete başlamadan önce ya da sohbet bittikten sonra onlardan bilgi istemek için bir alan ekleyin — bir sipariş numarası, bir hesap kimliği gibi.',
  'settings.chatForms.deleteAriaLabel': '{label} alanını sil',

  // Kanallar — Channels.tsx
  'settings.channels.title': 'Kanallar',
  'settings.channels.titleWithBrand': 'Kanallar · {brand}',
  'settings.channels.description':
    'Müşterilerinizin size ulaşabileceği her yer. Kullandıklarınızı bağlayın — her biri aynı gelen kutusuna akmaya başlar.',
  'settings.channels.loadError': 'Kanal durumları yüklenemedi.',
  'settings.channels.status.connected': 'Bağlı',
  'settings.channels.status.ready': 'Hazır',
  'settings.channels.status.not_connected': 'Bağlı değil',
  'settings.channels.cta.connect': 'Bağlan',
  'settings.channels.cta.manage': 'Yönet',
  'settings.channels.cta.getLink': 'Bağlantı al',
  'settings.channels.cta.getAddress': 'Adres al',
  'settings.channels.cta.disconnect': 'Bağlantıyı kes',
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
  'settings.channels.messenger.connectCta': 'Facebook ile bağlan (sahte)',
  'settings.channels.messenger.connectTitle': "Facebook Messenger'ı bağla",
  'settings.channels.messenger.connectDescription':
    'Bu sürüm için sahte yetkilendirme — Facebook yetkilendirme kodu otomatik üretilir; bağlanacak Sayfa kimliğini girin (ad isteğe bağlı).',
  'settings.channels.messenger.pageIdLabel': 'Facebook Sayfa kimliği',
  'settings.channels.messenger.pageIdError': 'Facebook Sayfa kimliğini girin.',
  'settings.channels.messenger.pageNameLabel': 'Sayfa adı (isteğe bağlı)',
  'settings.channels.messenger.disconnectConfirm':
    'Messenger bağlantısı kesilsin mi? Yeniden bağlanana kadar mesajlar gelmeyi durdurur.',
  'settings.channels.whatsapp.name': 'WhatsApp',
  'settings.channels.whatsapp.description': 'WhatsApp mesajlarını yanıtlayın.',
  'settings.channels.whatsapp.connectTitle': "WhatsApp'ı bağla",
  'settings.channels.whatsapp.connectDescription':
    'Bu sürüm için sahte sağlayıcı — mesajları yanıtlayacağınız WhatsApp Business Account kimliğini ve işletme telefon numarasını girin.',
  'settings.channels.whatsapp.wabaIdLabel': 'WhatsApp Business Account kimliği',
  'settings.channels.whatsapp.wabaIdError': 'WhatsApp Business Account kimliğini girin.',
  'settings.channels.whatsapp.phoneNumberLabel': 'Telefon numarası',
  'settings.channels.whatsapp.phoneNumberError':
    'Geçerli bir telefon numarası girin, örn. +15551234567.',
  'settings.channels.whatsapp.disconnectConfirm':
    'WhatsApp bağlantısı kesilsin mi? Yeniden bağlanana kadar mesajlar gelmeyi durdurur.',
  'settings.channels.sms.name': 'SMS',
  'settings.channels.sms.description': 'Twilio üzerinden kısa mesajlara yanıt verin.',
  'settings.channels.sms.connectTitle': "SMS'i bağla (Twilio)",
  'settings.channels.sms.connectDescription':
    'Bu sürüm için sahte sağlayıcı — mesajları yanıtlayacağınız Twilio Hesap SID, Yetkilendirme jetonu ve telefon numarasını girin.',
  'settings.channels.sms.accountSidLabel': 'Twilio Hesap SID',
  'settings.channels.sms.accountSidError': 'Twilio Hesap SID girin.',
  'settings.channels.sms.authTokenLabel': 'Twilio Yetkilendirme jetonu',
  'settings.channels.sms.authTokenError': 'Twilio Yetkilendirme jetonunu girin.',
  'settings.channels.sms.phoneNumberLabel': 'Telefon numarası',
  'settings.channels.sms.phoneNumberError':
    'Geçerli bir telefon numarası girin, örn. +15551234567.',
  'settings.channels.sms.disconnectConfirm':
    'SMS bağlantısı kesilsin mi? Yeniden bağlanana kadar mesajlar gelmeyi durdurur.',
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

  // Ayarlar, ikinci yarı (I18N-j, tm 133.10): güvenlik (SSO/SCIM/IP izin
  // listesi/HIPAA/SIEM/denetim), sandbox, widget görünümü (white-label), SLA,
  // satış takibi, markalar, MCP bağlantısı, zamanlanmış dışa aktarımlar,
  // engellenen IP'ler, dosya paylaşımı, yetenekler ve yönlendirme/talep
  // kuralları — bölünme için HANDOFF.md'ye bakın.

  // MCP sunucusu — McpConnection.tsx
  'settings.mcpConnection.title': 'MCP sunucusu',
  'settings.mcpConnection.description':
    'Nexa verileriniz hakkında yapay zekâ asistanlarına sorun. Claude, ChatGPT ve herhangi bir MCP uyumlu araçla çalışır.',
  'settings.mcpConnection.loadError': 'MCP sunucu bilgileri yüklenemedi.',
  'settings.mcpConnection.serverUrlLabel': 'MCP sunucu adresi',
  'settings.mcpConnection.claudeSetup': 'Claude kurulumu',
  'settings.mcpConnection.step1': "Claude'ı açın, ardından Ayarlar → Bağlayıcılar'a gidin.",
  'settings.mcpConnection.step2': '“Özel bağlayıcı ekle” seçeneğini seçin.',
  'settings.mcpConnection.step3': 'Yukarıdaki MCP sunucu adresini yapıştırın.',
  'settings.mcpConnection.step4':
    'İstendiğinde Nexa hesabınızla oturum açın ve istenen kapsamları onaylayın.',
  'settings.mcpConnection.step5':
    'Çalışma alanınız hakkında bir soru sorun — aşağıdaki örneğe bakın.',
  'settings.mcpConnection.examplePromptLabel': 'Örnek istem',
  'settings.mcpConnection.examplePrompt':
    'Toplu sipariş hakkında soran müşterilerin olduğu tüm talepleri bul',
  'settings.mcpConnection.availableToolsLabel': 'Kullanılabilir araçlar',
  'settings.mcpConnection.empty.title': 'Henüz araç yayımlanmadı',
  'settings.mcpConnection.empty.description': 'Araçlar bu sunucuya bağlandıkça burada görünür.',

  // Markalar — Brands.tsx
  'settings.brands.title': 'Markalar',
  'settings.brands.description':
    'Tek bir abonelik altında birden çok marka çalıştırın. Her birinin kendi kanalları, web siteleri ve widget görünümü vardır, marka değiştiriciden seçilir.',
  'settings.brands.loadError': 'Markalarınız yüklenemedi.',
  'settings.brands.nameLabel': 'Marka adı',
  'settings.brands.nameError': 'Bir marka adı girin.',
  'settings.brands.addButton': 'Marka ekle',
  'settings.brands.empty.title': 'Henüz marka yok',
  'settings.brands.empty.description':
    'Bu abonelik altında ikinci bir mağaza veya destek hattı çalıştırmak için bir marka ekleyin.',
  'settings.brands.default': 'Varsayılan',
  'settings.brands.removeAriaLabel': '{name} kaldır',
  'settings.brands.nameFieldAriaLabel': '{name} adı',

  // Widget görünümü (white-label) — WidgetCustomization.tsx
  'settings.widgetCustomization.title': 'Widget görünümü',
  'settings.widgetCustomization.titleWithBrand': 'Widget görünümü · {brand}',
  'settings.widgetCustomization.description':
    "Sohbet widget'ının sitelerinizde nasıl göründüğü. Değişiklikler kurulum kod parçasına gömülür ve widget bir sonraki yüklendiğinde uygulanır.",
  'settings.widgetCustomization.loadError': 'Widget görünümü yüklenemedi.',
  'settings.widgetCustomization.colorLabel': 'Marka rengi',
  'settings.widgetCustomization.colorSwatchAriaLabel': 'Marka rengi örneği',
  'settings.widgetCustomization.colorHexAriaLabel': 'Marka rengi onaltılık kodu',
  'settings.widgetCustomization.colorError': '#2d67fa gibi bir onaltılık renk kodu girin.',
  'settings.widgetCustomization.positionLegend': 'Konum',
  'settings.widgetCustomization.positionHint': 'Başlatıcının hangi köşede oturduğu.',
  'settings.widgetCustomization.position.bottom-right': 'Sağ alt',
  'settings.widgetCustomization.position.bottom-left': 'Sol alt',
  'settings.widgetCustomization.themeLegend': 'Renk şeması',
  'settings.widgetCustomization.themeHint':
    'Otomatik, her ziyaretçinin cihazını izler; diğerleri zorlar.',
  'settings.widgetCustomization.theme.auto': 'Otomatik',
  'settings.widgetCustomization.theme.light': 'Açık',
  'settings.widgetCustomization.theme.dark': 'Koyu',
  'settings.widgetCustomization.mobileFullscreenLabel': 'Mobilde tam ekran',
  'settings.widgetCustomization.mobileFullscreenHint':
    'Telefonlarda kayan bir kart yerine kenardan kenara açılır.',
  'settings.widgetCustomization.poweredByLabel': '“Powered by Nexa” yazısını göster',
  'settings.widgetCustomization.poweredByHint':
    'Widget altbilgisinde küçük bir ibare. Kaldırmak için kapatın.',
  'settings.widgetCustomization.entitlementError':
    'Nexa rozetini kaldırmak bir Enterprise özelliğidir. Gizlemek için planı yükseltin.',
  'settings.widgetCustomization.saveButton': 'Görünümü kaydet',
  'settings.widgetCustomization.resetButton': 'Sıfırla',
  'settings.widgetCustomization.previewLabel': 'Önizleme',
  'settings.widgetCustomization.previewChatWithUs': 'Bizimle sohbet edin',
  'settings.widgetCustomization.previewGreeting': 'Merhaba! Nasıl yardımcı olabiliriz?',
  'settings.widgetCustomization.previewCustomerMessage': 'Bir sorum var',
  'settings.widgetCustomization.previewPoweredBy': 'Powered by Nexa',
  'settings.widgetCustomization.previewAutoNote':
    'Otomatik, her ziyaretçinin cihazına uyacak şekilde açık veya koyu gösterir — burada açık gösteriliyor.',
  'settings.widgetCustomization.previewFullscreenNote': 'Telefonlarda panel tam ekran açılır.',
  'settings.widgetCustomization.previewFloatingNote':
    'Telefonlarda panel kayan bir kart olarak açılır.',

  // Satış takibi — SalesTracker.tsx
  'settings.salesTracker.title': 'Satış takibi',
  'settings.salesTracker.description':
    'Widget kod parçası aracılığıyla sitenizin bildirdiği siparişleri, onlara yol açan sohbete atfedin.',
  'settings.salesTracker.loadError': 'Satış takibi ayarları yüklenemedi.',
  'settings.salesTracker.attributionWindowError': '{min}-{max} arasında tam bir gün sayısı girin.',
  'settings.salesTracker.trackLabel': 'Satışları izle',
  'settings.salesTracker.trackHint':
    "Varsayılan olarak kapalı. Açıkken, widget'ın izleme kod parçası aracılığıyla bildirilen siparişler kaydedilir ve onlara yol açan sohbete atfedilir.",
  'settings.salesTracker.currencyLabel': 'Para birimi',
  'settings.salesTracker.currencyHint':
    'İzlenen her sipariş bu para biriminde kaydedilir ve raporlanır.',
  'settings.salesTracker.windowLabel': 'Atfetme penceresi (gün)',
  'settings.salesTracker.windowHint':
    'Bir sohbetten sonra bir satışın ona ne kadar süre atfedilebileceği.',
  'settings.salesTracker.savedNotePrefix': 'Kaydedildi. İzlenen satışlar şurada görünür:',
  'settings.salesTracker.savedNoteLink': 'Raporlar → İncelemeler → E-ticaret',
  'settings.salesTracker.savedNoteSuffix': '.',

  // IP izin listesi + oturum politikası — IpAllowlist.tsx
  'settings.ipAllowlist.title': 'IP izin listesi',
  'settings.ipAllowlist.description':
    'Aşağıda zorunlu kılma açıldığında temsilci/yönetici paneline erişebilecek kaynaklar. Kaydedilen bir liste, bağlandığınız adresi asla dışlayamaz — sunucu sizi kilitleyecek bir değişikliği reddeder.',
  'settings.ipAllowlist.loadError': 'IP izin listesi yüklenemedi.',
  'settings.ipAllowlist.entryLabel': 'Adres veya CIDR aralığı',
  'settings.ipAllowlist.entryRequiredError': 'Bir adres veya CIDR aralığı girin.',
  'settings.ipAllowlist.labelLabel': 'Etiket (opsiyonel)',
  'settings.ipAllowlist.addButton': 'Girdi ekle',
  'settings.ipAllowlist.empty.title': 'Henüz izin listesi girdisi yok',
  'settings.ipAllowlist.empty.description':
    'Aşağıda zorunlu kılmayı açmadan önce ekibinizin bağlandığı adresleri ekleyin.',
  'settings.ipAllowlist.sessionPolicyTitle': 'Oturum politikası',
  'settings.ipAllowlist.sessionPolicyDescription':
    'Yukarıdaki izin listesinin zorunlu olup olmadığı, bir oturumun ne kadar boşta kalabileceği ve bir sahip için aynı anda kaç oturum çalışabileceği. Kapatmak için bir sınırı boş bırakın.',
  'settings.ipAllowlist.sessionPolicyLoadError': 'Oturum politikası yüklenemedi.',
  'settings.ipAllowlist.enforceLabel': 'IP izin listesi zorunluluğu',
  'settings.ipAllowlist.enforceCheckboxLabel': 'IP izin listesini zorunlu kıl',
  'settings.ipAllowlist.enforceHint':
    'Açıldığında, yalnızca yukarıdaki adresler temsilci/yönetici paneline erişebilir.',
  'settings.ipAllowlist.idleTimeoutLabel': 'Boşta kalma süresi (dakika)',
  'settings.ipAllowlist.idleTimeoutError':
    'Bir dakika sayısı girin veya kapatmak için boş bırakın.',
  'settings.ipAllowlist.idleTimeoutSummary': 'Boşta kalma süresi: {value}',
  'settings.ipAllowlist.minutesValue.one': '{count} dakika',
  'settings.ipAllowlist.minutesValue.other': '{count} dakika',
  'settings.ipAllowlist.maxSessionsLabel': 'Maksimum eşzamanlı oturum',
  'settings.ipAllowlist.maxSessionsError':
    '1 veya daha büyük bir tam sayı girin, ya da varsayılan için boş bırakın.',
  'settings.ipAllowlist.maxSessionsSummary': 'Maksimum eşzamanlı oturum: {value}',
  'settings.ipAllowlist.defaultMaxSessions': '25 (varsayılan)',
  'settings.ipAllowlist.requireTwoFactorLabel': 'İki adımlı doğrulama',
  'settings.ipAllowlist.requireTwoFactorCheckboxLabel': 'İki adımlı doğrulamayı zorunlu kıl',
  'settings.ipAllowlist.requireTwoFactorHint':
    'Açıldığında, henüz kaydı olmayan bir üye bir sonraki girişinde kayıt olmaya yönlendirilir — kimse anında oturumdan atılmaz ya da kilitlenmez.',
  'settings.ipAllowlist.requireTwoFactorConfirmTitle': 'İki adımlı doğrulama zorunlu kılınsın mı?',
  'settings.ipAllowlist.requireTwoFactorConfirmDescription':
    'Her üyenin çalışan bir doğrulayıcısı olması gerekecek. Henüz kaydı olmayanlar bir sonraki girişe kadar normal çalışmaya devam eder, o girişte kayıt olmaları istenir.',
  'settings.ipAllowlist.requireTwoFactorMissingCount.one':
    '{total} üyeden {count} tanesi henüz iki adımlı doğrulama kaydı yapmadı.',
  'settings.ipAllowlist.requireTwoFactorMissingCount.other':
    '{total} üyeden {count} tanesi henüz iki adımlı doğrulama kaydı yapmadı.',
  'settings.ipAllowlist.requireTwoFactorConfirmButton': 'Zorunlu kıl',

  // Tek oturum açma + SCIM — SsoConnection.tsx
  'settings.sso.title': 'Tek oturum açma',
  'settings.sso.description':
    'Oturum açmayı bir SAML 2.0 kimlik sağlayıcısına federe edin. Bir bağlantı eklemek veya değiştirmek yalnızca çalışma alanı sahibiyle sınırlıdır — buraya sertifika yazmak kimin imzasına güvenileceğine karar verir.',
  'settings.sso.loadError': 'SSO bağlantıları yüklenemedi.',
  'settings.sso.restrictedNote':
    'Bir bağlantı eklemeyi, döndürmeyi veya kaldırmayı yalnızca çalışma alanı sahibi yapabilir.',
  'settings.sso.nameLabel': 'Ad',
  'settings.sso.nameError': 'Bu bağlantıya bir ad verin.',
  'settings.sso.entityIdLabel': 'IdP varlık kimliği',
  'settings.sso.entityIdError': 'IdP varlık kimliğini girin.',
  'settings.sso.ssoUrlLabel': 'Oturum açma URL’si',
  'settings.sso.ssoUrlError': "IdP oturum açma URL'sini girin.",
  'settings.sso.certificateLabel': 'IdP imzalama sertifikası (PEM)',
  'settings.sso.certificateError': 'IdP sertifikasını yapıştırın.',
  'settings.sso.verifiedDomainsLabel': 'Doğrulanmış alan adları',
  'settings.sso.verifiedDomainsError': 'En az bir alan adı girin, örneğin acme.com.',
  'settings.sso.verifiedDomainsHint':
    'Virgülle ayırın. Bu kimlik sağlayıcı ve SCIM yalnızca bu alan adlarındaki adresleri sağlayabilir — şirketinizin alan adlarını tam ve joker karakter kullanmadan yazın. Her biri, kimseyi sağlayabilmesi için önce sahiplik doğrulamasından geçer.',
  'settings.sso.verifiedDomainsSummary': 'Sağlayabildiği alan adları: {domains}',
  'settings.sso.domainVerified': 'Doğrulandı',
  'settings.sso.domainPendingStatus': 'Henüz doğrulanmadı',
  'settings.sso.domainPending': 'siz doğrulayana kadar kimseyi sağlamaz',
  'settings.sso.domainChallengeSent': 'kod {mailbox} adresine gönderildi',
  'settings.sso.domainSendCode': 'Doğrulama kodu gönder',
  'settings.sso.domainResend': 'Yeniden gönder',
  'settings.sso.domainEnterCode': 'Kodu gir',
  'settings.sso.domainCodeLabel': '{domain} için doğrulama kodu',
  'settings.sso.domainVerifyAction': 'Doğrula',
  'settings.sso.domainErrorFallback': 'İşlem tamamlanamadı. Tekrar deneyin.',
  'settings.sso.emailAttributeLabel': 'E-posta özniteliği (opsiyonel)',
  'settings.sso.nameAttributeLabel': 'Ad özniteliği (opsiyonel)',
  'settings.sso.allowIdpInitiatedLabel': 'IdP tarafından başlatılan oturum açmaya izin ver',
  'settings.sso.enableImmediatelyLabel': 'Hemen etkinleştir',
  'settings.sso.verifyButton': 'Biçimi doğrula',
  'settings.sso.addButton': 'Bağlantı ekle',
  'settings.sso.verifyHint':
    'Biçimi doğrula, sertifikayı, varlık kimliğini ve URL’yi yalnızca yerel olarak kontrol eder — kimlik sağlayıcıyla asla iletişime geçmez.',
  'settings.sso.verifyOk': 'Doğru biçimlendirilmiş görünüyor.',
  'settings.sso.entitlementError':
    'Tek oturum açma bir Enterprise özelliğidir. Bir bağlantı eklemek için planı yükseltin.',
  'settings.sso.empty.title': 'SSO bağlantısı yok',
  'settings.sso.empty.description':
    'Üyelerinin SAML ile oturum açmasına izin vermek için kimlik sağlayıcınızın meta verilerini ekleyin.',
  'settings.sso.enabledStatus': 'Etkin',
  'settings.sso.disabledStatus': 'Devre dışı',
  'settings.sso.rotationOverlapNote': 'Döndürme örtüşmesi {date} tarihine kadar etkin',
  'settings.sso.enforcedActiveNote':
    'Zorunlu — üyeler parolayla oturum açamaz. Sahipler kendi parolalarını korur.',
  'settings.sso.enforcedInactiveNote':
    'Zorunlu olarak işaretlendi, ancak bağlantı kapalı, bu yüzden parolalar hâlâ çalışıyor.',
  'settings.sso.enabledCheckboxLabel': 'Etkin',
  'settings.sso.requireSsoLabel': "SSO'yu zorunlu kıl",
  'settings.sso.enforceModalTitle': '{name} oturum açma için zorunlu kılınsın mı?',
  'settings.sso.enforceModalDescription':
    'Bu çalışma alanındaki herkes kimlik sağlayıcınız üzerinden oturum açmak zorunda kalacak — parolaları burada çalışmayı durduracak. Sahipler bir parola kapısı tutar, böylece bir sağlayıcı kesintisi çalışma alanını kilitleyemez ve bu oturum açmaların her biri denetim günlüğüne kaydedilir.',
  'settings.sso.requireButton': 'Tek oturum açmayı zorunlu kıl',
  'settings.sso.requiring': 'Zorunlu kılınıyor…',
  'settings.sso.requireErrorFallback': 'Tek oturum açma zorunlu kılınamadı.',
  'settings.sso.removeModalTitle': '{name} kaldırılsın mı?',
  'settings.sso.removeModalDescription':
    'Bu bağlantı üzerinden oturum açan herkes o yolu hemen kaybeder. Bu geri alınamaz.',
  'settings.sso.removeConfirmButton': 'Bağlantıyı kaldır',
  'settings.sso.removing': 'Kaldırılıyor…',
  'settings.scim.title': 'SCIM provizyonu',
  'settings.scim.description':
    'Kimlik sağlayıcınızın SCIM bağlayıcısı için taşıyıcı jetonlar. Bir jeton yalnızca oluşturulduğunda bir kez gösterilir, sonra bir daha asla.',
  'settings.scim.loadError': 'Provizyon jetonları yüklenemedi.',
  'settings.scim.tokenNameLabel': 'Jeton adı',
  'settings.scim.tokenNameError': 'Bu jetona bir ad verin.',
  'settings.scim.expiresInLabel': 'Şu sürede sona erer (gün)',
  'settings.scim.createButton': 'Jeton oluştur',
  'settings.scim.creating': 'Oluşturuluyor…',
  'settings.scim.expiryRangeError': 'Son kullanma, 1 ile 365 arasında tam bir gün sayısı olmalı.',
  'settings.scim.empty.title': 'Provizyon jetonu yok',
  'settings.scim.empty.description':
    'Kimlik sağlayıcınızın SCIM bağlayıcısına yapıştırmak için bir tane oluşturun.',
  'settings.scim.untitledToken': 'Adsız jeton',
  'settings.scim.lastUsed': 'Son kullanım {date}',
  'settings.scim.neverUsed': 'Hiç kullanılmadı',
  'settings.scim.expires': 'Son kullanma {date}',
  'settings.scim.noExpiry': 'Son kullanma tarihi yok',
  'settings.scim.revokeButton': 'İptal et',
  'settings.scim.revokeModalTitle': '{name} iptal edilsin mi?',
  'settings.scim.revokeModalDefaultName': 'bu jeton',
  'settings.scim.revokeModalDescription':
    'Kimlik sağlayıcınızın bağlayıcısı, bu işlem geçerli olduğu anda kullanıcı provizyonu yapamaz veya kaldıramaz hâle gelir. Bu geri alınamaz.',
  'settings.scim.revokeConfirmButton': 'Jetonu iptal et',
  'settings.scim.revoking': 'İptal ediliyor…',
  'settings.scim.tokenCreatedTitle': '{name} oluşturuldu',
  'settings.scim.defaultTokenName': 'Jeton',
  'settings.scim.tokenCreatedDescription':
    'Bunu şimdi kimlik sağlayıcınızın SCIM bağlayıcısına yapıştırın.',
  'settings.scim.bearerTokenLabel': 'Taşıyıcı jeton',
  'settings.scim.tokenWarning': 'Bu jeton bir daha gösterilmeyecek — şimdi saklayın.',
  'settings.scim.doneButton': 'Tamam',

  // Veri bölgesi + HIPAA/BAA — Compliance.tsx
  'settings.compliance.title': 'Veri bölgesi ve uyumluluk',
  'settings.compliance.description':
    'Bu çalışma alanının verilerinin bulunduğu yer ve HIPAA İş Ortağı Sözleşmesi durumu.',
  'settings.compliance.loadError': 'Uyumluluk ayarları yüklenemedi.',
  'settings.compliance.regionLabel': 'Veri bölgesi',
  'settings.compliance.regionFixedNote':
    'Kayıt sırasında sabitlenir — bir çalışma alanının bölgesi asla değiştirilemez.',
  'settings.compliance.region.eu': 'Avrupa Birliği',
  'settings.compliance.region.us': 'Amerika Birleşik Devletleri',
  'settings.compliance.baaLabel': 'HIPAA İş Ortağı Sözleşmesi',
  'settings.compliance.baaSigned': 'İmzalandı',
  'settings.compliance.baaNotSigned': 'İmzalanmadı',
  'settings.compliance.baaAcceptedOn': '{date} tarihinde kabul edildi.',
  'settings.compliance.baaUnavailable':
    "HIPAA kapsamı yalnızca Amerika Birleşik Devletleri'nde barındırılan çalışma alanları için kullanılabilir.",
  'settings.compliance.baaRestricted': "BAA'yı yalnızca çalışma alanı sahibi kabul edebilir.",
  'settings.compliance.acceptButton': "BAA'yı kabul et",
  'settings.compliance.accepting': 'Kabul ediliyor…',
  'settings.compliance.entitlementError':
    'HIPAA kapsamı bir Enterprise özelliğidir. Sözleşmeyi kabul etmek için planı yükseltin.',

  // SIEM dışa aktarımı — SiemExport.tsx
  'settings.siemExport.title': 'SIEM dışa aktarımı',
  'settings.siemExport.description':
    'Bu çalışma alanının denetim izini bir zamanlamayla bir SIEM hedefine gönderin (SOC 2 / ISO 27001).',
  'settings.siemExport.loadError': 'SIEM dışa aktarım yapılandırması yüklenemedi.',
  'settings.siemExport.gapTitle': 'Denetim izinde bir boşluk bulundu.',
  'settings.siemExport.gapBody':
    'Denetim girdileri zincirinde bir parça eksik — kaydın bir kısmı hesaba katılamıyor. Teslimat çalışmaya devam ediyor; bunun araştırılması gerekiyor.',
  'settings.siemExport.enableLabel': 'Dışa aktarımı etkinleştir',
  'settings.siemExport.enableHint':
    'Açıkken, zamanlanmış bir iş yeni denetim girdilerini aşağıdaki hedefe gönderir.',
  'settings.siemExport.destinationLabel': 'Hedef',
  'settings.siemExport.entitlementError':
    'SIEM dışa aktarımı bir Enterprise özelliğidir. Açmak için planı yükseltin.',
  'settings.siemExport.target.file': 'Dosya (.data/siem alıcısı)',
  'settings.siemExport.lastExport': 'Son dışa aktarım',
  'settings.siemExport.lastRun': 'Son çalıştırma',
  'settings.siemExport.delivered': 'Teslim edildi',
  'settings.siemExport.pending': 'Bekliyor',

  // SLA — SlaPolicy.tsx
  'settings.sla.title': 'SLA',
  'settings.sla.description':
    'Bir müşterinin ilk yanıt için ve bir vakanın tamamlanması için ne kadar bekleyebileceği. Ölçülür ve işaretlenir, asla zorunlu kılınmaz — burada hiçbir şey bir sohbeti yeniden yönlendirmez veya yeniden önceliklendirmez.',
  'settings.sla.loadError': 'SLA hedefleri yüklenemedi.',
  'settings.sla.minutesError':
    '1-{max} arasında tam bir dakika sayısı girin veya hedef olmaması için boş bırakın.',
  'settings.sla.statusLabel': 'Durum',
  'settings.sla.active': 'Etkin',
  'settings.sla.notActive': 'Etkin değil',
  'settings.sla.downgradeNote':
    'Hedefler kaydedildi ama şu anda ölçülmüyor — bu plan SLA takibini içermiyor. Yükseltme, aşağıdaki sayılara karşı ölçümü değişmeden geri getirir.',
  'settings.sla.firstResponseLabel': 'İlk yanıt hedefi (dakika)',
  'settings.sla.resolutionLabel': 'Çözüm hedefi (dakika)',
  'settings.sla.noTargetPlaceholder': 'Hedef yok',
  'settings.sla.businessHoursLabel': 'Yalnızca mesai saatlerini say',
  'settings.sla.businessHoursHint':
    'Temsilcilerin kayıtlı çalışma programlarına göre ölçülür. Hiçbir yerde kayıtlı program yoksa, saatler kesintisiz işler.',
  'settings.sla.entitlementError':
    'SLA hedefleri bir Enterprise özelliğidir. Buradaki değişiklikleri kaydetmek için planı yükseltin.',
  'settings.sla.savedNotePrefix': 'Kaydedildi. Kaçırılanlar şurada görünür:',
  'settings.sla.savedNoteLink': 'Raporlar → Genel Bakış → SLA ihlalleri',
  'settings.sla.savedNoteSuffix': '.',

  // Sandbox — Sandbox.tsx
  'settings.sandbox.title': 'Sandbox',
  'settings.sandbox.description':
    'Entegrasyonları test etmek veya yeni bir işe alımı katmak için ikinci, bağlantısız bir çalışma alanı — asla faturalandırılmaz, bir koltuğa karşı asla sayılmaz ve üretimden görünmez.',
  'settings.sandbox.loadError': 'Sandbox yüklenemedi.',
  'settings.sandbox.isSandboxLabel': 'Bu bir sandbox',
  'settings.sandbox.isSandboxNote':
    'Bu çalışma alanındaki her şey üretimden bağlantısızdır — burada hiçbir şey faturalandırılmaz veya sayılmaz ve burada gerçek müşteri verisi yoktur.',
  'settings.sandbox.resetButton': "Sandbox'ı sıfırla",
  'settings.sandbox.resetting': 'Sıfırlanıyor…',
  'settings.sandbox.resetRestricted': "Bu sandbox'ı yalnızca çalışma alanı sahibi sıfırlayabilir.",
  'settings.sandbox.notAvailable': 'Kullanılamıyor',
  'settings.sandbox.entitlementNote':
    'Sandbox bir Enterprise özelliğidir. Bir tane oluşturmak için planı yükseltin.',
  'settings.sandbox.createdLabel': 'Sandbox oluşturuldu',
  'settings.sandbox.createdSummary': '{created} tarihinde oluşturuldu. Son sıfırlama: {reset}.',
  'settings.sandbox.createdUnknown': 'bilinmiyor',
  'settings.sandbox.resetNever': 'hiç',
  'settings.sandbox.resetFromInsideNote':
    "Sandbox'ın kendisine oturum açarak sıfırlayın — bir üretim kimlik bilgisi onu silemez.",
  'settings.sandbox.emptyNote': "Bu çalışma alanının henüz bir sandbox'ı yok.",
  'settings.sandbox.createButton': 'Sandbox oluştur',
  'settings.sandbox.creating': 'Oluşturuluyor…',
  'settings.sandbox.createRestricted': "Bir sandbox'ı yalnızca çalışma alanı sahibi oluşturabilir.",
  'settings.sandbox.resetModalTitle': 'Bu sandbox sıfırlansın mı?',
  'settings.sandbox.resetModalDescription':
    'İçindeki her sohbet, kişi ve ayar silinir. Bu geri alınamaz ve oturumunuz kapatılır.',

  // Zamanlanmış dışa aktarımlar — ScheduledExports.tsx
  'settings.scheduledExports.title': 'Zamanlanmış dışa aktarımlar',
  'settings.scheduledExports.description':
    'Bir rapor grubunu ekibinize zamanlayıcıyla e-postalayın — günlük, haftalık veya aylık, CSV olarak.',
  'settings.scheduledExports.loadError': 'Zamanlanmış dışa aktarımlar yüklenemedi.',
  'settings.scheduledExports.reportLabel': 'Rapor',
  'settings.scheduledExports.reportPlaceholder': 'Bir rapor seçin…',
  'settings.scheduledExports.frequencyLabel': 'Sıklık',
  'settings.scheduledExports.frequency.daily': 'Günlük',
  'settings.scheduledExports.frequency.weekly': 'Haftalık',
  'settings.scheduledExports.frequency.monthly': 'Aylık',
  'settings.scheduledExports.scheduleButton': 'Dışa aktarımı zamanla',
  'settings.scheduledExports.scheduling': 'Zamanlanıyor…',
  'settings.scheduledExports.recipientsLegend': 'Alıcılar',
  'settings.scheduledExports.noActiveAgents': 'Bildirilecek etkin temsilci yok.',
  'settings.scheduledExports.groupError': 'Bir rapor grubu seçin.',
  'settings.scheduledExports.recipientsError': 'En az bir alıcı seçin.',
  'settings.scheduledExports.empty.title': 'Zamanlanmış dışa aktarım yok',
  'settings.scheduledExports.empty.description':
    'Yukarıdan bir rapor grubu zamanlayın, otomatik olarak ekibinizin gelen kutusuna düşer.',
  'settings.scheduledExports.neverRun': 'Hiç çalışmadı',
  'settings.scheduledExports.delivered': 'Teslim edildi',
  'settings.scheduledExports.failed': 'Başarısız',
  'settings.scheduledExports.running': 'Çalışıyor',
  'settings.scheduledExports.checking': 'Kontrol ediliyor…',
  'settings.scheduledExports.recipientCount.one': '{count} alıcı',
  'settings.scheduledExports.recipientCount.other': '{count} alıcı',
  'settings.scheduledExports.summary': '{frequency} · {recipients}',
  'settings.scheduledExports.cancelConfirm': 'Bu dışa aktarım iptal edilsin mi?',
  'settings.scheduledExports.confirmCancelButton': 'İptali onayla',
  'settings.scheduledExports.keepButton': 'Koru',
  'settings.scheduledExports.cancelAriaLabel': '{group} dışa aktarımını iptal et',

  // Engellenen IP adresleri — BannedCustomerIps.tsx
  'settings.bannedIps.title': 'Engellenen IP adresleri',
  'settings.bannedIps.description':
    "Bu adreslerden birindeki bir ziyaretçi, taze bir oturumdan bile olsa bir sohbet için reddedilir. Bunun yerine adlı bir kişiyi yasaklamak için Müşteriler'de profilindeki engelleme eylemini kullanın.",
  'settings.bannedIps.loadError': 'Engellenen adresler yüklenemedi.',
  'settings.bannedIps.ipLabel': 'IP adresi',
  'settings.bannedIps.ipRequiredError': 'Bir IP adresi girin.',
  'settings.bannedIps.ipHint':
    'Bir IPv4 veya IPv6 adresi. Siz burada kaldırana kadar ziyaretçi engellenir.',
  'settings.bannedIps.blockButton': 'Adresi engelle',
  'settings.bannedIps.empty.title': 'Engellenen adres yok',
  'settings.bannedIps.empty.description':
    'Ondan gelen sohbetleri reddetmek için bir IP adresi ekleyin. Siz eklemedikçe hiçbir şey engellenmez.',

  // Denetim günlüğü kapısı — AuditLog.tsx (sayfanın kendisi `audit.*` ad alanında)
  'settings.auditLog.title': 'Denetim günlüğü',
  'settings.auditLog.description':
    'Oturum açmalar, rol değişiklikleri, silmeler ve webhook değişiklikleri — son 30 gün, her planda saklanır.',
  'settings.auditLog.body': 'Bu çalışma alanında kimin ne yaptığını inceleyin.',
  'settings.auditLog.openButton': 'Denetim günlüğünü aç',

  // Dosya paylaşımı — FileSharing.tsx
  'settings.fileSharing.title': 'Dosya paylaşımı',
  'settings.fileSharing.description':
    'Hem temsilcilerden hem müşterilerden gelen eklere uygulanır. Bu kuralların dışındaki her şey reddedilir.',
  'settings.fileSharing.loadError': 'Dosya paylaşımı kuralları yüklenemedi.',
  'settings.fileSharing.allowLabel': 'Dosya paylaşımına izin ver',
  'settings.fileSharing.allowHint': 'Bunu kapatmak, kim gönderirse göndersin her eki reddeder.',
  'settings.fileSharing.allowedTypesLabel': 'İzin verilen türler',
  'settings.fileSharing.allowedTypesHint':
    'MIME türleri, virgülle ayrılmış — bir tarayıcının bir dosyayı etiketlediği biçim.',
  'settings.fileSharing.maxSizeLabel': 'Maksimum boyut (MB)',
  'settings.fileSharing.maxSizeError': '1 ile 100 MB arasında bir boyut girin.',

  // Yetenekler (uzmanlık kataloğu) — Skills.tsx
  'settings.skills.title': 'Yetenekler',
  'settings.skills.description':
    "Uzmanlık alanları. Bir yönlendirme kuralında birini zorunlu kılın veya Ekip'te bir temsilciye atayın.",
  'settings.skills.loadError': 'Yetenekler yüklenemedi.',
  'settings.skills.nameLabel': 'Yetenek',
  'settings.skills.nameError': 'Yeteneğe bir ad verin.',
  'settings.skills.addButton': 'Yetenek ekle',
  'settings.skills.empty.title': 'Henüz yetenek yok',
  'settings.skills.empty.description':
    "Bir yönlendirme kuralında zorunlu kılmak veya Ekip'te bir temsilciye atamak için bir yetenek ekleyin.",
  'settings.skills.deleteAriaLabel': '{name} yeteneğini sil',

  // Yönlendirme kuralları — RoutingRules.tsx
  'settings.routing.title': 'Yönlendirme',
  'settings.routing.description':
    'Sırayla kontrol edilir. Koşullarının tümü eşleşen ilk kural ekibi belirler.',
  'settings.routing.loadError': 'Yönlendirme kuralları yüklenemedi.',
  'settings.routing.empty.title': 'Yönlendirme kuralı yok',
  'settings.routing.empty.description':
    'Bir yedek kural olmadan, sohbetlerin gidecek bir yeri olmaz.',
  'settings.routing.fallbackBadge': 'yedek',
  'settings.routing.everythingElse': 'Geri kalan her şey',
  'settings.routing.ruleLabel': 'Kural',
  'settings.routing.noTeam': 'ekip yok',
  'settings.routing.fallbackDisabledTitle': 'Yedek kural devre dışı bırakılamaz',
  'settings.routing.fallbackDeleteTitle':
    'Yedek kural silinemez — bunun yerine başka bir ekibe yönlendirin',
  'settings.routing.deleteAriaLabel': '{name} kuralını sil',
  'settings.routing.anything': 'Herhangi biri',
  'settings.routing.conditionSkill': 'yetenek {names}',
  'settings.routing.form.nameLabel': 'Kural adı',
  'settings.routing.form.nameError': 'Kurala bir ad verin.',
  'settings.routing.form.urlLabel': 'Sayfa adresi şunu içerdiğinde',
  'settings.routing.form.urlError': 'Adresin içermesi gereken metni girin.',
  'settings.routing.form.teamLabel': 'Şu ekibe gönder',
  'settings.routing.form.teamPlaceholder': 'Bir ekip seçin',
  'settings.routing.form.teamError': 'Bu kuralın göndereceği ekibi seçin.',
  'settings.routing.form.priorityLabel': 'Öncelik',
  'settings.routing.form.priorityError': '0 ile 1000 arasında tam bir sayı girin.',
  'settings.routing.form.asFallbackLabel':
    'Bunu yedek yap — başka hiçbir kuralın eşleşmediği her şeyi alır',
  'settings.routing.form.addButton': 'Kural ekle',
  'settings.routing.form.noTeams':
    'Önce bir ekip oluşturun — bir kuralın sohbetleri gönderecek bir yeri olmalı.',

  // Talep kuralları — TicketRules.tsx
  'settings.ticketRules.title': 'Talep kuralları',
  'settings.ticketRules.description':
    'Bir talep açıldığında, ilk eşleşen kural önceliğini belirler veya bir etiket uygular.',
  'settings.ticketRules.loadError': 'Talep kuralları yüklenemedi.',
  'settings.ticketRules.ruleNameLabel': 'Kural adı',
  'settings.ticketRules.ruleNameError': 'Kurala bir ad verin.',
  'settings.ticketRules.subjectLabel': 'Konu şunu içerdiğinde',
  'settings.ticketRules.subjectError': 'Konunun içermesi gereken metni girin.',
  'settings.ticketRules.thenLabel': 'O zaman',
  'settings.ticketRules.setPriorityOption': 'Öncelik belirle',
  'settings.ticketRules.addTagOption': 'Etiket ekle',
  'settings.ticketRules.priorityLabel': 'Öncelik',
  'settings.ticketRules.tagLabel': 'Etiket',
  'settings.ticketRules.valueError': 'Eylem için bir değer girin.',
  'settings.ticketRules.priorityWholeNumberError': '0 veya daha büyük tam bir sayı girin.',
  'settings.ticketRules.addButton': 'Kural ekle',
  'settings.ticketRules.empty.title': 'Talep kuralı yok',
  'settings.ticketRules.empty.description':
    'Talepleri açıldıkları anda otomatik ata, önceliklendir veya etiketle.',
  'settings.ticketRules.deleteAriaLabel': '{name} kuralını sil',
  'settings.ticketRules.subjectContains': 'konu “{text}” içeriyor',
  'settings.ticketRules.fromSource': '{source} kaynağından',
  'settings.ticketRules.anyTicket': 'herhangi bir talep',
  'settings.ticketRules.assignAgent': 'bir temsilciye ata',
  'settings.ticketRules.assignTeam': 'bir ekibe ata',
  'settings.ticketRules.setPriorityAction': 'önceliği {priority} yap',
  'settings.ticketRules.addTagAction': '“{tag}” etiketini ekle',
  'settings.ticketRules.doNothing': 'hiçbir şey yapma',

  // İki adımlı doğrulama — TwoFactor.tsx
  'settings.twoFactor.title': 'İki adımlı doğrulama',
  'settings.twoFactor.description':
    'Giriş yaparken parolanıza ek olarak bir doğrulayıcı uygulamadan kod isteyin.',
  'settings.twoFactor.loadError': 'İki adımlı doğrulama durumu yüklenemedi.',
  'settings.twoFactor.offDescription': 'Hesabınız şu anda yalnızca parolayla giriş yapıyor.',
  'settings.twoFactor.pendingHint':
    'Kurulum başlatıldı ama tamamlanmadı. Kaldığınız yerden devam etmek için tekrar etkinleştirin.',
  'settings.twoFactor.recoveryCodesRemaining.one': '{count} kurtarma kodu kaldı',
  'settings.twoFactor.recoveryCodesRemaining.other': '{count} kurtarma kodu kaldı',
  'settings.twoFactor.enableButton': 'İki adımlı doğrulamayı etkinleştir',
  'settings.twoFactor.enabling': 'Başlatılıyor…',
  'settings.twoFactor.regenerateButton': 'Yeni kurtarma kodları al',
  'settings.twoFactor.disableButton': 'Kapat',
  'settings.twoFactor.disableBlockedByWorkspaces':
    'İki adımlı doğrulama {names} tarafından zorunlu tutuluyor. Orada üye olduğunuz sürece kapatılamaz.',

  'settings.twoFactor.enrollPasswordUnavailable':
    'Bu hesap kimlik sağlayıcı üzerinden giriş yapıyor ve birden fazla çalışma alanına ait. Önce hesaba bir parola belirleyin — aksi hâlde tek bir çalışma alanı, hepsini koruyan ikinci faktörü seçmiş olur.',

  'settings.twoFactor.enrollPassword.title':
    'İki adımlı doğrulamayı açmak için kimliğinizi doğrulayın',
  'settings.twoFactor.enrollPassword.description':
    'İkinci faktör, bu hesabın girebildiği her çalışma alanını kapsar; bu yüzden kurmak da kapatmak gibi parolanızı ister.',
  'settings.twoFactor.enrollPassword.label': 'Parola',
  'settings.twoFactor.enrollPassword.error': 'Bu alan zorunludur.',
  'settings.twoFactor.enrollPassword.confirmButton': 'Devam et',
  'settings.twoFactor.enrollPassword.confirming': 'Kontrol ediliyor…',
  'settings.twoFactor.enrollPassword.discardConfirm': 'Bundan vazgeçilsin mi?',

  'settings.twoFactor.enroll.title': 'İki adımlı doğrulamayı kur',
  'settings.twoFactor.enroll.description':
    'Bunu doğrulayıcı uygulamanıza girin, sonra uygulamanın gösterdiği kodu girin.',
  'settings.twoFactor.enroll.secretLabel': 'Kurulum anahtarı',
  'settings.twoFactor.enroll.copySecretAriaLabel': 'Kurulum anahtarını kopyala',
  'settings.twoFactor.enroll.uriLabel': 'Kurulum bağlantısı',
  'settings.twoFactor.enroll.copyUriAriaLabel': 'Kurulum bağlantısını kopyala',
  'settings.twoFactor.enroll.codeLabel': 'Doğrulama kodu',
  'settings.twoFactor.enroll.codeError': 'Doğrulayıcı uygulamanızın gösterdiği kodu girin.',
  'settings.twoFactor.enroll.verifyButton': 'Doğrula ve etkinleştir',
  'settings.twoFactor.enroll.verifying': 'Doğrulanıyor…',
  'settings.twoFactor.enroll.discardConfirm': 'Bu kurulum denemesi iptal edilsin mi?',

  'settings.twoFactor.recovery.title': 'Kurtarma kodlarınızı kaydedin',
  'settings.twoFactor.recovery.description':
    'Her kod bir kez çalışır ve doğrulayıcı uygulamanıza erişiminizi kaybederseniz sizi tekrar içeri alır. Bir daha gösterilmeyecekler.',
  'settings.twoFactor.recovery.downloadButton': '.txt olarak indir',
  'settings.twoFactor.recovery.savedConfirm': 'Bu kodları güvenli bir yere kaydettim.',
  'settings.twoFactor.recovery.doneButton': 'Tamam',
  'settings.twoFactor.recovery.discardConfirm':
    'Bu kodlar bir daha gösterilmeyecek. Kaydetmeden kapatılsın mı?',

  'settings.twoFactor.reauth.disableTitle': 'İki adımlı doğrulamayı kapatmak için sizi doğrulayın',
  'settings.twoFactor.reauth.regenerateTitle': 'Yeni kurtarma kodları için sizi doğrulayın',
  'settings.twoFactor.reauth.passwordLabel': 'Parola',
  'settings.twoFactor.reauth.codeLabel': 'İki adımlı doğrulama veya kurtarma kodu',
  'settings.twoFactor.reauth.credentialError': 'Bu alan zorunludur.',
  'settings.twoFactor.reauth.confirmButton': 'Onayla',
  'settings.twoFactor.reauth.confirming': 'Onaylanıyor…',
  'settings.twoFactor.reauth.discardConfirm': 'Bu iptal edilsin mi?',

  // Kişisel erişim jetonları — PersonalAccessTokens.tsx (M-UI-b)
  'settings.pat.title': 'Kişisel erişim jetonları',
  'settings.pat.description':
    'API’yi sizin adınıza çağıran script’ler ve entegrasyonlar için uzun ömürlü kimlik bilgileri.',
  'settings.pat.loadError': 'Kişisel erişim jetonlarınız yüklenemedi.',
  'settings.pat.noAccess':
    'Bu oturumun kişisel erişim jetonlarını okuma yetkisi yok. Yönetmek için yeniden giriş yapın.',
  'settings.pat.unnamed': 'Adlandırılmamış jeton',
  'settings.pat.scopeCount.one': '{count} kapsam',
  'settings.pat.scopeCount.other': '{count} kapsam',
  'settings.pat.created': 'Oluşturuldu: {when}',
  'settings.pat.lastUsed': 'Son kullanım: {when}',
  'settings.pat.neverUsed': 'Hiç kullanılmadı',
  'settings.pat.expires': 'Geçerlilik bitişi: {when}',
  'settings.pat.neverExpires': 'Süresiz',
  'settings.pat.revokeButton': 'İptal et',
  'settings.pat.revokeAriaLabel': '{name} jetonunu iptal et',
  'settings.pat.empty.title': 'Henüz jeton yok',
  'settings.pat.empty.description':
    'Oturumunuzu ödünç vermek yerine, bir script ya da entegrasyondan API’yi çağırmak için bir jeton oluşturun.',

  'settings.pat.form.nameLabel': 'Jeton adı',
  'settings.pat.form.namePlaceholder': 'Gecelik raporlama işi',
  'settings.pat.form.nameError':
    'Bu jetona bir ad verin; sonradan neyi iptal ettiğinizi bilesiniz.',
  'settings.pat.form.expiryLabel': 'Geçerlilik süresi',
  'settings.pat.form.days': '{days} gün',
  'settings.pat.form.scopesLabel': 'Kapsamlar',
  'settings.pat.form.scopesHint':
    'Yalnız kendi oturumunuzun sahip olduğu kapsamlar verilebilir ve bunlar jeton oluşturulurken sabitlenir — gerekenin en azını verin.',
  'settings.pat.form.createButton': 'Jeton oluştur',
  'settings.pat.form.creating': 'Oluşturuluyor…',

  'settings.pat.issued.title': '{name} hazır',
  'settings.pat.issued.description': 'Şimdi kopyalayın — bu jeton yalnız bir kez gösteriliyor.',
  'settings.pat.issued.tokenLabel': 'Jeton',
  'settings.pat.issued.copyAriaLabel': 'Jetonu kopyala',
  'settings.pat.issued.warning':
    'Bu jeton bir daha gösterilmeyecek. Kaybederseniz iptal edip yenisini oluşturun.',
  'settings.pat.issued.usageLabel': 'Nasıl gönderilir',
  'settings.pat.issued.doneButton': 'Tamam',

  'settings.pat.revoke.title': '{name} iptal edilsin mi?',
  'settings.pat.revoke.description':
    'Bu jetonu hala kullanan her şey anında çalışmayı durdurur ve bu geri alınamaz.',
  'settings.pat.revoke.confirmButton': 'Jetonu iptal et',
  'settings.pat.revoke.revoking': 'İptal ediliyor…',
};
