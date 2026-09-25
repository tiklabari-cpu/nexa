# ADR — Pilot için sohbet (LLM) ve embedding sağlayıcısı

- **Görev:** tm 255.1 (PILOT-LLM-DECIDE) · PLAN.md §D176
- **Tarih:** 2026-09-22
- **Durum:** Kabul edildi (pencere kararı). Kod ve testler (255.5–255.9) bu karara göre hemen ilerleyebilir; **pilotun canlıya çıkması** §11'deki iki sahip onayını bekler.
- **Yöntem:** Yalnız resmi dokümantasyon okundu (URL'ler her satırda ve §12'de). Hiçbir sağlayıcıya istek atılmadı, hesap açılmadı, anahtar edinilmedi ya da girilmedi. Bu dosyada hiçbir sır değeri yoktur; yalnız anahtar ADLARI vardır.
- **PRD:** NFR-C4 (bölge/HIPAA kapısı korunur) · FR-MOD-06.3.2 (embedding + index sözleşmesi) · FR-05-06.EK1 (skill motoru çalışma zamanı).

## 0. Karar — tek tabloda

| #   | Soru                             | Cevap                                                                                                                                                                                                                                                                              |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sohbet sağlayıcısı               | **OpenAI, kendi `/v1/chat/completions` ucu** (uyumluluk katmanı değil, protokolün sahibi). `LLM_PROVIDER=openai`.                                                                                                                                                                  |
| 2   | "OpenAI uyumlu" iddiası          | Aday başına ayrı doğrulandı (§3). Yalnız OpenAI'ın kendisi tam; Anthropic katmanı kendi belgesinde "production-ready değil", Gemini katmanı beta ve bilinmeyen alanı sessizce yutuyor, Mistral alan adlarında ayrışıyor. **Başka bir satıcı = yeni enum değeri + kendi adaptörü.** |
| 3   | Embedding sağlayıcısı            | **Sohbetten AYRI yapılandırılır.** Seçim: OpenAI `text-embedding-3-small`. `EMBEDDING_PROVIDER=openai`.                                                                                                                                                                            |
| 4   | 1536 boyut                       | **EVET, native** (varsayılan boyutu 1536). `vector(1536)` kolonu ve HNSW indeksi için **migration YOK**. Ama sahte→gerçek geçişi **tam yeniden gömme** ister (§4.3).                                                                                                               |
| 5   | Streaming pilotta gerekli mi     | **HAYIR — kapsam dışı.**                                                                                                                                                                                                                                                           |
| 6   | Tool/function calling gerekli mi | **HAYIR — kapsam dışı.**                                                                                                                                                                                                                                                           |
| 7   | Bölge                            | Bölgesel host zorunlu: `us.api.openai.com` ↔ `us`, `eu.api.openai.com` ↔ `eu`. Global `api.openai.com` production'da reddedilir. Embedding de aynı NFR-C4 kapısından geçer (`EMBEDDING_PROVIDER_REGION`).                                                                          |
| 8   | Ücretlendirme / limitler         | Token bazlı (sohbet: girdi + çıktı; embedding: girdi). Limitler organizasyon + proje + model başına RPM/TPM/RPD/TPD. Sayaç **token** tutar, fiyat koda gömülmez (§8).                                                                                                              |

## 1. Bugünkü kod (2026-09-22, ölçüldü)

- `apps/api/src/config/env.ts` — `LLM_PROVIDER: z.enum(['mock']).default('mock')`: enum kapalı; gerçek sağlayıcı bir config değeri değil, kod işi. `LLM_PROVIDER_REGION: z.enum(REGIONS).optional()`, `REGIONS = ['eu','us']` (`packages/types/src/domain.ts`).
- `apps/api/src/services/ai/inference.ts` — yalnız bölge/izin kapısı (`resolveInferenceProvider`, `inferenceLeavesRegion`, `assertInferenceAllowed`). Adaptör yok.
- **AI yanıtı bugün üretken DEĞİL, çıkarımsal (extractive):** `skill-engine.ts` → `matchIntent` → `KnowledgeService.retrieve` → `shapeAnswer(passages, persona)` (`packages/types/src/persona.ts`). Model hiçbir metin yazmıyor; yanıt RTM'e tek parça olay olarak gidiyor.
- Embedding: `packages/ai-mock/src/embedding.ts` — `EMBEDDING_DIMENSIONS = 1536`, `embed(text): number[]` **senkron**, sözcük-torbası hash'i (anlamsal değil). Çağrı yerleri: `knowledge-service.ts` (indeksleme + sorgu), `report-csv.ts` (iki yer, konu kümeleme), `packages/ai-mock/src/topics.ts`, `prisma/seed.ts`.
- DB: `knowledge_chunks.embedding vector(1536)`; indeks `idx_chunks_embedding_hnsw` (`hnsw … vector_cosine_ops`, m=16, ef_construction=64 — §D173).
- `RETRIEVAL_THRESHOLD = 0.25` (`knowledge-service.ts`) sahte embedding'in kosinüs dağılımına göre seçildi.
- `chunk(text, maxChars = 600)` — bir parça en fazla 600 karakter.

## 2. Aday sohbet sağlayıcıları — resmi API yüzeyi (soru 1)

| Aday                     | Resmi uç                                                                                                                        | Kaynak (resmi)                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                   | `POST /v1/chat/completions` (native). Bölgesel host'lar: `us.api.openai.com`, `eu.api.openai.com` (+ yalnız depolama bölgeleri) | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create · https://developers.openai.com/api/docs/guides/your-data           |
| Anthropic (Claude)       | Native: `POST /v1/messages`. Uyumluluk katmanı: taban `https://api.anthropic.com/v1/` + OpenAI SDK                              | https://platform.claude.com/docs/en/api/openai-sdk · https://platform.claude.com/docs/en/api/errors · https://platform.claude.com/docs/en/manage-claude/data-residency |
| Google Gemini (Dev. API) | Native Gemini API; uyumluluk katmanı: `https://generativelanguage.googleapis.com/v1beta/openai/`                                | https://ai.google.dev/gemini-api/docs/openai · https://ai.google.dev/gemini-api/docs/api-errors · https://ai.google.dev/gemini-api/terms                               |
| Mistral                  | `POST https://api.mistral.ai/v1/chat/completions`; bölgesel `api.eu.mistral.ai`, `api.us.mistral.ai`                            | https://docs.mistral.ai/api/endpoint/chat · https://docs.mistral.ai/inference/regional-inference                                                                       |

## 3. "OpenAI uyumlu" iddiası — aday başına ayrı doğrulama (soru 2)

Ölçüt: `/v1/chat/completions` alan adları · hata gövdesi · akış (SSE) biçimi · tool/function şeması · embeddings ucunun varlığı.

### 3.1 OpenAI — referansın kendisi (TAM)

- Alanlar: `model`, `messages`, `max_completion_tokens` (belge: _"now preferred in favor of `max_tokens`"_), `stream`, `tools`, `tool_choice`, `response_format`. Yanıt `choices[].message.content`, `finish_reason`, `usage.prompt_tokens` / `usage.completion_tokens`.
- Hata: `error.message` / `type` / `param` / `code`. 401 kimlik; 403 ülke/bölge; 429 iki anlamlı (hız sınırı ↔ kota/harcama); 500; 503 aşırı yük. Belge: _"Retrying billing, spend, or quota errors won't restore API access."_ Kalıcı 429 kodları: `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` (https://developers.openai.com/api/docs/guides/error-codes).
- SSE: `chat.completion.chunk` nesneleri, `data: [DONE]` ile biter.
- Embeddings: `POST /v1/embeddings` VAR; bölgesel işleme `/v1/chat/completions` ve `/v1/embeddings`'i kapsar.

### 3.2 Anthropic uyumluluk katmanı — KISMİ, production için belgesi tarafından DIŞLANIYOR

Belgenin kendi cümlesi: _"This compatibility layer is primarily intended to test and compare model capabilities, and is not considered a long-term or production-ready solution for most use cases."_ Kırıldığı yerler:

- `response_format` **yok sayılıyor**; `tools[].function.strict` **yok sayılıyor** (şema garantisi yok); `seed`, `logprobs`, `presence_penalty`, `frequency_penalty`, `user`, `store`, `reasoning_effort` yok sayılıyor.
- `n` tam olarak 1 olmalı; `temperature` 1'in üstünde 1'e kırpılıyor; tüm system/developer mesajları başa taşınıp birleştiriliyor.
- `usage.*_tokens_details` her zaman boş.
- Hata gövdesi: _"consistent error formats with the OpenAI API. However, the detailed error messages will not be equivalent."_ Native hatalar farklı zarfta (`{"type":"error","error":{type,message},"request_id"}`) ve OpenAI'da olmayan kodlar var: 402 `billing_error`, 529 `overloaded_error`, harcama limitinde **400**.
- Akış destekleniyor (`stream`, `stream_options`).
- **Embeddings ucu YOK** — _"Anthropic does not offer its own embedding model"_ (https://platform.claude.com/docs/en/build-with-claude/embeddings; Voyage AI önerilir).
- Bölge: `inference_geo` yalnız `"us"` / `"global"`; **AB değeri yok** ve bu parametre _"not available through the OpenAI SDK compatibility endpoint"_.
- Sonuç: Claude pilotta kullanılacaksa **native `/v1/messages` adaptörü** gerekir, `openai` enum değerinin altına sokulamaz.

### 3.3 Gemini uyumluluk katmanı — KISMİ (beta)

- Sohbet, akış, tools, structured output ve `/v1/embeddings` destekleniyor.
- Kırıldığı yerler: _"Support for the OpenAI libraries is still in beta"_; desteklenmeyen parametreler _"silently ignored by the compatibility layer"_ (hata vermiyor — yanlış istek sessizce "başarılı" dönebilir); Gemini 2.5 Pro / 3'te akıl yürütme kapatılamıyor. Uyumluluk katmanının hata gövdesi belgelenmemiş; native gövde `{"error":{code,message}}`, 429 `RESOURCE_EXHAUSTED`.
- Bölge: Developer API şartları: _"This data may be stored transiently or cached in any country in which Google or its agents maintain facilities."_ Bölgesel işleme taahhüdü Developer API'de bulunamadı; bölgesel uç noktalar Vertex AI'dadır (farklı kimlik doğrulama ve farklı taban URL — ayrı adaptör).

### 3.4 Mistral — KISMİ (alan adları ayrışıyor)

- Yol aynı (`/v1/chat/completions`), SSE `data: [DONE]` ile bitiyor, tools + `tool_choice` var.
- Kırıldığı yerler: çıktı tavanı **`max_tokens`** (OpenAI'ın tercih ettiği `max_completion_tokens` değil); `seed` yerine `random_seed`; `tool_choice` ek değerleri `any`; OpenAI'da olmayan `safe_prompt`. Hata gövdesi uç sayfasında OpenAI biçimiyle eşdeğer diye belgelenmemiş.
- Bölgesel uçlar sohbeti kapsıyor, 1,1× fiyatla; _"Stateful features, including Agents, Batch, and the Files API, are not available on regional endpoints"_.
- Embeddings ucu VAR (`/v1/embeddings`), ama `mistral-embed` 1024 boyut (§4).

## 4. Embedding (soru 3 ve 4)

### 4.1 Adaylar

| Model                                                | Varsayılan boyut | 1536?                                                                                                                   | Not                                                                                             | Kaynak                                                                  |
| ---------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| OpenAI `text-embedding-3-small`                      | 1536             | **EVET (native)**                                                                                                       | 8192 token/girdi; ≤ 2048 girdi/istek; ≤ 300 000 token/istek. EU/US bölgesel işlemeye dahil.     | https://developers.openai.com/api/docs/guides/embeddings                |
| OpenAI `text-embedding-3-large`                      | 3072             | `dimensions` ile kısaltılabilir; belge 256 ve 1024 örneği veriyor, 1536'yı açıkça yazmıyor → **doğrulanmış EVET değil** | Native 3072, pgvector'ün `vector` indeks tavanını (2000) aşar.                                  | aynı                                                                    |
| Gemini `gemini-embedding-001`                        | 3072             | EVET (128–3072, önerilen 768/1536/3072)                                                                                 | _"you must manually normalize non-3072 dimensions"_. Developer API'de bölge taahhüdü yok.       | https://ai.google.dev/gemini-api/docs/embeddings                        |
| Gemini `gemini-embedding-2`                          | 3072             | EVET (önerilen 1536; kesilen boyutu kendisi normalize ediyor)                                                           | 001 ile uzayı **uyumsuz**: _"you must re-embed all of your existing data"_. Bölge taahhüdü yok. | aynı                                                                    |
| Mistral `mistral-embed`                              | 1024             | **HAYIR**                                                                                                               | Sabit 1024.                                                                                     | https://docs.mistral.ai/studio/knowledge-rag/embeddings/text_embeddings |
| Voyage `voyage-4` / `voyage-3.5` (Anthropic önerisi) | 1024             | **HAYIR** (yalnız 256/512/1024/2048)                                                                                    | 2048 seçilirse `vector` HNSW tavanını (2000) aşar → `halfvec` gerekir.                          | https://docs.voyageai.com/docs/embeddings                               |

pgvector sınırı (https://github.com/pgvector/pgvector): HNSW/IVFFlat _"`vector` - up to 2,000 dimensions"_, _"`halfvec` - up to 4,000 dimensions"_.

### 4.2 Karar

Embedding sağlayıcısı sohbetten **ayrı** bir karar ve ayrı bir yapılandırmadır (kendi anahtarı, kendi taban URL'i, kendi bölgesi). Pilot seçimi **OpenAI `text-embedding-3-small`**: native 1536 → `vector(1536)` kolonu, `idx_chunks_embedding_hnsw` ve `vector_cosine_ops` **olduğu gibi kalır; migration yok**. Sohbet sağlayıcısı ileride değişirse bu karar değişmek zorunda değildir.

### 4.3 1536 üretemeyen bir aday seçilseydi — maliyet (255.7'nin girdisi)

1. Migration (CONVENTIONS §6.3, genişlet → taşı → daralt, üç sürüm): yeni kolon `vector(N)` (N ≤ 2000) ya da N > 2000 ise `halfvec(N)`; yeni HNSW indeksi **kendi migration dosyasında tek ifade** olarak `CREATE INDEX CONCURRENTLY`; eski kolon ve `idx_chunks_embedding_hnsw` son sürümde düşer; `db:check-drift` temiz.
2. Kod: `EMBEDDING_DIMENSIONS` sabiti ve 1536'yı sabitleyen testler; `toVectorLiteral` çağrıları; sorgudaki `::vector` dönüşümü.
3. **Tam yeniden gömme:** tüm kiracıların tüm `knowledge_chunks` satırları. Maliyet ≈ (tüm chunk metinlerinin toplam token sayısı) × (sağlayıcının girdi token fiyatı); süre ≈ toplam token / sağlayıcının TPM limiti.

**Önemli:** 3. madde 1536'da da geçerlidir. Bugünkü vektörler sahte hash uzayındadır; gerçek bir modele geçiş, boyut aynı olsa bile, **tüm bilgi tabanının yeniden gömülmesini** ister. İki uzayın vektörleri aynı indekste anlamsız komşuluk üretir.

## 5. Streaming (soru 5) — HAYIR, kapsam dışı

Ürünün bugün token akışı yüzeyi yok: AI yanıtı skill motorunda tek bir metin olarak kurulup RTM'e tek parça olay olarak gidiyor, widget tamamlanmış mesajları çiziyor. Akış eklemek yeni bir RTM olay tipi, widget'ta kısmi mesaj çizimi ve kesintide yarım mesajın ne olacağı kararını ister — pilotun istediği şey (gerçek bir modelin yazması) bunların hiçbirine bağlı değil. Adaptör **akışsız** istek atar; gecikme `LLM_TIMEOUT_MS` ile sınırlanır.

## 6. Tool/function calling (soru 6) — HAYIR, kapsam dışı

Skill adımları admin tarafından yazılır ve `@siyahtus/ai-mock` `validateSteps` kapısından geçer; model araç çağırmıyor, çağırması da istenmiyor. Pilotta modelin tek işi, geri getirilmiş pasajlardan ve persona kurallarından **müşteriye gidecek yanıt metnini yazmak**. Transfer / etiket / bilgi isteme kararları bugünkü deterministik adımlarda kalır. `tools`, `tool_choice`, `response_format` gönderilmez.

## 7. Bölge ve veri yerleşimi (soru 7) — NFR-C4 kapısı korunur

- `assertInferenceAllowed` değişmez; gerçek sağlayıcıda da çağrıdan **önce** koşar.
- OpenAI'da bölgesel işleme yalnız **ABD ve Avrupa**'da var, ikisi de `/v1/chat/completions` ve `/v1/embeddings`'i kapsıyor. Diğer bölgesel host'lar yalnız depolama sağlıyor. SiyahTuş'un `REGIONS = ['eu','us']` kümesiyle birebir örtüşüyor.
- **Eşleme kuralı** (255.5/255.15'in uygulayacağı): `LLM_PROVIDER=openai` iken
  - `LLM_API_BASE_URL` host'u `us.api.openai.com` ise `LLM_PROVIDER_REGION` **`us`**, `eu.api.openai.com` ise **`eu`** olmak zorunda; uyuşmazlık production'da boot'u reddeder.
  - Global `api.openai.com` production'da reddedilir: nerede işlendiği kanıtlanamayan bir uç için bölge beyan edilemez.
  - Production'da `LLM_PROVIDER ≠ mock` iken `LLM_PROVIDER_REGION` **zorunlu**. Bugünkü varsayılan ("süreçle aynı bölge") yalnız süreç içi sahte için doğrudur; uzak bir uç için yanlış bir iddia olur.
- **Embedding de müşteri içeriğini dışarı gönderir** (sorgu yolu müşterinin mesajını gömüyor). Bu yüzden aynı kapıdan geçer: `EMBEDDING_PROVIDER_REGION` + aynı eşleme kuralı; HIPAA kapsamlı bir çalışma alanının sorgusu bölge dışına gömülemez.
- OpenAI'ın AB veri yerleşimi başvuru ister: _"you must be approved for abuse monitoring controls, and execute a Modified Retention amendment"_ (ABD için onay gerekmiyor). Kötüye kullanım izleme kayıtları _"retained for up to 30 days"_. → §11.
- Varsayım: SiyahTuş'un HIPAA taahhüdü alt işlemciyle ayrı bir BAA ister; bu bir sözleşme işidir, kod işi değil. Pilotta HIPAA kapsamlı çalışma alanı açılmadığı varsayılır; kapı yine de koşar.

## 8. Ücretlendirme ve sağlayıcı limitleri (soru 8) — 255.9'un girdisi

- **Ücretlendirme:** dört adayın hepsi **token bazlı** (sohbet: girdi + çıktı token'ı; embedding: girdi token'ı). Bölgesel uçlar Anthropic'te (`inference_geo: "us"`) ve Mistral'da **1,1×**; OpenAI'ın bölgesel işleme fiyat farkı bu turda resmi sayfadan doğrulanmadı. Fiyat koda **gömülmez**: sayaç token tutar, fiyat sahibin sözleşmesidir.
- **OpenAI limitleri:** _"defined at the organization level and at the project level"_, model başına, RPM/RPD/TPM/TPD; harcamayla yükselen kademeler. Başlıklar `x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, `x-ratelimit-reset-*`, `Retry-After`; önerilen: üstel geri çekilme + jitter, `Retry-After` alt sınır (https://developers.openai.com/api/docs/guides/rate-limits).
- **Embedding istek sınırları:** 8192 token/girdi, ≤ 2048 girdi/istek, ≤ 300 000 token/istek. 600 karakterlik bir chunk bu tavanın çok altında; toplu (batch) istek bu sınırlarla bölünür.
- **Yanıt `usage`:** `prompt_tokens`, `completion_tokens`, `total_tokens` — 255.9 bunları mevcut AI sayacına bağlar.

## 9. Env anahtar sözleşmesi — yalnız ADLAR, değer YOK

255.2 / 255.5 / 255.7 / 255.9 / 255.15 **tam bu adları** uygular. "Sır" işaretli anahtarlar yalnız `.env`'de yaşar; `log-redact` listesine girer; hiçbir dosyaya, loga, teste, commit'e değer olarak yazılmaz.

### 9.1 Sohbet (LLM)

| Anahtar                 | Anlam                                                                                                                                                                                                     | Sır      | Zorunluluk                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| `LLM_PROVIDER`          | Kapalı enum: `mock` \| `openai`. Yeni satıcı = yeni değer + kendi adaptörü (§3).                                                                                                                          | Hayır    | Var (varsayılan `mock`)            |
| `LLM_PROVIDER_REGION`   | Çıkarımın koştuğu bölge (`eu` \| `us`). **Mevcut anahtar, adı değişmez.**                                                                                                                                 | Hayır    | `LLM_PROVIDER ≠ mock` + production |
| `LLM_API_BASE_URL`      | Sağlayıcının `/v1` tabanı. Host'u bölgeyle eşleşmek zorunda (§7).                                                                                                                                         | Hayır    | `LLM_PROVIDER ≠ mock`              |
| `LLM_MODEL`             | Model kimliği. Operatör seçer; kod sabitlemez.                                                                                                                                                            | Hayır    | `LLM_PROVIDER ≠ mock`              |
| `LLM_API_KEY`           | Bearer anahtarı.                                                                                                                                                                                          | **Evet** | `LLM_PROVIDER ≠ mock`              |
| `LLM_TIMEOUT_MS`        | Tek bir çıkarım isteğinin üst süresi; `AbortController` ile gerçekten iptal.                                                                                                                              | Hayır    | Varsayılanlı                       |
| `LLM_MAX_OUTPUT_TOKENS` | İstek başına çıktı tavanı; `max_completion_tokens` olarak gönderilir.                                                                                                                                     | Hayır    | Varsayılanlı                       |
| `LLM_MAX_PROMPT_CHARS`  | **Yeni (taslakta yoktu).** İstem uzunluğu tavanı; aşan istem sağlayıcıya gitmeden reddedilir (255.9). Karakter, çünkü sunucuda tokenizer bağımlılığı yok ve karakter token'ın muhafazakâr bir üst sınırı. | Hayır    | Varsayılanlı                       |

### 9.2 Embedding

| Anahtar                     | Anlam                                                                                                                                                                                       | Sır      | Zorunluluk                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------- |
| `EMBEDDING_PROVIDER`        | Kapalı enum: `mock` \| `openai`. Sohbetten bağımsız.                                                                                                                                        | Hayır    | Var (varsayılan `mock`)                  |
| `EMBEDDING_PROVIDER_REGION` | **Yeni (taslakta yoktu).** Gömmenin koştuğu bölge; NFR-C4 kapısı gömmeye de uygulanır (§7).                                                                                                 | Hayır    | `EMBEDDING_PROVIDER ≠ mock` + production |
| `EMBEDDING_API_BASE_URL`    | Sağlayıcının `/v1` tabanı; host ↔ bölge eşlemesi sohbetle aynı.                                                                                                                             | Hayır    | `EMBEDDING_PROVIDER ≠ mock`              |
| `EMBEDDING_MODEL`           | Model kimliği (pilot: `text-embedding-3-small`).                                                                                                                                            | Hayır    | `EMBEDDING_PROVIDER ≠ mock`              |
| `EMBEDDING_API_KEY`         | Bearer anahtarı. Sohbet anahtarından ayrı (aynı değer olabilir, ayrı ad).                                                                                                                   | **Evet** | `EMBEDDING_PROVIDER ≠ mock`              |
| `EMBEDDING_DIMENSIONS`      | Bir ayar düğmesi DEĞİL, bir **iddia**: `1536` dışında her değer parseEnv'de reddedilir (kolon `vector(1536)`). Sağlayıcı farklı boyut dönerse çağrı açıkça hata verir; kırpma/doldurma yok. | Hayır    | Varsayılan `1536`                        |
| `EMBEDDING_TIMEOUT_MS`      | **Yeni (taslakta yoktu).** Gömme isteğinin üst süresi. Sorgu yolunda gecikme doğrudan müşteri yanıtına biner; sohbet zaman aşımından ayrı ayarlanır.                                        | Hayır    | Varsayılanlı                             |

### 9.3 SMTP (255.2 bu adları buradan alır)

PrivateEmail resmi ayarları: sunucu `mail.privateemail.com`; **465 = SSL/TLS** ya da **587 = STARTTLS**; _"Only encrypted connections are supported"_; kullanıcı adı tam e-posta adresi (https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/general-private-email-configuration-for-mail-clients-and-mobile-devices/). Taslak adlar **aynen onaylandı**:

| Anahtar           | Anlam                                                                                                               | Sır      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| `SMTP_HOST`       | SMTP sunucusu.                                                                                                      | Hayır    |
| `SMTP_PORT`       | 465 ya da 587.                                                                                                      | Hayır    |
| `SMTP_SECURE`     | `true` = bağlantı baştan TLS (465); `false` = STARTTLS (587). Şifresiz gönderim yok: `false` iken STARTTLS zorunlu. | Hayır    |
| `SMTP_USERNAME`   | Kimlik doğrulama kullanıcı adı.                                                                                     | **Evet** |
| `SMTP_PASSWORD`   | Kimlik doğrulama parolası.                                                                                          | **Evet** |
| `SMTP_FROM`       | Gönderen adresi (pilot: `info@nolnk.net` — adres sır değildir).                                                     | Hayır    |
| `SMTP_TIMEOUT_MS` | Bağlantı + gönderim üst süresi.                                                                                     | Hayır    |

## 10. Alt görevlerin kapsamını daraltan cümleler

- **255.5 (seam):** `LlmProvider` arayüzü **tek bir akışsız, araçsız** çağrıdır: `complete({ system, messages, maxOutputTokens, timeoutMs }) → { text, usage: { inputTokens, outputTokens } }`. `stream`, `tools`, `response_format` arayüze GİRMEZ (§5, §6). Enum `['mock','openai']`. Production'da `LLM_PROVIDER ≠ mock` iken `LLM_PROVIDER_REGION` zorunlu ve host ↔ bölge eşlemesi `productionProblems()`'a girer (§7). Sahip onayı (§11) bu görevi **bloklamaz**: teslimatı ağsızdır.
- **255.6 (sohbet adaptörü):** yalnız OpenAI `POST {LLM_API_BASE_URL}/chat/completions`; gövdede yalnız `model`, `messages`, `max_completion_tokens`. 429'da gövdedeki `error.code` §3.1'deki dört kota/harcama kodundan biriyse **kalıcı** (yeniden deneme yok, devre kesiciye hata sayılır); diğer 429'lar, 500 ve 503 **geçici**, `Retry-After` alt sınır. 401/403/400/404 kalıcı. Başka bir satıcının uyumluluk katmanına bu adaptörle bağlanmak **desteklenmez**.
- **255.7 (embedding):** OpenAI `POST {EMBEDDING_API_BASE_URL}/embeddings`, `model` + `input: string[]`; toplu istek ≤ 2048 girdi ve ≤ 300 000 token ile bölünür. `dimensions` parametresi GÖNDERİLMEZ (model native 1536); dönen vektör 1536 değilse açık hata. **Migration dalı koşmaz** (§4.2). Yeniden gömme yolu **zorunlu** (§4.3 — sahte → gerçek geçişi). NFR-C4 kapısı gömme çağrısından önce de koşar (`EMBEDDING_PROVIDER_REGION`).
- **255.8 (recall):** `RETRIEVAL_THRESHOLD = 0.25` sahte uzayda seçildi; gerçek modelin kosinüs dağılımı farklıdır, bu yüzden eşik gerçek uzayda **yeniden kalibre edilmek zorunda** — kapı sahte sağlayıcıyla deterministik, elle koşulan gerçek komut aynı altın kümeyi kullanır.
- **255.9 (limit/maliyet):** kayıt birimi **token** (`usage.prompt_tokens` / `completion_tokens` ya da arayüzdeki `inputTokens`/`outputTokens`); para karşılığı koda gömülmez. Tavan anahtarları `LLM_MAX_OUTPUT_TOKENS` + `LLM_MAX_PROMPT_CHARS`. Redaction listesi: `LLM_API_KEY`, `EMBEDDING_API_KEY`, `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **255.15 (Docker prod):** `.env.production.example` §9'daki adları yorumlu ve **değersiz** taşır; dört kaynak paritesi (env.ts · .env.example · turbo.json globalEnv · .env.production.example) bu adlarla yeşil kalır.

## 11. Sahip kararı bekleniyor

Aşağıdakiler pencerenin veremeyeceği kararlardır (hesap, sözleşme, veri işleme). **Kod ve testler (255.5–255.9) bunları beklemez** — hepsi ağsız, sahte sağlayıcı ya da enjekte edilen `fetch` ile koşar. Bekleyen şey **pilotun gerçek sağlayıcıyla açılması** (255.16'nın gerçek-sağlayıcı adımı ve canlıya çıkış):

1. **Sahip kararı bekleniyor: satıcı onayı.** OpenAI hesabı + faturalama kabul mü? Hayır ise bu ADR yeniden açılır ve §3'ün sıradaki adayı için ayrı bir adaptör görevi açılır (Anthropic → native `/v1/messages`; Mistral → kendi alan adları; Gemini → bölge gerekiyorsa Vertex AI). Embedding kararı (§4.2) sohbet kararından bağımsız kalabilir.
2. **Sahip kararı bekleniyor: pilotun bölgesi.** Pilot çalışma alanları `eu` mu `us` mu (`SIYAHTUS_REGION`)? `eu` ise OpenAI'ın AB veri yerleşimi için _abuse monitoring controls_ onayı + _Modified Retention amendment_ gerekir — bu bir başvurudur, kod işi değil. `us` için onay gerekmez.

## 12. Kaynaklar (erişim 2026-09-22, yalnız resmi dokümantasyon)

- OpenAI — sohbet: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create · akış: https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events · hatalar: https://developers.openai.com/api/docs/guides/error-codes · limitler: https://developers.openai.com/api/docs/guides/rate-limits · veri yerleşimi: https://developers.openai.com/api/docs/guides/your-data · embedding: https://developers.openai.com/api/docs/guides/embeddings · https://developers.openai.com/api/reference/resources/embeddings/methods/create
- Anthropic — uyumluluk katmanı: https://platform.claude.com/docs/en/api/openai-sdk · hatalar: https://platform.claude.com/docs/en/api/errors · veri yerleşimi: https://platform.claude.com/docs/en/manage-claude/data-residency · embedding: https://platform.claude.com/docs/en/build-with-claude/embeddings
- Google — uyumluluk katmanı: https://ai.google.dev/gemini-api/docs/openai · embedding: https://ai.google.dev/gemini-api/docs/embeddings · hatalar: https://ai.google.dev/gemini-api/docs/api-errors · limitler: https://ai.google.dev/gemini-api/docs/rate-limits · şartlar: https://ai.google.dev/gemini-api/terms
- Mistral — sohbet: https://docs.mistral.ai/api/endpoint/chat · bölgesel çıkarım: https://docs.mistral.ai/inference/regional-inference · embedding: https://docs.mistral.ai/studio/knowledge-rag/embeddings/text_embeddings · https://docs.mistral.ai/api/endpoint/embeddings
- Voyage AI — https://docs.voyageai.com/docs/embeddings
- pgvector — https://github.com/pgvector/pgvector
- Namecheap PrivateEmail — https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/general-private-email-configuration-for-mail-clients-and-mobile-devices/
