# Task ID: 16

**Title:** 13.8 — Bildirimler (ses/masaustu/tarayici/e-posta)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Yeni mesaj/atama bildirimleri: ses, masaustu (Notification API), tarayici baslik/favicon, e-posta (mock mailer). Ayardan ac/kapa.

**Details:**

PRD: FR-MOD-13.8 · PLAN.md §3.10 · Dilim 14. Client: apps/web/src/features/inbox/useInbox.ts (RTM olaylari) -> yeni bildirim hook'u; masaustu izni. Server e-posta: apps/api/src/services/mail/mailer.ts (mock, .data/mail). Realtime kaynak: apps/api/src/services/realtime/publisher.ts. Ayar yuzeyi settings. E2E kanit/.

**Test Strategy:**

Yeni mesajda ses + masaustu (Notification API) + baslik bildirimi; e-posta mock kutusuna (.data/mail) duser; ayardan kapatinca bildirim gelmez (NEGATIF test); izin reddedilince sessiz degrade. Gorsel kanit kanit/<id>-*.png.
