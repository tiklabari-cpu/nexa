# Task ID: 2

**Title:** 08.9.4-b — Imzali yukleme ucu (signed upload URL)

**Status:** pending

**Dependencies:** 1

**Priority:** high

**Description:** Kod tabaninda hicbir yukleme ucu yok: openapi.yaml'in 55 yolunun hicbirinde upload/presign gecmiyor. Mimari karar zaten verilmis — server.ts:69 bodyLimit'i 1 MiB'e sabitlemis ve yorumu 'attachments go through signed upload URLs' diyor. Yani multipart API'den GECMEZ.

**Details:**

POST /api/v1/uploads -> {upload_url, file_url, expires_at}. Tur/boyut SecuritySettings'ten okunur (gorev 1). Depolama anahtari license kapsamli olmali (cross-tenant okuma olmasin). bodyLimit 1 MiB'e dokunma — dosya API uzerinden akmiyor. Kontrat once: openapi.yaml -> generate -> route.

PRD: FR-MOD-08.9.4 · PLAN.md §3.7 · Dilim 13

**Test Strategy:**

Kabul: uc, tur/boyut sinirlarini SecuritySettings'ten okur ve izinsiz tur icin URL URETMEZ. Cross-tenant: A lisansinin anahtari B'nin dosyasina erisemez. Regresyon: server.ts bodyLimit 1 MiB degismedi.
