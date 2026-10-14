# Task ID: 277

**Title:** INBOX-DRAFT-ISOLATION [OPUS-HIGH] Inbox: yazılan taslağın ve ekin başka oyuncunun sohbetine geçmesini engelle + sohbet başına taslak

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Composer metni, eki, modu ve öneri çiplerini bileşen state'inde tutuyor ve sohbet değişince sıfırlanmıyor (InboxPage.tsx:883-890 `<Composer chatId={selectedId}>` key almıyor). A oyuncusuna yazılan metin/dekont B'de Enter ile B'ye gider: KVKK ihlali ve itibar riski. Bağımsız ve en önce yapılmalı; IN-08 hızlı geçiş kısayolları bundan sonra. Kaynak: IN-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

KOD (2026-10-14, doğrulandı): apps/web/src/features/inbox/Composer.tsx:97-113 yerel state; :116 useSendMessage(chatId); :212-227 submit; :173-175 yalnız "yazıyor" kapatma. copilotDraft.ts sohbet bazlı zustand deposu (desen). InboxPage.tsx:883-890 key yok.
KATMANLAR: yalnız web (contract/Prisma/API/RTM değişmez).
MANTIK:
1) Güvenlik düzeltmesi önce ve tek başına yayınlanabilir: `<Composer key={selectedId} …>`; sohbet değişince metin, ek, mod, açık seçici, çipler sıfırlanır; useSendMessage bileşenin kendi chatId'sine bağlı.
2) Taslak deposu `features/inbox/composerDrafts.ts`: chatId → {text, mode, updatedAt}; mount'ta okunur, ~300 ms gecikmeyle yazılır; başarılı gönderim, arşivlenme, başkasına geçme (RTM chat_deactivated / chat_transferred / chat_taken_over) sonrası silinir.
3) Ek dosya taslağa GİRMEZ (bilinçli güvenlik tercihi).
4) Saklama: localStorage anahtarı `siyahtus.drafts.<licenseId>.<accountId>`, kayıt başına 24 saat TTL, çıkışta (lib/auth-store.ts) tamamen silinir, sunucuya gönderilmez.
5) Kenar: iki sekmede storage olayı, kutu boşsa doldur; Copilot offerDraft mevcut taslağın üstüne onaysız yazmaz; iç not modu geri yüklenince mod da "not".

KABUL KRİTERLERİ:
- A'da metin yazıp B'ye geçince B'nin kutusu boş; B'de Enter hiçbir mesaj göndermez.
- A'ya dönünce metin ve modu (yanıt/not) geri gelir.
- A'da eklenen dosya B'de görünmez; A'ya dönünce de yoktur.
- Gönderimden sonra taslak silinir, yenilemede gelmez; 24 saat içinde yenilemede gönderilmemiş taslak gelir; çıkış-giriş sonrası gelmez.
- Sohbet başka ajana aktarılınca taslak silinir.

KULLANILAN VARSAYIMLAR:
- IN-01-S1: taslak yalnız tarayıcıda, 24 saat, çıkışta silinir.
- IN-01-S2: aktarım/kapanışta taslak silinir.

**Test Strategy:**

Önce hatayı yeniden üreten e2e (apps/e2e/tests/inbox-draft.spec.ts) KIRMIZI, düzeltme sonrası yeşil. Birim: Composer.draft.test.tsx. DoD: `pnpm test:gate` (arka planda) + inbox e2e. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 277.1. DRAFT-KEY-FIX [OPUS-HIGH] Composer'ı sohbet kimliğiyle anahtarla + hatayı üreten e2e

**Status:** pending  
**Dependencies:** None  

Güvenlik düzeltmesi: key={selectedId}; e2e önce kırmızı (hata üretimi), sonra yeşil. Tek başına commit/merge edilebilir.

### 277.2. DRAFT-STORE [SONNET-HIGH] Sohbet başına taslak deposu (localStorage, 24 saat, çıkışta silme)

**Status:** pending  
**Dependencies:** 277.1  

composerDrafts.ts (copilotDraft.ts deseni), RTM ile silme, iç not modu geri yükleme, Copilot üzerine yazma onayı.
