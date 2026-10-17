# ADR-09a — Devredilmiş ama ajanın yazmadığı thread "AI çözümü" sayılmaz

- **Görev:** tm 272 (ADR-AI-RESOLUTION) · PLAN.md §0 (ADR-09a eki) · §D221
- **Tarih:** 2026-10-14
- **Durum:** Kabul edildi — sahip kararı **K10** ("AI'ın devrettiği ama ajanın hiç yazmadığı sohbetler 'AI çözümü' sayılıp faturalansın mı?" → **Hayır**, varsayılan onaylandı) ve **K27** (ADR başına bir görev) (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı). Fatura tanımı için **AI-25-S1** varsayılanı (F1'de fatura ADR-09 tanımında kalır).
- **Değiştirdiği karar:** ADR-09 (PLAN.md §0) — lafzı aynen kalır, bu ek yüklemi bir şartla daraltır. ADR tablosunun satırı değişmedi.
- **Bağlı görevler:** tm 293 AI-FIRST-AND-SILENCE (AI-11; alt görev 293.4 ADR09A-PREDICATE yüklemi uygular) · tm 320 AI-QUALITY-METRICS (AI-25) · tm 335 ARCHIVE-SCREEN (AR-01, `threads.handled_by`) · tm 336 ARCHIVE-FILTERS (AR-02, "AI çözdü" filtresi) · tm 304 AI-HANDOFF-CARD (AI-10, `ai_handoffs` tablosu).
- **Kod değişikliği:** bu dosyanın yazıldığı turda yok; uygulama tm 293.4'te (§4, PLAN §D262).

## 1. Bağlam

ADR-09: _"thread kapanışında `author_type='agent'` event YOKSA +1 → `usage_records(metric='ai_resolutions')`. Reports 'Automated' aynı sorgudan"_.

Bugünkü uygulama (2026-10-14 HEAD'de yeniden doğrulandı):

- Yüklem `threadWasAiResolved` (`apps/api/src/services/billing/metering.ts:108`): thread'de `author_type = 'agent'` olay sayısı 0 ise `true`. Thread kapanırken aynı işlemde çağrılır ve `true` ise `recordAiResolution` sayacı bir artırır (`apps/api/src/services/chat/chat-service.ts:1034-1039`).
- Reports aynı yüklemi SQL olarak ikinci kez yazıyor: `AGENT_EVENT` (`apps/api/src/services/reports/report-csv.ts:53`) ve `SPLIT_COUNTS` / toplamlar (`:70`, `:114`): `automated = NOT t.active AND NOT AGENT_EVENT`. Overview "Automated", Breakdown, AI Agent raporunun `resolutions` alanı (`apps/api/src/routes/reports.ts:846-860`), CSV ve zamanlanmış raporlar bu parçalardan okur.
- Gelen kutusunun `ai_solved` görünümü yüklemi üçüncü kez, Prisma filtresi olarak yazıyor (`chat-service.ts:2408-2417`); yorumu "sayaçta olmayan bir şart eklenmesin" diye uyarıyor.
- AI'ın devri bugün `chats.transfer(..., { reason: 'ai_handoff' })` ile yapılır (`apps/api/src/services/ai/ai-responder.ts:174-197`); kural botunun devri `reason: 'bot_handoff'` (`apps/api/src/services/bots/rule-bot-responder.ts:127`). Her ikisi de thread'e `author_type = 'system'`, `properties = { system_event: 'chat_transferred', reason }` olayı yazar (`chat-service.ts:1446-1463`; nedenler `TRANSFER_REASONS`, `packages/types/src/domain.ts:64`).

Sonuç: AI sohbeti insana devreder, oyuncu ajan yazmadan ayrılır, thread kapanır → ajan olayı yok → **AI çözümü sayılır ve faturalanır**. Aynı thread AI Agent raporunda hem `resolutions`'a hem `transfers`'a girer, yani `transfer_rate`'in paydası (`automated + transfers`) onu iki kez sayar. AI-11 "Önce AI" (K9, ADR-08a) ile insan devirden sonra atanacağı için bu durum seyrek olmaktan çıkar: devir anında ajan yoksa ya da oyuncu kuyrukta beklerken ayrılırsa her biri bir "AI çözümü" olur. `SiyahTus-Analiz/05-uygulama-rehberi.md` "Uygulayıcı için kurallar" madde 4: kilitli karar sessizce delinmez, ilgili ADR'ye ek not yazılır. Bu dosya o ek nottur.

## 2. Karar

1. **Yeni yüklem.** Bir thread kapanışta ancak şu iki şart birlikte doğruysa **AI çözümüdür**:
   - (a) thread'de `author_type = 'agent'` olay **YOK** (ADR-09 aynen), **VE**
   - (b) thread için **otomatik devir YOK**: ne `ai_handoffs` satırı (AI-10, tm 304) ne de `chat_transferred` olayı `reason ∈ {'ai_handoff', 'bot_handoff'}` ile (AI-11 bekçisinin `ai_failure` gibi otomatik bir devir nedeni eklenirse o da bu kümeye girer).

   İkisi de aynı thread'e bakar (`thread_id`), kiracı genelinde değil. Ajanlar arası aktarımlar (`manual`, `routing`, `agent_disconnected`) devir sayılmaz; yüklemi değiştirmez.

2. **Tek tanım, tek yardımcı.** Yüklem bir kez tanımlanır: bir TypeScript yardımcısı (kapanış anındaki sayaç için) ve onun SQL karşılığı tek bir `Prisma.sql` parçası (toplu sorgular için), aynı modülde ve aynı testle bağlı. Şu yüzeylerin **hepsi** bu tanımdan okur ve **aynı commit'te** geçer; biri eski yüklemde kalırsa sayılar birbirini tutmaz:
   - faturalama sayacı (`usage_records`, `metric = 'ai_resolutions'`) — kapanıştaki `threadWasAiResolved` çağrısı;
   - gelen kutusunun `ai_solved` görünümü (ve onu okuyan MCP `list_chats` aracı);
   - Reports "Automated": Overview, Breakdown, AI Agent `resolutions`, CSV, zamanlanmış raporlar; Home, Copilot BI ve komut paleti `buildOverviewReport` üzerinden aynı parçaları okur;
   - Arşivin "AI çözdü" filtresi (AR-02, tm 336) ve kapanışta yazılan `threads.handled_by = 'ai'` (AR-01, tm 335);
   - AI-25'in "Faturalanan AI çözümü" kutusu (tm 320).

   Rapor = fatura kuralı (ADR-09) bu yüzden korunur: aynı thread kümesi, aynı sayı.

3. **Yürürlük ileriye dönüktür; geçmiş faturalar yeniden hesaplanmaz.**
   - Yürürlük anı `ADR_09A_EFFECTIVE_AT`, tm 293.4'ün dağıtımından **sonraki ilk fatura döneminin başıdır** (dönem `YYYYMM`, UTC ayın 1'i 00:00 — `currentPeriod`, `metering.ts:97`). Dönem ortasında yürürlük yok: her fatura dönemi tek bir tanımla sayılır. Değer tek bir sabit olarak tanımlanır; testler kendi anını parametreyle verir.
   - Şart (b) yalnız `threads.closed_at >= ADR_09A_EFFECTIVE_AT` olan thread'lere uygulanır. Daha önce kapanmış thread ADR-09'un eski tanımıyla değerlendirilir — sayaç, raporlar, `ai_solved`, `handled_by` geri dolumu dahil. Böylece geçmiş bir dönemin raporu o dönemin faturasıyla aynı kalır.
   - Yazılmış `usage_records` satırları ve kesilmiş faturalar (`invoices`) değiştirilmez; geri dönük düzeltme, iade ya da kredi yok.

4. **AI-25'in yeni metrikleri faturaya girmez** (AI-25-S1 varsayılanı). Onaylı / varsayılan / yanlış çözüm, containment ve devir kalitesi yalnız raporda, "Faturalanan AI çözümü (ADR-09a)" kutusundan ayrı etiketlerle gösterilir. `GET /reports/ai-agent` geriye uyumlu genişler: `resolutions` alanı bu ekin yüklemini taşır, yeni metrikler ayrı blokta gelir. Yanlış çözümlerin faturadan düşülmesi F2'de ticari karardır.

5. **Devirden sonra "AI'a geri ver".** Thread'de bir kez otomatik devir olduysa, sonradan AI'a geri verilip AI tarafından kapatılsa bile o thread AI çözümü sayılmaz. Şüphede fatura müşteri lehine kalır; yüklem de "son devirden sonra ne oldu" sorusu olmadan tek bir varlık kontrolü olarak kalır.

## 3. Sonuçlar

- **Uyumlu kalan:** ADR-09'un "ajan yazdıysa AI çözümü değildir" kuralı ve "rapor ile fatura aynı sorgudan" ilkesi aynen geçerli. ADR-13 fiyatları (`ai_resolutions_included = 200`, `AI_OVERAGE_CENTS`) değişmez.
- **Değişen:** otomatik devir olan thread'ler yürürlük anından sonra AI çözümü sayılmaz, faturaya ve "Automated"a girmez. AI Agent raporunda böyle bir thread artık yalnız `transfers`'ta görünür; `transfer_rate` paydasındaki çift sayım kalkar. Kural botunun devri de aynı kapsamdadır: bugün kural botunun tek başına kapattığı thread de AI çözümü sayılıyor, onun devrettiği thread'i saymaya devam etmek aynı şişmeyi bırakırdı.
- **Varsayım:** K10 "AI'ın devrettiği" der; kural botu devri (`bot_handoff`) bu ekte aynı kurala bağlandı (gerekçe bir üst madde). Sahip kural botu devrini ayırmak isterse tek değişiklik (b)'deki neden kümesidir.
- **Varsayım:** `ai_handoffs` (tm 304) henüz yok. Şartın bugünkü dayanağı `chat_transferred` olayıdır ve her otomatik devir zaten bu olayı aynı işlemde yazar. `ai_handoffs` gelince satırı da kontrol edilir (ya-ya da); "Önce AI"da devir `transfer` yerine doğrudan yönlendirmeyle yapılırsa (ADR-08a madde 4) devir yolu ya bu olayı ya `ai_handoffs` satırını yazmak zorundadır — tm 293 bunu bir testle sabitler.
- **AR-01/AR-02 ile çelişki giderildi:** 05'in AR-01 bölümü `handled_by = 'ai'` için "en az bir bot olayı varsa" şartını ekliyor. Sayaçta bu şart yok; ekseydi arşivin "AI çözdü" sayısı faturadan farklı çıkardı. Karar: `handled_by = 'ai'` ⇔ bu ekin yüklemi; ayrı bir bot olayı şartı yok.
- **Açık kalan (bu ekin kapsamı dışında, sahip kararı ister):** hem ajan hem bot olayı olmayan thread — AI kapalı bir çalışma alanında oyuncunun kuyrukta beklerken ayrıldığı sohbet — bugün de, bu ekten sonra da AI çözümü sayılır ve faturalanır. K10 yalnız devredilmiş thread'i sorar. Bu durumun sayaçtan çıkarılması bütün yüzeylerde birlikte, yeni bir ADR eki ile yapılır; tek bir yüzeye (ör. yalnız arşiv) eklenmez.
- **Bu eki delen bir değişiklik** (yüklemin bir yüzeyde farklılaşması, geçmiş dönemlerin yeniden hesaplanması, faturanın AI-25 metriklerine geçmesi) yeni bir ADR eki ve sahip kararı ister.

## 4. Uygulama (tm 293.4 · 2026-10-17 · PLAN §D262)

- Tek modül `apps/api/src/services/billing/ai-resolution.ts`: `ADR_09A_EFFECTIVE_AT = 2026-11-01T00:00:00Z`, `AUTOMATIC_HANDOFF_REASONS`, `aiResolvedSql()` (raporlar), `aiResolvedThreadWhere()` (`ai_solved` görünümü — Prisma süzgeci SQL alamadığı için), `threadWasAiResolved()` (kapanıştaki sayaç; aynı SQL parçasını satır üzerinde koşar). `report-csv.ts` `AGENT_EVENT` ve `metering.ts`'teki eski yardımcı kalktı.
- Devir olayı yalnız sunucunun yazdığı olaydır: `author_type = 'system'`, `system_event = 'chat_transferred'`, `reason` listede. Yürürlük kapsayıcıdır (`closed_at >= ADR_09A_EFFECTIVE_AT`).
- Raporun üçlü ayrımında devredilip kimsenin yazmadığı thread "handled" sayılır (skill çalıştıysa `assisted`, yoksa `manual`); `manual + assisted + automated === closed` korunur.
- Testler kendi anlarını verir: `ChatService` `billing.adr09aEffectiveAt` (yalnız testler) ve thread'lerin `closed_at`'ini sabitin iki yanına taşıyan rapor testleri (`apps/api/test/integration/ai-resolution-handoff.test.ts`).
- Varsayım: tm 293.4 Ekim 2026'da dağıtılır; daha geç dağıtılırsa sabit aynı değişiklikte sonraki ayın 1'ine alınır.
- Bekçi devri (tm 293.6 · PLAN §D264): `ai_stall` işi transfer olayı yazmaz (bağlantıyı ekipler arasında kimse taşımadı); bıraktığı tek iz `system_event = 'ai_mode_changed'`, `reason = 'ai_failure'` satırıdır. Yüklem bunu da otomatik devir sayar: `AUTOMATIC_MODE_HANDOVERS` (`['ai_failure']`), üç yazımda aynı (`ai-stall-watchdog.test.ts`).

## 5. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — AI-11, AI-25, AR-02 satırları.
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — Karar kaydı K10, K27; § AI-11 ("Kilitli kararla ilişkisi", soru 4), § AI-25 (AI-25-S1), § AR-02 (soru 2).
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — "Uygulayıcı için kurallar" madde 4; kilitli kararlar tablosundaki ADR-09 satırı; § AI-11 kodlama mantığı 8; § AI-25 (rapor ve regresyon testi); § AR-01 / AR-02 ("AI çözdü" tanımı).
- `SiyahTus-Analiz/07-gorev-plani.md` — #272 Dalga 0 (AI-11, AI-25, AR-02); bağlı görevler #293, #320, #335, #336.
