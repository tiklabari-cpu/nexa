# Task ID: 10

**Title:** 08.5.3 — Email kanali (forwarding -> ticket)

**Status:** pending

**Dependencies:** 7

**Priority:** medium

**Description:** Ticketing cekirdegi Dilim 11'de teslim edildi (apps/api/src/routes/tickets.ts). Bu is gelen e-postayi o cekirdege baglar.

**Details:**

Kanal yuzeyi kart gridinden yonetilir. Gonderen e-postasi mevcut bir customer'a eslesirse yeni kayit acilmaz. Spam/dogrulama: SecuritySettings.spamFilterEnabled zaten semada var — kullan.

PRD: FR-MOD-08.5.3 · PLAN.md §3.7 · Dilim 13

**Test Strategy:**

Kabul: gelen e-posta ticket'a donusur ve dogru lisansa duser. Mevcut customer eslesirse IKINCI KAYIT ACILMAZ — bunu dogrulayan test zorunlu. Negatif: spamFilterEnabled acikken spam gonderim ticket uretmez.
