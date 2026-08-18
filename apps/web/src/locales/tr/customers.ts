import type { Messages } from '../merge.js';

/** Müşteriler, trafik, kampanyalar ve hedefler. See the English file. */
export const customers: Messages = {
  // Shared chrome — CustomersTabs.tsx, and the page title all four screens set
  'customers.tabs.ariaLabel': 'Müşteri görünümleri',
  'customers.tabs.contacts': 'Kişiler',
  'customers.tabs.realTime': 'Gerçek zamanlı',
  'customers.tabs.campaigns': 'Kampanyalar',
  'customers.tabs.goals': 'Hedefler',
  'customers.page.title': 'Müşteriler',

  // Contacts — CustomersPage.tsx
  'customers.page.subtitle': 'Bu çalışma alanıyla iletişime geçen kişiler.',
  'customers.page.count.one': '{formatted} kişi',
  'customers.page.count.other': '{formatted} kişi',
  'customers.page.searchLabel': 'Müşteri ara',
  'customers.page.searchPlaceholder': 'Ad, e-posta veya telefon…',
  'customers.page.segmentsAriaLabel': 'Müşteri segmentleri',
  'customers.page.segment.all': 'Tümü',
  'customers.page.segment.leads': 'Adaylar',
  'customers.page.segment.recent': 'Son 30 gün',
  'customers.page.segment.banned': 'Engellenenler',
  'customers.page.loadError':
    'Müşteriler yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'customers.page.empty.searchTitle': 'Bu aramaya uyan kimse yok',
  'customers.page.empty.searchDescription':
    'Daha kısa bir arama deneyin veya farklı bir segment seçin.',
  'customers.page.empty.title': 'Henüz müşteri yok',
  'customers.page.empty.description':
    'Widget üzerinden mesaj gönderen kişiler otomatik olarak burada görünür.',
  'customers.page.table.caption': 'Müşteriler',
  'customers.page.table.name': 'Ad',
  'customers.page.table.country': 'Ülke',
  'customers.page.table.chats': 'Sohbetler',
  'customers.page.table.lastActive': 'Son aktif',
  'customers.page.unnamedVisitor': 'İsimsiz ziyaretçi',
  'customers.page.lead': 'aday',
  'customers.page.banned': 'Engellendi',
  'customers.page.noContactDetails': 'İletişim bilgisi yok',
  'customers.page.never': 'Hiç',

  // Customer detail panel — CustomerDetailPanel.tsx
  'customers.detail.emptySelection': 'Geçmişini görmek için birini seçin.',
  'customers.detail.loadError': 'Bu müşteri yüklenemedi.',
  'customers.detail.unnamedVisitor': 'İsimsiz ziyaretçi',
  'customers.detail.firstSeen': 'İlk görülme {date}',
  'customers.detail.bannedAt': 'Engellendi {date}',
  'customers.detail.conversations': 'Sohbetler',
  'customers.detail.tickets': 'Talepler',
  'customers.detail.visits': 'Ziyaretler',
  'customers.detail.returningVisitor': 'Geri dönen ziyaretçi',
  'customers.detail.country': 'Ülke',
  'customers.detail.lastActive': 'Son aktif',
  'customers.detail.never': 'Hiç',
  'customers.detail.liftBan': 'Engeli kaldır',
  'customers.detail.banCustomer': 'Müşteriyi engelle',
  'customers.detail.bannedHint': 'Yeniden sohbet başlatabilecekler.',
  'customers.detail.notBannedHint': 'Yeni sohbetleri engeller. Geçmiş saklanır.',
  'customers.detail.customFieldsHeading': 'Özel alanlar',
  'customers.detail.visitedPages': 'Ziyaret edilen sayfalar',
  'customers.detail.noVisits':
    'Kayıtlı ziyaret yok. Sayfalar, biri widget üzerinden mesaj gönderdiğinde kaydedilir.',
  'customers.detail.cameFrom': 'Geldiği yer: {source}',
  'customers.detail.unknownPage': 'Bilinmeyen sayfa',
  'customers.detail.noConversations': 'Henüz sohbet yok.',
  'customers.detail.chatOpen': 'Açık',
  'customers.detail.chatClosed': 'Kapalı',
  'customers.detail.groups': 'Ekipler',
  'customers.detail.noGroups':
    'Henüz bir ekibe yönlendirilmedi. Sohbetlerinden biri atandığında ekipler burada görünür.',
  'customers.detail.field.name': 'Ad',
  'customers.detail.field.email': 'E-posta',
  'customers.detail.field.phone': 'Telefon',
  'customers.detail.saving': 'Kaydediliyor…',
  'customers.detail.saveChanges': 'Değişiklikleri kaydet',

  // Shared custom-fields control — CustomFields.tsx (also used by Inbox and Settings)
  'customFields.booleanYes': 'Evet',
  'customFields.booleanNo': 'Hayır',
  'customFields.saving': 'Kaydediliyor…',
  'customFields.save': 'Alanları kaydet',

  // Real-time board — TrafficPage.tsx
  'traffic.page.subtitle': 'Şu anda sitenizde olan kişiler.',
  'traffic.page.count.one': '{formatted} ziyaretçi şu anda sitenizde',
  'traffic.page.count.other': '{formatted} ziyaretçi şu anda sitenizde',
  'traffic.page.loadError':
    'Canlı trafik yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'traffic.page.statusTablistAriaLabel': 'Trafik durumu',
  'traffic.page.table.caption': 'Canlı ziyaretçiler',
  'traffic.page.table.visitor': 'Ziyaretçi',
  'traffic.page.table.activity': 'Etkinlik',
  'traffic.page.table.chattingWith': 'Sohbet ettiği kişi',
  'traffic.page.table.actions': 'Eylemler',
  'traffic.page.unnamedVisitor': 'İsimsiz ziyaretçi',
  'traffic.page.noContactDetails': 'İletişim bilgisi yok',
  'traffic.page.respondentAi': 'AI',
  'traffic.page.respondentAgent': 'Temsilci',

  'traffic.tab.all': 'Tümü',
  'traffic.tab.chatting': 'Sohbet ediyor',
  'traffic.tab.supervised': 'Gözetleniyor',
  'traffic.tab.queued': 'Sırada',
  'traffic.tab.waiting': 'Yanıt bekliyor',
  'traffic.tab.invited': 'Davet edildi',
  'traffic.tab.browsing': 'Geziniyor',

  'traffic.activity.browsing': 'Geziniyor',
  'traffic.activity.queued': 'Sırada',
  'traffic.activity.waiting': 'Yanıt bekliyor',
  'traffic.activity.chatting': 'Sohbet ediyor',
  'traffic.activity.supervised': 'Gözetleniyor',
  'traffic.activity.invited': 'Davet edildi',

  'traffic.empty.all.title': 'Şu anda canlı ziyaretçi yok',
  'traffic.empty.all.description':
    'Sitenizde gezinen veya canlı bir sohbette olan kişiler burada görünür. Trafiği görmeye başlamak için widget’ı kurun.',
  'traffic.empty.chatting.title': 'Şu anda kimse sohbet etmiyor',
  'traffic.empty.chatting.description':
    'Şu anda bir temsilci veya AI tarafından yanıtlanan ziyaretçiler burada görünür.',
  'traffic.empty.supervised.title': 'Gözetlenen sohbet yok',
  'traffic.empty.supervised.description':
    'Bir temsilcinin henüz yanıtlamadan izlediği sohbetler burada görünür.',
  'traffic.empty.queued.title': 'Sıra boş',
  'traffic.empty.queued.description':
    'Bir temsilcinin devralmasını bekleyen ziyaretçiler burada görünür.',
  'traffic.empty.waiting.title': 'Yanıt bekleyen kimse yok',
  'traffic.empty.waiting.description':
    'Ziyaretçinin son mesajının henüz yanıtlanmadığı sohbetler burada görünür.',
  'traffic.empty.invited.title': 'Bekleyen davet yok',
  'traffic.empty.invited.description':
    'Sohbete proaktif olarak davet edilen ama henüz yanıt vermeyen ziyaretçiler burada görünür.',
  'traffic.empty.browsing.title': 'Sadece gezinen kimse yok',
  'traffic.empty.browsing.description':
    'Sitenizde henüz sohbeti olmayan ziyaretçiler burada görünür.',

  'traffic.action.startChat': 'Sohbet başlat',
  'traffic.action.superviseChat': 'Sohbeti gözetle',
  'traffic.action.assignToMe': 'Sohbeti bana ata',
  'traffic.action.editContact': 'Kişiyi düzenle',

  // Traffic filter panel — TrafficFilters.tsx (field labels/options/errors stay
  // in traffic-filters.ts, English-only — see the file's own note)
  'traffic.filters.heading': 'Tüm filtrelerle eşleştir',
  'traffic.filters.clear': 'Temizle',
  'traffic.filters.addFilter': 'Filtre ekle',
  'traffic.filters.addFilterTrigger': '+ Filtre ekle',
  'traffic.filters.allApplied': 'Tüm filtreler zaten uygulanmış.',
  'traffic.filters.empty': 'Uygulanan filtre yok — her ziyaretçi gösteriliyor.',
  'traffic.filters.removeField': '{label} filtresini kaldır',

  // Campaigns — CampaignsPage.tsx
  'campaigns.page.description': 'Ziyaretçilere proaktif, hedefli mesajlarla ulaşın.',
  'campaigns.page.statusAriaLabel': 'Kampanya durumu',
  'campaigns.page.new': 'Yeni kampanya',
  'campaigns.page.loadError':
    'Kampanyalar yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'campaigns.page.empty.allTitle': 'Henüz kampanya yok',
  'campaigns.page.empty.filteredTitle': '{status} kampanya yok',
  'campaigns.page.empty.writeDescription':
    'Eşleşen bir sayfadaki ziyaretçileri hedefli bir mesajla karşılamak için bir kampanya oluşturun.',
  'campaigns.page.empty.readDescription':
    'Kampanyalar, eşleşen bir sayfadaki ziyaretçileri hedefli bir mesajla karşılar.',
  'campaigns.page.notice.reached.one': '“{name}” {formatted} ziyaretçiye ulaştı.',
  'campaigns.page.notice.reached.other': '“{name}” {formatted} ziyaretçiye ulaştı.',
  'campaigns.page.whenUrlContains': 'URL şunu içerdiğinde',
  'campaigns.page.fromDate': '{date} tarihinden itibaren',
  'campaigns.page.fromNow': 'Şimdiden itibaren',
  'campaigns.page.untilDate': ' {date} tarihine kadar',
  'campaigns.page.edit': 'Düzenle',
  'campaigns.page.turnOff': 'Kapat',
  'campaigns.page.turnOn': 'Aç',
  'campaigns.page.stat.displayed': 'Gösterildi',
  'campaigns.page.stat.chats': 'Sohbetler',
  'campaigns.page.stat.conversion': 'Dönüşüm',

  'campaigns.status.ongoing': 'Devam eden',
  'campaigns.status.scheduled': 'Zamanlanmış',
  'campaigns.status.inactive': 'Pasif',
  'campaigns.tab.all': 'Tümü',
  'campaigns.tab.ongoing': 'Devam eden',
  'campaigns.tab.scheduled': 'Zamanlanmış',
  'campaigns.tab.inactive': 'Pasif',

  // Campaign builder — CampaignBuilder.tsx
  'campaigns.builder.editTitle': 'Kampanyayı düzenle',
  'campaigns.builder.newTitle': 'Yeni kampanya',
  'campaigns.builder.description':
    'Eşleşen bir sayfadaki ziyaretçilere proaktif bir mesajla ulaşın.',
  'campaigns.builder.nameLabel': 'Ad',
  'campaigns.builder.nameRequired': 'Kampanyaya bir ad verin.',
  'campaigns.builder.triggerLabel': 'Tetikleyici — sayfa URL’si şunu içerir',
  'campaigns.builder.triggerHint':
    'ör. /pricing — mesaj, eşleşen sayfadaki ziyaretçiler için tetiklenir.',
  'campaigns.builder.triggerRequired':
    'Bir kampanyanın kime ulaşacağını bilmesi için bir tetikleyiciye ihtiyacı var.',
  'campaigns.builder.messageLabel': 'Mesaj',
  'campaigns.builder.messagePlaceholder':
    'Merhaba — doğru planı bulmanıza yardımcı olabilir miyim?',
  'campaigns.builder.messageRequired': 'Bir kampanyanın gönderecek bir mesaja ihtiyacı var.',
  'campaigns.builder.startsLabel': 'Başlangıç (isteğe bağlı)',
  'campaigns.builder.endsLabel': 'Bitiş (isteğe bağlı)',
  'campaigns.builder.endsError': 'Bitiş, başlangıçtan sonra olmalı.',
  'campaigns.builder.discardConfirm': 'Bu kampanyadan vazgeçilsin mi?',
  'campaigns.builder.cancel': 'Vazgeç',
  'campaigns.builder.saving': 'Kaydediliyor…',
  'campaigns.builder.saveChanges': 'Değişiklikleri kaydet',
  'campaigns.builder.create': 'Kampanya oluştur',

  // Goals — GoalsPage.tsx
  'goals.page.description': 'Bir ziyaretçinin ulaşmasının dönüşüm sayılacağı sayfaları tanımlayın.',
  'goals.page.statusAriaLabel': 'Hedef durumu',
  'goals.page.new': 'Yeni hedef',
  'goals.page.loadError':
    'Hedefler yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'goals.page.empty.allTitle': 'Henüz hedef yok',
  'goals.page.empty.filteredTitle': '{status} hedef yok',
  'goals.page.empty.writeDescription':
    'Bir ziyaretçinin dönüşüm sayılan bir sayfaya ulaştığında bunu izlemek için bir hedef oluşturun.',
  'goals.page.empty.readDescription':
    'Hedefler, bir ziyaretçinin dönüşüm sayılan bir sayfaya ulaştığı anı izler.',
  'goals.page.whenUrlContains': 'URL şunu içerdiğinde',
  'goals.page.created': '{date} tarihinde oluşturuldu',
  'goals.page.turnOff': 'Kapat',
  'goals.page.turnOn': 'Aç',
  'goals.page.active': 'Etkin',
  'goals.page.inactive': 'Pasif',

  'goals.tab.all': 'Tümü',
  'goals.tab.active': 'Etkin',
  'goals.tab.inactive': 'Pasif',

  // Goal builder — GoalBuilder.tsx
  'goals.builder.title': 'Yeni hedef',
  'goals.builder.description':
    'Bir ziyaretçinin ulaşmasının dönüşüm sayılacağı bir sayfa tanımlayın.',
  'goals.builder.nameLabel': 'Ad',
  'goals.builder.nameRequired': 'Hedefe bir ad verin.',
  'goals.builder.triggerLabel': 'Tetikleyici — sayfa URL’si şunu içerir',
  'goals.builder.triggerHint':
    'ör. /thank-you — eşleşen bir sayfaya ulaşan ziyaretçi dönüşüm sayılır.',
  'goals.builder.triggerRequired':
    'Bir hedefin neyin dönüşüm sayılacağını bilmesi için bir tetikleyiciye ihtiyacı var.',
  'goals.builder.discardConfirm': 'Bu hedeften vazgeçilsin mi?',
  'goals.builder.cancel': 'Vazgeç',
  'goals.builder.saving': 'Kaydediliyor…',
  'goals.builder.create': 'Hedef oluştur',

  // Goal funnel — GoalsFunnel.tsx
  'goals.funnel.title': 'Hedef hunisi',
  'goals.funnel.description':
    'Bir sohbete ulaşan ziyaretçiler ve bunlardan izlenen bir hedefe ulaşanlar.',
  'goals.funnel.loadError':
    'Hedef hunisi yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'goals.funnel.emptyTitle': 'Henüz dönüşüm yok',
  'goals.funnel.emptyDescription':
    'Ziyaretçileri, sohbetleri ve dönüşümleri burada görmek için bir hedef tanımlayın.',
  'goals.funnel.visitors': 'Ziyaretçiler',
  'goals.funnel.chats': 'Sohbetler',
  'goals.funnel.conversions': 'Dönüşümler',
};
