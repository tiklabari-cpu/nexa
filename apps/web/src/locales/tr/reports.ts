import type { Messages } from '../merge.js';

/** Reports: every tab, KPI card, export and saved views. See the English file. */
export const reports: Messages = {
  // Page chrome
  'reports.page.title': 'Raporlar',
  'reports.page.description': 'Sohbet hacmi, yanıt verme hızı ve memnuniyet.',
  'reports.page.tabsAriaLabel': 'Rapor',

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

  // Custom range not yet chosen, or invalid
  'reports.emptyRange.title': 'Bir tarih aralığı seçin',
  'reports.emptyRange.description':
    'Bir başlangıç ve bitiş tarihi seçin. Bitiş tarihi başlangıçtan önce olamaz.',

  // Overview-only "Chat topics" promo banner (FR-MOD-07.6-f)
  'reports.topicsPromo.text': 'En popüler sohbet konuları tek yerde',
  'reports.topicsPromo.cta': 'Sohbet konularını gör',
  'reports.topicsPromo.dismiss': 'Sonra hatırlat',

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
  'reports.export.formatLabel': 'Dışa aktarma biçimi',
  'reports.export.csv': 'CSV',
  'reports.export.pdf': 'PDF',
  'reports.export.cta': 'Dışa aktar',
  'reports.export.pending': 'Dışa aktarılıyor…',

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
  'reports.overview.kpi.queuedNow': 'Şu anda sırada',
  'reports.overview.queue.waiting': 'Temsilci bekleniyor',
  'reports.overview.queue.empty': 'Bekleyen yok',
  'reports.overview.kpi.achievedGoals': 'Ulaşılan hedefler',
  'reports.overview.resolution.title': 'Çözüm',
  'reports.overview.resolution.description':
    'Kapanan sohbetlerin nasıl ele alındığı (PRD §7.3.2). Manuel, destekli ve otomatik, her kapanan vakanın toplamını oluşturur.',
  'reports.overview.chats.title': 'Sohbetler',
  'reports.overview.chats.description':
    'AI’nın sohbetleri ne kadar hızlı sonuçlandırdığı ve ne kadar sürdükleri (PRD §7.3.3).',
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
  'reports.aiAgent.resolution.title': 'AI çözümü',
  'reports.aiAgent.resolution.description':
    'AI Ajanının insan olmadan çözdüğü (ADR-09) — faturada yer alan rakamla aynı.',
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

  // Reviews (FR-MOD-07.8)
  'reports.reviews.error':
    'Değerlendirmeler raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.reviews.csat.title': 'Memnuniyet (CSAT)',
  'reports.reviews.csat.description':
    'Tüm değerlendirmelerin bir payı olarak olumlu oran (PRD §7.8). Kimse değerlendirmediyse boş, asla %0 değil.',
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
  'reports.reviews.byDay.description':
    'Aralıktaki her UTC günü için günlük değerlendirme hacmi, olumlu ve olumsuz.',
  'reports.reviews.byDay.emptyTitle': 'Bu aralıkta değerlendirme yok',
  'reports.reviews.byDay.emptyDescription':
    'Müşteriler sohbetleri değerlendirdikçe her günün değerlendirmeleri burada görünür.',
  'reports.reviews.byDay.caption': 'Güne göre değerlendirmeler, olumlu ve olumsuz olarak ayrılmış',
  'reports.reviews.byDay.ratingsColumn': 'Değerlendirmeler',
  'reports.reviews.byDay.goodColumn': 'Olumlu',
  'reports.reviews.byDay.badColumn': 'Olumsuz',
  'reports.reviews.ecommerce.title': 'E-ticaret',
  'reports.reviews.ecommerce.description':
    'Desteklenen sohbetlere atfedilen satışlar (PRD §7.8, izlenen satışlar §13.5).',
  'reports.reviews.ecommerce.emptyDescription':
    'Desteklenen sohbetlere gelir atfetmek için bir satış kaynağı bağlayın.',
  'reports.reviews.ecommerce.cta': 'Satış platformlarını yapılandır',

  // Breakdown (FR-MOD-07.5)
  'reports.breakdown.error':
    'Dağılım yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.breakdown.byDay.description':
    'Aralıktaki her UTC günü için çözüm dağılımı (PRD §7.3.2).',
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
    "Gözlenen hacim ve varlık kaydından, her UTC hafta günü ve saati için gereken ile planlanan temsilci sayısı (PRD §5.3). Açıklar kapatılması gereken farktır; yeterli geçmişi olmayan bir hücre asla tahmini bir sayı değil, her zaman '—' gösterir.",
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
    'Desteklenen sohbetlere gelir atfetmek için bir satış kaynağı bağlayın. Satış izleyici (FR-MOD-13.5) henüz kullanılamıyor.',

  // Team performance (FR-MOD-07.7, v2)
  'reports.teamPerformance.error':
    'Ekip performansı raporu yüklenemedi. API’ye erişilebildiğinden emin olun ve yeniden deneyin.',
  'reports.teamPerformance.description':
    'Aralık için temsilci başına sohbetler, çözüm dağılımı, ilk yanıt süresi ve CSAT.',
  'reports.teamPerformance.emptyTitle': 'Bu aralıkta temsilci etkinliği yok',
  'reports.teamPerformance.emptyDescription':
    'Sohbetler temsilcilere atandığında temsilci başına performansları burada görünür.',
  'reports.teamPerformance.caption':
    'Temsilci başına sohbetler, çözüm dağılımı, yanıt süresi ve CSAT',
  'reports.teamPerformance.avgFirstResponseColumn': 'Ort. ilk yanıt',
};
