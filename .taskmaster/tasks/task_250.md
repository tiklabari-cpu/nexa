# Task ID: 250

**Title:** V8-NOTIF-BADGE [OPUS-XHIGH] notifications.spec.ts:89 kararsiz: ajanin sekme basligi rozeti yukselmiyor (ve ayni dosyanin :24'u durum sizintisiyla donusumlu dusuyor)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Ajan Inbox'tan Reports'a gectikten sonra acilan soket okunmamis uyarisini kaldiramiyor; sekme basligi 20 sn boyunca "SiyahTuş" kaliyor, "(1) SiyahTuş" olmuyor. tm 248 turunda tam suitte olculdu ve ATIF DOGRULANDI: tm 248'in butun kaynak degisiklikleri geri alinip kosuldugunda ayni kirmizi cikiyor, yani bu diff'ten gelmiyor. Ayni dosyanin :24'u paylasilan tohumdan sizan durumla donusumlu dusuyor. Izole kosuda 1,2 dk'da yeniden uretiliyor.

**Details:**

OLCUM (tm 248, 2026-09-12). Imza: apps/e2e/tests/notifications.spec.ts:163 -- await expect.poll(() => agentPage.title()).toBe("(1) SiyahTuş") 20 sn boyunca "SiyahTuş" okuyor; ajanin sekme basligi rozeti hic yukselmiyor. Test, ajan Inbox'tan Reports'a gectikten SONRA acilan bir soketin hala okunmamis uyarisi kaldirabildigini iddia ediyor.

**Test Strategy:**

No test strategy provided.
