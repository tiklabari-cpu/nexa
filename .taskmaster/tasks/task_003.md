# Task ID: 3

**Title:** 08.9.4-c — attachment_url'i kendi depomuza kilitle [MAX]

**Status:** done

**Dependencies:** 2 ✓

**Priority:** high

**Description:** GUVENLIK ACIGI: chats.ts:25 attachment_url'i sadece z.string().url().max(2048) ile doguluyor. Su an bir agent veya musteri BUYUK HERHANGI BIR host'u isaret edebilir — bizim imzaladigimiz dosya oldugu hicbir yerde kontrol edilmiyor. Event.attachmentUrl (schema.prisma:396) bu ham degeri sakliyor.

**Details:**

Yalniz gorev 2'nin urettigi imzali yoldan gelen URL kabul edilir. NFR-S10 + MASTER-PROMPT [MAX] kurali: NEGATIF TESTLER POZITIFLERDEN ONCE yazilir. En az su dordu: (a) yabanci host URL'i reddedilir, (b) MIME spoof reddedilir, (c) maxFileSizeBytes asimi reddedilir, (d) baska lisansin dosya anahtari reddedilir. Hata zarfi ADR-06.

PRD: FR-MOD-08.9.4 (NFR-S10) · PLAN.md §3.7 · Dilim 13 · [MAX]

[günlük 2026-07-24 04:03 UTC] [MAX] kirmizi teyidi: (a) yabanci host TESTI DUSTU — https://evil.example/tracker.png 201 ile kabul edildi, acik dogrulandi. TUZAK: (b)(c)(d) YESIL geldi ama YANLIS SEBEPTEN — z.string().url() goreli yollari reddediyor, guvenlik kontrolu oldugu icin degil. Ayni sebeple 'kendi dosyamizi kabul et' testi de 400 aliyor. Yani mevcut kod tam ters: her host kabul, kendi dosyamiz red. Yesil negatif testin nedenini dogrulamadan gecmek bu isin en buyuk tuzagi.

[günlük 2026-07-24 04:05 UTC] KAPANIS [MAX]: acik kapatildi. chats.ts:25 z.string().url() kaldirildi; assertAttachment uc sey dogruluyor — (1) deger bizim /api/v1/uploads/ yolumuz (URL parse DEGIL, tek prefix + anahtar deseni; //evil.example, @, yuzde-kodlu ayirici gibi normalize edilmesi gereken her sey desende dusuyor), (2) anahtardaki lisans caginin kendi lisansi, (3) baytlar gercekten diskte (LocalStore.exists — grant yuklemek icin izindir, iddia etmek icin degil). Ucu de ayni mesajla reddediliyor. Iki cagri noktasi da baglandi: POST /chats initial_event ve POST /chats/:id/events.

[günlük 2026-07-24 04:05 UTC] (b)(c)(d) artik DOGRU sebepten yesil: (c) 'grant alinmis ama yuklenmemis' testi yalnizca store.exists sayesinde geciyor — sekil ve lisans dogru oldugu icin diger iki kontrol onu durdurmuyor. (a) 201->400, 'kendi dosyamiz' 400->201: iki yon de tersine dondu, kontrol gercekten calisiyor.

**Test Strategy:**

[MAX] — NEGATIF TESTLER ONCE YAZILIR VE KIRMIZI GORULUR: (a) yabanci host URL'i reddedilir, (b) MIME spoof reddedilir, (c) maxFileSizeBytes asimi reddedilir, (d) baska lisansin dosya anahtari reddedilir. Dordu de ADR-06 zarfi doner. ANCAK SONRA pozitif akis yazilir. E2E: ekli dosya karsi tarafta acilir.
