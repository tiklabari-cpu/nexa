import type { Messages } from '../merge.js';

/** Ana sayfa gösterge paneli. See the English file. */
export const home: Messages = {
  'home.page.title': 'Ana Sayfa',
  'home.page.description': 'Çalışma alanınıza genel bakış',
  'home.page.notAvailable.title': 'Gösterge paneli kullanılamıyor',
  'home.page.notAvailable.description':
    'Ana sayfa gösterge paneli yöneticiler ve sahiplere açıktır. Çalışmaya başlamak için gelen kutunuza gidin.',
  'home.page.goToInbox': 'Gelen kutusuna git',
  'home.page.loadError': 'Gösterge paneli yüklenemedi. Lütfen tekrar deneyin.',

  // Activation checklist
  'home.activation.title': 'Başlarken',
  'home.activation.allDone': 'Çalışma alanınız tamamen kuruldu.',
  'home.activation.progress': '{total} adımdan {completed} tanesi tamamlandı',
  'home.activation.progressAriaLabel': 'Kurulum ilerlemesi',
  'home.activation.doneSuffix': ' (tamamlandı)',
  'home.activation.todoSuffix': ' (yapılacak)',
  'home.activation.setUp': 'Kur',
  'home.activation.install_widget.label': 'Sohbet widget’ını kurun',
  'home.activation.install_widget.description':
    'Widget’ın yayına girebilmesi için web sitenizi ekleyin.',
  'home.activation.invite_teammate.label': 'Bir ekip arkadaşı davet edin',
  'home.activation.invite_teammate.description': 'Ekibinizin geri kalanını çalışma alanına katın.',
  'home.activation.customize_widget.label': 'Widget’ınızı özelleştirin',
  'home.activation.customize_widget.description':
    'Widget’ın rengini, temasını ve konumunu markanıza uyarlayın.',
  'home.activation.add_canned_response.label': 'Bir hazır yanıt oluşturun',
  'home.activation.add_canned_response.description':
    'Ekibinizin # ile ekleyebileceği bir yanıt kaydedin.',
  'home.activation.set_up_ai_agent.label': 'Bir AI Ajanı kurun',
  'home.activation.set_up_ai_agent.description':
    'Kolay soruları bir insan devreye girmeden önce AI’ın yanıtlamasını sağlayın.',

  // Live counters
  'home.live.title': 'Şu anda',
  'home.live.description': 'Çalışma alanınızdaki canlı etkinlik',
  'home.live.visitors_online.label': 'Çevrimiçi ziyaretçi',
  'home.live.visitors_online.hint': 'Şu anda sitede',
  'home.live.ongoing_chats.label': 'Süren sohbetler',
  'home.live.ongoing_chats.hint': 'Açık sohbetler',
  'home.live.agents_online.label': 'Çevrimiçi temsilci',
  'home.live.agents_online.hint': 'Sohbet kabul ediyor',

  // Weekly performance
  'home.weekly.title': 'Bu hafta',
  'home.weekly.description': 'Son 7 gün, önceki 7 günle karşılaştırmalı',
  'home.weekly.newChats': 'Yeni sohbetler',
  'home.weekly.resolved': 'Çözülen',
  'home.weekly.satisfaction': 'Memnuniyet',
  'home.weekly.ratedCount': '{count} değerlendirme',
  'home.weekly.vsLastWeek': 'geçen haftaya göre {count}',
  'home.weekly.ptsVsLastWeek': 'geçen haftaya göre {points} puan',
  'home.weekly.noChange': 'Geçen haftaya göre değişim yok',
  'home.weekly.comparedHint': 'Önceki haftayla karşılaştırıldı',
};
