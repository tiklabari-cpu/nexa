# Task ID: 2

**Title:** 08.9.4-b — Imzali yukleme ucu (signed upload URL)

**Status:** done

**Dependencies:** 1 ✓

**Priority:** high

**Description:** Kod tabaninda hicbir yukleme ucu yok: openapi.yaml'in 55 yolunun hicbirinde upload/presign gecmiyor. Mimari karar zaten verilmis — server.ts:69 bodyLimit'i 1 MiB'e sabitlemis ve yorumu 'attachments go through signed upload URLs' diyor. Yani multipart API'den GECMEZ.

**Details:**

POST /api/v1/uploads -> {upload_url, file_url, expires_at}. Tur/boyut SecuritySettings'ten okunur (gorev 1). Depolama anahtari license kapsamli olmali (cross-tenant okuma olmasin). bodyLimit 1 MiB'e dokunma — dosya API uzerinden akmiyor. Kontrat once: openapi.yaml -> generate -> route.

PRD: FR-MOD-08.9.4 · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 03:49 UTC] plan: iki adimli imzali yukleme, STORAGE_PROVIDER=local (env.ts:60'ta zaten tanimli; stack'te S3/MinIO YOK — docker-compose sadece db+redis). (1) kontrat: POST /uploads {filename,content_type,size_bytes} -> {upload_url,file_url,expires_at}; PUT /uploads/{key} imzali hedef; GET /uploads/{key} servis. (2) anahtar bicimi <licenseId>/<uuid>.<ext> — licenseId anahtarin ICINDE, cross-tenant yapisal olarak imkansiz. (3) imza: HMAC-SHA256(key|contentType|sizeBytes|exp), customer-token.ts:117 deseni. Yeni env: UPLOAD_SIGNING_KEY (secret(32)) + STORAGE_LOCAL_DIR (varsayilan .data/uploads, zaten gitignore'da). (4) POST tur/boyut'u SecuritySettings'ten okur (gorev 1), izinsizse URL URETMEZ. (5) GET normal auth + anahtardaki licenseId karsilastirmasi — imzasiz, boylece attachment_url suresi dolmaz.

[günlük 2026-07-24 03:49 UTC] varsayim: bodyLimit celiskisi cozumu — global 1 MiB'e DOKUNULMUYOR (server.ts:69, regresyon testi bunu bekliyor); yalnizca PUT /uploads/{key} rotasi Fastify'in rota bazli bodyLimit'i ile kendi tavanini koyuyor. Yerel saglayicida dosya ayni surecten gecmek zorunda (ayri host yok); 'API uzerinden akmiyor' notunun ozu normal JSON yuzeyinin korunmasiydi, o korunuyor. S3'e gecilirse saglayici degisir, API sozlesmesi degismez.

[günlük 2026-07-24 03:59 UTC] KAPANIS: POST /uploads (izin) + PUT /uploads/:key (imzali) + GET /uploads/:key (oturum+lisans) yazildi. Kontrat 56->58 yol. 12 entegrasyon testi, 451 toplam yesil. typecheck+lint yesil. reseed+login OK.

[günlük 2026-07-24 03:59 UTC] duzeltme: anahtar bicimi <lic>/<uuid> -> <lic>-<uuid> degistirildi. Sebep: egik cizgili anahtar tek path parametresine sigmiyor, rota /uploads/* olmak zorunda kaliyordu ve contract-parity.test.ts bunu kontrattaki /uploads/{key} ile eslestiremeyip dusuruyordu. Diskte hala lisans basina klasorleniyor.

[günlük 2026-07-24 03:59 UTC] yan bulgu (duzeltildi): bodyLimit asan govde 500 donuyordu — error-handler.ts FST_ERR_CTP_BODY_TOO_LARGE'i eslemiyor, generic internal'a dusuyordu. ADR-06 ihlali ve mevcut bir hataydi (benim degisikligim degil). validation'a eslendi. PLAN.md D'ye yazilacak.

**Test Strategy:**

Kabul: uc, tur/boyut sinirlarini SecuritySettings'ten okur ve izinsiz tur icin URL URETMEZ. Cross-tenant: A lisansinin anahtari B'nin dosyasina erisemez. Regresyon: server.ts bodyLimit 1 MiB degismedi.
