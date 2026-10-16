#!/usr/bin/env node
// 2026-10-16 görev planı: etiket eşitleme (task_*.md → tasks.json), seçici bölme, 07-gorev-plani "Alt" sayıları.
// Kullanım: node scripts/loop/apply-task-plan-2026-10-16.cjs [--apply]   (bayraksız = kuru koşu)
// Gerekçe ve karar listesi: .loop-logs/PLAN-2026-10-16-kod-haritasi-ve-bolme.md
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TASKS = path.join(ROOT, '.taskmaster/tasks/tasks.json');
const MD = (id) => path.join(ROOT, `.taskmaster/tasks/task_${String(id).padStart(3, '0')}.md`);
const PLAN07 = path.join(ROOT, 'SiyahTus-Analiz/07-gorev-plani.md');
const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();

const LABEL_RE = /\[((?:SONNET|OPUS)-(?:MEDIUM|HIGH|XHIGH|MAX))\]/;
const modelOf = (label) => (label.startsWith('SONNET') ? 'Sonnet 5.5' : 'Opus 5.5');
const fullTitle = (code, label, text) => `${code} [${label}] (${modelOf(label)}) ${text}`;
const mdTitle = (code, label, text) => `${code} [${label}] ${text}`;

const UI_NOTE =
  'Uçlar ve sözleşme önceki alt görevde bitti: `packages/contract` + üretilen tipler tek kaynak; ' +
  'sunucu davranışını kod haritasıyla bul (`trace_path`, `search_graph`), düzenleyeceğin dosyayı Read ile oku.';
const PARENT_NOTE = (id) => `Ayrıntı ve kabul maddeleri: üst görev #${id} details (tek kaynak).`;

// ---------------------------------------------------------------------------
// 1) Bölünmemiş görevler → iki alt görev (çekirdek + arayüz/çevre)
// ---------------------------------------------------------------------------
const SPLITS = {
  300: [
    { code: 'MASK-CORE', label: 'OPUS-XHIGH',
      text: 'Saf maskeleme çekirdeği: sensitive-mask.ts + 8 dedektör + yazar politikası + cc-mask sarmalayıcı + Türkçe test seti',
      details: 'apps/api/src/lib/sensitive-mask.ts maskSensitive(text, {author, policy}) → {text, detections}; üst görevdeki DEDEKTÖRLER ve POLİTİKA (AI-26-S2) aynen; cc-mask.ts geriye uyumlu sarmalayıcı; packages/types SENSITIVE_TYPES + yazar politikası + uyarı metinleri. Regex\'ler önceden derlenmiş ve geri izlemesiz. Çağrı noktalarına BAĞLAMA YOK (300.2). Kabul: üst görevin ilk üç kabul maddesi (maskelenenler, maskelenmeyenler, BIP-39) birim testle.',
      test: 'Türkçe pozitif/negatif örnek seti (cc-mask.test.ts yanında) + geri izleme (ReDoS) testi; `pnpm test:gate`.' },
    { code: 'MASK-WIRE', label: 'OPUS-HIGH', deps: [1],
      text: 'Maskelemeyi bütün yazma yollarına, log, AI ve LLM prompt\'una bağla + uyarı olayı + rozet/bilgi sayfası/widget uyarısı',
      details: 'maskSensitive üst görevdeki ÇAĞRI NOKTALARI\'na (satırlar kaymış olabilir — kod haritasıyla doğrula) SIRA ilkesiyle bağlanır: kalıcı yazım, RTM, log, spam filtresi ve AI\'dan önce; AI yanıtı gönderim öncesi + LLM prompt (savunma derinliği) + AI-22/23/24 kayıtları; UYARI system olayı (sohbet × tür bir kez, oyuncunun dili) + sensitive_shared; web Transcript rozeti + Ayarlar › Güvenlik › Hassas veri bilgi sayfası; widget uyarı mesajı. Kabul: üst görevin son üç kabul maddesi.',
      test: 'Her yazma yolu için entegrasyon (cc-masking.test.ts genişler), log redaksiyonu, mock prompt kontrolü, rozet e2e; `pnpm test:gate`.' },
  ],
  328: [
    { code: 'OT-CORE', label: 'OPUS-XHIGH',
      text: 'Sahiplik devri çekirdeği: kontrat + ownership_transfers (RLS, kısmi tekil) + servis + tek-Kurucu takası + e-posta + audit',
      details: 'contract (4 uç) + prisma ownership_transfers + RLS + kısmi tekil (license_id) WHERE state=\'pending\' + services/team/ownership-transfer.ts + ownershipTransfer e-posta şablonu + audit eylemleri; başlatma (şifre/2FA yeniden, hedef koşulları), kabul tek işlemde (önce eski Kurucu admin, sonra hedef owner), SSO ve fatura iletişimi kuralları, Yöneticilere bilgi e-postası, S3 runbook notu. Kabul: üst görevin bütün kabul maddeleri API düzeyinde.',
      test: 'Entegrasyon: 403, yanlış şifre/2FA, 72 saat düşme, iptal, tek-Kurucu indeksi her ifadede, askıdaki/doğrulanmamış hedef; `pnpm test:gate`.' },
    { code: 'OT-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Sahiplik devri arayüzü: Ayarlar › Şirket "Tehlikeli bölge", kabul sayfası, bekleyen devir bandı',
      details: 'web: hedef seçimi, şifre/2FA, workspace adını yazarak onay; token\'lı kabul sayfası; bekleyen devir bandı + iptal; SSO notu ekranda; i18n (TRANSLATED_FILES). ' + UI_NOTE,
      test: 'Birim + e2e (başlat → kabul → rol değişimi görünür); `pnpm test:gate`.' },
  ],
  334: [
    { code: 'TL-API', label: 'OPUS-HIGH',
      text: 'Zaman çizelgesi API: kontrat + audit_log indeksi + kaynakları birleştirme/sayfalama/görünürlük + maskeli akışlı dışa aktarma',
      details: 'contract (GET timeline, POST export) + audit_log (license_id, target, created_at) indeksi (CONCURRENTLY, kendi dosyası) + services/chat/timeline.ts (kaynaklar, (at, kind_sırası, id) birleştirme ve sayfalama, görünürlük, görünmeyen 404) + akışlı dışa aktarma (≤20.000, varsayılan maskeli, maskesiz yalnız export_unmasked, audit chat.timeline_exported) + yetenekler (timeline.view/export/export_unmasked).',
      test: 'Entegrasyon (birleştirme/sıralama, 404, maskeleme + audit); `pnpm test:gate`.' },
    { code: 'TL-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Zaman çizelgesi ekranı: TimelinePage, sayfa içi süzme, bağlantı ayırıcıları, dışa aktarma modali',
      details: 'features/timeline/TimelinePage.tsx; üst görev KURALLAR\'ının arayüz maddeleri (sanallaştırma YOK, 200 satırlık sayfalar, sayfa içi süzme, workspace TZ + UTC tooltip, bağlantı ayırıcıları, saklama notu); dışa aktarma modali; Inbox\'tan giriş. ' + UI_NOTE,
      test: 'e2e (Inbox\'tan aç, AI karar satırını bul, CSV indir, "Thread ID (chat_id)" başlığı); `pnpm test:gate`.' },
  ],
  335: [
    { code: 'AR-API', label: 'OPUS-HIGH',
      text: 'Arşiv API: archive.yaml + iki CONCURRENTLY migration + threads.handled_by + archive-service (görünürlük WHERE\'de, N+1 yok)',
      details: 'contract paths/archive.yaml (liste + detay) + iki ayrı CONCURRENTLY migration + threads.handled_by (kapanışta; #293 yüklemiyle) + services/archive/archive-service.ts + routes/archive.ts (withTenant + resolveVisibility WHERE içinde, ilk mesaj tek sorguda, keyset, total_capped) + KURALLAR\'ın sunucu tarafı.',
      test: 'Entegrasyon (satır = bağlantı, 3 bağlantılı oyuncu 3 satır, görünürlük, saklama süresi dolmuş satır); `pnpm test:gate`.' },
    { code: 'AR-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Arşiv ekranı: /app/archive, salt okunur transkript, oyuncu paneli, "Inbox\'ta aç"',
      details: 'features/archive/ ArchivePage + gezinme girişi + salt okunur transkript + oyuncu paneli + "Inbox\'ta aç / yeniden aç" + "Aynı günü grupla" anahtarı + i18n. ' + UI_NOTE,
      test: 'e2e; `pnpm test:gate`.' },
  ],
  336: [
    { code: 'AF-API', label: 'OPUS-HIGH',
      text: 'Arşiv filtreleri API: parametreler + dizi kolonları/GIN + geri doldurma + filtre derleyicisi',
      details: 'contract parametreleri + prisma (threads.agent_ids, threads.risk_flags GIN, ratings indeksi) + sayfalı geri doldurma (ayrı migration) + archive-service filtre derleyicisi (kiracı TZ gün sınırı, etiket any/all/exclude, LATERAL puan, görünürlük WHERE\'de, handled_by #293 yüklemi) + PERFORMANS (EXPLAIN kanıtı).',
      test: 'Entegrasyon (her filtre ve birleşimleri) + EXPLAIN; `pnpm test:gate`.' },
    { code: 'AF-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Arşiv filtre çubuğu: çipler, popover\'lar, tarih kaydırma, URL ↔ filtre (yalnız kimlik)',
      details: 'ArchiveFilters.tsx; URL ↔ filtre dönüştürücüsü yalnız kimlikler (GV-05); çelişen filtre uyarısı; EÜ için ajan filtresi "ben"; kayıtlı filtreler kişisel. ' + UI_NOTE,
      test: 'Birim (URL dönüştürücü) + e2e; `pnpm test:gate`.' },
  ],
  352: [
    { code: 'CMC-ENGINE', label: 'OPUS-HIGH',
      text: 'Çok koşullu hedefleme çekirdeği: v2 tipler + dönüşüm migration + kural motoru + /customer/visit + istemci koşullu teslim',
      details: 'types/contract CampaignConditions v2 + eski {url_contains} dönüşümü + veri dönüştürme migration\'ı + visits.variables + sunucu kural motoru + POST /customer/visit (oran sınırı, debounce) + istemci kuralları için "bekleyen koşul" ve "gösterildi" teslim damgası + KURALLAR\'ın sunucu tarafı.',
      test: 'Entegrasyon (her alan/operatör, all/any, eski kampanya); `pnpm test:gate`.' },
    { code: 'CMC-CLIENT', label: 'SONNET-HIGH', deps: [1],
      text: 'Hedefleme istemcisi: loader sayfa değişimi/çıkış niyeti/süre + setSessionVariables + kampanya kural editörü',
      details: 'loader/widget: pushState/popstate → iframe mesajı (debounce), siyahtus(\'setSessionVariables\'), çıkış niyeti, sayfada kalma zamanlayıcısı, yalnız mint bayrağı olan kiracıda; CampaignBuilder kural editörü (match all/any, satır ekle/sil). ' + UI_NOTE,
      test: 'Widget birim + e2e; `pnpm test:gate`.' },
  ],
  366: [
    { code: 'CP-API', label: 'OPUS-HIGH',
      text: 'Copilot sor API: /copilot/ask sınıflandırma + KB RAG + BI kapısı + kota + audit',
      details: 'contract POST /copilot/ask + routes/copilot.ts sınıflandırma (BI sözlüğü + dil modeli; LLM ADR §6) + BI yolu reports_read + KB yolu AI-14 tek depo RAG (#309) + "bilmiyorum" + kullanım sayacı/kota + audit (soru metni yok).',
      test: 'Entegrasyon (KB cevabı + kaynak, yetkisiz rol, kota); `pnpm test:gate`.' },
    { code: 'CP-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Copilot çekmecesi: AppShell\'de her ekrandan, ortak BI/KB bileşenleri, oturum geçmişi',
      details: 'components/CopilotDrawer.tsx (rota değişiminde açık kalır, modal değil, odak yönetimi), CopilotPanel\'den ortak BI/KB bileşenleri, Inbox sohbet eylemleri, oturum geçmişi (zustand), "yanıta ekle", kısayol; i18n. ' + UI_NOTE,
      test: 'e2e (Raporlar\'da kısayolla aç, kaynaklı cevap); `pnpm test:gate`.' },
  ],
  368: [
    { code: 'RF-API', label: 'OPUS-HIGH',
      text: 'Rapor filtreleri API: tek filterClause tüm uçlarda + dışa aktarma/paylaşım/zamanlı + ekip kapsamı kesişimi',
      details: 'ReportFilter contract tüm rapor uçlarına; rangeQuery → reportQuery, report-csv.ts tek filterClause; export, paylaşım linki ve zamanlanmış rapor filters JSONB; YETKİ kesişimi sunucuda; migration (CONCURRENTLY ayrı dosya); "tüm uçlar filtreyi uyguluyor" testi zorunlu.',
      test: 'Entegrasyon (her uç, kesişim, boş kesişim); `pnpm test:gate`.' },
    { code: 'RF-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Rapor filtre çubuğu: çoklu seçim, URL\'de yalnız ID, kayıtlı görünümler, derin linkler',
      details: 'Çoklu seçimli filtre çubuğu, URL\'de yalnız kimlik, kayıtlı görünümler filtreyi saklar, ekip/üye sayfalarında "Raporları gör"; Ekip Liderinde kilitli ekip seçici. ' + UI_NOTE,
      test: 'e2e; `pnpm test:gate`.' },
  ],
  369: [
    { code: 'ME-API', label: 'OPUS-HIGH',
      text: 'Kaçan sohbet verisi ve rapor uçları: initiated_by/needs_human_since/missed_reason + geri doldurma + iki uç',
      details: 'threads.initiated_by/needs_human_since/missed_reason + CHECK; oturum oluşturmada initiated_by; kapanışta missed_reason (bir kez); kısmi geri doldurma migration\'ı + rapor notu; report-csv.ts yardımcıları + GET /reports/missed, /reports/engagement + export; RP-01 filtreleri (#368 hazırsa).',
      test: 'Entegrasyon (AI ile kapanan kaçan değil, devir sonrası kaçan, kuyruk terki); `pnpm test:gate`.' },
    { code: 'ME-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Kaçan sohbet ve etkileşim sekmeleri + ısı haritası',
      details: 'İki sekme + ısı haritası bileşeni (staffing ile ortak, kiracı TZ) + "bilinmiyor" gösterimi. ' + UI_NOTE,
      test: 'e2e; `pnpm test:gate`.' },
  ],
  390: [
    { code: 'AGENT-API', label: 'OPUS-HIGH',
      text: 'AI ajanı API: POST/GET/PATCH /ai-agents (instruction) + tek ajan kısmi tekili + mobil parity',
      details: 'Üst görev AMAÇ (1) ve (5), KARARLAR 2–3: kontrat POST/GET /ai-agents + PATCH instruction (prompt\'a GİRMEZ); kısmi tekil (license_id) WHERE kind=\'ai_agent\' (önce seed ölçümü, gerekirse NOT VALID yolu), ikinci → 409 ai_agent_exists, Assumption PLAN §D218; mobil tipler + parity 224→226 yorumla (389.13/389.15 sıra tuzağı HANDOFF\'a).',
      test: 'Entegrasyon + mobil parity; `pnpm test:gate`.' },
    { code: 'AGENT-WEB', label: 'SONNET-HIGH', deps: [1],
      text: 'Playbook › AI Agent düzeni: genel/davranış/beceriler/bilgi sekmeleri, boş durum kartı, Ayarlar girişi, komut paleti',
      details: 'Üst görev AMAÇ (2)–(4), KARARLAR 1, 4, 5 ve TUZAKLAR: PLAYBOOK_TABS kayıt noktası, behaviour sekmesi iskeleti (kimlik SABİT), ?view=profile → general geriye dönük eşleme, boş durumda "AI ajanı ekle" kartı, settings-sections.ts ai_agent girişi, komut paleti, TRANSLATED_FILES, widget karşılama alanı marka kuralı. ' + UI_NOTE,
      test: 'e2e playbook*.spec, kb-tabs, skill-tabs; `pnpm test:gate`.' },
  ],
};

// ---------------------------------------------------------------------------
// 2) Alt görevli görevlerde parça ayırma (çekirdek etiketi md'deki gibi kalır)
// ---------------------------------------------------------------------------
const SUB_SPLITS = [
  { parent: 289, edit: { id: 3, code: 'AIJ-WORKER', label: 'OPUS-XHIGH',
      text: 'ai-job-worker çekirdeği: claim/lease, LISTEN/NOTIFY + yoklama, tazelik (120 sn → expired + iç not + insan), uygunluk, idempotens, sohbet içi sıra, çökme denemeleri, kapanışta drain' },
    add: { id: 5, code: 'AIJ-FOLLOWUPS-HEALTH', label: 'OPUS-HIGH', deps: ['289.3'],
      text: 'follow-ups.ts AI dalının işçiye taşınması (kural botu + atanan bildirimi aynı işte, bugünkü sırayla) + /health ai_jobs {pending, oldest_age_s}',
      details: 'Üst görev YAPILACAK\'taki "follow-ups.ts AI dalı işçiye taşınır" ve "/health ai_jobs" maddeleri; reportComponentStatus yardımcısı varsa kullan. İşçi API\'si 289.3\'te bitti. ' + PARENT_NOTE(289),
      test: 'Entegrasyon (sıra: kural botu → AI → atanan bildirimi; /health sayıları); `pnpm test:gate`.' },
    depAdd: [{ id: 4, dep: '289.5' }] },
  { parent: 293, edit: { id: 2, code: 'AI-FIRST-START', label: 'OPUS-XHIGH',
      text: 'Önce-AI başlangıcı (atamasız, kuyruk dışı, ai görünümü, eşzamanlı sınır tüketilmez) + assignment_mode ayarı (ai_first|parallel)' },
    add: { id: 6, code: 'AI-STALL-WATCHDOG', label: 'OPUS-HIGH', deps: ['293.2'],
      text: 'Bekçi işi: oyuncu mesajından sonra ai_stall_timeout_seconds (60) içinde bot olayı/devir yoksa zamanlanmış iş ai_failure ile insana yönlendirir',
      details: 'Üst görev BEKÇİ maddesi (jobs.ts); ai_handoff_settings.ai_stall_timeout_seconds; yönlendirme devir yolundan (AI-12 gelene kadar mevcut route). ' + PARENT_NOTE(293),
      test: 'Entegrasyon (takılan sohbet süresinde insana; cevap gelmişse dokunulmaz); `pnpm test:gate`.' } },
  { parent: 296, edit: { id: 3, code: 'PROC-EXECUTOR', label: 'OPUS-XHIGH',
      text: 'executor.ts: adım döngüsü (tur başına ≤8 iç adım), procedure_snapshot, konu değişimi/askı, max_turns', addDep: '296.7' },
    add: { id: 7, code: 'PROC-CONDITIONS-TEMPLATES', label: 'OPUS-HIGH', deps: ['296.1'],
      text: 'conditions.ts (Cond ağacı: all|any|not|slot|fact|fn|ai, op listesi, sabit fn listesi, fact stub arayüzü) + templates.ts (kalıp doldurma; eksik değişkende gönderme yok + hata kaydı) — saf modüller',
      details: 'Üst görev TANIM\'daki Cond ve templates kuralları; serbest ifade/eval YOK; tipler 296.1\'de. Executor (296.3) bunları kullanır. ' + PARENT_NOTE(296),
      test: 'Birim (her op, iç içe koşul, eksik değişken); `pnpm test:gate`.' } },
  { parent: 314, edit: { id: 2, code: 'SIM-RUNNER', label: 'OPUS-MAX',
      text: 'runner.ts (senaryo başına boş durum, tur başına yapılandırma sürümü, donmuş saat, araç taklitleri, durma koşulları) + simülasyon bağlamı yazma kalkanı', addDep: '314.6' },
    add: { id: 6, code: 'SIM-CHECKS-PLAYER', label: 'OPUS-XHIGH', deps: ['314.1'],
      text: 'checks.ts (KESİN KONTROLLER: sonuç/hedef ekip, prosedür, zorunlu bilgiler, yasaklı ifade, hassas veri isteme, bayraklar, tur sayısı) + simulated-player.ts (SCENARIO_PERSONAS)',
      details: 'Üst görev KESİN KONTROLLER ve TİPLER (persona listesi); runner (314.2) bunları çağırır. ' + PARENT_NOTE(314),
      test: 'Birim (her kontrol geç/kal, persona çıktısı deterministik mock); `pnpm test:gate`.' } },
  { parent: 316, edit: { id: 1, code: 'VER-SCHEMA', label: 'OPUS-XHIGH',
      text: 'ai_config_versions + ai_agents.published_version_id/draft_revision + knowledge_chunks görünürlük kolonları ve indeks + geri dolum v1' },
    add: { id: 5, code: 'VER-COMPILER', label: 'OPUS-HIGH', deps: ['316.1'],
      text: 'config-compiler.ts: taslak → derlenmiş paket + doğrulama (adımlar, AI-07 çelişki, devir hedefleri) + fark özeti + touches_compliance',
      details: 'Üst görev "Servisler config-compiler.ts" ve AKIŞ\'taki gönderme doğrulaması; iş akışı uçları (316.2) bunu çağırır. ' + PARENT_NOTE(316),
      test: 'Birim (geçerli/geçersiz taslak, fark, uyum dokunuşu tespiti); `pnpm test:gate`.' },
    depAdd: [{ id: 2, dep: '316.5' }] },
  { parent: 316, edit: { id: 3, code: 'VER-RUNTIME-CACHE', label: 'OPUS-XHIGH',
      text: 'Çalışma anı sürüm sabitleme + config-cache (sürüme göre) + realtime-bus geçersizleştirme + arama görünürlük süzgeci' },
    add: { id: 6, code: 'VER-SCHEDULED-JOBS', label: 'OPUS-HIGH', deps: ['316.3'],
      text: 'Zamanlı işler: ai_scheduled_publish (dakikada, kilitli) + knowledge_chunk_gc (5 sürüm + 30 günden eski gizli parçalar)',
      details: 'Üst görev ZAMANLAYICI maddesi; yayın yolu 316.2/316.3\'teki tek transaction\'ı çağırır. ' + PARENT_NOTE(316),
      test: 'Entegrasyon (zamanı gelen onaylı sürüm yayınlanır, kilit çift yayını önler, gc sınırları); `pnpm test:gate`.' } },
  { parent: 324, edit: { id: 2, code: 'ROLE-API', label: 'OPUS-XHIGH',
      text: 'Rol değiştirme (team_lead), grup liderliği (admin+), davet akışı (RL-04-S1), principal + RTM rol listeleri, SCIM, seed' },
    add: { id: 4, code: 'ROLE-WEB', label: 'SONNET-HIGH', deps: ['324.2'],
      text: 'RoleMenu (ROLE_RANK @siyahtus/types\'tan), Türkçe rol etiketleri, TeamEditor lider anahtarı, InviteTeammates ekip seçimi, mobil etiketler',
      details: 'Üst görev "web:" maddesi + mobil etiketler; i18n (TRANSLATED_FILES). ' + UI_NOTE + ' ' + PARENT_NOTE(324),
      test: 'Birim + e2e (team_lead daveti ekip zorunlu, liderlik anahtarı); `pnpm test:gate`.' } },
];

// ---------------------------------------------------------------------------
const raw = fs.readFileSync(TASKS, 'utf8');
if (JSON.stringify(JSON.parse(raw), null, 2) !== raw) throw new Error('tasks.json gidiş-dönüş birebir değil — dur');
const data = JSON.parse(raw);
const tasks = data.master.tasks;
const byId = (id) => {
  const t = tasks.find((x) => String(x.id) === String(id));
  if (!t) throw new Error(`görev yok: ${id}`);
  return t;
};
const log = [];
const mdEdits = new Map(); // id → içerik
const mdOf = (id) => {
  if (!mdEdits.has(id)) mdEdits.set(id, fs.readFileSync(MD(id), 'utf8'));
  return mdEdits.get(id);
};
const setMd = (id, s) => mdEdits.set(id, s);

const mdBlock = (pid, s, label, code, text) =>
  `### ${pid}.${s.id}. ${mdTitle(code, label, text)}\n\n**Status:** ${s.status}  \n` +
  `**Dependencies:** ${s.dependencies.length ? s.dependencies.join(', ') : 'None'}  \n\n${s.details}\n`;

const mkSub = (parent, id, def, deps) => ({
  id,
  title: fullTitle(def.code, def.label, def.text),
  description: def.text,
  details: def.details,
  testStrategy: def.test,
  status: 'pending',
  dependencies: deps,
  parentId: String(parent.id),
  priority: parent.priority,
  updatedAt: NOW,
});

// 0) Etiket eşitleme: task_*.md (senin gözden geçirmen) → tasks.json
for (const t of tasks) {
  if (t.status === 'done') continue;
  let md;
  try { md = fs.readFileSync(MD(t.id), 'utf8'); } catch { continue; }
  const mTitle = (md.match(/^\*\*Title:\*\*.*$/m) || [''])[0].match(LABEL_RE);
  const jt = t.title.match(LABEL_RE);
  if (mTitle && jt && mTitle[1] !== jt[1]) {
    t.title = t.title.replace(LABEL_RE, `[${mTitle[1]}]`).replace(/\((?:Opus|Sonnet) 5\.5\)/, `(${modelOf(mTitle[1])})`);
    log.push(`etiket #${t.id}: ${jt[1]} → ${mTitle[1]}`);
  }
  for (const s of t.subtasks || []) {
    if (s.status === 'done') continue;
    const h = md.match(new RegExp(`^### ${t.id}\\.${s.id}\\. .*$`, 'm'));
    const ml = h && h[0].match(LABEL_RE);
    const jl = s.title.match(LABEL_RE);
    if (ml && jl && ml[1] !== jl[1]) {
      s.title = s.title.replace(LABEL_RE, `[${ml[1]}]`).replace(/\((?:Opus|Sonnet) 5\.5\)/, `(${modelOf(ml[1])})`);
      s.updatedAt = NOW;
      log.push(`etiket ${t.id}.${s.id}: ${jl[1]} → ${ml[1]}`);
    }
  }
}

// 1) Bölünmemiş görevleri böl
for (const [id, defs] of Object.entries(SPLITS)) {
  const t = byId(id);
  if ((t.subtasks || []).length) throw new Error(`#${id} zaten alt görevli`);
  if (t.status !== 'pending') throw new Error(`#${id} pending değil (${t.status})`);
  t.subtasks = defs.map((d, i) =>
    mkSub(t, i + 1, { ...d, details: `${d.details} ${PARENT_NOTE(id)}` }, (d.deps || []).map((n) => `${id}.${n}`)));
  t.updatedAt = NOW;
  log.push(`böl #${id}: ${defs.map((d, i) => `${id}.${i + 1} ${d.code} [${d.label}]`).join(' + ')}`);
  if (!fs.existsSync(MD(id))) { log.push(`  (task_${id}.md yok — yalnız tasks.json)`); continue; }
  let md = mdOf(id);
  if (/^## Subtasks/m.test(md)) throw new Error(`#${id} md'de zaten Subtasks var`);
  md = md.replace(/\n*$/, '\n') + '\n## Subtasks\n\n' +
    t.subtasks.map((s, i) => mdBlock(id, s, defs[i].label, defs[i].code, defs[i].text)).join('\n');
  setMd(id, md);
}

// 2) Alt görev parça ayırma
for (const sp of SUB_SPLITS) {
  const t = byId(sp.parent);
  const s = t.subtasks.find((x) => x.id === sp.edit.id);
  if (!s || s.status !== 'pending') throw new Error(`${sp.parent}.${sp.edit.id} yok ya da pending değil`);
  if (t.subtasks.some((x) => x.id === sp.add.id)) throw new Error(`${sp.parent}.${sp.add.id} zaten var`);
  // düzenlenen alt görev
  s.title = fullTitle(sp.edit.code, sp.edit.label, sp.edit.text);
  s.description = sp.edit.text;
  if (sp.edit.addDep && !s.dependencies.includes(sp.edit.addDep)) s.dependencies.push(sp.edit.addDep);
  s.updatedAt = NOW;
  // yeni alt görev
  const n = mkSub(t, sp.add.id, sp.add, sp.add.deps);
  t.subtasks.push(n);
  for (const d of sp.depAdd || []) {
    const x = t.subtasks.find((y) => y.id === d.id);
    if (x && x.status !== 'done' && !x.dependencies.includes(d.dep)) { x.dependencies.push(d.dep); x.updatedAt = NOW; }
  }
  t.updatedAt = NOW;
  // md: düzenlenen başlığı ve bağımlılıkları güncelle, yeni bloğu düzenlenenin arkasına ekle
  let md = mdOf(sp.parent);
  const headRe = new RegExp(`^### ${sp.parent}\\.${sp.edit.id}\\. .*$`, 'm');
  if (!headRe.test(md)) throw new Error(`md başlığı yok: ${sp.parent}.${sp.edit.id}`);
  md = md.replace(headRe, `### ${sp.parent}.${sp.edit.id}. ${mdTitle(sp.edit.code, sp.edit.label, sp.edit.text)}`);
  for (const x of t.subtasks) {
    const blockRe = new RegExp(`(^### ${sp.parent}\\.${x.id}\\. .*\\n\\n\\*\\*Status:\\*\\* .*\\n\\*\\*Dependencies:\\*\\* )([^\\n]*?)(  \\n)`, 'm');
    md = md.replace(blockRe, (_, a, _b, c) => a + (x.dependencies.length ? x.dependencies.join(', ') : 'None') + c);
  }
  const nextHead = new RegExp(`^### ${sp.parent}\\.(\\d+)\\. `, 'gm');
  const heads = [...md.matchAll(nextHead)];
  const idx = heads.findIndex((h) => Number(h[1]) === sp.edit.id);
  const block = mdBlock(sp.parent, n, sp.add.label, sp.add.code, sp.add.text) + '\n';
  md = idx + 1 < heads.length
    ? md.slice(0, heads[idx + 1].index) + block + md.slice(heads[idx + 1].index)
    : md.replace(/\n*$/, '\n') + '\n' + block.replace(/\n$/, '');
  setMd(sp.parent, md);
  log.push(`parça ${sp.parent}.${sp.edit.id} ${sp.edit.code} [${sp.edit.label}] + ${sp.parent}.${sp.add.id} ${sp.add.code} [${sp.add.label}]`);
}

// 3) 07-gorev-plani "Alt" sütunu
let plan07 = fs.readFileSync(PLAN07, 'utf8');
for (const id of new Set([...Object.keys(SPLITS), ...SUB_SPLITS.map((s) => String(s.parent))])) {
  const count = byId(id).subtasks.length;
  const re = new RegExp(`^(\\| ${id} \\| [^|]+\\| [^|]+\\| [^|]+\\| [^|]+\\| )([^|]+)( \\|)`, 'm');
  if (!re.test(plan07)) { log.push(`07: #${id} satırı bulunamadı`); continue; }
  plan07 = plan07.replace(re, (_, a, _b, c) => `${a}${count}${c}`);
}

// Çıktı
console.log(log.join('\n'));
console.log(`\nToplam: ${log.length} değişiklik; md dosyaları: ${[...mdEdits.keys()].join(', ')}`);
if (!APPLY) { console.log('\nKURU KOŞU — yazmak için --apply'); process.exit(0); }
fs.writeFileSync(TASKS, JSON.stringify(data, null, 2));
for (const [id, s] of mdEdits) fs.writeFileSync(MD(id), s);
fs.writeFileSync(PLAN07, plan07);
console.log('\nYazıldı.');
