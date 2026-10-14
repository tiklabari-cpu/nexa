# Task ID: 328

**Title:** OWNERSHIP-TRANSFER [OPUS-MAX] Sahiplik (Kurucu) devri: şifre/2FA ile başlatma, devralanın 72 saat içinde e-posta tokenıyla kabulü, eski Kurucu Yönetici olur

**Status:** pending

**Dependencies:** 324 ⏱, 327 ⏱

**Priority:** low

**Description:** Kurucu ayrılırsa SSO, BAA, sandbox, font gibi yalnız-Kurucu ayarları kilitli kalır; bugün yolu yok (agents.ts:666-670 açıkça reddediyor). ChatBot.com'da "Transfer ownership" sessizce çalışmıyordu — tekrarlanmamalı. Kaynak: RL-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RL-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 4 — roller ve yetki matrisi.

[MAX] authZ (tek Kurucu kısıtı, rol geçişi).
contract: POST /ownership-transfers (target_agent_id, password, totp?), GET /ownership-transfers/current, POST …/{id}/accept (token), DELETE …/{id}.
prisma: ownership_transfers (id, license_id, from_account_id, to_account_id, token_hash, state, expires_at, created_at, decided_at) + RLS + kısmi tekil (license_id) WHERE state='pending'.
api: services/team/ownership-transfer.ts; e-posta şablonu ownershipTransfer (messages.ts); audit ownership.transfer_requested|accepted|cancelled|expired. Başlatma: şifre (+2FA) yeniden; hedef aynı lisansın aktif, e-postası doğrulanmış üyesi; workspace 2FA zorunluysa hedefin 2FA'sı açık. Kabul: giriş yapmış + token (72 saat, RL-05-S1); tek işlemde önce eski Kurucu admin'e (S2), sonra hedef owner (tek-Kurucu kısmi indeksini her ifadede sağlar); SSO zorunluysa yeni Kurucu muaf, eski zorunluluğa girer (ekranda yazılır); fatura iletişimi geçer ya da sorulur; tüm Yöneticilere bilgi e-postası.
web: Ayarlar › Şirket "Tehlikeli bölge" (hedef, şifre/2FA, workspace adını yazarak onay), kabul sayfası, bekleyen devir bandı.
KAPSAM DIŞI (S3): Kurucuya ulaşılamıyorsa panel yolu yok — platform destek ekibinin kimlik doğrulamalı manuel süreci (runbook notu).

KABUL KRİTERLERİ:
- Yalnız Kurucu başlatır; başkasına 403.
- Yanlış şifre/2FA ile başlatma reddedilir.
- 72 saat içinde kabul edilmezse düşer; Kurucu iptal edebilir.
- Kabulde tam bir Kurucu; eski Kurucu Yönetici; ilgili audit eylemleri.
- Askıdaki ya da e-postası doğrulanmamış üyeye başlatılamaz.

KULLANILAN VARSAYIMLAR:
- RL-05-S1/S2/S3.
- P2 → low.

**Test Strategy:**

Entegrasyon, e2e (apps/e2e/tests/mailbox.ts ile); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
