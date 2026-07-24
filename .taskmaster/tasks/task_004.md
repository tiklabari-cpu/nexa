# Task ID: 4

**Title:** 08.9.4-d — Virus taramasi

**Status:** done

**Dependencies:** 2 ✓

**Priority:** medium

**Description:** PRD FR-MOD-08.9.4 'izinli tur/boyut + virus tarama' diyor; tarama ayagi hic yok. PLAN.md bunu Cikarim (AV) olarak isaretlemis — yani PRD'de arac adi yok, karar bize ait.

**Details:**

Tarama tamamlanana kadar dosya musteriye servis EDILMEZ (event gorunur olmadan once temiz olmali). Secilen arac ve neden PLAN.md C (Assumptions) bolumune yazilir. Tarama basarisizsa event reddedilir, sessizce gecilmez.

PRD: FR-MOD-08.9.4 · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 13:57 UTC] plan+varsayim: Virus taramasi (08.9.4-d). PRD arac adi vermiyor -> KARAR (PLAN.md §C'ye): VirusScanner soyutlamasi + mock provider (EICAR imzasini yakalar, gerisi temiz); gercek = ClamAV/clamd ileride (STORAGE gibi provider deseni). NEDEN: yerel/mock ortam, deterministik test; fail-closed davranis kritik. Tarama YERI: PUT /uploads/:key'de store.put ONCESI -> temiz olmayan bayt HIC saklanmaz -> GET yalniz temiz dosya servis eder -> event (attachment_url) yalniz saklanmis=temiz dosyaya baglanir (event oluşmaz transitif: dosya yoksa assertUploadedAttachment reddeder). Enfekte -> ApiError.validation(400). FAIL-CLOSED: scanner.scan throw ederse (erisilemez) -> service_unavailable(503), saklanmaz. env VIRUS_SCANNER=mock|unavailable(test/drill). Testler (negatif ONCE): EICAR PUT->400 + GET->404 (servis edilmez); fail-closed (VIRUS_SCANNER=unavailable server) clean PUT->503 + GET->404; pozitif temiz PUT->201 (mevcut testler). Dosya: services/storage/virus-scanner.ts + uploads.ts + env.ts + uploads.test.ts.

[günlük 2026-07-24 14:04 UTC] bitti: Virus taramasi (08.9.4-d). services/storage/virus-scanner.ts: VirusScanner arayuzu + MockVirusScanner (EICAR imzasini yakalar) + UnavailableVirusScanner (fail-closed drill) + assertClean(scanner,bytes) [enfekte->validation 400, erisilemez->service_unavailable 503]. env VIRUS_SCANNER=mock|unavailable. uploads.ts PUT: store.put ONCESI assertClean -> temiz olmayan bayt HIC saklanmaz. Testler (negatif once): EICAR PUT->400 + GET->404 (servis edilmez); enfekte dosya event OLUSTURAMAZ (attachment_url->400); fail-closed VIRUS_SCANNER=unavailable ile clean PUT->503 + GET->404. api 484 test, typecheck+lint temiz, e2e attachments regresyon yok, demo login OK. VARSAYIM (PLAN.md §C'ye, /dilim-kapat'ta): arac=mock scanner (EICAR), gercek=ClamAV provider deseni; neden=deterministik test + fail-closed kritik. Yalniz apps/api degisti; UI/kontrat degismedi (gorsel kanit gerekmez).

**Test Strategy:**

Kabul: taranmamis dosya musteriye servis EDILMEZ. Negatif: EICAR test dosyasi reddedilir, event olusmaz. Tarayici erisilemezse dosya KABUL EDILMEZ (fail-closed) — bu davranis testle sabitlenir, varsayima birakilmaz.
