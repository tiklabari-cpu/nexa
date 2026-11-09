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

  // Faturayı yalnız Kurucu değiştirir (K7)
  'billing.ownerOnly.title': 'Faturalandırmayı yalnız Kurucu değiştirebilir.',
  'billing.ownerOnly.description':
    'Planı, kullanımı, faturaları ve ödeme yöntemini görebilirsiniz. Planı, koltukları ya da ödeme yöntemini değiştirmek ve paket satın almak Kurucu’ya aittir.',

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
  'billing.plan.name.growth': 'Growth',
  'billing.plan.name.enterprise': 'Enterprise',
  'billing.plan.cycle.monthly': 'Aylık',
  'billing.plan.cycle.annual': 'Yıllık',
  'billing.plan.statusValue.trialing': 'Deneme',
  'billing.plan.statusValue.active': 'Etkin',
  'billing.plan.statusValue.past_due': 'Gecikmiş',
  'billing.plan.statusValue.canceled': 'İptal edildi',
  'billing.plan.statusValue.suspended': 'Askıya alındı',
  'billing.provider.mock': 'Demo faturalama',

  // Manage plan — ManagePlan
  'billing.managePlan.title': 'Planı yönet',
  'billing.managePlan.description':
    'Faturalandırma sahte (mock) — hiçbir ücret alınmaz. Değişiklikler yaptığınız anda kaydedilir.',

  // Plan tier — PlanSelector
  'billing.managePlan.plan.label': 'Plan katmanı',
  'billing.managePlan.plan.loading': 'Planlar yükleniyor…',
  'billing.managePlan.plan.loadError': 'Plan kataloğu yüklenemedi.',
  'billing.managePlan.plan.genericError': 'Plan değiştirilemedi. Tekrar deneyin.',
  // The server's refusals of a plan change, by their stable `details.reason`
  // (lib/reason-message.ts, tm 259.18).
  'billing.reason.plan_below_usage':
    '{plan} planı {included} AI çözümü içeriyor — bu ay kullanılan {used} çözümün altında.',
  'billing.reason.seats_below_active':
    'Koltuk sayısı, bu çalışma alanındaki {active_agents} etkin temsilcinin altında olamaz.',
  'billing.reason.plan_unknown': 'Bu plan kullanılamıyor.',
  'billing.reason.plan_requires_sales':
    '{plan} planı satış ekibimizle düzenlenir ve buradan seçilemez.',
  'billing.reason.cycle_unknown': 'Bu faturalama dönemi kullanılamıyor.',
  'billing.managePlan.plan.overQuotaReason':
    '{plan} planı {included} AI çözümü içeriyor — bu dönem kullanılan {used} çözümün altında.',
  'billing.managePlan.plan.confirmListed':
    '{plan} planına {price} / {cycle} karşılığında geçilsin mi? Bu değişiklik hemen geçerli olur.',
  // A quoted tier is not sold here (tm 432): the picker points to sales.
  'billing.managePlan.plan.contactSalesTag': 'Satışla görüşün',
  'billing.managePlan.plan.contactSales':
    '{plan} planı satış ekibimizle düzenlenir: fiyatı ve koşulları bir sözleşmede belirlenir, bu yüzden buradan açılamaz.',
  'billing.managePlan.plan.contactSalesEmail': 'Düzenlemek için {email} adresine yazın.',
  'billing.managePlan.plan.contactSalesNoEmail':
    'Düzenlemek için bu hizmeti işleten ekibe başvurun.',
  'billing.managePlan.plan.closeButton': 'Kapat',
  'billing.managePlan.plan.confirmButton': 'Plan değişikliğini onayla',
  'billing.managePlan.plan.confirming': 'Geçiliyor…',
  'billing.managePlan.plan.cancelButton': 'Vazgeç',

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
  // Buying overage packs — BuyOveragePacks (FR-MOD-10.1.4)
  'billing.aiMeter.buyPacksLabel': 'Aşım paketi satın al',
  'billing.aiMeter.removePack': 'Bir paket azalt',
  'billing.aiMeter.addPack': 'Bir paket artır',
  'billing.aiMeter.packTotal': '{amount} karşılığında {resolutions} çözüm',
  'billing.aiMeter.buyPacks': 'Paketleri satın al',
  'billing.aiMeter.buying': 'Satın alınıyor…',
  'billing.aiMeter.buyPacksNotice':
    'Bu dönemin sınırına anında eklenir ve bu dönemin faturasında ayrı bir kalem olarak görünür. Karttan çekim yapılmaz (sahte faturalama).',
  'billing.aiMeter.bought': 'Satın alındı — bu döneme {resolutions} çözüm eklendi.',
  'billing.aiMeter.buyErrorTitle': 'Paketler satın alınamadı.',
  'billing.aiMeter.buyErrorDescription':
    'Satın alma gerçekleşmedi — sınırınız değişmedi. Yeniden deneyin.',
  'billing.aiMeter.packTermsError':
    'Aşım paketi koşulları yüklenemedi — satın alma kullanılamıyor.',

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
    'Planınızın dahil API çağrılarının üzerine tek seferlik takviyeler. Faturalandırma sahte — bir paket satın almak hiçbir kart ücretlendirmez.',
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
  'billing.paymentMethod.form.last4Error': 'Son 4 haneyi girin — tam olarak 4 rakam.',
  'billing.paymentMethod.form.expiryLabel': 'Son kullanma tarihi',
  'billing.paymentMethod.form.expiryMonthLabel': 'Son kullanma ayı',
  'billing.paymentMethod.form.expiryYearLabel': 'Son kullanma yılı',
  'billing.paymentMethod.form.holderLabel': 'Kart sahibinin adı',
  'billing.paymentMethod.form.holderPlaceholder': 'Ayşe Yılmaz',
  'billing.paymentMethod.form.holderRequiredError': 'Kart sahibinin adını girin.',
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
  'billing.invoices.downloadError': '{number} numaralı fatura indirilemedi.',
  'billing.invoices.table.invoice': 'Fatura',
  'billing.invoices.table.issued': 'Kesildi',
  'billing.invoices.table.status': 'Durum',
  'billing.invoices.table.amount': 'Tutar',
  'billing.invoices.table.download': 'İndir',
  'billing.invoices.downloadAriaLabel': '{number} faturasını indir',
  'billing.invoices.downloading': 'İndiriliyor…',
  'billing.invoices.downloadPdf': 'PDF',
  'billing.invoices.downloadPdfAriaLabel': '{number} faturasını PDF olarak indir',
  'billing.profile.title': 'Fatura bilgileri',
  'billing.profile.description': 'Faturalarınızda yazan şirket ünvanı, adres ve vergi numaraları.',
  'billing.profile.loadError': 'Fatura bilgileri yüklenemedi.',
  'billing.profile.saveError': 'Fatura bilgileri kaydedilemedi. Yeniden deneyin.',
  'billing.profile.missing.title': 'Fatura bilgileri girilmedi',
  'billing.profile.missing.owner':
    'Şirket bilgilerinizi ekleyene kadar faturalar çalışma alanı adıyla kesilir.',
  'billing.profile.missing.reader':
    'Kurucu şirket bilgilerini ekleyene kadar faturalar çalışma alanı adıyla kesilir.',
  'billing.profile.addButton': 'Fatura bilgilerini ekle',
  'billing.profile.editButton': 'Fatura bilgilerini düzenle',
  'billing.profile.summary.address': 'Adres',
  'billing.profile.field.legalName': 'Ünvan',
  'billing.profile.field.addressLine1': 'Adres',
  'billing.profile.field.addressLine2': 'Adres 2. satır (isteğe bağlı)',
  'billing.profile.field.city': 'Şehir',
  'billing.profile.field.postalCode': 'Posta kodu (isteğe bağlı)',
  'billing.profile.field.country': 'Ülke',
  'billing.profile.field.taxOffice': 'Vergi dairesi (isteğe bağlı)',
  'billing.profile.field.taxId': 'Vergi numarası',
  'billing.profile.field.vatId': 'KDV numarası (isteğe bağlı)',
  'billing.profile.field.invoiceEmail': 'Fatura e-postası (isteğe bağlı)',
  'billing.profile.form.snapshotNotice':
    'Kaydedilen bilgiler bir sonraki faturada yer alır. Kesilmiş faturalar kesildikleri bilgilerle kalır.',
  'billing.profile.form.chooseCountry': 'Ülke seçin',
  'billing.profile.form.taxIdHint':
    'Türkiye için zorunlu: 10 haneli vergi numarası ya da 11 haneli T.C. kimlik numarası.',
  'billing.profile.form.vatIdHint': 'İki harfli ülke koduyla başlar, ör. DE123456789.',
  'billing.profile.form.save': 'Bilgileri kaydet',
  'billing.profile.form.saving': 'Kaydediliyor…',
  'billing.profile.form.cancel': 'Vazgeç',
  'billing.profile.error.required': 'Zorunlu.',
  'billing.profile.error.tooLong': 'En fazla {max} karakter.',
  'billing.profile.error.invalid': 'Bu değer kabul edilmiyor.',
  'billing.profile.error.country': 'Bir ülke seçin.',
  'billing.profile.error.taxIdInvalid':
    'Bu ülke için geçerli bir vergi numarası değil. Türkiye: 10 hane ya da 11 haneli T.C. kimlik numarası.',
  'billing.profile.error.taxIdRequired': 'Türkiye’deki bir şirket için vergi numarası gerekli.',
  'billing.profile.error.vatId': 'KDV numarası iki harfli ülke koduyla başlar.',
  'billing.profile.error.email': 'Bir e-posta adresi girin.',
  'billing.invoices.status.paid': 'Ödendi',
  'billing.invoices.status.open': 'Açık',
  'billing.invoices.status.trial': 'Deneme',
  'billing.invoices.origin.estimate': 'Tahmin',
  'billing.invoices.origin.estimateHint':
    'Bu dönem hâlâ sürüyor, rakamlar kullanımla değişir. Ay kapandığında döküme dönüşür.',
  'billing.invoices.origin.reconstructed': 'Yeniden oluşturuldu',
  'billing.invoices.origin.reconstructedHint':
    'Dönem kapandıktan sonra donduruldu. Sayaç satırları ve satın alımlar kendi fiyatlarını taşır, birebir doğrudur; koltuk ücreti bu satır yazılırkenki abonelikten fiyatlanmıştır.',

  // Ödeme — PaymentMethods.tsx (tm 382)
  'billing.payments.title': 'Aboneliğinizi ödeyin',
  'billing.payments.description':
    'Bir sonraki dönemi nasıl ödeyeceğinizi seçin. Tutar hangi yolla öderseniz ödeyin aynıdır.',
  'billing.payments.loadError': 'Ödeme seçenekleri yüklenemedi.',
  'billing.payments.amountDue':
    '{cycle} bir dönem için ödenecek tutar: {amount} (koltuk: {seats}).',
  'billing.payments.quoted': 'Planınız sözleşmesine göre faturalanır; burada ödenecek bir şey yok.',
  'billing.payments.paidThrough': '{date} tarihine kadar ödendi.',
  'billing.payments.noMethods':
    'Şu anda kullanılabilir bir ödeme yolu yok. SiyahTuş destek ekibiyle iletişime geçin.',
  'billing.payments.tablistLabel': 'Nasıl ödenir',
  'billing.payments.method.swift_manual': 'Banka havalesi',
  'billing.payments.method.crypto_manual': 'Kripto (USDT)',
  'billing.payments.method.stripe': 'Kart',
  'billing.payments.cycle.monthly': 'Aylık',
  'billing.payments.cycle.annual': 'Yıllık',
  'billing.payments.swift.beneficiary': 'Alıcı',
  'billing.payments.swift.bank': 'Banka',
  'billing.payments.swift.iban': 'IBAN',
  'billing.payments.swift.bic': 'SWIFT/BIC',
  'billing.payments.swift.address': 'Banka adresi',
  'billing.payments.swift.noBank':
    'Banka bilgileri henüz girilmedi; SiyahTuş ekibi bunları referansınızla birlikte gönderecek.',
  'billing.payments.swift.referenceLabel': 'Havale referansı',
  'billing.payments.swift.instructions':
    '{amount} gönderin ve bu referansı açıklamaya yazın. Havale ulaştığında SiyahTuş ekibi ödendi olarak işaretler; aboneliğiniz o andan itibaren etkindir.',
  'billing.payments.swift.issueButton': 'Havale referansı al',
  'billing.payments.swift.issuing': 'Referans alınıyor…',
  'billing.payments.crypto.loadError': 'Kripto ödeme talepleriniz yüklenemedi.',
  'billing.payments.crypto.status.requested': 'Adres istendi',
  'billing.payments.crypto.status.address_sent': 'Adres gönderildi',
  'billing.payments.crypto.status.paid': 'Ödendi',
  'billing.payments.crypto.status.rejected': 'Reddedildi',
  'billing.payments.crypto.status.canceled': 'Geri çekildi',
  'billing.payments.crypto.network.usdt_trc20': 'TRON üzerinde USDT (TRC-20)',
  'billing.payments.crypto.network.usdt_erc20': 'Ethereum üzerinde USDT (ERC-20)',
  'billing.payments.crypto.waitingForAddress':
    'SiyahTuş ekibi cüzdan adresini buraya gönderecek. Adres kendiliğinden gösterilmez.',
  'billing.payments.crypto.sendExactly':
    'Bu adrese {network} ağında tam olarak {amount} gönderin, ardından işlem kimliğini girin.',
  'billing.payments.crypto.txidSubmitted': '{txid} işlemi gönderildi; SiyahTuş ekibi doğruluyor.',
  'billing.payments.crypto.txidLabel': 'İşlem kimliği (TXID)',
  'billing.payments.crypto.submitTxid': 'İşlem kimliğini gönder',
  'billing.payments.crypto.replaceTxid': 'İşlem kimliğini değiştir',
  'billing.payments.crypto.withdraw': 'Talebi geri çek',
  'billing.payments.crypto.formLabel': 'Kripto adresi isteyin',
  'billing.payments.crypto.intro':
    '{amount} ödeyin. Bir cüzdan adresi isteyin, SiyahTuş ekibi bu talep için bir adres göndersin; adres kendiliğinden gösterilmez.',
  'billing.payments.crypto.networkLabel': 'Ağ',
  'billing.payments.crypto.billingNameLabel': 'Fatura adı',
  'billing.payments.crypto.billingDetailsLabel': 'Fatura bilgileri (adres, vergi numarası)',
  'billing.payments.crypto.requestButton': 'Adres isteyin',
  'billing.payments.crypto.noRequest': 'Kripto ödeme talebi yok.',
  'billing.payments.crypto.rejectedTitle': 'Son kripto talebiniz reddedildi.',
  'billing.payments.crypto.rejectedSource': 'SiyahTuş ekibinin gerekçesi',
  'billing.payments.crypto.rejectedRetry': 'Aşağıdan yeniden adres talep edebilirsiniz.',
  'billing.payments.card.intro':
    '{amount} tutarını kart işlemcisinin güvenli sayfasında ödeyin. Kartınız yenilemeler için orada saklanır; SiyahTuş kart numaranızı hiç görmez.',
  'billing.payments.card.payButton': 'Kartla öde',
  'billing.payments.card.redirecting': 'Ödeme sayfası açılıyor…',
  'billing.payments.band.pastDueTitle': 'Ödemeniz gerçekleşmedi',
  'billing.payments.band.pastDueBody':
    'Kartınızı {retry} tarihinde yeniden deneyeceğiz. Yine olmazsa çalışma alanı {readOnly} tarihinde salt okunur olur. Aşağıdan başka bir yolla ödeyebilirsiniz.',
  'billing.payments.band.noRetry': 'son deneme',
  'billing.payments.band.failedTitle': 'Son ödemeniz gerçekleşmedi',
  'billing.payments.band.failedBody':
    '{reference} ödemesi başarısız oldu. Yeniden deneyin ya da aşağıdan başka bir ödeme yolu seçin.',
  'billing.payments.band.returnedSuccessTitle': 'Ödeme alındı',
  'billing.payments.band.returnedSuccessBody':
    'Kart ödemeniz doğrulanıyor. İşlemci onayladığında bu sayfada görünür.',
  'billing.payments.band.returnedCanceled': 'Kart ödemesi iptal edildi. Hiçbir ücret alınmadı.',
  'billing.payments.errors.method_unavailable': 'Bu ödeme yolu kullanılamıyor.',
  'billing.payments.errors.quoted_plan': 'Planınız sözleşmesine göre faturalanır.',
  'billing.payments.errors.request_open': 'Açık bir kripto talebi zaten var.',
  'billing.payments.errors.reference_issued':
    'Az önce bir referans verildi; görmek için sayfayı yenileyin.',
  'billing.payments.errors.txid_invalid': 'Bu, bu ağda bir işlem kimliği değil.',
  'billing.payments.errors.txid_used': 'Bu işlem kimliği daha önce gönderildi.',
  'billing.payments.errors.not_awaiting_txid': 'Bu talep bir işlem kimliği beklemiyor.',
  'billing.payments.errors.not_cancellable': 'Bu talep zaten kapandı.',
  'billing.payments.errors.payment_provider_unavailable':
    'Kart işlemcisine ulaşılamadı. Tekrar deneyin.',
  'billing.payments.history.title': 'Ödeme geçmişi',
  'billing.payments.history.loadError': 'Ödeme geçmişi yüklenemedi.',
  'billing.payments.history.empty': 'Henüz ödeme yok.',
  'billing.payments.history.date': 'Tarih',
  'billing.payments.history.method': 'Yöntem',
  'billing.payments.history.reference': 'Referans',
  'billing.payments.history.status': 'Sonuç',
  'billing.payments.history.amount': 'Tutar',
  'billing.payments.history.statusValue.pending': 'Bekliyor',
  'billing.payments.history.statusValue.succeeded': 'Başarılı',
  'billing.payments.history.statusValue.failed': 'Başarısız',
  'billing.payments.history.statusValue.canceled': 'Tamamlanmadı',
  'billing.payments.history.statusValue.disputed': 'İtiraz edildi',
  'billing.payments.history.term': '{from} – {to} dönemini kapsar',

  // Aboneliği iptal etme — CancelSubscription.tsx (tm 384)
  'billing.cancel.title': 'Aboneliği iptal et',
  'billing.cancel.description':
    'Abonelik içinde bulunulan dönemin sonunda biter. O zamana kadar her şey çalışmaya devam eder.',
  'billing.cancel.open': 'Aboneliği iptal et',
  'billing.cancel.scheduled':
    'Abonelik {date} tarihinde sona erecek. O zamana kadar her şey çalışmaya devam eder.',
  'billing.cancel.resume': 'İptali geri al',
  'billing.cancel.ended.title': 'Abonelik sona erdi',
  'billing.cancel.ended.exportUntil':
    'Çalışma alanı salt okunur. Verileri {date} tarihine kadar okuyabilir ve dışa aktarabilirsiniz; bu tarihten sonra giriş yapılamaz.',
  'billing.cancel.ended.deletionAt':
    'Veriler, çalışma alanının saklama ayarına göre {date} tarihinde silinir.',
  'billing.cancel.ended.kept':
    'Çalışma alanının saklama ayarı "sınırsız" olduğu için veriler kendiliğinden silinmez.',
  'billing.cancel.ended.exportReports': 'Raporları dışa aktar',
  'billing.cancel.ended.exportArchive': 'Konuşmaları arşivden indir',
  'billing.cancel.dialog.title': 'Abonelik iptal edilsin mi?',
  'billing.cancel.dialog.reason': 'Neden iptal ediyorsunuz?',
  'billing.cancel.dialog.consequences': 'Bundan sonra ne olur',
  'billing.cancel.dialog.untilPeriodEnd':
    'İçinde bulunulan dönemin sonuna kadar her şey çalışmaya devam eder.',
  'billing.cancel.dialog.readOnly': 'Dönem bitince çalışma alanı salt okunur olur.',
  'billing.cancel.dialog.export':
    'Bundan sonraki 30 gün boyunca verileri okuyabilir ve dışa aktarabilirsiniz.',
  'billing.cancel.dialog.deletion':
    'Ardından veriler çalışma alanının saklama ayarına göre silinir (daha uzun saklama seçtiyseniz daha sonra).',
  'billing.cancel.dialog.noRefund': 'Dönemin kalan kısmı için iade yapılmaz.',
  'billing.cancel.dialog.confirm': 'Onaylamak için {name} yazın',
  'billing.cancel.dialog.keep': 'Aboneliği koru',
  'billing.cancel.dialog.submit': 'Dönem sonunda iptal et',
  'billing.cancel.reason.too_expensive': 'Fiyatı yüksek',
  'billing.cancel.reason.missing_features': 'İhtiyacımız olan bir özellik eksik',
  'billing.cancel.reason.switching_provider': 'Başka bir ürüne geçiyoruz',
  'billing.cancel.reason.not_using': 'Yeterince kullanmıyoruz',
  'billing.cancel.reason.business_closed': 'İşimizi kapatıyoruz ya da ara veriyoruz',
  'billing.cancel.reason.other': 'Başka bir neden',
  'billing.cancel.error.confirmation': 'Yazılan ad çalışma alanının adıyla eşleşmiyor.',
  'billing.cancel.error.ended':
    'Abonelik zaten sona erdi. Yeniden abone olmak yeni bir satın almadır.',
  'billing.cancel.error.noSubscription': 'Bu çalışma alanının iptal edilecek aboneliği yok.',
  'billing.cancel.error.generic': 'Değişiklik kaydedilemedi. Yeniden deneyin.',
};
