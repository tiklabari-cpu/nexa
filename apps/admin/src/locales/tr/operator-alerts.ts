import type { Messages } from '../merge.js';

/** Yöneticiler: operatörün kendi uyarı tercihleri (tm 389.20). */
export const admins: Messages = {
  'admins.alerts.title': 'Uyarı e-postaları',
  'admins.alerts.loading': 'Yükleniyor…',
  'admins.alerts.loadError': 'Uyarı tercihleriniz yüklenemedi',
  'admins.alerts.hint':
    'Platform her beş dakikada bir kontrol eder ve aşağıda işaretli uyarıları size e-postayla gönderir; her uyarı günde en fazla bir kez, sağlık ve denetim zinciri uyarıları saatte bir.',
  'admins.alerts.hint.default':
    'Henüz seçim yapmadınız: süper yöneticiler her uyarıyı alır, diğer roller hiçbirini almaz. Seçiminizi kesinleştirmek için kaydedin.',
  'admins.alerts.locale': 'E-postaların dili',

  'admins.alerts.kind.trial_ending': 'Bir deneme süresi 3 gün içinde bitiyor',
  'admins.alerts.kind.trial_ending.hint': 'Deneme süresi bitmek üzere olan bir çalışma alanı.',
  'admins.alerts.kind.payment_request_waiting': 'Bir ödeme talebi 24 saatten uzun süredir bekliyor',
  'admins.alerts.kind.payment_request_waiting.hint':
    'Bir gündür kimsenin işlemediği bir kripto ödeme talebi.',
  'admins.alerts.kind.ai_cap_reached': 'Bir çalışma alanı günlük yapay zekâ kotasına ulaştı',
  'admins.alerts.kind.ai_cap_reached.hint':
    'O çalışma alanında yapay zekâ, UTC gece yarısına kadar yanıt vermez.',
  'admins.alerts.kind.health_red': 'Sağlık kontrolü kırmızıya döndü',
  'admins.alerts.kind.health_red.hint':
    'Sağlık anlık görüntüsü yok, bayat ya da bozuk — kiracı API düşmüş olabilir.',
  'admins.alerts.kind.audit_chain_broken': 'Denetim zinciri artık doğrulanmıyor',
  'admins.alerts.kind.audit_chain_broken.hint':
    'Platform denetim zincirinin günlük kontrolü bir kopukluk buldu.',
  'admins.alerts.kind.purge_tomorrow': 'Bir çalışma alanı yarın silinecek',
  'admins.alerts.kind.purge_tomorrow.hint': 'Silme iptal edilmezse verileri kalıcı olarak gider.',
};
