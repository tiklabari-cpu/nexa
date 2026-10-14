# Task ID: 326

**Title:** TEAM-LEAD-CAPABILITIES [OPUS-XHIGH] Ekip Lideri yetenekleri: kendi ekibinin sohbetlerini izleme/devralma/yeniden atama, "Ekibim" görünümü, ekip kapsamlı raporlar (sunucuda zorunlu)

**Status:** pending

**Dependencies:** 325 ⏱

**Priority:** medium

**Description:** iGaming vardiyasında ilk eskalasyon noktası Ekip Lideri. Bugün devralma tüm sohbet yetkisi + admin istiyor (chats.ts:452-469); "yalnız kendi ekibimde devral" yok; raporlarda ekip/ajan filtresi yok. Kaynak: RL-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RL-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 4 — roller ve yetki matrisi.

XHIGH GEREKÇESİ: (1) yetkili endpoint kapsam genişletmesi.
api: ledGroupIds(tx, accountId) (group_agents.is_lead #324); devralma, transfer, yeniden atama: tüm sohbet yetkisi YA DA (yetenek chats.takeover_team + sohbetin ekipleri ∩ liderin ekipleri — HERHANGİ biri yeterli; aynı gün farklı ekiplere giden bağlantılar için kesişim kuralı); rota chats--access:rw kabul eder, asıl kontrol serviste; raporlarda EL için sunucu tarafında zorunlu ekip kapsamı (RP-01 #368 filtresiyle); audit mevcut eylemler (chat.taken_over).
contract: GET /chats view=team; rapor uçlarına group_id[] (RP-01 ortak).
web: Inbox "Ekibim" görünümü (AI'ın yürüttükleri dahil), satırda İzle/Devral; raporlarda ekip seçici (liderde kilitli). QA ve taslak ekranları AI maddelerinde (#316, #319).
RL-03-S1: EL ekip üyeliğini yönetmez (Yönetici); S2: AI değişikliğini yayınlayamaz (dört göz); S3: başka ekibin sohbetini devralamaz (matriste açılabilir).
"Bota geri ver" ve devralma sonrası susma AI-11 (#293).

KABUL KRİTERLERİ:
- EL kendi ekibindeki aktif sohbeti izler ve devralır; audit.
- EL başka ekibin sohbetini devralmaya çalışınca 404 (matriste açılmadıysa).
- EL raporlarda yalnız kendi ekiplerinin sayılarını görür; URL değiştirerek başkasına ulaşamaz.
- EÜ devralma düğmesini görmez; uca 403.

KULLANILAN VARSAYIMLAR:
- RL-03-S1/S2/S3.

**Test Strategy:**

Entegrasyon (devralma, 404, rapor kapsamı), e2e inbox-supervised.spec.ts genişler; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
