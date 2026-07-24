# Task ID: 7

**Title:** 08.5.2-b — Website widgets ekrani + dogrulama sinyali

**Status:** pending

**Dependencies:** 5

**Priority:** high

**Description:** PRD: + Add website / Install code manually / Invite developer; site tablosu (per-row get code / remove); Customize widget girisi; platform ikonlari. PRD KK2 ayrica kod yerlestikten sonra 'test message received' dogrulama sinyali istiyor — bu Nexa iyilestirmesi, taklit degil.

**Details:**

apps/web/src/features/settings altina. Snippet </body> oncesine yerlesir ve mevcut widget loader'i ile uyumlu olmali (apps/widget/src/loader.ts, window.__lc). Trusted domains (08.9.1, Dilim 2'de teslim) ile ayni domain listesini gostermeye dikkat — iki ayri kaynak olmasin.

PRD: FR-MOD-08.5.2 (KK1, KK2) · PLAN.md §3.7 · Dilim 13

**Test Strategy:**

Kabul: snippet </body> oncesine yerlesir; kod calisinca status Connected'a doner VE 'test message received' dogrulama sinyali gorunur (KK2). Playwright: sahte sayfaya snippet enjekte -> handshake -> UI'da Connected. Trusted domains ile ikili domain kaynagi olusmadigi dogrulanir.
