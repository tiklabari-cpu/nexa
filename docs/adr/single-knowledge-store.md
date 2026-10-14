# Q6 değişti — AI Agent ve Copilot bilgisi tek depoda, kaynak başına "kim kullanır" (`audiences`)

- **Görev:** tm 274 (ADR-SINGLE-KB) · PLAN.md §D223
- **Tarih:** 2026-10-14
- **Durum:** Kabul edildi — sahip kararı **K11** ("AI Agent ve Copilot bilgileri tek depoda birleşsin mi? (eski karar Q6: ayrı)" → _"Evet: tek depo, her kaynakta 'kim kullanır' seçimi"_, ✅ varsayılan onaylandı); AI-14 sorularının varsayılanları **AI-14-S2** (yayınlanan Genel KB makaleleri varsayılan olarak AI Agent + Copilot'a açık, makale başına kapatılabilir) ve **AI-14-S3** (son gözden geçirme zorunlu, varsayılan 90 gün, süresi geçen kaynağa panelde uyarı) (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı ve § AI-14).
- **Değiştirdiği karar:** Q6 (PRD açık sorusu) ve PRD 12.2'nin "Copilot ayrı KB" okuması. PLAN.md'deki `12.1–12.3` satırının metni ve damgası değişmez; bu dosya kararın yeni hâlini kayda geçirir.
- **Bağlı görev:** tm 309 KB-SINGLE-STORE (AI-14) — uygulamayı o yapar (309.1 genişlet + kontrat, 309.2 taşı + arama süzgeçleri, 309.3 web).
- **Kod değişikliği:** yok.

## 1. Bağlam

**Q6'nın geçmişi.** PRD'nin açık soruları arasındaki Q6 _"AI Agent ↔ Copilot bilgi tabanları ne kadar paylaşılacak"_ için kayıt önce **"AÇIK — ürün kararı. Kaynakta ayrı; birleştirme opsiyonu değerlendirilmedi."** diyordu (`docs/archive/handoff/HANDOFF-arsiv-2026-10-14.md:2335`). Sonraki üç kayıt bunu kodun fiilen verdiği cevapla kapattı: **"ayrı"** (12.2 ayrı KB) — `:2435`, `:3458`, `:4503`. Yani "ayrı" bir ürün kararı olarak tartışılıp seçilmedi; ilk uygulama böyle yazıldı ve sonra kural sayıldı. (Satır numaraları arşivin başına yeni blok eklendikçe kayar; `grep -n 'Q6' docs/archive/handoff/HANDOFF-arsiv-2026-10-14.md` ile bulunur. Analiz paketinin verdiği `:2293/:2393/:3416/:4461` bu turda 42 satır kaymıştı.)

Bugünkü durum (2026-10-14 HEAD'de yeniden doğrulandı):

- Tek tablo, iki ajan kaydı. Bütün kaynaklar `knowledge_sources`'ta (`apps/api/prisma/schema.prisma:1739` `KnowledgeSource`, `ai_agent_id` zorunlu, `onDelete: Cascade`); parçalar `knowledge_chunks`'ta (`:1782`). Copilot ayrı bir `AiAgent` (`kind: 'copilot'`, `apps/api/src/services/ai/copilot-service.ts:44`, find-or-create `:97-117`); dosyanın başındaki yorum ayrılığı amaç olarak yazar: _"the two knowledge bases can never answer from each other"_ (`:1-16`).
- Ayrılık iki yerde uygulanıyor: liste uçları (`GET /knowledge-sources` yalnız `aiAgent.kind = 'ai_agent'` kaynakları, `apps/api/src/routes/playbook.ts:645-652`; `GET /copilot/knowledge` yalnız Copilot ajanınınkiler, `apps/api/src/routes/copilot.ts:208` → `copilot-service.ts:183-188`) ve arama (`apps/api/src/services/ai/knowledge-service.ts:382` `AND s.ai_agent_id = …`; AI cevabında skill'in ajanı `skill-engine.ts:574`, Copilot'ta Copilot ajanı `copilot-service.ts:296`).
- İki uç aynı yetkiyle korunuyor (`agents-bot--all:ro|rw` — `playbook.ts:50-51`, `copilot.ts:44-45`); birleştirme kimseye yeni okuma yetkisi vermez.
- Genel Bilgi Bankası makaleleri (`KbArticle`, `schema.prisma:2684`) AI aramasına hiç bağlı değil. Kaynaklarda marka, dil, sahip ve gözden geçirme tarihi yok; marka bağlamı var (`apps/api/src/lib/tenant.ts:19-29, 92` `app.current_brand`) ama `chats`'te marka kolonu yok (`schema.prisma:781`).
- Kaynakta tazelik alanı **yeniden tarama** içindir, insan onayı için değil: `refresh_after_days` / `next_refresh_at` yalnız `website` kaynağının içeriğini yeniden çeker (tm 198.4). `status` alanı indeksleme durumudur (`'ready'`, `'empty'` … — `knowledge-service.ts:316`, arama `:381` `s.status = 'ready'`), yayın durumu değil.
- Web'de iki ayrı ekran (Senaryolar › Bilgi ve `apps/web/src/features/team/CopilotKnowledge.tsx`); mobil uygulama iki ucu da çağırıyor (`apps/mobile/src/features/playbook/api.ts`, `apps/mobile/src/features/copilot/api.ts`).

Sorun (AI-14): aynı "Papara limitleri" bilgisi AI Agent ve Copilot için iki kez giriliyor; biri güncellenip diğeri unutulunca AI ile ajan oyuncuya farklı limit söyler. Çok markalı bir kiracıda A markasının bonus kuralı B'nin oyuncusuna söylenebilir. LiveChat'in Knowledge hub'ı tek liste ve kaynak başına "For internal use only" kutusuyla aynı sorunu çözüyor (`SiyahTus-Analiz/kaynaklar/livechat-kesif-raporu.md` §2.3). `SiyahTus-Analiz/05-uygulama-rehberi.md` "Uygulayıcı için kurallar" madde 4: kilitli karar sessizce delinmez, kayda geçer. Bu dosya o kayıttır.

## 2. Karar

1. **Tek depo.** AI Agent'ın, Copilot'un ve Genel KB'den gelen makalelerin bilgisi aynı `knowledge_sources` / `knowledge_chunks` deposunda durur. Ayrılık artık "hangi ajan kaydına bağlı" ile değil, kaynağın **kitlesiyle** (`audiences`) kurulur.
2. **Kitle anlamı (LiveChat "For internal use only" ile aynı).**
   - `audiences text[]`, değerler yalnız `ai_agent` ve `copilot`; boş olamaz (CHECK: `audiences <@ '{ai_agent,copilot}' AND cardinality(audiences) >= 1`). Yeni kaynağın varsayılanı `{ai_agent,copilot}`.
   - **AI Agent** (oyuncuya giden her cevap, önizleme dahil) yalnız `audiences @> '{ai_agent}'` kaynakları kullanır.
   - **Copilot** `ai_agent ∪ copilot` kaynakların hepsini kullanır — ajan her şeyi görebilir.
   - **"Yalnız ajanlar için"** = `{copilot}`. Böyle bir kaynak AI'ın oyuncu cevabına hiçbir yoldan girmez; bugünkü "Copilot bilgisi müşteri token'ıyla erişilemez" garantisi bu tek koşulla sürer.
   - "Herkese açık KB" bir kitle değeri **değildir**: Genel KB'nin kendi makaleleri ve editörü var; akış tek yönlüdür (madde 6). Widget'ın KB araması (WG-12) depodaki kaynakları değil, yalnız yayınlanmış KB makalelerini okur.
3. **AI ajanı kapsamı (`ai_agent_ids uuid[]`, boş = bütün AI ajanları).** Yalnız `kind = 'ai_agent'` ajan kimlikleri tutar; Copilot kaydı bu listeye girmez. Süzgeç yalnız AI Agent aramasında uygulanır; Copilot `ai_agent_ids`'e bakmaz. Bir güvenlik sınırı değildir (RLS lisans düzeyinde kalır), içerik seçimidir. Bugün bir `ai_agent` skill'i Copilot ajanına bağlanırsa o skill Copilot kaynaklarıyla oyuncuya cevap verebilir; yeni süzgeç ajan kimliğine değil kitleye baktığı için bu yol da kapanır.
4. **Marka kapsamı (`brand_ids uuid[]`, boş = bütün markalar).** Sohbetin markası (`chats.brand_id`, tm 309.1) biliniyorsa yalnız o markanın ve "bütün markalar" kaynakları; bilinmiyorsa yalnız "bütün markalar" kaynakları. Bu süzgeç **Copilot'ta da** uygulanır, Copilot bir sohbetin içinde çağrıldığında: ajanın B oyuncusuna yazacağı taslağa A'nın bonus kuralı girmemeli. Sohbetsiz Copilot sorusunda (BI, serbest soru) marka süzgeci yoktur. Marka süzgeci sorgu düzeyindedir (bir kaynak birden çok markaya ait olabilir), RLS'te değil.
5. **Gözden geçirme zorunlu (AI-14-S3).** Her kaynakta `reviewed_at` (NOT NULL; yeni kaynakta oluşturma anı) ve `review_interval_days` (NOT NULL, varsayılan **90**). `reviewed_at + review_interval_days < now()` olan kaynak "gözden geçirme gerekli" sayılır ve panelde uyarı alır; **aramadan çıkarılmaz**. Aramadan çıkaran tek tarih `valid_until`'dir (isteğe bağlı, sert sınır). Gözden geçirme insan onayıdır: `website` kaynağının otomatik yeniden taranması (`refresh_after_days`) `reviewed_at`'i değiştirmez. Sahip (`owner_id`) isteğe bağlıdır; sahipsiz kaynak panelde "sahipsiz" görünür.
6. **Genel KB tek yönlü akar (AI-14-S2).** Yayınlanan makale, `KbArticle.ai_audiences` doluysa depoda ona bağlı bir kaynak olur (`knowledge_sources.kb_article_id`, tekil). `ai_audiences`'in varsayılanı `{ai_agent,copilot}`; makale başına kapatılabilir ya da daraltılabilir. Makale yayından kaldırılınca ya da `ai_audiences` boşaltılınca bağlı kaynak aramadan çıkar. Makalenin yayımlanması/güncellenmesi bağlı kaynağın gözden geçirilmesi sayılır. Depodaki bir kaynağı Genel KB'ye yayınlamak bu kararın kapsamında değildir.
7. **Eski uçlar filtreli görünüm olarak kalır; daraltma sonraki sürümde.** Taşıma anında her iki eski görünüm **aynı öğeleri** döner:
   - `GET /copilot/knowledge` = `audiences = '{copilot}'` (yalnız ajanlar için olanlar). `POST` `{copilot}` kaynak yazar; `DELETE /copilot/knowledge/{id}` yalnız `{copilot}` kaynağı siler, başkasına 404 — bugün Copilot ucunun AI Agent kaynağını silememesi gibi. Kontratta kullanımdan kalkacak (`deprecated`) notu taşır.
   - `GET /knowledge-sources` parametresiz = `audiences @> '{ai_agent}'` (bugünkü "AI Agent'ın kaynakları" anlamı; yüklü mobil sürümler bu anlamla çağırıyor). Birleşik liste `?audience=all` ile; `?audience=ai_agent|copilot` kitle süzgeci (`audiences @> '{<değer>}'`). Parametresiz anlamın `all`'a çevrilmesi daraltma sürümünün kararıdır.
8. **Taşıma (CONVENTIONS §6.3, üç sürüm).**
   1. _Genişlet:_ yeni kolonlar; GIN indeksleri (`audiences`, `brand_ids`) her biri kendi `CONCURRENTLY` dosyasında.
   2. _Taşı:_ Copilot ajanına bağlı kaynaklar `audiences = '{copilot}'`, `ai_agent_ids = '{}'`; diğerleri `audiences = '{ai_agent,copilot}'`, `ai_agent_ids = '{<eski ai_agent_id>}'`; `reviewed_at = updated_at`. Kod yeni alanları okur, `ai_agent_id`'ye de yazar: `audiences = '{copilot}'` ise Copilot ajanı, değilse `ai_agent_ids`'in ilki ya da lisansın en eski `ai_agent` kaydı. Böylece önceki sürüme geri dönüş aynı ayrılığı görür. Parçalar yeniden embedding'e gitmez.
   3. _Daralt (sonraki sürüm):_ `ai_agent_id` nullable olur, okunmaz; `onDelete: Cascade` kalkar.
9. **Değişmeyenler.** RLS lisans düzeyinde; Copilot `AiAgent` kaydı `skill_runs` çapası olarak kalır (`copilot-service.ts:119-140`), yalnız bilgiyle bağı kopar; `status` indeksleme durumu olarak kalır, kaynağa yayın durumu kolonu açılmaz (yayın durumu sürüm paketinde — tm 290, tm 316; `SiyahTus-Analiz/07-gorev-plani.md` §4); `refresh_after_days` yeniden tarama olarak kalır.

## 3. Sonuçlar

- **Değişen:** `copilot-service.ts`'in "iki bilgi tabanı birbirinden asla cevap vermez" ilkesi kalkar, yerine kaynak başına kitle gelir. Ayrılık hâlâ vardır ama yönlüdür: `{copilot}` kaynağı oyuncuya asla gitmez; AI Agent'ın kaynakları Copilot'a açıktır. PRD 12.2'nin "ayrı KB" ifadesi "`{copilot}` kitleli kaynaklar" olarak okunur. `/copilot/knowledge` ve `/knowledge-sources` kontrat açıklamalarındaki "ayrı tutulur (FR-MOD-12.2)" cümleleri tm 309.1'de güncellenir.
- **Taşımadan sonra görünür değişiklik:** AI Agent'ın mevcut bütün kaynakları Copilot taslaklarına da girer (eski ayrılıkta girmiyordu). Copilot'a özel kaynaklar oyuncuya gitmemeye devam eder. Yayınlanmış Genel KB makaleleri (S2 varsayılanıyla) AI ve Copilot bilgisine eklenir; mevcut makalelerin indekslenmesi migration'da değil arka plan işinde yapılır, embedding maliyeti AI günlük bütçesine sayılır.
- **Bu turda sabitlenen ayrıntılar (tm 309 için):**
  1. `GET /copilot/knowledge` = `audiences = '{copilot}'` (tam eşitlik), içerme değil. Kabul kriteri "`/copilot/knowledge` taşımadan önce ve sonra aynı öğeler" ancak böyle tutar; `@> '{copilot}'` AI Agent'ın bütün kaynaklarını da getirirdi.
  2. `GET /knowledge-sources` parametresiz = `audiences @> '{ai_agent}'`; birleşik liste `?audience=all`.
  3. Kitle değerleri yalnız `ai_agent`, `copilot`; boş kitle yok.
  4. `ai_agent_ids` Copilot'a uygulanmaz; marka süzgeci sohbet içindeki Copilot'a uygulanır.
  5. Gözden geçirme süresi geçen kaynak yalnız uyarı alır; aramadan çıkaran yalnız `valid_until`. Otomatik yeniden tarama gözden geçirme sayılmaz.
  6. Taşımada `reviewed_at = updated_at` (bir onay değil, son düzenleme — panel bunu "taşımadan" diye gösterebilir).
  7. Geçiş sürümünde `ai_agent_id` geri dönüşü bozmayacak biçimde yazılır (§2 madde 8.2). Bugün `AiAgent` silen bir uç yok (doğrulandı); daraltmadan önce eklenirse ortak bilgi `Cascade` ile silinir — böyle bir uç daraltmadan önce açılmamalı.
  8. Arama süzgeci tek SQL koşuludur (05 § AI-14 kodlama mantığı 3; `s.status='published'` yerine bugünkü `s.status = 'ready'`). Süzgeçli yaklaşık HNSW aramasının satır kaçırma riski (`schema.prisma` `KnowledgeChunk` notu) için tm 254'teki ölçüm 309.2'de yeniden yapılır; gerekirse süzgeç kolonları `knowledge_chunks`'a denormalize edilir.
- **Açık kalan:** marka çözümünün tek tanımı (`chats.brand_id`'nin widget'ın web sitesinden çözülmesi; WG-01/WG-02 ile ortak) — tm 309.1 sabitler. "Benzer kaynak" uyarısı (0.95) isteğe bağlı.
- **Bu kararı delen bir değişiklik** (`{copilot}` kaynağını oyuncu cevabına açan bir yol, kitlenin yeniden ajan kaydına bağlanması, Genel KB'ye depodan otomatik yayın) yeni bir karar kaydı ve sahip onayı ister.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — AI-14 satırı (P1, F1, "KOD, LC").
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — Karar kaydı K11; § AI-14 (gerekçe, kilitli kararla ilişki, netleştirilecek sorular 1–3).
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — "Uygulayıcı için kurallar" madde 4; kilitli karar tablosu (Q6 → AI-14); § AI-14 (mevcut kod, eklenecek yerler, kodlama mantığı 1–7, kabul kriterleri, riskler).
- `SiyahTus-Analiz/07-gorev-plani.md` — #274 Dalga 0; AI-14 → #309 (bağımlılık #274); §4 "Düzenleme tablolarında `status`" ve Q6 satır kayması.
- `SiyahTus-Analiz/kaynaklar/livechat-kesif-raporu.md` §2.3 — Knowledge hub, "For internal use only".
- `docs/archive/handoff/HANDOFF-arsiv-2026-10-14.md` — Q6 kayıtları (`grep -n 'Q6'`).
