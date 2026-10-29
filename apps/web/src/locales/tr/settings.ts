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
  // Bölüm başlığının altındaki ikinci satır: ürün alanı ve bölümün grubu
  // (tm 259.15) — ilk satır bölümün kendi adıdır.
  'settings.pageBreadcrumb': 'Ayarlar · {group}',

  // Yan gezinme — SettingsNav.tsx (FR-MOD-08.1)
  'settings.nav.label': 'Ayarlar gezinmesi',
  'settings.nav.pin': 'Yan gezinmeyi sabitle',
  'settings.nav.unpin': 'Yan gezinmenin sabitlemesini kaldır',
  'settings.nav.group.general': 'Genel',
  'settings.nav.group.channels': 'Kanallar',
  'settings.nav.group.routing': 'Yönlendirme',
  'settings.nav.group.inbox': 'Gelen kutusu',
  'settings.nav.group.integrations': 'Entegrasyonlar',
  'settings.nav.group.security': 'Güvenlik',
  'settings.nav.group.usage': 'Kullanım ve kotalar',
  'settings.nav.group.billing': 'Faturalandırma',
  'settings.nav.section.notifications': 'Bildirimler',
  'settings.nav.section.profile': 'Profilim',
  'settings.nav.section.company': 'Şirket bilgileri',
  'settings.nav.section.brands': 'Markalar',
  'settings.nav.section.appearance': 'Görünüm',
  'settings.appearance.title': 'Görünüm',
  'settings.appearance.description':
    'Bütün üyelerin paneli gördüğü yazı tipi. Üyeler hesap menüsünden kendi seçimini yine yapabilir — en son yapılan seçim geçerlidir.',
  'settings.appearance.legend': 'Çalışma alanı yazı tipi',
  'settings.appearance.sample': 'Pijamalı hasta yağız şoföre çabucak güvendi.',
  'settings.appearance.remove': 'Varsayılanı kaldır',
  'settings.appearance.saved':
    'Kaydedildi — üyeler paneli bir sonraki açışta bu yazı tipiyle görür.',
  'settings.appearance.removed': 'Varsayılan kaldırıldı.',
  'settings.appearance.ownerOnly': 'Bu ayarı yalnız çalışma alanı sahibi değiştirebilir.',
  'settings.appearance.current.none':
    'Çalışma alanı varsayılanı yok: kendi seçimini yapmayan üyeler Inter görür.',
  'settings.appearance.current.set': 'Şu anki varsayılan: {font} · {date}',
  'settings.appearance.yours': 'Senin panelin şu an: {source}',
  'settings.appearance.loadError': 'Görünüm ayarları yüklenemedi.',
  'settings.nav.section.channels': 'Tüm kanallar',
  'settings.nav.section.websiteWidgets': "Web sitesi widget'ları",
  'settings.nav.section.widget': 'Widget görünümü',
  'settings.nav.section.salesTracker': 'Satış takibi',
  'settings.nav.section.routingRules': 'Sohbet yönlendirme',
  'settings.nav.section.skills': 'Yetenekler',
  'settings.nav.section.ticketRules': 'Talep kuralları',
  'settings.nav.section.sla': 'SLA',
  'settings.nav.section.cannedResponses': 'Kayıtlı yanıtlar',
  'settings.nav.section.tags': 'Etiketler',
  'settings.nav.section.chatTimeout': 'Hareketsizlik, sohbet süresi ve gün sınırı',
  'settings.nav.section.ticketEmailTemplates': 'Talep e-posta şablonları',
  'settings.nav.section.customFields': 'Özel alanlar',
  'settings.nav.section.chatForms': 'Sohbet formları',
  'settings.nav.section.integrations': 'Uygulama pazaryeri',
  'settings.nav.section.mcp': 'MCP sunucusu',
  'settings.nav.section.personalAccessTokens': 'Kişisel erişim jetonları',
  'settings.nav.section.scheduledExports': 'Zamanlanmış dışa aktarımlar',
  'settings.nav.section.sandbox': 'Sandbox',
  'settings.nav.section.trustedDomains': 'Güvenilir alan adları',
  'settings.nav.section.bannedCustomers': 'Engellenen IP adresleri',
  'settings.nav.section.memberRecognition': 'Üye tanıma',
  'settings.nav.section.fileSharing': 'Dosya paylaşımı',
  'settings.nav.section.abuseProtection': 'Kötüye kullanım koruması',
  'settings.nav.section.sensitiveData': 'Hassas veri',
  'settings.nav.section.ipAllowlist': 'IP izin listesi',
  'settings.nav.section.sso': 'Tek oturum açma',
  'settings.nav.section.permissions': 'Roller ve izinler',
  'settings.nav.section.myPermissions': 'Yetkilerim',
  'settings.nav.section.twoFactor': 'İki adımlı doğrulama',
  'settings.nav.section.compliance': 'Veri bölgesi ve uyumluluk',
  'settings.nav.section.dataRetention': 'Veri saklama',
  'settings.nav.section.aiUsage': 'Yapay zekâ kullanımı',
  'settings.nav.section.aiQuality': 'AI kalite',
  'settings.nav.section.aiAgent': 'AI Ajanı',
  'settings.nav.section.auditLog': 'Denetim günlüğü',
  'settings.nav.section.siem': 'SIEM dışa aktarımı',
  'settings.nav.section.billing': 'Abonelik ve faturalar',

  // Yan gezinme araması — SettingsNav.tsx (FR-MOD-08.1 · tm 255.11)
  'settings.nav.search.label': 'Ayarlarda ara',
  'settings.nav.search.placeholder': 'Ayarlarda ara…',
  'settings.nav.search.resultsLabel': 'Arama sonuçları',
  'settings.nav.search.empty': '"{query}" için bölüm bulunamadı.',
  'settings.nav.search.resultsCount.one': '{count} bölüm bulundu.',
  'settings.nav.search.resultsCount.other': '{count} bölüm bulundu.',

  // Şirket bilgileri — CompanyDetails.tsx (FR-MOD-08.3)
  'settings.company.title': 'Şirket bilgileri',
  'settings.company.description':
    'Bu çalışma alanının kim olduğu: faturalardaki ve widget üzerindeki ad, raporların altında grupladığı sektör, posta adresi ve ekibin çalıştığı saat.',
  'settings.company.descriptionPilot':
    'Bu çalışma alanının kim olduğu: widget üzerindeki ad, raporların altında grupladığı sektör, posta adresi ve ekibin çalıştığı saat.',
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
  'settings.company.sizeLabel': 'Şirket büyüklüğü',
  'settings.company.sizeUnset': 'Belirlenmedi',
  'settings.company.sizeHint':
    'Burada kaç kişi çalışıyor — önerileri sizin için uyarlamamıza yardımcı olur.',
  'settings.company.size.1_10': '1-10 kişi',
  'settings.company.size.11_50': '11-50 kişi',
  'settings.company.size.51_200': '51-200 kişi',
  'settings.company.size.201_1000': '201-1.000 kişi',
  'settings.company.size.1000_plus': '1.000+ kişi',
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
  'settings.trustedDomains.removeConfirmTitle': 'Alan adı {domain} kaldırılsın mı?',
  'settings.trustedDomains.removeAriaLabel': '{domain} kaldır',
  'settings.trustedDomains.removeConfirmDescription':
    'Widget bu alan adına artık güvenmez. Bu işlem geri alınamaz.',
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
  'settings.cannedResponses.deleteConfirmTitle': '#{shortcut} kısayolu silinsin mi?',
  'settings.cannedResponses.deleteConfirmDescription':
    'Kayıtlı yanıt, onu kullanabilen herkes için silinir. Bu işlem geri alınamaz.',
  'settings.cannedResponses.teamLabel': 'İlgili ekip',
  'settings.cannedResponses.allTeams': 'Tüm ekipler',
  'settings.cannedResponses.teamOnly': 'yalnız {name}',
  'settings.cannedResponses.teamHint':
    'Yanıtı herkesin kullanabilmesi için Tüm ekipler seçili kalsın.',
  'settings.cannedResponses.editTeamButton': 'Ekibi düzenle',
  'settings.cannedResponses.editTeamAriaLabel': '#{shortcut} kısayolunun ekibini düzenle',
  'settings.cannedResponses.teamForLabel': '#{shortcut} kısayolunun ekibi',

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
  'settings.tags.deleteConfirmTitle': 'Etiket “{name}” silinsin mi?',
  'settings.tags.deleteConfirmDescription':
    'Etiket hesaptaki herkes için silinir. Bu işlem geri alınamaz.',
  'settings.tags.teamsLabel': 'Ekipler',
  'settings.tags.teamsHint':
    'Bu etiketin tüm ekiplere uygulanması için hiçbir kutuyu işaretlemeyin.',
  'settings.tags.editTeamsButton': 'Ekipleri düzenle',
  'settings.tags.editTeamsAriaLabel': '{name} etiketinin ekiplerini düzenle',

  // Sohbet zaman aşımı — ChatTimeout.tsx
  'settings.chatTimeout.title': 'Hareketsizlik, sohbet süresi ve gün sınırı',
  'settings.chatTimeout.description':
    'Ajanın yanıtlamadığı sohbetleri başkasına aktarın, sessiz kalanları ajanın sınırından düşürün, boşta kalanları kapatın ve bir konuşma gününün nerede bitip yenisinin başladığını seçin.',
  'settings.chatTimeout.loadError': 'Sohbet zaman aşımı ayarı yüklenemedi.',
  'settings.chatTimeout.enableLabel': 'Boşta kalan sohbetleri otomatik kapat',
  'settings.chatTimeout.enableHint':
    "Kapalıyken web sitesi widget'ından gelen sohbetler 30 dakika hareketsiz kalınca yine kapanır, mesajlaşma kanallarından gelenler açık kalır. Açıkken, aşağıdaki süre boyunca hiçbir hareket olmayan her sohbet otomatik olarak kapanır.",
  'settings.chatTimeout.amountLabel': 'Şu süre boşta kalınca',
  'settings.chatTimeout.unitLabel': 'Birim',
  'settings.chatTimeout.unitMinutes': 'Dakika',
  'settings.chatTimeout.unitHours': 'Saat',
  'settings.chatTimeout.amountError':
    "0'dan büyük, toplam en fazla 30 gün olan tam bir sayı girin.",

  // Konuşma günü sınırı — ChatTimeout.tsx (ID-04)
  'settings.dayBoundary.heading': 'Gün sınırı',
  'settings.chatTimeout.orderHint':
    'Süreler sohbetin sessizleştiği sırayı izler: önce aktarılır, sonra pasif sayılır, en son kapatılır. Açık olan her süre bir sonrakinden kısa olmalıdır.',
  'settings.chatTimeout.transfer.enableLabel': 'Yanıtlanmayan sohbetleri başka bir ajana aktar',
  'settings.chatTimeout.transfer.enableHint':
    'Sohbetin verildiği ajan oyuncuya bu süre içinde ilk yanıtı yazmazsa sohbet aynı ekipte başka birine geçer. İki aktarmadan sonra ya da ekipte boş kimse yoksa ekibin kuyruğunun başında bekler ve ekip liderine bildirilir.',
  'settings.chatTimeout.transfer.amountLabel': 'Yanıtsız kalınca',
  'settings.chatTimeout.transfer.unitLabel': 'Aktarma birimi',
  'settings.chatTimeout.pauseLabel': 'O ajana yeni sohbet yönlendirmeyi de durdur',
  'settings.chatTimeout.pauseHint':
    'Ajan “Kabul etmiyor” durumuna alınır ve nedeni gösterilir; hazır olduğunda kendisi geri açar.',
  'settings.chatTimeout.inactive.enableLabel': 'Sessiz kalan sohbetleri pasif say',
  'settings.chatTimeout.inactive.enableHint':
    'Bu süre boyunca mesaj gelmeyen sohbet ajanın eşzamanlı sohbet sınırına sayılmaz ve gelen kutusunda soluk görünür. Yeni mesajla yeniden aktifleşir.',
  'settings.chatTimeout.inactive.amountLabel': 'Şu süre sessiz kalınca',
  'settings.chatTimeout.inactive.unitLabel': 'Pasiflik birimi',
  'settings.chatTimeout.order.transferBeforeInactive':
    'Yanıtlanmayan sohbetler, pasif sayılmadan önce aktarılmalıdır.',
  'settings.chatTimeout.order.transferBeforeTimeout':
    'Yanıtlanmayan sohbetler, boşta kalanlar kapatılmadan önce aktarılmalıdır.',
  'settings.chatTimeout.order.inactiveBeforeTimeout':
    'Sohbetler, boşta kalanlar kapatılmadan önce pasif sayılmalıdır.',
  'settings.dayBoundary.description':
    'Bir konuşma tek bir güne aittir. Günün hangi saat diliminde sayılacağını ve kaçta başlayacağını seçin; böylece gece yarısından hemen sonra yazan oyuncu doğru güne bağlanır.',
  'settings.dayBoundary.searchLabel': 'Saat dilimi ara',
  'settings.dayBoundary.searchPlaceholder': 'ör. istanbul, new york, utc+3',
  'settings.dayBoundary.zoneLabel': 'Saat dilimi',
  'settings.dayBoundary.noMatch': 'Bu aramayla eşleşen saat dilimi yok.',
  'settings.dayBoundary.hourLabel': 'Gün başlangıcı',
  'settings.dayBoundary.exampleLabel': 'Gün sınırı örneği',
  'settings.dayBoundary.exampleNow':
    'Şu an {zone} diliminde saat {time}: şimdi başlayan bir sohbet {day} gününe ait olur.',
  'settings.dayBoundary.exampleSpanMidnight': 'Her gün 00:00 ile 23:59 arasındadır.',
  'settings.dayBoundary.exampleSpan':
    'Gün {start} saatinde başlar: {before} saatindeki sohbet hâlâ önceki güne, {start} saatindeki sohbet yeni güne aittir.',
  'settings.dayBoundary.scopeNote':
    'Değişiklik yalnız bundan sonra başlayan bağlantılara uygulanır; bir güne bağlanmış sohbet o günde kalır. Raporlar ve yapay zekâ günlük kotası günleri UTC olarak saymaya devam eder.',

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
  'settings.ticketEmailTemplates.deleteConfirmTitle': 'Şablon {name} silinsin mi?',
  'settings.ticketEmailTemplates.deleteConfirmDescription':
    'Şablon hesaptaki herkes için silinir. Bu işlem geri alınamaz.',

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
  'settings.fieldType.text': 'Metin',
  'settings.fieldType.number': 'Sayı',
  'settings.fieldType.boolean': 'Evet / Hayır',
  'settings.fieldType.date': 'Tarih',
  'settings.customFields.addButton': 'Alan ekle',
  'settings.customFields.showInTableLabel': 'Kişiler tablosunda göster',
  'settings.customFields.showInTableBadge': 'Kişiler tablosunda',
  'settings.customFields.empty.title': 'Henüz özel alan yok',
  'settings.customFields.empty.description':
    'Ekibinizin talep ve kişilerde ihtiyaç duyduğu alanları ekleyin — bir oyuncu kimliği ya da KYC durumu gibi.',
  'settings.customFields.deleteAriaLabel': '{label} alanını sil',
  'settings.customFields.deleteConfirmTitle': 'Alan {label} silinsin mi?',
  'settings.customFields.deleteConfirmDescription':
    'Alan hesaptaki herkes için silinir. Bu işlem geri alınamaz.',
  'settings.customFields.labelFieldAriaLabel': '{label} etiketi',

  // Sohbet formları (öncesi/sonrası/talep/aday) — ChatFormsSettings.tsx
  'settings.chatForms.title': 'Sohbet formları',
  'settings.chatForms.description':
    'Sohbet başlamadan önce, bittikten sonra ya da kimse müsait değilken mesaj bırakıldığında ziyaretçilerden bilgi isteyin. Yanıtlar kişiye — mesajın kendisine dair sorularda ise açtığı talebe — kaydedilir.',
  'settings.chatForms.loadError': 'Sohbet formları yüklenemedi.',
  'settings.chatForms.labelLabel': 'Etiket',
  'settings.chatForms.labelError': 'Alana bir ad verin.',
  'settings.chatForms.typeLabel': 'Tür',
  'settings.chatForms.placementLabel': 'Sorulma anı',
  'settings.chatForms.placement.preChat': 'Sohbetten önce',
  'settings.chatForms.placement.postChat': 'Sohbetten sonra',
  'settings.chatForms.placement.ticket': 'Bırakılan mesaj — talebe dair',
  'settings.chatForms.placement.prospect': 'Bırakılan mesaj — kişiye dair',
  'settings.chatForms.addButton': 'Alan ekle',
  'settings.chatForms.empty.title': 'Henüz sohbet sorusu yok',
  'settings.chatForms.empty.description':
    'Ziyaretçiler sohbete başlamadan önce, sohbet bittikten sonra ya da kimse müsait değilken mesaj bırakırken onlardan bilgi istemek için bir alan ekleyin — bir sipariş numarası, bir hesap kimliği gibi.',
  'settings.chatForms.deleteAriaLabel': '{label} alanını sil',
  'settings.chatForms.deleteConfirmTitle': 'Alan {label} silinsin mi?',
  'settings.chatForms.deleteConfirmDescription':
    'Alan bu formdan kalkar; ziyaretçilerden artık istenmez. Bu işlem geri alınamaz.',
  'settings.chatForms.builtIn.title': 'Yerleşik alanlar',
  'settings.chatForms.builtIn.description':
    'Ziyaretçinin ilk sohbetinden önce doldurduğu form. Açılıp açılmayacağını ve dört alandan hangilerinin gösterilip zorunlu olacağını seçin.',
  'settings.chatForms.builtIn.loadError': 'Sohbet öncesi form yüklenemedi.',
  'settings.chatForms.builtIn.enabledLabel': 'Sohbet başlamadan önce sor',
  'settings.chatForms.builtIn.enabledHint':
    'Kapalıyken ziyaretçi hemen yazar; ilk mesajı sohbeti açar.',
  'settings.chatForms.builtIn.customHidden': 'Form kapalıyken özel sorularınız da sorulmaz.',
  'settings.chatForms.builtIn.fieldColumn': 'Alan',
  'settings.chatForms.builtIn.showColumn': 'Göster',
  'settings.chatForms.builtIn.requiredColumn': 'Zorunlu',
  'settings.chatForms.builtIn.field.name': 'Ad soyad',
  'settings.chatForms.builtIn.field.username': 'Kullanıcı adı',
  'settings.chatForms.builtIn.field.email': 'E-posta',
  'settings.chatForms.builtIn.field.message': 'İlk mesaj',
  'settings.chatForms.builtIn.showAria': '{field} alanını göster',
  'settings.chatForms.builtIn.requireAria': '{field} alanını zorunlu yap',
  'settings.chatForms.builtIn.usernameWarning':
    'Üye tanıma ve gün içi hafıza bu alan olmadan zayıflar.',
  'settings.chatForms.builtIn.messageHint':
    'Bu alan yokken ziyaretçinin sohbete yazdığı ilk satır sohbeti açar.',
  'settings.chatForms.builtIn.notSaved':
    'Bunlar varsayılan değerler, henüz kaydedilmedi. Kaydedince zorunlu alanlar sunucuda da denetlenir.',
  'settings.chatForms.builtIn.leaveMessage':
    'Sohbet öncesi formdaki kaydedilmemiş değişiklikler silinsin mi?',
  'settings.chatForms.builtIn.preview': 'Önizleme',
  'settings.chatForms.builtIn.previewSubmit': 'Sohbeti başlat',
  'settings.chatForms.builtIn.previewOff': 'Form yok: ziyaretçi doğrudan sohbete geçer.',

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
  'settings.channels.email.manage': 'Adresleri yönet',
  'settings.channels.email.manageTitle': 'E-posta yönlendirme adresleri',
  'settings.channels.email.manageDescription':
    'Destek postanızı bunlardan herhangi birine yönlendirin, her mesaj bir talebe dönüşsün. Yeni kurduğunuz bir adresi denemek için test mesajı gönderin.',
  'settings.channels.email.defaultAddress': 'Varsayılan',
  'settings.channels.email.received': '{count} mesaj · son {when}',
  'settings.channels.email.neverReceived': 'Henüz mesaj gelmedi.',
  'settings.channels.email.sendTest': 'Test mesajı gönder',
  'settings.channels.email.testSent': '{address} adresine test mesajı ulaştı — Talepler’e bakın.',
  'settings.channels.email.remove': 'Kaldır',
  'settings.channels.email.removeConfirm':
    'Bu adres kaldırılsın mı? Buraya gönderilen postalar artık ulaşmaz. Mevcut talepler kalır.',
  'settings.channels.email.add': 'Adres ekle',
  'settings.channels.email.labelLabel': 'Adres adı (örneğin support)',
  'settings.channels.email.labelRequired': 'Adres için bir ad girin.',
  'settings.channels.email.labelInvalid':
    '1-32 karakter; küçük harf, rakam veya aradaki tire kullanın (örneğin support).',
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
  'settings.channels.telegram.liveDescription':
    '@BotFather’ın verdiği token’ı yapıştırın. Telegram ile doğrulanır, bot adı Telegram’dan alınır ve token şifreli saklanır.',
  'settings.channels.live': 'Gerçek',

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
  'settings.websiteWidgets.removeConfirmTitle': 'Web sitesi {domain} kaldırılsın mı?',
  'settings.websiteWidgets.removeConfirmDescription':
    'Widget bu sitede çalışmayı durdurur; oradaki ziyaretçiler artık sohbet başlatamaz. Bu işlem geri alınamaz.',
  'settings.websiteWidgets.footerHintPrefix': 'Kod parçasını her sayfada kapanış',
  'settings.websiteWidgets.footerHintSuffix': 'etiketinden hemen önce yapıştırın.',
  'settings.websiteWidgets.customizeWidget': "Widget'ı özelleştir",
  'settings.websiteWidgets.snippet.reportSale':
    'Ödeme tamamlandığında bir satışı bildirmek için kendi betiğinizden izleme kodunu çağırın:',
  'settings.websiteWidgets.snippet.signOut':
    'Siteniz bir kullanıcının oturumunu kapattığında sohbetin de onu unutmasını sağlayın; bu tarayıcıdaki sonraki kişi yeni bir konuşma başlatır. Sayfadan ayrılmadan önce bitmesini bekleyin:',
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
    'SiyahTuş verileriniz hakkında yapay zekâ asistanlarına sorun. Claude, ChatGPT ve herhangi bir MCP uyumlu araçla çalışır.',
  'settings.mcpConnection.loadError': 'MCP sunucu bilgileri yüklenemedi.',
  'settings.mcpConnection.serverUrlLabel': 'MCP sunucu adresi',
  'settings.mcpConnection.claudeSetup': 'Claude kurulumu',
  'settings.mcpConnection.step1': "Claude'ı açın, ardından Ayarlar → Bağlayıcılar'a gidin.",
  'settings.mcpConnection.step2': '“Özel bağlayıcı ekle” seçeneğini seçin.',
  'settings.mcpConnection.step3': 'Yukarıdaki MCP sunucu adresini yapıştırın.',
  'settings.mcpConnection.step4':
    'İstendiğinde SiyahTuş hesabınızla oturum açın ve istenen kapsamları onaylayın.',
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
  'settings.brands.removeConfirmTitle': 'Marka {name} kaldırılsın mı?',
  'settings.brands.removeConfirmDescription':
    'Marka aboneliğinizden kaldırılır. Bu işlem geri alınamaz.',
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
  'settings.widgetCustomization.poweredByLabel': '“Powered by SiyahTuş” yazısını göster',
  'settings.widgetCustomization.poweredByHint':
    'Widget altbilgisinde küçük bir ibare. Kaldırmak için kapatın.',
  'settings.widgetCustomization.welcomeLegend': 'Karşılama mesajı',
  'settings.widgetCustomization.welcomeHint':
    'Ziyaretçi sohbeti açtığında ekibinizin ilk mesajı olarak görünür. İkisini de boş bırakırsanız varsayılan metin kullanılır.',
  'settings.widgetCustomization.welcomeTitleLabel': 'Başlık',
  'settings.widgetCustomization.welcomeTextLabel': 'Mesaj',
  'settings.widgetCustomization.welcomeTextHint':
    'Bağlantı için [metin](https://adres) yazın. **kalın** ve *italik* de kullanılabilir.',
  'settings.widgetCustomization.languageLegend': 'Dil',
  'settings.widgetCustomization.languageLabel': 'Widget dili',
  'settings.widgetCustomization.language.auto': 'Otomatik (ziyaretçinin tarayıcısı)',
  'settings.widgetCustomization.languageHint':
    'Otomatik, widget’ı her ziyaretçinin tarayıcı dilinde açar. Sekiz dilde gelir.',
  'settings.widgetCustomization.fallbackLanguageLabel': 'Yedek dil',
  'settings.widgetCustomization.fallbackLanguageHint':
    'Otomatik, ziyaretçinin tarayıcısında bu sekiz dilden hiçbirini bulamazsa kullanılır.',
  'settings.widgetCustomization.languageSnippetNote':
    'Kurulum kodunuza yazılmış bir dil (data-language), o sayfada bu ayarı geçersiz kılar.',
  'settings.widgetCustomization.entitlementError':
    'SiyahTuş rozetini kaldırmak bir Enterprise özelliğidir. Gizlemek için planı yükseltin.',
  'settings.widgetCustomization.previewLabel': 'Önizleme',
  'settings.widgetCustomization.previewChatWithUs': 'Bizimle sohbet edin',
  'settings.widgetCustomization.previewGreeting': 'Merhaba! Nasıl yardımcı olabiliriz?',
  'settings.widgetCustomization.previewCustomerMessage': 'Bir sorum var',
  'settings.widgetCustomization.previewPoweredBy': 'Powered by SiyahTuş',
  'settings.widgetCustomization.previewLanguageNote':
    'Önizleme metni panelinizin dilindedir; ziyaretçiler widget’ı yukarıda seçilen dilde görür.',
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
  'settings.ipAllowlist.savedNote': 'Kaydedildi.',
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
  // Refusals that name the exact fix, by the server's stable `details.reason`
  // (lib/reason-message.ts, tm 259.18).
  'settings.reason.sso_no_break_glass_owner':
    'Bu işlem çalışma alanının kilitlenmesine yol açar: tek oturum açma zorunluyken kimlik sağlayıcı yanıt veremediğinde geri dönmenin tek yolu şifresi olan bir sahiptir. SSO’yu zorunlu kılmadan önce sahip hesabına bir şifre belirleyin.',
  'settings.reason.sso_domain_code_expired':
    'Doğrulama kodunun süresi doldu. Alan adına yeni bir kod gönderip yeniden deneyin.',
  'settings.reason.sso_domain_none_outstanding':
    'Bu alan adı için bekleyen bir doğrulama kodu yok. Önce bir kod gönderin.',
  'settings.reason.sso_domain_code_mismatch':
    'Doğrulama kodu eşleşmiyor. Kodu kontrol edip yeniden deneyin.',
  'settings.reason.sso_domain_challenge_too_soon':
    'Bu alan adına doğrulama mesajı az önce gönderildi. Yenisini göndermeden önce bir dakika bekleyin.',
  'settings.reason.ip_allowlist_self_lockout':
    'Bu işlem sizi dışarıda bırakır: liste, bağlandığınız adresi de içermeye devam etmelidir.',
  'settings.sso.removeModalTitle': '{name} kaldırılsın mı?',
  'settings.sso.removeModalDescription':
    'Bu bağlantı üzerinden oturum açan herkes o yolu hemen kaybeder. Bu geri alınamaz.',
  'settings.sso.removeConfirmButton': 'Bağlantıyı kaldır',
  'settings.sso.enableConfirmTitle': '{name} açılsın mı?',
  'settings.sso.enableConfirmDescription':
    'Kimlik sağlayıcının doğruladığı, doğrulanmış bir alan adındaki herkes bu bağlantı açıldığı anda onunla oturum açabilir.',
  'settings.sso.enableConfirmButton': 'Aç',
  'settings.sso.enableConfirmFailed': '{name} açılamadı.',
  'settings.sso.disableConfirmTitle': '{name} kapatılsın mı?',
  'settings.sso.disableConfirmDescription':
    'Bu bağlantı kapalıyken kimse onunla oturum açamaz — kapalı bir zorunlu bağlantı da hiçbir şeyi zorunlu kılmaz.',
  'settings.sso.disableConfirmButton': 'Kapat',
  'settings.sso.disableConfirmFailed': '{name} kapatılamadı.',
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

  // Veri saklama — DataRetention.tsx
  'settings.retention.title': 'Veri saklama',
  'settings.retention.description':
    'Bu çalışma alanı, görüşmeleri ve ziyaretçi verilerini kalıcı olarak silmeden önce ne kadar saklıyor.',
  'settings.retention.loadError': 'Veri saklama ayarları yüklenemedi.',
  'settings.retention.threadLabel': 'Kapanmış görüşmeler',
  'settings.retention.threadHint':
    'Kapanmış görüşmeleri ve içlerindeki tüm mesajları kapsar. Açık görüşmelere hiç dokunulmaz.',
  'settings.retention.visitLabel': 'Ziyaretçi verisi',
  'settings.retention.visitHint':
    "Widget'ın kaydettiği ziyaretler — IP adresi, tarayıcı ve sayfalar.",
  'settings.retention.inherit': 'Varsayılanı kullan ({days} gün)',
  'settings.retention.tier.30d': '30 gün',
  'settings.retention.tier.60d': '60 gün',
  'settings.retention.tier.365d': '365 gün',
  'settings.retention.tier.unlimited': 'Süresiz sakla',
  'settings.retention.effectiveDays': '{days} gün sonra siliniyor.',
  'settings.retention.effectiveUnlimited': 'Otomatik olarak hiç silinmiyor.',
  'settings.retention.hipaaNote':
    'Bu çalışma alanının imzalı bir HIPAA sözleşmesi var; veriler {days} günden uzun süre ve süresiz olarak saklanamaz.',
  'settings.retention.auditNote':
    'Denetim kaydının kendi 30 günlük penceresi vardır ve bu ayarlardan etkilenmez.',

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

  // Üye tanıma — MemberRecognition.tsx (ID-03 · tm 287.5)
  'settings.memberRecognition.title': 'Üye tanıma',
  'settings.memberRecognition.description':
    'Geri dönen bir ziyaretçinin web sitenizde nasıl tanındığı ve bir temsilciye aynı kişi olabilecek diğer kayıtlar hakkında ne gösterildiği.',
  'settings.memberRecognition.loadError': 'Üye tanıma ayarları yüklenemedi.',
  'settings.memberRecognition.ttlHeading': 'Bir ziyaretçi ne kadar süre hatırlanır',
  'settings.memberRecognition.ttlHint':
    'Ziyaretçi, son ziyaretinden sonra bu süre boyunca yeniden tanınır. Her ziyaret süreyi baştan başlatır; bu yüzden düzenli gelen biri hiç unutulmaz.',
  'settings.memberRecognition.amountLabel': 'Hatırlama süresi',
  'settings.memberRecognition.unitLabel': 'Birim',
  'settings.memberRecognition.unitDays': 'gün',
  'settings.memberRecognition.unitHours': 'saat',
  'settings.memberRecognition.ttlBounds': '{min} günden {max} güne kadar.',
  'settings.memberRecognition.ttlError': '1 günden 365 güne kadar bir tam sayı girin.',
  'settings.memberRecognition.matchesLabel': 'Temsilcilere olası eşleşmeleri göster',
  'settings.memberRecognition.matchesHint':
    'Aynı kullanıcı adını veya e-postayı yazan diğer müşteriler, bir müşterinin üzerinde doğrulanmamış öneri olarak listelenir. İki kaydı yalnızca bir temsilcinin onayı bağlar. Kapalıyken liste boştur.',
  'settings.memberRecognition.keyHeading': 'İmza anahtarı',
  'settings.memberRecognition.keyHint':
    'Sunucunun üye tokenlarını imzaladığı anahtar. Hiçbir zaman gösterilmez. Sızdığından şüphelendiğinizde ya da belli aralıklarla yenileyin.',
  'settings.memberRecognition.keyNone':
    'Henüz anahtar yok. Bir ziyaretçi ilk kez tanındığında ya da siz yenilediğinizde oluşturulur.',
  'settings.memberRecognition.keyVersion': 'Geçerli sürüm',
  'settings.memberRecognition.keyCreated': 'Oluşturuldu',
  'settings.memberRecognition.keyPrevious': 'Önceki anahtar',
  'settings.memberRecognition.keyPreviousUntil': '{version}. sürüm, {date} tarihine kadar geçerli',
  'settings.memberRecognition.graceLabel': 'Eski anahtar şu kadar tutulsun (gün)',
  'settings.memberRecognition.graceHint.one':
    'Eski anahtarın imzaladığı ziyaretçiler {count} gün daha tanınır ve yeni anahtarla yeniden imzalanır.',
  'settings.memberRecognition.graceHint.other':
    'Eski anahtarın imzaladığı ziyaretçiler {count} gün daha tanınır ve yeni anahtarla yeniden imzalanır.',
  'settings.memberRecognition.graceNone':
    '0, eski anahtarı hemen devre dışı bırakır: geri dönen her ziyaretçi yeni ziyaretçi olarak baştan başlar.',
  'settings.memberRecognition.graceError': '{min} ile {max} arasında bir tam sayı girin.',
  'settings.memberRecognition.rotateButton': 'Anahtarı yenile',
  'settings.memberRecognition.rotateConfirmTitle': 'İmza anahtarı yenilensin mi?',
  'settings.memberRecognition.rotateConfirmGrace.one':
    'Bundan sonra yeni bir anahtar imzalar. Eski anahtarın imzaladığı ziyaretçiler {count} gün daha tanınır.',
  'settings.memberRecognition.rotateConfirmGrace.other':
    'Bundan sonra yeni bir anahtar imzalar. Eski anahtarın imzaladığı ziyaretçiler {count} gün daha tanınır.',
  'settings.memberRecognition.rotateConfirmNone':
    'Eski anahtar hemen çalışmaz olur. Geri dönen her ziyaretçi yeni ziyaretçi olarak baştan başlar.',
  'settings.memberRecognition.rotateConfirm': 'Anahtarı yenile',
  'settings.memberRecognition.rotateFailure': 'Anahtar yenilenemedi.',
  'settings.memberRecognition.forgetHeading': 'Geri dönen bütün ziyaretçileri unut',
  'settings.memberRecognition.forgetHint':
    'Daha önce tanınan her tarayıcı yeni bir ziyaretçi olur. Hiçbir şey silinmez, kimse engellenmez; sohbetler ve müşteri kayıtları olduğu gibi kalır.',
  'settings.memberRecognition.forgetLast': 'Son işlem: {date}.',
  'settings.memberRecognition.forgetButton': 'Bütün ziyaretçileri unut',
  'settings.memberRecognition.forgetConfirmTitle': 'Geri dönen bütün ziyaretçiler unutulsun mu?',
  'settings.memberRecognition.forgetConfirmDescription':
    'Web sitenizin şimdiye kadar tanıdığı her ziyaretçi, bir sonraki ziyaretinde yeni ziyaretçi olarak baştan başlar. Bu geri alınamaz.',
  'settings.memberRecognition.forgetConfirm': 'Bütün ziyaretçileri unut',
  'settings.memberRecognition.forgetFailure': 'Ziyaretçiler unutulamadı.',

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
  'settings.pilot.unavailable': 'Bu özellik pilotta kapalı — {email} ile iletişime geçin.',
  'settings.pilot.unavailableNoContact': 'Bu özellik pilotta kapalı.',
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
  'settings.scheduledExports.editButton': 'Düzenle',
  'settings.scheduledExports.editAriaLabel': '{group} dışa aktarımını düzenle',
  'settings.scheduledExports.editModal.title': 'Zamanlanmış dışa aktarımı düzenle',
  'settings.scheduledExports.editModal.description':
    'Rapor grubunu, sıklığı veya alıcıları değiştirin.',
  'settings.scheduledExports.saving': 'Kaydediliyor…',

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

  // Hassas veri — SensitiveData.tsx (tm 300.2 · AI-26)
  'settings.sensitiveData.title': 'Hassas veri',
  'settings.sensitiveData.description':
    'Ziyaretçinin sohbete yazdığı gizli bilgiler mesaj gelir gelmez maskelenir — kaydedilmeden, loglanmadan ve yapay zekâya gösterilmeden önce. Bu kapatılamaz.',
  'settings.sensitiveData.tableCaption': 'Neyin, kimin mesajında maskelendiği',
  'settings.sensitiveData.col.type': 'Tür',
  'settings.sensitiveData.col.detected': 'Nasıl tanınır',
  'settings.sensitiveData.col.player': 'Ziyaretçi mesajları',
  'settings.sensitiveData.col.team': 'Ekip ve AI mesajları',
  'settings.sensitiveData.masked': 'Maskelenir',
  'settings.sensitiveData.shown': 'Tam gösterilir',
  'settings.sensitiveData.detected.card':
    'Luhn kontrolünden geçen kart numarası; son dört hane korunur',
  'settings.sensitiveData.detected.cvv': '"CVV", "CVC" ya da "güvenlik kodu" yanındaki 3–4 hane',
  'settings.sensitiveData.detected.otp':
    '"kod", "SMS", "OTP" ya da "doğrulama" yanındaki 4–8 hane — tek başına sayı, tutar ya da referans asla',
  'settings.sensitiveData.detected.password':
    '"şifrem", "parolam", "şifre:" ya da "pw" gibi bir sözcüğün ardındaki değer',
  'settings.sensitiveData.detected.iban':
    'Kontrol hanesi geçerli IBAN; ülke kodu ve son dört karakter korunur',
  'settings.sensitiveData.detected.seed_phrase':
    'Art arda 12 ya da daha fazla cüzdan kurtarma kelimesi',
  'settings.sensitiveData.detected.private_key':
    'Cüzdan özel anahtarı — tek başına 64 karakterlik işlem özeti (TXID) dokunulmadan kalır',
  'settings.sensitiveData.detected.banking_credential':
    'İnternet bankacılığı müşteri numarası ve şifresi birlikte',
  'settings.sensitiveData.note.everywhere':
    'Asıl değer hiçbir yerde tutulmaz: ne dökümde, ne loglarda, ne AI kayıtlarında, ne de döküm e-postasında.',
  'settings.sensitiveData.note.warning':
    'Ziyaretçiye her gizli bilgi türü için sohbet başına bir kez, kendi dilinde, değerin gizlendiği ve paylaşmaması gerektiği söylenir.',
  'settings.sensitiveData.note.iban':
    'Temsilcinin ziyaretçiye gönderdiği IBAN tam kalır; yatırım ona yapılabilsin diye. AI kendisi asla IBAN göndermez.',
  'settings.sensitiveData.note.ai':
    'Ziyaretçi bir şifre ya da kod paylaştığında AI’ya onu kimseyle paylaşmaması için uyarması söylenir — değeri hiç görmez.',
  'settings.sensitiveData.note.attachments':
    'Görseller ve dosyalar maskelenmez: bir dekontta kart numarası ya da IBAN görünebilir.',
  'settings.sensitiveData.note.badge':
    'Gelen kutusunda maskelenen mesajda neyin gizlendiğini söyleyen "Hassas veri gizlendi" etiketi görünür.',

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
  'settings.fileSharing.inboundSensitiveLabel':
    'Oyuncunun e-postayla gönderdiği her dosyayı hassas say',
  'settings.fileSharing.inboundSensitiveHint':
    'Kapalıyken yalnız adı ya da konusu kimlik belgesi geçen dosya (kimlik, pasaport, ehliyet, KYC) hassas sayılır. Hassas dosyayı yalnız yetkili roller açar; her açılış denetim kaydına yazılır.',

  // Kötüye kullanım koruması — AbuseProtection.tsx, PerMemberQuota.tsx (GV-01)
  'settings.abuse.title': 'Kötüye kullanım koruması',
  'settings.abuse.description':
    'Sohbet widget’ının, betiklerin ya da tek bir yoğun ziyaretçinin yapay zekâ kotanızı tüketmesini ve gelen kutunuzu doldurmasını nasıl engellediği.',
  'settings.abuse.loadError': 'Kötüye kullanım koruması ayarları yüklenemedi.',
  'settings.abuse.allowanceLabel': 'Ziyaretçi başına günlük yapay zekâ yanıtı',
  'settings.abuse.allowanceHint':
    'Bir günde bu kadar yapay zekâ yanıtından sonra ziyaretçinin sonraki mesajı, temsilcileriniz için bir notla birlikte bir kişiye gider. 0 sınırı kapatır. Varsayılan 40’tır.',
  'settings.abuse.allowanceError': '0 ile 10.000 arasında bir tam sayı girin.',
  'settings.abuse.modeLegend': 'Sohbet widget’ında insan doğrulaması',
  'settings.abuse.modeIntro':
    'Doğrulamayı geçen ziyaretçiye 12 saat boyunca yeniden sorulmaz; widget’ın zaten tanıdığı geri dönen ziyaretçiye hiç sorulmaz.',
  'settings.abuse.mode.off': 'Hiç sorma',
  'settings.abuse.mode.offHint': 'Ziyaretçilerden insan olduklarını kanıtlamaları hiç istenmez.',
  'settings.abuse.mode.risk': 'Yalnız bir şey ters görününce',
  'settings.abuse.mode.riskHint':
    'Aynı adresten çok sayıda yeni ziyaretçi, ani bir mesaj yağmuru ya da yoğun yapay zekâ kullanımı. Önerilir.',
  'settings.abuse.mode.always': 'Her yeni sohbetten önce',
  'settings.abuse.mode.alwaysHint':
    'Son 12 saatte doğrulamayı geçmemiş her ziyaretçiye ilk mesajından önce sorulur.',
  'settings.abuse.privacyNote':
    'Bu kurulum Cloudflare Turnstile kullanıyorsa doğrulama Cloudflare’in sunucularında çalışır. Gizlilik bildiriminizde buna yer verin.',
  'settings.perMemberQuota.title': 'Bugünkü yapay zekâ kotası',
  'settings.perMemberQuota.limit': 'Ziyaretçi başına kota',
  'settings.perMemberQuota.perDay': 'Günde {cap}',
  'settings.perMemberQuota.noLimit': 'Sınır yok',
  'settings.perMemberQuota.withAi': 'Yapay zekânın yanıtladığı ziyaretçi',
  'settings.perMemberQuota.atCap': 'Kotaya ulaşan',
  'settings.perMemberQuota.hint':
    'Çalışma alanınızın gününe göre sayılır (Sohbet zaman aşımı altında ayarlanır). Kotaya ulaşan ziyaretçi artık bir kişiyle görüşüyor.',

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
  'settings.skills.deleteConfirmTitle': 'Yetenek {name} silinsin mi?',
  'settings.skills.deleteConfirmDescription':
    'Yetenek hesaptaki herkes için silinir. Bu işlem geri alınamaz.',

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
  'settings.routing.deleteConfirmTitle': 'Kural {name} silinsin mi?',
  'settings.routing.deleteConfirmDescription':
    'Yeni sohbetler artık bu kurala göre yönlendirilmez. Bu işlem geri alınamaz.',
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
  'settings.ticketRules.deleteConfirmTitle': 'Kural {name} silinsin mi?',
  'settings.ticketRules.deleteConfirmDescription':
    'Yeni biletler artık bu kural tarafından işlenmez. Bu işlem geri alınamaz.',
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
  'settings.pat.form.nameInvalid': 'En fazla 120 karakterlik bir ad kullanın.',
  'settings.pat.reason.scopes_required': 'En az bir kapsam seçin.',
  'settings.pat.reason.scopes_not_held':
    'Kendi oturumunuzun sahip olmadığı kapsamları veremezsiniz: {scopes}.',
  'settings.pat.reason.scopes_not_delegable':
    'Bu kapsamlar rolünüzden değil, çalışma alanının izinlerinden geliyor; jetona eklenemez: {scopes}.',
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

  // Alanların içinde görünen örnek değerler (tm 259.18). Yalnız sözcüklerden
  // oluşanlar burada; adres, CIDR aralığı, sertifika ve saat her dilde aynı
  // okunduğu için işaretlemede sabit kalır.
  'settings.brands.namePlaceholder': 'Acme Destek',
  'settings.cannedResponses.shortcutPlaceholder': 'kargo',
  'settings.cannedResponses.messagePlaceholder': 'Standart teslimat 3-5 iş günü sürer.',
  'settings.chatForms.labelPlaceholder': 'Sipariş numarası',
  'settings.customFields.namePlaceholder': 'Oyuncu kimliği',
  'settings.ipAllowlist.labelPlaceholder': 'Ofis VPN’i',
  'settings.skills.namePlaceholder': 'Faturalama',
  'settings.sso.scimNamePlaceholder': 'Okta (kurumsal) kullanıcı sağlama',
  'settings.ticketEmailTemplates.namePlaceholder': 'Talep alındı',
  'settings.ticketEmailTemplates.subjectPlaceholder': '{{ticket.id}} numaralı talebinizi aldık',
  'settings.ticketEmailTemplates.bodyPlaceholder':
    'Merhaba {{customer.name}}, bize ulaştığınız için teşekkürler.',
  'settings.ticketRules.namePlaceholder': 'İadeler',
  'settings.ticketRules.subjectPlaceholder': 'iade',

  // Yapay zekâ kullanımı — AiUsage.tsx (tm 283.4)
  'settings.aiUsage.title': 'Yapay zekâ kullanımı',
  'settings.aiUsage.description':
    'Çalışma alanının günlük yapay zekâ kotasının ne kadarının harcandığı, hangi özelliğin harcadığı ve kota azalınca kimin uyarıldığı. Yalnızca sayılar — görüşme metni yok.',
  'settings.aiUsage.loadError': 'Yapay zekâ kullanımı yüklenemedi.',
  'settings.aiUsage.utcNote':
    'Bugün UTC’ye göre {day}. Kota, çalışma alanının saat diliminden bağımsız olarak {resets} (00:00 UTC) anında yenilenir.',
  'settings.aiUsage.meter.llm': 'Dil modeli token’ları',
  'settings.aiUsage.meter.embedding': 'Gömme (embedding) token’ları',
  'settings.aiUsage.meter.llm_test': 'Dil modeli token’ları (testler)',
  'settings.aiUsage.meter.embedding_test': 'Gömme token’ları (testler)',
  'settings.aiUsage.testHeading': 'Simülasyonlar ve testler (kendi, daha küçük kotaları)',
  'settings.aiUsage.usedOfCap': 'Bugün {cap} içinden {used} ({percent})',
  'settings.aiUsage.percentOfCap': 'Günlük kotanın {percent} kadarı',
  'settings.aiUsage.reserved': 'Sürmekte olan istekler {count} token daha tutuyor.',
  'settings.aiUsage.costToday': 'Bugünün tahmini maliyeti',
  'settings.aiUsage.costEstimateHint': 'Tahmindir — faturayla birebir tutmaz.',
  'settings.aiUsage.priceLlm':
    'dil modeli: milyon girdi token’ı başına {input}, milyon çıktı token’ı başına {output}',
  'settings.aiUsage.priceEmbedding': 'gömme: milyon token başına {price}',
  'settings.aiUsage.pricingNote':
    'Bu kurulum için ayarlanan fiyatlarla tahmin edilmiştir: {prices}. Sağlayıcı indirimleri ve sonraki fiyat değişiklikleri yansımaz.',
  'settings.aiUsage.chartHeading': 'Son {days} gün (UTC)',
  'settings.aiUsage.chartTotal': 'Toplam {total} token',
  'settings.aiUsage.chartTableCaption': 'UTC günü başına {meter}',
  'settings.aiUsage.col.day': 'Gün (UTC)',
  'settings.aiUsage.col.surface': 'Özellik',
  'settings.aiUsage.col.meter': 'Sayaç',
  'settings.aiUsage.col.input': 'Girdi token’ları',
  'settings.aiUsage.col.output': 'Çıktı token’ları',
  'settings.aiUsage.col.cost': 'Tahmini maliyet',
  'settings.aiUsage.surfaceHeading': 'Token’lar nereye gitti, son {days} gün',
  'settings.aiUsage.surfaceEmpty': 'Bu dönemde kayıtlı yapay zekâ kullanımı yok.',
  'settings.aiUsage.surface.ai_agent': 'Yapay zekâ temsilcisi',
  'settings.aiUsage.surface.copilot': 'Yardımcı pilot',
  'settings.aiUsage.surface.knowledge_index': 'Bilgi indeksleme',
  'settings.aiUsage.surface.simulation': 'Simülasyonlar',
  'settings.aiUsage.surface.qa': 'Görüşme incelemesi',
  'settings.aiUsage.surface.cluster': 'Cevapsız soruları gruplama',
  'settings.aiUsage.surface.coaching': 'Ajan önerilerini taslağa çevirme',
  'settings.aiUsage.alertsHeading': 'Bugünkü uyarılar',
  'settings.aiUsage.alertsNote':
    'Her sayaç için günde bir kez %80’de, bir kez %100’de uyarılırsınız. Uyarıları her zaman sahip alır.',
  'settings.aiUsage.alertsNone': 'Bugün hiç uyarı gönderilmedi.',
  'settings.aiUsage.alertRow': '{meter} için {threshold} — {time} tarihinde gönderildi',
  'settings.aiUsage.recipientsLegend': 'Ayrıca uyarılacaklar',
  'settings.aiUsage.recipientsNoteOwner':
    'Sizin dışınızda hangi yönetici yardımcılarının ve yöneticilerin uyarılacağını seçin.',
  'settings.aiUsage.recipientsNoteOther':
    'Kimin uyarılacağını yalnızca çalışma alanının sahibi değiştirebilir.',
  'settings.aiUsage.recipientsNone': 'Seçilebilecek başka yönetici yok.',
  'settings.aiUsage.recipientsSaved': 'Kaydedildi.',
  'settings.aiUsage.capNote':
    'Günlük kota SiyahTuş ekibi tarafından belirlenir ve buradan değiştirilemez. Artırmak için bizimle iletişime geçin.',
  // Risk bayrakları (AI-27 · tm 302.3) — RiskFlagSettings.tsx
  'settings.nav.section.riskFlags': 'Risk bayrakları',
  'settings.riskFlags.title': 'Risk bayrakları',
  'settings.riskFlags.description':
    'Sorumlu oyunu kimin yürüttüğü ve acil bir bayrak konduğu anda kimin haberdar edildiği. Bayrak, riskli bir oyuncuyu promosyonlardan ve bonus konuşmasından, AI’ı da bir kişide kalması gereken görüşmeden uzak tutar.',
  'settings.riskFlags.loadError': 'Risk bayrağı ayarları yüklenemedi.',
  'settings.riskFlags.teamLabel': 'Sorumlu Oyun ekibi',
  'settings.riskFlags.teamNone': 'Ekip seçilmedi',
  'settings.riskFlags.teamUnknown': 'Ekip #{id} (artık yok)',
  'settings.riskFlags.teamHint':
    'Bu ekibin üyeleri bayraklardaki notları okur ve her acil bayraktan haberdar edilir. Bayraklı bir görüşme devredilirken onlara gider.',
  'settings.riskFlags.emailsLabel': 'Acil bayrakları ayrıca şu adreslere e-postayla bildir',
  'settings.riskFlags.emailsHint':
    'En fazla {max} adres, virgülle ayrılmış. Çalışma alanı sahipleri ve yöneticiler her zaman haberdar edilir. E-posta bayrağın konduğunu söyler, oyuncunun ne yazdığını asla.',
  'settings.riskFlags.emailsTooMany': 'En fazla {max} adres girilebilir.',
  'settings.riskFlags.emailsInvalid': '“{address}” geçerli bir e-posta adresi değil.',
  'settings.riskFlags.saved': 'Kaydedildi.',
  'settings.riskFlags.legend.title': 'Bayrak türleri',
  'settings.riskFlags.legend.description':
    'Bunları platform belirler. Bir görüşmeyi görebilen herkes bayraklarını görür; yalnızca notlar kısıtlıdır.',
  'settings.riskFlags.legend.type': 'Bayrak',
  'settings.riskFlags.legend.severity': 'Önem',
  'settings.riskFlags.legend.clearedBy': 'Kaldırabilen',
  'settings.riskFlags.legend.effect': 'Ne yapar',
  'settings.riskFlags.legend.andUp': '{role} ve üstü',

  // Roller ve izinler — PermissionsMatrix.tsx (RL-02 · tm 325.4)
  'settings.permissions.title': 'Roller ve izinler',
  'settings.riskFlags.promo.title': 'Bayraklı oyuncuya kampanya',
  'settings.riskFlags.promo.description':
    'Bu bayraklardan biri olan oyuncuya kampanya gösterilmez. Sorumlu oyun bayrakları her zaman engeller; diğer ikisi sizin seçiminiz.',
  'settings.riskFlags.promo.locked': 'Her zaman — platform belirler',
  'settings.riskFlags.promo.permanent':
    'Oyuncudan alıkonan bir kampanya, bayrak kaldırılsa da ona sonradan gösterilmez.',
  'settings.riskFlags.promo.save': 'Kampanya kurallarını kaydet',
  'settings.riskFlags.promo.blocks': 'Kampanyayı engeller',
  'settings.riskFlags.promo.doesNotBlock': 'Kampanyayı engellemez',
  'settings.permissions.description':
    'Bu çalışma alanında kimin neyi yapabileceği, role göre. Yalnız Kurucu değiştirir; her değişiklik gerekçesiyle denetim kaydına yazılır ve Yöneticilere e-postayla bildirilir.',
  'settings.permissions.loadError': 'İzin matrisi yüklenemedi.',
  'settings.permissions.ownerOnly':
    'Salt okunur: kimin neyi yapabileceğini yalnız Kurucu değiştirir. Değişiklik için Kurucu’ya başvurun.',
  'settings.permissions.howItWorks':
    'Değişiklikler oturumu açık ekip arkadaşlarına bir dakika içinde, yeniden giriş yapmadan ulaşır.',
  'settings.permissions.resetAll': 'Tümünü varsayılana döndür',
  'settings.permissions.tableCaption': 'Role göre izinler',
  'settings.permissions.col.capability': 'İzin',
  'settings.permissions.cellName': '{capability} — {role}',
  'settings.permissions.customised': 'Değiştirildi',
  'settings.permissions.resetCell': '{name}: varsayılana döndür ({value})',
  'settings.permissions.resetCellShort': 'Varsayılana döndür ({value})',
  'settings.permissions.lockedBecause': 'kilitli: {reason}',

  // Profilim — MyProfile.tsx (RL-06 · tm 327)
  'settings.profile.title': 'Profilim',
  'settings.profile.description':
    'Paneldeki adınız, oyuncuların gördüğü ad ve şifreniz. Hesabınıza aittirler; üyesi olduğunuz her çalışma alanında geçerlidirler.',
  'settings.profile.email': 'Oturum: {email}',
  'settings.profile.name.label': 'Ad',
  'settings.profile.name.hint':
    'Ekibinizin sizi gördüğü ad: ekip listesi, gelen kutusu ve denetim kaydı.',
  'settings.profile.name.required': 'Adınızı girin.',
  'settings.profile.publicName.label': 'Oyuncuların gördüğü ad (isteğe bağlı)',
  'settings.profile.publicName.hint':
    'Sohbet penceresinde oyunculara adınızın yerine bu gösterilir. Boş bırakırsanız adınız gösterilir.',
  'settings.profile.tooLong': 'En fazla {max} karakter kullanın.',
  'settings.profile.saved': 'Profil kaydedildi.',
  'settings.profile.password.title': 'Şifre',
  'settings.profile.password.description':
    'Şifrenizi şu anki şifrenizle değiştirin. E-posta gerekmez.',
  'settings.profile.password.otherSessions':
    'Değiştirdiğinizde hesabınızda oturumu açık diğer bütün cihazların oturumu kapanır. Bu cihaz açık kalır.',
  'settings.profile.password.current': 'Mevcut şifre',
  'settings.profile.password.next': 'Yeni şifre',
  'settings.profile.password.confirm': 'Yeni şifre (tekrar)',
  'settings.profile.password.currentRequired': 'Mevcut şifrenizi girin.',
  'settings.profile.password.length': '{min}–{max} karakter kullanın.',
  'settings.profile.password.same': 'Mevcut şifrenizden farklı bir şifre seçin.',
  'settings.profile.password.mismatch': 'Yeni şifreler birbirini tutmuyor.',
  'settings.profile.password.wrongCurrent': 'Mevcut şifreniz bu değil.',
  'settings.profile.password.ssoEnforced':
    'Bu çalışma alanında kimlik sağlayıcınızla giriş yapıyorsunuz. Şifrenizi orada değiştirin.',
  'settings.profile.password.noPassword':
    'Hesabınız kimlik sağlayıcıyla giriş yapıyor; değiştirilecek bir şifresi yok.',
  'settings.profile.password.submit': 'Şifreyi değiştir',
  'settings.profile.password.submitting': 'Değiştiriliyor…',
  'settings.profile.password.changed':
    'Şifre değiştirildi. Diğer cihazlarınızın oturumu kapatıldı.',

  // Yetkilerim — MyPermissions.tsx (RL-02 · tm 325.4)
  'settings.myPermissions.title': 'Yetkilerim',
  'settings.myPermissions.description':
    'Bu çalışma alanında şu an neleri yapabileceğiniz — rolünüzden ve çalışma alanının izin matrisinden.',
  'settings.myPermissions.loadError': 'Yetkileriniz yüklenemedi.',
  'settings.myPermissions.role': 'Rolünüz: {role}',
  'settings.myPermissions.note':
    'Bunları yalnız Kurucu değiştirebilir. Bir değişiklik size bir dakika içinde, yeniden giriş yapmadan ulaşır.',

  // İzin matrisinin kataloğu (`@siyahtus/types` CAPABILITIES `labelKey`) —
  // matris ve Yetkilerim ortak kullanır.
  'permissions.group.chats': 'Sohbetler',
  'permissions.group.customers': 'Oyuncu verisi',
  'permissions.group.ai': 'AI',
  'permissions.group.reports': 'Raporlar',
  'permissions.group.team': 'Ekip',
  'permissions.group.settings': 'Ayarlar',
  'permissions.group.billing': 'Faturalama',
  'permissions.group.logs': 'Kayıtlar',
  'permissions.capability.chats.view': 'Sohbetleri görme',
  'permissions.capability.chats.takeover': 'Sohbeti devralma',
  'permissions.capability.timeline.view': 'Sohbetin zaman çizelgesini görme',
  'permissions.capability.tickets.view': 'Talepleri görme',
  'permissions.capability.customers.contact.view': 'Oyuncunun e-postasını ve kullanıcı adını görme',
  'permissions.capability.customers.edit': 'Oyuncu kayıtlarını düzenleme',
  'permissions.capability.customers.ban': 'Oyuncu engelleme',
  'permissions.capability.customers.erase': 'Oyuncu verisini silme',
  'permissions.capability.customers.documents.view':
    'Oyuncunun e-postayla gönderdiği hassas belgeleri açma (kimlik, pasaport, KYC)',
  'permissions.capability.ai.manage': 'AI Agent’ı yapılandırma',
  'permissions.capability.ai.guardrails.edit': 'AI uyum kurallarını düzenleme',
  'permissions.capability.ai.config.publish': 'AI ayarlarını onaylama ve yayımlama',
  'permissions.capability.ai.suggest': "AI'a düzeltme önerme",
  'permissions.capability.ai.suggestions.review': 'AI önerilerini inceleme',
  'permissions.capability.ai.qa.review': 'AI kalite incelemesi',
  'permissions.capability.reports.view': 'Raporları görme',
  'permissions.capability.reports.schedule': 'Rapor e-postalarını zamanlama',
  'permissions.capability.team.invite': 'Ekip arkadaşı davet etme',
  'permissions.capability.team.members.manage': 'Üyelerin rolünü yönetme',
  'permissions.capability.team.groups.manage': 'Ekipleri yönetme',
  'permissions.capability.settings.security': 'Güvenlik ayarları',
  'permissions.capability.settings.company': 'Şirket ve görünüm',
  'permissions.capability.settings.brands': 'Markalar',
  'permissions.capability.settings.channels': 'Kanallar',
  'permissions.capability.settings.webhooks': 'Webhook’lar',
  'permissions.capability.settings.tags': 'Etiketler',
  'permissions.capability.settings.canned_responses': 'Kayıtlı yanıtlar',
  'permissions.capability.settings.sso': 'Tek oturum açma (SSO)',
  'permissions.capability.settings.permissions': 'İzinleri değiştirme',
  'permissions.capability.billing.manage': 'Faturalamayı yönetme',
  'permissions.capability.logs.audit.view': 'Denetim kaydını görme',
  'permissions.capability.logs.audit.export': 'Denetim kaydını aktarma (SIEM)',
  'permissions.capability.timeline.export': 'Zaman çizelgesini dışa aktarma (maskeli)',
  'permissions.capability.timeline.export_unmasked': 'Zaman çizelgesini maskesiz dışa aktarma',
  'permissions.value.off': 'Kapalı',
  'permissions.value.on': 'Açık',
  'permissions.value.none': 'Yok',
  'permissions.value.own': 'Kendi',
  'permissions.value.team': 'Ekip',
  'permissions.value.all': 'Tümü',
  'permissions.lock.owner_column':
    'Kurucu her izni her zaman tutar — matrisi değiştiren kişi kendi erişimini kapatamaz.',
  'permissions.lock.owner_only': 'Yalnız Kurucu: bu izin Kurucu’da kalır.',
  'permissions.lock.below_floor': 'Platform güvenliği: bu role bu izin verilemez.',

  // Ayarlar › AI kalite (AI-24 · tm 319.3): örneklem, ön puan, çıkar çatışması, rubrik.
  'settings.aiQuality.title': 'AI kalite',
  'settings.aiQuality.description':
    'QA kuyruğunun her gece nasıl dolduğu ve bir incelemenin neyi puanladığı. Ekip Liderleri ve yöneticiler Raporlar › AI kalite altında inceler.',
  'settings.aiQuality.loadError': 'AI kalite ayarları yüklenemedi.',
  'settings.aiQuality.samplingTitle': 'Örneklem',
  'settings.aiQuality.samplePercent': 'Rastgele örneklem (%)',
  'settings.aiQuality.samplePercentHint':
    'AI’ın kapanan konuşmalarından her gün kuyruğa düşen pay, %{min}–{max}. Risk bayrakları, uyum koruması işaretleri, zorunlu devirler ve diğer zorunlu kategoriler her zaman kuyruğa girer.',
  'settings.aiQuality.samplePercentError': '{min} ile {max} arasında bir tam sayı.',
  'settings.aiQuality.prescore': 'Kuyruktaki konuşmaları model ön puanlasın',
  'settings.aiQuality.prescoreHint':
    'Maskeli metinden, her kriterin yanında bir öneri. Hiçbir şeyi onaylamaz; kararı inceleyici verir.',
  'settings.aiQuality.conflictCheck': 'İnceleyici, yer aldığı konuşmayı inceleyemez',
  'settings.aiQuality.conflictCheckHint':
    'Konuşmaya yazan ya da devrini kabul eden kişi o incelemeyi üstlenemez.',
  'settings.aiQuality.rubric.title': 'Rubrik',
  'settings.aiQuality.rubric.loadError': 'Rubrik yüklenemedi.',
  'settings.aiQuality.rubric.version': 'Sürüm {version} · {at}',
  'settings.aiQuality.rubric.hint':
    'Kaydetmek yeni bir sürüm yazar; kuyruktaki incelemeler kendi sürümlerinde kalır. Kilitli kriterler platformundur: kritik kalırlar, yalnız ağırlıkları sizindir.',
  'settings.aiQuality.rubric.criterion': 'Kriter',
  'settings.aiQuality.rubric.type': 'Tür',
  'settings.aiQuality.rubric.weight': 'Ağırlık',
  'settings.aiQuality.rubric.critical': 'Kritik',
  'settings.aiQuality.rubric.actions': 'İşlemler',
  'settings.aiQuality.rubric.locked': 'Kilitli',
  'settings.aiQuality.rubric.labelFor': '{n}. kriterin adı',
  'settings.aiQuality.rubric.typeFor': '“{criterion}” türü',
  'settings.aiQuality.rubric.weightFor': '“{criterion}” ağırlığı',
  'settings.aiQuality.rubric.criticalFor': '“{criterion}” kritik',
  'settings.aiQuality.rubric.removeFor': '“{criterion}” kriterini kaldır',
  'settings.aiQuality.rubric.passFail': 'Geçti / kaldı',
  'settings.aiQuality.rubric.oneToFive': '1–5',
  'settings.aiQuality.rubric.remove': 'Kaldır',
  'settings.aiQuality.rubric.add': 'Kriter ekle',
  'settings.aiQuality.rubric.discard': 'Vazgeç',
  'settings.aiQuality.rubric.save': 'Yeni sürüm olarak kaydet',
  'settings.aiQuality.rubric.saved': 'Yeni rubrik sürümü kaydedildi.',
  'settings.aiQuality.rubric.invalid':
    'Her kriterin bir adı (en çok 80 karakter) olmalı, her ad bir kez geçmeli, ağırlık 1 ile 10 arasında olmalı.',
};
