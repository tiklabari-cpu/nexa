import type { Messages } from '../merge.js';

/** Hesap araması, hesap ayrıntısı ve eylemleri (tm 389.11). */
export const accounts: Messages = {
  'accounts.loading': 'Yükleniyor…',
  'accounts.yes': 'Evet',
  'accounts.no': 'Hayır',

  'accounts.search.label': 'Hesaplarda ara',
  'accounts.search.q': 'Ara',
  'accounts.search.hint': 'Bir e-posta adresi ya da başı, bir adın başı veya hesap kimliği.',
  'accounts.search.submit': 'Ara',

  'accounts.list.caption': 'Hesaplar',
  'accounts.list.loadError': 'Hesap listesi yüklenemedi',
  'accounts.list.empty': 'Eşleşen hesap yok.',
  'accounts.list.name': 'Ad',
  'accounts.list.email': 'E-posta',
  'accounts.list.verified': 'E-posta doğrulandı',
  'accounts.list.state': 'Durum',
  'accounts.list.memberships': 'Çalışma alanları',
  'accounts.list.created': 'Oluşturuldu',
  'accounts.list.more': 'Daha fazla',

  'accounts.state.active': 'Etkin',
  'accounts.state.suspended': 'Askıda',

  'accounts.detail.loadError': 'Hesap yüklenemedi',
  'accounts.detail.notFound.title': 'Böyle bir hesap yok',
  'accounts.detail.notFound.body': 'Bu kimlikte bir hesap yok. Silinmiş olabilir.',
  'accounts.detail.erased': 'Hesap silindi.',
  'accounts.detail.back': 'Hesaplara dön',
  'accounts.detail.profile': 'Profil ve giriş',
  'accounts.detail.id': 'Hesap kimliği',
  'accounts.detail.created': 'Oluşturuldu',
  'accounts.detail.verified': 'E-posta doğrulandı',
  'accounts.detail.unverified': 'Doğrulanmadı',
  'accounts.detail.lastSignIn': 'Son giriş',
  'accounts.detail.lastSeen': 'Son görülme',
  'accounts.detail.password': 'Parolası var',
  'accounts.detail.twoFactor': 'İki adımlı doğrulama',
  'accounts.detail.twoFactorOn': 'Açık · {left} kurtarma kodu kaldı',
  'accounts.detail.twoFactorOff': 'Kapalı',
  'accounts.detail.sessions': 'Açık oturumlar',
  'accounts.detail.personalTokens': 'Kişisel erişim anahtarları',
  'accounts.detail.memberships': 'Çalışma alanları',
  'accounts.detail.noMemberships': 'Hesap hiçbir çalışma alanına üye değil.',

  'accounts.membership.workspace': 'Çalışma alanı',
  'accounts.membership.licence': 'Lisans',
  'accounts.membership.role': 'Rol',
  'accounts.membership.workspaceStatus': 'Çalışma alanı durumu',
  'accounts.membership.member': 'Üyelik',
  'accounts.membership.twoFactorRequired': '2FA zorunlu',
  'accounts.membership.joined': 'Katıldı',
  'accounts.membership.sandbox': 'Kum havuzu',
  'accounts.membership.active': 'Etkin',
  'accounts.membership.suspended': 'Çalışma alanı askıya aldı',
  'accounts.membership.awaiting': 'Onay bekliyor',

  'accounts.banner.suspendedTitle': 'Bu hesap askıda',
  'accounts.banner.suspended':
    '{when} tarihinden beri kişi hiçbir çalışma alanına giremiyor ve elindeki her anahtar reddediliyor.',
  'accounts.banner.reason': 'Gerekçe: {reason}',

  'accounts.actions.menu': 'Eylemler',
  'accounts.actions.done': '{action}: tamamlandı.',
  'accounts.actions.unchanged': '{action}: değişecek bir şey yok.',
  'accounts.actions.mailFailed': '{action}: tamamlandı, ancak e-posta gönderilemedi.',
  'accounts.actions.state.account_is_sole_owner':
    'Bu kişi bir çalışma alanının Kurucusu. Önce çalışma alanı sayfasından sahipliği devredin.',

  'accounts.actions.resendVerification.label': 'Doğrulama e-postasını yeniden gönder',
  'accounts.actions.resendVerification.title': 'Doğrulama e-postasını yeniden gönder',
  'accounts.actions.resendVerification.body':
    '{email} adresine yeni bir bağlantı gider; öncekisi çalışmaz olur.',
  'accounts.actions.resendVerification.confirm': 'Bağlantıyı gönder',

  'accounts.actions.forcePasswordReset.label': 'Parola sıfırlamayı zorla',
  'accounts.actions.forcePasswordReset.title': 'Parola sıfırlamayı zorla',
  'accounts.actions.forcePasswordReset.body':
    '{email} hesabının her çalışma alanındaki tüm oturumları kapanır ve bu adrese bir sıfırlama bağlantısı gider.',
  'accounts.actions.forcePasswordReset.confirm': 'Parolayı sıfırla',

  'accounts.actions.revokeSessions.label': 'Her yerden çıkış yaptır',
  'accounts.actions.revokeSessions.title': 'Her yerden çıkış yaptır',
  'accounts.actions.revokeSessions.body':
    '{email} hesabının tüm oturumları kapanır. Kişisel erişim anahtarları çalışmaya devam eder.',
  'accounts.actions.revokeSessions.confirm': 'Çıkış yaptır',

  'accounts.actions.revokeTokens.label': 'Tüm anahtarları iptal et',
  'accounts.actions.revokeTokens.title': 'Tüm anahtarları iptal et',
  'accounts.actions.revokeTokens.body':
    '{email} hesabının tüm oturumları ve kişisel erişim anahtarları çalışmaz olur.',
  'accounts.actions.revokeTokens.confirm': 'Anahtarları iptal et',

  'accounts.actions.resetTwoFactor.label': 'İki adımlı doğrulamayı sıfırla',
  'accounts.actions.resetTwoFactor.title': 'İki adımlı doğrulamayı sıfırla',
  'accounts.actions.resetTwoFactor.body':
    '{email} hesabının doğrulama uygulaması ve kurtarma kodları kaldırılır. 2FA zorunlu bir çalışma alanı kişiden yeniden kurmasını ister.',
  'accounts.actions.resetTwoFactor.confirm': '2FA’yı sıfırla',

  'accounts.actions.suspend.label': 'Hesabı askıya al',
  'accounts.actions.suspend.title': 'Bu hesabı askıya al',
  'accounts.actions.suspend.body':
    '{email} oturumdan çıkarılır ve askı kaldırılana kadar hiçbir çalışma alanına giremez. Üyelikler olduğu gibi kalır.',
  'accounts.actions.suspend.confirm': 'Askıya al',

  'accounts.actions.unsuspend.label': 'Askıyı kaldır',
  'accounts.actions.unsuspend.title': 'Askıyı kaldır',
  'accounts.actions.unsuspend.body': '{email} yeniden giriş yapabilir.',
  'accounts.actions.unsuspend.confirm': 'Askıyı kaldır',

  'accounts.actions.export.label': 'Hesap verisini dışa aktar',
  'accounts.actions.export.title': 'Hesabın verisini dışa aktar',
  'accounts.actions.export.body':
    '{email} hesabının profili, üyelikleri ve anahtar listesi JSON olarak indirilir. Çalışma alanı içeriği yer almaz.',
  'accounts.actions.export.confirm': 'Dışa aktar',

  'accounts.actions.erase.label': 'Hesabı sil',
  'accounts.actions.erase.title': 'Bu hesabı sil',
  'accounts.actions.erase.body':
    '{email} üyelikleri, anahtarları ve iki adımlı doğrulamasıyla birlikte silinir. Bu geri alınamaz.',
  'accounts.actions.erase.confirm': 'Sil',
  'accounts.actions.erase.confirmEmail': 'Onaylamak için e-posta adresini yazın',
  'accounts.actions.erase.confirmHint': '{email} adresini aynen yazın.',
  'accounts.actions.erase.mismatch': 'Yazdığınız adres bu hesabın adresi değil.',
};
