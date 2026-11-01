# PLAN kanıt arşivi — 2026-11

Canlı `PLAN.md` § K bloklarından taşınan eski kanıt maddeleri (CONVENTIONS §1.2).

#### K08.6.1 — 08.6.1 · Chat routing kural motoru + fallback

- ✅ tm 307.2 · AI-12 2/3 (devir hedefi çözücü · ADR-14b §2.12): sıra adımın/kuralın ekibi (id, eski adımda ad) → neden rotası (en ağır neden önce, marka sonra tüm markalar) → konu rotası / rolün ekibi (korkuluk yazımı `handoffTopicRole` ile) → aynı gün dönüşü (ekip + ajan önce) → gitmiş hedefte yedek ekip → yönlendirme; rotanın yeteneği `threads.required_expertise_id` ile kuyrukta da geçerli (eğitimsize düşmez, acil bekler, boşaltma onu atlayıp arkadakileri verir), rotanın önceliği taban, hedef ekipte kabul eden yoksa mesai dışı metni (kriz metninden sonra) + e-posta biliniyorsa tek talep, karar kaydında `handoff_target` / `handoff_target_fallback` · `services/ai/conversation/handoff/target-resolver.ts`, `handoff-service.ts`, `ai-responder.ts` `#aim`, `routing-service.ts` `assignWithinGroup`/`#drainTeam` · migration `20261020200000_threads_required_expertise` · `test/integration/handoff-target.test.ts` (9) · `target-resolver.test.ts` (13) · `handoff-routes.test.ts` (types, +1) · §D303

#### K10.3 — 10.3 · Invoices + payment details yönetimi

- ✅ **Fatura indirme reddedilince görünür hata (tm 259.9 · UX taraması O10 · 2026-10-08; damga değişmedi).** `download` try/finally idi, catch yoktu: reddedilen istek yakalanmamış reddetme oluyor, düğme sessizce geri geliyordu. Şimdi "{numara} numaralı fatura indirilemedi." + neden `role="alert"`, sonraki indirme uyarıyı siler. Billing pilotta gizli olduğundan görev sırasının sonunda yapıldı — `BillingPage.tsx` · test `BillingPage.test.tsx` (+1) · tm 259.9
