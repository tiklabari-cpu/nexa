# Task ID: 354

**Title:** CAMPAIGN-DELETE-REPORT-TEMPLATES [SONNET-HIGH] (Sonnet 5.5) Kampanya arşivleme (yumuşak silme) + kopyalama + kampanya raporu (gösterim, tıklama, sohbet, dönüşüm, bastırılan; CSV) + TR iGaming şablon galerisi

**Status:** pending

**Dependencies:** 353 ⏱, 350 ⏱

**Priority:** medium

**Description:** Kampanya silinemiyor; kampanya raporu yok (yalnız kart sayıları); şablon yok. Kaynak: EN-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: EN-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: routes/campaigns.ts:90/:101/:122 (DELETE yok); campaign-matching.ts:201 campaignPerformance; reports.ts (yalnız goals/sales); playbook/templates.ts deseni.
prisma: campaigns.archived_at (liste varsayılanı archived_at IS NULL).
contract/api: DELETE /campaigns/{id} (arşivler; inactive, yeniden etkinleştirilemez, yalnız kopyalanabilir; bekleyen gönderimler teslim edilmez — pickDeliverableSend inactive'i eler), POST /campaigns/{id}/duplicate; GET /reports/campaigns?from&to&campaign_id[] günlük gruplu (campaign_sends; bastırılan EN-01 #350; tıklama EN-02 #353; dönüşüm converted ile aynı tanım) + CSV/PDF grubu (report-csv.ts, ADR-09 tek kaynak).
web: satır menüsü (Kopyala, Sil onaylı), features/campaigns/templates.ts (Karşıla/Yardım et/Promosyon; promosyonlar kind:'promotion'), rapor sekmesi.
KVKK: arşivli kampanyaların campaign_sends'i müşteri silme akışına dahil (mevcut kapsam kontrol edilir).

KABUL KRİTERLERİ:
- Silinen kampanya listeden kalkar ve ateşlenmez; rapordaki geçmiş durur.
- Kopyalama aynı ayarlarla pasif kampanya oluşturur.
- Rapor ve CSV aynı sayılar.
- Şablondan oluşturulan kampanya düzenlenebilir taslak.

KULLANILAN VARSAYIMLAR:
- Varsayılan: tüm kampanyalar bayraklıya bastırılır (promosyon olmayan istisnası sonraki karar).

**Test Strategy:**

Entegrasyon (arşiv ateşlenmez, rapor kalır, CSV eşitliği), e2e; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
