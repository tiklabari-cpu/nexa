import type { Messages } from '../merge.js';

/**
 * Konuşma zaman çizelgesi (ID-09 · tm 334.2): bir günün ya da tek bir bağlantının
 * her olayı tek listede. Mesaj metni, etiket adı ve ticket konusu konuşma
 * içeriğidir, yazıldığı gibi kalır. İki numaranın adı ids kataloğundadır
 * (`ids.thread.label`, `ids.chat.label`), buraya yazılmaz.
 */
export const timeline: Messages = {
  'timeline.title': 'Zaman çizelgesi',
  'timeline.zone': 'Saatler {zone} diliminde gösterilir. UTC anı için saatin üzerine gelin.',
  'timeline.back': 'Konuşmaya dön',
  'timeline.loading': 'Yükleniyor…',
  'timeline.noChat.title': 'Konuşma seçilmedi',
  'timeline.noChat.description':
    'Zaman çizelgesini Gelen Kutusu ya da Arşiv’deki bir konuşmadan açın.',
  'timeline.notFound.title': 'Konuşma bulunamadı',
  'timeline.notFound.description': 'Böyle bir konuşma yok ya da görebileceğiniz biri değil.',
  'timeline.error.title': 'Zaman çizelgesi yüklenemedi',
  'timeline.empty.title': 'Henüz kayıt yok',
  'timeline.empty.description': 'Seçilen türlerde eşleşen satır yok.',
  'timeline.empty.filteredTitle': 'Yüklenen satırlarda eşleşme yok',
  'timeline.empty.filteredAll': 'Başka sözcükler deneyin.',
  'timeline.empty.filteredMore':
    'Başka sözcükler deneyin ya da daha geriye bakmak için daha fazla satır yükleyin.',

  'timeline.scope.day': 'Tüm günü göster',
  'timeline.divider': 'Bağlantı başlıyor',
  'timeline.list.ariaLabel': 'Zaman çizelgesi satırları',

  'timeline.search.label': 'Yüklenen satırları süz',
  'timeline.search.placeholder': 'Yüklenen satırları süz…',
  'timeline.search.count': 'Yüklenen {loaded} satırdan {shown} tanesi gösteriliyor',
  'timeline.search.loadedOnly':
    'Süzme, şu ana kadar yüklenen satırları kapsar. Daha geriye bakmak için daha fazla satır yükleyin.',
  'timeline.loaded.one': '{count} satır yüklendi',
  'timeline.loaded.other': '{count} satır yüklendi',

  'timeline.kinds.label': 'Gösterilen türler',
  'timeline.kind.message': 'Mesaj',
  'timeline.kind.note': 'İç not',
  'timeline.kind.ai_decision': 'AI kararı',
  'timeline.kind.system': 'Sistem',
  'timeline.kind.assignment': 'Atama',
  'timeline.kind.transfer': 'Transfer',
  'timeline.kind.tag': 'Etiket',
  'timeline.kind.rating': 'Puan',
  'timeline.kind.sla_breach': 'SLA',
  'timeline.kind.ticket': 'Ticket',
  'timeline.kind.audit': 'Denetim',

  'timeline.actor.agent': 'Temsilci',
  'timeline.actor.customer': 'Ziyaretçi',
  'timeline.actor.bot': 'Bot',
  'timeline.actor.system': 'Sistem',
  'timeline.actor.ai': 'AI Agent',

  'timeline.row.copy': 'Bu satırı kopyala',
  'timeline.row.copied': 'Kopyalandı',
  'timeline.row.details': 'Ayrıntılar',
  'timeline.attachment': 'Ek',
  'timeline.ai.run': 'Prosedür çalıştırma: {name} · {status}',
  'timeline.ai.procedure': 'Prosedür: {name}',
  'timeline.ai.step': 'Adım: {step}',
  'timeline.ai.sources.one': '{count} bilgi kaynağı okundu',
  'timeline.ai.sources.other': '{count} bilgi kaynağı okundu',
  'timeline.ai.handoff': 'Devir nedeni: {reason}',
  'timeline.assignment.assigned': 'Atandı',
  'timeline.assignment.queued': 'Kuyruğa girdi',
  'timeline.assignment.leftQueue': 'Kuyruktan çıktı: {outcome}',
  'timeline.assignment.unknownOutcome': 'bilinmiyor',
  'timeline.sla': 'SLA hedefi aşıldı ({target}): {limit} dk hedefe karşı {elapsed} dk',

  'timeline.loadMore': 'Daha fazla yükle',
  'timeline.loadMore.loading': 'Yükleniyor…',
  'timeline.loadMore.error': 'Sonraki satırlar yüklenemedi. Yeniden deneyin.',
  'timeline.end': 'Hepsi bu kadar.',

  'timeline.audit.notPermitted':
    'Denetim kayıtları listelenmedi: denetim günlüğünü okuyamıyorsunuz.',
  'timeline.audit.expired':
    'Kayıt saklama süresi dolmuş: bu konuşmanın denetim kayıtları saklama süresini aştığı için listelenmiyor.',

  'timeline.export.button': 'Dışa aktar',
  'timeline.export.title': 'Zaman çizelgesini dışa aktar',
  'timeline.export.description':
    'Dosya, burada süzülenleri değil bu {scope} için tüm satırları içerir — en fazla {max} satır.',
  'timeline.export.scopeDay': 'gün',
  'timeline.export.scopeThread': 'bağlantı',
  'timeline.export.format': 'Biçim',
  'timeline.export.format.csv': 'CSV (elektronik tablo)',
  'timeline.export.format.ndjson': 'NDJSON (satır başına bir JSON nesnesi)',
  'timeline.export.format.txt': 'Metin (kolay okunur)',
  'timeline.export.mask': 'E-posta ve kullanıcı adını maskele',
  'timeline.export.maskHint': 'Dosyayı maskesiz indirmek için işareti kaldırın.',
  'timeline.export.maskLocked': 'Maskesiz indirmeyi yalnız Kurucu yapabilir.',
  'timeline.export.audited': 'Her indirme denetim günlüğüne yazılır.',
  'timeline.export.cancel': 'Vazgeç',
  'timeline.export.submit': 'İndir',
  'timeline.export.preparing': 'Hazırlanıyor…',
};
