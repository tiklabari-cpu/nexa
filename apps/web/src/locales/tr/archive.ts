import type { Messages } from '../merge.js';

/**
 * Arşiv: geçmiş bağlantıların listesi, salt okunur konuşma metni ve oyuncu paneli
 * (AR-01 · tm 335.2). Oyuncunun sözleri — satırdaki ilk mesaj, konuşma metni, puan
 * yorumu — konuşma içeriğidir, yazıldığı gibi kalır.
 */
export const archive: Messages = {
  'archive.title': 'Arşiv',

  'archive.panes.ariaLabel': 'Arşiv bölmeleri',
  'archive.panes.list': 'Liste',
  'archive.panes.transcript': 'Konuşma',
  'archive.panes.player': 'Oyuncu',

  'archive.list.region': 'Arşivlenmiş konuşmalar',
  'archive.list.ariaLabel': 'Konuşmalar',
  'archive.list.total.one': '{count} konuşma',
  'archive.list.total.other': '{count} konuşma',
  'archive.list.totalCapped': '{total} üzerinde konuşma',
  'archive.list.loading': 'Yükleniyor…',
  'archive.list.loadMore': 'Daha fazla yükle',
  'archive.list.error.title': 'Arşiv yüklenemedi',
  'archive.list.error.more': 'Sonraki konuşmalar yüklenemedi. Yeniden denemek için aşağı kaydırın.',
  'archive.empty.title': 'Henüz arşiv yok',
  'archive.empty.description': 'Sona eren konuşmalar burada görünür.',
  'archive.filter.includeOpen': 'Devam eden konuşmaları da göster',
  'archive.filter.groupByDay': 'Aynı günü grupla',
  'archive.group.connections.one': 'O gün {count} konuşma',
  'archive.group.connections.other': 'O gün {count} konuşma',

  'archive.row.open': 'Devam ediyor',
  'archive.row.unassigned': 'Atanmadı',
  'archive.row.noMessage': 'Oyuncudan mesaj yok',
  'archive.row.messages.one': '{count} mesaj',
  'archive.row.messages.other': '{count} mesaj',
  'archive.row.riskFlags.one': '{count} risk bayrağı',
  'archive.row.riskFlags.other': '{count} risk bayrağı',
  'archive.rating.good': 'İyi puanlandı',
  'archive.rating.bad': 'Kötü puanlandı',
  'archive.handledBy.ai': 'Yapay zekâ yanıtladı',
  'archive.handledBy.human': 'Bir kişi yanıtladı',
  'archive.handledBy.mixed': 'Yapay zekâ ve bir kişi',
  'archive.handledBy.unknown': 'Kayıtlı değil',

  'archive.detail.none.title': 'Bir konuşma seçin',
  'archive.detail.none.hint':
    'Okumak için listeden birini seçin. Bu sayfanın adresi, görmeye yetkili herkes için aynı konuşmayı açar.',
  'archive.detail.loading': 'Konuşma yükleniyor…',
  'archive.detail.status.open': 'Devam ediyor',
  'archive.detail.status.closed': 'Sona erdi',
  'archive.detail.retention.title': 'Bu konuşma silindi',
  'archive.detail.retention.description': 'Saklama süresi dolduğu için silindi. Kaydı artık yok.',
  'archive.detail.notFound.title': 'Konuşma bulunamadı',
  'archive.detail.notFound.description':
    'Bu numarada görebileceğiniz bir konuşma yok. Üyesi olmadığınız bir ekibe ait olabilir.',
  'archive.detail.error.title': 'Konuşma yüklenemedi',
  'archive.detail.transcriptError.title': 'Mesajlar yüklenemedi',

  'archive.action.openInbox': "Gelen Kutusu'nda aç",
  'archive.action.reopen': 'Yeniden aç',
  'archive.action.reopening': 'Yeniden açılıyor…',

  'archive.player.ariaLabel': 'Oyuncu ve konuşma ayrıntıları',
  'archive.player.title': 'Oyuncu',
  'archive.player.none': 'Kimin yazdığını görmek için bir konuşma seçin.',
  'archive.player.unavailable': 'Ayrıntılar yüklenemedi.',
  'archive.facts.section': 'Bu konuşma',
  'archive.facts.assignee': 'İlgilenen',
  'archive.facts.team': 'Ekip',
  'archive.facts.handledBy': 'Yanıtlayan',
  'archive.facts.rating': 'Puan',
  'archive.facts.tags': 'Etiketler',
  'archive.facts.risk': 'Risk bayrakları',
  'archive.facts.messages': 'Mesajlar',
};
