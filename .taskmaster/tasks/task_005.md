# Task ID: 5

**Title:** 02.3.5 + 11.4 — Attach (agent composer + widget composer)

**Status:** pending

**Dependencies:** 2, 3

**Priority:** high

**Description:** Iki composer'da da attach eksik. PLAN.md 3.2'ye gore F5'te '#' canned secicisi geldi ama attach gelmedi; 11.4 ayni sekilde kismi. chats.ts:89 zaten 'metin YA DA attachment' invariant'ini uyguluyor — sunucu tarafi hazir, istemci tarafi yok.

**Details:**

apps/web/src/features/inbox (agent) + apps/widget/src/widget.ts (musteri). Ikisi de gorev 2'nin ucunu kullanir, gorev 3'un kurallarina tabidir. Istemci tarafi tur/boyut kontrolu YALNIZ kullanici deneyimi icindir; reddin gercek yeri sunucudur. E2E: apps/e2e/tests/widget.spec.ts'e ek akis.

PRD: FR-MOD-02.3.5 + FR-MOD-11.4 · PLAN.md §3.2 / §3.9 · Dilim 13

**Test Strategy:**

Kabul: iki composer'da da dosya eklenir, gonderilir, karsi tarafta gorunur. Regresyon: metinsiz+eksiz gonderim engellenir (chats.ts:89 invariant'i). Playwright: apps/e2e/tests/widget.spec.ts'e musteri akisi + inbox'a agent akisi.
