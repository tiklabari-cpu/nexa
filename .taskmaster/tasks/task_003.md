# Task ID: 3

**Title:** 08.9.4-c — attachment_url'i kendi depomuza kilitle [MAX]

**Status:** pending

**Dependencies:** 2

**Priority:** high

**Description:** GUVENLIK ACIGI: chats.ts:25 attachment_url'i sadece z.string().url().max(2048) ile doguluyor. Su an bir agent veya musteri BUYUK HERHANGI BIR host'u isaret edebilir — bizim imzaladigimiz dosya oldugu hicbir yerde kontrol edilmiyor. Event.attachmentUrl (schema.prisma:396) bu ham degeri sakliyor.

**Details:**

Yalniz gorev 2'nin urettigi imzali yoldan gelen URL kabul edilir. NFR-S10 + MASTER-PROMPT [MAX] kurali: NEGATIF TESTLER POZITIFLERDEN ONCE yazilir. En az su dordu: (a) yabanci host URL'i reddedilir, (b) MIME spoof reddedilir, (c) maxFileSizeBytes asimi reddedilir, (d) baska lisansin dosya anahtari reddedilir. Hata zarfi ADR-06.

PRD: FR-MOD-08.9.4 (NFR-S10) · PLAN.md §3.7 · Dilim 13 · [MAX]

**Test Strategy:**

[MAX] — NEGATIF TESTLER ONCE YAZILIR VE KIRMIZI GORULUR: (a) yabanci host URL'i reddedilir, (b) MIME spoof reddedilir, (c) maxFileSizeBytes asimi reddedilir, (d) baska lisansin dosya anahtari reddedilir. Dordu de ADR-06 zarfi doner. ANCAK SONRA pozitif akis yazilir. E2E: ekli dosya karsi tarafta acilir.
