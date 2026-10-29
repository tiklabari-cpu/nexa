import type { Messages } from '../merge.js';

/** Reports: every tab, KPI card, export and saved views. See the English file. */
export const reports: Messages = {
  // Page chrome
  'reports.page.title': 'Raporlar',
  'reports.page.description': 'Sohbet hacmi, yanıt verme hızı ve memnuniyet.',
  'reports.page.tabsAriaLabel': 'Rapor kategorileri',

  // Tabs
  'reports.tabs.overview': 'Genel Bakış',
  'reports.tabs.aiAgent': 'AI Ajanı',
  'reports.tabs.reviews': 'Değerlendirmeler',
  'reports.tabs.breakdown': 'Dağılım',
  'reports.tabs.staffing': 'Personel Planlama',
  'reports.tabs.topics': 'Sohbet Konuları',
  'reports.tabs.cases': 'Talepler',
  'reports.tabs.leads': 'Potansiyel Müşteriler',
  'reports.tabs.sales': 'Satışlar',
  'reports.tabs.teamPerformance': 'Ekip Performansı',

  // Kenar çubuğu kategorileri (FR-MOD-07.1)
  'reports.categories.performance': 'Performans',
  'reports.categories.automation': 'AI ve otomasyon',
  'reports.categories.team': 'Ekip ve planlama',
  'reports.categories.business': 'İş sonuçları',

  // Custom range not yet chosen, or invalid
  'reports.emptyRange.title': 'Bir tarih aralığı seçin',
  'reports.emptyRange.description':
    'Bir başlangıç ve bitiş tarihi seçin. Bitiş tarihi başlangıçtan önce olamaz.',

  // Overview-only "Chat topics" promo banner (FR-MOD-07.6-f)
  'reports.topicsPromo.text': 'En popüler sohbet konuları tek yerde',
  'reports.topicsPromo.cta': 'Sohbet konularını gör',
  'reports.topicsPromo.dismiss': 'Sonra hatırlat',

  // Onboarding survey popover — "What are you tracking?" (FR-MOD-07.2)
  'reports.survey.title': 'Neyi takip ediyorsunuz?',
  'reports.survey.description':
    'Sizin için en önemli olanı seçin — hızlı, isterseniz atlayabilirsiniz.',
  'reports.survey.option.agent_performance': 'Temsilci performansını takip etmek',
  'reports.survey.option.team_sharing': 'Sonuçları ekibimle veya yöneticimle paylaşmak',
  'reports.survey.option.spotting_problems': 'Sorunları tespit etmek',
  'reports.survey.option.revenue_impact': 'Gelir etkisini ölçmek',
  'reports.survey.option.other': 'Diğer',
  'reports.survey.skip': 'Atla',

  // Header range control
  'reports.range.groupAriaLabel': 'Aralık',
  'reports.range.presetDays': '{days} gün',
  'reports.range.custom': 'Özel',
  'reports.range.startDate': 'Başlangıç tarihi',
  'reports.range.endDate': 'Bitiş tarihi',

  // Saved views
  'reports.savedViews.ariaLabel': 'Kayıtlı görünümler',
  'reports.savedViews.trigger': 'Görünümler',
  'reports.savedViews.remove': '{name} kayıtlı görünümünü kaldır',
  'reports.savedViews.saveLabel': 'Bu görünümü kaydet',
  'reports.savedViews.namePlaceholder': 'Bu görünüme ad verin',
  'reports.savedViews.nameError': 'Bu görünüm için bir ad girin.',
  'reports.savedViews.submit': 'Kaydet',
  'reports.savedViews.submitPending': 'Kaydediliyor…',

  // CSV/PDF export
  'reports.export.sectionTitle': 'Dışa aktarma',
  'reports.export.formatLabel': 'Dışa aktarma biçimi',
  'reports.export.csv': 'CSV',
  'reports.export.pdf': 'PDF',
  'reports.export.cta': 'Dışa aktar',
  'reports.export.pending': 'Dışa aktarılıyor…',

  // Paylaşım bağlantısı (FR-MOD-07.3.1)
  'reports.share.trigger': 'Paylaş',
  'reports.share.ariaLabel': 'Bu raporu paylaş',
  'reports.share.loadError.title': 'Paylaşım bağlantıları yüklenemedi',
  'reports.share.description':
    'Seçtiğiniz aralıkla bu rapora bir bağlantı. Bağlantıya sahip herkes, süresi dolana kadar raporu okuyabilir.',
  'reports.share.expiresLabel': 'Süre',
  'reports.share.expiresDays': '{count} gün',
  'reports.share.create': 'Bağlantı oluştur',
  'reports.share.creating': 'Oluşturuluyor…',
  'reports.share.rowGroup': '{group} · …{suffix}',
  'reports.share.rowExpires': 'Bitiş: {when}',
  'reports.share.rowExpired': 'Süresi doldu: {when}',
  'reports.share.revoke': '{suffix} ile biten bağlantıyı iptal et',
  'reports.share.revokeShort': 'İptal et',
  'reports.share.onceTitle': 'Paylaşım bağlantısı oluşturuldu',
  'reports.share.onceDescription':
    'Bu bağlantıya sahip herkes {when} tarihine kadar raporu okuyabilir.',
  'reports.share.onceWarning':
    'Şimdi kopyalayın — yalnızca bir kez gösterilir ve sonradan alınamaz. Paylaş menüsünden istediğiniz zaman iptal edebilirsiniz.',
  'reports.share.copy': 'Kopyala',
  'reports.share.copied': 'Kopyalandı',
  'reports.share.done': 'Tamam',

  // Paylaşım bağlantısının açtığı sayfa
  'reports.shared.title': 'Paylaşılan rapor',
  'reports.shared.loading': 'Rapor yükleniyor…',
  'reports.shared.unavailable': 'Bu bağlantı artık kullanılamıyor.',
  'reports.shared.incomplete': 'Bu bağlantı eksik. Gönderen kişiden yenisini isteyin.',
  'reports.shared.range': '{range}',
  'reports.shared.caption': '{label}, {range}',
  'reports.shared.generated': 'Oluşturulma: {when}',
  'reports.shared.expires': 'Bağlantının bitişi: {when}',

  // Shared across two or more tabs — same word, same meaning every time
  'reports.common.volume': 'Hacim',
  'reports.common.byDay': 'Güne göre',
  'reports.common.byAgent': 'Temsilciye göre',
  'reports.common.dayColumn': 'Gün',
  'reports.common.agentColumn': 'Temsilci',
  'reports.common.shareColumn': 'Pay',
  'reports.common.csatColumn': 'CSAT',
  'reports.common.ticketsColumn': 'Talepler',
  'reports.common.closed': 'Kapanan',
  'reports.common.unknownAgent': 'Bilinmeyen temsilci',
  'reports.common.noRatingsYet': 'Henüz değerlendirme yok',
  'reports.common.noAssignedConversations': 'Atanmış sohbet yok',
  'reports.common.hint.averageOpenToClose': 'Ortalama, açılıştan kapanışa',
  'reports.common.ratingCount.one': '{count} değerlendirme',
  'reports.common.ratingCount.other': '{count} değerlendirme',
  'reports.common.closedShare.none': 'Bu aralıkta hiçbir şey kapanmadı',
  'reports.common.closedShare.value': 'kapananların payı: {rate}',
  'reports.common.delta.noChange': 'Önceki döneme göre değişim yok',
  'reports.common.delta.suffix': '{value} önceki döneme göre',
  'reports.common.delta.tooltip': 'Önceki dönemle karşılaştırıldığında',
  'reports.common.kpi.trackedSales': 'İzlenen satışlar',
  'reports.common.kpi.attributedRevenue': 'Atfedilen gelir',
  'reports.common.kpi.automatedChatDuration': 'Otomatik sohbet süresi',
  'reports.common.salesNotConfigured': 'Satış izleme kurulmadı',
  'reports.common.resolution.chats': 'Sohbetler',
  'reports.common.resolution.manual': 'Manuel',
  'reports.common.resolution.assisted': 'Destekli',
  'reports.common.resolution.automated': 'Otomatik',

  // Overview (FR-MOD-07.1/07.3)
  'reports.overview.error':
    'Raporlar yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.overview.volume.description': 'Seçilen aralıktaki sohbetler ve talepler.',
  'reports.overview.kpi.conversations': 'Sohbetler',
  'reports.overview.kpi.totalCases': 'Toplam vaka',
  'reports.overview.kpi.totalCasesHint': '{chats} sohbet + {tickets} talep',
  'reports.overview.kpi.totalCasesLowConfidence.one':
    'Bu aralıkta yalnızca {count} vaka var — bundan anlamlı bir sonuç çıkarmak için yeterli değil',
  'reports.overview.kpi.totalCasesLowConfidence.other':
    'Bu aralıkta yalnızca {count} vaka var — bundan anlamlı bir sonuç çıkarmak için yeterli değil',
  'reports.overview.kpi.queuedNow': 'Şu anda sırada',
  'reports.overview.queue.waiting': 'Temsilci bekleniyor',
  'reports.overview.queue.empty': 'Bekleyen yok',
  'reports.overview.kpi.achievedGoals': 'Ulaşılan hedefler',
  'reports.overview.resolution.title': 'Çözüm',
  'reports.overview.resolution.description':
    'Kapanan sohbetlerin nasıl ele alındığı. Manuel, destekli ve otomatik, her kapanan vakanın toplamını oluşturur.',
  'reports.overview.resolution.lowConfidence.one':
    'Bu aralıkta yalnızca {count} kapanmış vaka var — paylar güvenilir olmayabilir',
  'reports.overview.resolution.lowConfidence.other':
    'Bu aralıkta yalnızca {count} kapanmış vaka var — paylar güvenilir olmayabilir',
  'reports.overview.chats.title': 'Sohbetler',
  'reports.overview.chats.description':
    'AI’nın sohbetleri ne kadar hızlı sonuçlandırdığı ve ne kadar sürdükleri.',
  'reports.overview.kpi.automatedPerHour': 'Saatte otomatik sohbet',
  'reports.overview.kpi.automatedPerHourHint': 'Aralık boyunca saat başına AI çözümü',
  'reports.overview.kpi.totalDuration': 'Toplam sohbet süresi',
  'reports.overview.kpi.totalDurationHint': 'Kapanan tüm sohbetlerin toplamı',
  'reports.overview.responsiveness.title': 'Yanıt Verme Hızı',
  'reports.overview.kpi.firstResponse': 'İlk yanıt',
  'reports.overview.kpi.firstResponseHint': 'İlk temsilci yanıtına kadar geçen ortalama süre',
  'reports.overview.kpi.conversationLength': 'Sohbet süresi',
  'reports.overview.kpi.conversationLengthHint': 'Açılıştan kapanışa ortalama süre',
  'reports.overview.kpi.satisfaction': 'Memnuniyet',
  'reports.overview.kpi.negativeRatings': 'Olumsuz değerlendirmeler',
  'reports.overview.kpi.slaBreaches': 'SLA ihlalleri',
  'reports.overview.sla.notConfigured': 'Bunu izlemek için Ayarlar → SLA’da hedef belirleyin',
  'reports.overview.sla.lowConfidence':
    'Bundan anlamlı bir sonuç çıkarmak için henüz yeterli vaka yok',
  'reports.overview.byAgent.description': 'Seçilen aralıkta ele alınan sohbetler.',
  'reports.overview.byAgent.emptyDescription':
    'Sohbetler temsilcilere yönlendirildiğinde hacimleri burada görünür.',
  'reports.overview.byAgent.caption': 'Temsilci başına ele alınan sohbetler',
  'reports.overview.byAgent.shareColumn': 'Pay',
  'reports.overview.topTags.title': 'Öne çıkan etiketler',
  'reports.overview.topTags.description': 'Sohbetlerin ne hakkında olduğu.',
  'reports.overview.topTags.emptyTitle': 'Hiç etiket uygulanmadı',
  'reports.overview.topTags.emptyDescription':
    'İletişim hacmini neyin yönlendirdiğini görmek için sohbetleri ayrıntılar panelinden etiketleyin.',

  // AI Agent (FR-MOD-07.4, ADR-09)
  'reports.aiAgent.error':
    'AI Ajanı raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.aiAgent.resolution.title': 'Faturalanan AI çözümü',
  'reports.aiAgent.resolution.description':
    'AI Ajanının insan olmadan çözdüğü — faturada yer alan rakamla aynı.',
  'reports.aiAgent.kpi.resolutions': 'AI çözümleri',
  'reports.aiAgent.kpi.resolutionRate': 'Çözüm oranı',
  'reports.aiAgent.deflection.title': 'Yönlendirme',
  'reports.aiAgent.deflection.description':
    'AI’nın bir sohbeti ne sıklıkla insana devrettiği ve kaç yeteneğin çalıştığı.',
  'reports.aiAgent.kpi.transfers': 'İnsana aktarılan',
  'reports.aiAgent.kpi.transferRate': 'Aktarım oranı',
  'reports.aiAgent.transferRate.empty': 'AI bu aralıkta hiçbir şeyi tamamlamadı',
  'reports.aiAgent.transferRate.hint': 'AI’nın tamamladığı sohbetlerden aktarılan pay',
  'reports.aiAgent.kpi.skillsRun': 'Çalıştırılan yetenekler',

  // AI Ajanı › AI kalitesi (AI-25 · tm 320.3). Metrik adları ve ipuçları
  // @siyahtus/types `AI_METRIC_DEFINITIONS`'tan gelir, buradan değil.
  'reports.aiMetrics.error':
    'AI kalite rakamları yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.aiMetrics.title': 'AI kalitesi',
  'reports.aiMetrics.description':
    'AI’ın gerçekte neyi çözdüğü, devirlerinin nasıl geçtiği ve her zorunlu devrin yapılıp yapılmadığı. Faturalanan rakam değildir.',
  'reports.aiMetrics.filters.active': 'Yalnız gösterilen:',
  'reports.aiMetrics.filters.remove': '{label} süzgecini kaldır',
  'reports.aiMetrics.filters.clear': 'Süzgeçleri temizle',
  'reports.aiMetrics.base.one': 'AI’ın yazdığı {count} biten konuşma üzerinden',
  'reports.aiMetrics.base.other': 'AI’ın yazdığı {count} biten konuşma üzerinden',
  'reports.aiMetrics.lowSample.one':
    'Az örnek: {count} konuşma bu oranları bir eğilim olarak okumak için az.',
  'reports.aiMetrics.lowSample.other':
    'Az örnek: {count} konuşma bu oranları bir eğilim olarak okumak için az.',
  'reports.aiMetrics.definitionOf': '{metric} neyi sayar',
  'reports.aiMetrics.showList': 'Konuşmaları göster: {metric}',
  'reports.aiMetrics.showListShort': 'Konuşmaları göster',
  'reports.aiMetrics.resolution.title': 'Çözüm',
  'reports.aiMetrics.resolution.description':
    'Oyuncunun onayladığı, varsayılıp 72 saat sonra kesinleşen ya da aynı konuyla geri gelinen.',
  'reports.aiMetrics.unsettledNote.one': '{count} tanesi henüz kesinleşmedi',
  'reports.aiMetrics.unsettledNote.other': '{count} tanesi henüz kesinleşmedi',
  'reports.aiMetrics.unsettledHint': '72 saatlerinin dolması bekleniyor',
  'reports.aiMetrics.containmentCaution':
    'Tek başına başarı değildir — önündeki oranlarla birlikte okuyun',
  'reports.aiMetrics.claims.title': 'AI’ın söylediği ve oyuncunun cevabı',
  'reports.aiMetrics.claims.aiClaimed': 'AI çözüldü dedi',
  'reports.aiMetrics.claims.playerConfirmed': 'Oyuncu Evet dedi',
  'reports.aiMetrics.claims.playerDenied': 'Oyuncu Hayır dedi',
  'reports.aiMetrics.claims.unanswered': 'AI çözüldü dedi, cevap yok',
  'reports.aiMetrics.claims.note':
    '{confirmed} oranına yalnız oyuncunun Evet’i girer; AI’ın kendi sözü hiçbir zaman girmez.',
  'reports.aiMetrics.handoff.title': 'Devir',
  'reports.aiMetrics.handoff.description':
    'AI’ın ne sıklıkla ve neden devrettiği, devir kartının ne kadar iyi olduğu ve oyuncunun bir insanı ne kadar beklediği.',
  'reports.aiMetrics.complianceTarget': 'Hedef %100',
  'reports.aiMetrics.wait.when': 'Ne zaman',
  'reports.aiMetrics.wait.count': 'Devir',
  'reports.aiMetrics.wait.median': 'Medyan',
  'reports.aiMetrics.wait.p90': '%90’lık dilim',
  'reports.aiMetrics.wait.all': 'Tümü',
  'reports.aiMetrics.wait.inHours': 'Mesai içi',
  'reports.aiMetrics.wait.outOfHours': 'Mesai dışı',
  'reports.aiMetrics.wait.noSchedule':
    'Beklemeyi mesai içi ve dışı ayırmak için Ayarlar’da çalışma saatlerini kaydedin.',
  'reports.aiMetrics.reasons.title': 'Devir nedenleri',
  'reports.aiMetrics.reasons.empty': 'Bu aralıkta devir yok.',
  'reports.aiMetrics.reasons.noKnowledge':
    '“Bilgi tabanında cevap yok” Playbook’taki cevapsız sorular listesine işaret eder.',
  'reports.aiMetrics.violations.title': 'Zorunlu devir ihlalleri',
  'reports.aiMetrics.violations.empty': 'Bu aralıkta yok.',
  'reports.aiMetrics.violations.rule': 'Kural',
  'reports.aiMetrics.violations.qaFound': 'QA buldu',
  'reports.aiMetrics.safety.title': 'Güvenlik ve memnuniyet',
  'reports.aiMetrics.safety.description':
    'QA’nın doğruladığı guardrail ihlalleri ve yanında otomatik şüpheler, insanlı ve insansız puanlar, AI’ın ne kadar tutarlı cevap verdiği.',
  'reports.aiMetrics.ratings.one': '{count} puan',
  'reports.aiMetrics.ratings.other': '{count} puan',
  'reports.aiMetrics.fewSamples': 'Az örnek',
  'reports.aiMetrics.breakdown.title': 'Karşılaştırma',
  'reports.aiMetrics.breakdown.description':
    'Aynı rakamlar AI sürümüne, konuya, devir nedenine, dile, markaya ya da ekibe göre. Yalnız o grubu görmek için bir satır seçin.',
  'reports.aiMetrics.breakdown.by': 'Karşılaştır',
  'reports.aiMetrics.breakdown.emptyTitle': 'Henüz karşılaştırılacak bir şey yok',
  'reports.aiMetrics.breakdown.emptyDescription':
    'Bu aralıkta AI’ın katıldığı hiçbir konuşma bitmedi.',
  'reports.aiMetrics.breakdown.caption': 'AI kalitesi — {dimension}',
  'reports.aiMetrics.breakdown.n': 'Konuşma',
  'reports.aiMetrics.breakdown.actions': 'Süzgeç',
  'reports.aiMetrics.breakdown.only': 'Yalnız {group}',
  'reports.aiMetrics.breakdown.onlyShort': 'Yalnız bu',
  'reports.aiMetrics.dimension.version': 'AI sürümü',
  'reports.aiMetrics.dimension.intent': 'Konu',
  'reports.aiMetrics.dimension.reason': 'Devir nedeni',
  'reports.aiMetrics.dimension.language': 'Dil',
  'reports.aiMetrics.dimension.brand': 'Marka',
  'reports.aiMetrics.dimension.team': 'Ekip',
  'reports.aiMetrics.noGroup.version': 'Sürüm kaydı yok',
  'reports.aiMetrics.noGroup.intent': 'Konu yok',
  'reports.aiMetrics.noGroup.reason': 'Devir yok',
  'reports.aiMetrics.noGroup.language': 'Dil kaydı yok',
  'reports.aiMetrics.noGroup.brand': 'Marka yok',
  'reports.aiMetrics.noGroup.team': 'Ekip yok',
  'reports.aiMetrics.conversations.title': 'Bir rakamın arkasındaki konuşmalar',
  'reports.aiMetrics.conversations.description':
    'Bir rakamın saydığı bağlantılar, en yeni biten önce — sayımla aynı kural.',
  'reports.aiMetrics.list.metric': 'Rakam',
  'reports.aiMetrics.list.confirmed_resolved': 'Onaylı çözümler',
  'reports.aiMetrics.list.assumed_resolved': 'Varsayılan çözümler',
  'reports.aiMetrics.list.unsettled': 'Kesinleşmemiş',
  'reports.aiMetrics.list.false_resolution': 'Yanlış çözümler',
  'reports.aiMetrics.list.handed_off': 'Devredilen',
  'reports.aiMetrics.list.abandoned': 'Yarıda bırakılan',
  'reports.aiMetrics.list.declined': 'Oyuncu Hayır dedi, devir yok',
  'reports.aiMetrics.list.mandatory_handoff_violation': 'Zorunlu devir ihlalleri',
  'reports.aiMetrics.list.guardrail_violation': 'Guardrail ihlalleri (QA)',
  'reports.aiMetrics.list.guardrail_suspected': 'Guardrail şüpheleri',
  'reports.aiMetrics.list.repeat_unmeasured': 'Tekrar temas ölçülemedi',
  'reports.aiMetrics.list.error': 'Bu konuşmalar yüklenemedi. Yeniden deneyin.',
  'reports.aiMetrics.list.emptyTitle': 'Konuşma yok',
  'reports.aiMetrics.list.emptyDescription': 'Bu aralıkta bu rakama giren bir şey yok.',
  'reports.aiMetrics.list.ended': 'Bitiş',
  'reports.aiMetrics.list.outcome': 'Sonuç',
  'reports.aiMetrics.list.topic': 'Konu',
  'reports.aiMetrics.list.reason': 'Devir nedeni',
  'reports.aiMetrics.list.loadMore': 'Daha fazla yükle',
  'reports.aiMetrics.list.loadingMore': 'Yükleniyor…',
  'reports.aiMetrics.outcome.confirmed_resolved': 'Onaylı çözüm',
  'reports.aiMetrics.outcome.assumed_pending': 'Kesinleşmemiş',
  'reports.aiMetrics.outcome.assumed_resolved': 'Varsayılan çözüm',
  'reports.aiMetrics.outcome.false_resolved': 'Yanlış çözüm',
  'reports.aiMetrics.outcome.handed_off': 'Devredildi',
  'reports.aiMetrics.outcome.abandoned': 'Yarıda bırakıldı',
  'reports.aiMetrics.outcome.declined': 'Oyuncu Hayır dedi',

  // Reviews (FR-MOD-07.8)
  'reports.reviews.error':
    'Değerlendirmeler raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.reviews.csat.title': 'Memnuniyet (CSAT)',
  'reports.reviews.csat.description':
    'Tüm değerlendirmelerin bir payı olarak olumlu oran. Kimse değerlendirmediyse boş, asla %0 değil.',
  'reports.reviews.csat.emptyDescription':
    'Müşteriler sohbetlerini değerlendirdiğinde olumlu/olumsuz dağılım burada görünür.',
  'reports.reviews.csat.good': 'Olumlu',
  'reports.reviews.csat.bad': 'Olumsuz',
  'reports.reviews.csat.noPreviousRatings': 'Önceki dönemde değerlendirme yok',
  'reports.reviews.csat.vsPrevious': 'önceki dönemde {rate}',
  'reports.reviews.csat.donutLabel':
    'CSAT {rate}: {responses} değerlendirmenin {good} tanesi olumlu.',
  'reports.reviews.csat.donutUnknown': 'bilinmiyor',
  'reports.reviews.byDay.title': 'Güne göre değerlendirmeler',
  'reports.reviews.comments.title': 'Yorumlar',
  'reports.reviews.comments.description':
    'Oyuncuların bu dönemde puanlarıyla birlikte yazdıkları, en yenisi önce.',
  'reports.reviews.comments.filter': 'Göster',
  'reports.reviews.comments.all': 'Tüm puanlar',
  'reports.reviews.comments.bad': 'Kötü puanlar',
  'reports.reviews.comments.good': 'İyi puanlar',
  'reports.reviews.comments.loading': 'Yorumlar yükleniyor…',
  'reports.reviews.comments.error': 'Yorumlar yüklenemedi. Biraz sonra yeniden deneyin.',
  'reports.reviews.comments.emptyTitle': 'Henüz yorum yok',
  'reports.reviews.comments.emptyDescription':
    'Bir oyuncu puanına yorum eklediğinde burada görünür.',
  'reports.reviews.comments.handledBy': 'ilgilenen: {name}',
  'reports.reviews.comments.more': 'Daha fazla yükle',
  'reports.reviews.byDay.description':
    'Aralıktaki her UTC günü için günlük değerlendirme hacmi, olumlu ve olumsuz.',
  'reports.reviews.byDay.emptyTitle': 'Bu aralıkta değerlendirme yok',
  'reports.reviews.byDay.emptyDescription':
    'Müşteriler sohbetleri değerlendirdikçe her günün değerlendirmeleri burada görünür.',
  'reports.reviews.byDay.caption': 'Güne göre değerlendirmeler, olumlu ve olumsuz olarak ayrılmış',
  'reports.reviews.byDay.ratingsColumn': 'Değerlendirmeler',
  'reports.reviews.byDay.goodColumn': 'Olumlu',
  'reports.reviews.byDay.badColumn': 'Olumsuz',
  // İçgörüler (FR-MOD-07.8) — API kimlik + rakam gönderir, cümle burada kurulur.
  'reports.reviews.insights.title': 'İçgörüler',
  'reports.reviews.insights.description':
    'Bu rakamların ne söylediği — tahmin edilmez, sabit kurallarla türetilir.',
  'reports.reviews.insights.emptyTitle': 'Söylenecek bir şey yok',
  'reports.reviews.insights.emptyDescription':
    'Bu dönem, konsolun bu sürümünün ifade edebildiği bir sonuç üretmedi.',
  'reports.reviews.insights.tone.positive': 'Olumlu',
  'reports.reviews.insights.tone.negative': 'Dikkat',
  'reports.reviews.insights.tone.warning': 'Düşük güven',
  'reports.reviews.insights.tone.neutral': 'Not',
  'reports.reviews.insights.no_ratings':
    'Bu dönemde kimse bir sohbeti değerlendirmedi; henüz okunacak bir şey yok.',
  'reports.reviews.insights.low_base':
    'Bu dönemde yalnızca {responses} değerlendirme var — trend okumak için çok az, oranlar güvenilir olmayabilir.',
  'reports.reviews.insights.csat_no_baseline':
    'Önceki dönemde {previous} değerlendirme var; karşılaştırma için çok az.',
  'reports.reviews.insights.csat_improved':
    'Memnuniyet önceki döneme göre {points} puan arttı ({responses} değerlendirme üzerinden).',
  'reports.reviews.insights.csat_declined':
    'Memnuniyet önceki döneme göre {points} puan düştü ({responses} değerlendirme üzerinden).',
  'reports.reviews.insights.csat_steady':
    'Memnuniyet önceki döneme göre sabit kaldı ({responses} değerlendirme, öncesinde {previous}).',
  'reports.reviews.insights.all_positive':
    'Bu dönemdeki {responses} değerlendirmenin tamamı olumlu.',
  'reports.reviews.insights.all_negative':
    'Bu dönemdeki {responses} değerlendirmenin tamamı olumsuz.',
  'reports.reviews.insights.bad_day_concentration':
    'Bu dönemdeki olumsuz değerlendirmelerin ({bad}) {share} kadarı {date} gününde geldi.',

  'reports.reviews.ecommerce.title': 'E-ticaret',
  'reports.reviews.ecommerce.description': 'Desteklenen sohbetlere atfedilen satışlar.',
  'reports.reviews.ecommerce.emptyDescription':
    'Desteklenen sohbetlere gelir atfetmek için bir satış kaynağı bağlayın.',
  'reports.reviews.ecommerce.cta': 'Satış platformlarını yapılandır',

  // Breakdown (FR-MOD-07.5)
  'reports.breakdown.error':
    'Dağılım yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.breakdown.byDay.description': 'Aralıktaki her UTC günü için çözüm dağılımı.',
  'reports.breakdown.byDay.emptyTitle': 'Henüz sohbet yok',
  'reports.breakdown.byDay.emptyDescription':
    'Bu aralıkta sohbetler gerçekleştiğinde günlük dağılımları burada görünür.',
  'reports.breakdown.byDay.caption': 'Güne göre çözüm dağılımı',
  'reports.breakdown.byAgent.description': 'Aynı dağılım, atanan her temsilci için.',
  'reports.breakdown.byAgent.emptyDescription':
    'Sohbetler temsilcilere yönlendirildiğinde dağılımları burada görünür.',
  'reports.breakdown.byAgent.caption': 'Temsilciye göre çözüm dağılımı',
  'reports.breakdown.byHour.title': 'Saate göre',
  'reports.breakdown.byHour.description':
    'Aynı dağılım, aralık boyunca toplanan her UTC saati için.',
  'reports.breakdown.byHour.emptyTitle': 'Henüz saatlik veri yok',
  'reports.breakdown.byHour.emptyDescription':
    'Bu aralıkta sohbetler gerçekleştiğinde saatlik dağılımları burada görünür.',
  'reports.breakdown.byHour.caption': 'Saate göre çözüm dağılımı',
  'reports.breakdown.byHour.column': 'Saat',
  'reports.breakdown.byTeam.title': 'Ekibe göre',
  'reports.breakdown.byTeam.description':
    'Aynı dağılım, bir sohbetin görünür olduğu her ekip için.',
  'reports.breakdown.byTeam.descriptionOverlap':
    'Aynı dağılım, bir sohbetin görünür olduğu her ekip için. Birden fazla ekibe açık bir sohbet her birinde sayılır, bu yüzden satır toplamları aralığın toplam sohbet sayısını aşabilir.',
  'reports.breakdown.byTeam.emptyTitle': 'Henüz ekip verisi yok',
  'reports.breakdown.byTeam.emptyDescription':
    'Sohbetler bir ekibe görünür olduğunda dağılımları burada görünür.',
  'reports.breakdown.byTeam.caption': 'Ekibe göre çözüm dağılımı',
  'reports.breakdown.byTeam.column': 'Ekip',
  'reports.breakdown.byTeam.unassigned': 'Atanmamış',
  'reports.breakdown.byChannel.title': 'Kanala göre',
  'reports.breakdown.byChannel.description': 'Aynı dağılım, sohbetin başladığı her kanal için.',
  'reports.breakdown.byChannel.emptyTitle': 'Henüz kanal verisi yok',
  'reports.breakdown.byChannel.emptyDescription':
    'Bu aralıkta sohbetler gerçekleştiğinde kanal dağılımları burada görünür.',
  'reports.breakdown.byChannel.caption': 'Kanala göre çözüm dağılımı',
  'reports.breakdown.byChannel.column': 'Kanal',

  // Staffing (WORKSCHED-i, PRD §5.3)
  'reports.staffing.error':
    'Personel tahmini yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.staffing.description':
    "Gözlenen hacim ve varlık kaydından, her UTC hafta günü ve saati için gereken ile planlanan temsilci sayısı. Açıklar kapatılması gereken farktır; yeterli geçmişi olmayan bir hücre asla tahmini bir sayı değil, her zaman '—' gösterir.",
  'reports.staffing.emptyTitle': 'Bu aralıkta personel verisi yok',
  'reports.staffing.emptyDescription':
    'Bu aralıkta sohbetler gerçekleştiğinde gereken-planlanan tahmini burada görünür.',
  'reports.staffing.noPresenceData':
    'Bu aralıkta varlık verisi yok — planlanan kapsama ve her fark bilinmiyor.',
  'reports.staffing.noRoster':
    'Henüz hiçbir temsilcinin kayıtlı bir çalışma programı yok — planlı kapsama bilinmiyor.',
  'reports.staffing.gridCaption':
    'Her UTC hafta günü ve saati için gereken ile planlanan temsilci sayısı',
  'reports.staffing.cellUnknown': 'Yeterli veri yok',
  'reports.staffing.cellTitle': 'Gereken {required} · Planlanan {scheduled} · Fark {gap}',

  // Chat topics (FR-MOD-07.6)
  'reports.topics.error':
    'Sohbet konuları yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.topics.description': 'Bu aralıktaki sohbetler, AI kümeleme ile konulara ayrıldı.',
  'reports.topics.emptyTitle': 'Henüz yeterli sohbet yok',
  'reports.topics.emptyDescription':
    'Sohbet konuları bu aralıkta en az {min} sohbet gerektirir — şimdiye kadar {analyzed}.',
  'reports.topics.caption': 'Sohbet konuları, hacme göre azalan sırayla',
  'reports.topics.topicColumn': 'Konu',
  'reports.topics.trendColumn': 'Trend',
  'reports.topics.noChange': 'Değişim yok',

  // Cases (FR-MOD-07.7, v2 — tickets)
  'reports.cases.error':
    'Talepler raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.cases.volume.description': 'Seçilen aralıktaki talepler, geçerli duruma göre.',
  'reports.cases.kpi.open': 'Açık',
  'reports.cases.kpi.total': 'Toplam',
  'reports.cases.byDay.description':
    'UTC gününe göre oluşturulan talepler, açık ve kapanan olarak ayrılmış.',
  'reports.cases.byDay.emptyTitle': 'Bu aralıkta talep yok',
  'reports.cases.byDay.emptyDescription':
    'Bu aralıkta bir talep oluşturulduğunda günlük dağılımı burada görünür.',
  'reports.cases.byDay.caption': 'Güne göre talepler, açık ve kapanan olarak ayrılmış',
  'reports.cases.byStatus.title': 'Duruma göre',
  'reports.cases.byStatus.description': 'Aralıktaki talepler, geçerli durumlarına göre gruplanmış.',
  'reports.cases.byStatus.emptyTitle': 'Henüz durum verisi yok',
  'reports.cases.byStatus.emptyDescription':
    'Bu aralıkta bir talep oluşturulduğunda durum dağılımı burada görünür.',
  'reports.cases.byStatus.caption': 'Geçerli duruma göre talepler',
  'reports.cases.byStatus.column': 'Durum',
  'reports.cases.byPriority.title': 'Önceliğe göre',
  'reports.cases.byPriority.description':
    'Aralıktaki talepler, kayıtlı sıra önceliğine göre gruplanmış (en yüksekten başlayarak).',
  'reports.cases.byPriority.emptyTitle': 'Henüz öncelik verisi yok',
  'reports.cases.byPriority.emptyDescription':
    'Bu aralıkta bir talep oluşturulduğunda öncelik dağılımı burada görünür.',
  'reports.cases.byPriority.caption': 'Kayıtlı sıra önceliğine göre talepler',
  'reports.cases.byPriority.column': 'Öncelik',
  'reports.cases.byPriority.nearest': '{level} ({value})',

  // Leads (FR-MOD-07.7, v2)
  'reports.leads.error':
    'Potansiyel müşteriler raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.leads.volume.description':
    'Potansiyel müşteri olarak işaretlenen müşteriler, bu lisansla ilk temas kurdukları UTC gününe göre sayılmış.',
  'reports.leads.kpi.newLeads': 'Yeni potansiyel müşteriler',
  'reports.leads.byDay.description': 'Aralıktaki her UTC günü için yeni potansiyel müşteriler.',
  'reports.leads.byDay.emptyTitle': 'Bu aralıkta yeni potansiyel müşteri yok',
  'reports.leads.byDay.emptyDescription':
    'Bir müşterinin bu lisansla ilk sohbeti veya talebi geldiğinde burada görünür.',
  'reports.leads.byDay.caption': 'Güne göre yeni potansiyel müşteriler',

  // Sales (FR-MOD-07.7, v2; FR-MOD-13.5)
  'reports.sales.error':
    'Satış raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.sales.description': 'Desteklenen sohbetlere atfedilen satışlar.',
  'reports.sales.kpi.conversions': 'Dönüşümler',
  'reports.sales.emptyDescription':
    'Desteklenen sohbetlere gelir atfetmek için Satış izleyiciyi kullanarak bir satış kaynağı bağlayın.',

  // Team performance (FR-MOD-07.7, v2)
  'reports.teamPerformance.error':
    'Ekip performansı raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.teamPerformance.description':
    'Aralık için temsilci başına sohbetler, çözüm dağılımı, ilk yanıt süresi ve CSAT.',
  'reports.teamPerformance.emptyTitle': 'Bu aralıkta temsilci etkinliği yok',
  'reports.teamPerformance.emptyDescription':
    'Sohbetler temsilcilere atandığında temsilci başına performansları burada görünür.',
  'reports.teamPerformance.totals.title': 'Çalışma alanı toplamları',
  'reports.teamPerformance.totals.description':
    'Bu aralıkta çalışma alanının tamamı, bir önceki aralıkla karşılaştırmalı. Aşağıdaki tablonun toplamı değildir; o tablo yalnız ilk 20 temsilciyi gösterir.',
  'reports.teamPerformance.caption':
    'Temsilci başına sohbetler, çözüm dağılımı, yanıt süresi ve CSAT',
  'reports.teamPerformance.avgFirstResponseColumn': 'Ort. ilk yanıt',

  // Raporlar › AI Kalite (AI-24 · tm 319.3): QA kuyruğu, tek inceleme, kalibrasyon turu.
  'reports.qa.page.title': 'AI kalite',
  'reports.qa.page.description':
    'AI’ın katıldığı konuşmalar, bir kişi tarafından rubriğe göre incelenir.',
  'reports.qa.page.allReports': 'Tüm raporlar',
  'reports.qa.page.notForRoleTitle': 'AI kalitesini Ekip Liderleri ve yöneticiler inceler',
  'reports.qa.page.notForRoleDescription':
    'AI’ın konuşmalarını incelemeniz gerekiyorsa bir yöneticiye danışın.',
  'reports.qa.tabs.queue': 'Kuyruk',
  'reports.qa.tabs.calibration': 'Kalibrasyon',
  'reports.qa.tabs.metrics': 'Metrikler',

  'reports.qa.criterion.topic': 'Konuyu doğru anladı',
  'reports.qa.criterion.required_info': 'Zorunlu bilgileri topladı',
  'reports.qa.criterion.faithfulness': 'Bilgiye sadık, uydurma yok',
  'reports.qa.criterion.guardrails': 'Uyum kurallarına uydu',
  'reports.qa.criterion.handoff_timing': 'Doğru zamanda devretti',
  'reports.qa.criterion.handoff_summary': 'Devir özeti eksiksiz',
  'reports.qa.criterion.tone': 'Ton',

  'reports.qa.reason.random': 'Rastgele örneklem',
  'reports.qa.reason.risk_flag': 'Risk bayrağı',
  'reports.qa.reason.low_bsat': 'Düşük puan',
  'reports.qa.reason.repeat_72h': '72 saatte tekrar temas',
  'reports.qa.reason.guardrail_scan': 'Uyum koruması işareti',
  'reports.qa.reason.mandatory_handoff': 'Zorunlu devir',
  'reports.qa.reason.handoff_insufficient': 'Devir kartı yetersiz',
  'reports.qa.reason.consistency': 'Tutarlılık',
  'reports.qa.reason.manual': 'Elle gönderildi',

  'reports.qa.priority.risk': 'Risk önceliği',
  'reports.qa.priority.guardrail': 'Uyum önceliği',
  'reports.qa.priority.normal': 'Normal öncelik',

  'reports.qa.status.pending_prescore': 'Ön puan bekliyor',
  'reports.qa.status.ready': 'Hazır',
  'reports.qa.status.in_review': 'İncelemede',
  'reports.qa.status.completed': 'Tamamlandı',
  'reports.qa.statusOption.open': 'Açık',
  'reports.qa.statusOption.ready': 'Hazır',
  'reports.qa.statusOption.in_review': 'İncelemede',
  'reports.qa.statusOption.pending_prescore': 'Ön puan bekliyor',
  'reports.qa.statusOption.completed': 'Tamamlandı',
  'reports.qa.statusOption.all': 'Tümü',

  'reports.qa.final.legend': 'Sonuç',
  'reports.qa.final.pass': 'Geçti',
  'reports.qa.final.fail': 'Kaldı',
  'reports.qa.final.required': 'Geçti ya da Kaldı seçin.',
  'reports.qa.final.criticalFail': 'Kritik bir kriter başarısız; inceleme “Kaldı” olur.',

  'reports.qa.score.notApplicable': 'Uygulanmaz',
  'reports.qa.score.critical': 'Kritik',
  'reports.qa.score.weight': 'ağırlık {weight}',
  'reports.qa.score.confirm': '“{criterion}” kriterini kendim kontrol ettim',

  'reports.qa.problem.required': 'Bu kriteri puanlayın.',
  'reports.qa.problem.invalid': 'Bu değer kritere uymuyor.',
  'reports.qa.problem.unconfirmed': 'Bu kritik kriteri tek başına onaylayın.',
  'reports.qa.problem.contradicts': 'Başarısız bir kritik kriter incelemeyi “Kaldı” yapar.',

  'reports.qa.prescore.suggests': 'AI ön puanı: {value}',
  'reports.qa.prescore.evidence': 'Dayandığı mesajlar:',
  'reports.qa.prescore.evidenceLink': '“{criterion}” için dayanılan {n}. mesajı göster',
  'reports.qa.prescore.overall': 'Modelin genel değerlendirmesi: {value}.',
  'reports.qa.prescore.use': 'Ön puanı kullan',
  'reports.qa.prescore.neverConfirms':
    'Yalnız puanlamadığınız kriterleri doldurur, hiçbir şeyi onaylamaz — her kritik kriteri kendiniz işaretleyin.',
  'reports.qa.prescore.none': 'Bu inceleme için ön puan yok: konuşmaya bakarak puanlayın.',

  'reports.qa.excerpt.empty': 'Bu konuşmadan saklanan mesaj yok.',
  'reports.qa.excerpt.restrictedTitle': 'Sorumlu oyun konuşması',
  'reports.qa.excerpt.restrictedBody':
    'Metni yalnız Sorumlu Oyun ekibi ve yöneticiler görür. Mesajlar ve karar izi okunabilir kalır.',
  'reports.qa.excerpt.hidden': 'Metin gizli',
  'reports.qa.author.ai': 'AI',
  'reports.qa.author.customer': 'Oyuncu',
  'reports.qa.author.agent': 'Temsilci',
  'reports.qa.author.bot': 'Bot',

  'reports.qa.review.title': 'AI kalite incelemesi',
  'reports.qa.review.description': 'Konuşma, AI’ın kararları ve rubrik.',
  'reports.qa.review.back': 'Kuyruğa dön',
  'reports.qa.review.loadError': 'Bu inceleme yüklenemedi.',
  'reports.qa.review.rubricVersion': 'Rubrik v{version}',
  'reports.qa.review.conversation': 'Konuşma',
  'reports.qa.review.trail': 'Karar izi',
  'reports.qa.review.rubric': 'Rubrik',
  'reports.qa.review.pendingPrescore':
    'Model bu incelemeyi hâlâ ön puanlıyor. Bir dakika içinde üstlenilebilir.',
  'reports.qa.review.claimFirst':
    'Puanlamak için incelemeyi üstlenin. Siz tuttuğunuz sürece başkası puanlayamaz.',
  'reports.qa.review.claim': 'Üstlen',
  'reports.qa.review.heldByOther': 'Bu incelemeyi başka bir inceleyici tutuyor.',
  'reports.qa.review.comments': 'Yorumlar',
  'reports.qa.review.saved': 'Kaydedildi.',
  'reports.qa.review.release': 'Kuyruğa bırak',
  'reports.qa.review.save': 'Taslağı kaydet',
  'reports.qa.review.complete': 'İncelemeyi tamamla',
  'reports.qa.review.incomplete.one': '{count} eksik var — rubriğe bakın.',
  'reports.qa.review.incomplete.other': '{count} eksik var — rubriğe bakın.',

  'reports.qa.outcome.passed': 'İncelendi: geçti',
  'reports.qa.outcome.failed': 'İncelendi: kaldı',
  'reports.qa.outcome.criticalFail': 'İncelendi: kritik hata',
  'reports.qa.outcome.reviewedAt': 'Tamamlanma: {at}.',
  'reports.qa.outcome.mandatoryHandoff':
    'AI yapması gereken bir devri kaçırdı. Yöneticilere bildirildi.',
  'reports.qa.outcome.suggestion': 'Koçluk önerisini aç',
  'reports.qa.outcome.scenario': 'Test senaryosu taslağını aç',

  'reports.qa.trail.empty': 'Bu konuşmanın karar izi artık saklanmıyor — elde kalan, kesittir.',
  'reports.qa.trail.decisions': 'AI kararları',
  'reports.qa.trail.step': 'Adım',
  'reports.qa.trail.procedure': 'Prosedür',
  'reports.qa.trail.handoffReason': 'Devir nedeni',
  'reports.qa.trail.sources': 'Bilgi kaynakları',
  'reports.qa.trail.guardrails': 'Uyum koruması kontrolleri',
  'reports.qa.trail.handoffs': 'Devirler',
  'reports.qa.trail.accepted': 'kabul edildi',
  'reports.qa.trail.riskFlags': 'Risk bayrakları',

  'reports.qa.queue.filters': 'Kuyruk süzgeçleri',
  'reports.qa.queue.statusFilter': 'Durum',
  'reports.qa.queue.reasonFilter': 'Neden',
  'reports.qa.queue.anyReason': 'Her neden',
  'reports.qa.queue.mineOnly': 'Yalnız benim tuttuklarım',
  'reports.qa.queue.count.one': '{count} inceleme',
  'reports.qa.queue.count.other': '{count} inceleme',
  'reports.qa.queue.openCount.one': '{count} açık',
  'reports.qa.queue.openCount.other': '{count} açık',
  'reports.qa.queue.loadError': 'QA kuyruğu yüklenemedi.',
  'reports.qa.queue.emptyTitle': 'İncelenecek bir şey yok',
  'reports.qa.queue.emptyDescription':
    'Her gece AI’ın kapanan konuşmalarından örneklem bu kuyruğa düşer; Ekip Liderleri gelen kutusundan da konuşma gönderebilir.',
  'reports.qa.queue.caption': 'İncelemeler, en acil olan önce',
  'reports.qa.queue.colConversation': 'Konuşma',
  'reports.qa.queue.colReasons': 'Neden burada',
  'reports.qa.queue.colStatus': 'Durum',
  'reports.qa.queue.colDue': 'Son tarih',
  'reports.qa.queue.colAction': 'İşlem',
  'reports.qa.queue.due': 'son tarih {at}',
  'reports.qa.queue.overdue': 'Gecikti',
  'reports.qa.queue.yours': 'sizde',
  'reports.qa.queue.review': 'İncele',
  'reports.qa.queue.continue': 'Devam et',
  'reports.qa.queue.open': 'Aç',
  'reports.qa.queue.previous': 'Önceki',
  'reports.qa.queue.next': 'Sonraki',

  'reports.qa.summary.title': 'AI kalite sayıları',
  'reports.qa.summary.window': 'Son 30 gün',
  'reports.qa.summary.open': 'Açık',
  'reports.qa.summary.overdue': 'Geciken',
  'reports.qa.summary.completed': 'Tamamlanan',
  'reports.qa.summary.passRate': 'Geçme oranı',
  'reports.qa.summary.criticalFailed': 'Kritik hatalar',
  'reports.qa.summary.handoffMissed': 'Kaçırılan devirler',
  'reports.qa.summary.handoffChecked.one': 'incelenen {count} zorunlu devirden',
  'reports.qa.summary.handoffChecked.other': 'incelenen {count} zorunlu devirden',
  'reports.qa.summary.guardrailBreaches': 'Doğrulanan uyum ihlalleri',
  'reports.qa.summary.falseResolutions': 'Yanlış çözümler',

  'reports.qa.calibration.description':
    'Ayda bir her inceleyici aynı konuşmaları kendi başına puanlar; rapor ne kadar uyuştuğunuzu gösterir. Tur kapanınca herkese açılır.',
  'reports.qa.calibration.open': 'Bu ayın turunu aç',
  'reports.qa.calibration.loadError': 'Kalibrasyon turları yüklenemedi.',
  'reports.qa.calibration.emptyTitle': 'Henüz kalibrasyon turu yok',
  'reports.qa.calibration.emptyDescription':
    'Bir yönetici son 60 günün tamamlanmış incelemelerinden bir tur açar.',
  'reports.qa.calibration.rounds': 'Kalibrasyon turları',
  'reports.qa.calibration.status.open': 'Açık',
  'reports.qa.calibration.status.closed': 'Kapandı',
  'reports.qa.calibration.progress': '{total} konuşmanın {scored} tanesini puanladınız',
  'reports.qa.calibration.pickTitle': 'Bir tur seçin',
  'reports.qa.calibration.pickDescription': 'Konuşmaları ve raporu burada açılır.',
  'reports.qa.calibration.closedAt': 'kapanış {at}',
  'reports.qa.calibration.close': 'Turu kapat',
  'reports.qa.calibration.reportLater':
    'Rapor tur açıkken yalnız yöneticilere, kapanınca herkese görünür.',
  'reports.qa.calibration.items': 'Bu turdaki konuşmalar',
  'reports.qa.calibration.item': 'Konuşma {n}',
  'reports.qa.calibration.scored': 'Puanlandı',
  'reports.qa.calibration.notScored': 'Henüz puanlanmadı',
  'reports.qa.calibration.scoreForm': 'Puanlarınız',
  'reports.qa.calibration.saved': 'Puanlar kaydedildi.',
  'reports.qa.calibration.saveScores': 'Puanları kaydet',
  'reports.qa.calibration.report': 'Kalibrasyon raporu',
  'reports.qa.calibration.agreement': 'Kriter başına uyum',
  'reports.qa.calibration.criterion': 'Kriter',
  'reports.qa.calibration.agreementCol': 'Uyum',
  'reports.qa.calibration.scoredCol': 'Puan sayısı',
  'reports.qa.calibration.reviewers': 'İnceleyiciler',
  'reports.qa.calibration.reviewer': 'İnceleyici',
  'reports.qa.calibration.deviationCol': 'Sapma',
  'reports.qa.calibration.outlier': 'Aykırı',
  'reports.qa.calibration.needsTwo':
    'Uyum, en az iki inceleyicinin puanladığı konuşmalarda ölçülür — henüz yok.',

  'reports.qa.error.claimed': 'Bu incelemeyi başka bir inceleyici önce üstlendi.',
  'reports.qa.error.pending_prescore':
    'Model bu incelemeyi hâlâ ön puanlıyor — bir dakika sonra yeniden deneyin.',
  'reports.qa.error.completed': 'Bu konuşma zaten incelendi.',
  'reports.qa.error.not_claimed': 'Puanlamadan önce incelemeyi üstlenin.',
  'reports.qa.error.calibration_exists': 'Bu ayın kalibrasyon turu zaten var.',
  'reports.qa.error.calibration_closed': 'Bu tur kapandı; puanları artık değişmez.',
  'reports.qa.error.conflict_of_interest':
    'Bu konuşmada siz de yer aldınız; onu başka biri inceler.',
  'reports.qa.error.outside_reach': 'Yalnız yönettiğiniz ekiplerin konuşmalarını incelersiniz.',
  'reports.qa.error.capability_required': 'Rolünüz bu çalışma alanında AI kalitesini incelemiyor.',
  'reports.qa.error.role_required': 'Bunu yalnız bir yönetici yapabilir.',
  'reports.qa.error.thread_open': 'Bu konuşma hâlâ açık — kapandıktan sonra gönderin.',
  'reports.qa.error.thread_no_ai': 'AI bu konuşmaya katılmadı.',
};
