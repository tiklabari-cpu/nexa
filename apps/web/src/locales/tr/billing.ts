import type { Messages } from '../merge.js';

/** Faturalandırma: plan ve koltuklar, sayaçlar, API paketleri, faturalar, ödeme yöntemi. See the English file. */
export const billing: Messages = {
  // Page shell — BillingPage.tsx
  'billing.page.title': 'Faturalandırma',
  'billing.page.loadError':
    'Faturalandırma yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'billing.page.description': '{period} dönemi için plan, kullanım ve ücretler.',
  'billing.page.providerNotice':
    'Ödeme sağlayıcısı: {provider}. Herhangi bir dış ücretlendirme yapılmaz — yukarıdaki kullanım rakamları ve hesaplamalar gerçektir.',

  // Read-only banner (trial expired)
  'billing.readOnly.title': 'Bu çalışma alanı salt okunur.',
  'billing.readOnly.description':
    'Deneme süresi sona erdi. Mevcut sohbetler okunabilir ve dışa aktarılabilir durumda kalır, hiçbir şey silinmedi — ama bir plan etkinleşene kadar yeni sohbet başlatılamaz.',

  // Trial status banner
  'billing.trial.daysLeft.one': 'Deneme sürenizden {count} gün kaldı',
  'billing.trial.daysLeft.other': 'Deneme sürenizden {count} gün kaldı',
  'billing.trial.notice': 'Deneme süresince hiçbir ücret alınmaz.',
  'billing.trial.noticeWithEnd':
    'Deneme süresince hiçbir ücret alınmaz; deneme {date} tarihinde sona erer.',

  // Plan section
  'billing.plan.title': 'Plan',
  'billing.plan.kpi.plan': 'Plan',
  'billing.plan.kpi.seats': 'Koltuk',
  'billing.plan.kpi.seatsHint': 'koltuk başına {price}',
  'billing.plan.kpi.estimatedTotal': 'Tahmini toplam',
  'billing.plan.kpi.estimatedTotalHintTrial': 'Deneme süresince ücret alınmaz',
  'billing.plan.kpi.estimatedTotalHintPeriod': 'Bu dönem',
  'billing.plan.kpi.status': 'Durum',

  // Manage plan — ManagePlan
  'billing.managePlan.title': 'Planı yönet',
  'billing.managePlan.description':
    'Faturalandırma sahte (mock) — hiçbir ücret alınmaz. Değişiklikler yaptığınız anda kaydedilir.',
  'billing.managePlan.cycleLabel': 'Faturalandırma dönemi',
  'billing.managePlan.monthly': 'Aylık',
  'billing.managePlan.annual': 'Yıllık',
  'billing.managePlan.annualSaveHint': '· yılda {amount} tasarruf',
  'billing.managePlan.seatsLabel': 'Koltuklar',
  'billing.managePlan.removeSeat': 'Bir koltuk çıkar',
  'billing.managePlan.addSeat': 'Bir koltuk ekle',
  'billing.managePlan.pricePerUser': 'kullanıcı başına aylık {price}',
  'billing.managePlan.minSeatsNotice':
    'En az {min} — aktif temsilcilerinizden daha az koltuk satın alamazsınız.',
  'billing.managePlan.billedNowPrefix': 'Şu an faturalandırılan tutar',
  'billing.managePlan.billedNowSuffix': 'deneme süresince.',
  'billing.managePlan.afterTrialPrefix': 'Deneme sonrasında:',
  'billing.managePlan.totalPrefix': 'Toplam:',
  'billing.managePlan.cycleUnit.month': 'ay',
  'billing.managePlan.cycleUnit.year': 'yıl',
  'billing.managePlan.annualSavingsNotice':
    'Aylık faturalandırmaya kıyasla yılda {amount} tasarruf ediyorsunuz.',

  // AI resolutions meter
  'billing.aiMeter.title': 'AI çözümleri',
  'billing.aiMeter.description': 'Bir insan hiç yanıt vermeden AI’nin kapattığı bir sohbet.',
  'billing.aiMeter.pastIncluded': 'Dahil olan AI çözümlerinizi aştınız',
  'billing.aiMeter.percentUsedWarning': 'AI çözümlerinizin %{percent}’ini kullandınız',
  'billing.aiMeter.overageDetail':
    'Bu dönem dahil olan {included} sınırının {overage} üzerindesiniz. Her ek çözüm {price} olarak faturalandırılır — faturada sürpriz olmaz.',
  'billing.aiMeter.usedDetail':
    '{included} sınırından {used} kullanıldı. Sınırın ötesinde her çözüm {price} olarak faturalandırılır.',
  'billing.aiMeter.percentUsed': '%{percent} kullanıldı',
  'billing.aiMeter.overAllowance': 'Dahil olan sınırın üzerinde',
  'billing.aiMeter.nearingLimit': 'Sınıra yaklaşılıyor',
  'billing.aiMeter.quotaBarAriaLabel': 'Kullanılan dahil AI çözümleri',
  'billing.aiMeter.overageNotice': 'Dahil olan sınırın {overage} üzerinde — bu dönem {amount}.',
  'billing.aiMeter.overagePackageTitle': 'Aşım paketi',
  'billing.aiMeter.overagePackageDetail':
    'Dahil olan {included} sınırının ötesinde, AI çözümleri her biri {price} olarak faturalandırılır — {unit}’lik paketler halinde satılır (paket başına {packPrice}).',
  'billing.aiMeter.periodLabel': 'Bu dönem',

  // API calls
  'billing.apiCalls.title': 'API çağrıları',
  'billing.apiCalls.description':
    'Entegrasyonlarınızın kişisel erişim belirteciyle yaptığı, çağrı başına ölçülen istekler.',
  'billing.apiCalls.used': 'Kullanılan',
  'billing.apiCalls.usedHint': 'dahil olan {included} üzerinden',
  'billing.apiCalls.included': 'Dahil',
  'billing.apiCalls.overage': 'Aşım',
  'billing.apiCalls.overageCharge': 'Aşım ücreti',
  'billing.apiCalls.overageChargeHint': 'bu dönem',
  'billing.apiCalls.overageTerms':
    'Dahil olan {included} sınırının ötesinde, API çağrıları her {unit} için {price} olarak faturalandırılır — blok başına ücretlendirilir.',

  // API packages — ApiPackagesSection, ApiPackageCard
  'billing.apiPackages.title': 'API paketleri',
  'billing.apiPackages.description':
    'Planınızın dahil API çağrılarının üzerine tek seferlik takviyeler. Faturalandırma sahte (ADR-13) — bir paket satın almak hiçbir kart ücretlendirmez.',
  'billing.apiPackages.loadError': 'API paket kataloğu yüklenemedi.',
  'billing.apiPackages.buyErrorTitle': 'Paket satın alınamadı.',
  'billing.apiPackages.buyErrorDescription':
    'Satın alma işlemi gerçekleşmedi — kotanız değişmedi. Tekrar deneyin.',
  'billing.apiPackages.empty': 'Şu anda satın alınabilecek API paketi yok.',
  'billing.apiPackages.callsUnit': 'çağrı',
  'billing.apiPackages.buyAriaLabel': '{name} satın al',
  'billing.apiPackages.buy': 'Satın al',
  'billing.apiPackages.confirmAriaLabel': '{name} satın almayı onayla',
  'billing.apiPackages.confirmPurchase': 'Satın almayı onayla',
  'billing.apiPackages.buying': 'Satın alınıyor…',
  'billing.apiPackages.cancel': 'Vazgeç',
  'billing.apiPackages.confirmPrompt':
    '{name} paketi {price} karşılığında satın alınsın mı? Hiçbir kart ücretlendirilmez (sahte faturalandırma).',

  // Purchase history — ApiPackagePurchasesSection
  'billing.purchaseHistory.title': 'Satın alma geçmişi',
  'billing.purchaseHistory.description':
    'Bu çalışma alanının satın aldığı tüm API paketleri, en yeniden eskiye.',
  'billing.purchaseHistory.loadError': 'Satın alma geçmişi yüklenemedi.',
  'billing.purchaseHistory.empty':
    'Henüz bir API paketi satın almadınız — bu dönemin kotasını artırmak için yukarıdan bir tane satın alın.',
  'billing.purchaseHistory.table.date': 'Tarih',
  'billing.purchaseHistory.table.package': 'Paket',
  'billing.purchaseHistory.table.quota': 'Kota',
  'billing.purchaseHistory.table.amount': 'Tutar',

  // Payment method — PaymentMethodSection, PaymentMethodForm
  'billing.paymentMethod.title': 'Ödeme yöntemi',
  'billing.paymentMethod.description':
    'Faturalandırma sahte — hiçbir kart ücretlendirilmez ve tam kart numarası toplanmaz.',
  'billing.paymentMethod.loadError': 'Ödeme yöntemi yüklenemedi.',
  'billing.paymentMethod.empty': 'Henüz kayıtlı bir ödeme yöntemi yok.',
  'billing.paymentMethod.ending': '{last4} ile biten',
  'billing.paymentMethod.expires': '· son kullanma {date}',
  'billing.paymentMethod.addButton': 'Ödeme yöntemi ekle',
  'billing.paymentMethod.updateButton': 'Ödeme yöntemini güncelle',
  'billing.paymentMethod.readOnlyNotice':
    'Çalışma alanı salt okunurken bile ödeme yönteminizi güncelleyebilirsiniz.',
  'billing.paymentMethod.form.brandLabel': 'Kart markası',
  'billing.paymentMethod.form.last4Label': 'Son 4 hane',
  'billing.paymentMethod.form.last4Placeholder': '4242',
  'billing.paymentMethod.form.expiryLabel': 'Son kullanma tarihi',
  'billing.paymentMethod.form.expiryMonthLabel': 'Son kullanma ayı',
  'billing.paymentMethod.form.expiryYearLabel': 'Son kullanma yılı',
  'billing.paymentMethod.form.holderLabel': 'Kart sahibinin adı',
  'billing.paymentMethod.form.holderPlaceholder': 'Ayşe Yılmaz',
  'billing.paymentMethod.form.saveError': 'Ödeme yöntemi kaydedilemedi. Bilgileri kontrol edin.',
  'billing.paymentMethod.form.stripeNotice':
    'Gerçek bir Stripe kart bileşeni burada yer alırdı. Yalnızca maskelenmiş bilgiler saklanır.',
  'billing.paymentMethod.form.save': 'Kaydet',
  'billing.paymentMethod.form.saving': 'Kaydediliyor…',
  'billing.paymentMethod.form.cancel': 'İptal',

  // Invoices — InvoicesSection
  'billing.invoices.title': 'Faturalar',
  'billing.invoices.loadingDescription': 'Faturalandırma dökümleriniz.',
  'billing.invoices.description': 'Faturalandırma dökümleriniz, en yeniden eskiye.',
  'billing.invoices.loadError': 'Faturalar yüklenemedi.',
  'billing.invoices.table.invoice': 'Fatura',
  'billing.invoices.table.issued': 'Kesildi',
  'billing.invoices.table.status': 'Durum',
  'billing.invoices.table.amount': 'Tutar',
  'billing.invoices.table.download': 'İndir',
  'billing.invoices.downloadAriaLabel': '{number} faturasını indir',
  'billing.invoices.downloading': 'İndiriliyor…',
  'billing.invoices.status.paid': 'Ödendi',
  'billing.invoices.status.open': 'Açık',
  'billing.invoices.status.trial': 'Deneme',
};
