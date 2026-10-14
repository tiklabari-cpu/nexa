# task_098 kararına ek — iGaming şablon kataloğu paylaşılan pakette, sunucuda kurulum ucu

- **Görev:** tm 275 (ADR-TEMPLATE-CATALOG) · PLAN.md §D224
- **Tarih:** 2026-10-14
- **Durum:** Kabul edildi. Dayanak: 05'in "Kilitli kararlarla uzlaşma" tablosundaki task_098 satırı (_"Katalog paylaşılan pakete taşınır; kurulum ucu açılır."_) ve sahip kararı **K27** (her ADR eki ayrı görev). AI-15'in soruları için Karar kaydında ayrı bir K satırı yok, bu yüzden 04'teki varsayılanlar geçerli: **AI-15-S1** (platform taslak hazırlar, "kiracı doğrulamalı" alanlar boş gelir, kiracı yayından önce onaylar), **AI-15-S2** (kilitli şablonlar kapatılamaz, yalnız metinlerin üslubu düzenlenir), **AI-15-S3** (Türkçe tam, İngilizce yalnız örnek cümleler). `site_access` içeriğini **K13** belirler (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı ve § AI-15).
- **Değiştirdiği karar:** tm 98'in (05.6, şablon kataloğu 31+) varsayımı: _"Katalog DETERMİNİSTİK ve YERELDİR (`apps/web/src/features/playbook/templates.ts`) — dış servis, backend route veya DB tablosu AÇILMAZ … 'template' kavramı bugün kontratta hiç yok (grep 0) ve orada kalır."_ (`.taskmaster/tasks/task_098.md:28`). tm 98'in görev kaydı **değiştirilmez**. Bu ek o varsayımın iGaming prosedür şablonları için kalktığını kayda geçirir; mevcut e-ticaret/SaaS kataloğu için varsayım geçerli kalır.
- **Bağlı görev:** tm 311 IGAMING-TEMPLATES (AI-15) — uygulamayı o yapar (311.1 paket + doğrulayıcı + `deposit_not_credited`, 311.2 kalan 19 şablon, 311.3 kurulum uçları, 311.4 web + onboarding). tm 311 zaten `275`'e bağlı.
- **Kod değişikliği:** yok.

## 1. Bağlam

Bugünkü durum (2026-10-14 HEAD'de yeniden doğrulandı):

- Katalog yalnız ön yüzde. `SKILL_TEMPLATES` `apps/web/src/features/playbook/templates.ts:86-709` (05'in verdiği `:88-692` kaymış): **33** kayıt, hepsi e-ticaret ve SaaS (sipariş durumu, iade, Shopify …). Kategoriler `prebuilt | ai | trending` (`:20`), şablon tipi `SkillTemplate` (`:61-79`), Türkçe metinler `templates-tr.ts`, değişmezler `templates.test.ts`. Galeri `TemplateGallery.tsx`, öneriler `RecommendedSkills.tsx`; ikisi de kataloğu doğrudan içe aktarıyor.
- "Kur" bugün yalnız editörü doldurur (`templateToDraft`, `templates.ts:735`); kayıt `POST /skills` ile, kiracının kendi skill'i olarak açılır. Sunucu skill'in bir şablondan geldiğini bilmez: `Skill` modelinde (`apps/api/prisma/schema.prisma:1657-1680`) şablon anahtarı ya da sürümü yok.
- Kontratta skill şablonu kavramı yok. `packages/contract/openapi/` içindeki tek "template", HelpDesk e-posta şablonları (`/settings/ticket-email-templates`, `openapi.yaml:408-411`); konu dışı.
- Adım doğrulayıcısı sunucuda da var: `validateSteps` `packages/ai-mock/src/steps.ts:189`, `POST /skills` bunu kullanıyor (`apps/api/src/routes/playbook.ts:13, 318`). Skill'i kapatma `PATCH /skills/{skillId}` `active` (`playbook.ts:499`), silme `DELETE /skills/{skillId}` (`:536`).
- Sektör kapalı bir liste: `organizations.sector`, değerleri `packages/types/src/company.ts:20-35` (`gaming_gambling` `:30`).

Sorun (AI-15): 20 iGaming prosedür şablonu (yatırım geçmedi, çekim, KYC, bonus, self-exclusion, sorumlu oyun sinyali …) yalnız ön yüzde duran bir diziyle karşılanamaz. Bunun dört sebebi var:

1. **Kilit sunucuda olmalı.** Self-exclusion ve sorumlu oyun sinyali prosedürleri kapatılamamalı (AI-15-S2). Ön yüzdeki bir bayrak bunu sağlamaz, kiracı skill'i API'den kapatabilir.
2. **Kurulum tek adımda birden çok kayıt yazar.** Prosedür, ekip eşlemesi (AI-12), varsayılan kurallar (AI-07) ve örnek tablo satırları (AI-13) birlikte yazılır, `igaming_core` paketi bunların hepsini bir arada kurar. Bu işin idempotent olması gerekir. Tarayıcıdan sırayla `POST` atan bir döngü idempotent olamaz.
3. **Sürüm sunucuda bilinmeli.** Platform şablonu güncellediğinde kiracının kopyasının hangi sürümden geldiği bilinmeli ("yeni sürüm var" rozeti). Root panel de kiracı başına kurulu/yayında şablon sayısını okuyacak (tm 389.19).
4. **Şablon birden çok yerden kullanılıyor.** Onboarding sihirbazı (sektör `gaming_gambling`), galeri ve senaryo düzeneği (AI-19 tohumları, tm 314) aynı tanımı okur.

`SiyahTus-Analiz/05-uygulama-rehberi.md` "Uygulayıcı için kurallar" madde 4: kilitli karar sessizce delinmez, kayda geçer. Bu dosya o kayıttır.

## 2. Karar

1. **Paylaşılan paket: `packages/ai-templates` (`@siyahtus/ai-templates`).** 05 iki yer öneriyor: ayrı paket ya da `packages/types/src/ai-templates/`. Ayrı paket seçildi:
   - `@siyahtus/types`'ı widget, web, mobil ve RTM de içe aktarıyor. 20 şablonun Türkçe metinleri, kalıpları ve senaryo tohumları bu paketlerin hiçbirinde gerekmez.
   - Paketi çalışma anında yalnız API okur. Web ve mobil katalogu kontrattan (§2.2) alır, paketi doğrudan içe aktarmaz.
   - Paket türleri `@siyahtus/types`'tan alır. Prosedür doğrulayıcısını (AI-03, tm 296; bugünkü `validateSteps`'in yanında, `@siyahtus/ai-mock`) yalnız testlerinde kullanır.
   - Bedeli: `apps/api/Dockerfile` paketi derlenmiş çıktısına yönlendirir (`:73` listesi) ve `dist` + `package.json`'ı kopyalar (`:116-117` kalıbı). tm 311.1 bunu aynı commit'te ekler, yoksa pilot imajı açılışta modülü bulamaz.

   Paketin içeriği:
   - `IGAMING_TEMPLATES_TR`: 20 şablon. Her biri AI-03 prosedür biçiminde tam tanım ve şunları taşır: slotlar (AI-04), kalıplar, devir (konu ve neden anahtarıyla, grup kimliğiyle değil), yasak ifadeler (AI-08), test senaryoları (AI-19 tohumları), `locked`, `tenant_must_fill` ve `version`.
   - `igaming_core` paket tanımı: 20 şablon, varsayılan davranış kuralları (AI-07) ve "örnek — doğrulayın" işaretli tablo satırları (AI-13).
   - Paket sürümü: `package.json` `version`.

2. **Kontrata girer.** Dört uç, hepsi lisans kapsamlı:

   | Uç                                           | Ne yapar                                                                                                                                                                                              | Yetki                |
   | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
   | `GET /ai-templates?industry=igaming&lang=tr` | Liste: anahtar, ad, özet, konu, `locked`, `version`, `tenant_must_fill` sayısı, bu lisansta kurulu sürüm (`installed_version`, yoksa `null`)                                                          | `agents-bot--all:ro` |
   | `GET /ai-templates/{key}`                    | Tam tanım (önizleme)                                                                                                                                                                                  | `agents-bot--all:ro` |
   | `POST /ai-templates/{key}/install`           | Gövde `{ ai_agent_id, brand_ids?, route_mapping?: { <topic_key>: <group_id> }, force_copy? }`. Yanıt: oluşan ya da var olan skill + `tenant_must_fill` kontrol listesi + eşlenmemiş konu anahtarları. | `agents-bot--all:rw` |
   | `POST /ai-templates/packs/{pack}/install`    | v1'de yalnız `igaming_core`: 20 şablon + kurallar + örnek satırlar. Ekipler yalnız `create_groups: true` ile oluşturulur.                                                                             | `agents-bot--all:rw` |
   - `industry` v1'de yalnız `igaming`. `lang` v1'de yalnız `tr`. Genişletme kontratta enum'a değer eklemektir (geriye uyumlu).
   - Kiracının sektörü `gaming_gambling` ise web galeride iGaming'i ilk sıraya koyar. Sıralama istemcinin işidir. Sunucu sektöre göre içerik saklamaz, gizlemez.
   - **İki `GET` yan etkisizdir.** Gezinmek ve önizlemek kayıt oluşturmaz, sayaç artırmaz (LiveChat dersi, `SiyahTus-Analiz/kaynaklar/eksikler.md` §3).
   - Yetki RL-02 gelene kadar mevcut kapsamlarla verilir (05 §5). Bugün skill yazmaya yetkili olan, şablon da kurar.

3. **Kurulum kopyadır, canlı referans değil.**
   - Kurulum kiracının lisansında sıradan bir skill/prosedür satırı yazar, `status='draft'` (AI-20; tm 316 gelene dek mevcut taslak anlamı). Satır `template_key` ve `template_version`'ı taşır. 05'e göre yeni tablo açılmaz: `skills.template_key`, `skills.template_version`; kolonlar tm 311.3'te, adı HANDOFF'a yazılır (root panel bunları okur). Kurulumdan sonra kopya kiracınındır: düzenler, yayınlar.
   - Pakette şablonun yeni sürümü çıksa da kiracının kopyası **kendiliğinden değişmez** (sürpriz davranış olmasın). Liste `installed_version < version` olduğunda "yeni sürüm var" rozetini besler. Fark görünümü P2.
   - **İdempotens.** Aynı lisans, aynı `ai_agent_id` ve aynı `template_key` için silinmemiş bir kopya varsa kurulum yeni satır yazmaz, var olanı döner (`200`). İlk kurulum `201` döner. `force_copy: true` ikinci bir kopya açar. Paket kurulumu şablon başına aynı kuralı uygular, yarıda kesilip yeniden çağrılırsa eksikleri tamamlar. Eşzamanlı iki kurulum tek kopya bırakır; kısıt ya da kilit seçimi tm 311.3'ündür.
   - **Ekip eşlemesi.** Şablondaki konu anahtarları `route_mapping` ile `handoff_routes`'a eşlenir (AI-12; anahtar listesi ADR-08a `QUEUE_TOPIC_ROLES`, `docs/adr/routing-team-queues.md`). Eşlenmemiş anahtar kurulumu durdurmaz, **yayını** durdurur.
   - **Kiracının doldurması gerekenler.** `{şikâyet_süresi}`, `{adr_kurumu}`, `{kriz_hattı}` gibi yer tutucular ve örnek tablo satırları "örnek — doğrulayın" işaretlidir (AI-15-S1). Çözülmemiş yer tutucu varken yayın `400 template_unfilled` döner.

4. **Kilitli şablonlar kapatılamaz: `self_exclusion` ve `responsible_gambling_signal`.**
   - Kilit, kurulu kopyanın `template_key`'inden **sunucuda, paketteki tanıma bakılarak** belirlenir. Kiracının yazabildiği bir bayrak değildir, `PATCH` ile kaldırılamaz.
   - Kilitli kopyada şunlar `409 template_locked` döner: `active=false` (`PATCH /skills/{skillId}`), silme (`DELETE /skills/{skillId}`), adım listesinin yapısını değiştirmek (adım türleri, devir adımı, tetik). Durumdan bağımsızdır, taslak da silinemez.
   - Düzenlenebilenler: metinlerin üslubu ve ekip eşlemesi. Çıkış denetimi (AI-08) düzenlenmiş metne de uygulanır.
   - Bu iki konu ayrıca AI-08'in giriş taramasıyla da tetiklenir (tm 301). Koruma, kiracının şablonu kurmasına ya da AI-05'in konu seçimine bağlı değildir. Şablon, korumanın kiracıya görünen ve üslubu düzenlenebilen yüzüdür.
   - G3 (kendine zarar) ve G5 (reşit olmayan şüphesi) prosedür değil AI-08 korumasıdır, katalogda yer almaz.

5. **Mevcut 33 e-ticaret/SaaS şablonu yerinde kalır.** `apps/web/src/features/playbook/templates.ts` + `templates-tr.ts` + `templates.test.ts` değişmez. tm 98'in varsayımı (yerel, kontratta yok, sunucu kaydı yok) **bu katalog için** geçerli. Galeri iki kaynağı yan yana gösterir: yerel liste ve `GET /ai-templates`. İki katalog farklı türdür: e-ticaret kaydı tek turlu `SkillTemplate`, iGaming kaydı AI-03 prosedür tanımı. Bunlar birleştirilmez, 33 kayıt pakete taşınmaz. Birleştirme ancak yeni bir karar kaydıyla yapılır.

6. **Dil (AI-15-S3).** Şablon içeriği Türkçe tamdır. İngilizce yalnız örnek cümlelerde (konu tespiti için) bulunur. `site_access` metni K13'e göre yazılır: AI adres, VPN ya da engel aşma yolu önermez, yalnız kiracının onayladığı sabit metni kullanır (tm 311 "Erişim bilgisi ayarı").

## 3. Sonuçlar

- **Değişen:** "Şablon" kavramı kontrata girer, ama yalnız iGaming prosedür kataloğu için. Sunucu bir skill'in hangi şablondan, hangi sürümden geldiğini bilir. Kilitli iki prosedür API'den de kapatılamaz.
- **Değişmeyen:** 33 yerel şablon, galerideki "Kur → editör doldur → `POST /skills`" akışı, `templates.test.ts` değişmezleri. ADR-14 / ADR-14a: tek paradigma Skill. Prosedür şablonu yeni bir kavram değil, kurulunca sıradan bir skill satırı olur. `workflows` tablosu ve tuval yine yok.
- **Bu turda sabitlenen ayrıntılar (tm 311 için):**
  1. Paket `packages/ai-templates` (`@siyahtus/ai-templates`), `@siyahtus/types` içinde değil. API Dockerfile'ına aynı commit'te eklenir (§2.1).
  2. **Kilitli sorumlu oyun şablonunun anahtarı `responsible_gambling_signal`.** 05 § AI-15 ve tm 311'in ayrıntısı `responsible_gaming_signal` yazıyor. ADR-08a konu rollerini tek listeye bağladı (`responsible_gambling`). Şablon anahtarı da aynı kökü kullanır, tm 311 bu yazıma uyar. Bu karar tm 311'in görev kaydını değiştirmez.
  3. İdempotens anahtarı `(license, ai_agent_id, template_key)`, silinmemiş kopyalar arasında. Yanıt `201` yeni, `200` var olan.
  4. Kilit sunucuda `template_key`'den türetilir. Kapatma, silme ve yapı değişikliği `409 template_locked` döner.
  5. `industry` = `igaming`, `lang` = `tr` (v1 enum'ları). Sektör → ilk sıra eşlemesi istemcide.
  6. Şablon başına tamsayı `version`, paket başına `package.json` sürümü. Kopyalar kendiliğinden güncellenmez.
  7. `GET` uçları yan etkisizdir.
- **Açık kalan:** lisans yargı bölgesine göre (Curaçao / MGA / UKGC) şablon varyantları (P2). Şablonların platform panelinden düzenlenmesi v1'de yok: AI-15-S1 "platform taslak hazırlar" = paket kodda, yeni sürüm = yeni dağıtım (tm 389 panel yerleşimi). Kurulu kopyaya yeni sürümü uygulama ("güncelle" düğmesi) P2.
- **Bu kararı delen bir değişiklik** sahip onayı ve yeni bir karar kaydı ister: kilitli şablonu kapatmaya açan bir yol, kurulumu canlı referansa çevirmek, kiracı kopyasını otomatik güncellemek ya da 33 yerel şablonu sunucuya taşımak.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — AI-15 satırı (P0, F1).
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — § AI-15 (ne, neden, kanıt, sorular 1–3); Karar kaydı K13, K14, K27.
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — "Kilitli kararlarla uzlaşma" tablosu (task_098 satırı); § AI-15 (alan, mevcut kod, eklenecek yerler, kodlama mantığı 1–8, kabul kriterleri, riskler).
- `SiyahTus-Analiz/07-gorev-plani.md` — #275 Dalga 0; AI-15 → #311 (bağımlılık #275).
- `.taskmaster/tasks/task_098.md:28` — değiştirilen varsayım (kayıt değişmedi).
- `docs/adr/skill-procedure.md` (ADR-14a), `docs/adr/routing-team-queues.md` (ADR-08a, `QUEUE_TOPIC_ROLES`).
