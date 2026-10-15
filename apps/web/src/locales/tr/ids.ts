import type { Messages } from '../merge.js';

/**
 * Kimlik adları (ID-01, K1 = A — docs/adr/conversation-day-ids.md).
 *
 * "Thread ID" ve "Chat ID" terimleri her dilde İngilizce kalır (ID-01-S1);
 * yanlarındaki kısa açıklama çevrilir. Bu yüzden `label` değerleri `en` ile
 * aynıdır. Kodda `chat_id` günlük kapsayıcıdır ("Thread ID"), `thread_id` tek
 * bağlantıdır ("Chat ID") — çeviri yalnız burada, sunum katmanında yapılır.
 */
export const ids: Messages = {
  'ids.thread.label': 'Thread ID',
  'ids.thread.hint': 'Üyenin bugünkü konuşma grubu',
  'ids.chat.label': 'Chat ID',
  'ids.chat.hint': 'Bu bağlantı',
  'ids.event.label': 'Message ID',
  'ids.event.hint': 'Tek bir mesaj — ait olduğu Chat ID ile başlar',
  'ids.customer.label': 'Member ID',
  'ids.customer.hint': 'Üyenin kendi numarası — teknik, paylaşılmaz',
  'ids.request.label': 'Request ID',
  'ids.request.hint': 'Tek bir sunucu isteği — hata mesajlarında ve loglarda görünür',
  'ids.ticket.label': 'Ticket ID',
  'ids.ticket.hint': 'Tek bir ticket',
  'ids.aiDecision.label': 'AI decision ID',
  'ids.aiDecision.hint': 'Yapay zekâ temsilcisinin tek bir kararı',
};
