# Task ID: 269

**Title:** ADR-SKILL-PROCEDURE [OPUS-HIGH] ADR-14a ek notu: Skill çok turlu prosedür olabilir (görsel akış yine yok)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** ADR-14 "tek paradigma = Skill (adım listesi), workflow UI yok" diyor. AI-03 Skill'i çok turlu prosedüre genişletiyor (adımlar cevabı bekleyebilir, koşul taşıyabilir). Sahip kararı K8 bunu onayladı; kilitli karar sessizce delinmesin diye ek not yazılır. Kaynak: AI-03, AI-28.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-03, AI-28. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK:
- PLAN.md §0 ADR tablosunun ALTINA (satır değiştirmeden) "ADR-14a — Skill çok turlu olabilir" eki: Skill `mode: 'single' | 'procedure'`; adım listesi korunur; adımlara koşul (`when`, `check`) ve "cevap bekle" (`collect`) eklenir; `workflows` tablosu ve node/edge tuvali YOK; SOP metninden taslak üreten yardımcı (K8) serbest. Araç yuvası (AI-28 `call_tool`/`tool`) da bir Skill adım tipidir, ayrı akış aracı değildir.
- docs/adr/ altında kısa bir karar dosyası (ör. docs/adr/skill-procedure.md): bağlam (05 §1.0 tablo satırı 1, 04 AI-03), karar, sonuçlar, K8 referansı, tarih.
- PLAN.md §D bölümüne sapma satırı (CONVENTIONS kanıt disiplini: hücreye kanıt yazılmaz).
KAPSAM DIŞI: kod değişikliği yok.

KABUL KRİTERLERİ:
- PLAN.md §0 altında ADR-14a eki var ve K8'e atıf yapıyor; ADR tablosunun mevcut satırları değişmedi.
- docs/adr/ karar dosyası var.
- AI-03 (#296) ve AI-28 (#321) görevleri bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- Ek not PLAN §0 tablosunun altına paragraf olarak yazılır; tablo satırı eklenmez (tablo "yeniden tartışılmaz" listesi).

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check` yeşil; PLAN.md tablo satır uzunluğu denetimi (C-plan-row-length) bozulmaz. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
