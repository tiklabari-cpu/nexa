# PLAN kanıt arşivi — 2026-11

Canlı `PLAN.md` § K bloklarından taşınan eski kanıt maddeleri (CONVENTIONS §1.2).

#### K08.6.1 — 08.6.1 · Chat routing kural motoru + fallback

- ✅ tm 307.2 · AI-12 2/3 (devir hedefi çözücü · ADR-14b §2.12): sıra adımın/kuralın ekibi (id, eski adımda ad) → neden rotası (en ağır neden önce, marka sonra tüm markalar) → konu rotası / rolün ekibi (korkuluk yazımı `handoffTopicRole` ile) → aynı gün dönüşü (ekip + ajan önce) → gitmiş hedefte yedek ekip → yönlendirme; rotanın yeteneği `threads.required_expertise_id` ile kuyrukta da geçerli (eğitimsize düşmez, acil bekler, boşaltma onu atlayıp arkadakileri verir), rotanın önceliği taban, hedef ekipte kabul eden yoksa mesai dışı metni (kriz metninden sonra) + e-posta biliniyorsa tek talep, karar kaydında `handoff_target` / `handoff_target_fallback` · `services/ai/conversation/handoff/target-resolver.ts`, `handoff-service.ts`, `ai-responder.ts` `#aim`, `routing-service.ts` `assignWithinGroup`/`#drainTeam` · migration `20261020200000_threads_required_expertise` · `test/integration/handoff-target.test.ts` (9) · `target-resolver.test.ts` (13) · `handoff-routes.test.ts` (types, +1) · §D303

#### K10.3 — 10.3 · Invoices + payment details yönetimi

- ✅ **Fatura indirme reddedilince görünür hata (tm 259.9 · UX taraması O10 · 2026-10-08; damga değişmedi).** `download` try/finally idi, catch yoktu: reddedilen istek yakalanmamış reddetme oluyor, düğme sessizce geri geliyordu. Şimdi "{numara} numaralı fatura indirilemedi." + neden `role="alert"`, sonraki indirme uyarıyı siler. Billing pilotta gizli olduğundan görev sırasının sonunda yapıldı — `BillingPage.tsx` · test `BillingPage.test.tsx` (+1) · tm 259.9

#### K06.2.4 — 06.2.4 · Ordered steps (6 adım tipi; reorder + klavye alternatifi)

- ℹ tm 298 · AI-06 (bilgi yolu #298): hiçbir prosedür/skill almayan soru AI-13 tablosu (arayüz, #310) → bilgi bankasından `knowledge_answer` nesnesiyle (`{reply, grounded, cited_ids}`, pasajlar P1…Pn) cevaplanır; verilmeyen alıntı / alıntısız / pasajda olmayan birimli sayı bir kez yeniden yazdırılır, yine bozuksa gönderilmez; cevap yoksa "kesin bilgi veremiyorum" + konu grubuna göre devir (`no_knowledge`) ya da bir kez "aktarayım mı?" (`ai_handoff_settings.no_answer`, migration `20261019090000_ai_no_answer`); `ai` modunda hiçbir tur sessiz bitmez; karar kaydında `details.knowledge.source_ids` / `details.unanswered` · `apps/api/src/services/ai/conversation/knowledge-answer.ts:1` · `conversation-engine.ts` `#knowledgeTurn`/`#noAnswer`/`#neverSilent` · `knowledge-answer.test.ts` (30) · `knowledge-path.test.ts` (19) · `ai-knowledge-answer.test.ts` (9) · §D279

#### K04.3.3 — 04.3.3 · Teammates tablosu (Name/Role/Status/2FA)

- ✅ tm 325.4 · RL-02 4/5: web — Ayarlar › Güvenlik › Roller ve izinler (gruplu satırlar × dört rol sütunu, anahtar/düzey seçici, kilit + nedeni, hücre başına ve toplu varsayılana dön, GV-06 Kaydet → fark → gerekçe → onay, Yönetici salt okur) + Yetkilerim (herkes, `/auth/me` `capabilities`), PAT seçicisi ödünç kapsamı sunmaz · `apps/web/src/features/settings/PermissionsMatrix.tsx`, `MyPermissions.tsx`, `PersonalAccessTokens.tsx:108` · `PermissionsMatrix.test.tsx` (11), `MyPermissions.test.tsx` (3), `PersonalAccessTokens.test.tsx` (+1), e2e `permissions.spec.ts` (1, axe dahil) · tm 325.4 commit · §D336
