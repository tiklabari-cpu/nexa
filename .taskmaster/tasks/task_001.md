# Task ID: 1

**Title:** 08.9.4-a — SecuritySettings dosya alanlarini yuzeye cikar

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** schema.prisma:849-851'deki fileSharingEnabled/allowedFileTypes/maxFileSizeBytes sutunlari var ama hicbir yerden okunmuyor: openapi.yaml'da /settings/security yok, settings.ts route'unda gecmiyor, web'de ekrani yok. Olu sutunlari kontrata ve UI'a bagla.

**Details:**

1) packages/contract/openapi/openapi.yaml: /settings/security ekle (GET + PATCH). Mevcut /settings/* yollari 169-179 arasinda; ayni desene uy. 2) @nexa/types generate. 3) apps/api/src/routes/settings.ts: license kapsamli handler; PATCH'te allowedFileTypes MIME dogrulamasi. 4) apps/web Settings altinda Security ekrani. Hata zarfi ADR-06. PRD: FR-MOD-08.9.4 · PLAN.md §3.7 · Dilim 13

**Test Strategy:**

Kabul: GET /settings/security lisans kapsamli doner; baska lisansin ayarina erisim ADR-06 zarfiyla reddedilir. PATCH gecersiz MIME'i reddeder. Birim: MIME allowlist dogrulayicisi. Cross-tenant testi ZORUNLU. Bitince PLAN.md §3.7 satiri guncellenir.
