import type { Messages } from '../merge.js';

/** Yöneticiler: operatör dizini (tm 391 · FR-ADMIN-04). */
export const adminDirectory: Messages = {
  'admins.dir.heading': 'Operatörler',
  'admins.dir.intro':
    'Operatörler silinmez, devre dışı bırakılır — her denetim kaydı, onu yazanın adını taşımaya devam eder.',
  'admins.dir.loading': 'Yükleniyor…',
  'admins.dir.loadError': 'Operatörler yüklenemedi',
  'admins.dir.invite': 'Operatör davet et',
  'admins.dir.col.email': 'E-posta',
  'admins.dir.col.role': 'Rol',
  'admins.dir.col.status': 'Durum',
  'admins.dir.col.twoFactor': 'Doğrulayıcı',
  'admins.dir.col.sessions': 'Açık oturum',
  'admins.dir.col.lastSeen': 'Son görülme',
  'admins.dir.col.actions': 'İşlemler',
  'admins.dir.status.active': 'Etkin',
  'admins.dir.status.disabled': 'Devre dışı: {date}',
  'admins.dir.twoFactor.on': 'Kurulu',
  'admins.dir.twoFactor.off': 'Henüz kurulmadı',
  'admins.dir.never': 'Hiç',
  'admins.dir.you': '(siz)',
  'admins.dir.actions.menu': 'İşlemler',
  'admins.dir.actions.for': '{email} için işlemler',

  'admins.invites.heading': 'Bekleyen davetler',
  'admins.invites.loadError': 'Davetler yüklenemedi',
  'admins.invites.empty': 'Bekleyen davet yok.',
  'admins.invites.col.invitedBy': 'Davet eden',
  'admins.invites.col.expires': 'Son geçerlilik',
  'admins.invites.revoke': 'Geri çek',
  'admins.invites.revokeLabel': '{email} davetini geri çek',

  'admins.field.email': 'E-posta adresi',
  'admins.field.role': 'Rol',

  'admins.invite.title': 'Operatör davet et',
  'admins.invite.body':
    'E-postayla 72 saat geçerli bir bağlantı alır. Başka hiçbir şey açılmadan önce bir parola seçer ve doğrulayıcısını kurar.',
  'admins.invite.confirm': 'Daveti gönder',
  'admins.invite.sent': '{email} adresine davet gönderildi.',
  'admins.invite.mailFailed':
    '{email} adresine e-posta gönderilemedi. Bağlantıyı kendiniz iletin — yalnızca şimdi gösterilir:',

  'admins.revokeInvite.title': 'Daveti geri çek',
  'admins.revokeInvite.body': '{email} adresine gönderilen bağlantı çalışmaz hale gelir.',
  'admins.revokeInvite.confirm': 'Daveti geri çek',
  'admins.revokeInvite.done': '{email} daveti geri çekildi.',

  'admins.action.role.label': 'Rolü değiştir',
  'admins.action.role.title': 'Rolü değiştir',
  'admins.action.role.body': '{email} için bundan sonra geçerli olacak rolü seçin.',
  'admins.action.role.confirm': 'Rolü değiştir',
  'admins.action.role.done': '{email} artık: {role}.',
  'admins.action.disable.label': 'Devre dışı bırak',
  'admins.action.disable.title': 'Operatörü devre dışı bırak',
  'admins.action.disable.body':
    '{email} artık oturum açamaz ve açık tüm oturumları sona erer. Denetim kayıtları kalır.',
  'admins.action.disable.confirm': 'Devre dışı bırak',
  'admins.action.disable.done': '{email} devre dışı bırakıldı.',
  'admins.action.enable.label': 'Etkinleştir',
  'admins.action.enable.title': 'Operatörü etkinleştir',
  'admins.action.enable.body': '{email} parolası ve doğrulayıcısıyla yeniden oturum açabilir.',
  'admins.action.enable.confirm': 'Etkinleştir',
  'admins.action.enable.done': '{email} etkinleştirildi.',
  'admins.action.resetTwoFactor.label': 'Doğrulayıcıyı sıfırla',
  'admins.action.resetTwoFactor.title': 'Doğrulayıcıyı sıfırla',
  'admins.action.resetTwoFactor.body':
    '{email} parolasıyla oturum açıp yeni bir doğrulayıcı kurar; kurtarma kodları geçersiz olur.',
  'admins.action.resetTwoFactor.confirm': 'Doğrulayıcıyı sıfırla',
  'admins.action.resetTwoFactor.verified':
    'Bunun gerçekten {email} olduğunu, sıfırlamayı isteyen e-postadan başka bir yolla doğruladım.',
  'admins.action.resetTwoFactor.done': '{email} doğrulayıcısı sıfırlandı.',
  'admins.action.revokeSessions.label': 'Oturumları sonlandır',
  'admins.action.revokeSessions.title': 'Tüm oturumları sonlandır',
  'admins.action.revokeSessions.body':
    '{email} için açık tüm oturumlar sona erer; devam etmek için yeniden oturum açar.',
  'admins.action.revokeSessions.confirm': 'Oturumları sonlandır',
  'admins.action.revokeSessions.done':
    '{email} oturumları sonlandırıldı. Sonlanan oturum: {count}.',

  'admins.error.lastSuperadmin':
    'Bu, son etkin süper yönetici ve platformun bir tane olması gerekir. Önce başka bir operatörü süper yönetici yapın, sonra yeniden deneyin.',
};
