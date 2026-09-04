import type { Messages } from '../merge.js';

/**
 * Sign-in and the public pages (sign up, forgot/reset, join, OAuth callback,
 * first-run onboarding). See `locales/en/auth.ts` for the key layout notes.
 */
export const auth: Messages = {
  // Shared field labels
  'auth.fields.email': 'E-posta',
  'auth.fields.password': 'Parola',
  'auth.fields.newPassword': 'Yeni parola',
  'auth.fields.choosePassword': 'Bir parola seçin',
  'auth.fields.workspaceName': 'Çalışma alanı adı',
  'auth.fields.yourName': 'Adınız',
  'auth.fields.dataRegion': 'Veri bölgesi',
  'auth.fields.twoFactorCode': 'Doğrulama kodu',
  'auth.fields.recoveryCode': 'Kurtarma kodu',

  // Shared validation messages
  'auth.validation.emailRequired': 'E-posta adresinizi girin.',
  'auth.validation.emailInvalid': 'Geçerli bir e-posta adresi girin.',
  'auth.validation.passwordRequired': 'Parolanızı girin.',
  'auth.validation.nameRequired': 'Adınızı girin.',
  'auth.validation.organizationRequired': 'Bir çalışma alanı adı girin.',
  'auth.validation.passwordMinLength': 'En az {count} karakter kullanın.',
  'auth.validation.codeRequired': 'Kodunuzu girin.',

  // Sign in
  'auth.signin.subtitle': 'Çalışma alanınızda oturum açın',
  'auth.signin.submit': 'Oturum aç',
  'auth.signin.submitting': 'Oturum açılıyor…',
  'auth.signin.forgotPassword': 'Parolanızı mı unuttunuz?',
  'auth.signin.newHere': 'İlk kez mi buradasınız?',
  'auth.signin.createWorkspace': 'Çalışma alanı oluştur',
  'auth.signin.demoCredentials': 'Demo: owner@acme.localhost / nexa-demo-password',
  'auth.signin.ssoRequired':
    'Bu çalışma alanı tek oturum açmayı (SSO) zorunlu kılıyor. Kimlik sağlayıcınızdaki Nexa kutucuğundan devam edin.',
  'auth.signin.ssoLinkFailed': 'Bu bağlantı için tek oturum açma başlatılamadı.',
  'auth.signin.ssoStartFailed': 'Tek oturum açma başlatılamadı.',
  'auth.signin.ssoRedirecting': 'Kimlik sağlayıcınıza yönlendiriliyorsunuz…',
  'auth.signin.noWorkspaces': 'Bu hesap hiçbir çalışma alanının üyesi değil.',
  'auth.signin.invalidCredentials': 'E-posta veya parola hatalı.',
  'auth.signin.workspaceOpenFailed': 'O çalışma alanı açılamadı.',
  'auth.signin.chooseWorkspace': 'Bir çalışma alanı seçin',
  'auth.signin.ssoRequiredBadge': 'SSO gerekli',
  'auth.signin.codeTitle': 'Kodunuzu girin',
  'auth.signin.codeSubtitle':
    '{organization} oturum açmayı tamamlamak için kimlik doğrulama uygulamanızdan bir kod istiyor.',
  'auth.signin.codeInvalid': 'Bu kod doğru değil. Tekrar deneyin.',
  'auth.signin.codeRateLimited': 'Çok fazla deneme yapıldı. Tekrar denemeden önce bekleyin.',
  'auth.signin.verify': 'Doğrula',
  'auth.signin.verifying': 'Doğrulanıyor…',
  'auth.signin.useRecoveryCode': 'Bunun yerine kurtarma kodu kullan',
  'auth.signin.useAuthenticatorCode': 'Bunun yerine kimlik doğrulama uygulamanızı kullanın',
  'auth.signin.enrollmentRequiredTitle': 'İki adımlı doğrulamayı kurun',
  'auth.signin.enrollmentRequiredBody':
    '{organization} iki adımlı doğrulama gerektiriyor ve bu hesapta henüz kurulu değil. Zaten oturum açık olduğunuz bir çalışma alanından hesap ayarlarında kurulum yapın, sonra buraya dönün.',
  'auth.signin.enrollmentRequiredHere':
    '{organization} iki adımlı doğrulama gerektiriyor ve bu hesapta henüz kurulu değil. Kurulumu buradan yapabilirsiniz — yaklaşık bir dakika sürer ve kimlik doğrulama uygulamanız gerekir.',
  'auth.signin.enrollmentRequiredLink': 'Hesap ayarlarına git',
  'auth.signin.enroll.startButton': 'Şimdi kur',
  'auth.signin.enroll.starting': 'Başlatılıyor…',
  'auth.signin.enroll.failed': 'Kurulum başlatılamadı. Geri dönüp tekrar oturum açın.',
  'auth.signin.enroll.expired':
    'Bu kurulum denemesinin süresi doldu. Geri dönüp tekrar oturum açın.',
  'auth.signin.enroll.scanBody':
    'Bu kurulum anahtarını kimlik doğrulama uygulamanıza ekleyin, sonra gösterdiği kodu yazın.',
  'auth.signin.enroll.secretLabel': 'Kurulum anahtarı',
  'auth.signin.enroll.uriLabel': 'Kurulum bağlantısı',
  'auth.signin.enroll.copy': 'Kopyala',
  'auth.signin.enroll.copied': 'Kopyalandı',
  'auth.signin.enroll.copySecretAriaLabel': 'Kurulum anahtarını kopyala',
  'auth.signin.enroll.copyUriAriaLabel': 'Kurulum bağlantısını kopyala',
  'auth.signin.enroll.codeLabel': 'Doğrulama kodu',
  'auth.signin.enroll.codeRequired': 'Kimlik doğrulama uygulamanızın gösterdiği kodu girin.',
  'auth.signin.enroll.codeInvalid': 'Bu kod doğru değil. Tekrar deneyin.',
  'auth.signin.enroll.activateButton': 'Doğrula ve etkinleştir',
  'auth.signin.enroll.activating': 'Doğrulanıyor…',
  'auth.signin.enroll.recoveryBody':
    'Kimlik doğrulama uygulamanızı kaybederseniz bu kodların her biri sizi bir kez içeri alır. Yalnızca bu sefer gösterilirler.',
  'auth.signin.enroll.downloadButton': '.txt indir',
  'auth.signin.enroll.savedConfirm': 'Bu kodları güvenli bir yere kaydettim.',
  'auth.signin.enroll.continueButton': 'Oturum açmaya devam et',

  // Sign up
  'auth.signup.title': 'Çalışma alanı oluştur',
  'auth.signup.subtitle': '14 gün ücretsiz. Kart gerekmez.',
  'auth.signup.alreadyHaveAccount': 'Zaten bir hesabınız var mı?',
  'auth.signup.signIn': 'Oturum aç',
  'auth.signup.passwordHint': 'En az {count} karakter. Tek kural uzunluktur.',
  'auth.signup.regionWarning':
    'Çalışma alanınızın verileri burada barınacak. Çalışma alanınız oluşturulduktan sonra değiştirilemez.',
  'auth.signup.submit': 'Çalışma alanı oluştur',
  'auth.signup.submitting': 'Oluşturuluyor…',
  'auth.signup.errorGeneric': 'O çalışma alanı oluşturulamadı.',
  'auth.signup.errorAccountExists':
    'Bu e-posta için zaten bir hesap var — bunun yerine oturum açın.',
  'auth.signup.errorRegionMismatch':
    'Hiçbir şey oluşturulmadı. Bu adres yalnızca {region} bölgesinde çalışma alanı oluşturur — o veri bölgesini seçin veya seçtiğiniz bölgeye hizmet veren adresten kaydolun.',
  'auth.signup.errorRegionUnknown':
    'Hiçbir şey oluşturulmadı. Bu adres, seçtiğiniz veri bölgesinde çalışma alanı oluşturmuyor.',
  'auth.signup.region.eu': 'Avrupa Birliği',
  'auth.signup.region.us': 'Amerika Birleşik Devletleri',

  // Forgot password
  'auth.forgotPassword.title': 'Parolanızı sıfırlayın',
  'auth.forgotPassword.subtitle': 'Size bir bağlantı göndereceğiz.',
  'auth.forgotPassword.sent':
    'O adres için bir hesap varsa bir bağlantı gönderdik. Bir saat içinde geçerliliğini yitirir.',
  'auth.forgotPassword.submit': 'Bağlantı gönder',
  'auth.forgotPassword.submitting': 'Gönderiliyor…',

  // Reset password
  'auth.resetPassword.title': 'Yeni bir parola seçin',
  'auth.resetPassword.subtitle': 'Bağlantı yalnızca bir kez çalışır.',
  'auth.resetPassword.done':
    'Parolanız ayarlandı ve diğer tüm oturumlarınız kapatıldı. Şimdi oturum açabilirsiniz.',
  'auth.resetPassword.hint': 'En az {count} karakter.',
  'auth.resetPassword.submit': 'Parolayı ayarla',
  'auth.resetPassword.submitting': 'Kaydediliyor…',
  'auth.resetPassword.errorInvalidLink': 'Bu bağlantının süresi doldu. Yeni bir bağlantı isteyin.',

  // Join (invitation acceptance)
  'auth.join.invalidTitle': 'Bu davet geçerli değil',
  'auth.join.invalidSubtitle': 'Süresi dolmuş veya iptal edilmiş olabilir.',
  'auth.join.invalidBody':
    'Sizi davet eden kişiden yeni bir davet göndermesini isteyin. Bağlantılar bir kez çalışır ve yedi gün geçerlidir.',
  'auth.join.checkingTitle': 'Davetiniz kontrol ediliyor',
  'auth.join.checkingSubtitle': 'Bir dakika.',
  'auth.join.loading': 'Yükleniyor…',
  'auth.join.title': "{organization}'a katıl",
  'auth.join.subtitle': '{role} olarak davet edildiniz · {email}',
  'auth.join.existingAccountNotice':
    'Bu adres için zaten bir Nexa hesabınız var. Kabul etmek bu çalışma alanını hesabınıza ekler.',
  'auth.join.passwordHint': 'En az {count} karakter.',
  'auth.join.submit': 'Çalışma alanına katıl',
  'auth.join.submitting': 'Katılınıyor…',
  'auth.join.errorGeneric': 'O davet kabul edilemedi.',

  // Shared across the public pages
  'auth.common.backToSignIn': 'Oturum açmaya dön',

  // OAuth/SSO callback
  'auth.callback.signingIn': 'Oturumunuz açılıyor…',
  'auth.callback.noCode': 'Bu oturum açma tamamlanmadı. Oturum açma sayfasından yeniden başlayın.',
  'auth.callback.genericFailure': 'Oturum açma başarısız oldu.',

  // Onboarding wizard
  'auth.onboarding.steps.welcome': 'Hoş geldiniz',
  'auth.onboarding.steps.website': 'Website',
  'auth.onboarding.steps.team': 'Ekip',
  'auth.onboarding.steps.sample': 'Örnek veri',
  'auth.onboarding.title': 'Çalışma alanınızı ayarlayın',
  'auth.onboarding.stepProgress': 'Adım {current} / {count}',
  'auth.onboarding.skip': 'Kurulumu atla',
  'auth.onboarding.progressLabel': 'Kurulum ilerlemesi',
  'auth.onboarding.back': 'Geri',
  'auth.onboarding.continue': 'Devam et',
  'auth.onboarding.finish': 'Kurulumu bitir',
  'auth.onboarding.finishing': 'Bitiriliyor…',
  'auth.onboarding.finishFailed': 'Kurulum bitirilemedi. Yeniden deneyin.',
  'auth.onboarding.welcome.heading': 'Hoş geldiniz{name} 👋',
  'auth.onboarding.welcome.body':
    'Çalışma alanınız hazır. Widget’ı sitenize eklemek, ekip arkadaşlarınızı davet etmek ve gelen kutunuzun ilk günden boş görünmemesi için bir örnek konuşma eklemek üzere birkaç kısa adım var.',
  'auth.onboarding.welcome.bulletWebsite': 'İlk web sitenizi bağlayın',
  'auth.onboarding.welcome.bulletTeam': 'Ekibinizi davet edin',
  'auth.onboarding.welcome.bulletSample': 'Keşfetmek için örnek veri ekleyin',
  'auth.onboarding.welcome.footer':
    'Her adım isteğe bağlıdır — herhangi birini atlayıp daha sonra Ayarlar’dan tamamlayabilirsiniz.',
  'auth.onboarding.website.heading': 'İlk web sitenizi bağlayın',
  'auth.onboarding.website.body':
    'Sohbet widget’ını eklemek istediğiniz siteyi girin. Bu, sitenin alan adını da güvenilir listesine ekler; böylece widget hemen orada konuşma başlatabilir.',
  'auth.onboarding.website.domainLabel': 'Website alan adı',
  'auth.onboarding.website.domainPlaceholder': 'magaza.ornek',
  'auth.onboarding.website.domainRequiredError': 'Bir web sitesi alan adı girin.',
  'auth.onboarding.website.submit': 'Website ekle',
  'auth.onboarding.website.submitting': 'Ekleniyor…',
  'auth.onboarding.website.added':
    '{domain} eklendi. Daha fazla siteyi Ayarlar’dan ekleyebilirsiniz.',
  'auth.onboarding.team.heading': 'Ekibinizi davet edin',
  'auth.onboarding.team.body':
    'Ekip arkadaşlarınızı e-postayla ekleyin — birden fazlasını boşluk veya virgülle ayırın. Temsilci olarak katılırlar; rollerini daha sonra değiştirebilirsiniz. Şimdilik tek başınaysanız bu adımı atlayın.',
  'auth.onboarding.team.emailsLabel': 'Ekip arkadaşı e-postaları',
  'auth.onboarding.team.emailsPlaceholder': 'sam@ornek.com, priya@ornek.com',
  'auth.onboarding.team.emailsEmptyError': 'En az bir e-posta adresi girin.',
  'auth.onboarding.team.emailsInvalidError': 'Geçersiz adres: {addresses}',
  'auth.onboarding.team.submit': 'Davet gönder',
  'auth.onboarding.team.submitting': 'Gönderiliyor…',
  // Turkish does not inflect a noun after a numeral (see shell.trial.remaining.*
  // for the same note), so both plural categories read the same.
  'auth.onboarding.team.sent.one': '{count} davet gönderildi.',
  'auth.onboarding.team.sent.other': '{count} davet gönderildi.',
  'auth.onboarding.sample.addLabel': 'Örnek veri ekle',
  'auth.onboarding.sample.body':
    'Çalışma alanınıza hemen keşfedebileceğiniz birkaç hazır yanıt, etiket ve bir örnek konuşma ekleyin. Dilediğiniz zaman arşivleyebilir veya silebilirsiniz.',
  'auth.onboarding.sample.submitting': 'Ekleniyor…',
  'auth.onboarding.sample.added': 'Örnek veri eklendi',
  'auth.onboarding.sample.seeded':
    '{cannedResponses} hazır yanıt, {tags} etiket ve {chats} örnek konuşma eklendi.',
  'auth.onboarding.sample.alreadySeeded': 'Örnek veri çalışma alanınızda zaten mevcut.',
  'auth.onboarding.sample.footerBefore': 'Gelen kutunuzu açmak için',
  'auth.onboarding.sample.footerAfter': "'i seçin.",
};
