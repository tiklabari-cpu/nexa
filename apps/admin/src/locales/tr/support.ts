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
};
