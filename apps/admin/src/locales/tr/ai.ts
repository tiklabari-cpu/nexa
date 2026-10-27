import type { Messages } from '../merge.js';

/** Yapay zekâ: platform katalogları, kriz metni taslakları ve şablon kurulumları (tm 389.19). */
export const ai: Messages = {
  'ai.loadError': 'Bu katalog yüklenemedi',
  'ai.loading': 'Yükleniyor…',
  'ai.loadMore': 'Daha fazla yükle',
  'ai.noVersion': 'Sürüm yok',
  'ai.notInstalled': 'Henüz yok: {owner} ile birlikte gelecek.',
  'ai.yes': 'Evet',
  'ai.no': 'Hayır',

  'ai.tabs.label': 'Yapay zekâ katalogları',
  'ai.tabs.guardrails': 'Uyum korumaları',
  'ai.tabs.crisis': 'Kriz metinleri',
  'ai.tabs.templates': 'Şablonlar',
  'ai.tabs.compliance': 'Uyum paketi',
  'ai.tabs.rubric': 'Kalite rubriği',
  'ai.tabs.tools': 'Araçlar',

  'ai.guardrails.version': 'Katalog sürümü',
  'ai.guardrails.intro':
    'Her AI ajanının altında çalıştığı {count} kilitli kural. Bir çalışma alanı kendi daha sıkı kurallarını ekleyebilir; bunları kapatamaz ya da gevşetemez.',
  'ai.guardrails.caption': 'Kilitli uyum koruma kuralları',
  'ai.guardrails.col.rule': 'Kural',
  'ai.guardrails.col.title': 'Ne yapar',
  'ai.guardrails.col.category': 'Kategori',
  'ai.guardrails.col.action': 'Eylem',
  'ai.guardrails.col.stages': 'Denetlenen',
  'ai.guardrails.col.patterns': 'Kalıplar',
  'ai.guardrails.stage.input': 'oyuncu mesajı',
  'ai.guardrails.stage.output': 'AI taslağı',
  'ai.guardrails.patterns': '{input} giriş · {output} çıkış',

  'ai.templates.version': '{pack} şablon paketi, paket sürümü',
  'ai.templates.intro':
    '{count} iGaming prosedür şablonu (Türkçe). Çalışma alanı bir kopya kurar ve kendisine ait olanı doldurur; şablonun metni burada gösterilmez.',
  'ai.templates.caption': 'Paketteki şablonlar',
  'ai.templates.col.key': 'Anahtar',
  'ai.templates.col.name': 'Ad',
  'ai.templates.col.version': 'Sürüm',
  'ai.templates.col.locked': 'Kilitli',
  'ai.templates.col.scenarios': 'Test senaryosu',
  'ai.templates.col.mustFill': 'Doldurulacak',

  'ai.installs.heading': 'Çalışma alanı başına kurulumlar',
  'ai.installs.empty': 'Henüz hiçbir çalışma alanı şablon kurmadı.',
  'ai.installs.intro':
    'Kurulu kopyalar, kaçının AI’ın kullanması için açık olduğu ve kaçının şablonunun paketteki sürümün gerisinde kaldığı. Yalnız sayılar.',
  'ai.installs.caption': 'Çalışma alanı başına şablon kurulumları, en çok kopyası olan önce',
  'ai.installs.col.workspace': 'Çalışma alanı',
  'ai.installs.col.installed': 'Kurulu',
  'ai.installs.col.active': 'Yayında',
  'ai.installs.col.outdated': 'Geride',

  'ai.compliance.version': 'Paket sürümü',
  'ai.compliance.intro':
    'Yayın öncesi her test koşusunun çalışma alanının kendi senaryolarına ek olarak oynadığı {count} senaryo. Bunlardan birinde başarısız olan koşu yayını durdurur.',
  'ai.compliance.caption': 'Uyum senaryoları',
  'ai.compliance.col.key': 'Senaryo',
  'ai.compliance.col.rule': 'Kural',
  'ai.compliance.col.language': 'Dil',

  'ai.rubric.version': 'Rubrik sürümü',
  'ai.rubric.intro':
    'AI hakemin her görüşmeyi puanladığı ölçütler, {min} (zayıf) ile {max} (doğru) arası. Yalnız öneridir; geçti ya da kaldı kararını vermez.',
  'ai.rubric.caption': 'Kalite rubriği ölçütleri',
  'ai.rubric.col.criterion': 'Ölçüt',
  'ai.rubric.col.applies': 'Geçerli olduğu',
  'ai.rubric.always': 'Her görüşme',
  'ai.rubric.handoffOnly': 'Yalnız devredilen görüşme',
  'ai.rubric.criterion.topic': 'Doğru konu',
  'ai.rubric.criterion.required_info': 'Gerekli bilgi',
  'ai.rubric.criterion.faithfulness': 'Bilgi kaynağına bağlılık',
  'ai.rubric.criterion.guardrails': 'Uyum korumalarına uygunluk',
  'ai.rubric.criterion.handoff_timing': 'Doğru anda devir',
  'ai.rubric.criterion.handoff_summary': 'Eksiksiz devir özeti',
  'ai.rubric.criterion.tone': 'Üslup',

  'ai.tools.owner': 'araç yuvası',
  'ai.tools.version': 'Katalog sürümü',
  'ai.tools.caption': 'Araç kataloğu',
  'ai.tools.col.key': 'Araç',

  'ai.crisis.title': 'Kriz metni taslakları',
  'ai.crisis.intro':
    'Sorumlu oyun devri için ülkeye göre önerilen metin. Çalışma alanına kendi ülkesinin taslağı “platformun taslağını kullan” olarak sunulur; metni kendisi düzenler ve onaylar. Onun adına hiçbir şey yayınlanmaz.',
  'ai.crisis.updatedAt': 'Son kayıt: {date}',
  'ai.crisis.none': 'Ülke yok',
  'ai.crisis.confirmRow': '{country} (İngilizce {en}, Türkçe {tr} karakter)',
  'ai.crisis.empty': 'Henüz taslak yok. Yazmak için bir ülke ekleyin.',
  'ai.crisis.country': '{country} taslakları',
  'ai.crisis.remove': '{country} ülkesini kaldır',
  'ai.crisis.lang.en': 'İngilizce metin',
  'ai.crisis.lang.tr': 'Türkçe metin',
  'ai.crisis.newCountry': 'Ülke kodu',
  'ai.crisis.newCountry.hint':
    'İki harf, ISO 3166-1 (TR, GB, MT…). En çok {max} ülke. Çalışma alanının ülkesi saat diliminden okunur.',
  'ai.crisis.add': 'Ülke ekle',
  'ai.crisis.problem.country': 'Ülke, iki büyük harftir.',
  'ai.crisis.problem.duplicate': 'Bir ülke iki kez geçiyor.',
  'ai.crisis.problem.empty': 'Her ülkenin en az bir dilde metni olmalı.',
  'ai.crisis.problem.text': 'Metin, en çok {max} karakterlik düz yazıdır; HTML içermez.',
};
