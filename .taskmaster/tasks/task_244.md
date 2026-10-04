# Task ID: 244

**Title:** V8-CAMP-REACHED [SONNET-XHIGH] "reached N visitors" bildirimi artık hiç görünmüyor — tm 214'ün yan etkisi (CampaignsPage.tsx/CampaignBuilder.tsx)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** tm 214 (V8-CAMP-DELIV) `campaignPerformance`in `displayed`ini `delivered_at`e gore saymaya duzeltti — dogru metrik. Ama iki frontend yeri ayni `performance.displayed` alanini FARKLI bir anlam icin okuyor: "az once kac ziyaretciye ulasildi" bildirimi. Kampanya olusturma/aktivasyon aninda eslesen gonderim henuz teslim edilmedigi icin (teslimat yalniz widget'in yoklamasindan sonra olur) bu alan artik HER ZAMAN 0 donuyor — bildirim bir daha asla gorunmuyor.

**Details:**

GEREKCE: `apps/web/src/features/campaigns/CampaignBuilder.tsx:76-78` — `onSaved({ campaign: saved, reached: saved.performance.displayed })`, yorum "performance.displayed is how many it just reached". `apps/web/src/features/campaigns/CampaignsPage.tsx:83-90` — `toggle` mutation'ının `onSuccess`'i `campaign.performance.displayed > 0` ise "reached N visitors" banner'ı gosteriyor (`campaigns.page.notice.reached.*`, en+tr).

tm 214'ten ONCE: `campaignPerformance` her `campaign_sends` satirini (teslim edilmis/edilmemis fark etmeksizin) saydigi icin, kampanya olusturulur/aktive edilir OLUSTURULMAZ `displayed` az once eslesen ziyaretci sayisini veriyordu — bildirim anlamli calisiyordu.

tm 214 SONRA: `displayed` yalniz `delivered_at IS NOT NULL` satirlari sayiyor (dogru tanim, FR-MOD-03.3.1-.3). Ama eslesme ANINDA hicbir gonderim teslim edilmemis olur (teslimat `apps/api/src/services/campaigns/campaign-delivery.ts`nin widget yoklamasindan gecer, senkron degil) — yani POST/PATCH'in DONDUGU CEVAPTA `displayed` HER ZAMAN 0'dir, kac ziyaretci eslesirse eslessin. Sonuc: `reached` bildirimi/`onSaved` sayaci artik hicbir zaman > 0 olmuyor, banner hicbir zaman gorunmuyor. Hicbir mevcut test bunu yakalamiyor (e2e/`campaigns.spec.ts` metni kontrol etmiyor, unit testler mock veriyle statik).

KARAR GEREKEN SORU: "reached" bildirimi "kac ziyaretciye ULASILDI (delivered)" mi soylemeli (o zaman dogru sayı gecikmeli/asla gelmeyebilir — cogu ziyaretci hemen ayrilabilir), yoksa "kac ziyaretciyle ESLESTI (matched, will-be-delivered)" mi soylemeli (o zaman backend'in ayrı bir alan dondurmesi gerekir, `displayed` bu ikisini artik ayni degil)? Ikinci secenek muhtemelen dogru olan: POST/PATCH `Campaign` yanitina `performance.displayed`e dokunmadan ayrı bir `matched`/`reached` sayisi eklemek (contract degisikligi — yeni alan, mevcut alan degismez) ya da create/activate rotasinin kendi cevabinda ayri donen bir sayi (orn. `#fireIfRunning`in zaten dondurdugu `result.count`, `campaign-service.ts:338`) frontend'e tasinabilir.

DOKUNULACAK: `apps/api/src/services/campaigns/campaign-service.ts` (create/activate akisi zaten `#fireIfRunning`den bir sayi aliyor, DTO'ya tasinmiyor) · `packages/contract/openapi` (yeni alan gerekirse) · `apps/web/src/features/campaigns/CampaignBuilder.tsx` + `CampaignsPage.tsx` · ilgili testler.

KAPSAM SINIRI: `campaignPerformance`/`displayed`in tanimi DEGISMEZ (tm 214'un kararı dogru) — bu gorev yalniz bildirimin HANGI SAYIYI okudugunu duzeltir.

**Test Strategy:**

Unit: create/activate akisinin dondurdugu "matched/reached" sayisi teslim durumundan bagimsiz olarak az once eslesen ziyaretci sayisini veriyor. Integration: kampanya olusturulur olusturulmaz (hicbir teslimat olmadan) bildirim sayisi > 0. Frontend: `CampaignBuilder.test.tsx`/`CampaignsPage.test.tsx` yeni alanı okuyor, "reached" banner'i gercek eslesme sayisinda goruyor.
