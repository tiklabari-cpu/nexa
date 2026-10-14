# Task ID: 366

**Title:** COPILOT-DRAWER [OPUS-HIGH] Her ekrandan açılabilen Copilot çekmecesi: POST /copilot/ask (KB / BI sınıflandırma), kaynaklı cevap, reports_read kapısı, kota, oturum içi geçmiş

**Status:** pending

**Dependencies:** 309 ⏱, 283 ⏱

**Priority:** medium

**Description:** Copilot yalnız Inbox'ta sohbete bağlı; Raporlar ya da Ayarlar'dayken bilgi/rapor sorusu sorulamıyor. Kaynak: IN-09.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-09. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: CopilotPanel.tsx, useCopilot.ts, panelTab.ts; openapi.yaml:332-343 (/copilot/knowledge, summary|reply|enhance, /copilot/bi); command-palette.ts /palette/ai-query; AppShell.tsx:92-97; plugins/ai-budget.ts.
contract: POST /copilot/ask {question ≤2000, context? {route, chat_id?}} → {answer, sources[{id,title,reviewed_at}], kind kb|bi|unknown, reason?}; hatalar ai_daily_cap, no_answer.
api: routes/copilot.ts; sınıflandırma (BI niyet sözlüğü + dil modeli — AI-16 #283 sağlayıcı soyutlaması, LLM ADR §6: tools/response_format yok); BI yolu reports_read (RL-02); KB yolu AI-14 tek depoda "Copilot kullanır" işaretli kaynaklardan RAG (#309); bilgi yoksa "bilmiyorum"; kullanım sayacı; audit yalnız copilot.ask sayısı (soru metni YOK); pilot kota.
web: components/CopilotDrawer.tsx (AppShell, rota değişiminde açık, modal değil, odak yönetimi), BI/KB bölümleri CopilotPanel'den ortak bileşene; Inbox'ta sohbet eylemleri (özet, taslak); oturum geçmişi zustand (yenilemede silinir); kaynak listesinde reviewed_at; "yanıta ekle" offerDraft yolu, oyuncuya otomatik gitmez; kısayol IN-08 kaydına (#365 varsa).

KABUL KRİTERLERİ:
- Raporlar sayfasında kısayolla çekmece açılır.
- "Papara çekim limiti" bilgi kaynağından cevap + kaynak adı.
- Rapor yetkisiz EÜ'ye "bu soruyu sorma yetkiniz yok".
- Sayfa değişince çekmece ve konuşma korunur, yenilemede temizlenir.

KULLANILAN VARSAYIMLAR:
- K11: tek depo, "kim kullanır" seçimi.

**Test Strategy:**

copilot-ask.test.ts (yetkisiz BI, kota, kiracılar arası kaynak), birim, e2e copilot-drawer.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
