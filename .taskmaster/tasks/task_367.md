# Task ID: 367

**Title:** EVENT-NOTIFICATIONS-REPEAT [SONNET-HIGH] (Sonnet 5.5) Olay bazlı bildirim tercihleri (gelen sohbet, bana/ekibime aktarıldı, kuyruk, yeni ticket, ticket yanıtı) + okunana kadar tekrarlayan ses (lider sekme) + ticket RTM push'ları

**Status:** pending

**Dependencies:** 361 ⏱

**Priority:** medium

**Description:** Bildirim kararı yalnız oyuncu mesajı için; ses tek seferlik; ticket olayları RTM'e gitmiyor. Kaynak: IN-10.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-10. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: notifications.ts:70-100 decideNotification; useNotifications.ts:107-114; NotificationSettings.tsx (5 anahtar); types/notifications.ts:57-120; schema:260-274 notify_*; RTM incoming_chat, incoming_event, chat_transferred, chat_taken_over, traffic_visitor_updated; tickets.ts:212 (RTM yok); services/push.
prisma: agent_memberships.notify_events jsonb DEFAULT '{}' (eksik anahtar varsayılan), notify_repeat_sound boolean DEFAULT false.
types/contract: NotificationPreferences.events {incoming_chat, transferred_to_me, transferred_to_my_team, queue_waiting, new_ticket, ticket_reply}, repeat_sound; readNotificationPreferences geriye uyumlu.
api: RTM incoming_ticket ve ticket_message_created (HD-01 #356 geldiğinde; o gelmeden yalnız incoming_ticket), kitle atanan + takipçiler + ekip; Ekip Liderlerine queue_updated; mobil push olay tercihine uyar.
web: decideNotification olay türüne göre; soundRepeater (ilk ses + her 10 sn; sohbet açılınca / useMarkSeen / 2 dk dolunca durur; tek zamanlayıcı en eski okunmamışa göre; odaktaki ekranda çalmaz); BroadcastChannel lider sekme; ilk tıklamada "sesleri etkinleştir" ipucu; ayar ekranında olay listesi, "yeni mesaj" kilitli açık (ses kanalı kapatılabilir), GV-06 kalıbı (kişisel tercih anında kayıt — InstantToggle).
KURAL: ana anahtar kapalıysa hiçbir ses; tekrar varsayılan KAPALI (04 IN-10 S1).

KABUL KRİTERLERİ:
- "Yeni ticket" açıkken atanan ticket için ses + masaüstü bildirimi; kapalıyken yok.
- "Tekrarla" açıkken okunmamış mesajda 10 sn'de bir ses; sohbet açılınca durur.
- İki sekmede ses bir kez.
- Ana anahtar kapalıyken hiçbir şey çalmaz.
- Mobil push olay tercihine uyar.

KULLANILAN VARSAYIMLAR:
- Tekrarlayan ses varsayılan kapalı.

**Test Strategy:**

decideNotification birim matrisi, tercih entegrasyonu, e2e notifications.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
