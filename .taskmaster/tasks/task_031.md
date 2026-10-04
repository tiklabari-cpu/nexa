# Task ID: 31

**Title:** 13.8 — E-posta bildirim kanalı

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Bildirim tercihine e-posta + sunucu tetik (yeni sohbet/atama) → FileMailer (A4). PRD 13.8/08.2 Must (§D20).

**Details:**

T7-a — E-posta bildirim kanalı. [XHIGH] · Must (MVP), Faz-0 ◐ (§D20).
PRD: FR-MOD-13.8 (+ FR-MOD-08.2).
NEDEN AÇIK: apps/web/src/features/notifications/notifications.ts yalnız {enabled, sound, desktop}; e-posta
kanalı yok. SMTP mock (apps/api/src/services/mail/mailer.ts, A4) var ama bildirime bağlı değil.
KAPSAM: kullanıcı tercihi `email: boolean`; sunucu tarafı tetik — yeni sohbet/atama/mention olayında ilgili
ajanlara FileMailer ile e-posta (mock, .data/mail). Tercih kullanıcı bazında.
KK (PRD birebir): "Bkz. FR-MOD-08.2; kanallar arası tutarlı" · 08.2: "ses/masaüstü/e-posta/tarayıcı bildirim
tercihleri (yeni sohbet/atama/mention); kullanıcı bazında".
KAPSAM DIŞI: mobil push (🔒 v1); e-posta şablon markası (08.7.5, v1); gerçek SMTP (§9).
BAĞLAM: PLAN.md §3.13/T7-a, §D20, A4. Bağımlılık: yok. (49 Chat transcripts bu mailer desenine dayanır.)

**Test Strategy:**

integration: atama olayında hedef ajanın posta kutusuna (.data/mail) mesaj düşüyor; tercih kapalıyken düşmüyor.
CROSS-TENANT: başka lisansın ajanına gitmiyor. unit: karar fonksiyonu (hangi kanal ateşlenir). DoD kapısı tam.
