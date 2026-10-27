import type { Messages } from '../merge.js';

/**
 * Destek masasının araması (tm 389.9). "Thread ID" ve "Chat ID" panelin iki görüşme numarasına
 * verdiği adlardır ve her dilde İngilizce kalır (ID-01-S1).
 */
export const support: Messages = {
  'support.lookup.label': 'Bir kimliğin hangi çalışma alanına ait olduğunu bul',
  'support.lookup.hint':
    'Bir Thread ID, Chat ID, talep numarası ya da müşteri e-postası yapıştır. Yalnız çalışma alanı gösterilir — yazılanlar asla.',
  'support.lookup.submit': 'Bul',
  'support.lookup.searching': 'Aranıyor…',
  'support.lookup.none': 'Eşleşen bir şey yok. Yazım hatası olabilir — ya da bu bir kimlik değil.',
  'support.lookup.failed': 'Arama başarısız oldu',
  'support.lookup.idle': 'Sonuçlar burada görünür.',
  'support.lookup.results': 'Eşleşen çalışma alanları',
  'support.lookup.matched': 'Eşleşen',
  'support.lookup.organization': 'Çalışma alanı',
  'support.lookup.licence': 'Lisans',
  'support.kind.thread_id': 'Thread ID',
  'support.kind.chat_id': 'Chat ID',
  'support.kind.ticket': 'Talep',
  'support.kind.customer_email': 'Müşteri e-postası',
  // "Müşteri olarak gir" (tm 389.15).
  'support.impersonate.open': 'Müşteri olarak gir',
  'support.impersonate.title': '{workspace} çalışma alanına bir üye olarak gir',
  'support.impersonate.description':
    'Çalışma alanı konsolunu seçtiğiniz üye olarak, 30 dakika boyunca, yalnızca onun rolüyle açar. Çalışma alanının Kurucusuna e-posta gider ve yapılan her şey sizin adınıza kaydedilir.',
  'support.impersonate.confirm': 'Bağlantıyı oluştur',
  'support.impersonate.member': 'Üye',
  'support.impersonate.chooseMember': 'Bir üye seçin…',
  'support.impersonate.membersFailed': 'Üyeler yüklenemedi.',
  'support.impersonate.mode': 'Erişim',
  'support.impersonate.modes.read_only': 'Salt okunur',
  'support.impersonate.modes.read_only.hint': 'Bakın, hiçbir şeyi değiştirmeyin. Olağan seçim.',
  'support.impersonate.modes.full': 'Tam',
  'support.impersonate.modes.full.hint':
    'Üye olarak işlem yapın. Parola, güvenlik, faturalandırma ve erişim anahtarları kapalı kalır. Yeni bir doğrulama kodu ister.',
  'support.impersonate.modes.full.superadminOnly': 'Yalnızca süper yöneticiler.',
  'support.impersonate.errors.accountSuspended':
    'Bu kişi SiyahTuş tarafından askıya alınmış — önce askıyı kaldırın.',
  'support.impersonate.errors.workspaceClosed':
    'Bu çalışma alanı askıda ya da iptal edilmiş — kimse giriş yapamaz.',
  'support.impersonate.errors.notAMember': 'Bu kişi artık burada etkin bir üye değil.',
  'support.impersonate.ready.title': 'Oturum hazır',
  'support.impersonate.ready.readOnly': '{email} olarak salt okunur oturum.',
  'support.impersonate.ready.full': '{email} olarak tam oturum.',
  'support.impersonate.ready.once':
    'Bağlantı yalnızca bir kez, {time} saatine kadar çalışır. Oturum {ends} saatinde biter.',
  'support.impersonate.ready.mail.sent': 'Çalışma alanının Kurucusuna e-posta gönderildi.',
  'support.impersonate.ready.mail.failed': 'Çalışma alanının Kurucusuna e-posta gönderilemedi.',
  'support.impersonate.ready.mail.none': 'Çalışma alanının e-posta gidecek bir Kurucusu yok.',
  'support.impersonate.ready.open': 'Çalışma alanını aç',
  'support.impersonate.ready.close': 'Kapat',
  'support.impersonations.title': 'Açık destek oturumları',
  'support.impersonations.loading': 'Oturumlar yükleniyor…',
  'support.impersonations.failed': 'Oturumlar yüklenemedi',
  'support.impersonations.none': 'Şu anda hiçbir operatör bir çalışma alanının içinde değil.',
  'support.impersonations.workspace': 'Çalışma alanı',
  'support.impersonations.member': 'Üye',
  'support.impersonations.operator': 'Operatör',
  'support.impersonations.mode': 'Erişim',
  'support.impersonations.ends': 'Bitiş',
  'support.impersonations.actions': 'İşlemler',
  'support.impersonations.end': 'Oturumu bitir',
  'support.impersonations.endTitle': '{email} olarak açılan oturumu bitir',
  'support.impersonations.endDescription': 'Açıldığı konsol sekmesi hemen çalışmaz olur.',
};
