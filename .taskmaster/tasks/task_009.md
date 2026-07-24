# Task ID: 9

**Title:** 08.5.9 — Chat page (hosted link)

**Status:** pending

**Dependencies:** 5

**Priority:** medium

**Description:** PRD KK3: site kurulumu olmadan da sohbet edilebilen paylasilabilir link. 'Get link' CTA'si kart gridinden gelir.

**Details:**

Musteri Chat API'si (apps/api/src/routes/customer.ts) ve widget zaten var — bu is yeni bir sohbet motoru degil, mevcut widget'i barindirilmis bir sayfada acmaktir. Trusted domains kontrolunun bu yolda nasil davranacagina karar ver (kendi barindirdigimiz sayfa allowlist'e tabi mi?) — karar PLAN.md C'ye yazilir.

PRD: FR-MOD-08.5.9 (KK3) · PLAN.md §3.7 · Dilim 13

**Test Strategy:**

Kabul: link ile acilan sayfada site kurulumu OLMADAN sohbet baslar ve agent inbox'ina duser. Playwright: link -> mesaj -> inbox'ta gorunur. Trusted domains karari PLAN.md §C'ye yazilmis olmali.
