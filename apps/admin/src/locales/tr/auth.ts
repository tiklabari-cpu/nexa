import type { Messages } from '../merge.js';

/** Operatör girişi: parola → doğrulayıcı → kurtarma kodları ve davet sayfası (tm 389.6). */
export const auth: Messages = {
  'auth.startup.loading': 'Yükleniyor…',
  'auth.title': 'Platform girişi',
  'auth.sessionEnded': 'Oturumunuz sona erdi. Yeniden giriş yapın.',

  'auth.signIn.title': 'Platform paneline giriş yapın',
  'auth.signIn.description': 'SiyahTuş operatörleri içindir. Çalışma alanı girişi burada geçmez.',
  'auth.signIn.email': 'E-posta',
  'auth.signIn.password': 'Parola',
  'auth.signIn.submit': 'Devam',
  'auth.signIn.submitting': 'Giriş yapılıyor…',
  'auth.signIn.invalid': 'E-posta ya da parola yanlış, ya da bu hesap devre dışı.',

  'auth.verify.title': 'Doğrulayıcı kodunuzu girin',
  'auth.verify.description': 'Doğrulayıcı uygulamanızı açın ve altı haneli kodu yazın.',
  'auth.verify.code': 'Doğrulayıcı kodu',
  'auth.verify.recoveryCode': 'Kurtarma kodu',
  'auth.verify.useRecovery': 'Bunun yerine kurtarma kodu kullan',
  'auth.verify.useApp': 'Bunun yerine doğrulayıcı uygulamayı kullan',
  'auth.verify.submit': 'Doğrula',
  'auth.verify.submitting': 'Doğrulanıyor…',
  'auth.verify.invalid':
    'Bu kod çalışmadı. Kodu ve cihazınızın saatini kontrol edip yeniden deneyin. Bir kod yalnız bir kez geçer.',
  'auth.verify.recoveryLow':
    'Yalnız {count} kurtarma kodu kaldı. Yakında yeni bir liste oluşturun.',

  'auth.enroll.title': 'Doğrulayıcınızı kurun',
  'auth.enroll.description':
    'Platform erişimi ikinci bir doğrulama ister. Bu hesabı bir doğrulayıcı uygulamaya ekleyin, sonra bir kodla onaylayın.',
  'auth.enroll.secretLabel': 'Gizli anahtar',
  'auth.enroll.secretHint': 'Doğrulayıcı uygulamanıza yazın ya da aşağıdaki bağlantıyı açın.',
  'auth.enroll.openLink': 'Doğrulayıcı uygulamada aç',
  'auth.enroll.code': 'Uygulamadaki kod',
  'auth.enroll.submit': 'Etkinleştir',
  'auth.enroll.submitting': 'Etkinleştiriliyor…',
  'auth.enroll.invalid': 'Kod eşleşmedi. Cihazınızın saatini kontrol edip yeniden deneyin.',
  'auth.enroll.starting': 'Gizli anahtarınız hazırlanıyor…',

  'auth.recovery.title': 'Kurtarma kodlarınızı kaydedin',
  'auth.recovery.description':
    'Doğrulayıcınızı kaybederseniz her kod bir kez işe yarar. Yalnız şimdi gösterilir.',
  'auth.recovery.list': 'Kurtarma kodları',
  'auth.recovery.download': 'Dosya olarak indir',
  'auth.recovery.saved': 'Bu kodları kaydettim',
  'auth.recovery.continue': 'Panele devam et',

  'auth.invite.title': 'Davetinizi kabul edin',
  'auth.invite.description':
    'En az 12 karakterlik bir parola seçin. Sonra doğrulayıcıyı kurarsınız.',
  'auth.invite.password': 'Parola',
  'auth.invite.passwordHint': 'En az 12 karakter.',
  'auth.invite.submit': 'Kabul et ve devam et',
  'auth.invite.submitting': 'Kabul ediliyor…',
  'auth.invite.missingToken': 'Bu davet bağlantısı eksik. E-postadaki bağlantıyı yeniden açın.',
  'auth.invite.invalid': 'Bu davet artık geçerli değil. Bir süper yöneticiden yenisini isteyin.',
  'auth.invite.signIn': 'Girişe dön',

  'auth.cancel': 'Başka bir hesap kullan',
};
