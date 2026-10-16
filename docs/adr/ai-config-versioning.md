# ADR-14b — AI yapılandırması sürümlü paket: taslak = düzenleme tabloları, çalışma anı = yayınlanmış değişmez paket

- **Görev:** tm 290 (AI-CONFIG-VERSION-DESIGN) · PLAN.md §0 (ADR-14b eki) · §D252
- **Tarih:** 2026-10-16
- **Durum:** Kabul edildi. Sahip kararı **K21** ("AI-20 tasarım notu ve RP-04 veri yakalama öne alınsın" — ✅ ikisi de Dalga 2'ye). AI-20 sorularının önerilen varsayılanları: **S1** tek paket, tek sürüm numarası; serbest bilgi metni düzeltmesi "hızlı yol"dan küçük sürümle çıkar. **S2** ödeme, bonus, KYC tabloları ve uyum kuralları onaya tabidir; serbest makale ve SSS metnini Yönetici doğrudan yayınlar. **S3** geri alma ve duraklatma tek Yönetici işidir; ileri yayın her zaman dört göz ister. **S4** zamanlanmış yayın var. Kaynak: `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` (Karar kaydı K21; § AI-20).
- **Değiştirdiği karar:** ADR-14 (PLAN.md §0) — lafzı aynen kalır. ADR-14a'dan sonra ikinci ek: Skill tek paradigma olmaya devam eder; bu ek, Skill'in ve onunla birlikte okunan bütün AI yapılandırmasının **nereden okunduğunu** sabitler. ADR tablosunun satırı değişmedi.
- **Bağlı görevler:** uygulama tm 316 AI-CONFIG-VERSIONING'dedir (AI-20), değişiklik geçmişi tm 315 AI-CONFIG-HISTORY'dedir (AI-21). Şema kuralları §2.12'deki tabloyla şu görevlere bağlanır: tm 292, 296, 299, 301, 303, 307, 309, 310.
- **Kod değişikliği:** yok. Bu dosya yalnız kararı kayda geçirir. 05'e göre bu not, AI-01…AI-15 kodlanmadan önce sabitlenmelidir; sonradan geri dönmek pahalıdır.

## 1. Bağlam

AI-20, AI yapılandırmasının canlıdan ayrı bir taslakta düzenlenmesini istiyor. Taslak test edilir, onaylanır, numaralı sürümle yayınlanır ve gerektiğinde önceki sürüme dönülür. Ekip Lideri hazırlar, Yönetici yayınlar. Uyum kuralını değiştiren sürüm için Kurucu onayı gerekir.

Bugünkü durum (2026-10-16, HEAD `58c45c74`'te yeniden doğrulandı):

- **Canlı AI düzenleme tablolarını doğrudan okuyor.** `SkillEngine.run` her turda `skill.findMany({ where: { active: true, kind: 'ai_agent', aiAgent: { active: true } } })` çağırıyor ve personayı aynı satırdan alıyor (`apps/api/src/services/ai/skill-engine.ts:241-259`). Önizleme ajanı ayrıca okuyor (`:337-349`). Okuma yolu bu iki yerden ibaret.
- **Yazmalar canlıyı anında değiştiriyor.** `PATCH /ai-agents/:aiAgentId` (`apps/api/src/routes/playbook.ts:373`), `POST`/`PATCH`/`DELETE /skills` (`:447`, `:499-534`, `:536`), bilgi kaynağı oluşturma, güncelleme, yeniden indeksleme ve silme (`:679`, `:761`, `:855`, `:1180`, `:1301`, `:1356`) ve Copilot bilgi uçları (`apps/api/src/routes/copilot.ts:215`, `:253`). Bunların hiçbirinde taslak, sürüm ya da iyimser kilit yok. Dosya başındaki tek koruma şu: skill hiçbir zaman aktif olarak yaratılmaz (`playbook.ts:1-9`).
- **Parçalar silinip yeniden yazılıyor.** `KnowledgeService.index` önce kaynağın bütün parçalarını siliyor (`knowledge_chunks`, `deleteMany({ where: { sourceId } })`, `apps/api/src/services/ai/knowledge-service.ts:303`), sonra yenilerini ekliyor. Yedi çağıran var: `playbook.ts:730, 817, 1124, 1263, 1345`, `copilot-service.ts:228` ve website tazelik süpürmesi `knowledge-refresh-sweep.ts:257`. Eski bir sürüme dönülecekse eski parçalar yerinde olmalıdır. Bugün değiller.
- **Şemada sürüm yok.** `Skill.active`, `AiAgent.active` ("Answering / Paused") ve `KnowledgeSource.status` var (`ready`/`indexing`, yayın durumu değil, indeksleme durumu). `Workflow.status` ADR-14 gereği ölü (`apps/api/prisma/schema.prisma:1730-1748`, `:1834-1856`, `:2061-2093`, `:2045`).
- **Sürüm kimliğinin yuvaları hazır ve boş.** `ai_decision_logs.config_version_id` (`schema.prisma:1911-1958`, yazıcı `decision-log.ts:65,141`) ve `ai_usage_events.config_version_id` (`:2624-2647`, yazıcı `ai-daily-budget.ts:88-93,343`) nullable `uuid`, yabancı anahtarsız. İkisinin yorumu da "tm 290 gelince" diyor. `ai_decision_logs.procedure_version` da var; hiçbir çağıran yazmıyor.
- **Yetki kaba.** AI yapılandırması `agents-bot--all:rw` kapsamıyla korunuyor; bu kapsam yalnız owner/viceowner/admin rollerinde (`packages/types/src/role-scopes.ts:89`). Ekip Lideri rolü yok; yapılandırılabilir izin matrisi tm 325'te.
- **v1'de çalışma alanı başına tek müşteri-yüzlü ajan var.** tm 390 bunu kısmi tekil indeksle (`(license_id) WHERE kind='ai_agent'`) sabitleyecek; çoklu ajan ayrı bir epik. Copilot ayrı bir `AiAgent` kaydı (`kind='copilot'`). Bilgi ise tek depoda (`docs/adr/single-knowledge-store.md`).
- **AI turu işçide koşuyor.** Tur ziyaretçi isteğinde değil, kalıcı kuyruğun işçisinde koşuyor (ADR-11a, `docs/adr/durable-ai-jobs.md`). Hangi sürümün okunacağı istekten değil, kalıcı bir satırdan gelmelidir.

Sorun şu: AI-03 (prosedür), AI-07 (talimat), AI-08 (koruma), AI-09/12 (devir), AI-13 (tablolar) ve AI-14 (tek depo) kendi tablolarını açacak. Her biri bugünkü kalıpla "canlıya doğrudan yaz, canlıdan doğrudan oku" diye kurulursa sürümleme sonradan her tabloya ayrı ayrı `status`/`version` eklemek, her okuma yolunu tek tek değiştirmek ve silinmiş bilgiyi geri getirememek demektir.

## 2. Karar

### 2.1 İki katman

1. **Taslak çalışma alanı = düzenleme tabloları.** Panelin ve API'nin yazdığı tablolar taslaktır: `skills` (prosedür alanlarıyla, tm 296), `ai_guidance_rules` (tm 299), `ai_agents.persona`/`tone`/`languages` (ve taşınana kadar `instruction`), `ai_guardrail_settings`, `ai_guardrail_rules`, `ai_forbidden_phrases` (tm 301), `ai_handoff_settings` (tm 303), `handoff_routes`'un AI'ın okuduğu hâli (tm 307), `knowledge_sources` ve parçaları (tm 309), yapılandırılmış bilgi tabloları ve "Erişim bilgisi" (tm 310). Bu tablolarda **yayın durumu yoktur**. Satırın taslağı ve canlısı ayrı satırlar değildir. Taslak, tablonun bugünkü hâlinin kendisidir.
2. **Canlı = yayınlanmış, değişmez paket.** Oyuncuya cevap veren AI yalnız `ai_config_versions.snapshot` okur (§2.4). Paket yayından sonra hiç değişmez. Geri alma bile yeni bir sürüm yazar (§2.10).
3. **Taslak simülasyonu** (AI-19 "oyuncu gibi konuş", Playbook önizlemesi) taslağı okur. Taslağı canlıyla aynı derleyiciden geçirir: önizleme yayından sonra olacak davranışı gösterir.

### 2.2 Sürümlenmeyenler

- `ai_agents.active` — **duraklatma anahtarı**. Her turda canlı okunur, pakete girmez (§2.10 madde 6). Acil durdurma beklemeden etki etmelidir.
- Platformun kilitli G1–G19 koruma kataloğu (tm 301) — kodda durur, dağıtımla değişir. Paket yalnız hangi katalog sürümüyle derlendiğini kaydeder (`guardrail_catalog_version`).
- **Copilot** — ajan-yüzlüdür, oyuncuya gitmez. Tek depodaki `audiences @> '{copilot}'` kaynakları taslak görünümünden okur (§2.8 madde 5).
- **İnsan yönlendirmesi** (AU-01) `handoff_routes`'u canlı okur; sürümlenen yalnız AI devir hedefi çözümüdür (§2.12, tm 307).
- Yardım merkezi makalelerinin (`kb_articles`) widget yayın durumu. Makale AI'a bağlıysa AI'ın gördüğü hâli bilgi parçası olarak sürümlenir (tm 309).
- **Kayıtlar:** `ai_decision_logs`, `ai_usage_events`, `ai_guardrail_hits`, `ai_conversations`, `skill_runs`. Bunlar yapılandırma değil, sürüme **atıf yapan** satırlardır.
- **Meta alanlar.** AI davranışını değiştirmeyen alanlar pakete girmez ve taslak revizyonunu artırmaz: `owner_id`, `reviewed_at`, `review_interval_days`, `created_by`/`updated_by`. Değişiklik geçmişine (AI-21) yine de düşerler. `valid_until` davranışı değiştirir; pakete girer ve turda o anki saatle değerlendirilir.

### 2.3 Şema (tm 316 açar)

- `ai_config_versions`: `id`, `license_id`, `ai_agent_id`, `number`, `minor`, `seq`, `status` (`in_review` | `approved` | `published` | `superseded` | `rejected`), `snapshot jsonb`, `snapshot_hash`, `package_format`, `knowledge_manifest jsonb`, `diff_summary jsonb`, `base_version_id`, `draft_revision`, `test_run_id`, `touches_compliance`, `submitted_by/at`, `reviewed_by/at`, `review_note`, `published_by/at`, `scheduled_at?`, `rollback_of?`. Kiracı tablosu, RLS. Uygulama rolü yayınlanmış satırın `snapshot`/`knowledge_manifest`/`snapshot_hash` alanlarını güncelleyemez; bunu tetikleyici zorlar.
  - **`number.minor`** ekranda görünen addır ("v12", "v12.1"). Tekillik `(license_id, ai_agent_id, number, minor)`.
  - **`seq`** lisans genelinde, yayın anında verilen, kesin artan tamsayıdır (`unique (license_id, seq)`; yayına kadar `NULL`). Lisans başına transaction kilidiyle atanır, böylece commit sırasıyla aynıdır. Parça görünürlüğü `number`'a değil `seq`'e bağlanır, çünkü küçük sürüm (v12.1) parçaları v12'den ayrı açabilmelidir (§2.8).
  - **`base_version_id`**: paketin farkı alınan yayındaki sürüm. Yayında `base_version_id`'nin hâlâ yayında olduğu yeniden kontrol edilir (§2.10 madde 4).
  - **Açık sürüm.** Bir ajanda aynı anda en çok bir açık sürüm (`in_review` | `approved`) bulunur. Yeni gönderim açık olanı `rejected` yapar (`review_note = 'superseded_by_submit'`). İki onaylı paketin ters sırayla yayınlanıp birbirini geriletmesi böylece önlenir.
- `ai_agents.published_version_id uuid null` (yayındaki sürüm işaretçisi) ve `ai_agents.draft_revision bigint not null default 0`.
- `knowledge_sources.retired_at timestamptz null` ve `knowledge_sources.chunk_generation int not null default 1`; `knowledge_chunks.generation int not null default 1`, `visible_from_version bigint null`, `hidden_from_version bigint null`. İndeks `(license_id, visible_from_version, hidden_from_version)`. Neden gerektikleri §2.8'de.
- **Geri dolum:** her lisansın bugünkü durumu `v1` (`seq = 1`) olarak derlenip yayınlanır. Mevcut parçalar `generation = 1`, `visible_from_version = 1` alır.

### 2.4 Paket (`AiConfigPackage`)

Derleyici (`services/ai/config-compiler.ts`, tm 316) taslağı tek bir JSON belgesine çevirir:

- `package_format` (paket şemasının sürümü) ve `guardrail_catalog_version`.
- `agent` — persona, ton, diller, mod.
- `guidance` — `ai_guidance_rules`, prompt katman sırasına dizilmiş hâliyle (tm 299).
- `skills` — yalnız etkin (`active = true`) skill'ler ve prosedürler, tam tanımlarıyla. **Kimlikler korunur.** Paketteki `skills[].id` düzenleme tablosundaki satırın kimliğidir; karar kaydı ve `procedure_id` bu kimliğe atıf yapar.
- `handoff` — `ai_handoff_settings` ve AI'ın kullandığı `handoff_routes` satırları (grup kimliğiyle).
- `guardrails` — kiracı ekleri, yasaklı ifadeler, kriz ve şikâyet metinleri.
- `tables` — yapılandırılmış bilgi tablolarının satırları ve "Erişim bilgisi" (tm 310). Bu satırlar küçüktür ve olduğu gibi kopyalanır; `facts.ts` kesin hesaplarını paketten yapar.
- `knowledge_manifest` (ayrı kolon) — her kaynak için `{ source_id, generation, audiences, ai_agent_ids, brand_ids, language, type, valid_until }`. Bilgi parçalarının kendisi (metin ve embedding) pakete kopyalanmaz. Pakete girmeleri için çok büyükler, onların yerine §2.8'deki görünürlük aralıkları var.

Belge kanonik JSON'dur (anahtarlar sıralı, gereksiz boşluk yok). `snapshot_hash = sha256(kanonik JSON)` olarak yazılır. Önerilen boyut tavanı 2 MB; derleyici tavanı aşan taslağı nedeniyle reddeder. Tavanı tm 316 ölçerek sabitler.

### 2.5 Tek yazma yardımcısı

Düzenleme tablolarına her yazma **tek bir yardımcıdan** geçer: `services/ai/config-draft.ts`. Rota başına elle yazılmaz. Yardımcı yazmayla aynı transaction'da şunları yapar:

1. Satırın `updated_at`'ini yazar.
2. Davranışı değiştiren bir yazmada (meta alanlar hariç, §2.2) etkilenen müşteri-yüzlü ajanın `draft_revision`'ını artırır. Artış koşulludur: `UPDATE ai_agents SET draft_revision = draft_revision + 1 WHERE id = $1 AND draft_revision = $beklenen`. Satır dönmezse sonuç **409 `ai_config_revision_conflict`** olur (`details.current_revision` ile); ADR-06 zarfı kullanılır, dar hata tipi geleneği (`packages/types/src/errors.ts`) korunur. İstemci beklenen revizyonu `If-Match` başlığıyla gönderir. Başlık yoksa koşulsuz artar; bu, tm 316 panel istemcilerini başlığa geçirene kadar bugünkü "son yazan kazanır" davranışıdır. Tek depodaki bir kaynak ajanların hepsini kapsıyorsa (`ai_agent_ids = '{}'`) kapsamdaki bütün müşteri-yüzlü ajanlar artar. v1'de bu tek ajandır.
3. AI-21 değişiklik satırını yazar (`recordChange`, tm 315).

Yardımcıyı, düzenleme tablosuna yazan **ilk** görev açar (tm 296 ya da tm 299; hangisi önce gelirse). İlk hâli yalnız 1. adımı yapar. tm 315 3. adımı ekler. tm 316 `draft_revision` kolonunu ve 2. adımı ekler. Böylece sürümleme gelince rota rota dolaşmak gerekmez. `status` ya da `version` kolonu açan veya `updated_at`'i kendisi yazan bir rota bu notu deler.

### 2.6 Tek okuma dikişi

Çalışma anı yapılandırmayı tek bir arayüzden okur: `AiConfigSource`. tm 292'nin bağlam yükleyicisi bu arayüzü kurar:

- `forTurn(tx, tenant, { aiAgentId, pinnedVersionId })` → `{ versionId: string | null, pkg: AiConfigPackage, seq: number | null }`
- `forDraft(tx, tenant, { aiAgentId })` → aynı biçim, `versionId = null`.

İki gerçekleştirmesi olur:

1. **tm 316'ya kadar — "okurken derle":** düzenleme tablolarını §2.4'teki derleyici biçimine çevirir. `versionId` ve `seq` `null` döner. Bugünkü "canlı = tablo" davranışı aynen sürer, ama okuma tek yerdedir.
2. **tm 316'dan sonra — "yayında derlenmiş":** `pinnedVersionId`'nin paketini okur. Paket değişmez olduğundan önbellek sürüm kimliğiyle süresiz tutulur (`config-cache.ts`, LRU). Geçersizleştirilen tek şey ajanın işaretçisidir (`published_version_id`; `realtime-bus` ile, commit'ten sonra).

`SkillEngine.run`'ın (`skill-engine.ts:247`) ve önizlemenin (`:337-349`) tablo okumaları bu dikişe taşınır. Yeni bir AI özelliği düzenleme tablosunu turda doğrudan okursa bu notu deler.

### 2.7 Sürümün bağlantıya sabitlenmesi

1. `ai_conversations.config_version_id` (tm 292; bağlantı başına bir satır) satır açılırken **bir kez** yazılır. Değer o anki `ai_agents.published_version_id`'dir ve satır kapanana kadar değişmez. Bağlantı ortasında yayınlanan sürüm o konuşmayı etkilemez. Sınırı bağlantının kendi ömrü çizer: bağlantı hareketsizlikle kapanır, yeni bağlantı yeni sürümü alır. Sabitleme işçideki turda yapılır (ADR-11a); `ai_jobs` satırı sürüm taşımaz.
2. Her AI turu `config_version_id`'yi şuralara yazar: `ai_decision_logs` (yuva var), `ai_usage_events` (yuva var, `ai-daily-budget.ts`'in `attribution`'ı üzerinden) ve `ai_conversations`.
3. tm 316'dan önce değer `null`'dır ve anlamı "sürümleme öncesi, canlı tablolar"dır. tm 316'dan sonra `null` taşıyan açık bir konuşma o anki yayındaki sürümü bir kez sabitler.
4. `ai_decision_logs.procedure_version`: tm 316'dan sonra sabitlenmiş sürümün `number`'ı (ekrandaki "v12"), öncesinde `null`. Sürümün kimliği `config_version_id`'dir; bu kolon yalnız okuma kolaylığıdır.
5. **Duraklatma sabitlenmez** (§2.2). Durdurulan ajan, sabitlenmiş sürümü ne olursa olsun bir sonraki turda cevap vermez.

### 2.8 Bilgi parçaları: nesil + görünürlük aralığı

Parçalar pakete kopyalanamayacak kadar büyük. Geri alma da silinmiş parçayı ister. Bu yüzden parçalar yerinde kalır ve her sürüm kendi parça kümesini bir aralık filtresiyle seçer.

1. **Silme yok, yeni nesil var.** tm 316'dan sonra yeniden indeksleme ya da içerik düzenleme eski parçaları silmez. `knowledge_sources.chunk_generation`'ı bir artırır ve yeni parçaları o `generation` ile yazar. Kaynak silme `knowledge_sources.retired_at` yazar (taslaktan çıkar). Satır ve parçaları, tutulan hiçbir sürüm onlara atıf yapmayana kadar fiziksel olarak durur. `KnowledgeService.index`'in yedi çağıranı tek giriş noktasından geçtiği için değişiklik yalnız `index`'tedir (`knowledge-service.ts:303`'teki `deleteMany` → nesil artışı).
2. **Taslak görünümü** (simülasyon, Copilot, editör listeleri): `retired_at IS NULL` olan kaynakların `generation = chunk_generation` olan parçaları.
3. **Yayın:** paketin `knowledge_manifest`'i gönderim anında her kaynağın neslini yazar. Yayın transaction'ı manifestteki `(source_id, generation)` parçalarından `visible_from_version IS NULL` olanlara `visible_from_version = seq` yazar. Önceki yayında görünüp yeni manifestte olmayan parçalara `hidden_from_version = seq` yazar. Bir aralık en çok iki kez yazılır (önce açılır, sonra kapanır) ve **asla yeniden açılmaz**. Gönderimle onay arasında taslak ilerlemiş olsa bile yayın, gözden geçirilen nesli açar. Taslağın sonraki nesli yayınlanmamış taslak olarak kalır.
4. **Canlı arama:** `visible_from_version <= seq AND (hidden_from_version IS NULL OR hidden_from_version > seq)`. Kapsam (kitle, ajan, marka, dil) canlı tablodan değil manifestten okunur. Filtre `KnowledgeService.search`'ün kesin arama tavanı ve plan sabitleme mantığının içinde uygulanır. HNSW isabetine etkisini tm 316 `measure:knowledge-retrieval` ile ölçer (§3, açık kalan).
5. **Copilot** taslak görünümünü okur (`audiences @> '{copilot}'` süzgeciyle; `single-knowledge-store.md` §2). Sürümleme Copilot'un bilgisini geciktirmez.
6. **Yeniden embedding** (`knowledge-reembed*.ts`, embedding uzayı değişimi) parçanın metnini değil vektörünü değiştirir. Yerinde güncellemeye devam eder: türetilmiş bir indekstir, içerik değişikliği değildir.
7. **Temizlik** (`knowledge_chunk_gc`, tm 316): hiçbir sürüme girmemiş, taslakta da olmayan nesiller silinir. `hidden_from_version`'ı son 5 yayından eski ve 30 günü geçmiş parçalar silinir. Tutulan bir sürümün manifestinde ya da açık sürümde geçen parça silinmez.

### 2.9 Prosedür anlık görüntüsü (AI-03)

Prosedür başlarken tanımı **sabitlenmiş paketten** `ai_conversations.procedure_snapshot`'a kopyalanır (tm 296). tm 316'dan önce paket "okurken derle"nin çıktısıdır. Aynı tur `procedure_snapshot_hash = sha256(kanonik JSON)` yazar. Devir kartı (AI-10) bu hash'in ilk 12 karakterini ve sürüm adını ("v12 · 3f9a…") gösterir. Konuşmanın gördüğü prosedür, yayındaki prosedürden ayrıldığında ajan bunu karttan görür.

### 2.10 Yaşam döngüsü (tm 316 uygular)

1. **Onaya gönder:** derleyici taslağı doğrular: adımlar geçerli mi, AI-07 çelişki denetimi temiz mi, devir hedefi grupları var mı. Paket ve `base_version_id`'ye göre fark üretilir. Fark kiracı korumalarına, yasaklı ifadelere, risk politikasına (AI-27) ya da kilitli kategorilere dokunuyorsa `touches_compliance = true` olur. Gönderilen `draft_revision` için son AI-19 koşusunda uyum paketi %100 geçmiş olmalıdır. Sonra durum `in_review` olur ve onaycılara bildirim gider.
2. **Onay:** onaycı gönderen olamaz. Bu sunucuda zorlanır ve 403 `not_allowed` döner. `touches_compliance` varsa onaycı Kurucu olmalıdır. `publish_at` verilmişse durum `approved` olur ve beklenir; verilmemişse sürüm hemen yayınlanır.
3. **Yayın (tek transaction):** lisans kilidi alınır ve `seq` atanır. Sürüm `published`, öncekisi `superseded` olur, işaretçi güncellenir, parça aralıkları yazılır (§2.8), AI-21 satırı ve `audit_log` (`ai.config_published`) yazılır. Commit'ten sonra önbellek işaretçisi geçersizleştirilir ve RTM push `ai_config_published` gönderilir (ADR-15 zarfı).
4. **Taban kontrolü:** yayında `base_version_id` hâlâ yayındaki sürüm olmalıdır. Arada hızlı yoldan ya da geri almayla başka bir sürüm yayınlanmışsa iki durum var:
   - Yalnız açık sürümün dokunmadığı kaynaklar değiştiyse manifest o kaynaklarda yeni yayının nesline kendiliğinden taşınır ve yayın sürer.
   - Aynı kaynağa ya da paketin bilgi dışı bir alanına ikisi de dokunduysa sürüm `rejected` olur (`stale_base`) ve yeniden gönderilir.
5. **Zamanlanmış yayın (S4):** `ai_scheduled_publish` dakikada bir, kilitli koşar. Yayın anında onayın, uyum koşusunun ve tabanın hâlâ geçerli olduğunu yeniden kontrol eder. Biri tutmuyorsa yayınlamaz ve bildirim gönderir.
6. **Duraklat / sürdür (S3):** `AiAgent.active` (mevcut alan) yazılır, AI-21 ve `audit_log` kaydı düşer. Tek bir Yönetici (ve üstü) yapabilir. Turda canlı okunur (§2.7 madde 5).
7. **Geri alma (S3):** seçilen sürümün paketinden yeni bir sürüm doğar (ör. v14 = v11'in kopyası, `rollback_of`). Tarih yeniden yazılmaz. Kapanmış aralıklar yeniden açılmaz: gereken parçalar yeni bir nesil olarak **kopyalanır** (metin ve vektör aynen, embedding maliyeti yok) ve `visible_from_version = seq` alır. Kopyalanacak parça temizlenmişse geri alma engellenir ve nedeni açıklanır. Tek bir Yönetici yapabilir.
   - Geri alma **taslağa dokunmaz.** Taslağı paketten tablolara geri açmak bu notun kapsamında değil (P2). Sürüm çubuğundaki "Taslak: n değişiklik" farkı yeni yayındaki sürüme göre hesaplanır; geri alınan hatalı değişiklik taslakta bekleyen değişiklik olarak görünür.
   - Geri alma açık konuşmaların sabitlenmiş sürümünü değiştirmez. Canlıdaki yanlış bilgiyi hemen durdurmanın aracı duraklatmadır.
8. **Hızlı yol (S1/S2):** Yönetici bir serbest makaleyi ya da SSS kaynağını (`type ∈ {article, faq}` veya Genel KB'ye bağlı kaynak) düzeltirse değişiklik kendiliğinden onaylanan küçük bir sürümle yayınlanır (v12.1). Paket, yayındaki paketin kendisidir; yalnız o kaynağın manifest satırı yenidir. Taslaktaki öteki bekleyen değişiklikler bu yayına girmez. Ödeme, bonus, KYC tabloları ve uyum kuralları hızlı yoldan geçmez. AI-21 kaydı yine yazılır.
   - Website tazelik süpürmesinin getirdiği yeni nesil de varsayılan olarak bu yoldan yayınlanır (aktör `system`, AI-21 `crawled`). Kiracı "onaylı yenileme"yi açarsa yeni nesil taslakta bekler (05 AI-17 madde 10).

### 2.11 Yetenekler (RL-02 / tm 325'e girdi)

| Yetenek                        | Kurucu | Yönetici                  | Ekip Lideri | Ekip Üyesi |
| ------------------------------ | ------ | ------------------------- | ----------- | ---------- |
| `ai.config.edit`               | ✓      | ✓                         | ✓ (taslak)  | –          |
| `ai.config.submit`             | ✓      | ✓                         | ✓           | –          |
| `ai.config.publish`            | ✓      | ✓ (kendi gönderisi hariç) | –           | –          |
| `ai.config.publish_compliance` | ✓      | –                         | –           | –          |
| `ai.config.rollback`           | ✓      | ✓                         | –           | –          |
| `ai.pause`                     | ✓      | ✓                         | –           | –          |

05'in alan başına düzenleme anahtarları (`ai.procedures.edit`, `ai.guidance.edit`, `ai.knowledge.edit` …) taslakta **hangi tabloya** yazılabileceğini belirler. Yayın tek pakettir. Bu yüzden 05'teki `ai.procedures.publish` ayrı bir anahtar olarak açılmaz; yerini `ai.config.publish` alır. tm 325 gelene kadar altı anahtarın hepsi `agents-bot--all:rw`'ye eşlenir (owner/viceowner/admin). Dört göz (gönderen ≠ onaycı) rolden bağımsız olarak o zaman da zorlanır.

### 2.12 AI çekirdeği görevlerinin şema kuralları

Bu tablodaki görevler kendi tablolarını bu nota göre açar. Her görevin Task Master ayrıntısı bu dosyaya atıf yapar.

| Görev                             | Tablo / alan                                                                               | Kural                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tm 292 AI-CONVERSATION-CORE       | `ai_conversations.config_version_id`, `procedure_snapshot`, bağlam yükleyici               | Sürüm satır açılırken bir kez sabitlenir, sonra değişmez (§2.7). Bağlam yükleyici yapılandırmayı yalnız `AiConfigSource`'tan okur (§2.6). Her tur `config_version_id`'yi karar kaydına ve kullanım defterine yazar. `ai_conversations` bir kayıttır, düzenleme tablosu değil.                                                                          |
| tm 296 AI-PROCEDURE-ENGINE        | `skills.mode/procedure/…`, `procedure_snapshot(_hash)`                                     | `status`/`version` kolonu açılmaz. `active` = "bu sürümde etkin". Yazmalar `config-draft.ts`'ten geçer (§2.5). Snapshot sabitlenmiş paketten alınır, hash devir kartına gider (§2.9). Kurulan şablon kopyası (`ai-template-catalog.md` §2, "`status='draft'`") kolon değil, `active = false`'tur.                                                      |
| tm 299 AI-GUIDANCE-RULES          | `ai_guidance_rules`, `ai_agents.instruction` taşıması                                      | `status` kolonu açılmaz. `active` = "bu sürümde etkin". Yazmalar yardımcıdan geçer. Kurallar pakete katman sırasıyla girer (§2.4). Taşıma yazması da yardımcıdan geçer ve tek AI-21 satırı üretir.                                                                                                                                                     |
| tm 301 AI-GUARDRAILS              | `ai_guardrail_settings`, `ai_guardrail_rules`, `ai_forbidden_phrases`, `ai_guardrail_hits` | İlk üçü taslak tablosudur: `status` açılmaz, yazma yardımcıdan geçer, değişiklik `touches_compliance` sayılır (Kurucu onayı). `approved_by/approved_at` bir yayın kapısı değildir; tm 316'dan sonra kapı sürümün onayıdır. G1–G19 kodda kalır, paket katalog sürümünü kaydeder. `ai_guardrail_hits` bir kayıttır, tura (`turn_id`) bağlanır.           |
| tm 303 AI-HANDOFF-TRIGGERS-RULES  | `ai_handoff_settings`, devir kuralları                                                     | Taslak tablosudur: `status` açılmaz, yazma yardımcıdan geçer. Tetikleyiciler ve "çözüldü" kriterleri turda sabitlenmiş paketten okunur.                                                                                                                                                                                                                |
| tm 307 AI-HANDOFF-TARGET-PRIORITY | `handoff_routes`, `threads.priority`                                                       | `handoff_routes` AU-01'le ortaktır. AI devir hedefini paketteki kopyadan çözer, insan yönlendirmesi canlı tablodan. Paketteki grup artık yoksa ya da etkin değilse sıra şöyledir: aynı anahtar için canlı rota, sonra genel kuyruk; karar kaydına `details.handoff_target_fallback` düşer. `status` açılmaz. `threads.priority` yapılandırma değildir. |
| tm 309 KB-SINGLE-STORE            | `knowledge_sources` (+ kapsam alanları), `knowledge_chunks`                                | `status` kolonu açılmaz (`status` indeksleme durumu olarak kalır). Kaynak yazmaları yardımcıdan geçer. Parça yazımı yalnız `KnowledgeService.index`'ten olur; tm 316 orada silmeyi nesil artışına çevirir (§2.8). Kapsam alanları sürümde manifestten okunur. `retired_at`, `chunk_generation`, `generation` ve aralık kolonlarını tm 316 açar.        |
| tm 310 KB-STRUCTURED-TABLES       | Ödeme Yöntemleri, Bonuslar, KYC Belgeleri, Limitler ve Kurallar, Erişim bilgisi            | `status` kolonu açılmaz. Yazmalar yardımcıdan geçer. Satırlar pakete kopyalanır, `facts.ts` paketten okur (§2.4). Bu tablolar hızlı yoldan geçmez, her zaman onaya tabidir (S2). `owner_id`, `reviewed_at` ve `review_interval_days` meta alanlardır (§2.2); eskime uyarısı canlıdan hesaplanır.                                                       |

## 3. Sonuçlar

- **Uyumlu kalan:**
  - ADR-14 ve ADR-14a: Skill tek paradigma, prosedür adım listesi, `workflows` ölü.
  - `single-knowledge-store.md` §2 madde 9: kaynağa yayın durumu kolonu açılmaz. Bu not o kararın sürüm tarafını tamamlar.
  - ADR-11a: tur işçide koşar, sürüm `ai_conversations`'tan okunur, `ai_jobs` sürüm taşımaz.
  - ADR-15: yeni push aynı zarfla açılır.
- **Değişen:**
  - Düzenleme tabloları tm 316'dan sonra canlıyı değiştirmez.
  - `skills.active`'in anlamı "şu an cevap veriyor"dan "bu sürümde etkin"e döner. Kiracıya geçişte kısa bir açıklama gösterilir (tm 316).
  - `KnowledgeService.index` parça silmeyi bırakır.
  - Kaynak silme taslaktan çıkarmaya döner.
  - `ai-template-catalog.md`'deki "`status='draft'`" ifadesi kolon olarak okunmaz.
- **05'e göre bu notta eklenen ayrıntılar** (05'in AI-20 bölümünde yok; §D252):
  - `seq`, lisans genelinde yayın sırası; görünürlük kolonları bunu tutar.
  - `base_version_id` ve taban kontrolü.
  - Ajan başına en çok bir açık sürüm.
  - Parça nesli (`generation`, `chunk_generation`) ve kaynakta `retired_at`.
  - `snapshot_hash` ve `package_format`.
  - Geri almanın parçaları yeni nesil olarak kopyalaması ve taslağa dokunmaması.
  - `ai_config_revision_conflict` hata tipi.
  - `ai.procedures.publish` yerine tek `ai.config.publish`.
- **Varsayımlar:**
  1. v1'de çalışma alanı başına tek müşteri-yüzlü ajan var (tm 390). Ajan başına sürüm hattı bu yüzden lisans başına hatla aynıdır.
  2. Copilot sürümlenmez.
  3. Bağlantıya sabitlenen sürüm geri almayla değişmez; acil durumun aracı duraklatmadır.
  4. Website tazelik yenilemesi varsayılan olarak hızlı yoldan yayınlanır.
- **Açık kalan:**
  - **Çoklu ajan.** Tek depodaki bir kaynağı iki ayrı sürüm hattı paylaşırsa aralıklar tek bir `seq` çizgisinde artık çakışabilir. Çoklu ajan epiği ya hattı lisans geneline çeker ya da canlı filtreyi manifestin `(source_id, generation)` eşlemesine çevirir. Bu yeni bir ADR eki ister.
  - Görünürlük filtresinin HNSW isabetine etkisi ölçülmedi; tm 316 `measure:knowledge-retrieval` ile ölçer.
  - Paket boyut tavanı (öneri 2 MB) ölçülmedi.
  - Taslağı bir sürümden geri açma (P2).
- **Bu eki delen değişiklikler** yeni bir ADR eki ve sahip kararı ister:
  - Düzenleme tablosuna yayın durumu kolonu açmak.
  - Turda düzenleme tablosunu doğrudan okumak.
  - Yayınlanmış paketi ya da kapanmış bir parça aralığını değiştirmek.
  - Parçayı tutulan bir sürüm hâlâ atıf yaparken silmek.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — AI-20 satırı (P1, F1).
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — Karar kaydı K21; § AI-20 (gerekçe, netleştirilecek sorular S1–S4).
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — § AI-20 (önerilen model, şema, kodlama mantığı, kabul kriterleri, "tasarım sırası" riski); § AI-21; § AI-17 madde 10 ("onaylı yenileme"); yetki anahtarları tablosu.
- `SiyahTus-Analiz/07-gorev-plani.md` — AI-20 → #290 (tasarım) / #316 (uygulama); AI-21 ↔ AI-20 döngüsü notu.
- `docs/adr/skill-procedure.md` (ADR-14a), `docs/adr/single-knowledge-store.md`, `docs/adr/durable-ai-jobs.md` (ADR-11a), `docs/adr/ai-template-catalog.md`.
