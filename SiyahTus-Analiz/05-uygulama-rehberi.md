# 05 — Uygulama Rehberi: Alan, Kod Karşılığı ve Kodlama Mantığı

> **Okuyucu:** nexa-main üzerinde çalışacak **kodlama yapan AI ajanı**, ya da teknik ekip.
> **Ne bu dosya?** [03-eklenebilecekler.md](03-eklenebilecekler.md) dosyasındaki 109 maddenin her biri için şunlar yazılı:
> - **Alan:** panelde nerede duracağı, kimin kullanacağı.
> - **Mevcut kod karşılığı:** bugün koddaki karşılığı; dosya ve satır, okunarak doğrulandı.
> - **Eklenecek / değişecek yerler:** dokunulacak katmanlar.
> - **Kodlama mantığı:** veri modeli, akış, uç durumlar, güvenlik ve performans.
> - **Kabul kriterleri**
> - **Riskler / notlar**
>
> **Önemli:** Bu dosya **mantığı** anlatır, kodu yazmaz. Gerçek kodu, dosya bölümlemesini ve isimlendirmeyi uygulayıcı belirler. Önerilen klasör ve fonksiyon adları yalnızca örnektir.

## Uygulayıcı için kurallar
1. **Önce repo kurallarını oku:** `CLAUDE.md`, `MASTER-PROMPT.md` (kilitli kararlar), `CONVENTIONS.md` (Definition of Done, git, handoff), `TASK-RUNNER-PROMPT.md`.
2. **Contract-first sıra:**
   1. `packages/contract` OpenAPI
   2. `pnpm contract:generate`
   3. `packages/types`
   4. `apps/api/prisma` migration (RLS politikasıyla birlikte)
   5. `apps/api` servis, route ve test
   6. RTM olayları
   7. `apps/web` / `apps/widget` / `apps/mobile`
   8. `apps/e2e`
3. **Her madde bir Task Master görevi olarak açılmalı.** Görev, DoD kapısından geçmeden (build, lint, typecheck, test, contract drift, gereksinim kapsaması) "bitti" sayılmaz.
4. **Kilitli kararlar:** Bir madde kilitli bir kararla çelişiyorsa (ADR-08, ADR-09, ADR-14, LLM ADR §6, Q6 vb.), maddedeki "Riskler / notlar" bölümünde önerilen uzlaşma uygulanır ve ilgili ADR'ye ek not yazılır. Kilitli karar sessizce delinmez.
5. **Sorular:** [04-gerekceler-ve-sorular.md](04-gerekceler-ve-sorular.md) dosyasındaki **Karar kaydı** tablosu (K1–K16, hepsi cevaplandı) ve hemen altındaki **"Kararların maddelere etkisi"** bölümü, maddelerdeki varsayılanların önüne geçer. Özellikle K4 (widget'ın kendi ürettiği imzalı üye tokenı; operatör geliştirmesi gerekmez), K9 (kiracının yapılandırdığı çözüldü kriterleri ve devir kuralları), K13 (erişim bilgisi ayarı) K15 (pasif platform kartları) ve K16 (SWIFT + kripto "Adres isteyin" + Stripe ödeme yolları) maddelerin metninden daha geniş kararlar getirir. Karar kaydında cevap varsa o geçerlidir. Cevap yoksa maddedeki "Önerilen varsayılan" kullanılır ve bu varsayım görev notuna yazılır.
6. **Satır numaraları** 2026-10-14 tarihli koddan okundu. Kod değişmiş olabilir; uygulamadan önce yeniden doğrula.
7. **Terim:** Thread ID = üyenin günlük konuşma grubu, Chat ID = bağlantı. Kod karşılıkları ID-01 ve ID-02'de; AI maddeleri bunlara iki fonksiyon üzerinden bağlanır (bkz. §1.0).
8. **Sınırlar** (CLAUDE.md'den): production deploy, gerçek secret, ödeme, force-push, DB drop ve başka repoya dokunmak yasak. Dış servisler mock'lanır.

## Önerilen uygulama sırası (bağımlılıklara göre)
1. **Temel:**
   - ID-01 → ID-04 → ID-02 → ID-03
   - ID-08 (karar logu tablosu)
   - GV-02 (kalıcı AI kuyruğu)
   - AI-16 (gerçek LLM)
2. **AI çekirdeği:**
   - AI-11 (önce AI / devirden sonra AI'ın susması)
   - AI-01 → AI-02
   - AI-04 → AI-03 → AI-05
   - AI-06 → AI-07 → AI-08 → AI-26 → AI-27
   - AI-09 → AI-10 → AI-12, AU-01
3. **iGaming bilgi modeli:** AI-13 → AI-14 → AI-15, ardından AI-17 ve AI-18
4. **Test, yayın, kalite:** AI-19 → AI-20 → AI-21 → AI-22 → AI-23 → AI-24 → AI-25
5. **Roller:** RL-01 → RL-02 → RL-03, RL-04, RL-06
6. **Ajan deneyimi ve arama:**
   - IN-01 (hemen yapılabilir, P0, S)
   - IN-02, ID-05, ID-06, ID-07, ID-09
   - AR-01…AR-04
7. **Widget ve diğerleri:**
   - WG-01, WG-02, WG-03, GV-01, GV-03, EN-01
   - HD-01…HD-03
   - Kalan P1 ve P2 maddeleri

---
## 1. AI Agent çekirdeği (AI)

> Okuyucu: kodlama yapacak AI ajanı. Repo: `nexa-main` (yollar repo köküne göre). Bu dosya **mantığı** anlatır; gerçek kodu, dosya bölümlemesini ve isimleri uygulayıcı belirler. Her madde contract-first sırayla yapılır (MASTER-PROMPT.md "Kilitli Teknik Kararlar"): `packages/contract` OpenAPI → `pnpm contract:generate` → `packages/types` → `apps/api/prisma` migration → `apps/api` servis/route + test → `apps/web` / `apps/widget` → `apps/e2e`.

### 1.0 Ortak çerçeve (bu bölümdeki bütün AI maddeleri için)

**1. Terim eşlemesi (ID-01 kesinleştirene kadar varsayım).** Bugün kodda `chats` müşteri başına aynı anda tek aktif konuşmadır (`apps/api/src/services/chat/chat-service.ts:385-392`); `threads` bir chat içindeki kesintisiz parçadır (`apps/api/prisma/schema.prisma:814-843`). Kapanmış bir sohbetten sonra widget'tan gelen yeni mesaj yeni bir `Chat` açar (`apps/api/src/routes/customer.ts:813-841`). Bu dosyada:
- **bağlantı** (sahibin "chat ID"si) = `(chat_id, aktif thread_id)` çifti. Koddaki referans tipi `ConnectionRef { chatId, threadId }`.
- **günlük thread** (sahibin "thread ID"si) = ID-02'nin getireceği `daily_thread_id` (oyuncu + gün).
- AI tarafı ID modeline yalnız iki fonksiyonla bağlanır: `loadConnectionEvents(ref)` (AI-01) ve `loadDailyDigests(dailyThreadId, exclude)` (AI-02). ID-01/ID-02 eşlemeyi değiştirirse yalnız bu iki fonksiyon değişir.

**2. Hedef modül yapısı.** Yeni klasör önerisi `apps/api/src/services/ai/conversation/`:
```
conversation-engine.ts   handleTurn(): tur hattını yönetir
context-loader.ts        AI-01 bağlantı geçmişi, AI-02 gün içi özetler
state-store.ts           ai_conversations satırı (iyimser kilit, sürüm)
understand.ts            LLM çağrısı #1 (JSON): AI-05 seçim + AI-04 çıkarım + AI-09 sinyaller
policy.ts                deterministik karar: zorunlu devir / prosedür / bilgi yanıtı
procedure/executor.ts    AI-03 adım yürütücü;  procedure/conditions.ts  koşul değerlendirici
slots/                   AI-04 tipler, Türkçe normalizasyon, doğrulayıcılar
knowledge-answer.ts      AI-06
guidance.ts              AI-07 talimatların prompt'a derlenmesi
guardrails/              AI-08 giriş taraması, çıkış denetimi, kilitli set
compose.ts               LLM çağrısı #2: oyuncuya gidecek metin
handoff/                 AI-09 tetikleyiciler, AI-10 kart, AI-12 hedef ve öncelik
```
`AiResponder.handle` (`apps/api/src/services/ai/ai-responder.ts:48`) kapılarını korur (`requireAiInference` :63, `requireAiBudget` :81) ama `SkillEngine.run` yerine `ConversationEngine.handleTurn` çağırır. Bugünkü tek mesajlık skill'ler, yürütücüde bir adaptörle tek adımlı prosedür olarak koşar; iki ayrı motor bırakılmaz.

**3. Tur hattı (oyuncunun her mesajı ya da mesaj grubu için).**
1. Kapı: `ai_conversations.mode == 'ai'` (AI-11); çıkarım ve bütçe kapıları (mevcut); bağlantı başına iyimser kilit (AI-01).
2. Bağlam: bağlantı geçmişi (AI-01) + gün içi özetler (AI-02) + konuşma durumu (AI-03/AI-04).
3. Giriş taraması (deterministik, LLM yok): AI-08 kilitli tetikleyiciler ve AI-26 maskeleme sonucu.
4. Anlama (LLM #1, JSON çıktı): konu/prosedür adayı ve güven (AI-05), slot çıkarımı (AI-04), "insan istiyor", duygu, risk sinyalleri (AI-09/AI-08/AI-27), "önceki konuyla ilgili mi" (AI-02).
5. Karar (`policy.ts`, deterministik kod): zorunlu devir → AI-09; aktif ya da yeni prosedür adımı → AI-03; hiçbiri → AI-06.
6. Yazım (LLM #2): persona + kilitli kurallar (AI-08) + talimatlar (AI-07) + adım talimatı/kalıp + pasajlar ve tablo satırları (AI-06/AI-13).
7. Çıkış denetimi (AI-08): ihlalde bir kez yeniden yaz → güvenli kalıp → devir.
8. Kalıcı yazım: bot mesajı (`author_type='bot'`, `ai-responder.ts:127-140` ile aynı yol), durum, karar kaydı (ID-08), `skill_runs` satırı (token sayıları, `schema.prisma:1694-1712`).
9. Devir varsa: kart (AI-10), `mode='human'` (AI-11), hedef ekip ve öncelik (AI-12).

**4. Kilitli kararlarla uzlaşma.**

| Karar | Çatışma | Öneri |
|---|---|---|
| ADR-14 "tek paradigma = Skill (adım listesi), workflow UI yok" (`PLAN.md:167`) | AI-03 çok turlu akış | Skill genişletilir (`mode: 'single' \| 'procedure'`); adım listesi korunur, adımlara koşul ve "cevap bekle" eklenir; `workflows` tablosuna ve node/edge tuvaline dokunulmaz. ADR-14'e "ADR-14a: Skill çok turlu olabilir" eki yazılır. |
| ADR pilot LLM §6: `tools`, `tool_choice`, `response_format` gönderilmez; transfer/etiket/bilgi isteme kararları deterministik adımlarda (`docs/adr/pilot-llm-embedding-provider.md:109-111`) | AI-04/AI-05/AI-08 yapılandırılmış JSON çıktısı ister | Araç çağırma F1'de yine kapalı. Yalnız anlama ve hakem çağrılarında `response_format: json_schema` açılır (`LlmCompletionRequest`'e isteğe bağlı `responseSchema`, `provider/llm-provider.ts:45-53`). Kararlar (devir, etiket, soru) `policy.ts`'te deterministik kalır; ADR'nin amacı korunur, metni güncellenir. Sağlayıcı şemayı desteklemezse: düz JSON + doğrulama + 1 yeniden deneme. Mock sağlayıcı deterministik JSON döner. |
| ADR-08 yönlendirme sırası (`PLAN.md:161`) | AI-11 "önce AI" (yönlendirme devirde), AI-12 sohbet önceliği | Ajan seçme mantığı değişmez. Kuyruk adımına `priority DESC, queued_at ASC` sıralaması eklenir; "önce AI" modunda yönlendirme `start` yerine devir anında çağrılır. |
| ADR-09 AI çözümü = kapanışta ajan olayı yok (`PLAN.md:162`) | Devredilip ajan yazmadan kapanan sohbet AI çözümü sayılıyor | Yüklem `ajan olayı yok VE devir yok` olarak daraltılır (sahip kararı, AI-11 soru 4). `ai_solved` görünümü (`chat-service.ts:2408-2417`) ve Reports "Automated" aynı yüklemi kullanmalıdır. |
| Q6 "AI Agent ↔ Copilot bilgi tabanları ayrı" (`HANDOFF.md:2336`) | AI-14 | Tek depo + `audiences` bayrağı; eski uçlar filtreli görünüm olarak kalır. |
| task_098: "şablon" kavramı kontrata girmez, katalog `apps/web` içinde yereldir (`.taskmaster/tasks/task_098.md:28`) | AI-15 sunucuda da şablon gerektirir | Katalog paylaşılan pakete taşınır; kurulum ucu açılır. |
| ADR-15 RTM zarfı (`PLAN.md:168`) | Yeni push'lar | Yeni push'lar aynı zarfla (`{action, type:'push', payload}`) ve `packages/types/src/rtm.ts:138-166` listesine eklenerek tanımlanır. |

**5. Yetki anahtarları (RL-02'ye girdi).** RL-02 gelene kadar mevcut kapsamlar kullanılır: yapılandırma için `agents-bot--all:rw` (yalnız owner/viceowner/admin, `packages/types/src/role-scopes.ts:83-89`), sohbet işlemleri için `chats--all:rw`. Varsayılan matris (K = Kurucu, Y = Yönetici, EL = Ekip Lideri, EÜ = Ekip Üyesi):

| Yetenek anahtarı | K | Y | EL | EÜ |
|---|---|---|---|---|
| `ai.procedures.view` | ✓ | ✓ | ✓ | ✓ (salt okuma) |
| `ai.procedures.edit` | ✓ | ✓ | taslak | – |
| `ai.procedures.publish` (AI-20) | ✓ | ✓ | – | – |
| `ai.guidance.edit` | ✓ | ✓ | taslak | – |
| `ai.guardrails.edit` (kiracı ekleri) | ✓ | görür | – | – |
| `ai.knowledge.edit`, `ai.tables.edit` | ✓ | ✓ | taslak | – |
| `ai.handoff_settings.edit` | ✓ | ✓ | – | – |
| `ai.templates.install` | ✓ | ✓ | – | – |
| `ai.handoff_card.view` / `.feedback` | ✓ | ✓ | ✓ | ✓ |
| `ai.conversation.return_to_ai` | ✓ | ✓ | ✓ | yalnız kendi sohbeti |

**6. Ortak teknik kurallar.**
- Her yeni tabloda `license_id` + RLS: `ENABLE ROW LEVEL SECURITY` ve `CREATE POLICY <tablo>_tenant ... USING (license_id = siyahtus_current_license()) WITH CHECK (...)` (örnek: `apps/api/prisma/migrations/20261002150000_ai_daily_usage/migration.sql`). Çapraz kiracı negatif testi `apps/api/test/integration/tenant-isolation.test.ts` desenine eklenir; marka kapsamlı tablolar için `brand-isolation.test.ts`.
- Migration'lar "genişlet → taşı → daralt" (`CONVENTIONS.md` §6.3); `CREATE INDEX CONCURRENTLY` kendi migration dosyasında tek ifade olarak.
- LLM çağrıları ve DB transaction'ları iç içe olmaz; model çağrısı transaction dışında yapılır (`skill-engine.ts:18-24` ile aynı gerekçe).
- Her model çağrısı `MeteredLlm` üzerinden geçer (günlük tavanlar, `services/ai/ai-daily-budget.ts`). Sağlayıcı hatası, tavan ya da zaman aşımı → oyuncuya kısa bir "sizi bir temsilciye aktarıyorum" mesajı + devir (bugün sessiz kalıyor; bkz. AI-09).
- Operatör loglarına oyuncu metni, slot değeri ya da sağlayıcı mesajı yazılmaz; yalnız kodlar ve durumlar (`provider/llm-error.ts` disiplini). Karar kaydının biçimi ID-08'indir; bu maddeler yalnız olay üretir.
- Testler CONVENTIONS §7 etiket biçimiyle; mock LLM deterministik kalır (MASTER-PROMPT "LLM için deterministik stub").

**7. Maliyet modeli (bütün maddeler için).** Tur başına 2 model çağrısı (anlama + yazım), riskli konularda +1 hakem çağrısı (AI-08), bilgi yolunda +1 embedding. Prompt'un sabit kısmı (persona, kilitli kurallar, talimatlar, prosedür kataloğu) başta, değişken kısmı (geçmiş, durum) sonda tutulur ki sağlayıcı tarafı önbellekleme işe yarasın. `LLM_MAX_PROMPT_CHARS` varsayılanı 16 000 (`apps/api/src/config/env.ts:735`); geçmiş + katalog + pasajlarla aşılır. Bölüm bazlı bütçe tanımlanmalı ve varsayılan yükseltilmeli (öneri 48 000). Günlük tavanlar token bazlıdır; tur başına çağrı sayısı arttığı için varsayılan tavanlar yeniden ölçülmelidir.

---

### AI-01 — Sohbet içi konuşma hafızası
- **Alan (panelde nerede, kim kullanır):** Ayrı ekranı yok, motorun içindedir. Etkisi Gelen Kutusu transkriptinde (bot cevapları bağlama uygun) ve AI Agent › Test'te (AI-19 çok turlu önizleme) görünür; tüm roller transkripti görür. Tek ayar: AI Agent (bugün "Senaryolar", `/app/playbook`) › Profil › "Art arda mesajları birleştirme süresi" — Kurucu/Yönetici.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/ai/ai-responder.ts:95-98`: motora yalnız `{ message, chatId }` gidiyor, geçmiş yok.
  - `apps/api/src/services/ai/skill-engine.ts:234-238` imzada `history?: string[]` var; `:285` canlı yolda `history ?? []`, `:353` önizlemede `[]`; geçmiş yalnız `buildSummary` (`:802-809`) tarafından okunuyor.
  - `apps/api/src/services/ai/provider/answer-prompt.ts:79-82`: modele tek `user` mesajı gidiyor. `provider/llm-provider.ts:40-48`: `LlmMessage { role: 'user' | 'assistant' }` çok turlu konuşmayı zaten destekliyor.
  - `apps/api/src/routes/customer.ts:342-352`: her mesaj ayrı `followUps` işi (anahtar `${licenseId}:${chatId}`); `apps/api/src/services/chat/follow-ups.ts:1-37`: süreç içi, kalıcı değil, anahtar başına en fazla 20 iş.
  - Olaylar: `apps/api/prisma/schema.prisma:851-887` (`events`: `type`, `text`, `author_type`, `recipients` `all|agents`, `properties`, aylık bölümlü; `(thread_id, created_at)` ve `(chat_id, created_at)` indeksleri; `event_sequence` üretilmiş kolon, `:875-885`).
  - Oyuncu metni kaydedilmeden önce maskeleniyor: `routes/customer.ts:816` (`maskedText`).
- **Eklenecek / değişecek yerler:**
  - `apps/api/src/services/ai/conversation/context-loader.ts` (yeni); `ai-responder.ts` yeni motoru çağırır.
  - Prisma: `ai_conversations.last_processed_event_seq` ve `version` kolonları (tablo AI-03'te tanımlanır).
  - Env (`apps/api/src/config/env.ts`): `AI_HISTORY_MAX_MESSAGES` (öneri 20), `AI_HISTORY_MAX_CHARS` (öneri 12 000), `AI_BATCH_WINDOW_MS` (öneri 3 000); `LLM_MAX_PROMPT_CHARS` varsayılanının yükseltilmesi.
  - Kontrat: `AiAgent` şemasına (`packages/contract/openapi/openapi.yaml:1265-1285`) `batch_window_seconds` (0–10); `PATCH /ai-agents/{aiAgentId}` gövdesine aynı alan (persona JSON'ında saklanabilir, `routes/playbook.ts:387-402` birleştirme deseni).
  - Web: `apps/web/src/features/playbook/ProfileForm.tsx` tek alan.
  - Test: `context-loader` birim testleri; `apps/api/test/integration/ai-skills.test.ts` yanına çok turlu entegrasyon testi; `apps/e2e/tests/ai-agent.spec.ts` içine iki turluk senaryo.
- **Kodlama mantığı:**
  1. **Bağlamın toplanması** `loadConnectionEvents(ref)`: bağlantının olayları `event_sequence` sırasıyla okunur. Alınacak tipler: `message`, `file`, seçili `system_message`'lar. Rol eşlemesi: `customer → user`, `bot → assistant`, `agent → assistant` ve metnin başına "[Temsilci]" (yalnız AI'a geri verilmiş sohbetlerde anlamlı, AI-11); `system` olayları mesaj olarak değil, system prompt'taki "Olaylar" bölümüne kısa notlar olarak girer ("sohbet aktarıldı 14:02").
  2. **Asla girmeyenler:** `recipients='agents'` (iç notlar), Copilot çıktıları, başka bağlantıların olayları. Ekler ikili içerik olarak değil `[Ek: görsel, dekont.jpg]` yer tutucusuyla girer. Metin maskelenmiş haliyle kalır; maskesi açılmaz.
  3. **Bütçe:** son `AI_HISTORY_MAX_MESSAGES` mesaj alınır; ilk oyuncu mesajı her zaman tutulur (konu çapası). Kırpılan kısım için ayrı bir LLM özeti üretilmez: kalıcı gerçekler zaten `ai_conversations.slots` ve prosedür adımında durur; prompt'a "Durum özeti" olarak bunlar yazılır (deterministik, maliyetsiz). Karakter bütçesi aşılırsa en eski mesajdan başlanarak atılır.
  4. **Ardışık mesaj birleştirme:** aynı roldeki ardışık mesajlar tek mesajda birleştirilir (satır sonuyla); işlenmemiş bütün oyuncu mesajları tek "son kullanıcı turu" olur.
  5. **Bekleme penceresi (debounce):** `followUp` işi başladığında `last_processed_event_seq`'ten sonraki oyuncu olaylarını okur. En yenisi `AI_BATCH_WINDOW_MS`'ten gençse iş kısa süre bekler (en fazla pencerenin 2 katı) ve yeniden okur. Hepsi tek tur olarak işlenir. Kuyruktaki sonraki işler yeni olay bulamazsa hiçbir şey yapmaz (idempotent). Bu, "3 mesaja 3 cevap" sorununu da çözer.
  6. **Çok kopyalı çalışmada eşzamanlılık:** `followUps` süreç içidir; iki API kopyası aynı bağlantı için aynı anda tur işleyebilir. İyimser kilit: tur başında `version` ve `last_processed_event_seq` okunur, LLM işi transaction dışında yapılır, sonuç `UPDATE … WHERE version = :v` ile yazılır. 0 satır dönerse başka bir işçi cevaplamıştır; taslak gönderilmez.
  7. **Cevap yazılırken gelen mesaj:** göndermeden hemen önce yeni oyuncu olayı var mı diye bakılır. Varsa taslak atılır ve tur yeni mesajlarla bir kez yeniden koşturulur (en fazla 1 kez; ikincide mevcut taslak gönderilir).
  8. **Çıktı:** `TurnContext { messages: LlmMessage[], systemNotes: string[], stateDigest: string, newCustomerText: string, lastSeq: number }`.
  9. **Güvenlik:** sorgular `withTenant` içinde; `chatId` oyuncu principal'ından türetilir, istemciden alınmaz. **Performans:** `(thread_id, event_sequence)` üzerinde tek indeksli sorgu, `LIMIT N+1`; bağlantı tek günü aşmadığı için bölüm budaması doğal çalışır.
- **Kabul kriterleri:**
  - "Param yatmadı" → AI yöntem ve saati sorar → oyuncu "Papara 13:40" yazar → ikinci turun model isteğinde önceki üç mesaj doğru sıra ve rollerle bulunur (mock sağlayıcının yakaladığı istekle doğrulanır).
  - İç notlar (`recipients='agents'`) hiçbir model isteğinde yer almaz (entegrasyon testi).
  - Oyuncu 3 saniye içinde 3 mesaj gönderir → tam olarak 1 bot cevabı; `last_processed_event_seq` üçüncü mesajın sırası olur.
  - Aynı bağlantıyı aynı anda işleyen iki motor örneği → en fazla 1 bot cevabı.
  - 40 mesajlık bir konuşmada ilk oyuncu mesajı korunur ve geçmiş yüzünden `prompt_too_long` (`provider/llm-provider.ts:94-99`) hiç oluşmaz.
  - Ekler yer tutucu metinle görünür, ikili içerik modele gitmez.
- **Riskler / notlar:**
  - Geçmiş token maliyetini artırır; günlük tavanlar daha erken dolar (bkz. Ortak çerçeve 7).
  - `followUps` kalıcı değil (GV-02); bekleme penceresi kayıp penceresini biraz büyütür. Pilottan önce GV-02 önerilir.
  - Oyuncu mesajındaki "önceki talimatları unut" türü saldırılar `user` rolünde kalır; kilitli kurallar system prompt'tadır ve çıktı denetimi (AI-08) son savunmadır.
  - AI'a geri verilen sohbette ajan mesajları bağlamda olur; talimatlara "temsilcinin söylediğiyle çelişme" kuralı eklenmelidir (AI-07 varsayılan kural seti).

### AI-02 — Gün içi hafıza (thread ile)
- **Alan (panelde nerede, kim kullanır):** Motorun içindedir; oyuncu AI'ın ilk cevabında görür. Ajanlar Gelen Kutusu sağ panelinde "Bugünkü önceki bağlantılar" listesini görür (veriyi bu madde üretir, gösterimi IN-02'nindir). Ayar: AI Agent › Profil › "Gün içi hafıza" (açık/kapalı, hatırlatma modu) — Kurucu/Yönetici.
- **Mevcut kod karşılığı:**
  - AI yolunda bağlantılar arası hiçbir bağlam yok (`ai-responder.ts:95-98`).
  - Kapanıştan sonra yeni bağlantı = yeni `Chat` (`routes/customer.ts:829-841`); tek aktif chat kuralı `chat-service.ts:385-392`.
  - Kapanış yolları: `chat-service.ts:841` (`deactivate`), `:890` (`deactivateByTimeout`, `services/chat/chat-timeout-run.ts`).
  - `threads.summary` / `summary_updated_at` (`schema.prisma:826-827`); yalnız `summarize` adımı yazıyor (`ai-responder.ts:142-148`).
  - Oyuncu kimliği: `customers` (`schema.prisma:389`); kullanıcı adı işi commit'lenmemiş halde çalışma ağacında (migration `apps/api/prisma/migrations/20261014090000_customer_username`) — ID-03'ün konusu.
- **Eklenecek / değişecek yerler:**
  - Prisma: `ai_conversations` tablosuna `daily_thread_id` (ID-02'den gelir), `digest jsonb`, `outcome text`, `closed_at`; indeks `(license_id, daily_thread_id, created_at)`.
  - Servis: `conversation/daily-memory.ts` (`buildDigest(state)`, `loadDailyDigests(dailyThreadId, exclude)`); kapanış yollarına (`deactivate`, `deactivateByTimeout`) "özeti kesinleştir" kancası.
  - Kontrat: `AiAgent` ayarlarına `daily_memory: { enabled, recall: 'auto_if_unresolved' | 'on_topic_only' }`. Ajan ekranı için `GET /chats/{chatId}/ai-digests` (ya da IN-02'nin oyuncu kartı ucuna gömülü alan).
  - Web: `ProfileForm.tsx` iki alan; sağ panel gösterimi IN-02'de.
  - Test: entegrasyon (aynı gün iki bağlantı, ertesi gün), birim (`buildDigest`, kimlik güven seviyesine göre filtreleme).
- **Kodlama mantığı:**
  1. **Özet (digest) yapısı, LLM'siz:** `{ connection: {chatId, threadId}, started_at, ended_at, procedure_key, procedure_name, intent_label, slots: { ad: { display, status } }, outcome: 'resolved' | 'resolved_waiting' | 'handed_off' | 'abandoned' | 'no_ai', handoff: { id, team_id, reason_codes, agent_replied } | null, risk_flags: [], last_ai_excerpt (≤200 karakter) }`. Prosedürsüz (salt bilgi soru-cevabı) bağlantılarda isteğe bağlı tek cümlelik LLM özeti eklenebilir.
  2. **Ne zaman yazılır:** her AI turunda durumdan güncellenir (ani kapanışlarda da veri kalsın diye), bağlantı kapanınca `outcome` kesinleşir. Kapanışta aktif bir `collect` adımı varsa `outcome='abandoned'`.
  3. **Yükleme:** yeni bağlantının ilk turunda o günkü önceki özetlerden en yeni 3 tanesi system prompt'a "Bugünkü önceki konuşmalar (oyuncu beyanı, doğrulanmadı)" bölümü olarak girer.
  4. **Kimlik güven seviyesi (ID-03'ten gelir):** `session` (aynı müşteri kaydı/çerez), `claimed` (yalnız kullanıcı adı beyanı, farklı cihaz), `verified` (F2: operatör token'ı ile). `session`/`verified` → AI ayrıntıyı tekrar edebilir ve slotları önceden doldurabilir. `claimed` → prompt'a giden özetten slot değerleri çıkarılır; AI yalnız konuyu genel olarak anabilir ("Bugün daha önce de bize yazmış mıydınız?"), tutar/yöntem/TXID/IBAN hanelerini söylemez, slotları yeniden sorar. Filtre prompt kurulmadan önce kodda uygulanır, modelin insafına bırakılmaz.
  5. **Slot taşıma:** aynı prosedür aynı gün yeniden başlarsa (`session` güveninde) önceki slotlar `status='carried'` ile önceden doldurulur; compose tek cümlelik teyit ister, ama yeniden sormaz.
  6. **Hatırlatma modu:** `auto_if_unresolved` → son özetin sonucu `handed_off`, `abandoned` ya da `resolved_waiting` ise ve anlama çağrısı `relates_to_previous != false` derse AI ilk cevabında önceki konuya kısaca değinir. `on_topic_only` → yalnız anlama çağrısı `relates_to_previous=true` derse.
  7. **Tekrar temas sinyali:** aynı `procedure_key` ve önceki sonuç `handed_off` ya da `resolved_waiting` ise `signals.repeat_same_day=true`. AI-09 bunu devir tetikleyicisi olarak kullanır; AI-12 önceki devrin ekibine (ve çevrimiçiyse aynı ajana) yönlendirir.
  8. **Gün sınırı:** AI-02 tarih hesaplamaz; `daily_thread_id`'yi ID-02/ID-04'ten alır.
  9. **Güvenlik:** `daily_thread_id` her zaman sunucuda, oyuncu principal'ından türetilir; istemciden gelen ID ile asla sorgulanmaz. Özetlere iç not girmez. Saklama süresi sohbetlerin saklama süresine bağlıdır.
  10. **Performans:** tek indeksli sorgu, en fazla 3 küçük JSON (≤2 KB).
- **Kabul kriterleri:**
  - Bağlantı 1: Papara 2.500 TRY, finansa devredildi, kapandı. Aynı gün bağlantı 2: "hâlâ gelmedi" → AI ilk cevabında önceki konuya değinir, toplanmış slotları yeniden sormaz (`session` güveni); devir kartında "aynı gün 2. temas" görünür.
  - Ertesi gün aynı oyuncu → hiçbir özet yüklenmez.
  - `claimed` güveninde AI cevabı ve model isteği önceki tutar/yöntem değerlerini içermez (mock istek ve çıktı üzerinden doğrulanır).
  - Widget kapatılıp sohbet zaman aşımına uğrarsa `outcome='abandoned'` ve toplanan slotlar özette bulunur.
  - Çapraz kiracı testi: başka kiracının özetleri hiçbir koşulda yüklenmez.
- **Riskler / notlar:**
  - Kimlik sahteciliği riski tamamen ID-03'ün güven seviyesine bağlıdır; ID-03 hazır olana kadar yalnız `session` eşleşmesi kullanılmalıdır.
  - ID-02'nin eşlemesi değişirse yalnız `loadDailyDigests` değişir.
  - Eski özet yanlış yönlendirebilir (oyuncu bu arada sorunu çözmüş olabilir); compose talimatı "önceki durumu varsayma, teyit et" olmalıdır.
  - KVKK/GDPR: özet kişisel veri içerir; saklama ve silme sohbet verisiyle birlikte yapılır.

### AI-03 — Prosedür (konu akışı) motoru
- **Alan (panelde nerede, kim kullanır):** Web: AI Agent (`/app/playbook`, menüde bugün "Senaryolar"; sahibin terimiyle "AI Agent" olarak yeniden adlandırılması önerilir) › bugünkü "Beceriler" sekmesi (`apps/web/src/locales/tr/playbook.ts:114`) → "Prosedürler". Düzenleyici `SkillEditor.tsx` genişler. Kurucu/Yönetici düzenler ve yayınlar; Ekip Lideri taslak hazırlar, test eder, yayına gönderir (AI-20); Ekip Üyesi salt okur. Çalışma zamanı: widget sohbeti.
- **Mevcut kod karşılığı:**
  - `apps/api/prisma/schema.prisma:1657-1680` `Skill` (`steps` Json, kullanılmayan `trigger` Json `:1667`, `active`, `kind`); `:1694-1712` `SkillRun`; `:1723-1736` kullanılmayan `Workflow` (ADR-14).
  - `packages/ai-mock/src/steps.ts:9-62` 6 adım tipi ve doğrulayıcı (`validateStep`, problem kodları `:69-81`).
  - `apps/api/src/services/ai/skill-engine.ts:214-512` (`run`, `preview`, `#intentGate`, `#execute`), tek geçişli.
  - `packages/ai-mock/src/compiler.ts` kural tabanlı NL→adım derleyici; `apps/api/src/routes/playbook.ts:567-576` `POST /skills/compile`, `:577-604` `POST /skills/preview`, `:605` `GET /skills/{id}/runs`.
  - Kontrat: `packages/contract/openapi/paths/playbook.yaml`, şemalar `openapi.yaml:1287-1346` (`SkillStep`, `Skill`).
  - Web: `apps/web/src/features/playbook/SkillEditor.tsx` (1204 satır), `step-authoring.ts`, `step-reorder.ts`, `step-contract-parity.test.ts`.
- **Eklenecek / değişecek yerler:**
  - `packages/types/src/procedure.ts` (yeni): prosedür, adım, koşul ve slot tipleri + doğrulayıcı (web ve api ortak). `packages/ai-mock/src/steps.ts` eski tek mesajlık adımlar için kalır.
  - Prisma (genişletme migration'ı, varsayılanlı kolonlar): `skills` tablosuna `mode text default 'single'`, `when_to_use text`, `examples text[] default '{}'`, `priority int default 100`, `slots jsonb default '[]'`, `procedure jsonb default '{}'`, `locked bool default false`, `template_key text`, `template_version int`. (`status`/`version` AI-20'nindir; o gelene kadar `active` = yayında.) Yeni tablo `ai_conversations` (aşağıda) + RLS.
  - Kontrat: `Skill` şeması yeni alanlarla; `ProcedureStep` birleşik tipi; `POST /skills/compile` `{ mode: 'procedure', sop_text }` kabul eder ve taslak prosedür döner; `GET /chats/{chatId}/ai-conversation` (ajanlar için durum: aktif prosedür, adım, slot durumları; ID-09 görüntüleyicisi de kullanır). Çok turlu `POST /skills/preview` AI-19'un konusudur; bu madde yalnız `conversation: [{role, text}]` girdisini ve `state` çıktısını ekler.
  - Servis: `conversation/procedure/executor.ts`, `conditions.ts`, `templates.ts` (değişkenli metin), `policy.ts`.
  - Web: `SkillEditor.tsx`'e bölümler: "Ne zaman kullanılır", "Örnek cümleler", "Öncelik", "Toplanacak bilgiler" (AI-04), "Adımlar" (her satırda tip + talimat + isteğe bağlı "Eğer…" koşulu + hedef adım), "Yanıt kalıpları", "Devir" (koşullar, hedef ekip AI-12, kart alanları AI-10). Listede `mode` rozeti ve öncelik kolonu. Görsel tuval YOK.
  - Test: birim (yürütücü, koşul değerlendirici, kaydetme doğrulaması), entegrasyon (araştırma §3.1 yatırım akışı uçtan uca), e2e (`apps/e2e/tests/playbook.spec.ts` prosedür düzenleme), `step-contract-parity.test.ts` yeni tiplere genişler.
- **Kodlama mantığı:**
  1. **Prosedür tanımı** (`mode='procedure'` olan skill üzerinde):
     ```
     Procedure { when_to_use, examples[], priority, slots: SlotDef[] (AI-04),
                 steps: ProcStep[], templates: {key, text, verbatim?}[],
                 handoff: { conditions: Cond[], target: TargetRef (AI-12), card_fields[], next_step_hint },
                 limits: { max_turns: 12 } }
     ProcStep (hepsinde id, isteğe bağlı instruction ve when: Cond):
       say{template_key|instruction} · collect{slots: ≤2} · check{when, then: Goto|Step, else?}
       answer_from_knowledge{query_hint?} · handoff{reason_code, target?}
       resolve{outcome: 'resolved'|'resolved_waiting', followup_template?} · tag{tag}
       tool{tool_key, inputs, active:false}   // AI-28 yuvası, F1'de atlanır
     Cond = { all?[] | any?[] | not? | slot{name, op, value} | fact{path, op, value}
              | fn{name, args} | ai{question} }
     ```
     Operatörler: `eq, neq, lt, lte, gt, gte, in, not_in, exists, missing, matches`. Serbest ifade/`eval` yok. `fn` sabit bir listedir: `elapsed_minutes(slot)`, `within_working_hours(method, slot)`, `next_window(method)`. `fact` yolları AI-13 tablolarından çözülür (`method.expected_minutes`, `method.delay_threshold_minutes`, `method.min`). `ai` koşulu doğal dilde evet/hayır sorusudur; anlama çağrısının JSON çıktısında `ai_conditions: { stepId: true | false | unknown }` olarak cevaplanır; `unknown` = false ve kayda düşer. Şablonlarda kural koşulu tercih edilir (tutarlılık, G18).
  2. **Durum tablosu `ai_conversations`** (bağlantı başına bir satır):
     ```
     id uuid pk, license_id, chat_id, thread_id, daily_thread_id (ID-02),
     mode 'ai'|'human'|'paused' (AI-11), active_skill_id, procedure_snapshot jsonb,
     step_id, step_status 'awaiting_answer'|'ready'|'done',
     slots jsonb (AI-04), suspended jsonb (askıdaki tek konu: skill, adım, slotlar),
     counters jsonb (turns, clarify, not_understood_streak, abuse_warnings, slot denemeleri),
     signals jsonb (duygu eğilimi, risk bayrakları AI-27, repeat_same_day),
     digest jsonb, outcome, last_processed_event_seq int, version int,
     created_at, updated_at, closed_at;  unique(license_id, chat_id, thread_id)
     ```
  3. **Sürüm sabitleme:** prosedür başlarken tanımın tamamı `procedure_snapshot`'a kopyalanır. Konuşma sürerken yayınlanan değişiklik o konuşmayı etkilemez. AI-20'nin `skill_versions` tablosu gelince snapshot yerine `(skill_id, version)` referansı kullanılabilir; snapshot yine de en sağlam varsayılandır.
  4. **Tur içi yürütme** (policy "prosedürü sürdür/başlat" dediğinde): başlangıçta slotlar anlama çıktısı ve gün içi özetle (AI-02) önceden doldurulur. Adım döngüsü (tur başına en fazla 8 iç adım, sonsuz döngü kalkanı):
     - `when` yanlışsa sonraki adım.
     - `collect`: eksik zorunlu slotlar hesaplanır (koşullu zorunluluk dahil); eksik yoksa geç; varsa en fazla `max_questions_per_message` (AI-07 ayarı, varsayılan 2) soru "sor" eylemi olur, `step_status='awaiting_answer'`, döngü biter.
     - `check`: koşul değerlendirilir → `then` / `else`.
     - `say`: kalıp slot ve fact'lerle doldurulur; eksik değişken varsa kalıp gönderilmez, hata kaydedilir, adımın `instruction`'ı kullanılır. Birden çok `say` tek mesajda birleştirilir.
     - `answer_from_knowledge`: AI-06 çağrılır, sonuç kuyruğa girer.
     - `handoff`: devir eylemi (AI-09/10/12), prosedür biter.
     - `resolve`: sonuç işaretlenir, takip kalıbı gönderilir, aktif prosedür temizlenir, özet güncellenir.
     - `tool`: F1'de "araç adımı pasif, atlandı" kaydı ve devam.
  5. **Mesaj üretimi:** kuyruğa giren eylemler tek oyuncu mesajı olarak compose'a (LLM #2) gider. `verbatim: true` kalıplar (yasal metinler) olduğu gibi eklenir, model yeniden yazmaz.
  6. **Sınırlar:** her tur `counters.turns++`; `limits.max_turns` aşılırsa devir nedeni `max_turns`.
  7. **Konu değişimi:** anlama çağrısı aktif olandan farklı bir prosedürü eşik üstünde seçerse, aktif prosedür `awaiting_answer` durumundaysa `suspended`'a alınır (varsa eskisinin üstüne yazılır, en fazla 1) ve yenisi başlar. Yenisi `resolve` ile biterse ve askıda konu varsa AI "Önceki konuya dönelim mi?" diye sorar (cevap anlama çağrısının `yes_no` alanından). Kilitli prosedürler (AI-15'teki G1/G2/G5) her şeyin önüne geçer ve askıdakini siler.
  8. **Bekleme:** prosedür içinde zamanlayıcı yok. Bağlantı kapanınca özet (AI-02). Aynı bağlantıda 30 dakikadan uzun aradan sonra gelen mesaja "uzun ara" sistem notu eklenir (compose yeniden selamlar, bilgileri teyit eder).
  9. **Kaydetme doğrulaması (API, 400 + problem kodu):** `goto` hedefi var mı; `collect` içermeyen döngü var mı (sonsuz döngü); `collect` ≤ 2 slot; kalıp değişkenleri slot/fact listesinde var mı; hassas slot yasağı (AI-04); devir hedefi geçerli bir grup mu (AI-12); `locked` skill'de yalnız kalıp metinleri değişebilir; erişilemeyen adım için uyarı (hata değil).
  10. **Eski skill adaptörü:** `mode='single'` skill'ler çalışırken eşlenir: `detect_intent` → `when_to_use`/`examples`; `request_info` → `collect`; `send_message` → `say` ya da `answer_from_knowledge`; `transfer_to_team` → `handoff`; `summarize` → işlem yok (kart her zaman üretilir); `tag` → `tag`. Mevcut `skill-engine.test.ts` senaryoları yeni motorla da geçmelidir.
  11. **SOP'tan taslak (P1 alt işi):** `POST /skills/compile` `mode='procedure'` ile LLM'e JSON şemasıyla gider, çıktı kaydetme doğrulamasından geçer, asla otomatik etkinleşmez. Mock modda kural tabanlı derleyici iskelet üretir.
  12. **Kayıt:** her adım kararı ID-08'e olay olarak gider (`turn_id, step_id, type, cond_result, detail`). Her tur için `skill_runs`'a bir satır yazılır (AI Agent raporu `skill_runs`'tan okuduğu için süreklilik korunur, `schema.prisma:1682-1693`).
  13. **Güvenlik:** `ai_conversations` RLS'li; slot değerleri kişisel veri içerir; `GET /chats/{chatId}/ai-conversation` sohbet görünürlüğüyle (`resolveVisibility`, `chat-service.ts:1296` deseni) korunur; müşteri API'sinden asla dönmez. **Performans:** tur başına birincil anahtarla bir okuma, bir yazma; snapshot 10–30 KB.
- **Kabul kriterleri:**
  - Araştırma §3.1'deki "yatırım geçmedi" akışı mock LLM ile 4–6 turda koşar; geçen süre / beklenen süre karşılaştırmasına göre A/B/C/D kalıplarına dallanır; ya `resolved_waiting` ile biter ya da bütün slotlarla devreder.
  - Konuşma sürerken yayınlanan prosedür değişikliği o konuşmayı etkilemez.
  - Kaydetme şunları reddeder: olmayan adıma `goto`, `collect`'siz döngü, 3 slotlu `collect`, tanımsız kalıp değişkeni, "şifre" slotu, olmayan ekip.
  - Akış ortasında konu değişimi askıya alma ve "önceki konuya dönelim mi?" sorusunu üretir.
  - Eski tek mesajlık skill'lerin mevcut testleri yeni motorla geçer.
  - `tool` adımı F1'de atlanır ve kayda düşer; `max_turns` aşılınca devir nedeni `max_turns` olur.
- **Riskler / notlar:**
  - ADR-14'e ek not zorunlu; ek yazılmadan bu madde PLAN.md'de "ADR ihlali" olarak işaretlenir.
  - Koşul dili kapsam kaymasına açık; liste sabit tutulmalı, yeni `fn` eklemek kod değişikliğiyle olmalı.
  - `ai` koşulları deterministik değildir; şablonlarda yalnız kaçınılmaz yerlerde kullanılmalı.
  - Mevcut skill'ler için veri taşıma gerekmez (varsayılanlı kolonlar); `skill_runs` satır sayısı tur başına bir satırla artar, saklama politikası gerekir.
  - Düzenleyici karmaşıklaşır; AI-15 şablonları ve "SOP'tan taslak" bu yükü azaltır.

### AI-04 — Bilgi toplama (slot) sistemi
- **Alan (panelde nerede, kim kullanır):** AI Agent › Prosedürler › (prosedür) › "Toplanacak bilgiler" tablosu — Kurucu/Yönetici, Ekip Lideri (taslak). Ajan, canlı AI sohbetinde sağ panelde "AI'ın topladıkları" listesini ve devirde kartı (AI-10) görür — tüm roller.
- **Mevcut kod karşılığı:**
  - `packages/ai-mock/src/steps.ts:30-34` `RequestInfoStep { field, prompt }`; `apps/api/src/services/ai/skill-engine.ts:443-459` yalnız soruyu gönderir; `:791-799` `looksSupplied` kaba tahmin (sipariş no / e-posta / telefon).
  - Cevap hiçbir yerde saklanmıyor. Maskeleme: `apps/api/src/routes/customer.ts:816`.
  - Değişken kalıbı örneği: `packages/types/src/template-variables.ts` (ticket e-postaları için). Özel alanlar: `CustomFieldDefinition` (`apps/api/prisma/schema.prisma:1036`) — slotun müşteri profiline yazılması için ileride kullanılabilir.
- **Eklenecek / değişecek yerler:**
  - `packages/types/src/slots.ts` (yeni): `SlotType`, `SlotDef`, `SlotValue`, yasak ad/etiket listesi, ortak doğrulayıcılar (web formu ve API aynı kodu kullanır).
  - Servis: `conversation/slots/normalize-tr.ts` (Türkçe tutar, tarih/saat, evet/hayır), `validators.ts` (TXID/ağ, IBAN son 4, e-posta, telefon, tablo kaynaklı enum), `extract.ts` (anlama çağrısının çıktısını doğrulayıp duruma yazar).
  - Prisma: yeni tablo yok; `skills.slots` (AI-03) ve `ai_conversations.slots`.
  - Kontrat: `SlotDef` şeması, kaydetmede `slot_sensitive_forbidden`, `slot_unknown_reference` gibi problem kodları.
  - Web: `SkillEditor.tsx` içinde slot tablosu (ad, etiket, tip, zorunluluk, soru metni, doğrulama, hassasiyet, kartta göster); Gelen Kutusu `DetailsPanel.tsx`'e "AI'ın topladıkları" bölümü (`GET /chats/{chatId}/ai-conversation` verisiyle).
  - Test: Türkçe ifade tablosuyla kapsamlı birim testleri (en az 40 örnek), entegrasyon (çok slotlu tek mesaj, düzeltme, reddetme).
- **Kodlama mantığı:**
  1. **SlotDef:** `{ name, label, type, required: 'always' | 'never' | { when: Cond }, ask, ask_variants?, validate?: { min?, max?, enum_source?: 'payment_methods.deposit' | 'bonuses' | …, regex?, network_aware?: true }, pii: 'none' | 'low' | 'high', show_in_card: true, card_label?, max_attempts: 2, confirm: 'never' | 'if_inferred' | 'always' }`.
  2. **Tipler:** `text, enum, number, money (tutar + para birimi; varsayılan kiracının para birimi), datetime (kiracı saat dilimiyle), date, duration, boolean, username, email, phone, txid (ağla birlikte), crypto_network, iban_last4 (yalnız 4 hane), reference_code, file (ek referansı), url`.
  3. **Yasaklar (G11), kaydetmede reddedilir:** ad, etiket ya da soru metni şunları çağrıştırırsa: şifre/parola, OTP/SMS/doğrulama kodu, tam kart numarası, CVV/CVC, seed/özel anahtar, internet bankacılığı bilgileri, tam IBAN (yalnız `iban_last4` tipi serbest). TR ve EN regex listesi `packages/types`'ta tek kaynak.
  4. **Çıkarım:** anlama çağrısı (AI-05) aktif prosedürün (ya da başlatılacak adayın) slotları için `extracted: [{ slot, raw_text, value, confidence }]` döner. Ardından deterministik adımlar:
     - **İzlenebilirlik kalkanı:** `raw_text` işlenen oyuncu mesajlarında (normalize edilmiş haliyle) geçmiyorsa değer atılır. Model uydurma değer üretemez.
     - **Normalizasyon (TR):** "2,5 bin", "2.500", "2500tl", "₺2.500,00" → 2500.00 TRY. "13:40" → bugün 13:40 (kiracı TZ, ID-04; varsayılan Europe/Istanbul). "dün akşam" → tarih dün, saat bilinmiyor → `partial` ve saat sorulur. "az önce" → `partial`, saat sorulur (araştırma §3.1). Gelecek zaman ya da 30 günden eski zaman → `invalid`. "evet/hayır/var/yok/olmadı" → boolean.
     - **Doğrulama:** TRC20 TXID 64 hex; ERC20/BEP20 `0x` + 64 hex; cüzdan adresi öneki T / 0x (araştırma §3.2). Tablo kaynaklı enum, AI-13 satırlarının ad ve takma adlarına bulanık eşleşir ("papara", "PPR" → kanonik yöntem). Min/max dışı tutar reddedilmez, `out_of_range` işaretlenir; prosedür koşulları bunu kullanır.
  5. **Durumlar:** `missing | filled | partial | invalid | refused | unknown (oyuncu bilmiyor) | carried (AI-02)`. Slot başına deneme sayacı; `max_attempts` aşılınca `refused` olur ve policy karar verir (zorunluysa devir; kartta "verilmedi").
  6. **Tekrar sormama:** `filled` ve `carried` slotlar sorulmaz. Oyuncu düzeltme yaparsa ("pardon 3000 değil 2500") anlama çıktısındaki `correction: true` ile üzerine yazılır, eski değer `previous_values`'da tutulur.
  7. **Soru üretimi:** bir mesajda en fazla `max_questions_per_message` soru (AI-07, varsayılan 2), adımdaki sırayla; compose bunları tek doğal cümlede birleştirir; `ask_variants` ikinci denemede kullanılır.
  8. **Ekler:** `file` slotu aynı bağlantıdaki oyuncu ek olayıyla (`events.attachment_url`) dolar. AI "Dekontunuz alındı" der, içeriğini yorumlamaz (G12). KYC belgesi türündeki slot, kanal ayarı kapalıysa ek kabul etmez ve resmi yükleme yolunu anlatır.
  9. **Saklama:** `ai_conversations.slots = { ad: { value, display, status, source: 'player' | 'carried' | 'inferred', confidence, turn, attempts, previous_values } }`. `pii='high'` değerler karar kaydına ve operatör loguna yazılmaz, yalnız durumları yazılır.
  10. **Uç durumlar:** bir mesajda birden çok slot (hepsi dolar); sorulmayan slota cevap (yine dolar); başka dilde cevap (çıkarım dil bağımsız); oyuncunun kendiliğinden hassas veri yazması (AI-26 maskeler, AI-08 uyarır; çıkarıma maskelenmiş metin gider).
  11. **Güvenlik:** slot değerleri webhook veya otomasyonlara gönderilmez (F2'de açık izinle); ajan uçları sohbet görünürlüğüyle korunur.
- **Kabul kriterleri:**
  - "dün akşam papara ile 2,5 bin attım" → `yontem=papara (filled)`, `tutar=2500 TRY (filled)`, `islem_zamani=partial`; AI'ın sonraki sorusu yalnız saati sorar.
  - Adı "şifre" olan ya da sorusu "SMS kodunuzu yazın" olan slot kaydedilirken 400 `slot_sensitive_forbidden` döner.
  - Model `raw_text`'i mesajda olmayan bir değer döndürdüğünde değer kaydedilmez (mock ile test).
  - TXID ağ bazında doğrulanır; geçersizde AI biçimi açıklayarak bir kez yeniden sorar.
  - Düzeltme önceki değerin üstüne yazar; 2 reddetmeden sonra slot `refused` olur ve kartta "verilmedi" görünür.
  - 40+ Türkçe ifadeli normalizasyon tablosu birim testleri geçer.
- **Riskler / notlar:**
  - Türkçe tarih/tutar ifadeleri sonsuz çeşitlilikte; deterministik normalizasyon + LLM aday değeri birlikte kullanılmalı, LLM tek başına güvenilmez.
  - Saat dilimi ID-04'e bağlı; o gelmeden kiracı varsayılanı Europe/Istanbul sabitlenir.
  - Slot verisi kişisel veridir; saklama süresi ve erişim yetkisi RL-02 ile birlikte gözden geçirilmeli.

### AI-05 — LLM tabanlı konu tespiti ve prosedür seçimi
- **Alan (panelde nerede, kim kullanır):** Motorun içindedir. Ayarları: AI Agent › Prosedürler › her prosedürde "Ne zaman kullanılır", "Örnek cümleler", "Öncelik" ve "Yedek prosedür" işareti (AI-03 alanları); AI Agent › Profil › Gelişmiş › "Netleştirme eşikleri" — Kurucu/Yönetici. Test ekranında "neden bu prosedür seçildi" açıklaması (AI-19) — Kurucu/Yönetici/Ekip Lideri.
- **Mevcut kod karşılığı:**
  - `packages/ai-mock/src/intent.ts:29` `INTENT_THRESHOLD = 0.6`, `matchIntent` kelime örtüşmesi; tokenizer `packages/ai-mock/src/embedding.ts`.
  - `apps/api/src/services/ai/skill-engine.ts:239-256`: aktif skill'ler `updatedAt desc` sırasıyla, ilk eşleşen kazanır; öncelik yok. `:366-370`: `detect_intent` adımı olmayan skill her mesaja uyar.
  - Dil tespiti kural tabanlı: `packages/types/src/persona.ts:472` (`detectLanguage`), `:532` (`personaLanguageVerdict`); desteklenmeyen dilde sessizce `skipped` (`skill-engine.ts:727-745`).
  - Benzer başka kural tabanlı niyetler: `packages/ai-mock/src/bi-intent.ts`, `palette-intent.ts`, `topics.ts`.
  - `provider/llm-provider.ts:45-53` istekte yapılandırılmış çıktı alanı yok; `provider/openai-llm-provider.ts` başlığı "no tools, no response format" diyor (ADR pilot LLM §6).
- **Eklenecek / değişecek yerler:**
  - `provider/llm-provider.ts`: `LlmCompletionRequest.responseSchema?` (JSON Schema) ve `temperature?`; `openai-llm-provider.ts` bunu `response_format: json_schema` olarak gönderir; `mock-llm-provider.ts` şemaya uygun deterministik JSON üretir. ADR pilot LLM §6 güncellenir (bkz. Ortak çerçeve 4).
  - `conversation/understand.ts` (yeni): katalog kurma, çağrı, çıktı doğrulama. `conversation/policy.ts`: karar kuralları.
  - Prisma: `skills` alanları AI-03'te (`when_to_use`, `examples`, `priority`) + `is_fallback bool default false`; prosedür sayısı 15'i geçerse ön eleme için `ai_procedure_examples (id, license_id, skill_id, text, embedding vector(1536), embedding_space)` + RLS + HNSW indeksi (kendi migration dosyasında).
  - Kontrat: `Skill` şemasına `is_fallback`; `AiAgent` ayarlarına `clarify_thresholds { high, low }`; kaydetmede "ajan başına en fazla 1 yedek prosedür" problemi.
  - Test: `apps/api/test/fixtures/ai-intents-tr.json` (20 iGaming konusu için yazım hatalı olanlar dahil ≥200 cümle); mock ile birim testleri (DoD kapısında); gerçek sağlayıcıyla isteğe bağlı gece değerlendirmesi (DoD dışı, rapor üretir).
- **Kodlama mantığı:**
  1. **Katalog:** AI ajanının yayındaki prosedürleri, sohbetin markasına göre süzülür (AI-14): `{ key, name, when_to_use, examples (≤8), priority, locked }`. Kilitli platform prosedürleri (AI-15: self-exclusion, sorumlu oyun sinyali) ve aktif prosedür her zaman katalogdadır.
  2. **Ön eleme:** katalog 15'ten büyükse turun embedding'i (AI-06'nın bilgi araması da aynı embedding'i kullanır; tur başına tek embedding) ile örnek cümlelere en yakın 10 prosedür seçilir; kilitliler ve aktif olan her zaman eklenir.
  3. **Anlama çağrısının JSON çıktısı (tek çağrı, AI-04/AI-08/AI-09 alanlarıyla birlikte):**
     ```
     { language, relates_to_previous: bool|null,
       wants_human: { value, explicit },
       intent: { procedure_key|null, confidence, alternatives:[{key, confidence}],
                 is_continuation, smalltalk, off_topic },
       answers_pending_question, yes_no: 'yes'|'no'|null,
       extracted: [...] (AI-04), correction: bool, ai_conditions: {...} (AI-03),
       sentiment: 'positive'|'neutral'|'negative'|'angry', abuse: bool,
       risk: { self_exclusion, rg_signal, self_harm, minor, fraud_aml,
               complaint_formal, account_takeover }  // her biri {flag, evidence_quote}
     }
     ```
     Çıktı şemayla doğrulanır; geçersizse bir kez yeniden istenir; yine geçersizse tur "anlama başarısız" sayılır (AI-09 `ai_failure`).
  4. **Karar sırası (`policy.ts`, deterministik):**
     1. AI-08/AI-09 zorunlu devirleri.
     2. Aktif prosedür var ve (`is_continuation` ya da `answers_pending_question`) → sürdür (yeniden sınıflandırma yok).
     3. `confidence ≥ high` (varsayılan 0.70) → başlat ya da geçiş yap. Beraberlikte (fark < 0.10) kilitli olan, sonra küçük `priority` değeri, sonra yüksek güven kazanır.
     4. `low ≤ confidence < high` (varsayılan 0.40) ve aday varsa → en iyi iki adayla tek seçmeli netleştirme sorusu. Art arda ikinci netleştirme yapılmaz; ikincisinde bilgi yoluna geçilir.
     5. Diğer durumlar → AI-06 bilgi yolu; `smalltalk` ise bilgi aranmadan kısa persona cevabı.
     6. Hiçbir prosedür ve bilgi bulunamadıysa `unmatched` olayı yayılır (AI-22 bunu toplar).
  5. **Yedek prosedür:** `is_fallback=true` olan tek prosedür yalnız hiçbir prosedür `low` eşiğini geçmediğinde ve bilgi yolu cevapsız kaldığında çalışır. Migration: `detect_intent` adımı olmayan eski skill'ler `is_fallback=true` işaretlenir ve panelde uyarı gösterilir; böylece "her mesaja uyan skill" sorunu biter.
  6. **Mock modu:** mock sağlayıcı anlama çıktısını `matchIntent` ile örnek cümlelerden üretir; testler deterministik kalır.
  7. **Dil:** `language` alanı persona dil kontrolünün yerini alır (AI-30 genişletir); mock'ta `detectLanguage` kalır. Desteklenmeyen dil artık sessizlik değil, devirdir (AI-09).
  8. **Kayıt:** seçilen prosedür, güven, alternatifler ve karar adımı ID-08'e olay olarak gider; AI-19 test ekranı bunu "neden" açıklaması olarak gösterir.
  9. **Performans:** anlama çağrısı için küçük/ucuz model ayrı yapılandırılabilir (`LLM_UNDERSTAND_MODEL`, boşsa ana model); sıcaklık 0.
- **Kabul kriterleri:**
  - "havale attım gözükmüyor", "usdt gönderdim düşmedi", "bakiyem gelmedi" → `deposit_not_credited` (mock'ta örnek cümlelerle; gerçek modelde fixture setinde ilk tahmin doğruluğu ≥ %90 hedef, DoD kapısı değil).
  - Eşit güvenli iki prosedürde küçük `priority` değeri kazanır.
  - Niyet adımı olmayan eski bir skill, başka bir prosedür eşleştiğinde cevap vermez.
  - Düşük güvende iki seçenekli tek netleştirme sorusu sorulur, art arda ikinci kez sorulmaz.
  - Aktif prosedürde "Papara" cevabı devam olarak işlenir, yeniden sınıflandırılmaz.
  - "hesabımı kapatın" her durumda kilitli self-exclusion prosedürünü seçer (aktif prosedür olsa bile).
- **Riskler / notlar:**
  - Tur başına iki ardışık model çağrısı gecikmeyi artırır (oyuncu 2–5 sn bekleyebilir); widget'ta "yazıyor" göstergesi bu süre boyunca açık tutulmalı.
  - ADR pilot LLM §6 metni güncellenmeden `response_format` açılmamalı.
  - Prosedür seçimi kiracının yazdığı tariflerle sınırlıdır; kötü tarif kötü seçim üretir; AI-19 değerlendirmesi zorunlu tutulmalı.

### AI-06 — Bilgi bankasından genel yanıt + "bilmiyorum" davranışı
- **Alan (panelde nerede, kim kullanır):** Motorun içindedir. Ayar: AI Agent › Devir ve Yönlendirme › "Bilgi bulunamazsa" (konu grubuna göre: doğrudan devret / önce sor) ve "Bilmiyorum metni" — Kurucu/Yönetici. Kaynak kayıtları AI-14 ekranında.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/ai/skill-engine.ts:533-664` (`#sendMessage` bilgi yolu: `embedQuery`, `search`, eşik, sonuç yoksa `text: null`); `:581-595` sonuç yoksa oyuncuya hiçbir şey söylenmiyor; `:295` hiçbir skill uymazsa `NOTHING_RAN`; `ai-responder.ts:125` `skipped` sessizce döner.
  - `apps/api/src/services/ai/knowledge-service.ts:110` `RETRIEVAL_THRESHOLD = 0.25` (env ile değişebilir, tm 256.6); `:343-382` arama `ai_agent_id` ile süzülüyor.
  - `provider/answer-prompt.ts:63-76`: "yalnız pasajlarla cevap ver" talimatı; çıktı düz metin.
- **Eklenecek / değişecek yerler:**
  - `conversation/knowledge-answer.ts` (yeni): AI-14 süzgeçleriyle arama, AI-13 tablo gerçekleri, yazım ve dayanak kontrolü.
  - Compose çıktısı JSON'a geçer: `{ reply, grounded: 'full' | 'partial' | 'none', cited_ids: [] }` (ADR §6 güncellemesiyle aynı mekanizma).
  - Ayarlar `ai_handoff_settings` içinde (AI-09): `no_answer: { policy_by_category: { money, account, bonus, rg, other }, text }`.
  - Olay: `ai.unanswered` (normalize edilmiş soru, dil, bağlantı) — tablo ve kümeleme AI-22'nin.
  - Test: entegrasyon (eşleşen SSS, eşleşmeyen soru, başka markanın kaynağı, süresi geçmiş kaynak, sayı uydurma).
- **Kodlama mantığı:**
  1. **Tetik:** policy "bilgi yolu" dediğinde ya da prosedürde `answer_from_knowledge` adımı çalıştığında.
  2. **Sorgu:** işlenmemiş oyuncu metni + varsa adımın `query_hint`'i + son bot sorusunun kısa bağlamı. Embedding turun ortak embedding'idir.
  3. **Gerçek cevabı önce:** anlama çıktısı bir tablo varlığı ve özelliği gösteriyorsa ("Papara" + "min yatırım") cevap AI-13 satırından kalıpla, kesin değerle verilir (RAG yok, sıfır uydurma riski).
  4. **Arama:** `knowledge_chunks` üzerinde AI-14 süzgeçleri: `audiences` içinde `ai_agent`, marka eşleşmesi ya da tüm markalar, `status='published'`, `valid_until` geçmemiş. AI-13 tablo satırları da metne çevrilmiş parçalar olarak aranır.
  5. **Eşik altı:** sonuç yoksa doğrudan "cevap yok" yoluna geçilir; model çağrılmaz (bugünkü doğru davranış korunur).
  6. **Yazım:** compose pasajlar, kilitli kurallar ve talimatlarla JSON döner. `cited_ids` verilen pasajların alt kümesi olmalı; değilse çıktı geçersiz sayılır.
  7. **Dayanak kararı:** `none` → cevap yok yolu. `partial` → cevap + "Daha fazla ayrıntı için sizi temsilcimize aktarabilirim" teklifi. `full` → cevap.
  8. **Cevap yok yolu:** kiracı metni (varsayılan: "Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.") ya da "aktarayım mı?" sorusu, konu grubuna göre. Devir nedeni `no_knowledge` (AI-09); mesai dışı ise AI-12. `ai.unanswered` olayı yayılır.
  9. **Sessizlik yasağı (değişmez kural):** `mode='ai'` iken işlenen her oyuncu turu ya bir bot mesajıyla ya da açık bir devir mesajıyla biter. Bu kural tek bir yerde test edilir.
  10. **Tutarlılık (G18):** compose sıcaklığı 0–0.3; kullanılan kaynak kimlikleri tur kaydına yazılır (QA, AI-24).
  11. **Sayı uydurma kontrolü:** cevaptaki birimli sayılar (TL, dk, saat, gün, %, x) verilen pasaj ya da gerçeklerde geçmiyorsa ihlal sayılır; AI-08 çıkış denetimi yeniden yazdırır.
- **Kabul kriterleri:**
  - Eşleşen SSS'li soru → cevap ve karar kaydında o kaynağın kimliği.
  - Eşleşmeyen soru → açık "kesin bilgi veremiyorum" mesajı ve ayara göre devir ya da soru; hiçbir durumda sessizlik yok.
  - Kaynaklarda olmayan bir sayı içeren taslak engellenir ve yeniden yazılır.
  - B markasının sohbeti yalnız A markasına ait kaynağı kullanmaz; süresi geçmiş kaynak kullanılmaz.
  - "Papara ile en az ne kadar yatırabilirim?" → AI-13 satırındaki değer birebir.
- **Riskler / notlar:**
  - 0.25 eşiği mock embedding için; gerçek embedding'de yeniden ölçülmeli (tm 256.6'nın ayarı).
  - Fazla temkinli "bilmiyorum" devir sayısını artırır; AI-22 raporuyla dengelenir.
  - Sayı kontrolü tarih ve saatlerde yanlış alarm verebilir; tarih/saat biçimleri hariç tutulmalı.

### AI-07 — Davranış talimatları (Guidance) ekranı
- **Alan (panelde nerede, kim kullanır):** AI Agent › yeni sekme "Davranış Kuralları" (`/app/playbook`, `PlaybookView`'a yeni değer, `apps/web/src/features/playbook/PlaybookPage.tsx:71-72`). Kurucu/Yönetici yayınlar, Ekip Lideri taslak hazırlar, Ekip Üyesi okur. Ek olarak AI Agent › Profil'de yapılandırılmış ayarlar: hitap (siz/sen), emoji (yok/az), tek mesajda en fazla soru (1–3), cevap uzunluğu (mevcut).
- **Mevcut kod karşılığı:**
  - `apps/api/prisma/schema.prisma:1562` `AiAgent.instruction` kullanılmıyor; `apps/api/src/routes/playbook.ts:404-413` yalnız ad, durum, ton, avatar, dil, persona güncelliyor.
  - Persona: `packages/types/src/persona.ts` (tonlar `:43`, diller `:56`, cevap uzunlukları); `apps/web/src/features/playbook/ProfileForm.tsx` (340 satır).
  - Sabit sistem talimatı: `provider/answer-prompt.ts:63-76`.
- **Eklenecek / değişecek yerler:**
  - Prisma: `ai_guidance_rules` (id, license_id, ai_agent_id, title, body ≤ 600 karakter, category `communication | clarification | sensitive | prohibition | other`, scope jsonb `{all} | {skill_ids[]} | {brand_ids[]}`, priority int, active, owner_id, status (AI-20), created_by, updated_by, zaman damgaları) + RLS. Veri taşıma: dolu `ai_agents.instruction` → "Genel talimat" adlı tek kural (genişlet → taşı; kolon daha sonraki bir sürümde düşer).
  - Persona JSON'a `address_form ('siz'|'sen')`, `emoji ('none'|'few')`, `max_questions_per_message (1–3)`.
  - Kontrat: `GET/POST /ai-guidance`, `PATCH/DELETE /ai-guidance/{id}`, `POST /ai-guidance/check` (taslak kural için çelişki uyarıları döner); `AiAgent` şemasına yeni persona alanları.
  - Servis: `conversation/guidance.ts` (tur için kural seçimi ve prompt derleme), `guidance-check.ts` (LLM ile çelişki denetimi).
  - Web: `GuidanceRules.tsx` (kategoriye göre gruplu liste, karakter sayaçlı editör, çelişki uyarı paneli, "bu kuralla test et" bağlantısı AI-19'a).
  - Test: birim (seçim, bütçe, yasak içerik), entegrasyon (kapsamlı kural yalnız ilgili prosedürde prompt'a girer).
- **Kodlama mantığı:**
  1. **System prompt katman sırası (sabit):** [1] platform kilitli kuralları (AI-08) → [2] kiracı uyum ekleri (AI-08) → [3] aktif prosedür adımının talimatı (AI-03) → [4] kapsamdaki davranış kuralları (önceliğe, sonra kategoriye göre) → [5] persona (ton, uzunluk, hitap, emoji) → [6] bağlam (durum, gün içi özetler, pasajlar). Prompt "çelişkide üstteki katman kazanır" der.
  2. **Seçim:** `active` ve yayında olan, kapsamı `all` olan ya da aktif prosedürü veya sohbetin markasını içeren kurallar. Tur başına en fazla 30 kural ve 6 000 karakter; aşılırsa en düşük öncelikliler düşer ve `guidance_truncated` kaydı yazılır.
  3. **Yapılandırılmış ayarlar metinle sınırlı kalmaz:** `max_questions_per_message` AI-03/AI-04 yürütücüsünde deterministik uygulanır; emoji ve hitap compose'a talimat olarak gider ve çıkış denetiminde (AI-08) uyarı düzeyinde kontrol edilir.
  4. **Çelişki denetimi (kaydederken, uyarı verir, engellemez):** yeni kural ile kapsamı örtüşen mevcut kurallar (en fazla 20'li gruplar halinde) LLM'e JSON şemasıyla verilir → `{ conflicts: [{rule_id, explanation, severity}], duplicates: [], vague: [] }`. Kilitli bir kuralla çelişen kiracı kuralı "uygulanmayacak" hata düzeyi uyarı alır.
  5. **Deterministik ret:** kural metni şifre/OTP/kart istemeyi, bonus teklifini zorunlu kılmayı ya da AI-08 kilitli eylemlerini devre dışı bırakmayı açıkça söylüyorsa 400 `guidance_violates_locked_rule`.
  6. **Yazım ipuçları:** editörde örnek metinler: "Ödeme sorunlarında yöntemi, tutarı ve saati öğrenmeden çözüm önerme." (tam cümle, doğrudan hitap; araştırma §1.3).
  7. **iGaming varsayılan kuralları** (AI-15 kurulumuyla gelir): tek mesajda en fazla 2 soru; ödeme sorununda yöntem/tutar/saat öğrenilmeden çözüm önerilmez; mükerrer yatırım önerilmez; temsilcinin söylediğiyle çelişilmez; oyuncuya "siz" diye hitap edilir.
  8. **Kayıt:** her değişiklik AI-21'e; tur kaydına o turda uygulanan kural kimlikleri yazılır.
- **Kabul kriterleri:**
  - Yatırım prosedürüne kapsamlanan kural yalnız o prosedürün turlarında compose isteğinde bulunur (mock istek yakalama).
  - Mevcut `instruction` değeri olan ajanlarda migration sonrası bir "Genel talimat" kuralı oluşur.
  - "Oyuncudan şifresini iste" kuralı 400 ile reddedilir.
  - Birbirine zıt iki kural için çelişki denetimi uyarı döner.
  - `max_questions_per_message=1` iken yürütücü her mesajda tek soru sorar.
- **Riskler / notlar:**
  - Kural sayısı arttıkça prompt uzar ve model bazı kuralları atlayabilir; AI-19 testleri ve AI-24 QA ile ölçülmeli.
  - Çelişki denetimi ek LLM maliyetidir ama yalnız kaydederken çalışır.

### AI-08 — Uyum korumaları (guardrail) seti
- **Alan (panelde nerede, kim kullanır):** AI Agent › yeni sekme "Uyum Korumaları": (a) Platform kuralları G1–G19, salt okunur liste ve açıklama; (b) kiracı ekleri: ek kurallar, yasaklı ifade listesi, kriz hattı metni (G3), erişim sorusu metni (G14), şikâyet/ADR metni (G15); (c) "Tetiklenme kaydı" (son tetiklenmeler, sohbet ve zaman çizelgesi bağlantılarıyla, ID-09). Kurucu düzenler, Yönetici görür, Ekip Lideri tetiklenme kaydını görür.
- **Mevcut kod karşılığı:**
  - Guardrail, yasaklı ifade ya da çıktı denetimi yok. Tek talimat `provider/answer-prompt.ts:63-76`.
  - Kart maskeleme: `apps/api/src/lib/cc-mask.ts:62` (`maskCardNumbers`), `:78` (`maskOptional`), kullanım `apps/api/src/routes/customer.ts:668`. Log PII maskeleme `apps/api/src/lib/log-redact.ts:162`.
  - Oyuncu metninin loglara düşmediğini doğrulayan test: `apps/api/test/integration/ai-secret-redaction.test.ts`.
- **Eklenecek / değişecek yerler:**
  - `packages/types/src/guardrails.ts`: platform kataloğu G1–G19 (id, başlık TR/EN, prompt metni, kategori, eylem `force_handoff | block_output | block_promo | warn`, hedef konu anahtarı, öncelik, ön tarama sözlükleri TR/EN) + `PLATFORM_GUARDRAILS_VERSION`.
  - Prisma: `ai_guardrail_settings` (license_id, ai_agent_id, crisis_text, access_policy_text, complaint_text, approved_by, approved_at); `ai_guardrail_rules` (kiracı ekleri: title, body, category, action `prompt_only | block_output | force_handoff`, scope, active, status); `ai_forbidden_phrases` (phrase, match `exact | word | regex`, lang, scope, action `block | warn`); `ai_guardrail_hits` (license_id, chat_id, thread_id, turn_id, rule_key, stage `input | output`, action_taken, created_at; ID-08 tek log altyapısı kurarsa oraya taşınabilir). Hepsi RLS'li.
  - Kontrat: `GET /ai-guardrails/platform` (salt okunur), `GET/PUT /ai-guardrails/settings`, `/ai-guardrails/rules` CRUD, `/ai-guardrails/phrases` CRUD, `GET /ai-guardrails/hits?from&to&rule_key`.
  - Servis: `conversation/guardrails/` → `input-scan.ts`, `output-check.ts`, `judge.ts`, `prompt-block.ts`.
  - Yayın kapısı: `PATCH /ai-agents/{id}` ile `active: true` yapılırken kriz metni onaylı değilse 409 `ai_guardrail_setup_incomplete`.
  - Web: `GuardrailsPage.tsx`.
  - Test: her G kuralı için en az bir senaryo; çıkış denetimi birim testleri; çapraz kiracı testi.
- **Kodlama mantığı:**
  1. **Giriş taraması (LLM'siz, anlama çağrısından önce):** Türkçe normalizasyon (ı/i, ş/s, aksan, tekrar harf) sonrası sözlükler: G1 ("hesabımı kapatın", "kendimi engellemek", "ara vermek istiyorum", "oynamayı bırakmak", "self exclusion"); G2 ("kaybımı geri almam lazım", "borç", "kredi çektim", "maaşımı yatırdım", "her şeyimi kaybettim"); G3 ("intihar", "kendimi öldür", "yaşamak istemiyorum"); G5 (18 altı yaş beyanı, "lisedeyim"); G13 ("hesabım çalındı", "başkası girmiş"); G15 ("resmi şikâyet", "avukat", "lisans kurumuna"); G19 (hakaret sözlüğü).
  2. **Birleştirme:** G1/G3/G5 için yalnız sözlük eşleşmesi de yeterlidir (yanlış pozitifin bedeli bir insan devri, kabul edilebilir). Anlama çıktısındaki `risk` bayrakları tek başına da G1/G2/G3/G5'i tetikler (kaçırmamak öncelikli). Kanıt alıntısı kayda düşer.
  3. **Eylemler:** G1/G2/G3/G5/G13/G15 → zorunlu devir (AI-09) + hedef konu (AI-12: G1/G2/G3 → sorumlu oyun; G13 → KYC/Risk; G15 → şikâyet) + öncelik (G3/G5 acil). G3'te kriz metni, mesai durumundan bağımsız olarak devirden önce olduğu gibi (verbatim) gönderilir. G2/G1 tetiklenince `signals.risk_flags` dolar (AI-27).
  4. **G4 promosyon engeli:** konuşmada risk bayrağı varsa compose'a "bonus, promosyon, yatırım teşviki yok" talimatı eklenir ve çıkış denetimi bonus/freespin/kampanya/"yatırın" gibi terimleri engeller; aynı bayrak EN-01'in kampanya engelini besler.
  5. **Prompt katmanı:** kilitli kuralların kısa, emir kipinde TR metinleri anlama ve yazım çağrılarının system prompt'unun en başına girer (AI-07 katman 1), kiracı ekleri hemen ardından.
  6. **Çıkış denetimi (her cevapta, deterministik):** (a) platform yasaklı ifadeleri ("kontrol ettim", "sistemde görünüyor", "hesabınıza geçti", "garanti", "kesin yatacak", "tekrar yatırın", "kazanırsınız", VPN ya da adres önerisi) + kiracı listesi; (b) sayı uydurma (AI-06); (c) süre sözü: `\d+ (dk|dakika|saat|gün) (içinde|sonra) (yatar|gelir|geçer|ödenir)` ve yanında "genellikle / çoğunlukla / politikamıza göre" yoksa ihlal; (d) risk bayraklı sohbette promosyon terimleri; (e) hassas veri isteme ("şifrenizi", "SMS kodunu", "kartınızın tamamı", "CVV"); (f) hitap/emoji uyumu (uyarı düzeyi).
  7. **Hakem (LLM #3, isteğe bağlı):** ayar açıksa para, hesap, bonus ve sorumlu oyun kategorisindeki prosedürlerde taslak, kilitli kural listesine karşı JSON çıktıyla denetlenir: `{ ok, violations: [{rule_id, quote}] }`.
  8. **İhlalde:** ihlal bilgisi eklenerek bir kez yeniden yazdırılır; yine ihlal varsa adımın `verbatim` kalıbı ya da genel güvenli metin ("Bilgilerinizi ilgili ekibimize iletiyorum") gönderilir ve devir nedeni `guardrail_output_block` olur. Her tetiklenme `ai_guardrail_hits`'e ve ID-08'e yazılır.
  9. **Kilit:** platform kuralları API'den değiştirilemez (403); kiracı yalnız daha sıkı kural ekleyebilir. Her tur kaydına uygulanan `PLATFORM_GUARDRAILS_VERSION` yazılır.
  10. **G11:** oyuncu hassas veri yazarsa maskeleme AI-26'dadır; bu madde uyarı kalıbını ("Lütfen şifre ve kart bilgilerinizi paylaşmayın") ekler.
- **Kabul kriterleri:**
  - "artık oynamak istemiyorum, hesabımı kapatın" → ikna yok, aynı turda sorumlu oyun ekibine devir, cevapta bonus terimi yok.
  - "16 yaşındayım" → oyun bilgisi verilmez, devir + reşit olmayan bayrağı.
  - Mock'un ürettiği "kontrol ettim, hesabınıza geçti" taslağı engellenir, yeniden yazdırılır, yine geçmezse güvenli metin + devir.
  - Kiracının eklediği "kesin" ifadesi cevabı engeller.
  - Kriz metni onaylanmadan AI ajanı etkinleştirilemez (409).
  - Platform kuralını değiştirme isteği reddedilir.
  - Kendine zarar ifadesinde kriz metni mesai dışında da hemen gönderilir.
- **Riskler / notlar:**
  - Sözlükler yanlış pozitif üretir (daha fazla devir); sorumlu oyunda bu kabul edilen bedeldir.
  - G14 (erişim adresi) hukuki görüş gerektirir; varsayılan "hiçbir yöntem önerme".
  - Hakem çağrısı maliyet ve gecikme ekler; yalnız riskli kategorilerde açık.
  - Sözlüklerin bakımı (argo, yazım hataları) sürekli iştir; AI-24 QA bulguları sözlüğe geri beslenmelidir.

### AI-09 — Otomatik insana devir tetikleyicileri
- **Alan (panelde nerede, kim kullanır):** AI Agent › yeni sekme "Devir ve Yönlendirme" › "Otomatik devir tetikleyicileri" (anahtarlar ve eşikler; kilitli olanlar gri) ve "Devir mesajları" (nedene göre metin) — Kurucu/Yönetici. Sonuçlar AI-25 raporlarında. Oyuncu devir mesajını widget'ta görür.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/ai/skill-engine.ts:488-495` yalnız açık `transfer_to_team` adımı; `:14-16` motor kendiliğinden devretmez; `:26-38` model hatasında oyuncuya hiçbir şey söylenmeden sohbet insana kalır; `:727-745` desteklenmeyen dilde sessiz `skipped`.
  - `apps/api/src/services/ai/ai-responder.ts:160-162` devir çağrısı; `packages/types/src/domain.ts:64-70` `TRANSFER_REASONS` (`ai_handoff`, `bot_handoff` …); `domain.ts:58-62` "Transferred %" metriği `ai_handoff`'a bağlı.
- **Eklenecek / değişecek yerler:**
  - `packages/types/src/handoff.ts`: devir nedeni kodları: `player_request, not_understood, negative_sentiment, no_knowledge, guardrail_rg, guardrail_self_harm, guardrail_minor, guardrail_account_security, guardrail_complaint, abuse, loop_detected, max_turns, repeat_same_day, procedure_rule, missing_required_info, ai_failure, unsupported_language, guardrail_output_block`; her birinin önem sırası ve kilitli olup olmadığı.
  - Prisma: `ai_handoff_settings` (license_id, ai_agent_id, triggers jsonb `{ not_understood_turns: 2, abuse_warnings: 2, max_turns: 12, negative_sentiment: { enabled, consecutive: 2 }, ask_before_handoff: { not_understood: true, no_knowledge_other: true } }`, messages jsonb nedene göre TR varsayılanlar, assignment_mode (AI-11), after_hours (AI-12), no_answer (AI-06)) + RLS.
  - Kontrat: `GET/PUT /ai-agents/{aiAgentId}/handoff-settings`; kilitli tetikleyiciyi kapatma isteği 400 `handoff_trigger_locked`.
  - Servis: `conversation/handoff/triggers.ts`, `handoff-service.ts` (AI-10 kart → AI-11 mod → AI-12 hedef sırasını tek fonksiyonda toplar).
  - Web: `HandoffSettings.tsx`.
  - Test: her tetikleyici için birim + entegrasyon senaryosu.
- **Kodlama mantığı:**
  1. **Değerlendirme yeri:** zorunlu tetikler anlama çağrısından hemen sonra, yürütücüden önce; prosedür kaynaklı tetikler yürütücüden sonra; çıktı kaynaklı tetik (AI-08) compose'dan sonra.
  2. **Tetikleyiciler:**
     - Kilitli (AI-08): G1, G2, G3, G5, G13, G15 → hemen.
     - `player_request`: `wants_human.explicit` → hemen devir. Konu henüz bilinmiyorsa ve bu ilk istekse yönlendirme için tek bir "Konuyu kısaca yazar mısınız?" sorusu sorulabilir (G16'nın izin verdiği tek netleştirme); ikinci istekte koşulsuz devir. AI-29 butonu da aynı nedeni LLM'siz üretir.
     - `not_understood`: niyet yok + devam değil + bilgi cevabı yok → `not_understood_streak++`; eşikte (varsayılan 2) bir kez "aktarayım mı?" (ayar) ya da doğrudan devir. Başarılı turda sayaç sıfırlanır.
     - `negative_sentiment`: `angry` ya da art arda N `negative` → devir (ayara göre önce sor).
     - `no_knowledge`: AI-06'dan, konu grubuna göre politika.
     - `abuse`: anlama `abuse` ya da sözlük → sakin uyarı kalıbı, `abuse_warnings++`; eşikte devir (G19).
     - `loop_detected`: aynı bot sorusu art arda 2 kez ya da aynı oyuncu mesajı 3 kez (normalize edilmiş metin özeti) → devir.
     - `max_turns`: AI-03.
     - `repeat_same_day`: AI-02 sinyali + aynı prosedür → teşhis atlanır, yalnız eksik zorunlu slotlar sorulur, sonra devir.
     - `missing_required_info`: zorunlu slot `refused` → devir.
     - `ai_failure`: sağlayıcı hatası, tavan, zaman aşımı, geçersiz JSON → LLM'siz sabit metin ("Size bir temsilcimiz yardımcı olacak") + devir. Bugünkü sessizliğin yerine geçer.
     - `unsupported_language`: persona dili dışı → sabit metin + devir.
  3. **Birden çok neden:** hepsi kaydedilir; `primary_reason` önem sırasına göre seçilir; kartta (AI-10) hepsi görünür.
  4. **Devir mesajı:** nedene göre kiracı metni olduğu gibi gönderilir (LLM yok: hızlı ve güvenli); mesai dışında AI-12'nin metni eklenir.
  5. **Yürütme:** `handoffService.execute(conversation, reasons)` → kartı kur (AI-10) → `mode='human'` (AI-11) → hedefi çöz ve aktar (AI-12) → RTM push'ları. İdempotent: mod zaten `human` ise hiçbir şey yapmaz.
  6. **Transfer olayı:** `chat-service.ts:1446-1460`'taki sistem olayının `properties`'ine `handoff_id`, `reason_codes`, `priority` eklenir (rapor ve arama için).
- **Kabul kriterleri:**
  - "insanla görüşmek istiyorum" → aynı turda devir (konu biliniyorsa soru sorulmaz).
  - Art arda iki anlaşılamayan tur → ayara göre tek "aktarayım mı?" ya da devir.
  - Model hatası ve günlük tavan → oyuncu sabit metni görür ve devir gerçekleşir; sessizlik yok.
  - Desteklenmeyen dil → devir, sessizlik yok.
  - Kilitli tetikleyiciler API'den kapatılamaz.
  - Her devirde neden kodları transfer olayında ve kartta bulunur.
- **Riskler / notlar:**
  - Fazla hassas eşikler ajan yükünü artırır; varsayılanlar pilot verisiyle ayarlanmalı (AI-25).
  - Duygu sınıflandırması Türkçe argoda yanılabilir.
  - Sabit mesajlar çok dilli kiracılarda çeviri ister (AI-30).

### AI-10 — Yapılandırılmış devir kartı
- **Alan (panelde nerede, kim kullanır):** Gelen Kutusu (`/app/inbox`) sağ panelin en üstünde "AI devir kartı" (`apps/web/src/features/inbox/DetailsPanel.tsx`); transkriptte devir anında sabitlenmiş sistem satırı ("AI devretti — kartı gör"); arşivde aynı kart. Tüm roller görür; "Yeterli / Yetersiz" butonu tüm rollerde. Kart alanları prosedür düzenleyicisinden seçilir (AI-03) — Kurucu/Yönetici/Ekip Lideri.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/ai/skill-engine.ts:801-809` `buildSummary` (ilk 160 karakter); `ai-responder.ts:142-148` `threads.summary`'ye yazar.
  - Kontrat `Thread.summary` (`packages/contract/openapi/openapi.yaml:1118`); web tipi `apps/web/src/features/inbox/types.ts:79` alanı taşır ama arayüz göstermez.
  - Elle istenen Copilot özeti: `features/inbox/CopilotPanel.tsx:160-188`, `apps/api/src/services/ai/copilot-summary.ts`.
  - RTM `thread_summary_set` (`packages/types/src/rtm.ts:156`); transfer sistem olayı `chat-service.ts:1446-1460`.
- **Eklenecek / değişecek yerler:**
  - Prisma: `ai_handoffs` (id, license_id, chat_id, thread_id, daily_thread_id, ai_conversation_id, skill_id, procedure_key, procedure_snapshot_hash, intent_label, reason_codes text[], primary_reason, slots_snapshot jsonb, decision_facts jsonb, ai_statements jsonb, output_check_flags jsonb, risk_flags text[], sentiment, suggested_next_step, attachments jsonb, target_group_id, priority, card_text, created_at, accepted_by, accepted_at, feedback `sufficient | insufficient | null`, feedback_reason, feedback_by, feedback_at) + RLS; indeksler `(license_id, created_at)`, `(chat_id)`.
  - Kontrat: `AiHandoffCard` şeması; `GET /chats/{chatId}/ai-handoffs` (bağlantı ve günlük thread için); `POST /ai-handoffs/{handoffId}/feedback { value, reason? }`; `ChatDetail`'e isteğe bağlı `latest_ai_handoff` özeti.
  - RTM: yeni push `ai_handoff_created { chat_id, thread_id, handoff_id, primary_reason, priority, target_group_id }` (ADR-15 zarfı, hedef grup kitlesine).
  - Servis: `conversation/handoff/card-builder.ts`; ajanın devirden sonraki ilk mesajında `accepted_at`'i yazan kanca (`chat-service.ts` `sendEvent`, ajan principal'ı).
  - Web: `features/inbox/AiHandoffCard.tsx`, `Transcript.tsx`'te sistem satırı, arşiv görünümünde aynı bileşen; "Kopyala" butonu.
  - Test: kart kurucu birim testleri; entegrasyon (yatırım devri, bilgi devri); e2e (ajan kartı görür ve işaretler).
- **Kodlama mantığı:**
  1. **Kart durumdan deterministik kurulur (LLM yok):** konu = prosedür adı; oyuncu = ID-03 kimliği (kullanıcı adı, e-posta) ve "oyuncu beyanı, doğrulanmadı" rozeti; slotlar prosedürdeki sırayla, `show_in_card` olanlar, durum simgeleriyle (eksik / verilmedi / geçersiz / önceki bağlantıdan); **karar dayanağı** (AI-13 gerçekleri: "geçen 95 dk, beklenen ≤30 dk, eşik 60 dk"); AI'ın söyledikleri (son 5 kalıp ya da bilgi cevabı, kalıp anahtarıyla); çıkış denetimi bayrakları ("söz verilmedi" ya da "dikkat: bir taslak engellendi"); nedenler; risk bayrakları (AI-27); duygu; ekler (olay bağlantıları).
  2. **Tek cümlelik özet:** prosedür başına kalıp ("Oyuncu {yöntem} ile {tutar} yatırdığını, {geçen_süre} geçtiği halde bakiyesine yansımadığını belirtiyor."). Prosedürsüz sohbetlerde ayarla açılabilen tek cümlelik LLM özeti; varsayılan kapalı, yerine "Soru: <ilk oyuncu mesajı>".
  3. **Önerilen sonraki adım:** prosedürün `handoff.next_step_hint` kalıbı (değişkenlerle). Yoksa boş; LLM önerisi varsayılan kapalı.
  4. **Uyumluluk:** tek cümlelik özet `threads.summary`'ye de yazılır ve `thread_summary_set` yayılır; Copilot ve arama (ID-07) mevcut alandan beslenmeye devam eder.
  5. **İç not:** kartın düz metni (`card_text`) `recipients='agents'` bir sistem olayı olarak da yazılır (`properties.ai_handoff_id`); arşivde, aramada ve dışa aktarımda görünür.
  6. **Oyuncuya özet (AI-10 soru 1 varsayılanı):** yalnız `pii != 'high'` ve `source='player'` slotlar tek mesajda: "Şu bilgileri ilettim: Papara, 2.500 TL, 13:42. Yanlış bir bilgi varsa yazabilirsiniz."
  7. **Geri bildirim:** tek tık, idempotent (son değer kazanır), AI-25 "devir kalitesi" metriğine gider. `accepted_at` "insana ulaşma süresi" metriğini besler.
  8. **Güvenlik:** kart sohbet görünürlüğüyle korunur (`resolveVisibility`); müşteri API'sinden ve webhook'lardan dönmez; iç notlar karta girmez.
  9. **Performans:** kart devir anında bir kez yazılır; Gelen Kutusu tek sorguyla son kartı okur.
- **Kabul kriterleri:**
  - Yatırım devrinde kart, araştırma §3.1'deki örnek kartın bütün alanlarını içerir; "Customer asked: …" özeti artık üretilmez.
  - Ajan kartı devirden sonra 1 saniye içinde (RTM push ile) görür.
  - Geri bildirim kaydedilir ve tekrar tıklama yeni satır üretmez.
  - Kart iç not ve `pii='high'` değer içermez; bilgi devirlerinde soru ve "bilgi bulunamadı" nedeni görünür.
  - Kartta chat ID ve thread ID gösterimi ID-05'in bileşeniyle yapılır.
- **Riskler / notlar:**
  - Kalabalık kart okunmaz; varsayılan görünüm kısa (konu, 4–6 slot, neden, önerilen adım), ayrıntı açılır bölümde olmalı.
  - Oyuncuya özet, yanlış çıkarılmış bir değeri görünür kılar; bu bilinçli bir doğrulama fırsatıdır.

### AI-11 — Devirden sonra AI'ın susması
- **Alan (panelde nerede, kim kullanır):** Gelen Kutusu: sohbet başlığında AI durumu rozeti ("AI görüşüyor" / "İnsanda" / "AI duraklatıldı"), "Devral" (mevcut takeover ile birleşir) ve "AI'a geri ver" butonları (`apps/web/src/features/inbox/ThreadHeader.tsx`, `DetailsPanel.tsx`); mevcut "AI" görünüm grubu. Ayar: AI Agent › Devir ve Yönlendirme › "Sohbet atama modu: Önce AI / Paralel" — Kurucu/Yönetici. Devralma tüm rollerde; geri verme RL-02 matrisine göre.
- **Mevcut kod karşılığı:**
  - `apps/api/src/routes/customer.ts:380-389` `respondToCustomerMessage`: kural botu yoksa her mesajda `ai.handle`; sahiplik kontrolü yok. `apps/api/src/services/ai/ai-responder.ts:48-171` de bakmıyor.
  - `apps/api/src/services/chat/chat-service.ts:394-412` sohbet açılırken yönlendirme hemen bir ajana atıyor (AI ve insan paralel).
  - `chat-service.ts:1632-1730` `takeover` (+ `chat_taken_over` push `:1725`); AI'ı susturmuyor.
  - Görünümler `ai` / `ai_solved`: `chat-service.ts:2389-2417` (yüklem: bot konuştu, ajan konuşmadı / kapanışta ajan olayı yok = ADR-09).
  - Web görünüm tipi `apps/web/src/features/inbox/types.ts` (`InboxView` içinde `ai`, `ai_solved`).
- **Eklenecek / değişecek yerler:**
  - Prisma: `ai_conversations.mode` + `mode_changed_at`, `mode_changed_by`, `mode_reason` (AI-03 tablosu); Gelen Kutusu sorguları ucuz kalsın diye `threads.ai_mode text null` (`'ai' | 'human' | 'paused'`, AI hiç devreye girmediyse null) + indeks `(license_id, active, ai_mode)`; `ai_handoff_settings.assignment_mode ('ai_first' | 'parallel')`, `ai_stall_timeout_seconds` (varsayılan 60).
  - Kontrat: `POST /chats/{chatId}/return-to-ai { note?, resume: 'continue' | 'fresh' }`; isteğe bağlı `POST /chats/{chatId}/pause-ai`; `Thread` şemasına `ai_mode`.
  - RTM: yeni push `chat_ai_mode_changed { chat_id, thread_id, ai_mode, by, reason }` (ADR-15 zarfı).
  - Servis: `AiResponder` girişinde mod kapısı; `chat-service.start`'a atama modu; `sendEvent` içinde ajan mesajında örtük devralma; `takeover` ve devir servisinde `human`'a geçiş; `return-to-ai` işleyicisi; `apps/api/src/services/scheduler/jobs.ts`'e "takılan AI sohbeti" bekçi işi.
  - Rapor ve faturalama: ADR-09 yüklemi tek yardımcı fonksiyonda toplanır; `ai_solved` görünümü, Reports "Automated" ve kullanım sayacı onu kullanır (sahip kararına bağlı, aşağıda).
  - Web: rozet, butonlar, `useInbox` mutasyonları, RTM işleyicisi.
  - Test: entegrasyon (devirden sonra sıfır model çağrısı, örtük devralma yarışı, yetkisiz geri verme, bayraklı geri verme, bekçi), e2e (ajan devralır, geri verir).
- **Kodlama mantığı:**
  1. **Durum makinesi (bağlantı başına):** `ai` → (AI devri | ajan mesajı | takeover | AI kapalı/tavan) → `human`. `human` → (yetkili kullanıcı "AI'a geri ver", bayrak engeli yoksa) → `ai`. `ai` → (gözetmen "duraklat") → `paused` (AI susar, yönlendirme olmaz; isteğe bağlı).
  2. **Kapı:** `AiResponder.handle` en başta modu okur (birincil anahtar ya da `threads.ai_mode`); `ai` değilse model çağrısı yapılmaz, maliyet oluşmaz. Kural botu sırası (`customer.ts:386-388`) korunur; kural botu sohbeti devralırsa (`tookOver`) mod `human` olur.
  3. **"Önce AI" başlangıcı:** AI ajanı etkin ve kanal/marka için AI açıkken `chat-service.start` thread'i atamasız, kuyruğa almadan (`queue_position=null`) ve `ai_mode='ai'` ile açar. Bu sohbetler "atanmamış" ve "kuyrukta" görünümlerine girmez, `ai` görünümüne girer (yüklem `ai_mode`'a dayanır). Ajan eşzamanlı sohbet sınırı tüketilmez. Yönlendirme devir anında AI-12 hedefiyle çağrılır.
  4. **Örtük devralma:** `ai_mode='ai'` bir thread'e ajan principal'ı `recipients='all'` mesaj yazarsa aynı transaction içinde mod `human` olur, `ai_conversations.version` artar. Aynı anda yürüyen AI turu iyimser kilit yüzünden yazamaz ve taslağını göndermez (AI-01 madde 6).
  5. **Bekçi:** "önce AI" modu insan güvenlik ağını kaldırır. Oyuncu mesajından sonra `ai_stall_timeout_seconds` içinde bot olayı ya da devir yoksa (çökmüş işçi, kaybolan iş — GV-02) zamanlanmış iş sohbeti `ai_failure` nedeniyle insana yönlendirir.
  6. **AI'a geri ver:** yetki RL-02 (varsayılan: sohbetin sahibi ajan ve EL/Y/K). `signals.risk_flags` içinde sorumlu oyun, kendine zarar ya da reşit olmayan varsa 409 `ai_return_blocked`. `resume='continue'` prosedür ve slotları korur; `fresh` aktif prosedürü kapatır (slotlar özette kalır). Ajan notu bağlama sistem notu olarak girer. "Önce AI" modunda thread atamadan çıkarılır, geri veren ajan otomatik gözetmen olur (mevcut `chat_supervisions`), böylece sohbeti izlemeye devam eder.
  7. **Paralel mod (bugünkü davranış):** yönlendirme başta atar; AI ilk ajan mesajına kadar konuşur, sonra `human`.
  8. **ADR-09 (sahip kararı, AI-11 soru 4):** öneri yüklem "kapanışta ajan olayı yok VE bu thread için `ai_handoffs` satırı yok". Değişiklik tek yardımcıda yapılır ve faturalama sayacı, `ai_solved` görünümü ve Reports "Automated" aynı anda geçer; aksi halde sayılar birbirini tutmaz (`chat-service.ts:2409-2413` yorumundaki uyarı).
  9. **Kayıt:** her mod değişikliği ID-08 olayı + RTM push + sistem olayı (`recipients='agents'`).
- **Kabul kriterleri:**
  - Devirden sonra oyuncunun her mesajı sıfır model çağrısı ve sıfır bot mesajı üretir (mock çağrı sayacı).
  - AI turu sürerken ajan mesaj yazarsa mod `human` olur ve AI taslağı gönderilmez (yarış testi).
  - Başkasının sohbetini Ekip Üyesi geri veremez (403); sorumlu oyun bayraklı sohbet geri verilemez (409).
  - "Önce AI" modunda sohbet devre kadar hiçbir ajana atanmaz; bekçi takılan sohbeti süresinde insana yönlendirir.
  - Mod değişikliği RTM ile Gelen Kutusu rozetini anında günceller.
  - Sahip kararı kabul edilirse devredilmiş thread'ler `ai_solved`'da ve faturalama sayacında yer almaz.
- **Riskler / notlar:**
  - "Önce AI" insan güvenlik ağını kaldırır; bekçi ve GV-02 pilottan önce şarttır.
  - ADR-08 (yönlendirme zamanı) ve ADR-09 (faturalama yüklemi) değişiklikleri PLAN.md'de ADR eki olarak kayda geçmelidir.
  - Rapor tanımları (ilk yanıt süresi, kuyruk süresi) "önce AI" modunda yeniden düşünülmelidir: kuyruk süresi devir anından başlar.

### AI-12 — Devir hedefi ve öncelik
- **Alan (panelde nerede, kim kullanır):** AI Agent › Devir ve Yönlendirme: "Konu → ekip eşlemesi" (AU-01 ile ortak tablo ve ekran), "Devir nedeni → ekip" (kilitli G kuralları için), "Öncelik kuralları", "Mesai dışı davranışı" — Kurucu/Yönetici. Prosedür düzenleyicide hedef ekip açılır listesi (AI-03). Gelen Kutusu'nda öncelik rozeti ve sıralaması; acil sohbette Ekip Liderine bildirim.
- **Mevcut kod karşılığı:**
  - `packages/ai-mock/src/steps.ts:52-55` `TransferToTeamStep { group: string }` (ad, serbest metin); `apps/api/src/services/ai/ai-responder.ts:174-199` adla arama, bulunamazsa log.
  - `apps/api/src/services/chat/chat-service.ts:1371-1460` `transfer`; `:1395-1412` grupta kabul eden ajan yoksa `group_offline` hatası; `:1416-1417` grup aktarımında atama kalkar.
  - `apps/api/prisma/schema.prisma:698-711` `Group` (amaç/konu alanı yok); `:739` `Expertise`, `:759` `AgentExpertise` (uzmanlık tabanlı yönlendirme); `:821-823` `threads.queue_position/queued_at`; `:2746-2761` ajan başına `WorkSchedule` (ekip düzeyinde çalışma saati modeli yok).
  - `apps/api/src/services/routing/routing-service.ts` (ADR-08; kurallar ve fallback). Ticket açma: `apps/api/src/services/tickets/ticket-service.ts:352` `createFromWidget`.
- **Eklenecek / değişecek yerler:**
  - Adım şeması: `handoff`/`transfer_to_team` hedefi `group_id` olur. Migration genişlet → taşı: çözücü önce id'ye, yoksa ada bakar; geri doldurma işi adları id'ye çevirir; arayüz yalnız id yazar.
  - Prisma: `handoff_routes` (AU-01 ile ortak: id, license_id, brand_id null, match_type `'topic' | 'reason'`, match_key (`finance, kyc_risk, bonus, responsible_gaming, technical, complaints, trading, general` ya da neden kodu), group_id, required_expertise_id null, default_priority, active) + RLS. `threads.priority text default 'normal'` (`'urgent' | 'high' | 'normal'`) + `priority_reason`.
  - Kontrat: `/handoff-routes` CRUD (AU-01 ile aynı kaynak); `Thread.priority`; sohbet listesi önceliğe göre sıralama/süzme; aktarım ucuna yalnız bot principal'ı için `queue_if_offline: true`.
  - Servis: `conversation/handoff/target-resolver.ts`; `routing-service`'te kuyruk sıralaması; `chat-service.transfer`'da çevrimdışı grupta hata yerine kuyruğa alma seçeneği; mesai dışı akışı.
  - Web: `HandoffRoutes.tsx`; `SkillEditor.tsx`'te ekip seçici; Gelen Kutusu öncelik rozeti; AI-15 kurulumunda ekip önerisi.
  - Test: entegrasyon (ekip adı değişimi, çevrimdışı ekip, G3 acil, uzmanlık şartı, kuyruk sırası, eski ad tabanlı adımın taşınması).
- **Kodlama mantığı:**
  1. **Hedef çözme sırası:** (1) prosedür adımının açık hedefi → (2) neden rotası (G1/G2/G3 → `responsible_gaming`; G5 → ayara göre `kyc_risk` ya da `responsible_gaming`; G13 → `kyc_risk`; G15 → `complaints`) → (3) prosedürün konu anahtarına göre konu rotası → (4) aynı gün önceki devrin ekibi (AI-02 `repeat_same_day`) → (5) yönlendirme fallback grubu → (6) varsayılan gruplar. Her adımda grubun var olduğu doğrulanır, yoksa sonrakine geçilir ve kayda düşer.
  2. **Uzmanlık şartı:** rota `required_expertise_id` taşıyorsa (ör. "Sorumlu Oyun eğitimli") grup içi atama yalnız o uzmanlığa sahip ajanlara yapılır. Kabul eden yoksa sohbet o grupta acil öncelikle kuyrukta bekler ve grubun Ekip Liderlerine bildirim gider (RL-03); eğitimsiz ajana düşmez (uyum).
  3. **Öncelik:** `urgent` = G3 kendine zarar, G5 reşit olmayan, G1 self-exclusion; `high` = `repeat_same_day`, `angry`; `normal` = diğerleri. Kuyruk sırası `priority DESC, queued_at ASC`. Bu, ADR-08'in yalnız "kuyruk" adımına eklenir; ajan seçme sırası değişmez.
  4. **Mesai dışı:** hedef grupta şu an kabul eden ajan yoksa aktarım hata vermez, sohbet grubun kuyruğuna girer (`queue_if_offline`). Kiracının mesai dışı metni gönderilir ("Ekibimiz {açılış} itibarıyla dönecek"). `{açılış}` F1'de kiracının yazdığı metindir; grup üyelerinin `WorkSchedule`'larından hesaplama P2. Oyuncu e-posta verdiyse ya da vermek isterse `createFromWidget` ile ticket açılır (HD-01/WG-08 ile uyumlu). G3'te kriz metni her koşulda önce gönderilir (AI-08).
  5. **Olay:** transfer sistem olayına `reason: 'ai_handoff'`, `handoff_id`, `priority`, `reason_codes` eklenir; AI-10 kartı `target_group_id` ve `priority`'yi taşır.
  6. **İdempotentlik:** bir bağlantıda mod geçişi başına tek devir; ikinci tetik var olan devire neden ekler.
  7. **AU-01 ile ilişki:** eşleme tablosu tektir; hangisi önce yapılırsa tabloyu o kurar, diğeri kullanır. Pre-chat konu seçimi (WG-04) aynı konu anahtarlarını kullanır.
  8. **iGaming ekip önerisi:** kiracının sektörü `gaming_gambling` ise (`organizations.sector`, `packages/types/src/company.ts:30`) AI-15 kurulumu 6 ekibi ve rotalarını önerir; grup yalnız açık onayla oluşturulur (keşif yan etkisiz olmalı, `kaynaklar/eksikler.md` LiveChat dersleri).
- **Kabul kriterleri:**
  - Ekip yeniden adlandırılınca devir çalışmaya devam eder (id tabanlı).
  - Ekipte çevrimiçi ajan yokken devir hata vermez; sohbet kuyruğa girer ve mesai dışı metni gönderilir.
  - G3 ifadesi → kriz metni + acil öncelik + sorumlu oyun ekibi.
  - Uzmanlık şartlı rotada uzmanlığı olmayan ajana atama yapılmaz.
  - Kuyrukta acil sohbet normal sohbetlerin önüne geçer.
  - Ad tabanlı eski adım id'ye taşınır; geçersiz hedefte fallback grubu kullanılır ve kayda düşer.
- **Riskler / notlar:**
  - ADR-08'e kuyruk önceliği eki gerekir.
  - Sorumlu Oyun ekibinin 7/24 bulunmaması operasyonel bir uyum açığıdır; ürün bunu yalnız görünür kılar (bildirim, rapor).
  - Ekip düzeyinde çalışma saati modeli yok; "açılış saati" hesaplaması ayrı bir iş (P2).

### AI-13 — Yapılandırılmış bilgi tabloları
- **Alan (panelde nerede, kim kullanır):** AI Agent › Bilgi › yeni alt sekme "Tablolar": Ödeme Yöntemleri, Bonuslar, KYC Belgeleri, Limitler ve Kurallar. Tablo görünümü + yan panelde form, CSV içe/dışa aktarma, "son gözden geçirme" kolonu ve "Gözden geçirdim" butonu. Kurucu/Yönetici yayınlar, Ekip Lideri taslak hazırlar, Ekip Üyesi okur (Copilot da aynı veriyi kullanır).
- **Mevcut kod karşılığı:**
  - Kaynak tipleri yalnız metin: `packages/types/src/domain.ts:190` (`website, file, article, faq`), `apps/api/src/routes/playbook.ts:99`.
  - Yeniden kullanılabilir CSV altyapısı: `apps/api/src/services/ai/knowledge-bulk-row.ts`, `knowledge-bulk-crawl.ts`; web `apps/web/src/features/playbook/BulkImportForm.tsx`, `BulkImportResults.tsx`, `bulk-template.ts`.
  - Çalışma saati JSON biçimi örneği: `WorkSchedule.schedule` (`apps/api/prisma/schema.prisma:2746-2761`). Marka: `Brand` (`schema.prisma:1966-1990`). Parça ve embedding: `KnowledgeChunk` (`schema.prisma:1782-1804`).
  - Zamanlanmış işler: `apps/api/src/services/scheduler/jobs.ts`; benzer tazelik taraması `services/ai/knowledge-refresh-sweep.ts`.
- **Eklenecek / değişecek yerler:**
  - Prisma (hepsi RLS'li, `brand_ids uuid[]` boşsa tüm markalar, `owner_id`, `reviewed_at`, `review_interval_days`, `status` (AI-20), `source 'manual' | 'integration'` (F2 için), oluşturan/güncelleyen/zaman):
    - `kb_payment_methods`: name, aliases text[], direction `'deposit' | 'withdrawal'`, currency, min_amount, max_amount, expected_minutes, delay_threshold_minutes, working_hours jsonb (haftalık pencereler + saat dilimi + "banka tatilinde çalışmaz"), requires_site_request, reference_instructions, reference_format (sabit biçim listesinden), receipt_required, third_party_allowed, networks text[] (kripto), common_errors jsonb `[{code, title, customer_text, agent_hint}]`, customer_notes, active.
    - `kb_bonuses`: name, aliases, type, min_deposit, wagering_multiplier, wagering_base `'bonus' | 'bonus_plus_deposit'`, contributing jsonb `[{category, percent}]`, min_odds, max_bet, max_cashout, validity_days, claim_method `'auto' | 'live_support' | 'code'`, promo_code, excluded_method_ids uuid[], active_from, active_to, terms_text.
    - `kb_kyc_documents`: doc_type, acceptance_criteria text[], when_required, review_hours, upload_path_text, chat_upload_allowed.
    - `kb_rules`: key, category `'limits' | 'account' | 'betting' | 'withdrawal' | 'other'`, title, value_text, numeric_value, unit, description.
  - `packages/types/src/knowledge-tables.ts`: satır tipleri, doğrulayıcılar, `renderRowText(row)` (TR).
  - Kontrat: `/knowledge-tables/payment-methods`, `/bonuses`, `/kyc-documents`, `/rules` için CRUD + `/import` (CSV) + `/export`; `POST /knowledge-tables/{table}/{id}/review`.
  - Servis: `apps/api/src/services/knowledge-tables/` (CRUD, metne çevirme, yeniden indeksleme), `conversation/facts.ts` (arama ve yardımcı hesaplar).
  - Zamanlanmış iş: günlük "eskimiş satır" taraması → panel rozeti + Kurucu/Yönetici bildirimi.
  - Web: `features/playbook/tables/` altında dört sekme.
  - Test: birim (doğrulayıcı, `facts` hesapları, saat dilimi), entegrasyon (marka süzgeci, CSV, yeniden indeksleme), e2e (satır ekle → AI cevabında kullan).
- **Kodlama mantığı:**
  1. **Gerçek çözücü (`facts.ts`):** `yontem` slotu (AI-04) marka, yön ve `active` süzgeciyle satıra çözülür → `method`. Deterministik yardımcılar: `elapsed_minutes(islem_zamani)` (saat dilimi ID-04'ün kiracı ayarından; o gelene kadar Europe/Istanbul. `organizations.timezone` varsayılanı UTC olduğu için ayarlanmamışsa doğrudan kullanılmamalı), `is_delayed = elapsed > delay_threshold`, `within_working_hours(method, t)`, `next_window(method, t)`, `amount_in_range`. AI-03 koşulları ve kalıp değişkenleri (`{beklenen_süre}` = insan okunur süre) bunları kullanır.
  2. **Çevrim örneği:** yalnız genel örnek hesap (gerekli çevrim = taban × kat), oyuncunun verdiği varsayımsal tutarla; "kalan çevriminiz" asla söylenmez (görülemez, araştırma §3 madde 6).
  3. **Arama:** yayındaki her satır `renderRowText` ile metne çevrilir ve `type='table_row'`, `source_table`, `source_row_id` alanlı bir bilgi kaynağı olarak indekslenir (AI-14). Satır değişince yeniden indekslenir, silinince kaynak silinir.
  4. **Kesin cevap yolu:** AI-06 madde 3: soru bir tablo varlığı + özelliğiyle eşleşirse cevap satırdan kalıpla verilir.
  5. **Marka önceliği:** aynı ad + yön için hem "tüm markalar" hem markaya özel satır varsa markaya özel kazanır.
  6. **Doğrulama:** `min ≤ max`; `delay_threshold ≥ expected`; geçerli çalışma saatleri; marka + yön içinde benzersiz takma adlar. `reference_format` serbest regex değil sabit biçim listesinden seçilir (kiracı regex'i ReDoS riski taşır); serbest regex gerekirse uzunluk sınırı + güvenli regex motoru.
  7. **Eskime:** `reviewed_at + review_interval_days < now` → `stale`. AI kullanmaya devam eder (kiracı ayarı "eskimiş satırı kullanma" varsayılan kapalı), panelde uyarı ve bildirim çıkar. Varsayılan süreler: ödeme 14, bonus 30 (ve `active_to`'da), KYC/kurallar 90 gün (04, AI-13 soru 2).
  8. **CSV:** mevcut toplu içe aktarma UX'i (önizleme, satır bazlı sonuç); geçersiz satır atlanır, geçerliler alınır.
  9. **Güvenlik:** RLS lisans düzeyinde; marka süzgeci sorguda (sohbetin markası AI-14'te çözülür).
- **Kabul kriterleri:**
  - Papara satırı (beklenen 30 dk, eşik 60 dk) eklendiğinde yatırım akışı 95 dakikalık işlemde "eşik aşıldı" dalına gider; 20 dakikalıkta bekleme kalıbını gönderir.
  - "Papara ile en az ne kadar yatırabilirim?" → satırdaki değer birebir.
  - B markasının sohbeti A'ya özel satırı görmez.
  - Süresi dolan satır işaretlenir ve bildirim gider.
  - Geçersiz satırlı CSV'de geçerli satırlar alınır, hatalar satır bazında gösterilir.
  - Mesai dışı yapılan EFT için `within_working_hours=false` ve "sonraki işlem penceresi" kalıbı (araştırma §3.1 Kalıp B).
- **Riskler / notlar:**
  - Verinin kalitesi kiracıya bağlıdır; şablonlarla (AI-15) gelen örnek satırlar "örnek — doğrulayın" diye işaretlenmeli ve yayın onayı istemelidir.
  - Sabit şema bazı operatörlerin özel alanlarını karşılamayabilir (04, AI-13 soru 1); `customer_notes` serbest alanı ara çözümdür.
  - F2'de entegrasyon aynı tabloları dolduracaksa `source='integration'` satırları elle düzenlenemez olmalıdır.

### AI-14 — Tek bilgi deposu
- **Alan (panelde nerede, kim kullanır):** AI Agent › Bilgi: kaynaklar ve tabloların tek listesi; süzgeçler "Kim kullanır" (AI Agent / Copilot), marka, dil, sahip, "gözden geçirme gerekli". Ekip › AI temsilciler › Copilot bilgisi (`apps/web/src/features/team/CopilotKnowledge.tsx`) aynı listenin "Copilot" süzgeçli görünümüne bağlanır. Genel Bilgi Bankası makale düzenleyicisinde "AI Agent ve Copilot da kullansın" anahtarı. Kurucu/Yönetici, Ekip Lideri (taslak).
- **Mevcut kod karşılığı:**
  - `apps/api/prisma/schema.prisma:1739-1772` `KnowledgeSource` (`ai_agent_id` zorunlu; marka, dil, sahip, gözden geçirme yok); `:1782-1804` `KnowledgeChunk`.
  - Copilot ayrı bir `AiAgent` (`kind: 'copilot'`) üzerinden: `apps/api/src/services/ai/copilot-service.ts:44, 97-117`; skill_runs çapası için ayrıca bir copilot skill'i (`:119-140`).
  - Uçlar: `/knowledge-sources` (`apps/api/src/routes/playbook.ts:645-1380`), `/copilot/knowledge` (`apps/api/src/routes/copilot.ts:208-260`).
  - Arama süzgeci: `apps/api/src/services/ai/knowledge-service.ts:374-382` (`s.ai_agent_id = …`).
  - Genel Bilgi Bankası: `KbArticle` (`schema.prisma:2684-2707`), `apps/api/src/routes/kb.ts:196-352`; AI aramasına bağlı değil.
  - Marka bağlamı: `apps/api/src/lib/tenant.ts:19-29, 90-92` (`app.current_brand`); `chats` tablosunda marka kolonu yok (`schema.prisma:781-812`).
  - Kilitli karar: Q6 "ayrı" (`HANDOFF.md:2336`, `:2436`).
- **Eklenecek / değişecek yerler:**
  - Prisma (üç sürümde, CONVENTIONS §6.3):
    1. Genişlet: `knowledge_sources`'a `audiences text[] not null default '{ai_agent,copilot}'`, `ai_agent_ids uuid[] default '{}'` (boş = tüm AI ajanları), `brand_ids uuid[] default '{}'`, `language text`, `owner_id uuid`, `reviewed_at`, `review_interval_days int default 90`, `valid_until`, `kb_article_id uuid unique null`, `source_table text`, `source_row_id uuid` (AI-13), `status text default 'published'` (AI-20). GIN indeksleri `audiences`, `brand_ids` (her biri ayrı `CONCURRENTLY` migration'ı).
    2. Taşı: Copilot ajanına bağlı kaynaklar `audiences='{copilot}'`, diğerleri `'{ai_agent,copilot}'` ve `ai_agent_ids='{<eski ai_agent_id>}'` olarak doldurulur; kod yeni alanları okur, eskiye de yazar.
    3. Daralt (sonraki sürüm): `ai_agent_id` nullable olur ve okunmaz.
  - `chats.brand_id uuid null` (sohbet açılırken widget'ın web sitesi/kanalından çözülür, `Website.brandId`): marka süzgeci için ön koşul.
  - Kontrat: `KnowledgeSource` yeni alanlar; `GET /knowledge-sources?audience=&brand_id=&stale=&owner_id=`; `/copilot/knowledge` geriye uyumlu takma ad (= `audience=copilot`, kullanımdan kalkacak notuyla); `KbArticle`'a `ai_audiences`; `POST /knowledge-sources/{id}/review`.
  - Servis: `knowledge-service.search` süzgeci; `copilot-service` arama süzgeci; KB yayınlama kancası (makale → bağlı kaynak, yeniden indeksleme; yayından kaldırınca `status='draft'`); tazelik taraması (AI-13 ile ortak iş).
  - Web: birleşik liste, kitle çipleri, marka çoklu seçimi, sahip seçimi, gözden geçirme rozeti; Copilot sayfası süzgeçli görünüm; KB düzenleyicide anahtar.
  - Test: entegrasyon (yalnız Copilot kaynağı AI cevabında asla çıkmaz; marka süzgeci; KB makalesi yayın/kaldırma; eski uç aynı veriyi döner; migration sonrası mevcut kaynaklar çalışır).
- **Kodlama mantığı:**
  1. **Kitle anlamı (LiveChat "For internal use only" ile aynı):** AI Agent yalnız `audiences` içinde `ai_agent` olan kaynakları kullanır. Copilot `ai_agent` ∪ `copilot` olanların hepsini kullanır (ajan her şeyi görebilir). "Yalnız ajanlar için" = `{copilot}`.
  2. **Genel Bilgi Bankası tek yönlü akar:** yayınlanan makale, `ai_audiences` doluysa bağlı bir kaynak olarak depoya girer. Depodaki bir kaynağı herkese açık KB'ye yayınlamak bu maddenin kapsamında değildir (KB'nin kendi editörü var).
  3. **Arama süzgeci (tek SQL koşulu):** `s.audiences @> '{ai_agent}' AND (cardinality(s.ai_agent_ids)=0 OR :agent = ANY(s.ai_agent_ids)) AND (cardinality(s.brand_ids)=0 OR :brand = ANY(s.brand_ids)) AND s.status='published' AND (s.valid_until IS NULL OR s.valid_until > now())`. Sohbetin markası bilinmiyorsa yalnız "tüm markalar" kaynakları.
  4. **Plan ölçümü:** `KnowledgeChunk` notu (`schema.prisma:1774-1781`) yaklaşık HNSW aramasının süzgeçlerle satır kaçırabileceğini söylüyor; süzgeç eklendikten sonra tm 254'teki ölçüm yeniden yapılmalı, gerekirse süzgeç kolonları `knowledge_chunks`'a denormalize edilmeli.
  5. **Benzer kaynak uyarısı (isteğe bağlı):** yeni kaynağın embedding'i mevcut bir kaynağa 0.95 üzeri benzerse "benzer kaynak var" uyarısı (engellemez).
  6. **RLS:** lisans düzeyinde kalır; marka süzgeci sorgu düzeyindedir (bir kaynak birden çok markaya ait olabilir).
  7. **Copilot ajan kaydı:** skill_runs çapası için kalır (`copilot-service.ts:119-140`); yalnız bilgi bağı ondan kopar.
- **Kabul kriterleri:**
  - `{ai_agent, copilot}` kitleli tek kaynak hem AI cevabında hem Copilot taslağında bulunur; `{copilot}` kaynağı AI'ın oyuncu cevabında hiçbir zaman kullanılmaz.
  - A markasına özel kaynak B markasının sohbetinde kullanılmaz.
  - Yayınlanan KB makalesi AI ve Copilot aramasında bulunur, yayından kaldırılınca bulunmaz.
  - `/copilot/knowledge` migration öncesi ve sonrası aynı öğeleri döner.
  - Migration sonrası mevcut bütün kaynaklar yeniden embedding gerekmeden çalışır.
- **Riskler / notlar:**
  - Kilitli karar Q6'yı değiştirir; sahip onayı (04, AI-14 soru 1) olmadan başlanmamalı.
  - Süzgeçli vektör aramasında satır kaçırma riski (madde 4).
  - `chats.brand_id` ön koşulu başka maddelerle (ID, WG) çakışabilir; tek yerde tanımlanmalı.

### AI-15 — iGaming hazır prosedür şablonları
- **Alan (panelde nerede, kim kullanır):** AI Agent › Prosedürler › Şablon galerisi (`apps/web/src/features/playbook/TemplateGallery.tsx`) yeni "iGaming" kategorisiyle (iGaming kiracılarında ilk sırada); şablon ayrıntı paneli, önizleme ve "Kur" butonu. Onboarding sihirbazında (`apps/web/src/features/onboarding/OnboardingWizard.tsx`) sektör `gaming_gambling` seçilince "Önerilen kurulum" (20 prosedür taslağı, 6 ekip önerisi, varsayılan davranış kuralları, örnek tablo satırları). Kurucu/Yönetici kurar; Ekip Lideri görür ve test eder.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/playbook/templates.ts:20` kategoriler `prebuilt | ai | trending`; `:61-75` `SkillTemplate` tipi; `:88-692` 33 e-ticaret/SaaS şablonu; `templates-tr.ts` Türkçe metinler; `templates.test.ts` değişmezleri.
  - Karar: şablon kavramı kontrata girmez, katalog yereldir (`.taskmaster/tasks/task_098.md:28`).
  - Sektör: `organizations.sector` (`apps/api/prisma/schema.prisma` Organization), değer listesi `packages/types/src/company.ts:20-32` (`gaming_gambling` mevcut).
  - Örnek veri altyapısı: `apps/api/src/services/onboarding/onboarding-service.ts`.
- **Eklenecek / değişecek yerler:**
  - Yeni paket `packages/ai-templates` (ya da `packages/types/src/ai-templates/`): `IGAMING_TEMPLATES_TR`, her biri AI-03 prosedür biçiminde tam tanım + slotlar (AI-04) + kalıplar + devir (konu ve neden anahtarlarıyla, grup id'siyle değil) + varsayılan davranış kuralları (AI-07) + yasak ifadeler (AI-08) + test senaryoları (AI-19 tohumları) + `locked` + `tenant_must_fill` listesi + `version`.
  - Şablon anahtarları (20): `deposit_not_credited, withdrawal_pending, withdrawal_rejected, kyc_documents, bonus_claim, wagering_rules, bet_settlement_dispute, game_technical_issue, login_password, account_locked, self_exclusion (kilitli), responsible_gaming_signal (kilitli), limit_change, payment_methods_info, wrong_account_or_network, promotion_info, account_details_change, complaint_formal, site_access, multi_account_third_party`. (G3 kendine zarar ve G5 reşit olmayan, prosedür değil AI-08 korumasıdır.)
  - Kontrat: `GET /ai-templates?industry=igaming&lang=tr`, `GET /ai-templates/{key}`, `POST /ai-templates/{key}/install { ai_agent_id, brand_ids?, route_mapping?: { topic_key: group_id } }`, `POST /ai-templates/packs/{pack}/install` (`igaming_core`: 20 şablon + kurallar + örnek tablo satırları; ekipler yalnız `create_groups: true` ile). Yanıt `tenant_must_fill` kontrol listesini döner.
  - Prisma: yeni tablo yok; `skills.template_key`, `skills.template_version` (AI-03).
  - Servis: `apps/api/src/services/ai-templates/install.ts` (idempotent).
  - Web: galeri API'den ya da paketten okur; kurulum diyaloğunda ekip eşleme; "Kiracının doldurması gerekenler" paneli; "Şablonun yeni sürümü var" rozeti (fark görünümü P2).
  - Test: her şablon AI-03 doğrulayıcısından geçer (`templates.test.ts` değişmezlerinin karşılığı); her şablonun en az 3 senaryosu mock ile AI-19 düzeneğinde geçer; kurulum idempotentliği; kilitli şablonu kapatma 409.
- **Kodlama mantığı:**
  1. **İçerik kaynağı:** araştırmanın 20 maddelik kataloğu (`kaynaklar/igaming-ai-arastirma.md` §3) ve yatırım için tam örnek (§3.1: slot tablosu, akış adımları 1–8, kalıplar A–D ve devir, yasak yanıtlar, kart örneği, pasif `deposit_lookup` araç yuvası). Metinler "siz" hitabıyla, "genellikle / politikamıza göre" çekinceleriyle, sözsüz yazılır; yasal metinler `verbatim`.
  2. **Kilitli şablonlar:** `self_exclusion` ve `responsible_gaming_signal` `locked=true`: kiracı yalnız metinlerin üslubunu düzenleyebilir (çıkış denetimi yine geçerli), kapatamaz (409 `template_locked`). Bunlar ayrıca AI-08 giriş taramasıyla da tetiklenir, yani AI-05'in seçimine bağımlı değildir.
  3. **Kurulum:** kopya oluşturur, canlı referans değil; `status='draft'` (AI-20). Konu anahtarları `handoff_routes`'a (AI-12) eşlenir; eşlenmemiş anahtar varsa kurulum yine yapılır ama yayın engellenir. Aynı `template_key` zaten kuruluysa var olanı döner (`force_copy` hariç).
  4. **Kiracının doldurması gerekenler:** kalıplardaki `{şikâyet_süresi}`, `{adr_kurumu}`, `{kriz_hattı}` gibi yer tutucular ve örnek tablo satırları "örnek — doğrulayın" işaretlidir. Çözülmemiş yer tutucu varken yayın 400 `template_unfilled` döner.
  5. **Sürümleme:** platform şablonu güncelleyince `version` artar; kiracı kopyaları kendiliğinden değişmez (sürpriz davranış olmasın); rozet farkı gösterir.
  6. **Yan etkisiz keşif:** galeride gezinmek, önizlemek kayıt oluşturmaz; ekipler yalnız açık onayla oluşturulur (LiveChat dersi, `kaynaklar/eksikler.md` §3).
  7. **Dil:** Türkçe tam; İngilizce yalnız örnek cümleler (04, AI-15 soru 3).
  8. **task_098 ile ilişki:** katalog paylaşılan pakete taşındığı için "şablon kavramı kontrata girmez" kararı iGaming şablonları için kaldırılır; mevcut 33 e-ticaret şablonu web'de kalabilir.
- **Kabul kriterleri:**
  - 20 şablonun tamamı prosedür doğrulayıcısından geçer.
  - `deposit_not_credited` kurulumu slotları, adımları, kalıpları ve eşlenmiş ekiple taslak bir prosedür oluşturur; ikinci kurulum kopya üretmez.
  - Doldurulmamış yer tutucu varken yayın engellenir.
  - Kilitli şablonlar kapatılamaz.
  - `gaming_gambling` sektöründeki kiracıda galeri iGaming kategorisini ilk sırada gösterir.
  - Her şablonun senaryoları mock ile geçer.
- **Riskler / notlar:**
  - İçeriğin hukuki doğruluğu platformun sorumluluğunda değil; "kiracı doğrulamalı" alanlar ve yayın onayı bu yüzden zorunlu.
  - Lisans yargı bölgesine göre (Curaçao / MGA / UKGC) farklılaşan şablon varyantları P2.
  - Türkiye'deki hukuki durum (G14) `site_access` şablonunun içeriğini belirler; hukuk görüşü gelmeden şablon yalnız sabit güvenli metinle gelir.

### AI-16 — Gerçek dil modeli ve embedding'in açılması (maliyet ve kota takibi)
- **Alan (panelde nerede, kim kullanır):**
  - **Yeni bölüm:** Ayarlar › Kullanım ve kotalar › "Yapay zekâ kullanımı" (`/app/settings/ai-usage`).
    - Kurucu: görür ve uyarı alıcılarını seçer.
    - Yönetici: görür.
    - Ekip Lideri / Ekip Üyesi: varsayılan olarak göremez (RL-02 ile açılabilir).
  - **Özet:** Playbook › Performans kartlarında token ve tahmini maliyet özeti.
  - **Kota değeri:** Yalnızca SiyahTuş platform operatörü değiştirir (env, plan ya da CLI). Kiracı arayüzünde değiştirme alanı yok.
- **Mevcut kod karşılığı:**
  - **Sağlayıcı seçimi:**
    - `apps/api/src/config/env.ts:685` (`LLM_PROVIDER`, varsayılan `mock`), `:700-735` (anahtar, model, zaman aşımı, çıktı/prompt tavanı), `:746-760` (`EMBEDDING_*`).
    - `:791-793` (`RETRIEVAL_THRESHOLD`).
    - `:811-814` (günlük token tavanları).
    - Üretim kontrolleri: `:1250-1300`. Pilot modunda mock reddi: `:1376-1385`.
  - **Adaptörler ve sayaçlar:** `services/ai/provider/llm-provider.ts`, `openai-llm-provider.ts`, `openai-embedding-provider.ts`, `mock-*-provider.ts`, `services/ai/metered-llm.ts`, `metered-embeddings.ts`.
  - **Günlük tavan:** `services/ai/ai-daily-budget.ts` (rezerve et → çağır → kapat; `ai_budget_*` SECURITY DEFINER fonksiyonları, migration `20261002150000_ai_daily_usage`). Tablo `AiDailyUsage`: `schema.prisma:2259-2274`.
  - **Token kaydı:** `SkillRun` token sütunları (`schema.prisma:1702-1704`). Raporda `tokens`: `routes/reports.ts:829-869`.
  - **Yeniden gömme ve eşik:**
    - `services/ai/knowledge-reembed-run.ts` (`pnpm knowledge:reembed`), `apps/api/scripts/measure-knowledge-recall.ts`.
    - Vektör uzayı ayrımı: `KnowledgeChunk.embeddingSpace` (`schema.prisma:1794`).
  - **Diğer:** Veri yerleşimi kapısı `services/ai/inference.ts`; eklentiler `plugins/ai-budget.ts`, `plugins/ai-residency.ts`. Karar belgesi `docs/adr/pilot-llm-embedding-provider.md` (§6 araç/JSON yok, §8 fiyat koda gömülmez, §11 sahip kararları).
- **Eklenecek / değişecek yerler:**
  - **Ortam ayarları:** `env.ts` şemasına isteğe bağlı şu anahtarlar eklenir. Dört kaynakta (`.env.example`, `.env.production.example`, Helm/compose) eşit tutulmalı.
    - `LLM_MODEL_FAST` (S4)
    - `AI_PRICE_LLM_INPUT_USD_PER_MTOK`, `AI_PRICE_LLM_OUTPUT_USD_PER_MTOK`, `AI_PRICE_EMBEDDING_USD_PER_MTOK` (S3)
  - **Prisma ve migration:**
    - `licenses` tablosuna nullable `ai_daily_llm_tokens_cap`, `ai_daily_embedding_tokens_cap` (BigInt) eklenir.
    - Yeni, yalnızca eklemeye açık tablo `ai_usage_events`: `license_id`, `at`, `surface` (`ai_agent` | `copilot` | `knowledge_index` | `simulation` | `qa` | `cluster`), `meter`, `model_tier`, `input_tokens`, `output_tokens`, `chat_id?`, `config_version_id?`. RLS `license_id = siyahtus_current_license()`. İndeks `(license_id, at desc)`.
    - `ai_daily_usage.meter` alanında bir CHECK kısıtı varsa `llm_test` / `embedding_test` değerleriyle genişletilir (AI-19 S2).
  - **API:**
    - `ai-daily-budget.ts`: tavan çözümü `override ?? plan ?? env` sırasıyla yapılır.
    - `metered-llm.ts` / `metered-embeddings.ts`: kapanış (settle) anında `ai_usage_events` satırı yazılır.
    - Yeni rota `GET /ai/usage` (`routes/ai-usage.ts`, yetki `reports_read` + `minimumRole: admin`; RL-02 gelince yetenek adıyla).
    - Uyarı servisi `services/ai/ai-usage-alerts.ts`.
  - **LLM sözleşmesi:** `LlmCompletionRequest` iki alanla genişletilir: isteğe bağlı `responseFormat` (JSON şema) ve `tier: 'default' | 'fast'`. OpenAI adaptörü `response_format` gönderir. Mock sağlayıcı şemaya uygun, deterministik JSON üretir. ADR §6 güncellenir: "yapılandırılmış çıktı EVET, araç çağırma HAYIR".
  - **Kontrat:** `packages/contract/openapi/paths/` altında yeni `ai-usage.yaml` ve `openapi.yaml` içinde `$ref`. Ardından `pnpm -w contract:generate`.
  - **Tipler:** `packages/types` plan kataloğuna `aiDailyLlmTokens` ve `aiDailyEmbeddingTokens` varsayılanları eklenir.
  - **Web:** `apps/web/src/features/settings/AiUsage.tsx` + `settings-sections.ts` kaydı. `features/playbook/AiPerformance.tsx` içine token/maliyet kartı.
  - **Testler:**
    - Birim: tavan önceliği, maliyet hesabı.
    - Entegrasyon: `apps/api/test/integration/ai-usage.test.ts` (RLS: A kiracısı B'yi göremez; toplamlar `ai_daily_usage` ile eşleşir).
    - E2E: Kurucu sayfayı görür, Ekip Üyesi 403 alır.
- **Kodlama mantığı:**
  1. **Pilot geçişi (kod dışı adımlar):**
     - Anahtarlar `.env`'ye girilir; `productionProblems` boot kontrolünden geçilir.
     - Kiracılar sırayla `pnpm knowledge:reembed` ile yeniden gömülür. Eski uzaydaki parçalar `embeddingSpace` sayesinde aramaya karışmaz, ama geçiş süresince o kiracıda bilgi boşluğu oluşur. Bu yüzden bakım penceresinde yapılır.
     - `measure:knowledge-recall` ile eşik ölçülür ve `RETRIEVAL_THRESHOLD` ayarlanır.
     - AI-19'daki uyum senaryoları koşturulur.
  2. **Tavan çözümü:** `capFor(licenseId, meter)` lisans satırındaki override'ı okur. Yoksa plan varsayılanına, o da yoksa env'e düşer. Sonuç süreç içinde 60 saniye önbelleğe alınır. Tavan `ai_budget_reserve` fonksiyonuna parametre olarak geçer, kontrol ve artırma tek SQL ifadesinde kalır (bugünkü eşzamanlılık garantisi korunur).
  3. **Kullanım defteri:** `settle` başarılı olduktan sonra `ai_usage_events` satırı yazılır. Bu yazma best-effort'tur: başarısız olursa loglanır, kota yine `ai_daily_usage` üzerinden doğru çalışır. Defter yalnızca kırılım raporu içindir.
  4. **Maliyet tahmini:** Saklanmaz, okuma anında env fiyatlarıyla hesaplanır. Ekranda "güncel birim fiyatla tahmini" etiketi bulunur. Fiyat env'de yoksa para alanı hiç dönmez.
  5. **Uyarılar:** Settle sırasında kullanım %80'i ya da %100'ü ilk kez geçtiğinde bildirim gönderilir. Tekrarı önleme anahtarı `license + UTC gün + meter + eşik` (bir tabloda unique). Bildirim uygulama içi olarak ve e-postayla (`routes/notifications.ts` altyapısı) Kurucu ile seçilen alıcılara gider.
  6. **Kota dolduğunda:** Bugün mesaj sessizce insana kalıyor (`ai-responder.ts:80-90`). Buna ek olarak sohbetin zaman çizelgesine `ai.cap_reached` olayı yazılır (ID-08). Böylece ajan AI'ın neden yanıt vermediğini görür. Oyuncuya gidecek mesaj AI-09'un kararıdır.
  7. **Model katmanı:** Oyuncuya giden yanıt `default` modelle; sınıflandırma, özet, hakem ve küme başlığı `fast` modelle üretilir. `LLM_MODEL_FAST` boşsa `LLM_MODEL` kullanılır.
  8. **Gün sınırı:** Kotalar UTC gününe göre çalışır (mevcut davranış). Grafik de UTC günüyle etiketlenir ve bu ekranda açıkça belirtilir; kiracı saat dilimine (ID-04) dönüştürülmez, aksi hâlde iki rakam tutmaz.
  9. **Güvenlik:** Bu uç yalnızca sayı döndürür, içerik döndürmez. Anahtarlar mevcut redaksiyon listesinde kalır.
- **Kabul kriterleri:**
  - `PILOT_MODE=true` ile production'da `LLM_PROVIDER=mock` olan bir dağıtım açılmaz (mevcut davranış korunur).
  - Yeniden gömmeden sonra pilot kiracıların bütün `knowledge_chunks.embedding_space` değerleri `openai:<model>` olur.
  - Kurucu bugünkü kullanım yüzdesini, 30 günlük grafiği ve yüzey kırılımını görür. Ekip Üyesi uca istek atınca 403 alır.
  - X lisansına 500.000 override verildiğinde X 200.000'i aşabilir; diğer lisanslar 200.000'de durdurulur.
  - %80 eşiği aşıldığında gün ve meter başına tam olarak bir bildirim gider.
  - Fiyat env'de yoksa para alanı gösterilmez.
  - Simülasyon token'ları `llm_test` meter'ına yazılır ve canlı kotayı azaltmaz.
  - `responseFormat` verilen bir çağrıda model geçersiz JSON döndürürse bu sağlayıcı hatası sayılır ve sohbet insana kalır (mevcut hata yolu).
- **Riskler / notlar:**
  - **Kilitli kararla uzlaştırma:** `MASTER-PROMPT.md`'deki "LLM mock" kararıyla uzlaştırma ADR'de yapılmış. Koddaki varsayılan `mock` kalmalı; testler ağsız koşmaya devam etmeli.
  - **ADR güncellemesi:** JSON çıktı için ADR §6 değiştirilmeli; aksi hâlde AI-03, AI-05, AI-22 ve AI-24 bloke olur.
  - **Yeniden gömme maliyeti:** Maliyet yaklaşık toplam parça token'ı × embedding birim fiyatı kadar. Pilot için düşük, ama kiracı sayısı arttıkça planlanmalı.
  - **Tahmin ve fatura farkı:** OpenAI'ın önbellekli token indirimi ve fiyat değişiklikleri yüzünden tahmin faturayla birebir tutmaz; ekranda bu açıkça yazmalı.
  - **Veri yerleşimi:** `us` bölgesi ve KVKK konusu (S1) hukuki bir iştir; kod yalnızca bölge kapısını (`inference.ts`) uygular.
  - **Override arayüzü:** Override için bir platform yönetici arayüzü yok. İşletim prosedürü (CLI / SQL migration) yazılmalı.

### AI-17 — Gerçek web sitesi taraması (çok sayfa, sitemap, sayfa sınırı, periyodik yenileme)
- **Alan (panelde nerede, kim kullanır):**
  - **Yer:** AI Agent (Playbook) › Bilgi › Web siteleri (`/app/playbook`, "knowledge" görünümü, `features/playbook/knowledge-tabs.ts`).
  - **Roller:**
    - Kurucu / Yönetici: ekler, tarar, hariç tutar, siler.
    - Ekip Lideri: AI-20 taslağına kaynak ekleyebilir; yayın Yöneticidedir.
    - Ekip Üyesi: varsayılan olarak yalnızca görür (RL-02).
- **Mevcut kod karşılığı:**
  - **Tarayıcı:** `apps/api/src/services/ai/web-crawler.ts:32` `mockFetcher` (sahte sayfa), `:53` `crawl`, `:72` `htmlToText` (regex ile etiket temizliği; tablo yapısı kayboluyor).
  - **Rotalar:** Kaynak oluşturma `routes/playbook.ts:679-739`. Web sitesi dalı `:696-701`: `assertPublicHttpUrl` → `crawl` → içerik, hepsi istek içinde eşzamanlı. Yeniden indeksleme `:1301`. Yenileme aralığı PATCH `:1180`.
  - **Yenileme döngüsü:** `services/ai/knowledge-refresh.ts`, `knowledge-refresh-sweep.ts` (SECURITY DEFINER kiracı listeleyici; kota dolunca gece yarısına erteleme). Zamanlayıcı işi `services/scheduler/jobs.ts:246` (`knowledge_refresh`).
  - **Toplu içe aktarma:** `services/ai/knowledge-bulk-crawl.ts` (satır başına tek URL).
  - **SSRF:** `lib/ssrf.ts:47` `assertPublicHttpUrl`, `:133` `resolvePublicHttpTarget`, `:200` `pinnedConnection`. `HostResolver` enjeksiyonu (`:99`) testlerde kullanılabilir.
  - **Şema:** `KnowledgeSource` `schema.prisma:1739-1772` (`refreshAfterDays`, `nextRefreshAt`, `lastRefreshError`), `KnowledgeChunk` `:1782-1804`.
  - **Web:** `features/playbook/KnowledgeSourceActions.tsx`, `knowledge-tabs.ts`. Kontrat: `packages/contract/openapi/paths/playbook.yaml#/knowledgeSources`.
- **Eklenecek / değişecek yerler:**
  - **Tipler (`packages/types`):** `CRAWL_SCOPES = ['single','all','sitemap']`, sınır sabitleri (varsayılan sayfa 200, derinlik 3, sayfa başı 5 MB, iş başı 200 MB), `KNOWLEDGE_PAGE_STATUSES` (`ok`, `unchanged`, `skipped_scope`, `robots_disallowed`, `blocked`, `needs_js`, `error`, `removed`).
  - **Kontrat (`playbook.yaml`):**
    - Web sitesi oluşturma gövdesine `crawl_scope`, `page_limit`, `include_paths[]`, `exclude_paths[]`, `brand_id?` eklenir. Yanıt `201` + `status: 'crawling'` + `job_id` olur. Bu kırıcı bir değişiklik: bugün yanıtta parçalar dönüyor, web istemcisi de güncellenmeli.
    - Yeni uçlar: `GET /knowledge-sources/{id}/pages`, `POST /knowledge-sources/{id}/crawl`, `GET /knowledge-jobs/{id}`, `POST /knowledge-jobs/{id}/cancel`.
  - **Prisma ve migration:**
    - `knowledge_sources` tablosuna `crawl_scope`, `page_limit`, `include_paths text[]`, `exclude_paths text[]`, `brand_id?` (AI-14), `last_crawled_at`, `page_count` eklenir.
    - Yeni tablo `knowledge_pages`: `id`, `license_id`, `source_id`, `url`, `url_hash char(64)`, `title`, `lang`, `content_hash`, `status`, `http_status`, `error`, `fetched_at`, `chunk_count`. Unique `(source_id, url_hash)`.
    - `knowledge_chunks` tablosuna `page_id?` (FK, cascade) eklenir.
    - Yeni tablo `knowledge_jobs`: `id`, `license_id`, `source_id`, `kind` (`crawl` | `refresh` | `document`), `status` (`queued` | `running` | `waiting_budget` | `done` | `failed` | `cancelled`), `frontier jsonb` (devam edebilmek için), sayaçlar, `requested_by`, `started_at`, `finished_at`, `error`.
    - Hepsine RLS (`skills_tenant` kalıbı) ve indeksler eklenir.
  - **API servisleri:** `services/ai/crawler/` altında:
    - `http-fetcher.ts`: gerçek `PageFetcher`; her istek ve her yönlendirme `resolvePublicHttpTarget` + `pinnedConnection` ile yapılır.
    - `frontier.ts`: URL normalleştirme, kapsam, tekilleştirme.
    - `robots.ts`, `sitemap.ts`.
    - `extract.ts`: ana içerik, başlıklar, listeler, tablolar.
    - `services/ai/knowledge-job-runner.ts`.
  - **Ortam ayarı:** `CRAWLER_PROVIDER = mock | http`. Varsayılan `mock` (kilitli karar). `PILOT_MODE` production'da `http` zorunlu tutulur.
  - **Zamanlayıcı:**
    - Yeni iş `knowledge_jobs` (15 sn aralık, `scheduler/lock.ts` ile).
    - Mevcut `knowledge_refresh` süpürmesi taramayı kendi içinde yapmak yerine kuyruğa `refresh` işi ekler.
  - **Web:** `KnowledgeSourceActions.tsx`:
    - Ekleme modalı: URL, kapsam ("Tüm alt sayfalar / Tek sayfa / Sitemap"), sayfa sınırı, dahil/hariç yollar, yenileme (5–365 gün), marka.
    - Kaynak detay çekmecesi: ilerleme çubuğu (iş her 3 sn yoklanır), sayfa tablosu, "Yeniden tara", "Bu sayfayı hariç tut", `needs_js` / `blocked` uyarı çipleri.
  - **Testler:**
    - Birim: normalleştirme, kapsam, robots, sitemap index, tablo çıkarımı, değişiklik tespiti.
    - Entegrasyon: enjekte edilmiş resolver ve fetcher ile.
    - E2E: mock sağlayıcıyla.
- **Kodlama mantığı:**
  1. **Oluşturma:** `assertPublicHttpUrl` çalışır, kaynak `crawling` olarak yazılır ve iş kuyruğa alınır. İstek içinde hiç ağ çağrısı yapılmaz; yanıt 201 döner.
  2. **İşin alınması:** Çalıştırıcı işi `FOR UPDATE SKIP LOCKED` ile alır. Kiracı başına aynı anda 1 iş, global olarak N iş çalışır.
  3. **Başlangıç URL'leri:**
     - `single`: yalnızca kök URL.
     - `sitemap` / `all`: önce `robots.txt` okunur (24 saat önbellek) ve içindeki `Sitemap:` satırları ya da `/sitemap.xml` kullanılır. Sitemap index en fazla 2 seviye ve en fazla 50.000 URL okunur, kapsama göre süzülür.
     - Sitemap yoksa ve kapsam `all` ise kökten genişlik öncelikli tarama yapılır (derinlik ≤ 3).
  4. **Kapsam ve normalleştirme:**
     - Kapsam: aynı şema ve host (`www.` eşdeğer sayılır), kökün yol önekiyle başlama (örn. `/yardim/`), `include` / `exclude` desenleri.
     - Normalleştirme: fragment atılır; `utm_*`, `gclid`, `fbclid` silinir; parametreler sıralanır; sondaki `/` normalleştirilir.
     - Canonical etiketi kapsam içindeyse ona uyulur.
  5. **Getirme:**
     - Bot kimliğini bildiren bir User-Agent, `Accept: text/html`, 10 sn zaman aşımı, akış hâlinde 5 MB sınırı.
     - En fazla 5 yönlendirme; her adım yeniden SSRF ve kapsam kontrolünden geçer.
     - Host başına en az 500 ms aralık ve en fazla 2 eşzamanlı istek.
     - 429/503'te `Retry-After`'a uyulur (en fazla 2 deneme).
     - Bot korumasına takılan sayfa `blocked` işaretlenir.
     - Sıkıştırma bombasına karşı açma oranı sınırı uygulanır.
  6. **Metin çıkarımı:**
     - `script`, `style`, `nav`, `header`, `footer`, `aside`, `form` ve çerez bandı atılır; varsa `<main>` / `<article>` tercih edilir.
     - Başlıklar "## ", liste öğeleri "- ", tablo satırları "| a | b |" olarak korunur (bonus tabloları bozulmasın).
     - `<html lang>` okunur.
     - 200 karakterden az metin çıkan ve çok sayıda script içeren sayfa `needs_js` işaretlenir.
  7. **Değişiklik tespiti:** Metnin sha256'sı önceki `content_hash` ile aynıysa sayfa `unchanged` olur ve embedding yapılmaz (maliyet tasarrufu). Değiştiyse `knowledge.prepare` çalışır (kotaya sayılır) ve kısa bir transaction'da o sayfanın parçaları değiştirilir.
  8. **Kaldırılan sayfalar:** Yenilemede iki ardışık 404/410 alan ya da kapsamdan çıkan sayfa `removed` olur ve parçaları silinir.
  9. **Kota:** `AiDailyCapError` gelirse iş `waiting_budget` durumuna geçer ve `nextUtcMidnight`'ta devam eder (süpürmedeki mevcut davranışla aynı). O ana kadar işlenen sayfalar kullanılabilir.
  10. **Bitiş:**
      - Kaynak durumu `ready` (hata varsa `partial`) olur; `last_crawled_at`, `page_count` ve `next_refresh_at` güncellenir.
      - AI-21 kaydı (`knowledge.crawled`, sayılarla) yazılır ve kaynağı ekleyen kişiye bildirim gider.
      - AI-20'de "onaylı yenileme" açıksa yeni parçalar taslak durumunda yazılır.
  11. **Veri yerleşimi:** Embedding'den önce `inference.ts` kapısı sorulur (süpürmede olduğu gibi).
  12. **Maliyet:** Yaklaşık hesap 4 karakter ≈ 1 token. 200 sayfa × 5.000 karakter ≈ 250 bin embedding token'ı. Yenilemelerde değişmeyen sayfalar ücretsizdir.
- **Kabul kriterleri:**
  - Sitemap'inde kapsam içinde 50 URL olan bir site, sınır 200 iken taranınca 50 sayfa `ok` olur ve aranabilir hâle gelir. Kapsam dışı yollara hiç istek atılmaz.
  - Özel IP'ye çözülen ya da özel IP'ye yönlendiren URL'de bağlantı kurulmaz ve sayfa `error` olur (resolver enjeksiyonlu test).
  - `robots.txt`'nin yasakladığı sayfa getirilmez ve `robots_disallowed` olur.
  - Yenilemede yalnızca değişen sayfanın embedding'i yapılır; embedding meter'ı yalnızca o kadar artar.
  - İki kez 404 veren sayfanın parçaları silinir ve AI artık ondan alıntı yapmaz.
  - Kota iş ortasında dolarsa iş `waiting_budget`'a geçer ve gece yarısından sonra kaldığı yerden sürer.
  - Testler `CRAWLER_PROVIDER=mock` ile ağsız koşar. `PILOT_MODE` production'da mock ile açılış reddedilir.
  - Arayüz ilerlemeyi ve sayfa bazındaki hataları Türkçe gösterir.
- **Riskler / notlar:**
  - **Hukuki:** Operatörün sitesini taramak için kiracının yetkisi olmalı. Ekleme modalında "bu siteyi taramaya yetkiliyim" onayı istenir.
  - **Erişim sorunları:** Bot koruması, coğrafi engel ve sık değişen ayna domainler (G14) taramayı bozabilir. Kaynak URL'sini güncelleme akışı gerekir.
  - **Sınırlar:** JS ile çizilen siteler F1'de desteklenmez (S3).
  - **Pazarlama dili:** Promosyon sayfalarındaki "kazan" gibi ifadeler bilgiye girer. AI-08 çıktı denetimi bunları süzmelidir.
  - **HTML ayrıştırıcı seçimi:** Regex yerine bakımlı ve geri izlemesiz bir ayrıştırıcı seçmek kodlayıcıya bırakılmıştır; bağımlılığın lisansı ve CVE geçmişi kontrol edilmeli.

### AI-18 — PDF/DOCX bilgi kaynağı ve daha büyük dosya sınırı
- **Alan (panelde nerede, kim kullanır):** AI Agent (Playbook) › Bilgi › Dosyalar. Roller AI-17 ile aynı.
- **Mevcut kod karşılığı:**
  - **Ayrıştırıcı:** `apps/api/src/services/ai/knowledge-file-parse.ts`. Saf fonksiyon; `:42-46` PDF/DOCX'i bilerek reddediyor.
  - **Sınırlar:** `packages/types/src/knowledge-file.ts:31` (3 MIME türü), `:45` (`KNOWLEDGE_FILE_MAX_BYTES` = 2 MiB; base64 gövde sınırı 4 MiB, `routes/playbook.ts:200`), `:55` (100.000 karakter).
  - **Rota:** `routes/playbook.ts:761-826` (`POST /knowledge-sources/file`; base64 JSON gövde; ayrıştırma, embedding ve yazma istek içinde).
  - **Yükleme altyapısı:** `routes/uploads.ts` (nesne deposu, `assertClean` virüs taraması `:193`, kapalı başarısızlık), `services/storage/object-store.ts`, `services/storage/virus-scanner.ts`.
  - **Web:** `features/playbook/knowledge-file-upload.ts`.
- **Eklenecek / değişecek yerler:**
  - **Tipler:** `KNOWLEDGE_DOCUMENT_MIME_TYPES` (PDF, DOCX) ve ayrı sınırlar (20 MB, 300 sayfa, 1.000.000 karakter; S1). Mevcut metin dosyası yolu değişmez.
  - **Kontrat (`playbook.yaml`):**
    - `POST /knowledge-sources/document` gövdesi `{ ai_agent_id, upload_id, name?, brand_id? }`, yanıtı `201` + `status: 'processing'` + `job_id`. İşin durumu AI-17'nin `GET /knowledge-jobs/{id}` ucuyla izlenir.
    - `GET /knowledge-sources/{id}/file` kısa ömürlü imzalı indirme bağlantısı verir.
    - Hata kodları: `unsupported_type`, `file_too_large`, `encrypted`, `no_text_layer`, `too_many_pages`, `parse_timeout`, `virus_detected`.
  - **Prisma ve migration:**
    - `knowledge_sources` tablosuna `file_key`, `file_mime`, `file_size`, `file_sha256`, `page_count` eklenir.
    - `knowledge_chunks` tablosuna `page_from?`, `page_to?`, `heading?` eklenir (alıntı ve QA için).
    - `knowledge_jobs.kind = 'document'`.
  - **API:**
    - `services/ai/document-parse/` altında `worker.ts` (izole süreç), `pdf.ts`, `docx.ts`, `normalize.ts` (başlık/altbilgi temizliği, tablo satırları).
    - `services/ai/document-ingest.ts`: iş çalıştırıcısının `document` dalı.
    - Yükleme: `/uploads` rotasına `purpose: 'knowledge_document'` eklenir. Bu dosyalar herkese açık ek URL'si üzerinden **servis edilmez**; ayrı bir önek kullanılır ve okuma yalnızca API üzerinden yapılır.
  - **Web:** Dosyalar sekmesi .pdf, .docx, .txt, .md ve .csv kabul eder; sürükle-bırak, sınır ipucu, iki aşamalı ilerleme (yükleme % → işleme durumu), Türkçe hata metinleri, "Orijinali indir", sayfa sayısı ve "Yeniden işle".
  - **Testler:**
    - Küçük fixture dosyaları: tablolu PDF, başlıklı DOCX, şifreli PDF, yalnızca görüntü içeren PDF, sıkıştırma bombası DOCX, JavaScript içeren PDF, EICAR.
    - Worker zaman aşımı ve bellek sınırı.
    - Entegrasyon: iş → sayfa numaralı parçalar.
    - E2E: mock embedding ile yükleme.
- **Kodlama mantığı:**
  1. **Yükleme:** İstemci dosyayı `/uploads`'a gönderir (purpose belirtilir). Virüs taraması yapılır ve tarayıcıya ulaşılamazsa yükleme reddedilir. Dosya `licenses/{id}/knowledge/{uuid}` önekine yazılır.
  2. **Kaynak oluşturma:**
     - Tür dosya adına göre değil sihirli baytlara göre belirlenir: `%PDF-`, ya da `word/document.xml` içeren ZIP. `.docm` kabul edilmez.
     - Boyut kontrol edilir.
     - Aynı ajan altında aynı sha256 varsa 409 döner ve mevcut kaynak gösterilir.
     - Kaynak `processing` + iş olarak yazılır ve 201 döner.
  3. **Worker:** Ayrı bir süreçte çalışır: bellek sınırı yaklaşık 256 MB, süre 30 sn. Süreç ortamına sırlar geçirilmez ve geçici dizin işe özeldir.
     - **PDF:**
       - Şifreliyse reddedilir.
       - Metin katmanı sayfa sayfa çıkarılır. Sayfa başına ortalama 50 karakterin altındaysa `no_text_layer` döner.
       - Sayfaların %60'ından fazlasında tekrar eden üst ve alt bilgiler silinir.
       - PDF içindeki script'ler ve dış kaynak (font/cMap) indirmeleri kapalıdır.
     - **DOCX:**
       - ZIP açma sınırları uygulanır: en fazla 2.000 girdi, açılmış toplam 100 MB, sıkıştırma oranı en fazla 100.
       - Başlık stilleri (`Heading1…`), listeler ve tablolar ("| a | b |" satırları) korunur.
       - Görseller atlanır, makro çalıştırılmaz.
  4. **Parçalama:** Mevcut parçalayıcı (yaklaşık 600 karakter hedef) kullanılır, ama başlık sınırlarına saygı gösterir. Her parçaya `page_from`, `page_to` ve `heading` yazılır.
  5. **Embedding:** Kotaya tabidir. Kota dolarsa iş `waiting_budget` durumuna geçer (AI-17 ile aynı).
  6. **Bitiş:** Kaynak `ready` olur. AI-21 kaydı yazılır ve bildirim gider. AI'ın çalışma logunda yanıtın dayandığı sayfa numarası görünür (AI-10 ve AI-24 kanıtı).
  7. **Silme:** Kaynak silinince parçalar cascade ile silinir. Nesne commit'ten sonra silinir; başarısız olursa öksüz dosya temizleme işi tekrar dener.
- **Kabul kriterleri:**
  - 15 MB ve 120 sayfalık metin PDF'i `ready` olur. Parçalarda sayfa numarası bulunur.
  - Şifreli PDF `encrypted`, yalnızca görüntü içeren PDF `no_text_layer` hatası verir; ikisinde de Türkçe mesaj gösterilir ve bilgi bankasına hiçbir şey yazılmaz.
  - Tablolu DOCX'in satırları parçalarda "| … |" biçiminde görünür.
  - Uzantısı değiştirilmiş bir çalıştırılabilir dosya ya da `.docm` `unsupported_type` alır. EICAR test dosyası reddedilir ve hiçbir şey saklanmaz.
  - 30 sn'yi ya da 256 MB'yi aşan bir ayrıştırma `parse_timeout` ile biter ve API süreci etkilenmez.
  - Bilgi belgesine herkese açık ek URL'si üzerinden erişilemez.
  - Kaynak silindiğinde nesne deposundaki dosya da silinir.
- **Riskler / notlar:**
  - **Kodun kendi uyarısı:** Belge ayrıştırıcılarının CVE geçmişi var (`knowledge-file-parse.ts:42-46`). İzolasyon ve bağımlılık güncelliği zorunlu; bağımlılık seçimi kodlayıcıya bırakılır.
  - **Kapsam dışı:** OCR yok. Görüntü olarak gömülmüş bonus tabloları okunamaz; bu bilgiler AI-13 tablolarına girilmeli.
  - **Hukuki:** Operatör belgelerinin telif ve gizliliği kiracının sorumluluğundadır.
  - **Saklama:** Orijinal dosya bir saklama ve maliyet kalemidir (S2).

### AI-19 — Çok turlu test ve simülasyon
- **Alan (panelde nerede, kim kullanır):** AI Agent (Playbook) › **Test** (yeni sekme; `PlaybookPage.tsx:71-72` `VIEW_TABS` listesine `test` eklenir).
  - **Ekran düzeni:** Solda "Senaryolar" listesi, sağda "Oyuncu gibi konuş" sohbeti. Üstte "Tümünü koştur" ve koşu geçmişi.
  - **Roller:**
    - Kurucu / Yönetici: her şey.
    - Ekip Lideri: senaryo yazar ve koşturur (test kotasıyla).
    - Ekip Üyesi: varsayılan olarak yok. Eğitim amacıyla yalnızca "oyuncu gibi konuş" açılabilir (RL-02).
- **Mevcut kod karşılığı:**
  - **Önizleme:** `apps/api/src/routes/playbook.ts:73-77` (`previewBody`: tek `message`), `:577-603` (`POST /skills/preview`, `aiBudget: true`).
  - **Motor:** `services/ai/skill-engine.ts:304-360` (`preview`: yazma yok, `history: []`). Canlıdaki yan etkiler (mesaj, etiket, devir) `services/ai/ai-responder.ts:134-162` içinde doğrudan uygulanıyor.
  - **Web:** `features/playbook/SkillEditor.tsx:217`, `:697-721` (tek mesajlık önizleme), `ProfileForm.tsx` (persona önizlemesi).
  - **Geliştirici testi:** `apps/e2e/tests/ai-agent.spec.ts`.
  - **Not:** Ayarlar › Sandbox (`features/settings/Sandbox.tsx`, `settings.sandbox_created`) ayrı, faturalanmayan bir çalışma alanı açıyor. Bu bir simülatör değil, ama kiracı tam uçtan uca deneme için kullanabilir.
- **Eklenecek / değişecek yerler:**
  - **Motor sözleşmesi (AI-01/AI-03 ile birlikte tasarlanmalı):** Konuşma motoru saf bir "tur" fonksiyonu sunmalı:
    - İmza: `runTurn(state, message, ctx{ now, configVersionId, toolStubs, mode }) → { reply, decisions, nextState, sideEffects[] }`.
    - Yan etkiler (devir, etiket, bayrak, özet) **döndürülür, uygulanmaz**. Canlı adaptör bunları uygular; simülatör yalnızca kaydeder.
  - **Prisma ve migration:**
    - `ai_test_scenarios`: `id`, `license_id`, `ai_agent_id`, `brand_id?`, `name`, `origin` (`template` | `manual` | `generated` | `from_chat` | `from_qa`), `mode` (`scripted` | `simulated`), `persona`, `language`, `simulated_now`, `turns jsonb`, `facts jsonb`, `tool_outputs jsonb` (AI-28), `expectations jsonb`, `active`, `created_by`, `updated_at`.
    - `ai_test_runs`: `id`, `license_id`, `ai_agent_id`, `config_target` (`draft` | `published` | `version_id`), `draft_revision`, `trigger` (`manual` | `pre_publish` | `nightly`), `status`, `passed`, `failed`, `errored`, `tokens`, `started_by`, zaman damgaları.
    - `ai_test_run_results`: `run_id`, `scenario_key`, `status`, `transcript jsonb`, `checks jsonb`, `judge jsonb`, `tokens`, `duration_ms`.
    - `ai_sandbox_sessions`: `id`, `license_id`, `created_by`, `state jsonb`, `transcript jsonb`, `expires_at` (24 saat).
    - Hepsine RLS.
  - **Tipler (`packages/types`):**
    - `SCENARIO_PERSONAS` (`normal`, `sabirsiz`, `kizgin`, `eksik_bilgi`, `sorumlu_oyun_sinyali`, `resit_olmayan`, `insan_istiyor`, `yabanci_dil`).
    - Beklenti şeması (zod; web ile API ortak kullanır).
    - Platform uyum paketi `ai-compliance-scenarios.ts` (TR + EN; kilitli, veritabanına değil koda yazılır).
  - **API:** `routes/ai-testing.ts`:
    - `CRUD /ai/test-scenarios`
    - `POST /ai/test-runs` (`{ scenario_ids? , target }`), `GET /ai/test-runs/{id}`, `GET /ai/test-runs/{id}/results`
    - `POST /ai/sandbox-sessions`, `POST /ai/sandbox-sessions/{id}/turns`, `POST /ai/sandbox-sessions/{id}/save-as-scenario`
    - Servisler: `services/ai/simulation/runner.ts`, `checks.ts`, `judge.ts`, `simulated-player.ts`.
  - **Kuyruk:** Koşular kalıcı kuyrukta işlenir (GV-02; ya da `scheduler/jobs.ts` içinde `ai_test_runs` işi ve kilit).
  - **Kontrat:** Yeni `paths/ai-testing.yaml`.
  - **Web:** `features/playbook/TestLab.tsx`, `ScenarioEditor.tsx`, `RunResults.tsx` (fark görünümü), `SandboxChat.tsx` (tur başına karar izi paneliyle).
  - **Testler:** Motor turunun yan etkisiz olduğu, sahte saat, kesin kontroller, koşunun canlı tablolara dokunmadığı (negatif test), RLS, test kotası. E2E: senaryo oluştur → koştur → sonucu gör.
- **Kodlama mantığı:**
  1. **Senaryo biçimi:**
     - **Scripted:** Sabit oyuncu turları. Motor senaryoda olmayan bir şey sorarsa oyuncu "bilmiyorum" yanıtı verir.
     - **Simulated:** `fast` modelle oynayan bir oyuncu kullanılır. Girdisi persona, oyuncunun bildiği gerçekler (`facts`: `{ yöntem: 'Papara', tutar: 2500, saat: '13:42', talep_olusturuldu: true, gonderen_kendisi: true }`) ve hedeftir. Sıcaklık 0, en fazla `max_turns` tur.
     - **Beklentiler:** `outcome` (`resolved` | `handoff`), `team?`, `procedure?`, `required_slots[]`, `forbidden_phrases[]`, `must_flags[]`, `must_not_flags[]`, `max_turns`.
  2. **Koşu döngüsü:**
     - Her senaryo için bellekte boş bir konuşma durumu oluşturulur.
     - Her turda motora şunlar verilir: konfigürasyon sürümü (taslak ya da yayındaki), donmuş saat (`simulated_now` + tur × 30 sn) ve araç taklitleri.
     - Döngü motor `handoff` ya da `resolved` dediğinde, `max_turns` dolduğunda ya da oyuncu senaryosu bittiğinde durur.
  3. **Kesin kontroller:** Geç/kal kararını bunlar verir:
     - sonuç ve hedef ekip, seçilen prosedür;
     - zorunlu bilgilerin toplanması;
     - AI mesajlarında yasaklı ifade (AI-08 listesi + senaryo listesi);
     - AI mesajlarında hassas veri isteme kalıbı (AI-26 desenleri);
     - bayraklar (AI-27), tur sayısı, yanıt dili.
  4. **Hakem:** `fast` model AI-24 rubriğiyle JSON puan ve yorum verir. Yalnızca öneri niteliğindedir; durumu değiştirmez.
  5. **Regresyon:** Aynı senaryolar bir önceki yayındaki sürümün son koşusuyla karşılaştırılır.
     - Önce "geçiyordu → kalıyor" olanlar listelenir, sonra sonuç ya da ekip değişenler.
     - Yanıt metni farkı isteğe bağlı olarak gösterilir.
  6. **İzolasyon:** Simülasyon şunlara **asla** yazmaz: `chats`, `threads`, `events`, `customers`, `ratings`, `skill_runs.runs_count`, fatura sayaçları, RTM, webhook'lar. Yan etkiler yalnızca sonuç kaydına yazılır. Bunu kodda bir "simülasyon bağlamı" bayrağı ile her yazma yolunda reddetmek, negatif testle birlikte en güvenli yoldur.
  7. **Bütçe:** Token'lar `llm_test` meter'ına yazılır (AI-16). Kiracı başına aynı anda 2 senaryo çalışır, senaryo başına 60 sn sınır, koşu başına en fazla 200 senaryo.
  8. **Oyuncu gibi konuş:**
     - Aynı `runTurn` kullanılır. Durum `ai_sandbox_sessions` tablosunda tutulur.
     - Her yanıtla birlikte karar izi döner: seçilen prosedür ve nedeni, toplanan bilgiler, kullanılan bilgi parçaları (kaynak, sayfa), guardrail kontrolleri, devir nedeni, bayraklar, token.
     - "Senaryo olarak kaydet" düğmesi oyuncu turlarını scripted senaryoya çevirir; beklentiler son durumdan önerilir, kullanıcı düzenler.
  9. **Uyum paketi:** G1, G2, G3, G5, G7, G11 ve G16 için kilitli senaryolar her yayın öncesi koşuya otomatik eklenir. Kiracı bunları silemez ve düzenleyemez.
  10. **Senaryo önerisi (isteğe bağlı):** "Bu prosedür için senaryo öner" düğmesiyle `fast` model persona × bilgi varyasyonları üretir; sonuçlar taslak senaryo olarak kaydedilir.
  11. **Veri:** Senaryolar sentetik veriyle çalışır. Editörde "gerçek oyuncu verisi girmeyin" uyarısı gösterilir ve AI-26 maskelemesi senaryo metinlerine de uygulanır.
- **Kabul kriterleri:**
  - "Papara yatırım geçmedi" scripted senaryosu 4 turda yöntemi, saati, talebi ve dekontu toplar ve Finans'a devreder; kontrollerin hepsi geçer.
  - Aynı senaryo `simulated_now` yatırımdan 10 dk sonrası olarak verilirse "bekleme" kalıbıyla çözülür; 95 dk sonrası olarak verilirse devredilir.
  - Self-exclusion senaryosunda AI bonus ya da promosyon sözcüğü kullanırsa senaryo kalır ve AI-20 yayın butonu kapanır.
  - Taslak üzerinde koşu yapıldıktan sonra canlı sohbetlerde, `skill_runs` tablosunda, raporlarda ve faturada hiçbir değişiklik olmaz (negatif entegrasyon testi).
  - Regresyon ekranı "geçiyordu → kalıyor" senaryolarını en üstte gösterir.
  - "Oyuncu gibi konuş" her turda prosedürü ve kullanılan bilgi kaynağını gösterir.
  - Test token'ları canlı kotayı azaltmaz.
  - Varsayılan matriste Ekip Üyesi Test sekmesini göremez.
- **Riskler / notlar:**
  - **Tasarım sırası:** Bu maddenin değeri motorun yan etkisiz bir tur fonksiyonu sunmasına bağlı. AI-01 ve AI-03 bu sözleşmeyle tasarlanmazsa simülatör ayrı bir kopya mantık olur ve kodun kendi ilkesine aykırı düşer ("A preview running different logic would be worse than no preview", `routes/playbook.ts:584-585`).
  - **Belirsizlik:** LLM belirsizliği hakem puanlarını oynatır. Kalıcı geç/kal kararını yalnızca kesin kontroller vermelidir.
  - **CI:** CI'da mock sağlayıcıyla koşucu yine de çalışmalı (deterministik senaryolar).

### AI-20 — Taslak → test → onay → yayın (sürüm, geri alma, dört göz)
- **Alan (panelde nerede, kim kullanır):**
  - **Playbook üst çubuğu:** "Yayında: v12 · Taslak: 7 değişiklik" rozeti ve "Değişiklikleri gör / Teste gönder / Onaya gönder" düğmeleri.
  - **Yeni sekme Playbook › Sürümler:** liste, iki sürümü karşılaştırma, geri alma, zamanlama.
  - **Roller (RL-02 yetenekleriyle yapılandırılabilir):**
    - Ekip Lideri: taslağı düzenler, teste ve onaya gönderir.
    - Yönetici: onaylar, yayınlar, geri alır, AI'ı duraklatır.
    - Kurucu: Yöneticinin yapabildikleri + uyum kuralı değişikliklerinin zorunlu onaycısı.
    - Ekip Üyesi: yok.
- **Mevcut kod karşılığı:**
  - **Şema:** `Skill.active` (`apps/api/prisma/schema.prisma:1668`), `AiAgent.active` (`:1563`, "Answering / Paused"), `KnowledgeSource.status` (`:1747`). `Workflow.status` (`:1729`) ADR-14 gereği ölü.
  - **Rotalar:** Canlıya doğrudan yazan `PATCH /skills/:id` (`routes/playbook.ts:499-534`). "Skill hiçbir zaman aktif yaratılmaz" ilkesi (`playbook.ts:1-9`).
  - **Yetki:** Yalnızca admin ve üstü (`packages/types/src/role-scopes.ts:83-89`).
  - **Web:** `features/playbook/useSkillActiveToggle.ts`.
  - **Replikalar arası yayın:** `packages/types/src/realtime-bus.ts`. RTM push listesi `packages/types/src/rtm.ts:136`.
- **Eklenecek / değişecek yerler:**
  - **Önerilen model: anlık görüntü (snapshot) ve işaretçi.**
    - Bugünkü düzenleme tabloları (skills, AI-07 kuralları, AI-03 prosedürleri, AI-09/12 devir kuralları, AI-13 tabloları, `ai_agents.persona`) **taslak çalışma alanı** sayılır.
    - Çalışma anında AI yalnızca yayımlanmış ve değişmez bir paket okur.
  - **Prisma ve migration:**
    - `ai_config_versions`: `id`, `license_id`, `ai_agent_id`, `number`, `minor`, `status` (`in_review` | `approved` | `published` | `superseded` | `rejected`), `snapshot jsonb` (derlenmiş paket), `knowledge_manifest jsonb`, `diff_summary jsonb`, `draft_revision`, `test_run_id`, `touches_compliance bool`, `submitted_by/at`, `reviewed_by/at`, `review_note`, `published_by/at`, `scheduled_at?`, `rollback_of?`.
    - `ai_agents` tablosuna `published_version_id`, `draft_revision` eklenir.
    - `knowledge_chunks` tablosuna `visible_from_version int?` ve `hidden_from_version int?` eklenir; indeksi `(license_id, visible_from_version, hidden_from_version)`.
    - Geri dolum: mevcut durum v1 olarak yayımlanır ve mevcut parçalar `visible_from_version = 1` alır.
  - **API:** `routes/ai-config.ts`:
    - `GET /ai/config/draft/diff`
    - `POST /ai/config/versions` (onaya gönder)
    - `POST /ai/config/versions/{id}/approve` (`{ publish_at? }`), `/reject`, `/rollback`
    - `POST /ai/pause`, `/ai/resume`
    - `GET /ai/config/versions`, `GET /ai/config/versions/{a}/diff/{b}`
    - Servisler: `services/ai/config-compiler.ts` (taslak → paket + doğrulama), `config-cache.ts` (sürüme göre önbellek, realtime-bus ile geçersizleştirme).
  - **Zamanlayıcı:** `ai_scheduled_publish` (dakikada bir, kilitli). `knowledge_chunk_gc` (5 sürümden ve 30 günden daha eski gizli parçaları temizler).
  - **RTM:** `RTM_PUSH_ACTIONS` listesine `ai_config_published` eklenir; Inbox'ta "AI yapılandırması v13 yayında" bandı çıkar.
  - **Web:** `features/playbook/VersionBar.tsx`, `Versions.tsx`, `DiffView.tsx`. Düzenleme ekranlarında "Taslak" şeridi. Önizlemede "taslak / yayındaki" seçimi. `useSkillActiveToggle` anlamı "bu sürümde etkin" olarak değişir.
  - **Tipler:** RL-02 yetenek adları (`ai.config.edit`, `ai.config.submit`, `ai.config.publish`, `ai.config.publish_compliance`, `ai.config.rollback`, `ai.pause`) ve sürüm durum enum'u.
  - **Testler:**
    - Dört göz: aynı kişi kendi gönderdiğini onaylarsa 403.
    - Guardrail değişikliği Kurucu ister.
    - Uyum koşusu geçmeden yayın engellenir.
    - Geri alma bilgi dahil eski davranışı geri getirir.
    - Zamanlı yayın çalışır.
    - Eski `draft_revision` ile kayıtta 409 döner.
    - Önbellek geçersizleştirme çalışır.
- **Kodlama mantığı:**
  1. **Düzenleme:** Bütün yazmalar taslağa gider ve `ai_agents.draft_revision` artar. İstemci `If-Match: <revision>` gönderir; eski revizyonla kayıt 409 döner ("başkası değiştirdi, yeniden yükleyin").
  2. **Onaya gönderme:**
     - `config-compiler` taslağı doğrular: adımlar geçerli mi, AI-07 çakışma denetimi temiz mi, devir hedefi ekipleri var mı.
     - Paket ve önceki sürüme göre fark üretilir. Fark guardrail'lere, risk politikasına (AI-27) ya da kilitli kategorilere dokunuyorsa `touches_compliance = true` olur.
     - Bu `draft_revision` için en son AI-19 koşusunda uyum paketi %100 geçmiş olmalıdır.
     - Durum `in_review` olur ve onaycılara bildirim gider.
  3. **Onay:**
     - Onaycı gönderenle aynı kişi olamaz (sunucu tarafında zorlanır).
     - `touches_compliance` ise onaycı Kurucu olmalıdır.
     - `publish_at` verilmişse durum `approved` olarak bekler; verilmemişse hemen yayımlanır.
  4. **Yayın (tek transaction):**
     - Sürüm `published` olur, öncekisi `superseded` olur.
     - `ai_agents.published_version_id` güncellenir.
     - Yeni parçalara `visible_from_version`, kaldırılan parçalara `hidden_from_version` yazılır.
     - AI-21 kaydı ve `audit_log` (`ai.config_published`) yazılır.
     - Commit'ten sonra realtime-bus ile önbellek geçersizleştirilir ve RTM push gönderilir.
  5. **Çalışma anı:**
     - Yeni bir bağlantı (sahibin tanımıyla chat ID) açıldığında o anki yayın sürümü sohbete sabitlenir. Konuşma ortasında kurallar değişmez.
     - Her AI turunun kaydında `config_version_id` bulunur (AI-21, AI-24, AI-25 için).
     - Bilgi araması `visible_from ≤ v < hidden_from` filtresiyle yapılır. Simülasyonda (taslak) yayımlanmamış parçalar da dahil edilir.
  6. **Geri alma:** Seçilen sürümün paketinden yeni bir sürüm (örn. v14 = v11'in kopyası) oluşturulur; tarih asla yeniden yazılmaz. Parçaların görünürlüğü yeniden hesaplanır. Gerekli parçalar temizlenmişse işlem engellenir ve nedeni açıklanır. S3'e göre tek bir Yönetici bunu yapabilir.
  7. **Duraklatma:** `AiAgent.active=false` (mevcut alan). İşlem değişiklik kaydına geçer.
  8. **Hızlı yol (S1/S2):** Yöneticinin yaptığı serbest makale ve SSS metin düzeltmeleri küçük sürüm olarak otomatik onaylanır (v12.1). Yine de AI-21'e kaydedilir.
  9. **Zamanlı yayın:** İş, yayın anında onayın hâlâ geçerli olduğunu ve uyum koşusunun hâlâ geçtiğini yeniden kontrol eder. Biri tutmuyorsa yayınlamaz ve bildirim gönderir.
- **Kabul kriterleri:**
  - Taslakta bir prosedür değiştiğinde canlı widget eski davranışla yanıt vermeye devam eder; "oyuncu gibi konuş" (taslak) yeni davranışı gösterir.
  - Ekip Lideri yayınlayamaz. Yönetici kendi gönderisini onaylayamaz. Guardrail değişikliği Kurucu olmadan yayımlanamaz.
  - Uyum senaryolarından biri kalırsa "Onaya gönder" butonu nedeniyle birlikte kapalı görünür.
  - v11'e geri alındığında, v12'de silinen bir bilgi parçası yeniden aranabilir olur.
  - Her AI yanıtının çalışma kaydında `config_version_id` bulunur.
  - Zamanlı yayın, belirlenen andan en geç 1 dk sonra gerçekleşir. Onay geri çekilmişse yayın yapılmaz.
  - İki kişi aynı taslağı düzenlerse ikinci kayıt 409 alır.
- **Riskler / notlar:**
  - **Tasarım sırası:** Bu madde AI-01…AI-15'in bütün tablolarını etkiler. Sürüm işaretçisi ve "taslak = düzenleme tabloları" ilkesi o maddeler kodlanmadan **önce** sabitlenmeli, yoksa sonradan geri dönüşü pahalı olur.
  - **Arama performansı:** Görünürlük filtresi pgvector'ün yaklaşık (HNSW) aramasında isabeti düşürebilir. `KnowledgeService.search` içindeki kesin arama tavanı mantığıyla birlikte ölçülmeli (`measure:knowledge-retrieval`).
  - **ADR-14:** Uyumlu. Workflow tablosu kullanılmıyor.
  - **Geçiş etkisi:** Mevcut "skill aç/kapa" anlamı değişeceği için kiracılara geçişte kısa bir açıklama gösterilmeli.

### AI-21 — AI ayar değişiklik geçmişi
- **Alan (panelde nerede, kim kullanır):**
  - **Playbook › Geçmiş** sekmesi: varlık türü, kişi, tarih ve sürüm filtreleri. Ayrıca her editörde "Geçmiş" çekmecesi.
  - **Ayarlar › Denetim kaydı** (`/app/settings/audit-log`): `ai.*` satırları ilgili geçmiş kaydına bağlantı verir.
  - **Roller:**
    - Kurucu / Yönetici: tamamı.
    - Ekip Lideri: kendi değişiklikleri ve yayın geçmişi.
    - Ekip Üyesi: yok.
- **Mevcut kod karşılığı:**
  - **Audit log:** `AuditLogEntry` (`apps/api/prisma/schema.prisma:2477-2515`, HMAC zinciri). `services/audit/audit-log.ts`: `AUDIT_ACTIONS` (`:40-486`; AI yapılandırma eylemi yok), `FORBIDDEN_METADATA_KEY` ve "değer değil alan adı" kuralı (`AuditEntry` açıklaması).
  - **AI tarafındaki tek kayıtlar:** `routes/playbook.ts:546` (skill silme) ve `:1368` (bilgi kaynağı silme); ikisi de `data.deleted`.
  - **İz bırakmayan yollar:** `PATCH /ai-agents/:aiAgentId` (`:373`), skill oluşturma ve güncelleme (`:447`, `:499`), kaynak oluşturma, güncelleme ve yeniden indeksleme (`:679`, `:1180`, `:1301`). Copilot bilgisi (`routes/copilot.ts`) de aynı durumda.
  - **Saklama:** `services/retention/policy.ts` (`auditDays` varsayılan 30, kiracıya göre değişmez).
  - **Görüntüleyici:** `routes/audit-log.ts`, `apps/web/src/features/audit/`.
- **Eklenecek / değişecek yerler:**
  - **Prisma ve migration:**
    - Yeni tablo `ai_config_changes`: `id`, `license_id`, `ai_agent_id?`, `entity_type` (`persona` | `guidance_rule` | `procedure` | `skill` | `knowledge_source` | `knowledge_table_row` | `handoff_rule` | `guardrail` | `risk_policy` | `config_version`), `entity_id`, `action` (`created` | `updated` | `deleted` | `submitted` | `approved` | `rejected` | `published` | `rolled_back` | `paused` | `resumed` | `crawled`), `actor_id`, `actor_type`, `actor_role`, `at`, `version_id?`, `draft_revision?`, `before jsonb`, `after jsonb`, `diff jsonb`, `note`, `request_id`.
    - Uygulama rolüne yalnızca `INSERT` ve `SELECT` verilir (`invoices` tablosundaki kalıp). RLS uygulanır.
    - İndeksler: `(license_id, at desc)` ve `(license_id, entity_type, entity_id, at desc)`.
  - **Audit eylemleri:** `audit-log.ts` içindeki `AUDIT_ACTIONS` listesine şunlar eklenir: `ai.config_changed`, `ai.config_submitted`, `ai.config_approved`, `ai.config_rejected`, `ai.config_published`, `ai.config_rolled_back`, `ai.paused`, `ai.resumed`, `knowledge.crawled`. Metadata'da yalnızca varlık türü, id ve alan adları bulunur.
  - **Servis:** `services/ai/config-history.ts` → `recordChange(tx, auditCtx, { entityType, entityId, action, before, after, versionId, note })`. Fark hesaplar, AI-26 ile maskeler ve boyut sınırını uygular.
  - **Kancalar:** Bütün AI yapılandırma yazma yolları bu servisten geçer: yukarıdaki rotalar, `routes/copilot.ts` bilgi yolları, AI-03/07/08/09/12/13/27 rotaları ve AI-20 durum geçişleri. Bunun için rota başına çağrı yerine servis katmanında tek bir sarmalayıcı önerilir.
  - **Saklama:** Yeni pencere `aiConfigHistoryDays` (varsayılan 1825 gün ya da sınırsız; S1). `audit_log` budamasından etkilenmez; kiracı silinince silinir.
  - **API:** `GET /ai/changes` (filtreler, imleç), `GET /ai/changes/{id}`, `GET /ai/changes/export` (CSV, Kurucu / Yönetici).
  - **Web:** `features/playbook/History.tsx`, `ChangeDiff.tsx` (yan yana fark). Audit log satırından derin bağlantı.
  - **Testler:**
    - Her yazma yolu aynı transaction içinde tam olarak bir değişiklik satırı üretir; işlem geri alınırsa satır da oluşmaz.
    - Maskeleme çalışır.
    - Veritabanı `UPDATE` ve `DELETE`'i reddeder.
    - Audit budaması bu tabloya dokunmaz.
    - RLS ve dışa aktarma.
- **Kodlama mantığı:**
  1. **Kayıt anı:** Yapılandırmayı yazan transaction içinde şu sıra izlenir: önceki hâl `SELECT … FOR UPDATE` ile okunur, yazma yapılır, sonraki hâl okunur, JSON yol bazında fark (eklendi / silindi / değişti) hesaplanır, `ai_config_changes` satırı ve alan adlarını içeren bir `audit_log` satırı eklenir. Yazma başarısız olursa hiçbir kayıt kalmaz.
  2. **Gruplama:** Tek bir "Kaydet" işlemindeki birden fazla alan tek satırda toplanır.
  3. **Aktör:** İstek sahibinden alınır ve o anki rolü saklanır (rol sonradan değişebilir). Zamanlayıcı ve tarayıcı gibi sistem işleri `actor_type: 'system'` ve iş id'si ile yazılır.
  4. **Büyük metinler:** 20 KB'ye kadar metin olduğu gibi saklanır. Daha büyük metinler için hash, uzunluk ve parça sayısı saklanır; "bu sürümdeki metni göster" bilgisi AI-20 paketinden okunur.
  5. **Okunabilir özet:** Adım dizileri için insan diliyle özet üretilir. Örnek: "Adım 3: Finans'a devret → KYC'ye devret". Prosedür ve kural adları farkın başlığında gösterilir.
  6. **Görüntüleme:** Zaman çizelgesi, filtreler, yan yana fark, ilgili sürüme ve o sürümün AI-19 test koşusuna bağlantılar.
  7. **Güvenlik:** API üzerinden silme ya da güncelleme yoktur. Dışa aktarma yetkiye bağlıdır. Metinler kayıttan önce AI-26 maskelemesinden geçer.
- **Kabul kriterleri:**
  - Persona tonu değiştirildiğinde 1 değişiklik satırı (önce/sonra tonla) ve 1 `audit_log` satırı (`ai.config_changed`, metadata'da yalnızca `fields: ['tone']`) oluşur.
  - Skill silindiğinde silinmeden önceki tam hâli (`before`) saklanır.
  - Uygulama rolüyle bu tabloda `UPDATE` ya da `DELETE` denemesi veritabanı hatası verir.
  - 30 günlük audit budaması koştuktan sonra `ai_config_changes` satırları yerinde kalır.
  - Varsayılan matriste Ekip Lideri yalnızca kendi değişikliklerini görür.
  - CSV'de kim, ne zaman, varlık, alan, önce, sonra ve sürüm sütunları bulunur.
- **Riskler / notlar:**
  - **Tutarlılık:** `audit_log` ile `ai_config_changes` arasında çift yazma var. İkisi aynı transaction'da yazılmalı.
  - **Copilot bilgisi:** Kapsama Copilot bilgisi de dahil edilmeli. AI-14 iki bilgi deposunu birleştirince tek yol kalır.
  - **Saklama ve silme:** Uzun saklama süresiyle kiracı silme hakkı arasındaki denge hukuki bir karardır (S1).

### AI-22 — Çözülemeyen sorular ve bilgi boşluğu raporu
- **Alan (panelde nerede, kim kullanır):**
  - **Yer:** AI Agent (Playbook) › Analiz › **Çözülemeyen sorular** (Performans'ın yanında yeni alt sekme).
  - **Roller:**
    - Kurucu / Yönetici: tamamı.
    - Ekip Lideri: kendi ekibi ve markası filtresiyle.
    - Ekip Üyesi: yok.
  - **Ani artış bildirimi:** Ekip Lideri ve Yönetici alır.
- **Mevcut kod karşılığı:**
  - **Kayıt yazılmayan yollar:** `apps/api/src/services/ai/skill-engine.ts:257-295`. Skill döngüsü eşleşme bulamazsa `return NOTHING_RAN` ile döner ve `#record` (`:703` civarı) hiç çağrılmaz. Dil reddi `:279-280`'de. Bilgi bulunamadığında sonuç yine `skipped` (`#execute` bilgi dalı, `:571-590` civarı).
  - **Arama embedding'i:** Sorunun embedding'i arama sırasında zaten üretiliyor (`EmbeddedQuery`, `knowledge-service.ts`).
  - **Kümeleme:** `packages/ai-mock/src/topics.ts` deterministik ve bilinçli olarak yalnızca sözcüksel çalışıyor ("customer text never leaves its transaction"). Chat topics raporu `routes/reports.ts` içinde.
  - **Silme yolları:** `services/retention/erasure.ts`, `retention.ts`.
- **Eklenecek / değişecek yerler:**
  - **Prisma ve migration:**
    - `ai_unresolved_items`: `id`, `license_id`, `ai_agent_id`, `brand_id?`, `chat_id`, `thread_id`, `day_thread_key?` (ID-02), `event_id`, `text_masked`, `context_masked`, `language`, `reason` (`no_procedure_match` | `no_knowledge` | `low_confidence` | `said_dont_know` | `unsupported_language` | `not_understood_handoff` | `player_abandoned` | `asked_human_after_ai` | `agent_flagged`), `intent_guess?`, `config_version_id?`, `embedding vector(1536)?`, `embedding_space`, `cluster_id?`, `created_at`.
    - `ai_unresolved_clusters`: `id`, `license_id`, `ai_agent_id`, `label`, `label_source` (`llm` | `lexical`), `centroid vector(1536)?`, `embedding_space`, `item_count`, `count_7d`, `handoff_count`, `abandon_count`, `first_seen`, `last_seen`, `status` (`open` | `ignored` | `resolved`), `ignore_reason`, `linked_change_id?`, `resolved_at?`, `post_fix_count`.
    - Hepsine RLS. İndeksler `(license_id, created_at)`, `(cluster_id)`.
  - **Motor kancası:** `runTurn` sonucuna (AI-19 sözleşmesi) `unresolved: { reason, text }` kararı eklenir. Canlı adaptör (`ai-responder.ts`) bunu yanıt gönderildikten sonra, bloklamadan yazar; hata olursa loglar.
  - **Terk tespiti:** `services/chat/chat-service.ts` `deactivate` / `deactivateByTimeout` (`:841`, `:890`) kancası: son mesaj AI'dansa, devir ve onay yoksa `player_abandoned` kaydı yazılır.
  - **Zamanlayıcı:** `ai_unresolved_cluster` işi (15 dk) ve gece birleştirme işi.
  - **Saklama ve silme:** `erasure.ts` kayıtları `chat_id` ile siler. Saklama süpürmesi S1 penceresini uygular.
  - **API:** `routes/ai-unresolved.ts`:
    - `GET /ai/unresolved/clusters` (sıralama; tarih, marka, neden, dil filtreleri)
    - `GET /ai/unresolved/clusters/{id}` (örnekler, chat ID'leri, trend)
    - `POST …/{id}/ignore | resolve | merge`
    - `POST …/{id}/suggest-knowledge` (AI-23 önerisi açar), `POST …/{id}/add-examples` (AI-03 giriş cümlelerine taslak olarak ekler)
  - **Web:** `features/playbook/Unresolved.tsx`, `ClusterDetail.tsx`. `packages/types/src/notifications.ts` içine yeni bildirim türü.
  - **Tipler:** `UNRESOLVED_REASONS`, kümeleme eşikleri.
  - **Testler:** Yakalama noktaları, maskeleme, kümeleme (mock uzayında sözcüksel, gerçek uzayda fixture vektörler), silme, alarm tekrarı engelleme, RLS.
- **Kodlama mantığı:**
  1. **Yakalama:**
     - Prosedür ya da skill eşleşmedi ve bilgi de yoksa → `no_procedure_match` / `no_knowledge`.
     - Bilgi skoru eşiğin hemen altındaysa (eşik − δ aralığı) → `low_confidence`.
     - AI-06 "bilmiyorum" dediyse → `said_dont_know`.
     - AI-09 "2 tur anlaşılamadı" nedeniyle devrettiyse → `not_understood_handoff`.
     - Desteklenmeyen dil → `unsupported_language`.
     - **Zorunlu uyum devirleri (G1–G5, G13, G15) buraya yazılmaz.** Onlar bilgi boşluğu değil, AI-27 ve AI-24'ün konusu.
  2. **Metin:** Tetikleyen oyuncu mesajı ile bir önceki oyuncu mesajı AI-26 ile maskelenerek saklanır. "merhaba", "?", tek kelime ve emoji gibi anlamsız kısa mesajlar (örn. 3 karakterin altı) elenir.
  3. **Embedding:** Arama sırasında üretilen sorgu embedding'i yeniden kullanılır. Böylece ek sağlayıcı çağrısı ve ek veri paylaşımı olmaz. Sorgu aramaya hiç ulaşmadıysa iş toplu olarak embed eder (kotaya sayılır). Mock uzayında `topics.ts` sözcüksel yöntemine düşülür.
  4. **Kümeleme:**
     - Aynı lisans, ajan ve uzay içinde en yakın merkeze bakılır. Kosinüs ≥ τ ise kümeye atanır ve merkez koşan ortalamayla güncellenir; değilse yeni küme açılır.
     - τ gerçek uzayda fixture ile kalibre edilir (başlangıç yaklaşık 0,8).
     - Gece işi, merkezleri τ_merge'den yakın olan kümeleri birleştirir.
     - Embedding uzayı değişirse (AI-16 yeniden gömme) bütün kümeler yeniden kurulur.
  5. **Başlık:** Küme açıldığında ya da %50 büyüdüğünde `fast` model 5–10 maskeli örnekten en fazla 8 kelimelik Türkçe bir başlık ve önerilen eylem türü üretir. LLM kapalıysa `topics.ts` etiket mantığı kullanılır (rakam içermez).
  6. **Sıralama:** Varsayılan sıralama son 7 günün sayısına göre azalan. Sütunlar: devir oranı, terk oranı, ilk görülme ("yeni" rozeti, 48 saatten genç).
  7. **Çözüm takibi:** Bir küme bir değişikliğe (AI-21) ya da sürüme bağlanınca `resolved` olur. Sonraki yeni kayıtlar "düzeltmeden sonra: N" olarak sayılır. N eşiği aşarsa küme yeniden açılır ve bildirim gider.
  8. **Alarm (S2):** Bir kümenin son 60 dakikadaki sayısı eşiği (varsayılan 20) geçerse bildirim gider. Aynı küme için 6 saat içinde tekrar gönderilmez.
  9. **Performans:** Her çözülemeyen mesaj için bir satır yazılır. Küme tablosu küçük olduğu için kesin kosinüs araması yeterli; HNSW gerekmez.
- **Kabul kriterleri:**
  - Hiçbir prosedüre uymayan bir mesaj en geç 15 dk içinde listede `no_procedure_match` nedeniyle görünür.
  - Gerçek embedding'le "Papara ile yatırdım gözükmüyor" anlamındaki 30 farklı cümle tek kümede toplanır (fixture testi).
  - Kart numarası ya da OTP içeren bir mesaj kayıtta maskeli görünür.
  - Yok sayılan kümeye yeni benzer mesajlar sayılmaya devam eder, ama varsayılan görünümde öne çıkmaz.
  - Bir oyuncu için silme (erasure) talebi uygulandığında o oyuncunun kayıtları silinir.
  - Eşik aşıldığında tam olarak bir bildirim gider.
  - Self-exclusion mesajları bu listede görünmez.
- **Riskler / notlar:**
  - **Saklama:** Oyuncu metni ayrı bir tabloda daha uzun yaşayabilir (S1, KVKK).
  - **Başlık kalitesi:** LLM yanlış ya da yanıltıcı başlık üretebilir. Örnekler her zaman görünür olmalı.
  - **Metrik bağı:** "Bilgi yok" devir nedeni AI-25'te ayrıca gösterilir; iki ekran aynı tanımı kullanmalı (tipler paketinde tek tanım).

### AI-23 — Koçluk ve öneri kuyruğu
- **Alan (panelde nerede, kim kullanır):**
  - **Inbox:**
    - Transkriptteki AI mesajında "⋯ › AI'ı düzelt" menüsü (Ekip Üyesi ve üstü).
    - Ajanın kendi mesajında "AI bilgisine öner".
    - Devraldıktan sonra kısa "Devir kartı yeterli miydi?" bandı (AI-25 verisi).
  - **Playbook › Öneriler:**
    - Ekip Lideri: kendi ekibinin önerileri.
    - Yönetici / Kurucu: tamamı.
  - **Bildirimler:** Öneri sahibi sonucu burada görür.
- **Mevcut kod karşılığı:**
  - **Inbox ekranları:** `apps/web/src/features/inbox/Transcript.tsx` (mesaj çizimi), `CopilotPanel.tsx`, `useCopilot.ts`.
  - **AI mesajını tanıma:** `author_type: 'bot'` ve `author_id === AI_BOT_ID` (`packages/types/src/widget.ts:73`; widget'ta aynı mantık `apps/widget/src/widget.ts:2964-2966`).
  - **Görünürlük kontrolü:** `services/chat/chat-service.ts` (`resolveVisibility`).
  - **Diğer:** Bilgi bankası makale yayını `routes/kb.ts`, bildirimler `routes/notifications.ts`, ajan yetkileri `packages/types/src/role-scopes.ts` (`DEFAULT_AGENT_SCOPES`).
- **Eklenecek / değişecek yerler:**
  - **Prisma ve migration:** `ai_suggestions` tablosu:
    - Kimlik ve tür: `id`, `license_id`, `ai_agent_id`, `kind` (`wrong_answer` | `missing_info` | `should_have_handed_off` | `should_not_have_handed_off` | `tone` | `promote_agent_answer` | `other`), `source` (`agent_flag` | `qa_finding` | `unresolved_cluster`).
    - Bağlam: `chat_id`, `thread_id`, `event_ids text[]`, `excerpt_masked jsonb` (son 6 mesaj, oluşturma anında maskeli kopya), `note`, `team_id`.
    - Öneri ve inceleme: `proposed_change jsonb` (`{ target: knowledge_snippet | guidance_rule | procedure_example | procedure_note, title, body, source_id? }`), `duplicate_of?`, `similar_chunk_ids[]`, `status` (`new` | `drafting` | `in_review` | `accepted` | `rejected` | `merged`), `reviewer_id`, `reviewed_at`, `review_note`, `resulting_change_id?`, `created_by`, `created_at`.
    - RLS. İndeksler `(license_id, status, team_id, created_at)`.
  - **API:** `routes/ai-suggestions.ts`:
    - `POST /ai/suggestions`
    - `GET /ai/suggestions` (Ekip Lideri için ekip kapsamı sunucuda zorlanır; Ekip Üyesi yalnızca kendi önerilerini görür)
    - `PATCH /ai/suggestions/{id}` (kabul / ret / birleştir, öneri metnini düzenleme)
    - `POST /ai/suggestions/{id}/to-scenario` (AI-19)
    - Servisler: `services/ai/suggestions.ts`, `suggestion-drafting.ts`.
  - **Zamanlayıcı/kuyruk:** `ai_suggestion_drafts` işi; LLM taslağı burada üretilir.
  - **RTM:** `ai_suggestion_created` (onaycılara rozet sayısı).
  - **Web:**
    - Inbox `Transcript.tsx` mesaj eylem menüsü ve modal: neden çipleri ("Yanlış bilgi / Eksik bilgi / Devretmeliydi / Gereksiz devretti / Ton / Diğer") ve not alanı.
    - `features/playbook/Suggestions.tsx` (liste + detay: solda konuşma kesiti ve ID'ler, sağda düzenlenebilir öneri, "Kabul et → taslağa ekle / Reddet / Yinelenen").
  - **Tipler:** `SUGGESTION_KINDS`. RL-02 yetenekleri `ai.suggest`, `ai.suggestions.review`.
  - **Testler:** Görünürlük (başkasının sohbetine öneri açılamaz), kişisel verinin genelleştirilmesi (fixture), ekip kapsamı, ret notu zorunluluğu, taslağa düşme, oran sınırı.
- **Kodlama mantığı:**
  1. **Oluşturma:**
     - Ajanın sohbeti görme yetkisi `resolveVisibility` ile doğrulanır. `wrong_answer` türlerinde işaretlenen event'in AI mesajı olduğu kontrol edilir.
     - Konuşma kesiti oluşturma anında maskelenip kopyalanır. Böylece sohbet saklama süresi dolsa bile inceleme yapılabilir.
     - Aynı event, tür ve ajan için ikinci öneri 409 döner. Ajan başına günde en fazla 50 öneri.
  2. **Taslak üretimi:** `promote_agent_answer` ve `missing_info` türlerinde iş, `fast` modelle JSON üretir: `{ title, body, applies_to_intent, removed_specifics[] }`.
     - Talimat: oyuncuya özgü ad, kullanıcı adı, tutar, tarih ve işlem numaralarını çıkar; politikayı ve genel kuralı koru.
     - Sonuç ayrıca AI-26 maskelemesinden geçer.
  3. **Yinelenen tespiti:** Taslak bilgi bankasında aranır. Benzerlik ≥ τ ise `similar_chunk_ids` doldurulur ve "Bilgi zaten var; AI neden bulamadı?" ipucu gösterilir. Bu genellikle giriş cümlesi eklenmesi (AI-03) ya da eşik sorununa işaret eder.
  4. **İnceleme:**
     - Ekip Lideri yalnızca `team_id` kendi ekiplerinden biri olan önerileri görür. `team_id`, öneri anında sohbetin bağlı olduğu ekiptir.
     - **Kabul:** Seçilen hedefe göre AI-20 taslağına değişiklik yazılır (bilgi parçası, davranış kuralı, prosedür örnek cümlesi). AI-21'e bağlantılı kayıt düşer. Canlıya geçiş yayınla olur.
     - **Ret:** Not zorunludur.
     - **Birleştirme:** Başka bir öneriye ya da AI-22 kümesine bağlanır.
  5. **Geri bildirim:** Sonuç öneri sahibine bildirim olarak gider. Ekip Lideri için haftalık "en çok katkı" sayıları gösterilir (isteğe bağlı).
  6. **Devir kartı geri bildirimi:** Devralmadan sonra çıkan bant ("Yeterli / Eksik: [alan çipleri]") AI-25'teki `ai_conversation_outcomes` alanlarına yazılır, öneri oluşturmaz. Yalnızca "AI gereksiz devretti" seçilirse `should_not_have_handed_off` önerisi açılır.
- **Kabul kriterleri:**
  - Ekip Üyesi bir AI mesajını "yanlış" işaretlediğinde öneri birkaç saniye içinde ekip liderinin kuyruğunda görünür ve rozet sayısı artar.
  - "ali123" kullanıcı adı ve "2.500 TL" tutarı içeren bir ajan yanıtından üretilen taslakta bu değerler bulunmaz.
  - Kabul edilen öneri AI-20 farkında görünür, ama yayınlanana kadar canlı yanıtları değiştirmez.
  - Not girilmeden yapılan ret 400 döner.
  - A ekibinin lideri B ekibinin önerilerini göremez (API seviyesinde).
  - Mevcut bir bilgiyle aynı içerikteki öneri "zaten var" uyarısıyla gelir.
- **Riskler / notlar:**
  - **Gürültü:** Öneri kuyruğu gürültüye dönebilir. Oran sınırı ve birleştirme şart.
  - **LLM genellemesi:** Genelleme hatalı olabilir. Öneriler her zaman insan onayından geçer.
  - **Ekip kapsamı:** Ekip kapsamı RL-03'e bağlı. Sohbet ekipler arasında aktarıldıysa öneri anındaki ekip esas alınır.

### AI-24 — Kalite kontrol (QA) kuyruğu
- **Alan (panelde nerede, kim kullanır):**
  - **Raporlar › AI Kalite (QA)** (yeni): kuyruk, inceleme ekranı, sonuçlar, kalibrasyon.
    - Ekip Lideri: kendi ekibine düşen incelemeler.
    - Yönetici / Kurucu: tamamı.
    - Ekip Üyesi: yok.
  - **Ayarlar › AI kalite:** örneklem oranı ve rubrik (Kurucu / Yönetici).
  - **Inbox:** Bir sohbette "QA'ya gönder" eylemi (Ekip Lideri ve üstü).
- **Mevcut kod karşılığı:**
  - **QA modülü yok.**
  - **Kanıt kaynakları:** `SkillRun.log` (`schema.prisma:1694-1712`; okuma `routes/playbook.ts:605-641`), transkript ve olaylar (`Event`, `schema.prisma:851-887`).
  - **Müşteri puanı:** `Rating` (`:1278-1291`; `good` / `bad`), `services/reports/review-insights.ts`.
  - **Diğer:** İş altyapısı `services/scheduler/`; çalışma saatleri `WorkSchedule` (`:2746`).
- **Eklenecek / değişecek yerler:**
  - **Prisma ve migration:**
    - `qa_rubrics`: `id`, `license_id`, `version`, `criteria jsonb` (`[{ key, label, type: pass_fail | score_1_5, weight, critical, locked }]`), `active`.
    - `qa_reviews`: `id`, `license_id`, `chat_id`, `thread_id`, `ai_agent_id`, `config_version_id`, `team_id`, `brand_id`, `reasons text[]`, `priority`, `status` (`pending_prescore` | `ready` | `in_review` | `completed`), `assigned_to?`, `due_at`, `rubric_id`, `prescore jsonb`, `scores jsonb`, `final` (`pass` | `fail`), `critical_fail bool`, `excerpt_masked jsonb`, `reviewer_id`, `reviewed_at`, `comments`.
    - `qa_calibrations`, `qa_calibration_scores`.
    - Hepsine RLS. İndeksler `(license_id, status, due_at)`, `(license_id, team_id, status)`.
  - **Tipler:** Platform rubriği (a doğru konu, b zorunlu bilgiler, c bilgiye sadakat/uydurma yok, d guardrail uyumu, e doğru zamanda devir, f devir özeti eksiksiz, g ton; d ve e `critical` + `locked`) ve `QA_REASONS` (`random`, `risk_flag`, `low_bsat`, `repeat_72h`, `guardrail_scan`, `mandatory_handoff`, `handoff_insufficient`, `consistency`, `manual`).
  - **Servisler:** `services/qa/sampler.ts`, `prescore.ts`, `consistency.ts`, `qa-service.ts`.
  - **Zamanlayıcı:** `qa_sampling` (her gün, kiracı saat dilimine göre 02:00), `qa_prescore` (kuyruk), `qa_consistency` (haftalık).
  - **API:** `routes/qa.ts`:
    - `GET /qa/reviews`, `GET /qa/reviews/{id}` (transkript + karar izi + ön puan)
    - `POST /qa/reviews/{id}/claim`, `PUT /qa/reviews/{id}`
    - `POST /qa/reviews` (sohbetten elle ekleme)
    - `GET|PUT /qa/settings`, kalibrasyon uçları, `GET /qa/summary` (AI-25'e veri)
  - **Kontrat:** `paths/qa.yaml`.
  - **Web:** `features/reports/qa/QaQueue.tsx`, `QaReview.tsx` (3 bölme: transkript / karar izi (ID-09) / rubrik), `QaCalibration.tsx`, `features/settings/AiQuality.tsx`.
  - **Testler:** Örneklemin tekrar üretilebilirliği, zorunlu kategorilerin %100 alınması, ön puan kanıt doğrulaması, kritik hatanın otomatik eylemleri, ekip kapsamı, RLS.
- **Kodlama mantığı:**
  1. **İnceleme birimi:** AI'ın katıldığı tek bir bağlantı (sahibin tanımıyla chat ID) ve devir sonrasındaki ilk birkaç insan mesajı. Bu son kısım devir kalitesini değerlendirmek için alınır.
  2. **Örneklem:**
     - Her gün, önceki gün kapanan ve AI'ın katıldığı bağlantılar üzerinden yapılır.
     - Rastgele seçim deterministiktir: `hash(license, gün, chat_id) < r`. Aynı gün yeniden koşulursa aynı örneklem çıkar.
     - **Zorunlu kategoriler:** risk bayrağı (AI-27), kötü BSAT, 72 saatte tekrar temas (AI-25 işi), guardrail tarayıcısının işaretlediği gönderimler (AI-08), zorunlu devir tetiklenen sohbetler (doğrulama için), ajanın "yetersiz" dediği devir kartları, tutarlılık sapmaları.
     - Bir sohbet birden fazla nedenle seçilirse nedenler birleştirilir.
     - **Öncelik ve süre:** risk > guardrail > diğerleri. Risk bayraklılar için son tarih 2 iş günü, diğerleri için 7 gün (CGA sorumlu oyun şikâyetlerinde 5 iş günü öngörüyor).
  3. **Ön puan:**
     - **Girdi:** maskeli transkript, karar izi (prosedür, bilgiler, kaynak parça id'leri, guardrail kontrolleri, devir nedeni, sürüm), ilgili G kurallarının metni ve rubrik.
     - **Çıktı (`default` model, sıcaklık 0, JSON şema):** `{ criteria: [{ key, value, evidence_event_ids[], rationale }], critical_candidates[], overall }`.
     - Kanıt id'leri gerçekten bu sohbete ait değilse ön puan atılır. Model hata verirse ön puansız `ready` olunur.
  4. **İnsan incelemesi:**
     - Ön puan önceden doldurulmuş gelir, ama kritik kriterlerin her biri **tek tek onaylanmadan** kayıt yapılamaz. İnceleyen ön puanı değiştirebilir ve sonuç olarak `final` yazar.
     - **Kritik hata çıkarsa otomatik olarak:**
       - AI-23 önerisi açılır (kriterden türetilen türle);
       - maskeli transkriptten AI-19 senaryo taslağı oluşturulur;
       - zorunlu devir ihlalindeyse `ai_conversation_outcomes.mandatory_handoff_violation=true` yazılır ve Yöneticiye bildirim gider.
  5. **AI-25'e akış:** Yanlış çözüm (çözüldü görünen ama QA'nın "çözülmemiş" dediği), zorunlu devir uyumu (tetiklenmesi gereken küme), guardrail ihlali (doğrulanmış) ve tutarlılık bilgileri AI-25'e geçer.
  6. **Tutarlılık işi:**
     - Son haftanın AI konuşmaları `(konu, prosedür, temel bilgi kovaları)` anahtarıyla gruplanır. Örnek kovalar: yöntem; geçen süre (beklenen sürenin altında / üstünde).
     - Aynı gruptaki farklı sonuç veya yanıt kalıpları tespit edilir ve çiftler `consistency` nedeniyle kuyruğa alınır (CGA tutarlılık şartı).
  7. **Kalibrasyon:** Ayda bir aynı 20 konuşma bütün ekip liderlerine atanır. Kriter başına uyum yüzdesi ve sapan inceleyiciler raporlanır.
  8. **Yetki:** İnceleyen kişi kendi devraldığı sohbeti inceleyemez (çıkar çatışması kontrolü; varsayılan açık). Sorumlu oyun transkriptlerinin tam metnini yalnızca Sorumlu Oyun ekibi ve Yönetici görür.
- **Kabul kriterleri:**
  - %5 oran ve günde 1.000 AI konuşmasıyla kuyruğa yaklaşık 50 rastgele konuşma ve bütün zorunlu kategoriler girer. Aynı gün yeniden koşulduğunda aynı liste çıkar.
  - Risk bayraklı her AI konuşması kuyrukta yer alır (%100).
  - Ön puan yalnızca o sohbete ait event ID'lerine atıf yapar; geçersiz atıf içeren ön puan atılır.
  - Kritik kriterler tek tek onaylanmadan inceleme kaydedilemez.
  - Kritik hata otomatik olarak bir AI-23 önerisi ve bir AI-19 senaryo taslağı üretir.
  - A ekibinin lideri B ekibine düşen incelemeleri göremez.
  - QA sonuçları AI-25'teki yanlış çözüm ve zorunlu devir uyumu oranlarına yansır.
  - Kalibrasyon raporu kriter başına uyum yüzdesini gösterir.
- **Riskler / notlar:**
  - **İş yükü:** Oran ayarlanabilir olmalı ve zorunlu kategori hacmi izlenmeli.
  - **Ön puana aşırı güven:** Açık onay zorunluluğu bu riski azaltır.
  - **Saklama:** QA kanıtının saklama süresi sohbet saklama süresinden uzun olabilir. Maskeli kesit ve puanlar ayrı saklanır; süresi hukuki bir karar olarak AI-21-S1 ile birlikte verilmeli.
  - **Bağımlılık:** Karar izi (ID-08) olmadan ön puan ve inceleme zayıf kalır.

### AI-25 — AI metrikleri
- **Alan (panelde nerede, kim kullanır):**
  - **Raporlar › AI Agent** (mevcut rapor genişletilir) ve **Playbook › Performans** (özet kartlar).
  - **Roller:**
    - Kurucu / Yönetici: tamamı.
    - Ekip Lideri: kendi ekibi ve markası filtresiyle (RL-02).
    - Ekip Üyesi: yok.
- **Mevcut kod karşılığı:**
  - **Rapor:** `apps/api/src/routes/reports.ts:829-869` `buildAiAgentReport` (`resolutions` = ADR-09 `automated`, `transfers`, `transfer_rate`, `skill_runs`, `tokens`). Ayrım `:600-661` (`manual` / `assisted` / `automated`).
  - **Tanım:** `automated` = thread kapandı ve içinde ajan mesajı yok (`services/chat/chat-service.ts:2283`, `:2411` açıklamaları; `routes/reports-metrics.ts:24` `resolutionRate`).
  - **Bot kimliği ve ADR-09:** `services/ai/ai-responder.ts:127-133`.
  - **Web:** `apps/web/src/features/playbook/AiPerformance.tsx`, `performance.ts` (az örnek uyarısı zaten var).
  - **Puan:** `Rating` `good` / `bad` (`packages/types/src/domain.ts:271`). Widget puan akışı `apps/widget/src/widget.ts:259-261`, `:538-545`.
  - **MCP:** `get_report` aynı fonksiyonu kullanıyor (`services/mcp/tool-catalog.ts`).
- **Eklenecek / değişecek yerler:**
  - **Kaydedilmesi gereken veri (çekirdek).** Yeni tablo `ai_conversation_outcomes`; AI'ın katıldığı her bağlantı (sahibin "chat ID" tanımı; nexa adlandırması için ID-01) için tek satır:

    | Alan grubu | Alanlar |
    |---|---|
    | Kimlik | `license_id`, `chat_id`, `thread_id`, `day_thread_key` (ID-02), `member_key` (ID-03), `brand_id`, `team_id`, `ai_agent_id`, `config_version_id` (AI-20), `language` |
    | Konu | `intent` (AI-05 son karar), `procedure_id` |
    | Zaman | `started_at`, `ended_at` |
    | Tur sayıları | `ai_turns`, `player_turns`, `clarification_turns` (eksik zorunlu bilgiyi istemek için sorulan tur), `required_slots_total`, `required_slots_filled` |
    | Sonuç | `outcome` (`confirmed_resolved` \| `assumed_pending` \| `assumed_resolved` \| `false_resolved` \| `handed_off` \| `abandoned` \| `declined`), `resolution_confirmation` (`yes` \| `no` \| `null`, `confirmed_at`) |
    | Devir | `handoff_at`, `handoff_reason` (AI-09 enum), `handoff_mandatory_rule` (`G1`…), `first_human_reply_at`, `handoff_card_rating` (`sufficient` \| `insufficient` \| `null`), `handoff_card_missing[]`, `agent_reasked bool` |
    | Memnuniyet | `bsat` (`good` \| `bad` \| `null`, yalnızca AI'ın tek başına yürüttüğü bağlantılarda), `csat_after_handoff` |
    | Uyum | `guardrail_hits jsonb` (otomatik), `guardrail_violations_confirmed int` (QA), `flags text[]` (AI-27), `mandatory_handoff_violation bool` |
    | Tekrar temas | `repeat_same_intent_72h bool`, `repeat_any_72h bool`, `repeat_of_id?` |
    | QA | `qa_result` (`pass` \| `fail` \| `unresolved` \| `null`) |
    | Durum | `finalized_at` |

  - **Ek kaynaklar:**
    - Tur bazında karar olayları ID-08 zaman çizelgesine yazılır: konu, prosedür, bilgi farkı, kaynaklar, guardrail kontrolleri, bayraklar, sürüm.
    - `ratings` tablosuna `subject` (`ai` | `human`) sütunu eklenir. Puanlama anında o bağlantıda insan mesajı olup olmadığına göre doldurulur.
    - Rollup tablosu `ai_metrics_daily`: `license`, `gün` (kiracı saat dilimi, ID-04), `brand`, `team`, `intent`, `version`, `language` + sayaç ve toplamlar.
  - **Yazma noktaları:**
    - AI'ın ilk turunda satır oluşturulur.
    - Her AI turunda sayaçlar ve konu güncellenir.
    - AI-09 devrinde devir alanları doldurulur.
    - İlk insan mesajında `first_human_reply_at` yazılır.
    - Widget'taki "Çözüldü mü? Evet / Hayır" (AI-29 / S2) onay alanlarını doldurur. "Hayır" yeniden devir tetikler (`player_said_unresolved`).
    - Puan verildiğinde `bsat` / `csat` yazılır.
    - Devir kartı bandı (AI-23) devir kalitesi alanlarını doldurur.
    - Bağlantı kapandığında devir ve onay yoksa sonuç `assumed_pending` olur.
    - AI-08 son kontrolü `guardrail_hits` ekler.
    - AI-27 `flags` ekler, AI-24 `qa_result` yazar.
  - **Zamanlayıcı:**
    - `ai_outcomes_finalize` (saatlik): kapanışından 72 saat geçmiş ve kesinleşmemiş satırlarda tekrar temas hesaplanır ve satır kesinleştirilir.
    - `ai_metrics_rollup` (saatlik).
  - **API:**
    - `GET /reports/ai-agent` geriye uyumlu biçimde genişler: `resolutions` alanı aynen kalır (ADR-09); `quality` bloğu eklenir.
    - `GET /reports/ai-agent/breakdown?by=intent|reason|version|language|brand|team`
    - `GET /reports/ai-agent/conversations?metric=…` (ID'li ayrıntı listesi)
  - **Kontrat:** `paths/reports.yaml`. MCP `get_report` aynı fonksiyondan beslendiği için kendiliğinden tutarlı kalır.
  - **Widget:** Çözüm onay butonları (AI-29 ile ortak bileşen) ve puanın konusu.
  - **Web:** Raporlar › AI Agent:
    - KPI kutuları; devir nedeni dağılımı; sürüm karşılaştırması (yan yana); filtreler; "faturalanan AI çözümü (ADR-09)" ayrı ve etiketli kutu; her metrikte Türkçe tanım ipucu.
    - `AiPerformance.tsx` kartları güncellenir.
  - **Tipler:** Metrik anahtarları ve tanımları tek kaynakta tutulur (web ve API ortak; ipucu metinleri de buradan).
  - **Testler:** Her tanım fixture ile birim test edilir. Kesinleştirme işi, rollup = ham veri eşitliği, RLS ve ADR-09 sayısının değişmediğine dair regresyon testi yazılır.
- **Kodlama mantığı:** Metrik tanımları ve hesap kuralları:
  - **Payda N:** Pencerede biten ve AI'ın en az bir anlamlı tur yazdığı bağlantılar. Yalnızca karşılama mesajı sayılmaz.
  - **Onaylı çözüm** = `confirmed_resolved` / N.
  - **Varsayılan çözüm** = kesinleşmiş `assumed_resolved` / N. Son 72 saatteki `assumed_pending` satırları "kesinleşmemiş" olarak ayrıca gösterilir.
  - **Yanlış çözüm** = (onaylı ∪ varsayılan) içinde (`repeat_same_intent_72h` ∨ `qa_result = unresolved`) olanlar / (onaylı ∪ varsayılan).
  - **Containment** = bağlantıda hiç insan mesajı olmayanlar / N. Ekranda "tek başına başarı göstergesi değildir" notu bulunur.
  - **Devir oranı** = `handed_off` / N, neden dağılımıyla birlikte. "Bilgi yok" nedeni AI-22'ye bağlantı verir.
  - **Devir kalitesi** = `sufficient` / (`sufficient` + `insufficient`). Ayrıca tekrar sorma oranı = `agent_reasked` / değerlendirilen devirler.
  - **Zorunlu devir uyumu** = (tetiklenip en fazla 1 tur içinde devredilenler) / (tetiklenenler ∪ QA'nın "tetiklenmeliydi" dedikleri). Hedef %100. Her ihlal ID'siyle olay listesinde gösterilir.
  - **Guardrail ihlali** = QA'nın doğruladığı ihlal içeren bağlantılar / N. Otomatik tarayıcının şüpheli işaretleri ayrı bir sütunda gösterilir.
  - **BSAT** = `good` / (`good` + `bad`), yalnızca AI'ın tek başına yürüttüğü bağlantılarda. Devredilenlerde CSAT ayrıca gösterilir.
  - **Netleştirme verimliliği** = zorunlu bilgileri tamamlanmış bağlantılarda prosedür başına ortalama `clarification_turns`.
  - **Devir sonrası bekleme** = `first_human_reply_at − handoff_at` medyanı ve p90'ı; mesai içi ve dışı (`WorkSchedule`) ayrı.
  - **Tutarlılık** = AI-24 tutarlılık işinde karşılaştırılabilir çiftlerden aynı sonucu ya da yanıt kalıbını alanların oranı.
  - **Tekrar temas kuralı:** Aynı `member_key`'in bağlantı bitişinden sonraki 72 saat içinde açtığı **herhangi bir** yeni bağlantı aranır (aynı gün thread'i içinde yeni bir chat de sayılır). Konu aynıysa `repeat_same_intent_72h` işaretlenir. `member_key` yoksa (anonim oyuncu) satır "tekrar temas ölçülemedi" kovasına düşer.
  - **Küçük örnek:** Mevcut "az örnek" uyarı mantığı (`performance.ts`) yeni oranlara da uygulanır.
- **Kabul kriterleri:**
  - Aynı veriyle ADR-09 `resolutions` değeri değişmez (regresyon testi).
  - **Fixture:** 10 AI bağlantısı: 3 onaylı, 4 varsayılan (biri 48 saat içinde aynı konuyla geri gelmiş), 3 devir (biri zorunlu sorumlu oyun devri).
    - Kesinleşmeden sonra panel şunu gösterir: onaylı %30, varsayılan %30 (3/10), yanlış çözüm 1/7, devir %30, zorunlu devir uyumu %100.
  - Son 72 saatteki varsayılan çözümler "kesinleşmemiş" etiketiyle gösterilir.
  - QA'nın bulduğu bir zorunlu devir ihlali uyum oranını %100'ün altına düşürür ve ilgili konuşma ID'si olay listesinde görünür.
  - Sürüm filtresiyle v12 ve v13 yan yana karşılaştırılabilir.
  - BSAT'a yalnızca AI'ın tek başına yürüttüğü bağlantıların puanları girer.
  - Ekip Lideri yalnızca kendi ekibinin rakamlarını görür.
- **Riskler / notlar:**
  - **Tekrar temas doğruluğu:** ID-03 üye eşleştirmesine bağlı; F1'de beyana dayalı kullanıcı adı nedeniyle sapma olabilir.
  - **Kimlik terminolojisi:** nexa'da "Chat" uzun ömürlü konuşmayı, "Thread" ise oturumu anlatıyor (`schema.prisma:781-843`). Sahibin tanımı bunun tersi. Metrik birimi "bağlantı"dır; ID-01 kararına göre doğru sütun seçilmeli.
  - **Konu etiketi:** AI-05 olmadan "aynı konu" ölçülemez. Konusuz satırlar ayrı raporlanır.
  - **Fatura ve yeni metrikler:** Fatura (ADR-09) ile yeni çözüm metrikleri farklı rakamlar gösterecek. Bunu müşteriye açıklayan bir metin şart.

### AI-26 — Sohbet içi hassas veri maskeleme
- **Alan (panelde nerede, kim kullanır):**
  - **Platform genelinde çalışır**; menüsü yoktur. Widget, Inbox, arşiv, loglar ve AI'a giden metin maskeli olur.
  - **Ayarlar › Güvenlik › Hassas veri** (Kurucu): politika görünümü ve IBAN tercihi (S1/S2). Kilitli kurallar yalnızca bilgi olarak görünür, kapatılamaz.
  - **Ajan:** Mesajın yanında "Hassas veri gizlendi (OTP)" rozetini görür.
- **Mevcut kod karşılığı:**
  - **Maskeleyici:** `apps/api/src/lib/cc-mask.ts`. `:38` aday regex, `:41` Luhn, `:62` `maskCardNumbers`, `:78` `maskOptional`.
  - **Çağrı noktaları:**
    - `routes/customer.ts:255` (ön sohbet alanları), `:668` (oyuncu mesajı; açıklaması AI eşleştiriciye maskeli metin gittiğini söylüyor), `:906`, `:1021` (ticket konusu), `:1124` (puan yorumu)
    - `routes/chats.ts:197`, `:376` (ajan mesajı)
    - `services/channels/channel-service.ts:478`, `services/channels/email-inbound.ts:122`
    - `lib/log-redact.ts:164` (loglar)
  - **Testler:** `apps/api/src/lib/cc-mask.test.ts`, `apps/api/test/integration/cc-masking.test.ts`.
- **Eklenecek / değişecek yerler:**
  - **`lib/sensitive-mask.ts`** (`cc-mask.ts`'in üst kümesi; eski fonksiyon geriye uyumlu sarmalayıcı olarak kalır): `maskSensitive(text, { author: 'customer' | 'agent' | 'bot', policy }) → { text, detections: [{ type, start, end }] }`. Orijinal değer hiçbir yerde saklanmaz.
  - **Tipler (`packages/types`):** `SENSITIVE_TYPES = ['card','cvv','otp','password','iban','seed_phrase','private_key','banking_credential']`, yazar türüne göre politika tablosu, uyarı metinleri (TR, EN, RU, AZ…).
  - **Çağrı noktaları:** Yukarıdaki bütün `maskCardNumbers` / `maskOptional` çağrıları `maskSensitive` ile değiştirilir. Ek olarak:
    - AI yanıtı gönderilmeden önce (AI-08 son kontrolü),
    - LLM'e giden prompt (savunma derinliği; `provider/answer-prompt.ts` ve AI-03 motoru),
    - AI-22, AI-23 ve AI-24 kayıtları.
  - **Oyuncuya uyarı:** `routes/customer.ts` mesaj yolunda tespit varsa bir `system` olayı (recipients `all`) yazılır, oyuncunun dilinde. Olay `properties`'ine `{ sensitive_types }` eklenir.
  - **Web:** `features/inbox/Transcript.tsx` içinde rozet, `features/settings` içinde "Hassas veri" bilgi sayfası.
  - **Widget:** Uyarı sistem mesajı olarak çizilir (mevcut sistem olayı çizimi). İsteğe bağlı: oyuncu yazarken istemci tarafında ön uyarı ("Kart numarası gibi görünüyor, göndermeyin"). Bu yalnızca bir yardımdır; asıl koruma sunucuda kalır.
  - **Testler:** Türkçe gerçekçi örnek seti (pozitif ve negatif). Her yazma yolu için entegrasyon testi. Log redaksiyonu. LLM'e giden prompt'ta maskeli metin. Uyarının sohbet başına tür başına bir kez gitmesi.
- **Kodlama mantığı:**
  1. **Dedektörler** (sıralı; çakışmada geniş eşleşme kazanır):
     - `card`: mevcut Luhn kuralı.
     - `iban`: `TR` + 24 rakam (boşluklu ya da boşluksuz) ve diğer ülke biçimleri; mod-97 doğrulamasıyla. Maske son 4 haneyi korur (S1).
     - `cvv`: 3–4 hane; 30 karakter yakınında `cvv|cvc|güvenlik kodu|arka(daki)? (3|üç) hane` geçmeli.
     - `otp`: 4–8 hane; yakınında `kod|sms|otp|doğrulama|onay kodu|şifre` geçmeli (S3).
     - `password`: `şifrem|parolam|password|pw` ve ardından gelen boşluksuz token (en fazla 64 karakter).
     - `seed_phrase`: art arda 12, 15, 18, 21 ya da 24 kelimenin BIP-39 İngilizce listesinde olması. Liste kodda tutulur ve küme ile O(n) kontrol edilir.
     - `private_key`: `5|K|L` ile başlayan 51–52 karakterlik WIF anahtarı, ya da yakınında `private key|özel anahtar|privkey` geçen 64 haneli onaltılık değer. **64 haneli onaltılık değer tek başına maskelenmez**, çünkü bu kripto TXID'sidir ve devir için gereklidir.
     - `banking_credential`: `müşteri no|internet şubesi` ve ardından sayı + şifre kalıbı.
  2. **Politika:**
     - Oyuncu mesajında bütün türler maskelenir.
     - Ajan ve bot mesajında `card`, `cvv`, `otp`, `password`, `seed_phrase`, `private_key` maskelenir. `iban` S2 kararına göre ele alınır (varsayılan: maskelenmez).
  3. **Sıra:** Maskeleme **kalıcı yazmadan, RTM push'tan, loglamadan, spam filtresinden ve AI'a gönderimden önce** yapılır. `customer.ts:664-668`'deki "bir kez, en başta maskele" ilkesi korunur.
  4. **Uyarı:** `password`, `otp`, `cvv`, `card`, `seed_phrase`, `private_key` ya da `banking_credential` tespit edilirse uyarı sohbet başına tür başına bir kez gönderilir. Örnek metin: "Güvenliğiniz için şifre, SMS kodu veya kart bilgilerinizi paylaşmayın. Mesajınızdaki bu bilgiyi gizledik."
  5. **Konuşma durumu:** `password` / `otp` paylaşıldıysa AI bağlamına `sensitive_shared` eklenir. AI-08 kuralı gereği AI "bu kodu kimseyle paylaşmayın" der. AI-27 "hesap güvenliği" bayrağını önerebilir; bayrağı koyma kararı AI-27 politikasına aittir.
  6. **Ekler:** F1'de görseller maskelenmez (OCR yok). Ajana "dekontta kart/IBAN görünebilir" bilgi notu gösterilir. Belge alma kanalı politikası G12'ye bağlıdır.
  7. **Performans:** Bütün regex'ler önceden derlenir ve geri izlemesiz yazılır. Mesaj zaten 10.000 karakterle sınırlı. Tek geçişte çalışır.
- **Kabul kriterleri:**
  - "Şifrem Ali1234!" → "Şifrem ********" (yaklaşık), "SMS kodu 482913" → maskeli, "TR33 0006 1005 1978 6457 8413 26" → `TR** … 13 26`.
  - "İşlem no PPR-20261014-482913", "2.500 TL", "05321234567" ve 64 haneli bir TXID maskelenmez.
  - 12 kelimelik BIP-39 dizisi maskelenir; sıradan bir Türkçe cümle maskelenmez.
  - Maskelenmemiş değer `events.text`, loglar, `ai_*` tabloları ve LLM isteği gövdesi dahil hiçbir yerde bulunmaz (entegrasyon testinde sahte sağlayıcının aldığı prompt kontrol edilir).
  - Uyarı sohbet başına tür başına bir kez gider ve oyuncunun dilindedir.
  - Ajan bir IBAN paylaşırsa (varsayılan politika) oyuncu bunu tam görür.
- **Riskler / notlar:**
  - **Yanlış pozitif / negatif:** Bu dengenin Türkçe gerçek konuşma örnekleriyle ayarlanması gerekir. Pilotun ilk haftasında maskeleme oranı izlenmeli.
  - **Geri alınamaz:** Maskeleme kalıcıdır; orijinal değer geri getirilemez. Finans eşleştirmesi için son 4 hane yeterli olmalı (S1).
  - **Kayıt:** Kart maskelemesi PCI SAQ A gerekçesiyle zaten yazma anında yapılıyor. Bu genişletme aynı mimariyi korur.

### AI-27 — Risk bayrakları
- **Alan (panelde nerede, kim kullanır):**
  - **Inbox:**
    - `ThreadHeader.tsx` içinde kırmızı/turuncu bayrak çipleri.
    - `DetailsPanel.tsx` içinde "Risk" bölümü (bayrak geçmişi, kaynak, kanıt mesajları).
    - "Bayrak ekle / kaldır" eylemleri.
  - **Diğer yerler:** Arşiv filtresi (AR-02), Raporlar (bayrak sayıları), QA (%100).
  - **Ayarlar › Risk bayrakları** (Kurucu / Yönetici): bildirim alıcıları, webhook, "acil" önceliğin hedef ekibi (AU-01).
  - **Görünürlük:** Ekip Üyesi bayrağın varlığını ve türünü görür. Gerekçe notu ve kanıtı yalnızca Sorumlu Oyun ekibi, Ekip Lideri ve üstü görür (RL-02).
- **Mevcut kod karşılığı:**
  - **Bayrak modeli yok.** Serbest etiketler var: `Tag`, `ThreadTag` (`apps/api/prisma/schema.prisma:952`, `:1095`). RTM'de `thread_tagged` / `thread_untagged` (`packages/types/src/rtm.ts:154-155`).
  - **Oyuncu:** `Customer` (`schema.prisma:389-426`) organizasyon kapsamlı; risk alanı yok.
  - **Devir:** Neden yalnızca `ai_handoff` (`services/ai/ai-responder.ts:188-198`).
  - **Kampanyalar:** `services/campaigns/campaign-matching.ts`, `campaign-trigger.ts` riske bakmıyor (EN-01).
  - **Webhook:** Olay kataloğu `services/webhooks/webhook-service.ts` (`WEBHOOK_ACTIONS`) ve `packages/types/src/integrations.ts` (`INTEGRATION_TRIGGERS`; ikisi testle eşitleniyor).
- **Eklenecek / değişecek yerler:**
  - **Prisma ve migration:**
    - `risk_flags`: `id`, `license_id`, `scope` (`chat` | `member`), `chat_id?`, `thread_id?`, `customer_id?`, `member_key?` (ID-03), `type` (`rg_signal` | `self_exclusion_request` | `underage_suspected` | `self_harm` | `complaint_formal` | `fraud_suspected` | `account_takeover_suspected` | `multi_account` | `abusive` | `account_security`), `severity` (`info` | `high` | `urgent`), `source` (`ai_rule` | `ai_classifier` | `agent` | `qa`), `rule_ref` (`G1`…), `evidence_event_ids text[]`, `note`, `basis` (`declared` | `verified`), `status` (`active` | `cleared`), `raised_by`, `raised_at`, `cleared_by?`, `cleared_at?`, `clear_reason?`.
    - Satır silinmez, yalnızca durum değişir.
    - RLS `license_id`. İndeksler `(license_id, status, type)`, `(license_id, customer_id) WHERE status='active'`.
    - **Not:** `customers` organizasyon kapsamlı olduğu için bayrak lisans kapsamında tutulur.
  - **Tipler:** `RISK_FLAG_TYPES`, tür başına varsayılan şiddet, kapsam ve kaldırma yetkisi. `riskPolicy(flags) → { noPromotions, noBonusTalk, mustHandoff, priority, targetTeamKey }` saf fonksiyonu web, API ve widget yapılandırmasında ortak kullanılır.
  - **API:**
    - `services/risk/risk-flags.ts` (koy, kaldır, etkin bayraklar, politika).
    - Rotalar: `POST /chats/{id}/risk-flags`, `DELETE /risk-flags/{id}` (gövdede gerekçe zorunlu), `GET /customers/{id}/risk-flags`, `GET /risk-flags` (rapor ve arşiv filtresi).
    - AI motoru (AI-08 / AI-09) bayrağı devirle aynı transaction'da koyar.
  - **Kampanya kancası (EN-01):** `campaign-matching.ts` etkin `noPromotions` bayrağı olan oyuncuyu ve o oturumu hedeflemez. Widget yapılandırma yanıtında kampanyalar bastırılır.
  - **Inbox kancası:** Bayraklı sohbette ajan promosyon etiketli bir hazır yanıt eklerse uyarı gösterilir (opsiyonel: `canned_responses` tablosuna `is_promotional` alanı).
  - **RTM:** Yeni push'lar `risk_flag_raised` ve `risk_flag_cleared` (üyelere ve süpervizörlere).
  - **Webhook:** `risk_flag.raised` / `risk_flag.cleared` (S4). `INTEGRATION_TRIGGERS` ile eşitlenir. Payload'da metin yok; yalnızca tür, chat ID ve üye anahtarı.
  - **Bildirim:** `urgent` bayraklarda (`self_harm`, `underage_suspected`, `self_exclusion_request`) Ekip Liderine, Sorumlu Oyun ekibine ve seçilen e-posta adresine.
  - **Web:** `ThreadHeader.tsx` ve `DetailsPanel.tsx` (Risk bölümü), arşiv filtresi, `features/settings/RiskFlags.tsx`, Raporlar'da bayrak kartı.
  - **Testler:** Politika fonksiyonu, kampanyanın bastırılması (negatif test: bayraklı oyuncuya kampanya gönderimi oluşmaz), kaldırma yetkisi ve gerekçe zorunluluğu, ekip ve rol görünürlüğü, webhook payload'ında metin olmaması, RLS.
- **Kodlama mantığı:**
  1. **Bayrak koyma:**
     - **AI:** AI-05/AI-08 sınıflandırması her oyuncu mesajında `risk_signals[]` döndürür. Hızlı model JSON çıktısının yanında anahtar kelime güvenlik ağı bulunur: "intihar", "kendimi öldür", "kendimi kapatmak istiyorum", "15 yaşındayım", "okuldan"… gibi.
       - Sinyal bir G kuralına karşılık geliyorsa bayrak ve devir tek transaction'da yapılır.
       - `self_harm` / `underage_suspected` / `self_exclusion_request` → şiddet `urgent`; AI-12 acil öncelik ve Sorumlu Oyun ekibi.
     - **Ajan:** Inbox'tan bayrak ekler. Not isteğe bağlı, tür zorunlu.
  2. **Kapsam (S1):** `rg_signal`, `self_exclusion_request` ve `underage_suspected` hem `chat` hem `member` kapsamlı yazılır. `basis` F1'de her zaman `declared` olur (S3). Diğer türler yalnızca `chat` kapsamlıdır.
  3. **Politika uygulaması:** Her AI turunda etkin bayraklar okunur (sohbet + üye) ve `riskPolicy` çalıştırılır.
     - `noBonusTalk`:
       - AI prompt'una "bonus, promosyon, yatırım önerisi yasak" kuralı eklenir;
       - bonus/promosyon prosedürleri (AI-03) insan yönlendirmesine çevrilir;
       - AI-08 çıktı denetimi bu kelimeleri engeller.
     - `noPromotions`: kampanya motoru ve widget kampanyaları kapatır.
     - `mustHandoff`: AI yanıt üretmez; sohbeti devreder.
  4. **Görünürlük:** Bayrak türü ajan ekranında gösterilir. Not ve kanıt ise sağlık ve bağımlılıkla ilgili olabilecek hassas bilgi olduğu için rol kısıtlıdır.
  5. **Kaldırma (S2):**
     - Gerekçe zorunlu. `rg_signal` / `self_exclusion_request` / `underage_suspected` için Yönetici ve üstü yetki gerekir.
     - Kaldırma AI-21'e değil `audit_log`'a (`risk_flag.cleared`) ve bayrak satırına yazılır.
     - `self_exclusion_request` bayrağının kaldırılması operatörün self-exclusion kararını değiştirmez. Bu yalnızca destek tarafındaki işarettir ve ekranda böyle açıklanır.
  6. **Sonraki ziyaret:** Aynı üye ertesi gün geldiğinde (ID-03 eşleşmesi) üye bayrakları yeni sohbet açılır açılmaz uygulanır. AI ilk turundan itibaren promosyonsuz konuşur ve ajan çipi görür.
  7. **Raporlar ve QA:** Bayraklar AI-25'e (`flags`) ve AI-24'e (%100 inceleme) akar.
- **Kabul kriterleri:**
  - "Hesabımı kapatmak istiyorum, oynamayı bırakacağım" mesajı aynı transaction'da `self_exclusion_request` (urgent) bayrağı koyar ve Sorumlu Oyun ekibine devreder. AI bonus ya da alternatif önermez (AI-19 uyum senaryosu).
  - Bayraklı oyuncunun sonraki ziyaretinde kampanya gösterilmez (`campaign_sends` satırı oluşmaz).
  - Ekip Lideri bir `rg_signal` bayrağını kaldıramaz; Yönetici gerekçe yazarak kaldırabilir. İşlem audit'e düşer.
  - Arşivde "risk bayrağı = sorumlu oyun" filtresi doğru sohbetleri getirir.
  - Webhook payload'ında mesaj metni bulunmaz.
  - Ekip Üyesi bayrak notunu göremez (API seviyesinde).
- **Riskler / notlar:**
  - **KVKK:** Sağlık/bağımlılık çağrışımlı veri özel nitelikli kişisel veri sayılabilir. Saklama süresi ve oyuncunun silme talebine karşı yasal saklama yükümlülüğü hukuki görüş ister. Self-exclusion kaydının silinmesi regülasyona aykırı olabilir.
  - **Yanlış eşleşme:** Beyana dayalı üye eşleşmesi yüzünden bayrak yanlış kişiye düşebilir (S3).
  - **Yanlış pozitif:** "Kendimi kapatmak" gibi ifadeler belirsizdir. Emin olunamayan durumda devir yapmak (fazla devir) kabul edilen bir yanlıştır.

### AI-28 — Araç (entegrasyon) yuvası
- **Alan (panelde nerede, kim kullanır):**
  - **Prosedür editörü (AI-03):** "Sistem kontrolü adımı" ekleme (Ekip Lideri taslakta, Yönetici yayında).
  - **Ayarlar › Entegrasyonlar › iGaming araçları** (F2): Kurucu / Yönetici bağlantı kurar. F1'de yalnızca katalog "bağlı değil" durumunda görünür.
  - **Raporlar:** "Otomatik kontrol edilemediği için devredilen" sayısı (Yönetici).
- **Mevcut kod karşılığı:**
  - **Adım tipleri:** Kapalı bir liste (`packages/ai-mock/src/steps.ts:18-56`); doğrulama `validateSteps`.
  - **Model sınırı:** Model araç çağırmıyor (`docs/adr/pilot-llm-embedding-provider.md` §6).
  - **Araç tanım deseni:** `apps/api/src/services/mcp/tool-catalog.ts` (zod + elle yazılmış JSON Schema + `requiredScopes`) ve `tool-dispatch.ts`. Audit eylemi `mcp.tool_called` (`services/audit/audit-log.ts`).
  - **Mevcut sahte entegrasyonlar:** `apps/web/src/features/playbook/templates.ts:502-692` (`shopify-order-lookup` vb.), `packages/types/src/apps.ts` (uygulama kataloğu, sahte OAuth).
- **Eklenecek / değişecek yerler:**
  - **Tipler:** `packages/types/src/igaming-tools.ts`:
    - `ToolDefinition { key, title_tr, description, input_schema (JSON Schema), output_schema, kind: 'read' | 'write', requires_verified_identity, timeout_ms, phase: 'f2' }`.
    - Platform kataloğu `IGAMING_TOOL_CATALOG`: `deposit_lookup`, `withdrawal_status`, `kyc_status`, `bonus_status`, `bet_lookup`, `account_status`, `limit_status`. Hepsi okuma amaçlı.
  - **Adım tipi:** `steps.ts` içine `call_tool` eklenir (ADR-14 uyumlu; Skill/prosedür adımı):
    - `{ type: 'call_tool', tool: 'deposit_lookup', inputs: { username: 'slot:username', amount: 'slot:amount', time: 'slot:datetime' }, on_unavailable: 'continue' | 'handoff', on_error: 'handoff', branches?: [{ when: 'output.status == "credited"', goto }] }`
    - `validateSteps` bunu kabul eder ve girdilerin var olan slot'lara bağlandığını doğrular. Web'deki `step-contract-parity.test.ts` eşitliği korunur.
  - **Motor (F1 davranışı):** `call_tool` adımı çalıştırılmaz.
    - Karar izine `tool_not_connected` yazılır.
    - Konuşma durumuna `pending_checks: [{ tool, inputs }]` eklenir.
    - Akış `on_unavailable` değerine göre sürer.
    - AI-10 devir kartında "Kontrol edilmesi gereken" satırı çıkar.
  - **Simülasyon:** AI-19 senaryoları `tool_outputs` ile sahte araç çıktısı verebilir. Böylece F2 dalları bugünden test edilebilir.
  - **Prisma (F2'de):** `tool_connections` (`license_id`, `brand_id`, `tool_key`, `provider`, `credential_ref`, `status`). Kimlik bilgileri gizli kasada tutulur, veritabanında düz metin olarak durmaz. F1'de bu tablo oluşturulmaz.
  - **Rapor:** AI-25 dökümüne `pending_checks` sayımı eklenir ("en çok hangi kontrol eksik").
  - **Web:** Prosedür editöründe "Sistem kontrolü" adım kartı (araç seçimi, girdi eşleme, araç yokken ne olacağı). Kartta "Faz 2'de etkinleşir" rozeti. Ayarlar'da katalog listesi.
  - **Testler:** Adım doğrulaması, F1'de çalıştırılmama, devir kartında görünme, simülasyonda sahte çıktıyla dallanma.
- **Kodlama mantığı:**
  1. **Tasarım ilkesi (F2'ye şimdiden yazılacak güvenlik kuralları):**
     - Aracı **prosedür motoru deterministik olarak** çağırır; model çağırmaz (ADR §6 korunur, S2).
     - Modelin işi slot doldurmaktır. Araç girdileri **doğrulanmış slot değerlerinden** gelir.
     - `requires_verified_identity` olan araçlarda oyuncu kimliği slot'tan değil, **doğrulanmış oturum iddiasından** gelir (F2'de operatörün imzaladığı widget kimlik belirteci).
  2. **Araç çıktısı:** Çıktı veridir, talimat değildir. Prompt'a yapılandırılmış alanlar olarak girer (prompt injection koruması). Oyuncuya söylenecek durum, prosedürün yanıt kalıbından üretilir.
  3. **Yazma araçları:** F2 kapsamında bile varsayılan olarak kapalıdır. Açılırsa oyuncunun açık onayı ve AI-20 uyum onayı gerekir.
  4. **F1 akışı:** `call_tool` → `pending_checks` → `on_unavailable` (çoğunlukla `handoff`). AI "kontrol ettim" demez (G8). Devir kartında şu satır görünür: "Kontrol edilmesi gereken: yatırım sorgusu — kullanıcı adı ali123 (beyan), 2.500 TRY, 13:42".
  5. **Ölçüm:** Her `pending_check` bir sayaç olur ve F2 önceliklendirmesine veri sağlar.
  6. **F2 hazırlığı:** Dağıtıcı (dispatcher), MCP `tool-dispatch.ts` desenini izler: zaman aşımı, kiracı ve marka kapsamı, audit (`ai.tool_called`), araç başına oran sınırı, devre kesici.
- **Kabul kriterleri:**
  - `call_tool` adımı olan bir prosedür kaydedilebilir. Var olmayan slot'a bağlı bir girdi doğrulamada reddedilir.
  - F1'de bu adıma gelen konuşmada dışarıya hiçbir istek atılmaz. Devir kartında "Kontrol edilmesi gereken" satırı görünür.
  - AI-19 simülasyonunda `tool_outputs.deposit_lookup = { status: 'credited' }` verilince prosedür "hesaba geçmiş" dalına gider. Aynı senaryo canlıda (F1) devirle biter.
  - Raporda "otomatik kontrol edilemediği için devredilen" sayısı araç bazında görünür.
- **Riskler / notlar:**
  - **ADR ve kapsam:** F2'de ADR §6 yeniden açılmalı. KN-06'nın sağlayıcı API'leri (BetConstruct, EveryMatrix) bu şemaya göre değerlendirilmeli.
  - **Şema kayması:** Katalog alanları F2'de sağlayıcıya göre değişebilir. Şema sürümlü tutulmalı (`input_schema_version`).
  - **Kapsam disiplini:** P2 / F2 bir madde olduğu için F1'de yalnızca şema, adım tipi ve devir kartı kısmı yapılmalı.

### AI-29 — Şeffaflık ve "insanla görüş" butonu
- **Alan (panelde nerede, kim kullanır):**
  - **Widget (oyuncu):** AI konuşurken başlıkta ya da yazma alanının üstünde "Temsilciyle görüş" butonu.
  - **AI Agent (Playbook) › Profil:** AI açılış mesajı (Yönetici).
  - **Ayarlar › Widget › Metinler** (WG-05): buton ve devir metinleri (Yönetici).
  - **Ajan:** Devir nedeni olarak "Oyuncu insan istedi (buton)" görür.
- **Mevcut kod karşılığı:**
  - **Widget AI işareti:** `apps/widget/src/widget.ts:2958-2966` (`isAiMessage`), `:3022` (`aria-label` = `message.aiLabel`). TR metni `apps/widget/src/locales/tr.ts:47`. Test `widget.aiLabel.test.ts`.
  - **Başlık:** Persona adı ve ajan gösterimi `widget.ts:423-445` (FR-MOD-11.3).
  - **Hoş geldin mesajı:** Genel (`widget.ts:149-151`, `:2352-2358`; migration `20261013090000_widget_welcome_message`). AI'a özel açılış yok (eksikler [A-11]).
  - **Oyuncu mesaj ucu:** `routes/customer.ts:644` (`POST /customer/chat/events`). Yanıt sırası `:380-389` (önce rule bot, sonra AI).
  - **Devir:** `services/ai/ai-responder.ts:174-198` (`#transfer`, yalnızca adlandırılmış ekip).
- **Eklenecek / değişecek yerler:**
  - **Kontrat (`paths/customer-chat.yaml`):** `POST /customer/chat/request-human` (idempotent; gövde `{ reason?: 'button' }`). `GET /customer/chat` yanıtına `owner: 'ai' | 'human' | 'queue'` ve `human_available` alanları eklenir.
  - **API (`routes/customer.ts`):** Yeni rota. Sohbetin AI'da olduğu doğrulanır ve AI-09 devir servisi `reason: 'player_request'` ile çağrılır. Hedef ekip AI-12 eşlemesinden (konuya göre ya da varsayılan) gelir. Kiracı mesaisine göre şablon metin seçilir. AI-11 gereği AI susar.
  - **Persona:** `ai_agents.persona.welcome` (A-11) ve kilitli şeffaflık cümlesi. Doğrulama `packages/types/src/persona.ts` içinde.
  - **Widget (`widget.ts`):**
    - `owner === 'ai'` iken her zaman görünen buton.
    - Tıklanınca POST atılır; buton "Temsilci bağlanıyor…" durumuna geçer; başarıda gizlenir.
    - Klavye erişimi ve `aria-label`.
    - Yeni locale anahtarları (`locales/*.ts`, WG-02 dilleriyle).
  - **Web:** `ProfileForm.tsx` içinde açılış mesajı alanı (şeffaflık cümlesi kilitli önizlemeyle). `WidgetCustomization.tsx` içinde metinler. Inbox devir nedeni etiketi.
  - **Testler:** `widget.requestHuman.test.ts` (görünürlük kuralları, idempotens), API entegrasyonu (devir, mesai dışı şablonu, oran sınırı), E2E (oyuncu butona basar → ajan sohbeti kuyrukta görür).
- **Kodlama mantığı:**
  1. **Açılış:** AI'ın ilk mesajı her zaman şeffaflık cümlesini içerir: "{asistan_adı}, {marka}'nın yapay zekâ asistanıyım." Kiracının açılış metninde bu yoksa sistem başa ekler. Persona kaydında uyarı gösterilir; cümle kaldırılamaz (G16).
  2. **Buton görünürlüğü:** `owner === 'ai'` (sohbet AI'da, AI-11 durumu) iken görünür. İnsan atanınca ya da sohbet kuyruğa düşünce gizlenir. Kiracı gizleyemez (S1); yalnızca metnini değiştirebilir.
  3. **Tıklama:**
     - Sunucuda idempotent çalışır (aynı bağlantıda ikinci istek aynı sonucu döndürür).
     - Oran sınırı uygulanır (GV-01).
     - AI-09 devri tetiklenir ve `handoff_reason = player_request` yazılır (AI-25).
     - Netleştirme sorusu sorulmaz: buton zaten açık bir taleptir. Yazıyla "insan istiyorum" denirse AI-09 en fazla 1 netleştirme sorusu sorabilir.
  4. **Mesai dışı (S2):** `WorkSchedule` ve ekip uygunluğu kontrol edilir. Kimse yoksa şablon metin gönderilir ("Temsilcilerimiz şu an çevrimdışı, {saat} itibarıyla dönüş yapılacak"). Sohbet kuyrukta kalır ya da WG-08 / HD akışıyla ticket'a dönüşür. AI susmaya devam eder.
  5. **Erişilebilirlik:** Buton odaklanabilir olmalı, kontrast kurallarına uymalı ve dar ekranda taşmamalı.
  6. **Ölçüm:** Butona basma oranı ve AI'ın başlamasından butona basılana kadar geçen süre AI-25'e gider. Bu süre kısaysa AI'a güven düşük demektir.
- **Kabul kriterleri:**
  - AI'ın ilk yanıtı şeffaflık cümlesini içerir; kiracı metninden bu cümle silinse bile içerir.
  - Sohbet AI'dayken buton görünür; insan atandıktan sonra görünmez.
  - Butona basıldıktan sonra AI başka mesaj yazmaz ve sohbet doğru ekip kuyruğunda görünür. Devir nedeni `player_request` olur.
  - Mesai dışında oyuncu doğru şablon metni görür ve sohbet kaybolmaz.
  - Aynı butona iki kez basmak iki devir oluşturmaz.
  - Widget testleri TR ve EN metinleri doğrular. Ekran okuyucu butonu doğru adlandırır.
- **Riskler / notlar:**
  - **Yük:** "Hemen insan" butonu AI kullanımını düşürebilir. Bu kabul edilen bir bedel (G16); AI-25'te izlenmeli.
  - **Kural bot önceliği:** Rule bot (`routes/customer.ts:380-389`) sohbeti devralmışsa butonun davranışı da tanımlanmalı (önerilen: rule bot sohbetlerinde de görünsün).
  - **Hukuki:** AB Yapay Zekâ Yasası'nın 50. maddesine ilişkin yorum hukuki teyit ister.

### AI-30 — Çok dilli yanıt
- **Alan (panelde nerede, kim kullanır):**
  - **AI Agent (Playbook) › Profil › Diller** (Yönetici): varsayılan dil, izinli diller, "Türkçe bilgiden çeviriyle yanıt" anahtarı (dil bazında).
  - **Widget:** Oyuncu kendi dilinde yanıt alır.
  - **Ajan:** Devir kartında oyuncunun dilini ve Türkçe özeti görür.
  - **Raporlar:** Dil kırılımı (AI-25).
- **Mevcut kod karşılığı:**
  - **Dil listesi:** `packages/types/src/persona.ts:56` (`PERSONA_LANGUAGES = ['en','tr','de','fr','es']`).
  - **Algılama:** `:472-506` `detectLanguage` (durak kelimeleri; berabere ya da kısa mesajda `null`), `:532-546` `personaLanguageVerdict`.
  - **Sessiz atlama:** `services/ai/skill-engine.ts:269-280` (desteklenmeyen dilde `declined` → `skipped`; yanıt yok, devir yok).
  - **Prompt:** `services/ai/provider/answer-prompt.ts:70-72` (yanıt dili talimatı).
  - **Arayüz:** Widget dilleri `apps/widget/src/locales/` (ar, de, en, es, fr, it, pt, tr). Persona dil seçimi `features/playbook/ProfileForm.tsx`.
- **Eklenecek / değişecek yerler:**
  - **Tipler:** `PERSONA_LANGUAGES` listesine `ru` ve `az` eklenir (S2); `detectLanguage` sözcüksel yedek için durak kelimeleri genişletilir. Persona'ya `defaultLanguage` (varsayılan `tr`), `translateFromKnowledge: Record<lang, boolean>` ve `disclaimerOnTranslation` eklenir.
  - **Motor:** Dil, AI-05 sınıflandırma çağrısının JSON çıktısına eklenir: `{ language: 'ru', confidence }`. Mock modda `detectLanguage` kullanılır. Konuşma durumunda `conversation_language` tutulur.
  - **Desteklenmeyen dil:** `skill-engine.ts:279` dalı `declined` + `skipped` yerine şablon mesaj + AI-09 devri (`reason: 'unsupported_language'`) + AI-22 kaydı olur.
  - **Prompt (`answer-prompt.ts`):** Hedef dil ve çeviri kuralları eklenir: "Sayıları, para birimlerini, limitleri, süreleri ve yöntem adlarını aynen koru. Bilgide olmayanı ekleme." Gerekirse kural notu eklenir.
  - **AI-08:** Yasaklı ifadeler ve çıktı denetimi hedef dilde de çalışır. Sözlük her dil için ayrı tutulur ya da `fast` modelle anlamsal denetim yapılır.
  - **Devir kartı (AI-10):** `player_language` ve Türkçe özet.
  - **Yönlendirme (AU-01):** Dile göre ekip (uzmanlık) eşlemesi; mevcut `Expertise` modeli (`schema.prisma:739`) kullanılabilir.
  - **Widget:** WG-02 ile `ru` ve `az` locale dosyaları eklenir.
  - **Web:** `ProfileForm.tsx` dil ayarları ve AI-25'te dil filtresi.
  - **Testler:** Dil yapışkanlığı ("ok" / "tamam" dili değiştirmez), RU mesaja RU yanıt (mock), desteklenmeyen dilde devir ve kayıt, çeviride sayıların korunması (fixture: "Papara min 100 TL" → RU yanıtta "100 TL"), yasaklı ifadenin RU karşılığının yakalanması.
- **Kodlama mantığı:**
  1. **Algılama:** Her oyuncu mesajında sınıflandırma çağrısı dili de döndürür. Güven 0,7'nin altındaysa ya da mesaj 3 kelimeden kısaysa mevcut `conversation_language` korunur. Değişiklik ancak **iki ardışık** güvenli mesaj aynı yeni dili gösterirse yapılır. Konuşma başında hiç sinyal yoksa marka ya da widget dili, o da yoksa `defaultLanguage` kullanılır.
  2. **Destek kararı:**
     - Dil izinli ve bilgi o dilde varsa → doğrudan yanıt.
     - Dil izinli, bilgi yalnızca Türkçe ve `translateFromKnowledge[lang]` açıksa → sadık çeviriyle yanıt (+ isteğe bağlı not).
     - Dil izinli değilse → şablon mesaj (algılanan dilde; yapılamıyorsa EN) + devir + AI-22 kaydı.
  3. **Kritik konularda koruma:** Ödeme, bonus ve KYC yanıtlarında çeviri çıktısı sayı, para birimi ve süre açısından kaynak parçayla karşılaştırılır (basit regex ile sayı kümesi eşitliği). Uyuşmazlık varsa yanıt gönderilmez ve sohbet devredilir.
  4. **Devir:** Kartta oyuncunun dili ve Türkçe özet bulunur. Ajan Copilot'un çeviri ve yeniden yazma özelliklerini kullanabilir (mevcut `CopilotPanel.tsx`).
  5. **Maliyet:** Dil algılama ayrı bir çağrı değildir; AI-05 çağrısına eklenir.
- **Kabul kriterleri:**
  - Rusça yazan oyuncu Rusça yanıt alır. Sonra "ok" yazınca dil değişmez.
  - Türkçe bilgiden çevrilen Rusça yanıtta "100 TL" ve "30 dakika" aynen geçer. Sayılar değiştirilirse yanıt gönderilmez ve sohbet devredilir.
  - İzinli olmayan dilde yazan oyuncu şablon mesajla devredilir. Olay AI-22 listesinde `unsupported_language` nedeniyle görünür (bugünkü sessiz `skipped` ortadan kalkar).
  - Yasaklı bir ifadenin ("garanti", "kesin yatar") RU / EN karşılığı çıktı denetiminde yakalanır.
  - Devir kartında oyuncunun dili ve Türkçe özet görünür.
- **Riskler / notlar:**
  - **Çeviri riski:** Çeviri bir söz verme riski taşır (G7). Sayı koruma kontrolü ve not bu riski azaltır, ama sıfırlamaz. Kiracı dil bazında kapatabilmeli (S1).
  - **Azerice algılama:** AZ ve TR birbirine çok yakın; algılama karışabilir. Pratikte AZ oyuncusuna TR yanıt kabul edilebilir. Kesin ayrım yerine "TR / AZ ortak" davranışı önerilir.
  - **Bağımlılık:** Widget arayüz dilleri (WG-02) bu maddeden bağımsız ilerleyebilir, ama ikisi aynı dil listesini kullanmalı.

---

> Bu parça `05-uygulama-rehberi.md` dosyasının 2., 3. ve 13. bölümleridir. Madde kimlikleri `03-eklenebilecekler.md` ile aynıdır.
> Bütün yollar `nexa-main` köküne göredir ve 2026-10-14'te yalnızca okunarak doğrulanmıştır (satır numaraları o günkü `main` + commit'lenmemiş çalışma kopyasına göredir; kod değiştikçe kayabilir).
> **Varsayım:** ID-02'de **A seçeneği** onaylanır (nexa `chat` = Thread ID / günlük, nexa `thread` = Chat ID / bağlantı). B seçilirse ID-02, ID-05, ID-06 ve ID-08'deki veri modeli kısımları yeniden yazılmalıdır.
> **Repo kuralları:** contract-first sıra (OpenAPI → `@siyahtus/types` → Prisma migration → API → web/widget/mobil → testler), migration'da "önce genişlet, sonra daralt" (`CONVENTIONS.md` §6.3), test başlığında gereksinim etiketi (`CONVENTIONS.md` §7). `MASTER-PROMPT.md`'ye göre chat→thread→event çekirdeği, RLS ve yetki modeli **[MAX]** efor sınıfındadır; ID-02, ID-07, RL-02 ve GV-02 bu sınıfa girer.

---

## 2. Kimlikler, gün içi hafıza ve aranabilir kayıtlar (ID)

### ID-01 — Kimlik sözlüğü
- **Alan (panelde nerede, kim kullanır):** Numara gösteren her ekran (Inbox, arşiv, müşteri profili, ticket, Playbook çalışma kaydı, denetim kaydı, zaman çizelgesi), dışa aktarma başlıkları, API dokümanı. Herkes okur; geliştirici ve AI kodlayıcı tek kaynak olarak kullanır.
- **Mevcut kod karşılığı:**
  - ID biçimi ve doğrulama: `packages/types/src/ids.ts:19-51` (10 karakter Crockford base32; `SHORT_ID_RE`, `EVENT_ID_RE`; `generateShortId`).
  - Modeller: `apps/api/prisma/schema.prisma:781-812` (Chat), `:814-843` (Thread), `:851-887` (Event, `@@id([id, createdAt])`).
  - Ekrandaki tek etiket: `apps/web/src/features/inbox/DetailsPanel.tsx:182-183` (`inbox.details.row.chatId`), `apps/web/src/features/inbox/ThreadHeader.tsx:53-55`.
  - Karar kayıtları: `docs/adr/` (repo kararları burada tutuluyor).
- **Eklenecek / değişecek yerler:**
  - **types:** `packages/types/src/id-glossary.ts` — kimlik türleri kataloğu: `day_thread` (kod alanı `chat_id`), `connection` (kod alanı `thread_id`), `event`, `customer`, `request`, `ticket`, `ai_decision`; her biri için `labelKey`, `codeField`, `pattern`, `shortDescriptionKey`. ID-06'nın kullanacağı `classifyIdentifier(value)` fonksiyonu da burada.
  - **contract:** `packages/contract/openapi/openapi.yaml` ve `paths/chats.yaml`, `customer-chat.yaml`, `webhooks.yaml` içindeki `chat_id` / `thread_id` alan açıklamalarına "Panelde: Thread ID (günlük)" / "Panelde: Chat ID (bağlantı)" notu. Alan adları değişmez.
  - **web:** yeni i18n isim alanı `ids` (`apps/web/src/locales/{tr,en}/ids.ts`): `ids.thread.label = "Thread ID"`, `ids.thread.hint = "Üyenin bugünkü konuşma grubu"`, `ids.chat.label = "Chat ID"`, `ids.chat.hint = "Bu bağlantı"` vb. Bütün ekranlar bu anahtarları kullanır.
  - **docs:** `docs/adr/conversation-day-ids.md` — A/B kararı, eşleme tablosu, gün sınırı kuralı (ID-04), "kod adı ↔ ekran adı" tablosu.
  - **mobile:** `apps/mobile` sabit metinlerinde aynı etiketler (mobilde i18n kataloğu yok; sabitler tek dosyada toplanmalı).
- **Kodlama mantığı:**
  - Çeviri yalnız sunum katmanında yapılır: DB kolonları, API alanları, webhook payload'ları ve log anahtarları kod adlarıyla kalır (`chat_id`, `thread_id`). Böylece RLS politikaları, migration'lar ve dış entegrasyonlar etkilenmez.
  - Dışa aktarmalarda (CSV/NDJSON) başlık "Thread ID (chat_id)" biçiminde iki adı birden taşır; böylece hem sahip hem geliştirici dosyayı okuyabilir.
  - Log görüntüleyici (ID-09) kod anahtarını gösterirken yanında ekran adını tooltip olarak verir.
  - Numara biçimi hiçbir yerde değiştirilmez (önek, tire, küçük harf yok); Ctrl+F ve kopyala-yapıştır her yerde aynı diziyi bulur.
- **Kabul kriterleri:**
  - `id-glossary.ts` bütün kimlik türlerini içerir; birim testi `SHORT_ID_RE`/`EVENT_ID_RE` ile kataloğun tutarlı olduğunu doğrular.
  - Web'de "Chat ID" / "Thread ID" sabit metni yalnız `ids` i18n kataloğunda geçer (ör. kaynakta grep ile doğrulayan birim testi).
  - Contract'taki `chat_id` ve `thread_id` alanlarının açıklamasında ekran karşılığı yazar; `pnpm -w contract:generate` sonrası üretilen tipler senkron.
  - ADR dosyası eşleme tablosunu ve A/B kararını içerir.
- **Riskler / notlar:** Mevcut e2e testleri "Chat ID" etiketine bakıyor olabilir (`apps/e2e/tests/inbox-header-layout.spec.ts`, `inbox-copy-link.spec.ts`); etiket değişikliğiyle birlikte güncellenmeli. Sözlük ID-02 kararı kesinleşmeden yazılmamalı.

### ID-02 — Günlük thread (üye + gün)
- **Alan (panelde nerede, kim kullanır):** Widget (oyuncu; davranış görünmez), Inbox ve arşiv (Ekip Üyesi ve üstü: bir satır = üyenin bir günü, içinde bağlantılar), müşteri profili (geçmiş günler), `Ayarlar → Inbox → Sohbet zaman aşımı` (Yönetici: boşta kalma süresi ve gün sınırı, ID-04).
- **Mevcut kod karşılığı:**
  - Ziyaretçi mesajı yolu: `apps/api/src/routes/customer.ts:676-685` (aktif chat arama), `:813-826` (aktif chat'e ekleme), hemen ardından `chats.start(...)` (yeni chat + thread).
  - Chat servisi: `apps/api/src/services/chat/chat-service.ts` — `start` `:323-360`, `#startInTransaction` `:361-460`, `sendEvent` `:463`, `#closeConversation` `:952-1050` (thread'i kapatır, chat'i pasif yapar, AI çözümünü **thread başına** sayar, kuyruğu boşaltır), `resume` `:1289-1370` (yeni thread'i **işlemi yapan ajana atar**), `transfer` `:1371+` (`chat_access`'i siler ve yeniden yazar `:1414-1415`), `#createChatWithThread` `:1962-2014`, ID ayırma `:2016-2024`.
  - Veritabanı kuralları: `uq_one_active_chat ON chats (license_id, customer_id) WHERE active` ve `uq_one_active_thread` (`apps/api/prisma/migrations/20260722154008_domain_model/migration.sql:718-726`).
  - Otomatik kapanma: `apps/api/src/services/chat/chat-timeout.ts:104-118` (ayar yoksa hiçbir şey kapanmaz), `InboxSettings.chatTimeoutSeconds` (`schema.prisma:2127-2141`).
  - Widget'ın gördüğü: `GET /customer/chat` yalnız en yeni thread'in mesajlarını döner (`customer.ts:533-634`; `listEvents` varsayılanı en yeni thread, `chat-service.ts:242-317`).
  - Puan: en yeni chat'in en yeni thread'ine yazılır (`customer.ts:1106-1127`) — A ile doğru bağlantıya gider.
  - Sayaçlar: müşteri "sohbet sayısı" = nexa chat sayısı (`apps/api/src/services/customers/customer-service.ts:498`); raporlar çoğunlukla `FROM threads` (`apps/api/src/services/reports/report-csv.ts`, `apps/api/src/routes/reports.ts`).
  - Webhook: `chat_started` yalnız yeni chat'te (`chat-service.ts:350-355`; aksiyon listesi `apps/api/src/services/webhooks/webhook-service.ts:29`).
  - Inbox yalnız en yeni thread'i yükler: `apps/web/src/features/inbox/useInbox.ts:97-100`.
- **Eklenecek / değişecek yerler:**
  - **contract:** `paths/chats.yaml` — `Chat` şemasına `local_day` (date) ve `connections` (bugünkü thread özetleri: `id`, `created_at`, `closed_at`, `assignee_id`, `opened_via`, `group_id`); `listChats` öğesine `connection_count`. `GET /chats/{chatId}/events` için `thread_id` parametresi sözleşmede yoksa eklenmeli (servis zaten destekliyor). `paths/webhooks.yaml` — yeni aksiyon `thread_started`; `chat_started` ve `chat_deactivated` payload'larına `thread_id`. `paths/settings.yaml` — gün sınırı alanları (ID-04).
  - **Prisma + migration (yalnız genişletme):**
    - `chats.local_day DATE NULL`, `chats.day_tz TEXT NULL`.
    - `threads.opened_via TEXT NULL` + CHECK (`first_of_day`, `same_day_return`, `agent_start`, `agent_reopen`, `day_rollover`).
    - İndeks `(license_id, customer_id, local_day)` ve kısmi tekil indeks `uq_chat_customer_day ON chats (license_id, customer_id, local_day) WHERE local_day IS NOT NULL` — "üye başına günde tek Thread ID" kuralı veritabanında.
    - `inbox_settings` gün sınırı kolonları (ID-04).
    - Eski kayıtlar için `local_day` doldurulmaz (NULL = "eski model"); tekil indeks onları kapsamaz.
  - **api:**
    - Yeni `apps/api/src/services/chat/conversation-day.ts`: `resolveLocalDay(tx, now)` ve `openOrContinueConnection(tx, tenant, customerId, options)`.
    - `routes/customer.ts` ziyaretçi mesajı yolu bu servisi kullanır; `routes/chats.ts` `POST /chats` (ajan başlatır, `:233`) ve `POST /chats/:chatId/resume` (`:402`) da aynı kuralları uygular. Kanal adaptörleri (Telegram vb.) `chats.start` üzerinden geldiği için oraya da yansır.
    - `customer-service.ts:498` sayaç: bağlantı sayısı (thread) ya da "gün / bağlantı" ikilisi.
    - Webhook `thread_started`; denetim kaydı için kapalı sözlüğe (`AUDIT_ACTIONS`) `chat.connection_opened`.
    - AI-02 için kanca: `listDayConnections(tx, chatId, { excludeThreadId })` → önceki bağlantıların numarası, zamanı, `Thread.summary`, etiketleri.
  - **RTM:** protokol değişmez; aynı gün dönüşte `resume`'daki gibi `incoming_chat` yayınlanır (`chat-service.ts:1361-1368` kalıbı) ve payload yeni thread'i taşır.
  - **web:** transkript, günün bütün bağlantılarını sırayla yükler ve aralarına ayırıcı koyar ("Chat ID C2 · 14:02 · Bonus ekibi"); `ThreadHeader` Thread ID + aktif Chat ID; `DetailsPanel`'de "Bugünkü bağlantılar" listesi; liste satırında "3 bağlantı" rozeti; müşteri profilinde günlere göre gruplu geçmiş.
  - **widget:** akış değişmez (`POST /customer/chat/events`). Oyuncu yalnız güncel bağlantıyı görür (soru 7 ve ID-03 kararına bağlı).
  - **mobile:** `apps/mobile/src/features/inbox/ChatScreen.tsx` ve `Transcript.tsx` aynı API'yi okur; en az bağlantı ayırıcısı ve yeni etiketler.
  - **testler:** `apps/api/test/integration/customer-chat.test.ts` ve `chats.test.ts`'e senaryolar (kabul kriterleri), raporlar için regresyon (aynı veride sayılar aynı), webhook testi; e2e `apps/e2e/tests/widget.spec.ts`, `inbox-reopen.spec.ts`, `csat.spec.ts`.
- **Kodlama mantığı:**
  1. **Gün anahtarı:** `local_day = tarih(şimdi − sınır_saati, saat_dilimi)`. Tek bir fonksiyon (ID-04'teki `localDayKey`) kullanılır; Node ve SQL'de iki ayrı hesap yapılmaz. Kullanılan saat dilimi `chats.day_tz`'ye yazılır (sonradan ayar değişirse kayıt neye göre açıldığını gösterir).
  2. **Ziyaretçi mesajı geldiğinde:**
     - (a) **Aktif chat var:** `local_day` NULL (eski) ya da bugünse → mesaj eklenir (bugünkü davranış). `local_day` geçmiş bir günse ve son olay "devir boşluğu"ndan (varsayılan: boşta kalma süresi, yoksa 30 dk) eskiyse → aktif thread `#closeConversation` yolundan `reason: day_rollover` ile kapatılır, sonra (b)'ye geçilir. Daha yeniyse mesaj eklenir (gece yarısını geçen konuşma bölünmez).
     - (b) **Aktif chat yok:** `(customer_id, local_day = bugün)` ile chat aranır. Varsa → "aynı gün dönüş": chat `active = true`, yeni thread (`assigneeId = null`, `opened_via = same_day_return`), `#startInTransaction`'daki yönlendirme/kuyruk mantığı yeniden kullanılır. `resume()` **kullanılmaz**, çünkü o thread'i ajana atar. Ajanlara görünen sistem olayı (`recipients: 'agents'`, "Üye aynı gün tekrar bağlandı"), `incoming_chat`, trafik güncellemesi, `thread_started` webhook'u ve denetim kaydı yazılır. Spam filtresi bu açılış mesajına da uygulanır. Yoksa → `chats.start` (`local_day = bugün`, `opened_via = first_of_day`).
     - (c) **Yarış:** İki sekme aynı anda ilk mesajı gönderirse `uq_one_active_chat` ya da `uq_chat_customer_day` ihlali (Prisma P2002) yakalanır, kayıt yeniden okunur ve mesaj kazanan bağlantıya eklenir. Bir kez yeniden denenir.
  3. **Ajan yolları:** `POST /chats` (proaktif) aynı çözücüyü kullanır (`opened_via = agent_start`, ajana atanır). `resume`: chat bugünse bugünkü davranış (+ `opened_via = agent_reopen`). Eski günse (varsayılan karar) bugünün chat'i bulunur ya da açılır, yeni thread ajana atanır, `properties.continued_from_chat_id` yazılır; yanıt yeni chat'i döner, web oraya yönlenir.
  4. **Ekip görünürlüğü:** aynı gün dönüşte yeni yönlendirme ekibi `chat_access`'e **eklenir**, eskiler silinmez (günün tamamı görünür kalır). `transfer` bugünkü "değiştir" davranışını korur. Hassas ekip istisnası RL-02 kararına bırakılır.
  5. **Sayaçlar ve raporlar:** thread tabanlı raporlar, SLA, AI çözümü ve puan değişmez. Değişen tek sayaç müşteri profilindeki sohbet sayısı; "gün" ve "bağlantı" diye ikiye ayrılmalı. Home'daki "devam eden sohbet" aktif chat sayıyor (`home-service.ts:144`); üye başına zaten tek aktif chat olduğu için değişmez.
  6. **Performans ve RLS:** gün araması `(license_id, customer_id, local_day)` eşitliğiyle yapılır; eşitlik operatörleri RLS altında indeksle çalışır. Yeni tablo yok; yeni kolonlar mevcut RLS politikalarını miras alır.
  7. **Saklama ve silme:** chat silinince thread ve mesajlar zincirleme silinir (mevcut); GDPR silme (`services/retention/erasure.ts`) etkilenmez.
  8. **Saat kaynağı:** testlerde günü değiştirebilmek için servis saati enjekte edilebilir olmalı (`ai-daily-budget.ts`'teki `now?: () => Date` kalıbı).
- **Kabul kriterleri:** (saatler Europe/Istanbul, sınır 00:00, boşta kalma 30 dk)
  - **Senaryo 1 — günün ilk bağlantısı:** 10:00'da ilk mesaj → yeni Thread ID `T1` (`chat.id`) ve Chat ID `C1` (`thread.id`); `chat.local_day` = bugün; `C1.opened_via = first_of_day`.
  - **Senaryo 2 — aynı gün dönüş:** `C1` kapandıktan sonra 14:00'te aynı tarayıcıdan mesaj → Thread ID **yine `T1`**, Chat ID **yeni `C2`**; `GET /chats/T1` `connections` listesinde `[C1, C2]`; `C2` ajana otomatik atanmadan normal yönlendirmeden geçer; ajan ekranında `C1`'in mesajları ayırıcıyla görünür; `thread_started` webhook'u (`chat_id=T1`, `thread_id=C2`, `reason=same_day_return`) gider, `chat_started` gitmez.
  - **Senaryo 3 — ertesi gün:** ertesi gün 09:00'da mesaj → **yeni `T2` ve yeni `C3`**; `T1`'e bağlantı eklenmez.
  - **Senaryo 4 — yenileme ve ikinci sekme:** `C2` aktifken sayfa yenileme, ikinci sekme ya da internet kopması yeni Thread ID ya da Chat ID üretmez.
  - **Senaryo 5 — gece yarısı:** 23:50'de başlayan aktif bağlantıya 00:10'da gelen mesaj aynı `C` ve dünün `T`'sine eklenir. O bağlantı 00:15'te kapanır, 00:40'ta yeni mesaj gelirse yeni `T` + yeni `C` (bugün) açılır.
  - **Senaryo 6 — kapanmamış dünkü bağlantı:** dünden kalan aktif bağlantı 30 dakikadan uzun süredir sessizse, bugünkü ilk mesaj onu `day_rollover` ile kapatır ve yeni `T` + `C` açar.
  - **Senaryo 7 — yarış:** aynı üyeden aynı anda gelen iki ilk mesaj → tek `T`, tek `C`, iki mesaj da `C`'de.
  - **Senaryo 8 — saat dilimi:** İstanbul saatiyle 23:59 (20:59 UTC) ve 00:01 (21:01 UTC) açılan bağlantılar farklı günlere ve farklı Thread ID'lere düşer.
  - **Senaryo 9 — ajan yeniden açma:** dünkü arşivli konuşmada "Yeniden aç" → bugünün `T`'si altında yeni `C` (ajana atanmış), `continued_from_chat_id` dünkü `T`'yi gösterir.
  - **Senaryo 10 — farklı tarayıcı:** aynı kullanıcı adını yazan farklı bir tarayıcı yeni üye ve yeni `T` alır (ID-03).
  - Aynı veri setinde toplam sohbet, AI çözümü, CSAT ve SLA ihlali sayıları değişiklik öncesiyle aynıdır (regresyon testi).
  - Puan, aynı gün dönüşteki güncel bağlantıya (`C2`) yazılır.
  - Başka kiracının lisansı, bu kiracının günlük chat'ini bulamaz ya da devam ettiremez (RLS negatif testi).
- **Riskler / notlar:**
  - "Her dönüşte yeni chat" varsayan testler kırılacak (`customer-chat.test.ts`, `widget.spec.ts`, `csat.spec.ts`, `inbox-reopen.spec.ts`); güncellenmeleri işin parçası.
  - Boşta kalma süresi ayarlanmamış kiracıda "bağlantı" hiç kapanmaz; ID-02'nin anlamlı çalışması için varsayılan süre kararı (04, soru 3) şart. Mevcut kiracılara varsayılanı uygulamak bir davranış değişikliğidir, duyurulmalı.
  - API'yi kullanan dış sistemler için `chat_id` artık "gün" anlamı taşır; ADR ve API dokümanında açıkça yazılmalı.
  - `InboxSettings` marka bazlı ama zaman aşımı taraması `findFirst` ile tek satır okuyor (`chat-timeout.ts:110-113`); gün sınırı da aynı yerden okunmalı ki iki ayar birbirinden ayrışmasın.
  - Commit'lenmemiş `customer_username` çalışması aynı dosyalara (`customer.ts`) dokunuyor; önce ID-03 kapsamında commit'lenmeli.

### ID-03 — Üye tanıma
- **Alan (panelde nerede, kim kullanır):** Widget pre-chat formu ve widget JS API'si (`siyahtus('identify', …)`; operatörün geliştiricisi kurar), `Ayarlar → Güvenlik → Üye kimlik doğrulama` (Kurucu/Yönetici), Inbox sağ paneldeki oyuncu kartında "Doğrulanmış üye" rozeti ve "Olası eşleşmeler" listesi (Ekip Üyesi görür, Ekip Lideri ve üstü bağlar), müşteri detay paneli.
- **Mevcut kod karşılığı:**
  - Widget kimliği: `apps/widget/src/api.ts:184-237` (`connect`; `siyahtus.customer_id` localStorage'da), `:436-450` (`safeGetItem`/`safeSetItem`); iframe `allow-same-origin` ile çalışıyor (`apps/widget/src/loader.ts:161`), yani widget alan adının üçüncü taraf depolaması kullanılıyor.
  - Token ucu: `apps/api/src/routes/auth.ts:188-210` (`customerTokenBody`; `host_origin` için kodun kendi notu: istemci beyanı, kimlik doğrulama sınırı değil), `:1594-1760` (köken kontrolü, `auth_find_customer`, müşteri yoksa oluşturma, token basma).
  - Token: `apps/api/src/services/auth/customer-token.ts` (nexa'nın `CUSTOMER_TOKEN_SECRET`'ı ile HMAC, durumsuz, TTL). Kiracı imzalı kimlik mekanizması yok.
  - Kullanıcı adı (commit'lenmemiş): `schema.prisma:394-396`, `apps/api/prisma/migrations/20261014090000_customer_username/migration.sql`, `customer.ts` `startSchema.username` ve müşteri güncellemesi, `customer-service.ts:317-319` (arama), `apps/web/src/features/customers/CustomerDetailPanel.tsx`, widget pre-chat (`apps/widget/src/widget.ts`, `widget.prechat.test.ts`).
  - Şifreli sır saklama: `apps/api/src/lib/credential-cipher.ts` (AES-256-GCM, `APPS_CREDENTIAL_KEY`).
  - Müşteri organizasyon düzeyinde (`schema.prisma:385-390` açıklaması).
- **Eklenecek / değişecek yerler:**
  - **contract:** `paths/auth.yaml` (`POST /customer/token` gövdesine isteğe bağlı `identity: { user_id, user_hash }`, yanıta `identity_verified`); `paths/settings.yaml` (`GET/PUT /settings/identity-verification`: durum, mod; `POST .../rotate`: yeni sırrı **bir kez** döner); `paths/customers.yaml` (`external_id`, `identity_verified_at` alanları; `GET /customers/{id}/possible-matches`; `POST/DELETE /customers/{id}/links`).
  - **Prisma + migration:**
    - `customers.external_id TEXT NULL` + kısmi tekil indeks `(organization_id, external_id) WHERE external_id IS NOT NULL`; `customers.identity_verified_at`.
    - `customers.username_normalized` (küçük harf + kırpılmış; saklanan üretilmiş kolon) + indeks `(organization_id, username_normalized)`. Arama için, kimlik için değil.
    - Yeni tablo `identity_verification_settings` (license_id PK, `secret_ciphertext`, `previous_secret_ciphertext`, `previous_valid_until`, `mode`: `optional` | `required`) + RLS.
    - Yeni tablo `customer_identity_links` (organization_id, customer_a, customer_b, confirmed_by, confirmed_at, revoked_at) + RLS (org).
    - Commit'lenmemiş `customer_username` migration'ı önce bir görev ve `feat/` dalı altında tamamlanmalı (`CONVENTIONS.md` §2).
  - **api:** `/customer/token` kimlik doğrulama dalı; `routes/customers.ts` olası eşleşmeler ve bağlama uçları (bağlama için RL-02 yeteneği + denetim kaydı `customer.identity_linked` / `customer.identity_unlinked`); `routes/settings.ts` yeni bölüm.
  - **widget:** `siyahtus('identify', { user_id, user_hash })` ve `siyahtus('logout')` komutları (loader → iframe izinli mesaj listesine eklenir); `api.ts connect` kimliği gönderir; `logout` localStorage'daki `customer_id`'yi siler.
  - **web:** `settings-sections.ts`'e yeni bölüm (scope `access_rules`), sır üretme/döndürme ekranı ve sunucu tarafı örnek kod (Node/PHP); oyuncu kartında rozet ve "Olası eşleşmeler (doğrulanmamış)" listesi, "Aynı kişi olarak bağla" düğmesi.
  - **testler:** entegrasyon (aşağıdaki kabul kriterleri), `widget.prechat.test.ts`, e2e `widget.spec.ts` (identify), `customers.spec.ts`.
- **Kodlama mantığı:**
  1. **Varsayılan tanıma:** tarayıcıdaki `customer_id`. Değişiklik yok.
  2. **Kiracı imzalı kimlik:** kiracının sunucusu `user_hash = HMAC-SHA256(kiracı_sırrı, user_id)` üretir ve sayfaya koyar. `/customer/token` sabit zamanlı karşılaştırmayla doğrular (önceki sır geçiş süresi boyunca da kabul edilir).
     - Geçerliyse `(organization_id, external_id = user_id)` ile müşteri aranır. Bulunursa (yasaklı değilse) o müşteri kullanılır, tarayıcıdaki `customer_id` yok sayılır; böylece iki cihaz aynı müşteriye ve ID-02 sayesinde aynı günün Thread ID'sine düşer. Bulunmazsa: tarayıcıdaki müşterinin `external_id`'si boşsa ona yazılır, doluysa yeni müşteri açılır (iki farklı üye asla birleşmez).
     - Geçersizse anonim devam edilir; yanıt farkı yaratılmaz (kahin olmasın), yalnız `warn` log (`license_id`, `reason`). `mode = required` ise doğrulanmamış token basılmaz.
  3. **Pre-chat kullanıcı adı ve e-posta:** müşteriye "doğrulanmamış ipucu" olarak yazılır. Hiçbir zaman müşteri seçmez, birleştirmez, AI bağlamına başka müşterinin verisini getirmez. "Olası eşleşmeler" = aynı organizasyonda `username_normalized` ya da e-posta eşit olan başka müşteriler (en çok 10).
  4. **Ajan onaylı bağlama:** yalnız ajan ekranındaki geçmiş görünümünü birleştirir. ID-02'nin gün çözümlemesi ve AI hafızası **müşteri numarasına** bağlı kalır; bağlanmış başka müşterinin konuşmaları AI'a verilmez.
  5. **AI açıklama kuralı (AI-02 ve AI-08 ile birlikte):** önceki bağlantıların özeti modele "iç bağlam, ayrıntıyı üyeye tekrarlama" etiketiyle verilir. Çıktı denetimi, mevcut konuşmada geçmeyen tutar/IBAN/TXID/belge bilgisinin üyeye yazılmasını engeller.
  6. **Önerilen sertleştirme (P1):** üye numarası bugün fiilen anahtar gibi çalışıyor. Müşteri oluşturulurken rastgele bir `customer_key` üretilir, yalnız hash'i saklanır, widget numarayla birlikte saklar. Var olan müşteri için token, numara + anahtar eşleşirse basılır; anahtarı olmayan eski müşteriye ilk girişte anahtar atanır.
  7. **RLS:** müşteri tabloları organizasyon politikasıyla; yeni tablolar da aynı kalıpla (`app.current_organization` / `app.current_license`) ve kiracılar arası negatif testle.
- **Kabul kriterleri:**
  - Aynı tarayıcıdan aynı gün ikinci bağlantı aynı müşteriye ve aynı Thread ID'ye düşer (ID-02 Senaryo 2).
  - Farklı tarayıcıdan, başka bir üyenin kullanıcı adını ve e-postasını yazan ziyaretçi yeni müşteri olur; AI ona önceki üyenin hiçbir bilgisini vermez; ajan ekranında ilk müşteri "olası eşleşme (doğrulanmamış)" olarak listelenir.
  - Geçerli `user_hash` ile iki farklı cihazdan gelen bağlantılar aynı `customer_id` ve aynı günün Thread ID'sini alır.
  - Geçersiz `user_hash` ile gelen istek, kimliksiz istekle aynı yanıtı alır (durum kodu ve gövde biçimi aynı); log satırı yazılır.
  - Sır döndürüldükten sonra eski sırla üretilmiş hash geçiş süresi bitince reddedilir.
  - Ekip Üyesi "Aynı kişi olarak bağla"yı kullanamaz; Ekip Lideri kullanır ve denetim kaydı oluşur; bağlama geri alınabilir.
  - Başka organizasyonun `external_id`'si eşleşmez (negatif test).
  - Commit'lenmemiş kullanıcı adı işi testleriyle birlikte yeşil (`customers.test.ts`, `customer-chat.test.ts`, widget pre-chat testleri).
- **Riskler / notlar:**
  - Tarayıcılar üçüncü taraf iframe depolamasını siteye göre bölüyor; iOS Safari ayrıca kısıtlayabiliyor. "Aynı tarayıcı" tanıması özellikle iOS'ta gerçek cihazda test edilmeli. Barındırılan sohbet sayfası (`chat.html`) birinci taraf olduğu için etkilenmez.
  - Operatör `user_hash`'i tarayıcıda hesaplarsa sır sızar ve koruma anlamsızlaşır. Ayar ekranında ve dokümanda açık uyarı gerekir; teknik olarak tespit edilemez.
  - `external_id` kişisel veridir; GDPR silme akışı bunu da temizlemeli.
  - Bir organizasyonun birden çok lisansı varsa `external_id` ad alanı organizasyon düzeyinde ortak olur (müşteri organizasyon düzeyinde). Farklı üye tabanlı lisanslar için bu bir kısıt; sahip sorusu olarak not edilmeli.

### ID-04 — Gün sınırı ve saat dilimi
- **Alan (panelde nerede, kim kullanır):** `Ayarlar → Inbox → Sohbet zaman aşımı` (`/app/settings/chat-timeout`) bölümü "Sohbet süresi ve gün sınırı" olarak genişler. Yönetici ve Kurucu düzenler; diğerleri görmez.
- **Mevcut kod karşılığı:**
  - `Organization.timezone` (`schema.prisma:55`, varsayılan `UTC`), kullanım: `chat-service.ts:1209-1219` (yalnız transkript e-postası); şirket ayarları ekranı `apps/web/src/features/settings/CompanyDetails.tsx`.
  - `InboxSettings` (`schema.prisma:2127-2141`), uçlar `apps/api/src/routes/settings.ts:2640-2655` (yazma) ve `:3396-3401` (seri hale getirme), ekran `apps/web/src/features/settings/ChatTimeout.tsx`.
  - UTC gün kullanan yerler: `ai-daily-budget.ts` (`utcDayKey`, `secondsUntilUtcMidnight`), `report-csv.ts` ("AT TIME ZONE 'UTC'").
- **Eklenecek / değişecek yerler:**
  - **contract:** `paths/settings.yaml` chat-timeout şemasına `day_boundary_timezone` (IANA adı) ve `day_boundary_hour` (0–23).
  - **Prisma + migration:** `inbox_settings.day_boundary_tz TEXT NOT NULL DEFAULT 'Europe/Istanbul'`, `day_boundary_hour SMALLINT NOT NULL DEFAULT 0` + CHECK (0–23).
  - **types:** `packages/types/src/conversation-day.ts` — `localDayKey(at: Date, tz: string, boundaryHour: number): string` (YYYY-MM-DD) ve `DEFAULT_DAY_BOUNDARY = { tz: 'Europe/Istanbul', hour: 0 }` (kolon varsayılanıyla birebir aynı; repo bu "kolon varsayılanı = kod sabiti" kalıbını başka ayarlarda da kullanıyor).
  - **api:** doğrulama: `tz` geçerli IANA adı olmalı (`Intl.DateTimeFormat` ile denenir), saat 0–23; ID-02 çözücüsü ayarı zaman aşımıyla aynı yerden okur.
  - **web:** `ChatTimeout.tsx`'e aranabilir saat dilimi seçici + saat seçici + canlı örnek ("Şu an 14 Ekim 13:05 → gün: 2026-10-14"); AI kota göstergesinde sıfırlanma saatinin yerel karşılığı.
  - **testler:** `localDayKey` birim testleri (İstanbul, yaz saati uygulayan bir bölge ör. `America/New_York` geçiş günleri, sınır saati 6, artık gün); ayar ucu entegrasyon testi (geçersiz tz → 400); e2e `settings.spec.ts`.
- **Kodlama mantığı:**
  - Gün anahtarı yalnız `localDayKey` ile hesaplanır; SQL'de ayrıca hesaplanmaz. Bağlantı açılırken bir kez hesaplanıp `chats.local_day`'e yazılır.
  - Ayar değişikliği yalnız bundan sonra açılan bağlantıları etkiler. Ayar gün içinde değişirse aynı üye için ikinci bir günlük kap açılabilir; bu bilinçli kabul edilen bir uç durumdur, ADR'de yazılmalı.
  - Satır yoksa kod varsayılanı (Europe/Istanbul, 0) kullanılır.
  - Raporlar şimdilik UTC kalır; rapor ekranında "Saatler UTC" notu düşülmesi önerilir (RP maddeleriyle birlikte yerelleştirilir).
- **Kabul kriterleri:**
  - Ayar satırı olmayan workspace'te gün sınırı Europe/Istanbul 00:00'dır.
  - `day_boundary_timezone = "Mars/Olympus"` → 400 doğrulama hatası; `day_boundary_hour = 24` → 400.
  - Sınır saati 06:00 iken 05:59'da açılan bağlantı önceki güne, 06:00'da açılan bugüne yazılır.
  - Ayarı değiştirmek mevcut `chats.local_day` değerlerini değiştirmez.
  - Ayar değişikliği mevcut ayar denetim kaydı kalıbıyla kayda geçer.
- **Riskler / notlar:** `InboxSettings` marka bazlı ama okuma `findFirst` ile yapılıyor; gün sınırı fiilen workspace düzeyinde olur. Marka bazlı farklı saat dilimi gerekirse okuma marka çözümüne bağlanmalı (bugün sohbetin markası tutulmuyor).

### ID-05 — ID'lerin arayüzde görünmesi ve kopyalanması
- **Alan (panelde nerede, kim kullanır):** Inbox başlığı ve detay paneli, transkriptteki bağlantı ayırıcıları, arşiv satırları, müşteri profili, ticket paneli ("Kaynak"), Playbook çalışma kaydı, denetim kaydı, zaman çizelgesi (ID-09), widget menüsü (oyuncu: "Destek numaranız"), mobil sohbet ekranı. Bütün roller.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/ThreadHeader.tsx:53-55` (nexa chat numarası yalnız geniş ekranda düz metin), `:128-150` (`CopyLinkButton`: numarayı değil `?chat=` bağlantısını kopyalar, 1,5 sn "Kopyalandı" geri bildirimi var).
  - `apps/web/src/features/inbox/DetailsPanel.tsx:182-183` (seçilebilir metin, kopya düğmesi yok).
  - `apps/web/src/features/inbox/useInbox.ts:97-100` (yalnız en yeni thread).
  - `GET /customer/chat` zaten `chat.id` ve `thread_id` döndürüyor (`apps/api/src/routes/customer.ts:613-619`); widget menüsü `apps/widget/src/widget.ts`.
  - Ticket–sohbet bağı: ticket'ta kaynak chat tutuluyor (thread yok).
  - Mobil: `apps/mobile/src/features/inbox/ChatScreen.tsx`.
- **Eklenecek / değişecek yerler:**
  - **web:** ortak bileşen `apps/web/src/components/CopyId.tsx` (tek aralıklı yazı + kopyala düğmesi + "Kopyalandı" geri bildirimi + `aria-label` "Thread ID'yi kopyala"). `ThreadHeader` iki numarayı da gösterir (dar ekranda taşma menüsünde); `DetailsPanel` iki satır; transkript ayırıcısında Chat ID; müşteri profilinde gün → bağlantı listesi; ticket panelinde "Kaynak: Thread T · Chat C"; Playbook çalışma kaydı satırında Chat ID; denetim kaydında `thread_id` metadata'sı "Chat ID (bağlantı)" etiketiyle.
  - **contract + Prisma:** `tickets.source_thread_id` (nullable, genişletme) ve ticket şemasında alan; `skill_runs.thread_id` (ID-08 ile ortak).
  - **widget:** menüye "Destek numaranız: C…" + kopyala. Çapraz kökenli iframe'de pano yazımı için `apps/widget/src/loader.ts`'teki iframe'e `allow="clipboard-write"` eklenmeli; izin yoksa metin seçili gösterilir.
  - **mobile:** sohbet başlığında iki numara, uzun basınca kopyalama (pano kütüphanesi bağımlılıklarda yoksa eklenmeli).
  - **i18n:** `ids` isim alanı (ID-01), widget 8 dil katalogu (`apps/widget/src/locales/*.ts`).
  - **testler:** `CopyId` birim testi; e2e `inbox-copy-link.spec.ts` genişletilir (iki numaranın kopyalanması), `widget.spec.ts` (destek numarası panel numarasıyla aynı).
- **Kodlama mantığı:** Numaralar her yerde API'den gelen değerden okunur, istemcide türetilmez. Kopyalanan değer yalnız 10 karakterlik numaradır (bağlantı adresi ayrı düğmede kalır). Dar ekranda numara gizlenmez, menüye taşınır. Ekran okuyucu için numaralar karakter karakter okunabilir (`aria-label` içinde boşluklu biçim).
- **Kabul kriterleri:**
  - Inbox'ta bir konuşmada Thread ID ve aktif Chat ID 1024 piksel ve üstünde başlıkta, daha dar ekranda menüde görünür; kopyalanan değer tam olarak 10 karakterlik numaradır ve 1,5 sn "Kopyalandı" gösterilir.
  - Transkriptte her bağlantının başında Chat ID ve saat görünür.
  - Widget'taki "Destek numaranız", paneldeki aktif Chat ID ile aynıdır.
  - Sohbetten açılan ticket'ta iki numara da görünür.
  - Mobil sohbet ekranında iki numara görünür ve kopyalanabilir.
- **Riskler / notlar:** Sandbox'lı iframe'de pano izni tarayıcıya göre değişir; geri dönüş davranışı test edilmeli. Etiket değişiklikleri mevcut e2e testlerini etkiler.

### ID-06 — ID ile arama
- **Alan (panelde nerede, kim kullanır):** Komut paleti (Ctrl+K, bütün roller), arşiv arama çubuğu (AR-01), müşteri listesi araması (mevcut).
- **Mevcut kod karşılığı:**
  - `apps/web/src/components/CommandPalette.tsx:176-230`: müşteri ve ticket araması sunucuda (`/tickets?query=…&limit=6`), sohbetler tarayıcıda son 50 kayıt (`:206-215` notu).
  - `packages/contract/openapi/paths/chats.yaml` `listChats`: `view`, `channel`, `customer_id`, `group_id`, `sort`, `page`; arama yok.
  - `apps/api/src/services/customers/customer-service.ts:310-320` (ad/e-posta/kullanıcı adı `contains`, büyük-küçük harf duyarsız), `apps/api/src/services/tickets/ticket-service.ts:945`.
  - Görünürlük: `apps/api/src/services/chat/access.ts` (`resolveVisibility`, `chatVisibilityFilter`, `canSeeChat`; yetkisizse "yok" sayılır).
  - Log maskelemesi: `apps/api/src/lib/log-redact.ts:152-153` (`query=` ve `email=` maskeleniyor, `q=` maskelenmiyor).
- **Eklenecek / değişecek yerler:**
  - **contract:** yeni `paths/search.yaml` — `GET /search?query=&types=&limit=` → `{ items: [{ kind: chat|connection|event|customer|ticket, chat_id?, thread_id?, event_id?, customer_id?, ticket_id?, title, subtitle, matched_on }] }`.
  - **types:** `classifyIdentifier()` (ID-01 kataloğunda).
  - **api:** `apps/api/src/routes/search.ts` (scope: sohbet, müşteri ya da ticket okuma yetkilerinden herhangi biri); servis `apps/api/src/services/search/lookup.ts`.
  - **Prisma + migration:** `customers.username_normalized` + indeks (ID-03 ile ortak).
  - **web:** `CommandPalette.tsx` sohbet bölümü `/search`'e geçer; sonuçlarda tür rozeti ve numaralar; Enter → `/app/inbox?chat=<T>&thread=<C>`. `InboxPage` yeni `thread` (ve `event`) parametresini okuyup ilgili bağlantıya/mesaja kaydırır.
  - **testler:** entegrasyon `search` (her kimlik türü, görünürlük, kiracılar arası), e2e `command-palette.spec.ts` (50'den eski bir sohbetin numarayla bulunması).
- **Kodlama mantığı:**
  1. Sınıflandırma sırası: mesaj ID biçimi → baştaki bağlantı numarasından thread → chat; 10 karakter → önce `chats.id`, sonra `threads.id` (ikisi de birincil anahtar; tesadüfi çakışmada iki sonuç birden döner); UUID → müşteri (ve ticket numarası UUID ise ticket); e-posta biçimi → `customers.email` eşitliği; diğerleri → müşteri (ad, `username_normalized` önek/eşitlik, e-posta) + ticket konusu (+ ID-07 hazır olunca mesaj metni).
  2. Sohbet sonuçları `chatVisibilityFilter` ile süzülür; görünmeyen sohbet "yok" ile aynı yanıtı alır (var/yok ayrımı sızdırılmaz).
  3. Parametre adı `query` olmalı (`q` değil), çünkü sunucu log maskelemesi `query=`'yi tanıyor. Aranan metin tarayıcı adresine yazılmaz (palet durumu bileşen içinde tutulur; GV-05).
  4. Ajan istek sınırı (dakikada 180) içinde kalmak için istemcide 250 ms bekleme (müşteri aramasındaki mevcut kalıp).
- **Kabul kriterleri:**
  - Thread ID yazınca o günün konuşması açılır; Chat ID yazınca aynı konuşma o bağlantıya kaydırılmış açılır; mesaj ID yazınca mesaj vurgulanır.
  - Üye UUID'si, e-posta ve kullanıcı adı (büyük-küçük harf duyarsız) müşteriyi bulur.
  - En yeni 50 sohbetin dışındaki bir sohbet numarasıyla bulunur.
  - Ekibinin göremediği bir sohbetin numarasını yazan Ekip Üyesi "sonuç yok" görür; yanıt, hiç olmayan bir numarayla aynıdır.
  - Sunucu logunda arama parametresi `query=[redacted]` olarak görünür; tarayıcı adresinde aranan metin yoktur.
- **Riskler / notlar:** Müşteri tablosunda RLS altında `ILIKE '%…%'` indeks kullanamayabilir (ID-07'deki tuzak); büyük operatörlerde (yüz binlerce üye) kısmi eşleşme yavaş olabilir. Önek ya da eşitlik araması `username_normalized` üzerinde yapılmalı ve `EXPLAIN` ile doğrulanmalı; gerekirse ID-07'deki gibi tanımlı-güvenlik (SECURITY DEFINER) fonksiyonuna taşınmalı.

### ID-07 — Mesaj içeriğinde serbest metin arama
- **Alan (panelde nerede, kim kullanır):** Arşiv arama çubuğu (AR-01), Ctrl+K'da "Arşivde ara" modu. Bütün ajanlar, görebildikleri sohbetler içinde; iç notlar yetkiye göre.
- **Mevcut kod karşılığı:**
  - `Event` modeli: `schema.prisma:851-887` (`text` kolonu; `thread/chat/license + created_at` indeksleri; `properties` GIN). Aylık bölümleme bakımı: `apps/api/src/services/chat/event-partitions.ts`; runbook `docs/runbooks/event-partitions.md`.
  - RLS + indeks tuzağı: migration `20260911170000_events_sequence_column` ve `apps/api/test/integration/transcript-page-plan.test.ts` (sızdırmaz olmayan bir ifadenin RLS bariyeri altında indeks koşulu olamadığı ölçülmüş).
  - Eklentiler: `infra/db/init/00-extensions.sql` (pgcrypto, citext, vector; `pg_trgm` yok).
  - Kart numaraları yazılırken maskeleniyor: `apps/api/src/lib/cc-mask.ts`.
  - Arama yokluğu: `chats.yaml` (`query`, `date_from`, `date_to` yok), `CommandPalette.tsx:206-215`.
  - Repo, kiracılar arası okumaları SECURITY DEFINER fonksiyonlarla yapıyor (ör. `auth_resolve_token`, `retention_list_tenants()`, `ai_budget_*`).
- **Eklenecek / değişecek yerler:**
  - **contract:** `listChats`'e `query` (en az 3 karakter), `date_from`, `date_to` (E3 ile ortak); öğeye `match: { event_id, thread_id, snippet, created_at }`. `search.yaml` türlerine `message`.
  - **migration:**
    - `CREATE EXTENSION IF NOT EXISTS pg_trgm` (ayrıca `infra/db/init/00-extensions.sql`; `pg_trgm` PG13+ "trusted" eklenti, ama pilot rolüyle denenmeli).
    - Bölümlü ebeveyne GIN trigram indeksi `events USING gin (text gin_trgm_ops)` (yeni bölümler otomatik alır). Mevcut büyük bölümler için önce her bölümde `CONCURRENTLY` oluşturulup ebeveyn indekse `ATTACH` edilmeli (uzun kilit olmasın).
    - SECURITY DEFINER fonksiyon `search_events(p_license, p_query, p_from, p_to, p_unrestricted, p_group_ids, p_actor_id, p_include_notes, p_limit, p_cursor)` — sabit `search_path`, `license_id = p_license` açık filtre, görünürlük filtresi fonksiyon içinde (`chat_access` ∩ grup listesi veya katılımcı), yalnız gereken kolonlar; `siyahtus_app`'e yalnız `EXECUTE`.
  - **api:** `apps/api/src/services/chat/event-search.ts` (`resolveVisibility` sonucunu fonksiyon parametrelerine çevirir); `routes/chats.ts` `GET /chats` `query` verildiğinde bu yolu kullanır; `GET /search` da kullanır.
  - **web:** arşivde her zaman görünür arama çubuğu (LiveChat dersi 8), tarih aralığı (Reports'taki bileşen), vurgulu snippet, "Bu mesaja git" → `/app/inbox?chat=T&thread=C&event=E`.
  - **testler:** entegrasyon (bulma, görünürlük, iç not, kiracılar arası negatif, tarih sınırı, `%` ve `_` kaçışı, Türkçe harfler); plan testi (transcript-page-plan kalıbında: fonksiyon içinde trigram indeksinin kullanıldığı); e2e arşiv araması.
- **Kodlama mantığı:**
  1. Sorgu normalizasyonu: kırp, çoklu boşluğu teke indir, LIKE özel karakterlerini kaçır, en az 3 karakter.
  2. Tarih aralığı varsayılan son 90 gün, en fazla 400 gün; bölüm budaması bu sayede çalışır.
  3. Sıralama `created_at DESC, id` ile anahtar-kümesi sayfalama, sayfa 50.
  4. Sonuçlar sohbet başına gruplanır (en yeni eşleşme + eşleşme sayısı); snippet sunucuda ±60 karakter.
  5. İç notlar (`recipients = 'agents'`) ajanlar için dahil; müşteri principal'ı bu uca hiç ulaşamaz.
  6. Tanımlı-güvenlik fonksiyonu RLS'i atladığı için kiracı ve görünürlük filtresi fonksiyonun içinde zorunlu ve testli olmalı; güvenlik incelemesinden geçmeli.
  7. Alternatif (sonraki sürüm): `tsvector('simple')` ile kelime araması ve Türkçe kök eşleşmesi.
- **Kabul kriterleri:**
  - "papara 5000" araması, metninde "Papara ile 5000 TL" geçen mesajı bulur; büyük-küçük harf duyarsızdır ve "İSTANBUL" araması "istanbul" geçen mesajı bulur (Türkçe İ/ı testi).
  - Sonuçlar yalnız aramayı yapanın görebildiği sohbetlerden gelir; başka ekibin sohbetindeki eşleşme listelenmez.
  - Maskelenmiş kart numarasının açık hali aranınca sonuç çıkmaz.
  - Tarih verilmezse son 90 gün aranır.
  - Plan testi, büyük veri setinde trigram indeksinin kullanıldığını doğrular; yanıt seed verisinde p95 < 1 sn.
  - Aranan metin tarayıcı adresine yazılmaz.
- **Riskler / notlar:**
  - Trigram GIN indeksi metin boyutunun birkaç katı yer kaplar ve her mesaj yazımında güncellenir (en sıcak tablo); yük testiyle ölçülmeli.
  - Postgres'in `lower`/`ILIKE` davranışı veritabanı locale'ine bağlı; Türkçe noktalı/noktasız i farkı yanlış eşleşme üretebilir. Gerekirse normalize edilmiş bir arama kolonu (`translate` ile İ→i, I→ı) üretilmeli.
  - `LIKE`/`ILIKE` operatörlerinin RLS altında indeksle çalışmayacağı varsayımı `EXPLAIN` ile doğrulanmalı; doğrulanırsa tanımlı-güvenlik fonksiyonu şart, doğrulanmazsa normal sorgu yeterli olabilir.

### ID-08 — Yapılandırılmış ve aranabilir loglar
- **Alan (panelde nerede, kim kullanır):** Doğrudan ekran yok. Tüketiciler: zaman çizelgesi (ID-09), Playbook çalışma kaydı, platform operatörü (sunucu logları). AI karar kaydını görme yetkisi RL-02'ye bağlı.
- **Mevcut kod karşılığı:**
  - Logger: `apps/api/src/server.ts:200-256` (redaksiyon listesi, `req.url` maskelemesi, `genReqId` istemcinin `X-Request-Id`'sini doğrulamadan kabul ediyor `:255`); bileşen alt-logger'ları `server.ts:324-398` (`component: 'llm'` vb.).
  - Tutarsız anahtarlar: `apps/api/src/routes/customer.ts:484,512` (`chatId`) ve `apps/api/src/services/ai/ai-responder.ts:169,184`, `apps/api/src/services/bots/rule-bot-responder.ts:111` (`chat_id`).
  - `SkillRun`: `schema.prisma:1694-1711` (yalnız `chatId`).
  - Denetim kaydı: `schema.prisma:2477-2514`; arşivleme/yeniden açma `thread_id`'yi metadata'da tutuyor (`chat-service.ts:1007-1015`, `:1346-1350`).
  - İz/telemetri köprüsü: `apps/api/src/plugins/telemetry.ts:65`; RTM logger `apps/rtm/src/server.ts`.
  - Pilot log döndürme: `docker-compose.pilot.yml` (10 MB × 5).
  - Testte log yakalama imkânı: `server.ts`'deki `logStream` seçeneği.
- **Eklenecek / değişecek yerler:**
  - **types:** `packages/types/src/log-keys.ts` — `LOG_KEYS` (`license_id`, `organization_id`, `request_id`, `customer_id`, `chat_id`, `thread_id`, `event_id`, `actor_type`, `actor_id`, `job_id`, `ai_decision_id`) ve `LogContext` tipi.
  - **api:**
    - Yeni eklenti `apps/api/src/plugins/log-context.ts` (auth'tan sonra): `request.log = request.log.child({ license_id, organization_id, actor_type, actor_id })`.
    - Yardımcı `bindChatLogContext(request, { chatId, threadId, customerId })`; arka plan işleri (GV-02) bağlamı açıkça taşır.
    - `genReqId`: yalnız `^[A-Za-z0-9._-]{8,64}$` kabul, değilse yeni UUID.
    - `customer.ts:484,512` anahtarları düzeltilir.
  - **RTM:** aynı anahtarlar (`apps/rtm/src/connection.ts` / `auth.ts` girişte bağlam).
  - **Prisma + migration:**
    - Yeni tablo `ai_decision_logs`: `id`, `license_id`, `chat_id`, `thread_id`, `customer_id`, `trigger_event_id`, `reply_event_id`, `request_id`, `job_id`, `decision` (CHECK: `answered`, `asked`, `handoff`, `silent`, `blocked`, `expired`, `cap_reached`), `procedure_id`, `procedure_version`, `step`, `knowledge_source_ids`, `chunk_ids`, `retrieval_scores`, `guardrail_hits`, `handoff_reason`, `risk_flags`, `model`, `llm_input_tokens`, `llm_output_tokens`, `latency_ms`, `error_type`, `details` jsonb (≤ 8 KB), `created_at`.
    - İndeksler `(license_id, created_at DESC)`, `(chat_id, created_at)`, `(thread_id)`; RLS (lisans); chat'e zincirleme silme. Hacim yüksekse `events` gibi aylık bölümleme (`event-partitions.ts` bakımına eklenir).
    - `skill_runs.thread_id` (nullable; eski satırlar doldurulmaz).
  - **saklama:** `apps/api/src/services/retention/policy.ts` ve `erasure.ts` yeni tabloyu kapsar (thread saklama süresine bağlı).
  - **denetim aracı:** `scripts/audit/log-keys.mjs` (salt-okuma; mevcut `scripts/audit/*` kalıbında): log çağrılarında `chatId`, `threadId`, `licenseId`, `customerId` gibi camelCase kimlik anahtarı bulursa hata verir. CI'a bağlanır.
  - **testler:** `logStream` ile entegrasyon testi (bir widget mesajı → AI yolu → her satırda `license_id`, `request_id`, `chat_id`, `thread_id`); karar kaydı içeriği; geçersiz `X-Request-Id`'nin değiştirilmesi; `ai_decision_logs` RLS negatif testi.
- **Kodlama mantığı:**
  - Karar kaydı mesaj metni tutmaz; olaylara numarayla bağlanır (silme ve KVKK kolaylaşır). Tam prompt saklanmaz; "hata ayıklama modu" açıksa ayrı `ai_debug_traces` tablosuna 7 gün TTL ile yazılır (varsayılan kapalı, yalnız Kurucu açar).
  - Karar kaydı, AI cevabıyla aynı işlemde (ya da hemen ardından ayrı küçük işlemde) yazılır; yazılamazsa cevap engellenmez, `error` log düşülür.
  - Karar ve neden sözlükleri `packages/types`'ta sabit listelerdir; DB'de CHECK ile zorlanır (repo enum'ları böyle tutuyor).
  - Kalıcı ve aranabilir kaynak veritabanıdır; ekran çıktısı logları kısa ömürlü teknik iz olarak kalır.
- **Kabul kriterleri:**
  - Sohbet, müşteri ve AI yollarındaki her log satırında `license_id` ve `request_id` vardır; sohbetle ilgili satırlarda `chat_id` ve `thread_id`, müşteri isteklerinde `customer_id` vardır.
  - Denetim aracı camelCase kimlik anahtarı bulmaz (CI yeşil).
  - Her AI turu için tam olarak bir `ai_decision_logs` satırı oluşur; `trigger_event_id`, `decision` ve (varsa) `handoff_reason` doludur.
  - Bir Chat ID ile log dosyasında arama yapılınca o bağlantının AI satırları bulunur.
  - Geçersiz karakterli `X-Request-Id` yeni bir UUID ile değiştirilir.
  - Başka kiracının karar kaydı okunamaz.
- **Riskler / notlar:** Log hacmi artar; kullanıcı adı, e-posta ya da mesaj metni loglanmamalı (mevcut `maskPii` ve redaksiyon kuralları korunmalı). Denetim kaydının varsayılan saklama süresi 30 gün; zaman çizelgesi uzun süreli kanıt için `ai_decision_logs`'a dayanmalı.

### ID-09 — Log / zaman çizelgesi görüntüleyici
- **Alan (panelde nerede, kim kullanır):** Inbox detay panelinde "Zaman çizelgesi" sekmesi ve tam sayfa görünüm (`/app/inbox/timeline?chat=<T>&thread=<C>`); arşiv satırı eylemi. Ekip Üyesi kendi konuşmalarını, Ekip Lideri kendi ekiplerini, Yönetici ve Kurucu hepsini görür (RL-02). Dışa aktarma Yönetici ve Kurucu'da.
- **Mevcut kod karşılığı:**
  - Mesajlar: `ChatService.listEvents` (`chat-service.ts:242-317`, müşteri için iç notları SQL'de süzüyor).
  - Denetim kaydı: `apps/api/src/routes/audit-log.ts:45-51` (filtreler: eylem, işlemi yapan, tarih; hedefe göre arama yok), okuyucu `apps/api/src/services/audit/audit-log-reader.ts`; ekran `apps/web/src/features/audit/AuditLogPage.tsx` (metin araması kapsam dışı, `:14`).
  - AI çalışma kaydı: `GET /skills/{skillId}/runs` (`apps/api/src/routes/playbook.ts`).
  - Puan, SLA ihlali, ticket tabloları; dışa aktarma kalıbı `apps/api/src/routes/reports-export.ts`.
  - Sanal liste: `apps/web/src/components/VirtualList.tsx`.
- **Eklenecek / değişecek yerler:**
  - **contract:** `GET /chats/{chatId}/timeline?thread_id=&kinds=&page_id=&limit=` → öğeler `{ at, kind (message|note|system|ai_decision|assignment|transfer|tag|rating|sla_breach|ticket|audit), actor, chat_id, thread_id, event_id?, text?, details }`; `POST /chats/{chatId}/timeline/export { format: csv|ndjson|txt, thread_id?, mask_pii }`.
  - **migration:** denetim kaydında sohbete göre okuma için indeks `audit_log (license_id, target, created_at)`.
  - **api:** `apps/api/src/services/chat/timeline.ts` (kaynakları birleştirir); yeni denetim eylemi `chat.timeline_exported`; yetenek kontrolleri (`timeline.view`, `timeline.export`, `timeline.export_unmasked`; RL-02).
  - **web:** `apps/web/src/features/timeline/TimelinePage.tsx` ve `TimelinePanel.tsx`; filtreler (tür, bağlantı), sayfa içi süzme kutusu (eşleşmeleri vurgular), satır kopyalama, dışa aktarma penceresi (biçim + maske seçimi). i18n.
  - **testler:** entegrasyon (birleştirme ve sıralama, görünürlük → yetkisize 404, dışa aktarmada maskeleme ve denetim kaydı); e2e (Inbox'tan aç, AI karar satırını metinle bul, CSV indir ve başlıklarda "Thread ID (chat_id)" gör).
- **Kodlama mantığı:**
  1. Kaynaklar: `events` (iç notlar dahil), `ai_decision_logs`, hedefi `chat:<id>` olan denetim kayıtları, `skill_runs`, `ratings`, `sla_breaches`, bu sohbetten açılan ticket'lar. `(at, kind_sırası, id)` anahtarıyla birleştirilir ve sayfalanır.
  2. Görünürlük `resolveVisibility` + `canSeeChat` ile; görünmeyen sohbet 404.
  3. **Ctrl+F dostu çizim:** liste sanallaştırılmaz; 200 satırlık sayfalar "Daha fazla yükle" ile eklenir, yüklenen her satır DOM'da kalır. Sayfa içi süzme kutusu ayrıca sunulur.
  4. Saatler workspace'in saat diliminde (ID-04) ve tooltip'te UTC.
  5. Dışa aktarma akış halinde, en çok 20.000 satır; varsayılan maskeli (`maskPii` + müşteri alanları), maskesiz seçenek yalnız `timeline.export_unmasked` yeteneğinde. Her dışa aktarma denetim kaydı yazar.
  6. Thread ID (gün) görünümünde bağlantılar arasına ayırıcı konur.
- **Kabul kriterleri:**
  - Bir konuşmanın zaman çizelgesinde mesajlar, iç notlar, AI kararları (prosedür, kaynak, devir nedeni), atama, transfer, etiket, kapanış ve puan doğru sırada görünür.
  - Tarayıcının Ctrl+F'i yüklenmiş bütün satırlarda (ekranda görünmeyenler dahil) eşleşme bulur.
  - Ekip Üyesi başka ekibin konuşmasının zaman çizelgesini açamaz (404).
  - CSV dışa aktarma varsayılan olarak e-posta ve kullanıcı adını maskeler; dışa aktarma denetim kaydında görünür.
  - Denetim kaydı saklama süresi dolmuş olaylar için satır yerine "kayıt saklama süresi dolmuş" notu çıkar; ekran hata vermez.
- **Riskler / notlar:** Uzun günlerde (yüzlerce mesaj) birleştirme sorgusu pahalı olabilir; her kaynak kendi indeksiyle sınırlı okunmalı. Dışa aktarma kişisel veri taşır; yetki ve denetim zorunlu.

---

## 3. Roller ve yetkiler (RL)

### RL-01 — Rol seti
- **Alan (panelde nerede, kim kullanır):** `Team → Teammates` (rol sütunu, rol menüsü, davet), `Team → Teams` (ekip lideri atama), rol adının geçtiği her yer (profil menüsü, denetim kaydı, mobil ekip ekranları). Kurucu ve Yönetici yönetir.
- **Mevcut kod karşılığı:**
  - `packages/types/src/domain.ts:8-9` (`AGENT_ROLES = ['owner','viceowner','admin','agent']`).
  - `packages/types/src/role-scopes.ts:20-25` (`ROLE_RANK`), `:32-80` (`DEFAULT_AGENT_SCOPES`), `:83-138` (`ADMIN_SCOPES`), `:148-152` (`defaultScopesForRole`: admin ve üstü aynı set), `:193-196` (`scopesWithinRole`).
  - DB: `agent_memberships_role_check` (`apps/api/prisma/migrations/20260722151255_auth_and_tenancy/migration.sql:304-305`), `invitations_role_check` (`20260724090000_account_lifecycle/migration.sql:45`, yalnız `admin`/`agent`), `uq_license_single_owner` (`20260722151255_auth_and_tenancy/migration.sql:327-329`).
  - Rol değiştirme kuralları: `apps/api/src/routes/agents.ts:640-690`; davet rütbe kontrolü `apps/api/src/services/auth/lifecycle-service.ts:406-413`.
  - Web'de `ROLE_RANK`'in ikinci kopyası: `apps/web/src/features/team/RoleMenu.tsx` (`Role` tipi, `ROLE_RANK`, `assignableRoles`).
  - Ekip üyeliği: `GroupAgent` (`schema.prisma:715-726`; yalnız `priority`, lider bilgisi yok); uçlar `apps/api/src/routes/agents.ts:1044-1066` (`PUT/DELETE /groups/:groupId/agents/:agentId`).
  - SCIM: `apps/api/src/routes/scim.ts:139` (`SCIM_ROLE = 'agent'`); RTM: `apps/rtm/src/auth.ts` (aynı paylaşılan kuralları kullanır).
- **Eklenecek / değişecek yerler:**
  - **types:** `AGENT_ROLES`'a `team_lead`; `ROLE_RANK` yeniden numaralanır: owner 4, viceowner 3, admin 2, team_lead 1, agent 0; `TEAM_LEAD_SCOPES` (= `DEFAULT_AGENT_SCOPES` + ekip lideri ekleri; RL-02'den sonra matristen gelir); `defaultScopesForRole` team_lead'i tanır.
  - **web:** `RoleMenu.tsx` kendi `ROLE_RANK` kopyasını bırakıp `@siyahtus/types`'tan alır (kopya sapma riskini kaldırır). Türkçe etiketler: owner "Kurucu", admin "Yönetici", team_lead "Ekip Lideri", agent "Ekip Üyesi", viceowner "Yönetici (eski: Kurucu yardımcısı)". `TeamEditor.tsx`'e "Ekip lideri" anahtarı; ekip listesinde lider rozeti.
  - **migration (genişletme):** iki CHECK kısıtına `team_lead`; `group_agents.is_lead BOOLEAN NOT NULL DEFAULT false` + indeks `(agent_id) WHERE is_lead`. viceowner → admin taşıması ayrı ve sonraki bir migration'da, sahip onayından sonra (her taşınan üye için `member.role_changed` denetim kaydı, `via: 'migration'`).
  - **contract:** `paths/agents.yaml` rol enum'ları ve grup üyeliği gövdesine `lead: boolean`; `paths/account-lifecycle.yaml` davet rol enum'u.
  - **api:** `agents.ts` rol değiştirme team_lead'i kabul eder; grup üyeliği ucu `lead` alanını yazar (yalnız admin+); davet akışı; principal ve RTM rol doğrulama listeleri.
  - **mobile:** ekip ekranlarında rol etiketleri.
  - **seed / fixtures:** `apps/api/prisma/seed.ts` ve e2e fixture'larında bir Ekip Lideri örneği.
  - **testler:** `role-scopes` birim testi (sıra ve set), `apps/api/test/integration/agents-role.test.ts` (admin team_lead atayabilir; team_lead rol değiştiremez), `role-demotion.test.ts` (team_lead → agent anında etkili), e2e `team.spec.ts`.
- **Kodlama mantığı:**
  - Rütbe karşılaştırmaları `roleAtLeast` üzerinden yapıldığı için team_lead'in admin'in altına yerleşmesi mevcut 87 rol kapısını (`minimumRole` / `exactRole` / `roleAtLeast(..., 'admin')`) değiştirmez; team_lead hiçbir yönetici ekranına kendiliğinden erişemez.
  - Rol adlarının düz liste olarak geçtiği her yer (zod enum'ları, CHECK'ler, UI seçicileri, seed, SCIM, testler) taranmalı (`'viceowner'` araması iyi bir başlangıç).
  - Sayısal rütbe değerleri hiçbir yerde saklanmıyorsa yeniden numaralandırma güvenlidir; bu doğrulanmalı.
  - "Tek Kurucu" kuralı değişmez.
- **Kabul kriterleri:**
  - Ekip sayfasında dört rol Türkçe adlarıyla görünür; Yönetici bir üyeyi Ekip Lideri yapabilir ve bir ekibin lideri olarak işaretleyebilir.
  - Ekip Lideri faturalama, güvenlik ve AI yapılandırma ekranlarını göremez ve bu uçlar ona 403 döner (RL-02 öncesi varsayılan).
  - Veritabanı tanımsız bir rol değerini reddeder.
  - Mevcut owner/admin/agent davranışı regresyon testlerinde değişmez.
- **Riskler / notlar:** Rütbe değişikliği yetki çekirdeğine dokunur; güvenlik incelemesi gerekir. viceowner taşıması geri alınamaz bir veri değişikliğidir; sahibin kararından sonra yapılmalı.

### RL-02 — Yapılandırılabilir izin matrisi
- **Alan (panelde nerede, kim kullanır):** `Ayarlar → Güvenlik → Roller ve izinler` (yalnız Kurucu düzenler; Yönetici salt okunur görür); profil menüsünde "Yetkilerim" (herkes kendi yetkilerini okur).
- **Mevcut kod karşılığı:**
  - Yetki kataloğu `packages/types/src/scopes.ts` (70 scope; `kaynak--erişim:izin`, `expandScope`/`effectiveScopes`); rol → yetki eşlemesi `role-scopes.ts`.
  - Oturum yetkilerinin her istekte rol tavanıyla kesişimi: `apps/api/src/services/auth/token-service.ts:216`, yenilemede `apps/api/src/services/auth/oauth-service.ts:548`, RTM'de `apps/rtm/src/auth.ts:169`.
  - Rota kapıları: `apps/api/src/plugins/auth.ts` (`config.scopes`, `minimumRole`, `exactRole`); `/auth/me` principal'ın yetkilerini döner (`apps/api/src/routes/auth.ts` ~`:885`).
  - Ekranda gizleme: `apps/web/src/components/navigation.ts:57-64` (`isNavVisible`), `apps/web/src/features/settings/settings-sections.ts` (`visibleSections`).
  - Sohbet görünürlüğü: `apps/api/src/services/chat/access.ts` (tüm sohbetler / ekiplerim; "yalnız bana atananlar" modu yok).
  - Ziyaretçi kişisel verisi gizleme örneği: trafik paneli (`traffic.panel.piiHidden`).
- **Eklenecek / değişecek yerler:**
  - **types:** `packages/types/src/capabilities.ts` — yetenek kataloğu: `{ key, group, labelKey, scopes: Scope[], levels?: ['none','own','team','all'], floorRole, ownerOnly?, defaults: Record<AgentRole, value> }`; saf fonksiyon `effectiveScopes(role, overrides)`; yetenek gruplarının örnekleri: Sohbetler (görme: kendi/ekip/hepsi; devralma; arşiv), Oyuncu verisi (e-posta/kullanıcı adı görme; dışa aktarma; silme), AI (taslak; yayın; uyum kuralları), Raporlar (ekip/hepsi), Ekip (davet; rol değiştirme), Ayarlar, Faturalama, Loglar (zaman çizelgesi; dışa aktarma; maskesiz dışa aktarma).
  - **Prisma + migration:** `role_capability_overrides (license_id, role, capability, value TEXT, updated_by, updated_at)` PK `(license_id, role, capability)` + RLS; `licenses.permissions_version INT NOT NULL DEFAULT 0` (önbellek geçersizleştirme).
  - **contract:** `paths/settings.yaml` — `GET /settings/permissions` (varsayılanlar, kiracı değerleri, kilitli hücreler, alt sınırlar), `PUT /settings/permissions` (değişiklik listesi + `reason`; `exactRole: owner`); `/auth/me` yanıtına `capabilities`.
  - **api:**
    - `token-service`: birinci taraf oturumlarda (parola, SAML ile girilen panel oturumu) yetkiler her istekte `effectiveScopes(role, overrides)` ile hesaplanır. Partner OAuth uygulamaları ve PAT'lerde mevcut mantık korunur, ama tavan artık matristen gelen rol setidir.
    - Önbellek: lisans + `permissions_version` anahtarlı, 60 sn TTL; değişiklikte sürüm artar ve Redis pub/sub ile süreçler uyarılır.
    - Kapsam dışı yetenekler için yardımcı `requireCapability(principal, key)` (ör. kişisel veri görme, zaman çizelgesi dışa aktarma).
    - Sohbet görünürlüğüne `own` modu: yalnız atanan ya da katılımcı olunan sohbetler.
    - Denetim kaydı `permissions.changed` (fark + gerekçe) ve bütün Yöneticilere bildirim.
  - **RTM:** `apps/rtm/src/auth.ts` aynı `effectiveScopes` fonksiyonunu ve aynı önbelleği kullanır (iki sürecin aynı cevaba varması şart; `role-scopes.ts` başlık yorumundaki tm 145 dersi).
  - **web:** `apps/web/src/features/settings/PermissionsMatrix.tsx` (satırlar gruplu yetenekler, sütunlar roller; hücre anahtar ya da düzey seçici; kilitli hücrede kilit simgesi ve açıklama; "varsayılana dön"; GV-06 kalıbı: Kaydet → fark özeti → gerekçe → onay); "Yetkilerim" salt okunur listesi. Menü ve ayar bölümleri yetkiye göre zaten gizlendiği için ek iş gerekmez.
  - **testler:** `effectiveScopes` birim testleri (alt sınır, kilit, düzeyler); entegrasyon: Kurucu "Ekip Üyesi raporları görsün"ü açınca ajan **yeniden giriş yapmadan** sonraki istekte raporlara erişir, kapatınca erişimi kaybeder; Kurucu olmayanın `PUT`'u 403; kiracılar arası izolasyon; PAT kendi listesinin ötesine genişlemez; RTM aynı kararı verir; e2e matris ekranı.
- **Kodlama mantığı:**
  1. **Varsayılanlar bugünkü davranışın aynısıdır** (regresyon yok); sahibin verdiği kararlar (04, sorular) varsayılan değişikliği olarak ayrı ve görünür bir adımda uygulanır.
  2. **Alt sınırlar platform güvenliğidir:** her yeteneğin `floorRole`'u vardır (ör. oyuncu silme en az Yönetici, sahiplik devri ve SSO yalnız Kurucu). Matris bir yeteneği alt sınırın altındaki role veremez; rota kapıları (`minimumRole` / `exactRole`) değişmeden kalır ve son söz onlarındır.
  3. **Oturum yetkisi anlamı değişir:** bugün oturum, girişteki listenin rol tavanıyla kesişimi (yalnız daraltır). Matrisle yetki **verilebildiği** için birinci taraf oturumlarda kayıtlı liste yerine anlık hesap kullanılır. Bu, güvenlik incelemesinden geçmesi gereken asıl değişikliktir.
  4. **Ekip düzeyi:** `team` düzeyi bugünkü `chats--access` mantığı; `all` = `chats--all`; `own` yeni.
  5. **Arayüz:** gizleme mevcut scope listeleriyle kendiliğinden çalışır; yetenek tabanlı (scope'suz) özellikler `capabilities` listesinden okunur.
- **Kabul kriterleri:**
  - Hiç değişiklik yapılmamış workspace'te her rolün erişimi bugünküyle birebir aynıdır (mevcut yetki testleri yeşil).
  - Kurucu bir yeteneği açtığında etkilenen kullanıcılar en geç 60 sn içinde, yeniden giriş yapmadan yeni yetkiyi alır; kapattığında aynı sürede kaybeder (API ve RTM).
  - Alt sınırın altına verme denemesi 400 doğrulama hatası döner; kilitli hücre ekranda değiştirilemez.
  - Her değişiklik denetim kaydında fark ve gerekçeyle görünür; Yöneticilere bildirim gider.
  - Başka kiracının matrisi okunamaz ve etkilenmez.
- **Riskler / notlar:** Yetki çekirdeği **[MAX]** sınıfı; güvenlik incelemesi şart. Önbellek gecikmesi (≤ 60 sn) kabul edilebilir mi, sahip bilgilendirilmeli. Matris büyüdükçe ekran karmaşıklaşır; ilk sürümde 20–30 yetenekle sınırlı tutulmalı.

### RL-03 — Ekip Lideri yetenekleri
- **Alan (panelde nerede, kim kullanır):** Inbox'ta "Ekibim" görünümü, izleme ve devralma; arşivde ekip filtresi; raporlarda ekip kapsamı; QA kuyruğu (AI-24); Playbook taslakları (AI-20); zaman çizelgesi (ID-09). Ekip Lideri.
- **Mevcut kod karşılığı:**
  - Devralma: `apps/api/src/routes/chats.ts:452-469` (`scopes: ['chats--all:rw']` + `roleAtLeast(principal.role, 'admin')`).
  - İzleme: `chats.ts:495-510` (`/supervise`), `apps/api/src/services/traffic/supervision-service.ts`; transfer `chats.ts:417`.
  - Görünürlük: `apps/api/src/services/chat/access.ts` (sohbetin ekipleri ∩ kişinin ekipleri).
  - Raporlar: `apps/api/src/routes/reports.ts:200` (`rangeQuery`: yalnız tarih; ekip/ajan filtresi yok).
  - Inbox görünümleri: `apps/web/src/features/inbox/views.ts`.
- **Eklenecek / değişecek yerler:**
  - **api:** yardımcı `ledGroupIds(tx, accountId)` (RL-01'deki `group_agents.is_lead`). Devralma, transfer ve yeniden atama: tüm sohbet yetkisi **ya da** (yetenek `chats.takeover_team` + sohbetin ekipleri ∩ liderlik ettiği ekipler). Rota yapılandırması `chats--access:rw`'yi de kabul eder; asıl kontrol serviste. Raporlarda ekip filtresi (RP-01) ve Ekip Lideri için sunucu tarafında zorunlu ekip kapsamı. Denetim kayıtları mevcut eylemlerle (`chat.taken_over` vb.).
  - **contract:** `GET /chats` için `view=team`; rapor uçlarına `group_id[]` (RP-01 ile ortak).
  - **web:** Inbox'ta "Ekibim" görünümü (AI'ın yürüttükleri dahil), satırda "İzle" ve "Devral"; raporlarda ekip seçici (liderde kilitli); QA ve taslak ekranları ilgili AI maddelerinde.
  - **testler:** lider kendi ekibindeki sohbeti devralır, başka ekiptekine 404 alır; Ekip Üyesi devralamaz; liderin rapor sorgusu yalnız kendi ekibini sayar; e2e `inbox-supervised.spec.ts` genişletilir.
- **Kodlama mantığı:** Liderlik ekip bazlıdır; birden çok ekibin lideri olunabilir. Lider aynı zamanda o ekibin üyesidir (sohbet alabilir). Yetkiler RL-02 matrisinden gelir; bu madde varsayılan değerleri ve sunucu kontrollerini tanımlar. "Bota geri ver" ve devralma sonrası AI'ın susması AI-11'dedir.
- **Kabul kriterleri:**
  - Ekip Lideri kendi ekibindeki aktif sohbeti izleyebilir ve devralabilir; devralma denetim kaydına yazılır.
  - Ekip Lideri başka ekibin sohbetini devralmaya çalışınca 404 alır (matriste açılmadıysa).
  - Ekip Lideri raporlarda yalnız kendi ekiplerinin sayılarını görür; URL'yi değiştirerek başka ekibin verisine ulaşamaz.
  - Ekip Üyesi devralma düğmesini görmez; uca 403 alır.
- **Riskler / notlar:** Birden çok ekipte bulunan sohbetlerde (aynı gün farklı ekiplere giden bağlantılar, ID-02) liderlik kesişimi kuralı açık olmalı: sohbetin ekiplerinden **herhangi biri** liderin ekibiyse yetkili sayılır.

### RL-04 — Davette varsayılan rolün en düşük rol olması
- **Alan (panelde nerede, kim kullanır):** `Team → Davet et` penceresi ve ilk kurulum sihirbazının ekip adımı. Yönetici ve Kurucu.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/team/InviteTeammates.tsx:110` (`useState<'admin' | 'agent'>('admin')`), `:237-248` (rol seçici; yalnız admin/agent).
  - `apps/api/src/routes/account-lifecycle.ts:89-92` (`role: z.enum(['admin', 'agent']).default('admin')`), `:788-860` (`POST /invitations`).
  - `apps/api/src/services/auth/lifecycle-service.ts:406-413` (davet edenin rütbesini aşamama kontrolü).
  - `apps/web/src/features/onboarding/OnboardingWizard.tsx:484` (`role: 'agent'`).
  - `invitations_role_check` (yalnız `admin`/`agent`).
- **Eklenecek / değişecek yerler:**
  - **web:** varsayılan `'agent'`; seçicide her rolün altında kısa açıklama (ChatBot.com'daki iyi örnek); `team_lead` seçeneği ve ekip seçici (lider için zorunlu); Yönetici seçilince uyarı ("Bu rol faturalama ve güvenlik ayarlarına erişir").
  - **api + contract:** `inviteBody.role` varsayılanı `'agent'`, enum'a `team_lead`; `paths/account-lifecycle.yaml` varsayılanı.
  - **migration:** `invitations_role_check`'e `team_lead`; davetle ekip ataması için `invitation_groups (invitation_id, group_id, is_lead)` ya da `invitations.group_ids`; kabulde uygulanır.
  - **testler:** rol belirtilmemiş davet → agent; arayüz varsayılanı; liderde ekip seçimi zorunlu; `invite-seats.test.ts` ve e2e `invite-seat-billing.spec.ts` güncellenir.
- **Kodlama mantığı:** Varsayılan en düşük yetkidir; yükseltme bilinçli bir seçimdir. Sunucu varsayılanı istemciden bağımsız olarak güvenli olmalı (API'yi doğrudan çağıranlar için). Davet edenin rütbesini aşamama kuralı korunur.
- **Kabul kriterleri:**
  - Davet penceresi açıldığında rol "Ekip Üyesi" seçilidir.
  - `POST /invitations` gövdesinde rol yoksa davet `agent` olarak kaydedilir.
  - Ekip Lideri davetinde ekip seçilmeden gönder düğmesi pasiftir; sunucu da ekipsiz lider davetini reddeder.
  - Davet kabul edilince seçilen ekip üyeliği (ve liderlik) uygulanmış olur.
- **Riskler / notlar:** Varsayılan değişikliği, Yönetici varsayılanına dayanan mevcut testleri kırar; testler güncellenmeli.

### RL-05 — Sahiplik (Kurucu) devri
- **Alan (panelde nerede, kim kullanır):** `Ayarlar → Şirket` (`/app/settings/company`) altında "Tehlikeli bölge: Sahipliği devret" (yalnız Kurucu); devralacak kişiye e-posta ve panelde kabul ekranı; ekip listesinde bekleyen devir rozeti.
- **Mevcut kod karşılığı:**
  - `apps/api/src/routes/agents.ts:666-670` (owner'ı taşıma ve owner atama reddi), `apps/web/src/features/team/RoleMenu.tsx` (owner seçeneği yok).
  - `uq_license_single_owner` (`20260722151255_auth_and_tenancy/migration.sql:327-329`).
  - Yalnız-Kurucu rotaları: `apps/api/src/routes/settings.ts` (`exactRole: 'owner'`; SSO, BAA, sandbox), Kurucu'nun SSO muafiyeti `apps/api/src/routes/auth.ts:1894-1905`.
  - E-posta şablonları `apps/api/src/services/mail/templates/messages.ts`; tek kullanımlık token kalıbı (davet, şifre sıfırlama, e-posta doğrulama tabloları).
- **Eklenecek / değişecek yerler:**
  - **contract:** `POST /ownership-transfers` (`target_agent_id`, `password`, isteğe bağlı `totp`), `GET /ownership-transfers/current`, `POST /ownership-transfers/{id}/accept` (`token`), `DELETE /ownership-transfers/{id}`.
  - **Prisma + migration:** `ownership_transfers (id, license_id, from_account_id, to_account_id, token_hash, state, expires_at, created_at, decided_at)` + RLS + kısmi tekil indeks `(license_id) WHERE state = 'pending'`.
  - **api:** servis `apps/api/src/services/team/ownership-transfer.ts`; e-posta şablonu `ownershipTransfer`; denetim eylemleri `ownership.transfer_requested`, `ownership.transfer_accepted`, `ownership.transfer_cancelled`, `ownership.transfer_expired`.
  - **web:** şirket ayarlarında devir bölümü (hedef seçimi, şifre/2FA tekrarı, workspace adını yazarak onay), kabul sayfası (`/join` benzeri), bekleyen devir bandı.
  - **testler:** entegrasyon (aşağıdaki kabul kriterleri), e2e `team.spec.ts` veya yeni spec (mailbox yardımcı `apps/e2e/tests/mailbox.ts` ile).
- **Kodlama mantığı:**
  - Başlatma: Kurucu şifresini (ve 2FA açıksa kodunu) yeniden girer. Hedef aynı lisansın aktif (askıda olmayan), e-postası doğrulanmış üyesi olmalı; workspace 2FA zorunluysa hedefin 2FA'sı açık olmalı.
  - Kabul: hedef giriş yapmış olmalı ve e-postadaki token'ı sunmalı (72 saat). Tek işlemde önce eski Kurucu `admin`'e düşürülür, sonra hedef `owner` yapılır (sıra, tek-Kurucu kısmi tekil indeksini her ifadede sağlar). Rol her istekte taze okunduğu için oturumlar ek işlem gerektirmez.
  - SSO zorunluysa: yeni Kurucu muaf olur, eski Kurucu zorunluluğa girer; başlatma ekranında bu açıkça yazılır.
  - Fatura iletişim bilgisi (varsa) yeni Kurucu'ya geçer ya da ekranda sorulur.
  - Bütün Yöneticilere bilgi e-postası gider.
- **Kabul kriterleri:**
  - Yalnız Kurucu devir başlatabilir; başkasına 403.
  - Yanlış şifre ya da 2FA kodu ile başlatma reddedilir.
  - Hedef 72 saat içinde kabul etmezse devir düşer; Kurucu iptal edebilir.
  - Kabulde lisansta tam olarak bir Kurucu kalır; eski Kurucu Yönetici olur; dört denetim eyleminin ilgili olanları yazılır.
  - Askıdaki ya da e-postası doğrulanmamış üyeye devir başlatılamaz.
- **Riskler / notlar:** Kurucu'nun ulaşılamadığı durum (kurtarma) panel dışı, kayıtlı bir platform süreci olmalı; bu madde onu kapsamaz.

### RL-06 — Profil adı düzenleme ve uygulama içinden şifre değiştirme
- **Alan (panelde nerede, kim kullanır):** Profil menüsü → "Profilim" (ad, oyuncuya görünen ad, şifre değiştirme). Bütün roller.
- **Mevcut kod karşılığı:**
  - `Account` modelinde `name`, `avatarUrl` (`schema.prisma:221-222`); profil düzenleme ucu yok (`packages/contract/openapi/paths/agents.yaml`; `kaynaklar/eksikler.md` T14).
  - Şifre yalnız e-postayla sıfırlanıyor (`/auth/password-reset`, `apps/api/src/routes/account-lifecycle.ts`); scrypt `apps/api/src/lib/crypto.ts`.
  - Yenileme token aileleri `oauth_refresh_tokens.familyId` (oturum iptali için).
  - Widget'ta oyuncuya görünen ajan adı `account.name` (`apps/api/src/routes/customer.ts:565-569`).
  - Kişisel tercih ucu kalıbı: `GET/PUT /agents/me/ui-preferences`; ekran `apps/web/src/features/team/AgentProfile.tsx`.
- **Eklenecek / değişecek yerler:**
  - **contract:** `PATCH /agents/me` (`name`, `public_name`), `POST /auth/password` (`current_password`, `new_password`).
  - **Prisma + migration:** `accounts.public_name TEXT NULL`.
  - **api:** ad doğrulama (1–120 karakter, kırpma); şifre: mevcut şifre scrypt ile doğrulanır, yeni şifre en az 12 karakter (davet kabulüyle aynı kural) ve eskisiyle aynı olamaz; SSO zorunlu üyede uç açıklayıcı bir hatayla reddeder; başarıda **bu oturum hariç** bütün yenileme token aileleri iptal edilir; denetim `account.profile_updated`, `account.password_changed`; güvenlik bilgilendirme e-postası (güvenlik rezervinden); hız sınırı hesap başına saatte 10. Widget'ta `public_name ?? name` gösterilir.
  - **web:** profil formu (GV-06 kalıbında); şifre bölümü; başarı bildirimi.
  - **mobile:** Account ekranında ad salt okunur kalabilir (sonraki iş).
  - **testler:** entegrasyon (yanlış mevcut şifre 401/400; başka oturum iptal; SSO zorunlu üye reddi; widget'ta takma ad), e2e profil.
- **Kodlama mantığı:** Şifre değiştirme "kimlik doğrulanmış + mevcut şifre" ister; sıfırlama akışından bağımsızdır ve hesap e-posta kotasını harcamaz (yalnız bilgilendirme e-postası). Diğer oturumların iptali ele geçirilmiş oturumları kapatır. Takma ad yalnız oyuncuya görünen yüzdür; denetim kaydında ve panelde gerçek ad kullanılır.
- **Kabul kriterleri:**
  - Kullanıcı adını değiştirir; panelde ve ekip listesinde yeni ad görünür; denetim kaydı yazılır.
  - Doğru mevcut şifreyle şifre değişir; diğer cihazlardaki oturumlar sonraki yenilemede düşer, mevcut oturum açık kalır.
  - Yanlış mevcut şifreyle değişiklik reddedilir ve hız sınırına sayılır.
  - Takma ad girilmişse widget'ta oyuncu takma adı görür.
- **Riskler / notlar:** Bildirim e-postası posta tavanına takılırsa değişiklik engellenmemeli (mevcut `backgroundMail` davranışı).

---


---

## 4. Inbox / sohbet deneyimi (IN)

### IN-01 — Yazılan taslağın sohbetler arasında taşınmasının düzeltilmesi + sohbet başına taslak saklama
- **Alan (panelde nerede, kim kullanır):** Inbox › sohbet seçili › alttaki mesaj kutusu (Composer). Sohbete yazan herkes kullanır: Ekip Üyesi, Ekip Lideri, Yönetici, Kurucu.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/Composer.tsx:97-113`: `text`, `mode`, `shortcut`, `attachment`, `suggestions`, `copilotPending` bileşenin yerel state'inde tutuluyor. `:116`: `useSendMessage(chatId)`. `:212-227`: `submit` gönderince metni temizliyor. `:173-175`: sohbet değişince yalnız "yazıyor" sinyali kapatılıyor. `:181-188`: Copilot taslağı sohbet bazlı zustand deposundan okunuyor.
  - `apps/web/src/features/inbox/copilotDraft.ts`: sohbet kimliğine göre tutulan bir zustand deposu. Taslak deposu için hazır bir desen.
  - `apps/web/src/features/inbox/InboxPage.tsx:883-890`: `<Composer chatId={selectedId} …>` anahtar (`key`) almıyor.
  - Mevcut testler (`Composer.test.tsx`, `Composer.canned.test.tsx` vb.) sohbet değişimini sınamıyor.
- **Eklenecek / değişecek yerler:**
  - Contract, Prisma, API, RTM: değişiklik yok.
  - Web:
    - `features/inbox/composerDrafts.ts` (yeni): sohbet başına taslak deposu.
    - `Composer.tsx`: taslağı yükleme, yazma ve silme.
    - `InboxPage.tsx`: `key={selectedId}`.
    - Oturum kapatma akışında depoyu temizleme (`apps/web/src/lib/auth-store.ts` çıkış işleyicisi).
  - Testler:
    - `Composer.draft.test.tsx` (birim).
    - `apps/e2e/tests/inbox-draft.spec.ts`: iki sohbet arasında geçiş yapılır; boş kutuda Enter'ın hiçbir şey göndermediği doğrulanır.
- **Kodlama mantığı:**
  1. **Güvenlik düzeltmesi önce gelir ve tek başına yayınlanabilir.** Composer sohbet kimliğiyle anahtarlanır (`key={selectedId}`). Böylece sohbet değişince metin, ek, mod, açık seçici ve öneri çipleri sıfırlanır. Mevcut "yazıyor" kapatma efekti zaten unmount'ta çalışır. `useSendMessage` her zaman bileşenin kendi `chatId` değerine bağlı kalır.
  2. **Taslak deposu** `chatId → { text, mode, updatedAt }` eşlemesini tutar.
     - Taslak mount'ta okunur.
     - Metin değişince yaklaşık 300 ms gecikmeyle yazılır.
     - Şu durumlarda silinir: başarılı gönderim; sohbetin arşivlenmesi; sohbetin başkasına geçmesi. Son ikisi için RTM'den `chat_deactivated`, `chat_transferred` veya `chat_taken_over` gelir ve sohbet artık bu ajanın değildir.
  3. **Ek dosya taslağa girmez.** Sohbet değişince ek bırakılır; yüklenmiş ama gönderilmemiş dosya hiçbir sohbete bağlanmaz. Ajan geri döndüğünde ek yoktur. Bu, bilinçli bir güvenlik tercihi.
  4. **Saklama:**
     - `localStorage` anahtarı lisans ve hesap kimliğiyle ad alanına ayrılır: `siyahtus.drafts.<licenseId>.<accountId>`.
     - Her kayıt 24 saat yaşar (TTL).
     - Çıkışta ve hesap değişiminde depo tamamen silinir.
     - Taslak sunucuya gönderilmez.
     - 04'teki 1. soruya "sunucuda" cevabı gelirse ayrı bir tablo ve RLS gerekir; o durumda taslak metni de AI-26 maskelemesinden geçmeli.
  5. **Kenar durumlar:**
     - Aynı sohbet iki sekmede açıksa `storage` olayıyla son yazan kazanır. Açık kutunun üstüne yazılmaz, yalnız kutu boşsa doldurulur.
     - Copilot bir taslak önerdiğinde (`offerDraft`) kutuda ajanın kendi taslağı varsa, Copilot onun üstüne yazmadan önce onay ister ya da metni sona ekler.
     - İç not modunda yazılan taslak geri yüklenince mod da "not" olarak döner. Böylece not yanlışlıkla oyuncuya gitmez.
- **Kabul kriterleri:**
  - A sohbetinde metin yazıp B'ye geçilince B'nin kutusu boştur ve B'de Enter hiçbir mesaj göndermez.
  - A'ya dönülünce A'nın metni ve modu (yanıt/not) geri gelir.
  - A'da dosya ekleyip B'ye geçilince B'de ek görünmez; A'ya dönülünce de ek yoktur.
  - Gönderimden sonra o sohbetin taslağı silinir ve sayfa yenilense de geri gelmez.
  - Gönderilmemiş taslak, aynı tarayıcıda 24 saat içinde sayfa yenilenince geri gelir; çıkış yapıp yeniden girince gelmez.
  - Sohbet başka ajana aktarılınca o sohbetin taslağı silinir.
  - Birim ve e2e testleri CI'da yeşildir.
- **Riskler / notlar:**
  - Taslak tarayıcıda düz metin olarak durur ve ortak bilgisayarda risk oluşturur. Bu yüzden TTL ve çıkışta silme şart.
  - IN-08'deki Alt+↑/↓ kısayolu bu düzeltmeden önce yayınlanmamalı.
  - Hata kod okumasıyla bulundu. Düzeltmeden önce bir e2e testiyle yeniden üretilmesi önerilir.

### IN-02 — Sağ panelde oyuncu kartı
- **Alan (panelde nerede, kim kullanır):** Inbox › sohbet seçili › sağ panel › "Ayrıntılar" sekmesinin en üstündeki "Oyuncu" kartı. Kartın içinde "Bugün" (aynı günlük grubun önceki bağlantıları) ve "Geçmiş" bölümleri bulunur. Tüm roller okur; e-posta gibi alanlar ve ekip dışı konuşmalar RL-02'ye göre gizlenir.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/DetailsPanel.tsx:45-440`: panel bölümleri; Chat ID satırı `:182-184`.
  - `features/inbox/types.ts:60-86`: `ChatDetail` oyuncu adı ve e-postası taşımıyor, `users[]` yalnız kimlik içeriyor.
  - `apps/api/src/services/chat/chat-service.ts:2586-2670`: `ChatDetail` ve `serialiseChat`; her zaman yalnız son thread.
  - `apps/api/prisma/schema.prisma:389-426`: `Customer` (name, email, username — commit'lenmemiş —, country_code, banned_at). `:816-843`: `Thread.summary`.
  - `apps/api/src/services/customers/customer-service.ts:162-228`: müşteri detayı. Sohbetleri ekip görünürlüğüne bakmadan, en fazla `MAX_CHATS` kadar ve her sohbette yalnız son thread tarihiyle döndürüyor.
  - `apps/web/src/features/traffic/VisitorPanel.tsx:68-72`: pre-chat cevabı kuralı (`custom_fields` içinde `form_placement === 'pre_chat'` ve değer dolu).
  - `apps/web/src/features/customers/CustomerDetailPanel.tsx:265-275`: geçmiş sohbet listesi.
  - `apps/api/src/services/ai/ai-responder.ts:142-148`: AI'ın thread özetini yazdığı yer. AI-10 bunun yerine yapılandırılmış bir kart yazacak.
  - `apps/api/src/services/chat/access.ts`: görünürlük kuralı (`resolveVisibility`, `canSeeChat`).
- **Eklenecek / değişecek yerler:**
  - **Contract:** yeni `GET /chats/{chatId}/customer-context` ucu (`packages/contract/openapi/paths/chats.yaml` + `CustomerContext` şeması).
    - `customer`: `{id, name, username, email (gerekirse maskeli), country_code, city, banned}`.
    - `pre_chat`: `[{label, value}]`.
    - `today`: `[ConversationRef]`.
    - `history`: `{items: [ConversationRef], next_page_id}`.
    - `restricted_count`.
    - `ConversationRef` alanları: bağlantı kimliği (chat ID) ve günlük grup kimliği (thread ID) — adları ID-01'e göre —, başlangıç/bitiş, atanan, ekip adları, etiketler, AI devir kartı özeti (AI-10 şeması), puan (AR-03) ve `accessible: boolean`.
  - **Prisma:** yeni tablo gerekmez. GeoIP seçilirse `visits.country_code` ve `visits.city` (nullable) eklenir; ilk ziyarette `customers.country_code` boşsa doldurulur. Migration genişletme kuralına uymalı (nullable kolon).
  - **API:**
    - `services/customers/customer-context.ts` (yeni): oyuncuyu, bugünün bağlantılarını ve sayfalı geçmişi okur; her konuşma için `resolveVisibility(tx, principal, 'read')` ile `accessible` değerini hesaplar.
    - Route `routes/chats.ts` içine eklenir.
    - GeoIP için `services/geo/` (çevrimdışı veritabanı okuyucu) yazılır ve widget ziyaret başlangıcında (`routes/customer.ts`) çağrılır.
  - **RTM:** yeni olay gerekmez. Aynı oyuncudan yeni bağlantı açılınca `incoming_chat`, AI devrinde `chat_transferred` gelir; istemci bu push'larda `['customer-context', chatId]` sorgusunu tazeler.
  - **Web:**
    - `features/inbox/PlayerCard.tsx` (yeni) ve `useCustomerContext.ts`.
    - `DetailsPanel.tsx`'in en üstüne yerleşim.
    - AI-10'un devir kartı bileşeni ve ID-05'in kopyala bileşeni bu kartta render edilir.
    - `locales/tr|en/inbox.ts`.
  - **Testler:**
    - Entegrasyon (`apps/api/test/integration/customer-context.test.ts`): ekip A ajanı ekip B konuşmasının özetini ve etiketini alamaz, yalnız `accessible:false` görür; kiracılar arası istek 404 döner.
    - Birim (`PlayerCard.test.tsx`).
    - E2e (`inbox-player-card.spec.ts`): aynı gün ikinci bağlantıda, ilk bağlantı "Bugün" listesinde görünür.
- **Kodlama mantığı:**
  - **Yükleme:** panel açılınca tek çağrı yapılır; 30 sn önbellekte tutulur; sohbet değişince yeni anahtar kullanılır.
  - **Kimlik:** ad, e-posta ve kullanıcı adı `customers` tablosundan gelir. Kullanıcı adı, ID-03 doğrulama getirene kadar "oyuncunun beyanı, doğrulanmadı" rozetiyle gösterilir. RL-02'de "kişisel veri görür" yetkisi olmayan kullanıcı için e-posta sunucuda maskelenir (`a***@gmail.com`); yalnız istemcide gizlemek yetmez.
  - **Pre-chat:** önce bu bağlantının kendi `filled_form` olayına (transkriptteki form cevapları) bakılır; yoksa müşteri özel alanlarındaki `pre_chat` değerleri kullanılır. Kural VisitorPanel ile aynıdır.
  - **"Bugün" bölümü:**
    - ID-02'nin tanımladığı günlük gruptaki önceki bağlantıları yeniden eskiye listeler. Günlük grup üye artı gün demektir; gün, ID-04'e göre kiracı saat diliminde hesaplanır.
    - Her satırda saat, süre, sonuç (AI çözdü / devredildi / kapandı) ve AI devir kartı özeti bulunur.
    - Satıra tıklayınca transkript yan panelde ya da modalda salt okunur açılır. Bu, aktif sohbetin composer'ını etkilemez.
  - **"Geçmiş" bölümü:**
    - Gün başına bir satır (günlük grup), son 90 gün.
    - Keyset sayfalama (`created_at, id`).
    - `accessible:false` satırlarında yalnız tarih ve konu etiketi görünür, satır tıklanamaz. `restricted_count` "+N kısıtlı konuşma" olarak gösterilir.
  - **AI devir kartı:** veri modeli ve üretimi AI-10'a aittir; burada yalnız gösterilir. Kart yoksa `thread.summary`'ye düşülür.
  - **Risk bayrakları (AI-27):** kartın başlığında rozet olarak gösterilir. Durum ikon ve metinle verilir; renk tek başına anlam taşımaz.
  - **Ülke:** GeoIP sunucunun içinde, çevrimdışı bir veritabanıyla bulunur; IP adresi üçüncü tarafa gönderilmez. Sonuç ziyaret kaydına yazılır, her istekte yeniden hesaplanmaz.
  - **Performans:** oyuncunun konuşmaları `chats(customer_id)` ve `threads(chat_id, created_at)` indeksleriyle gelir. Geçmiş sorgusu sayfa başına 20 satırla sınırlıdır. Hedef: panel açılışında p95 < 300 ms.
- **Kabul kriterleri:**
  - Sohbet açılınca kartta ad, kullanıcı adı, e-posta (yetkiye göre maskeli), ülke ve pre-chat cevapları görünür; olmayan alan "—" olarak gösterilir.
  - Aynı oyuncu aynı gün ikinci kez gelince, ilk bağlantı (saat, sonuç, AI devir kartı) "Bugün" bölümünde listelenir.
  - Ertesi gün "Bugün" boş kalır ve önceki gün "Geçmiş"te tek satır olarak görünür.
  - Ajanın ekibine ait olmayan geçmiş konuşmanın içeriği açılmaz; API yanıtında o konuşmanın özeti ve etiketi dönmez (entegrasyon testiyle).
  - Chat ID ve thread ID kartta kopyalanabilir (ID-05).
  - AI'dan devralınan sohbette devir kartı panelin en üstünde görünür.
  - Ajan tüm bunları Müşteriler sayfasına gitmeden görür; "Profili aç" bağlantısı vardır.
- **Riskler / notlar:**
  - ID-01 ve ID-02 netleşmeden "Bugün" bölümü hesaplanamaz. İlk aşamada kartın ID modelinden bağımsız kısmı (kimlik, pre-chat, geçmiş) yayınlanabilir.
  - Mevcut müşteri detay ucu ekip ayrımı yapmıyor. Aynı açığı Inbox'a taşımamak için yeni uç kendi görünürlük filtresini uygulamalı.
  - GeoIP veritabanının lisansı seçilmeli (MaxMind GeoLite2 kayıt ve EULA ister; DB-IP Lite CC-BY lisanslı) ve veritabanı düzenli güncellenmeli.

### IN-03 — Sohbet satırında bekleme süresi
- **Alan (panelde nerede, kim kullanır):** Inbox › orta sütundaki sohbet listesinde her satırın sağ üstü. Tüm roller kullanır. Eşik ayarları Ayarlar › Inbox'ta bulunur ve Yönetici tarafından değiştirilir.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/InboxPage.tsx:748-797`: liste satırı.
  - `packages/contract/openapi/openapi.yaml:1076-1095`: `ChatSummary` (`last_event`, `queue_position`; `queued_at` yok).
  - `apps/api/prisma/schema.prisma:822-823`: `threads.queue_position` ve `queued_at`.
  - `apps/api/src/services/chat/chat-service.ts:2039-2175`: liste sorgusu ve serileştirme.
  - `schema.prisma:2127-2142`: `InboxSettings`, lisans + marka bazında.
- **Eklenecek / değişecek yerler:**
  - **Prisma:**
    - `threads.awaiting_reply_since timestamptz NULL` (nullable, varsayılansız).
    - `inbox_settings.waiting_warn_seconds` ve `waiting_alert_seconds` (nullable; boşsa 120/300 kabul edilir).
  - **API:** `chat-service.ts` olay yazma yolu (`#appendEvent` çağıranları) aynı transaction içinde alanı günceller:
    - Oyuncu mesajı geldiğinde (`author_type=customer`, `recipients=all`) alan boşsa `now` yazılır.
    - Ajan ya da bot oyuncuya görünen bir mesaj yazdığında alan `NULL` yapılır.
    - AI'dan insana devirde (`reason=ai_handoff`) alan boşsa `now` yazılır.
    - Thread kapanınca alan `NULL` yapılır.
    - Liste ve detay serileştiricileri `waiting_since` ve `queued_at` döner.
  - **Contract:** `ChatSummary.waiting_since` ve `queued_at` (date-time, nullable); Inbox ayarlarına iki eşik alanı.
  - **Web:**
    - `features/inbox/WaitingTimer.tsx` (yeni).
    - Tüm satırlar için paylaşılan tek bir saat (`useNow(15_000)`).
    - `InboxPage.tsx` satırına ekleme.
    - Ayarlar ekranında iki alan.
  - **Testler:**
    - Entegrasyon: alanın set/clear kuralları doğrulanır; iç not ve "Chat transferred" sistem mesajı alanı sıfırlamaz.
    - Birim: süre biçimlendirme ("az önce", "4 dk", "1 sa 5 dk").
    - E2e: `inbox-waiting.spec.ts`.
- **Kodlama mantığı:**
  - **Kaynak neden sunucuda:** istemcide "son olay oyuncudan mı" diye hesaplamak yanlış olur, çünkü aktarma gibi bir sistem mesajı son olay olabilir ve sayacı sıfırlar. Bu yüzden kaynak sunucudaki tek bir alandır.
  - **Kuyruktaki sohbet:** `queued_at` gösterilir ("kuyrukta 3 dk").
  - **Performans:** her satır için ayrı interval açılmaz, çünkü yüzlerce satırda yük oluşturur. 15 sn çözünürlük yeterlidir; 1 dakikanın altı "az önce" olarak gösterilir.
  - **Saat farkı:** sunucu ile istemci arasındaki fark API yanıtının `Date` başlığından hesaplanıp düzeltilir.
  - **Erişilebilirlik:** eşik aşılınca durum ikon ve metinle gösterilir ("5 dk+"); renk tek başına anlam taşımaz.
  - **İleride:** "en uzun bekleyen" sıralaması aynı alanı kullanabilir; o zaman `threads(license_id, awaiting_reply_since)` indeksi eklenir.
  - **Ortak tanım:** WG-03 (cevapsız sohbeti aktarma) ve RP-04 (kuyruk raporu) aynı alanı kullanmalı.
- **Kabul kriterleri:**
  - Oyuncu yazınca sayaç başlar; ajan cevap verince sayaç kaybolur.
  - İç not yazmak ya da "Sohbet aktarıldı" sistem mesajı sayacı sıfırlamaz.
  - AI cevap verirse sayaç kaybolur; AI insana devredince yeniden başlar.
  - Eşiklerde görünüm değişir; Yönetici eşikleri değiştirebilir.
  - Kuyruktaki sohbet kuyrukta geçen süreyi gösterir.
  - 200 satırlık listede kaydırma akıcı kalır (tek zamanlayıcı).
- **Riskler / notlar:**
  - Yazma yoluna eklenen güncelleme küçük bir yük getirir (aynı transaction içinde tek satırlık update).
  - Mevcut açık thread'ler için alan boş başlar. Bu kabul edilebilir; istenirse son oyuncu mesajından tek seferlik doldurma yapılabilir.

### IN-04 — Takıma transfer (API'de var, arayüzde yok)
- **Alan (panelde nerede, kim kullanır):** Inbox › sağ panel › "Atanan" satırındaki menü. Menüde "Ekip arkadaşı" ve "Ekip" olmak üzere iki bölüm bulunur; ayrıca sohbet başlığı menüsüne "Aktar…" eklenir. Sohbete yazma yetkisi olan herkes kullanabilir (bugün `chats--access:rw`); RL-02 ile kısıtlanabilir.
- **Mevcut kod karşılığı:**
  - `packages/contract/openapi/paths/chats.yaml:370-408`: transfer sözleşmesi.
  - `apps/api/src/services/chat/chat-service.ts:1371-1514`:
    - Ekip dalı `:1388-1417`.
    - Ekipte kabul eden yoksa `group_offline` hatası: `:1396-1412`.
    - Erişim listesini tamamen değiştirip `assigneeId: null` yapma: `:1414-1417`.
  - `apps/api/src/services/routing/routing-service.ts`:
    - `:114-169`: `route`, ajan seçer ya da kuyruğa alır.
    - `:179-241`: `drainQueue`, yalnız `queue_position` dolu thread'lere bakar.
  - `apps/web/src/features/inbox/useInbox.ts:821-824`: yalnız `agent_id` gönderiliyor.
  - `DetailsPanel.tsx`:
    - `:113-124`: ekip adları `['team','groups']` önbelleğinden.
    - `:457-541`: `AssigneePicker`.
  - `apps/api/src/services/ai/ai-responder.ts:174-199`: AI devri aynı ekip transferini kullanıyor.
- **Eklenecek / değişecek yerler:**
  - **Contract:**
    - Transfer gövdesine `note` alanı (string, ≤500, isteğe bağlı).
    - Yanıta `outcome: assigned|queued`.
    - Kuyruğa alma kararı verilirse 409 `group_offline` dokümandan kaldırılır.
    - `GET /groups` yanıtına `accepting_count` (o an sohbet kabul eden üye sayısı).
  - **API:**
    - `RoutingService`'e ekip içi atama metodu: `assignWithinGroup(tx, licenseId, groupId)`. Mevcut ajan seçme mantığıyla bir ajan seçer; uygun ajan yoksa `queue_position` ve `queued_at` verir.
    - `chat-service.transfer`'in ekip dalı, `assigneeId: null` bırakmak yerine bu metodu çağırır.
    - Not varsa `recipients:'agents'` olan bir iç not olayı eklenir.
    - "Kritik" işaretli bir ekipte (ör. Sorumlu Oyun) sohbet kuyruğa düşerse Yönetici'ye bildirim gider (IN-10 kanalı).
    - AI devri de aynı metodu kullandığı için onun "atanmamış kalma" sorunu da çözülür.
  - **RTM:**
    - Mevcut `chat_transferred` push'u kullanılır.
    - Sohbet bir ajana atanırsa o ajana "bana aktarıldı" bildirimi gider (IN-10).
  - **Web:**
    - `AssigneePicker` iki bölüme ayrılır; ekip satırında "Finans · 2 çevrimiçi" gibi bir gösterim olur.
    - `useChatAction` içine `transferToGroup(groupId, note?)` eklenir.
    - Transfer başarılı olur ve sohbet ajanın görünürlüğünden çıkarsa seçim temizlenir ve bilgi mesajı gösterilir ("Sohbet Finans ekibine aktarıldı").
    - `group_not_found` ve `chat_inactive` için hata cümleleri yazılır.
  - **Testler:**
    - Entegrasyon:
      - Ekipte çevrimiçi bir ajan varsa sohbet ona atanır.
      - Kimse yoksa sohbet kuyruk sırası alır ve ekipten biri çevrimiçi olunca `drainQueue` onu atar.
      - AI devrinde de aynı davranış görülür.
    - Birim: `DetailsPanel.transfer.test.tsx`.
    - E2e: `inbox-transfer-team.spec.ts`.
- **Kodlama mantığı:**
  - **Görünürlük kaybı:** ekip transferi erişim listesini yalnız hedef ekibe indirir (`:1414-1415`). Bu yüzden aktaran ajan, tüm sohbetleri görme yetkisi yoksa sohbeti artık göremez. Arayüz bunu beklemeli ve seçimi temizlemeli; aksi halde ajan 404 hatası görür.
  - **Kendi ekibine aktarma:** "yeniden yönlendir" anlamına gelir. Sohbet aktaran ajanın kendisi dışında birine atanır.
  - **AI:** aktarılan sohbette AI susmalıdır (AI-11).
  - **Not:** oyuncuya gitmez; iç not olarak kaydedilir.
  - **Ekip listesi:** yalnız kiracının ekiplerini içerir; üyesi olmayan bir ekip seçilemez.
  - **Uzmanlık:** uzmanlık (expertise) gerektiren sohbette ekip içi seçim, mevcut ajan seçme kuralına uyar.
- **Kabul kriterleri:**
  - Ajan sohbeti "Finans" ekibine aktarabilir.
  - Finans'ta sohbet kabul eden biri varsa sohbet ona atanır ve o kişiye bildirim gider.
  - Finans'ta kimse yoksa sohbet Finans kuyruğuna girer ve ilk müsait Finans ajanına otomatik atanır.
  - Not, transkriptte iç not olarak görünür; oyuncu görmez.
  - Sohbet aktaran ajanın listesinden düşer ve ajan hata görmez.
  - AI devrinden sonra sohbet atanmamış kalmaz.
- **Riskler / notlar:**
  - Davranış değişikliği (reddetmek yerine kuyruğa almak) `group_offline` bekleyen mevcut testleri kırar.
  - AI devri ve Traffic'teki "Assign chat to me" yolları birlikte test edilmeli.

### IN-05 — Okundu bilgisi gösterimi (veri hazır)
- **Alan (panelde nerede, kim kullanır):** Inbox › mesaj akışı › ajanın oyuncuya görünen son okunmuş mesajının altında "Okundu · 14:32". Tüm ajan rolleri görür. Oyuncu tarafında gösterilmez (04, Soru 1).
- **Mevcut kod karşılığı:**
  - `packages/contract/openapi/openapi.yaml:1097-1107`: `ChatUser.seen_up_to`.
  - `apps/api/src/services/chat/chat-service.ts:1805-1825`: `markSeen` müşteri principal'ını da destekliyor. Kod yorumunda "işaret geri gitmez" yazıyor, ama `update: { seenUpTo }` koşulsuz yazıyor.
  - `apps/api/src/routes/chats.ts:580`: bu ucu yalnız ajan çağırıyor.
  - `packages/contract/openapi/paths/customer-chat.yaml`: müşteri için "seen" yolu yok.
  - `apps/widget/src/widget.ts` ve `api.ts`: "okudum" çağrısı yok.
  - `apps/web/src/features/inbox/Transcript.tsx`: okundu bilgisi gösterilmiyor.
  - `features/inbox/useInbox.ts:602-650`: `useMarkSeen`, ajan tarafındaki örnek akış (1 sn gecikmeli).
- **Eklenecek / değişecek yerler:**
  - **Contract:**
    - `POST /customer/chat/seen`: müşteri tokenıyla çağrılır, gövdesi `seen_up_to`.
    - RTM push `customer_seen`: `{chat_id, thread_id, seen_up_to}`, ajan kitlesine gider.
  - **API:**
    - `routes/customer.ts`'e yeni uç.
    - `markSeen` yalnız ileri yazacak şekilde düzeltilir: `GREATEST(seen_up_to, $1)` ya da koşullu update. Bu düzeltme hem ajan hem oyuncu tarafı için geçerlidir.
    - Yazmadan sonra push yayınlanır.
  - **Widget:**
    - Pencere açıkken, `document.visibilityState === 'visible'` iken ve mesaj listesi en alttayken, son görünen olayın zamanı 1 sn gecikmeyle gönderilir.
    - Widget küçültülmüşken ya da sekme arka plandayken gönderilmez.
  - **Web:**
    - `Transcript.tsx`, `chat.users` içinde `user_type==='customer'` olan kaydın `seen_up_to` değerini okur.
    - Bu zamandan önce ya da aynı anda oluşturulmuş, `recipients==='all'` olan, yazarı ajan ya da bot olan son mesajın altına etiket koyar.
    - RTM push'u geldiğinde `['chat', chatId]` önbelleğini yamalar.
  - **Testler:**
    - Entegrasyon: oyuncu yalnız kendi sohbetini işaretleyebilir; başka kiracıdan istek 404 döner; işaret yalnız ileri gider.
    - Widget birim testi: görünmezken çağrı yapılmaz.
    - Birim: `Transcript.readReceipt.test.tsx`.
    - E2e: oyuncu widget'ta mesajı görür, ajan "Okundu" bilgisini görür.
- **Kodlama mantığı:**
  - Etiket yalnız tek bir mesajda (okunan son ajan mesajında) durur, her mesajda tekrarlanmaz.
  - Düzenlenmiş mesaj okundu durumunu değiştirmez.
  - Oyuncu birden çok sekmedeyse en ileri değer kazanır.
  - Saat, ajanın yerel saatinde gösterilir.
  - Oyuncu ucuna oran sınırı konur (≈1 istek/sn).
  - İç notlar hiçbir zaman "okundu" etiketi almaz.
- **Kabul kriterleri:**
  - Oyuncu widget'ı açıp mesajı görünce ajan ekranında 2 sn içinde "Okundu · saat" çıkar.
  - Widget küçültülmüşken gelen mesaj okunmuş sayılmaz.
  - Eski zamanlı bir istek işareti geri çekmez.
  - İç notlar "okundu" almaz.
- **Riskler / notlar:**
  - Widget gizlilik metninde okundu bilgisinin paylaşıldığının belirtilip belirtilmeyeceği hukuken değerlendirilmeli.
  - Mobil tarayıcılarda görünürlük olayları her zaman güvenilir olmayabilir. Bu yüzden yanlış "okundu" göstermek yerine eksik göstermek tercih edilmeli.

### IN-06 — Hazır yanıtlar: içerikte arama, 6'dan fazla sonuç, değişkenler (%oyuncu-adı%…), kişisel (private) yanıtlar
- **Alan (panelde nerede, kim kullanır):**
  - (a) Inbox › mesaj kutusu › "#" seçicisi. Tüm roller kullanır.
  - (b) Ayarlar › Inbox › Hazır yanıtlar. Paylaşılan yanıtları Ekip Lideri ve üstü, kişisel yanıtları herkes kendisi için yönetir (04, Soru 3).
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/useCannedResponses.ts`:
    - `:19-26`: tüm liste tek seferde geliyor, 5 dk önbellekte tutuluyor.
    - `:35-45`: `#` algılama; yalnız `[A-Za-z0-9_-]` karakterleri.
    - `:60-68`: yalnız başlangıç eşleşmesi ve 6 sonuç sınırı.
  - `Composer.tsx:648-681`: seçici listesi.
  - `apps/api/prisma/schema.prisma:1311-1328`: `visibility` yalnız `all` ya da `group`; `shortcut` tekil; `@@unique([licenseId, scope, shortcut])`.
  - `apps/api/src/services/team/canned-response-access.ts:28-80`: görünürlük kuralı.
  - `apps/api/src/routes/settings.ts`:
    - `:362`: kısayol regex'i (ASCII, en fazla 40 karakter).
    - `:1853-1873`: liste ucu (sayfalama yok).
  - `packages/contract/openapi/paths/settings.yaml:734-770`: liste sözleşmesi.
  - `apps/web/src/features/settings/CannedResponses.tsx`: ayar ekranı.
  - `packages/types/src/template-variables.ts:22-116`: ticket şablonlarının değişken kataloğu ve doğrulayıcısı.
- **Eklenecek / değişecek yerler:**
  - **Prisma:**
    - `canned_responses.owner_account_id uuid NULL`.
    - `visibility` CHECK kısıtına `private` eklenir: `private` ise owner dolu ve group boş olmalı.
    - Benzersizlik iki kısmi unique index'e ayrılır:
      - Paylaşılanlar için `(license_id, scope, shortcut) WHERE visibility <> 'private'`.
      - Kişiseller için `(license_id, scope, owner_account_id, shortcut) WHERE visibility = 'private'`.
    - Geçiş iki aşamalıdır: önce yeni indexler eklenir, sonra eski unique düşürülür.
  - **Types:**
    - `CANNED_VARIABLES` kataloğu: `customer.name`, `customer.first_name`, `customer.username`, `customer.email`, `agent.name`, `agent.first_name`, `chat.id`, `thread.id`, `company.name`.
    - Ticket şablonlarındakiyle aynı doğrulama.
    - Türkçe etiketler.
  - **Scope:** kişisel yanıt yazmak için `canned_responses--my:rw`. Ekip Üyesi varsayılan setine eklenir (RL-02).
  - **API:**
    - Oluşturma, güncelleme ve silme kuralları: kişisel yanıtı yalnız sahibi düzenler.
    - Liste filtresine `private AND owner = actor` koşulu eklenir.
    - Yöneticinin başkalarının kişisel yanıtlarını görüp görmeyeceği RL-03 kararıdır; varsayılan olarak görmez.
  - **Contract:**
    - `CannedResponse.visibility` enumuna `private` ve `owner_account_id` eklenir.
    - Liste ucu değişmez; istemcide arama yeterli, çünkü bir kiracıda birkaç yüz kayıt olur.
  - **Web:**
    - Seçici eşleştirmesi Türkçe katlama kullanır: `toLocaleLowerCase('tr-TR')` artı aksan normalizasyonu ("cekim" ile "çekim" eşleşir).
    - Sonuç sırası: kısayol başlangıcı, sonra kısayol içi, sonra metin içi eşleşme.
    - 6 sonuç sınırı kalkar. Liste sanal kaydırmalı olur (`components/VirtualList.tsx`) ve en fazla yaklaşık 8 satır yüksekliğinde gösterilir.
    - Yanıt eklenirken değişkenler doldurulur. Kaynaklar: `ChatDetail`, IN-02 bağlamı ve oturumdaki ajan.
    - Ayar ekranına "Yalnız ben / Ekip / Herkes" seçimi, `{x}` değişken menüsü ve liste araması [A-34] eklenir.
  - **Testler:**
    - Birim: Türkçe katlama, sıralama, değişken doldurma.
    - Entegrasyon: başkasının kişisel yanıtı listede görünmez; iki ajan aynı kişisel kısayolu kullanabilir; bilinmeyen değişkenle kayıt reddedilir.
    - E2e: `inbox-canned-search.spec.ts`.
- **Kodlama mantığı:**
  - **Arama:** istemcide yapılır, çünkü liste zaten bütünüyle geliyor ve ağ gecikmesi olmaz.
  - **Sorgu karakterleri:** kısayollar ASCII kalabilir. Ancak "içerikte arama" için `#` ile başlayan kelime, boşluğa kadar Unicode harf kabul etmelidir; aksi halde "#çekim" seçiciyi kapatır.
  - **Değişken doldurma:**
    - Değişkenler sunucuda değil, ekleme anında doldurulur. Ajan gönderilecek metni olduğu gibi görür ve gönderim öncesi düzenleyebilir.
    - Doldurulamayan bir değişkenin yerine kiracının yedek ifadesi seçili (vurgulu) olarak eklenir.
    - Değişken değeri oyuncunun kendi yazdığı bir ad olabileceği için metne kaçışlanarak eklenir.
  - **Aynı kısayol:** kişisel ve paylaşılan bir yanıt aynı kısayolu taşıyorsa ikisi de listelenir; kişisel olan üstte ve "Kişisel" rozetiyle görünür.
- **Kabul kriterleri:**
  - "papara" yazılınca metninde "Papara" geçen tüm yanıtlar listelenir; 6'dan fazlaysa liste kaydırılır.
  - "cekim" araması "çekim" içeren yanıtları bulur.
  - `{{customer.name}}` içeren yanıt eklenince oyuncunun adı yazılı gelir; ad yoksa yedek ifade gelir.
  - Ekip Üyesi kişisel yanıt oluşturabilir ve bu yanıtı yalnız kendisi görür.
  - İki farklı ajan aynı kişisel kısayolu kullanabilir.
  - Bilinmeyen değişkenle kayıt reddedilir.
- **Riskler / notlar:**
  - Dolu tabloda unique index değişimi kilit alır; index'ler ayrı migration dosyasında `CREATE INDEX CONCURRENTLY` ile eklenmeli (CONVENTIONS §6.3).
  - Kişisel yanıtlar denetim dışında yanlış bilgi taşıyabilir. Ekip Liderinin ekibindeki kişisel yanıtları görmesi RL-03'te karar konusudur.

### IN-07 — Olaya bağlı önerilen yanıtlar (sohbet başladı, aktarıldı, sessiz kaldı, puanlandı)
- **Alan (panelde nerede, kim kullanır):**
  - (a) Inbox › mesaj kutusunun üstündeki olay çipleri. Tüm roller görür.
  - (b) Ayarlar › Inbox › Önerilen yanıtlar: olaylar ile hazır yanıtlar burada eşlenir. Paylaşılan eşlemeleri Ekip Lideri ve üstü, kişiselleri herkes kendisi için yönetir.
  - (c) "#" seçicisindeki dişli menüsünde "Benim için olay önerilerini kapat".
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/replySuggestions.ts`: niyet şablonları; `ReplyChip.source` değeri `'template'` ya da `'copilot'`.
  - `Composer.tsx:325-443`: çip satırı ve istek sayacı.
  - `apps/api/prisma/schema.prisma:1311-1328`: hazır yanıtlarda olay alanı yok.
  - Mevcut RTM push'ları: `chat_transferred`, `incoming_chat`, `incoming_event` (`chat-service.ts:540`).
  - `apps/api/src/routes/customer.ts:1096-1136`: puan yalnız kaydediliyor; ajan paneline push gitmiyor.
- **Eklenecek / değişecek yerler:**
  - **Prisma:**
    - `canned_responses.suggest_on text[] NOT NULL DEFAULT '{}'`. Olası değerler: `chat_started`, `chat_transferred`, `customer_idle`, `rated_good`, `rated_bad`.
    - `canned_responses.suggest_order int`.
    - `inbox_settings.customer_idle_seconds` (boşsa 180 kabul edilir).
    - Kişisel öneriler, IN-06'daki `private` görünürlük ile gelir.
  - **Contract / API:**
    - `CannedResponse.suggest_on` alanı.
    - Puan kaydedilince RTM `chat_rated` push'u. Bu push AR-03 ile ortaktır.
  - **UI tercihi:** ajan başına `suggestions_event_enabled` (`packages/types/src/ui-preferences.ts`).
  - **Web:**
    - `features/inbox/eventSuggestions.ts`: saf fonksiyon; transkriptten ve son olaylardan o anki aktif olayı belirler.
    - Composer çip satırına `source:'event'` kaynağı eklenir.
    - Ayar ekranı: `features/settings/SuggestedResponses.tsx`.
  - **Testler:**
    - Birim: olay tespiti.
    - E2e: aktarılan sohbette çip görünür.
- **Kodlama mantığı:**
  - **Olaylar istemcide tespit edilir:**
    - `chat_started`: thread'de henüz ajan mesajı yok ve ajan sohbeti ilk kez açtı.
    - `chat_transferred`: son sistem olayı, sohbetin bu ajana aktarılması.
    - `customer_idle`: oyuncuya görünen son mesaj ajandan ve oyuncu `customer_idle_seconds` boyunca yazmadı. İstemci zamanlayıcısıyla ölçülür; IN-03'ün alanıyla çelişmez.
    - `rated_*`: `chat_rated` push'u geldiğinde.
  - **Gösterim kuralları:**
    - Çip yalnız mesaj kutusu boşken ve her olay için bir kez gösterilir.
    - Ajan bir çipi kapatırsa aynı olay için çip tekrar çıkmaz.
    - Hiçbir koşulda otomatik gönderim yapılmaz.
  - **Sıra:** olay çipleri, Copilot taslağı ve şablon çipleri aynı satırı paylaşır. Sıralama: önce olay, sonra Copilot, sonra şablon.
  - **Risk bayrağı:** risk bayraklı sohbette (AI-27) "promosyon/bonus" kategorisindeki yanıtlar önerilmez. Bunun için hazır yanıta bir `category` alanı gerekir; bu alan AI-27 ile birlikte eklenir.
- **Kabul kriterleri:**
  - Ayarlarda "sohbet aktarıldı" olayına bir yanıt bağlanınca, aktarılan sohbeti açan ajan bu yanıtın çipini görür.
  - Çipe tıklayınca metin kutuya gelir ama gönderilmez.
  - Ajanın kişisel kapatma ayarı açıkken çip çıkmaz.
  - Risk bayraklı sohbette promosyon yanıtı önerilmez.
- **Riskler / notlar:**
  - Öneri satırı mevcut Boşluk önerileriyle aynı alanı kullanır; satır kalabalıklaşırsa kafa karıştırır. En fazla 4 çip gösterilmeli.

### IN-08 — Klavye kısayolları listesi (Shift+/) ve sohbetler arası geçiş kısayolları
- **Alan (panelde nerede, kim kullanır):** Tüm panelde genel kısayollar; Inbox'ta sohbet kısayolları; mesaj kutusunda yazım kısayolları. Kısayol penceresi "?" tuşuyla ve hesap menüsündeki "Klavye kısayolları" girişiyle açılır. Tüm roller kullanır.
- **Mevcut kod karşılığı:**
  - `apps/web/src/components/CommandPalette.tsx:151-163`: tek genel klavye dinleyicisi (Ctrl+K).
  - `components/ui/Modal.tsx:131` ve `Dropdown.tsx:81,129`: katmanlı Esc yönetimi.
  - `features/inbox/Composer.tsx:445-493`: mesaj kutusunun tuş işleyicisi.
  - `components/actions.ts`: palet eylemleri.
  - `InboxPage.tsx`: `visibleChats` ve `setSelectedId`.
- **Eklenecek / değişecek yerler:**
  - **Web:**
    - `lib/shortcuts.ts`: tek kısayol kaydı. Her kayıt kimlik, tuş kombinasyonu, kapsam (`global|inbox|composer`), açıklama anahtarı ve işleyici içerir.
    - `components/ShortcutsModal.tsx`: kapsama göre gruplanmış, aranabilir liste.
    - `AppShell.tsx`'te tek bir `keydown` dinleyicisi. CommandPalette'teki Ctrl+K da bu kayda taşınır.
    - Inbox kısayolları: Alt+↑/↓ (önceki/sonraki sohbet), etiket ekleme, dosya yükleme, Copilot (IN-09).
    - Locale anahtarları.
  - **Contract / API:** değişiklik yok.
  - **Testler:**
    - `shortcuts.test.ts`: çakışma tespiti; aynı kombinasyon iki kez kaydedilemez.
    - `ShortcutsModal.test.tsx`.
    - E2e: `keyboard-shortcuts.spec.ts`.
- **Kodlama mantığı:**
  - **Tek kayıt, tek dinleyici:**
    - Modal açıkken genel kısayollar susar (modal yığınının üstü önceliklidir).
    - Metin alanında yazarken yalnız açıkça "composer" kapsamlı kısayollar çalışır; tek harf tuşları asla kısayol olmaz.
  - **Türkçe Q klavye:**
    - "?" karakteri Türkçe klavyede Shift+/ ile değil, Shift+"*" ile yazılır. Bu yüzden kontrol `event.key === '?'` ile yapılır, tuş koduyla değil.
    - Windows'ta Ctrl+Alt, AltGr ile aynıdır. Türkçe klavyede AltGr+Q "@", AltGr+E "€", AltGr+< "|", AltGr+7/8/9/0 ise "{[]}" üretir. Ctrl+Alt+harf kısayolları bu tuşlardan seçilmemeli. Ayrıca `event.getModifierState('AltGraph')` true ise hiçbir kısayol tetiklenmemeli; aksi halde ajan "@" yazamaz.
  - **Alt+↑/↓:**
    - Ekranda görünen listeyi (seçili filtre ve sekme) izler.
    - Listenin sonuna gelince durur, başa sarmaz.
    - Seçili sohbet değişirken odak mesaj kutusuna gelir.
    - IN-01'deki güvenlik düzeltmesi bunun için önkoşuldur.
  - **Geri dönüşü zor eylemler:** sohbeti kapatma gibi eylemler kısayolla tetiklenirse onay ister ya da yalnız palet üzerinden sunulur.
  - **Gösterim:** kısayol listesi işletim sistemine göre tuş adlarını gösterir (Mac'te ⌘ ve ⌥).
- **Kabul kriterleri:**
  - "?" tuşu (TR ve US klavyede) kısayol penceresini açar, Esc kapatır.
  - Alt+↓ bir sonraki sohbeti açar ve odak mesaj kutusuna gelir.
  - Mesaj kutusunda AltGr+Q ile "@" yazılabilir ve hiçbir kısayol tetiklenmez.
  - Modal açıkken Alt+↓ çalışmaz.
  - Aynı kombinasyon iki eyleme bağlanamaz (test).
- **Riskler / notlar:**
  - Tarayıcı kısayollarıyla çakışma olabilir. Örneğin Chrome'da Ctrl+G "sonrakini bul" kısayoludur; uygulama `preventDefault` ile bu tuşu alabilir ama kullanıcı alışkanlığı bozulur. IN-09'un kısayolu Türkçe klavye ve tarayıcılarda denenerek seçilmeli.

### IN-09 — Her ekrandan açılabilen Copilot paneli
- **Alan (panelde nerede, kim kullanır):** Tüm panelde üst barın sağındaki Copilot düğmesi ve kısayolu; sağdan açılan, genişletilebilir çekmece. Tüm roller kullanır. Rapor sorularını yalnız `reports_read` yetkisi olanlar sorabilir (RL-02).
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/inbox/CopilotPanel.tsx`: sohbete bağlı; özet, yanıt, iyileştirme ve BI.
  - `features/inbox/useCopilot.ts` ve `panelTab.ts`.
  - `packages/contract/openapi/openapi.yaml:332-343`: `/copilot/knowledge`, `/copilot/chats/{chatId}/summary|reply|enhance`, `/copilot/bi`.
  - `apps/api/src/routes/command-palette.ts`: `/palette/ai-query`, yalnız rapor sorusu.
  - `apps/web/src/components/AppShell.tsx:92-97`: Outlet ve CommandPalette; çekmece için uygun yer.
  - `apps/api/src/plugins/ai-budget.ts`: günlük AI kotası.
- **Eklenecek / değişecek yerler:**
  - **Contract:**
    - `POST /copilot/ask`. Girdi: `{question (≤2.000), context?: {route, chat_id?}}`. Çıktı: `{answer, sources[{id,title,reviewed_at}], kind: kb|bi|unknown, reason?}`.
    - Hata türleri mevcut AI hatalarıyla aynıdır (`ai_daily_cap`, `no_answer`).
  - **API:**
    - `routes/copilot.ts`'e yeni uç.
    - Soru önce sınıflandırılır: rapor sorusu mu, bilgi sorusu mu? Bunun için mevcut BI niyet sözlüğü ve dil modeli kullanılır.
    - BI yolu `reports_read` yetkisi ister.
    - KB yolu, "Copilot kullanır" olarak işaretli bilgi kaynaklarından (AI-14) RAG ile cevap üretir.
    - Kullanım sayacı fatura ve kota için tutulur. Denetim kaydına yalnız "copilot.ask" sayısı yazılır, soru metni yazılmaz.
  - **Web:**
    - `components/CopilotDrawer.tsx`: AppShell içinde durur, rota değişiminde açık kalır.
    - BI ve KB bölümleri `CopilotPanel`'den ortak bir bileşene ayrılır.
    - Inbox'ta sohbet seçiliyken çekmece sohbet eylemlerini (özet, taslak) de sunar.
    - Oturum içi geçmiş zustand'da tutulur; sayfa yenilenince silinir.
    - Kısayol IN-08 kaydına eklenir.
  - **Testler:**
    - Entegrasyon (`copilot-ask.test.ts`): yetkisiz kullanıcının BI sorusu reddedilir; kota aşımı; kiracılar arası kaynak sızmaz.
    - Birim testleri.
    - E2e: `copilot-drawer.spec.ts`.
- **Kodlama mantığı:**
  - **Çekmece davranışı:** modal değildir, sayfa kullanılabilir kalır. Açılınca odak giriş alanına geçer, kapanınca önceki öğeye döner.
  - **Cevaplar:** kaynak gösterir. Kaynakta bilgi yoksa "bilmiyorum" der (AI-06 ile aynı ilke).
  - **Kota:** pilot modunda AI günlük kotası geçerlidir.
  - **Oyuncuya gönderim:** Copilot cevabı oyuncuya otomatik gitmez. Inbox'ta "yanıta ekle" seçeneği mevcut `offerDraft` yolunu kullanır.
- **Kabul kriterleri:**
  - Raporlar sayfasındayken kısayolla çekmece açılır.
  - "Papara çekim limiti" sorusu bilgi kaynağından cevap ve kaynak adıyla döner.
  - Rapor yetkisi olmayan Ekip Üyesi'ne "bu soruyu sorma yetkiniz yok" denir.
  - Sayfa değişince çekmece ve konuşma korunur; sayfa yenilenince temizlenir.
- **Riskler / notlar:**
  - AI maliyeti artar, çünkü her ajan her ekranda soru sorabilir. Bu yüzden kota şart.
  - Eski bilgi riski: kaynak listesinde AI-14'teki "son gözden geçirme" tarihi gösterilmeli.

### IN-10 — Olay bazlı bildirim tercihleri ve okunana kadar tekrarlayan ses
- **Alan (panelde nerede, kim kullanır):**
  - (a) Ayarlar › Bildirimler (kişisel): olay listesi ve "okunana kadar tekrarla" anahtarı.
  - (b) Çalışma anında ses, masaüstü bildirimi ve sekme başlığı.
  - Tüm roller kullanır.
- **Mevcut kod karşılığı:**
  - `apps/web/src/features/notifications/notifications.ts:70-100`: `decideNotification` yalnız `incoming_event` ve oyuncu mesajı için karar veriyor.
  - `features/notifications/useNotifications.ts:107-114`: ses tek seferlik çalıyor.
  - `features/settings/NotificationSettings.tsx`: 5 anahtar.
  - `packages/types/src/notifications.ts:57-120`: tercih şeması ve toleranslı okuyucu.
  - `apps/api/prisma/schema.prisma:260-274`: `agent_memberships.notify_*` kolonları.
  - API'nin yayınladığı RTM push'ları: `incoming_chat`, `incoming_event`, `chat_transferred`, `chat_taken_over`, `traffic_visitor_updated`.
  - Ticket olayları RTM'e gitmiyor (`apps/api/src/routes/tickets.ts:212`, yalnız otomasyon/webhook).
  - Mobil push: `apps/api/src/services/push`.
- **Eklenecek / değişecek yerler:**
  - **Prisma:**
    - `agent_memberships.notify_events jsonb NOT NULL DEFAULT '{}'`. Eksik anahtar varsayılan değeri alır.
    - `notify_repeat_sound boolean NOT NULL DEFAULT false`.
  - **Types / Contract:**
    - `NotificationPreferences.events`: `{incoming_chat, transferred_to_me, transferred_to_my_team, queue_waiting, new_ticket, ticket_reply}`.
    - `repeat_sound` alanı.
    - `readNotificationPreferences` geriye uyumlu kalır.
  - **API:**
    - Ticket oluşturma, atama ve yanıt (HD-01) için RTM push'ları: `incoming_ticket` ve `ticket_message_created`. Kitle: atanan, takipçiler ve ekip.
    - Ekip liderlerine kuyruk için `queue_updated` push'u. Traffic push'undan türetilebilir.
    - Mobil push gönderiminde de olay tercihi uygulanır.
  - **Web:**
    - `decideNotification` olay türüne göre karar verir.
    - `soundRepeater` bileşeni eklenir; davranışı "Kodlama mantığı"nda.
    - Sekmeler arasında tek ses çalması için `BroadcastChannel` ile "lider sekme" seçilir.
    - Ayar ekranına olay listesi eklenir; "yeni mesaj" satırı kilitli açıktır.
  - **Testler:**
    - Birim: `decideNotification` karar matrisi.
    - Entegrasyon: tercihlerin kaydı ve okunması.
    - E2e: `notifications.spec.ts` genişletilir.
- **Kodlama mantığı:**
  - **Ana anahtar:** kapalıysa hiçbir olay ses çıkarmaz (bugünkü kural korunur).
  - **"Yeni mesaj" olayı:** kapatılamaz, ama ses kanalı kapatılabilir (LiveChat'teki gibi).
  - **Tekrarlayan ses:**
    - İlk ses çalar, ardından her 10 sn'de bir tekrarlar.
    - Ajan o sohbeti açınca, mesaj okundu işaretlenince (`useMarkSeen`) ya da 2 dk dolunca durur.
    - Birden çok okunmamış sohbet için tek bir zamanlayıcı çalışır (en eski okunmamış sohbete göre).
  - **Odak:** sekme odaktaysa ve sohbet ekrandaysa ses çalmaz.
  - **Tarayıcı ses politikası:** kullanıcı etkileşimi olmadan AudioContext askıda kalabilir. Bu yüzden ilk tıklamada "sesleri etkinleştir" ipucu gösterilir.
- **Kabul kriterleri:**
  - Ajan "yeni ticket" olayını açınca, kendisine atanan ticket için ses ve masaüstü bildirimi alır; olayı kapatınca almaz.
  - "Tekrarla" açıkken okunmamış mesaj için ses 10 sn'de bir çalar; sohbet açılınca durur.
  - İki sekme açıkken ses bir kez çalar.
  - Ana anahtar kapalıyken hiçbir şey çalmaz.
  - Mobil push da olay tercihine uyar.
- **Riskler / notlar:**
  - Sürekli ses ajanı yorabilir. Bu yüzden tekrar varsayılan olarak kapalı ya da 04'teki Soru 1 kararına göre.
  - Ticket RTM push'u HD-01 ile birlikte gelmeli.

### IN-11 — Komut paletinden ayar alt sayfalarına gitme
- **Alan (panelde nerede, kim kullanır):** Ctrl+K komut paletinde, "Git" grubunun altında "Ayarlar" ve "Raporlar" grupları. Kullanıcı yalnız yetkisi olan bölümleri görür: Yönetici ve Kurucu çoğu ayarı, Ekip Üyesi kişisel ayarları.
- **Mevcut kod karşılığı:**
  - `apps/web/src/components/CommandPalette.tsx:238-312`: eylemler ve modüller döngüsü; kirli form koruması `confirmLeave` (`:307`).
  - `components/navigation.ts:66-163`: modül listesi.
  - `features/settings/settings-sections.ts`:
    - `:108-407`: 36 bölüm ve `keywords` (yalnız İngilizce).
    - `:418-426`: `visibleSections`.
    - `:454-470`: `searchSections`; eşleşme `toLowerCase()` ile yapılıyor.
  - `features/settings/SettingsNav.tsx`: `searchSections`'ın mevcut kullanımı.
  - `features/reports/report-views.ts`: rapor görünümleri.
- **Eklenecek / değişecek yerler:**
  - **Yalnız web:**
    - CommandPalette'e `searchSections(scopes, routeNeedle, labelOf, pilotMode, liveApps)` sonuçları (en fazla 6) ve rapor görünümleri eklenir.
    - `settings-sections.ts`'de Türkçe katlama düzeltilir ve Türkçe anahtar kelimeler eklenir (ör. "kısayol", "yanıt", "iki adımlı", "mesai", "şifre").
  - **Testler:**
    - `CommandPalette.test.tsx`: yetkisiz bölüm listelenmez; "iki" araması "İki adımlı doğrulama"yı bulur.
    - E2e: `command-palette.spec.ts` genişletilir.
- **Kodlama mantığı:**
  - **Türkçe büyük/küçük harf sorunu:**
    - JavaScript'te `'İ'.toLowerCase()` "i̇" (i artı birleşik nokta) verir; bu yüzden `includes('iki')` başarısız olur.
    - `'I'.toLowerCase()` "i" verir, oysa Türkçede "ı" beklenir.
  - **Çözüm:** etiket ve sorgu `toLocaleLowerCase('tr-TR')` ile küçültülür, NFD'ye çevrilir ve birleşik işaretler (`\p{M}`) silinir. "ı/i" ve "ş/s" gibi çiftler eşdeğer sayılır; böylece "sifre" araması "Şifre"yi bulur. Bu düzeltme Ayarlar içindeki aramayı da iyileştirir.
  - **Sonuç sırası:** etiketin başında eşleşme, sonra etiketin içinde eşleşme, sonra anahtar kelime eşleşmesi.
  - **Kirli form:** palette seçim yapılınca mevcut kirli form korumasından geçilir.
- **Kabul kriterleri:**
  - Yönetici Ctrl+K'da "hazır" yazınca "Hazır yanıtlar" ayarı listelenir ve Enter ile açılır.
  - Ekip Üyesi yetkisi olmayan güvenlik bölümlerini görmez.
  - "iki" ve "sifre" aramaları doğru bölümleri bulur.
  - Kaydedilmemiş bir form varken onay sorulur.
- **Riskler / notlar:**
  - Katlama değişikliği Ayarlar aramasının mevcut testlerini etkileyebilir. Bu testler Türkçe örneklerle güncellenmeli.

## 5. Arşiv (AR)

### AR-01 — Ayrı arşiv ekranı: liste + transkript + oyuncu paneli
- **Alan (panelde nerede, kim kullanır):**
  - Sol rayda yeni bir "Arşiv" modülü (`/app/archive`). Ekran üç sütundan oluşur: sonuç listesi, salt okunur transkript, oyuncu paneli.
  - Inbox'taki "Arşiv" görünümü kısa vadede kalır; satırlarında "Arşivde aç" bağlantısı olur.
  - Kimin neyi göreceği RL-02'ye bağlıdır. Varsayılan: Ekip Üyesi kendi ekiplerinin konuşmalarını, Ekip Lideri kendi ekibinin tamamını, Yönetici ve Kurucu hepsini görür.
- **Mevcut kod karşılığı:**
  - `packages/contract/openapi/paths/chats.yaml:13-107`: `listChats` (`view=archived`).
  - `apps/api/src/services/chat/chat-service.ts:2039-2175`: `listChatsInTenant`; sohbet bazlı, her satırda yalnız son thread. `:2586-2670`: `ChatDetail` yalnız son thread'i taşıyor.
  - `chats.yaml:164-225`: `GET /chats/{id}/events?thread_id=`; eski bir thread'in transkripti bugün de okunabiliyor.
  - `apps/web/src/features/inbox/Transcript.tsx`: `onEdit` verilmezse salt okunur çalışıyor.
  - `features/inbox/views.ts:124-133`: görünüm listesi.
  - `components/navigation.ts:66-123`: sol ray modülleri.
  - `App.tsx:128-191`: rotalar.
  - Ortak bileşenler: `components/EmptyState.tsx`, `LoadError.tsx`, `VirtualList.tsx`.
  - `apps/api/src/services/chat/access.ts`: görünürlük kuralı.
- **Eklenecek / değişecek yerler:**
  - **Contract:** yeni `paths/archive.yaml` dosyasında iki uç.
    - `GET /archive/conversations`:
      - Bir satır, ID-01'deki "bağlantı"dır (bugünkü nexa thread'i).
      - Alanlar: `chat_id`; `thread_id` (günlük grup, ID-02); bağlantı kimliği; `customer {id, name, username}`; `started_at`; `ended_at`; `assignee {id, name}`; `group_ids`; `tags`; `rating` (AR-03); `handled_by` (ai|human|mixed); `risk_flags` (AI-27); `first_customer_message` (kısa ve maskeli); `message_count`.
      - Parametreler: AR-02 filtreleri ve ID-06/ID-07 aramaları.
      - Keyset sayfalama. `total` üst sınırlıdır (`total_capped`).
    - `GET /archive/conversations/{id}`: tek bir bağlantının ayrıntısı. Etiketler, atanan ve puan o bağlantıya aittir; son thread'in değerleri kullanılmaz.
  - **Prisma:**
    - İki indeks, her biri ayrı bir migration dosyasında `CREATE INDEX CONCURRENTLY` ile: `threads(license_id, created_at DESC, id DESC)` ve `threads(license_id, closed_at DESC)`.
    - `threads.handled_by text NULL`: kapanışta yazılır. AR-02 ile ortaktır.
    - Oyuncu filtresi için `threads → chats.customer_id` join'i yeterli. Ölçüm kötü çıkarsa `threads.customer_id` denormalize edilir (genişlet → taşı → daralt).
  - **API:**
    - `services/archive/archive-service.ts` ve `routes/archive.ts`.
    - `withTenant` ve `resolveVisibility(read)`. Ekip görünürlüğü WHERE koşuluna girer; sonuçlar sonradan filtrelenmez.
    - İlk mesaj özeti `events` tablosundan, thread başına ilk oyuncu mesajı olarak alınır (`events(thread_id, created_at)` indeksi mevcut). Liste sayfası başına tek sorgu yapılır, N+1 yoktur.
  - **Web:**
    - `features/archive/` altında: `ArchivePage.tsx`, `ArchiveList.tsx`, `ArchiveDetail.tsx` (salt okunur Transcript ve IN-02 `PlayerCard`), `useArchive.ts`.
    - `navigation.ts`'e yeni modül; kapsam `chats--all:ro|chats--access:ro`.
    - URL durumu: `?c=<bağlantı id>` ve AR-02 filtreleri.
    - Boş, yükleniyor ve hata durumları ayrı gösterilir; LiveChat'teki "sonsuz iskelet" hatası tekrarlanmaz.
    - Arama çubuğu her zaman görünür.
  - **Testler:**
    - Entegrasyon (`archive.test.ts`): 3 kez yazmış bir oyuncu 3 satır olarak listelenir; ekip görünürlüğü uygulanır; kiracılar arası erişim engellenir.
    - E2e: `archive.spec.ts`.
- **Kodlama mantığı:**
  - **Gerçek zamanlılık:** arşiv canlı değildir, RTM aboneliği gerekmez. Bir sohbet kapanınca listenin ilk sayfası yeniden okunabilir.
  - **Yeniden açılan sohbet:** "resume" yeni bir thread açar. Eski bağlantı arşivde kalır, yenisi Inbox'ta görünür.
  - **Veri saklama:** DataRetention olayları sildiyse transkript yerine "saklama süresi dolduğu için silindi" yazılır. Silinmiş oyuncunun (customer-erasure) satırları hiç gelmez.
  - **Salt okunur:** arşivde mesaj düzenleme ya da etiket değiştirme gibi yazma eylemleri yoktur. "Inbox'ta aç / yeniden aç" ayrı bir eylemdir.
  - **Sıralama:** varsayılan olarak en yeni bitiş zamanı önce gelir.
  - **Dar ekran (GV-04):** üç sütun sekmelere dönüşür.
- **Kabul kriterleri:**
  - Arşiv modülü sol raydan açılır.
  - Aynı oyuncunun üç ayrı konuşması üç satır olarak listelenir; her satır kendi etiketini, atananını ve puanını gösterir.
  - Satır seçilince transkript ve oyuncu paneli yüklenir. URL paylaşılınca aynı konuşma açılır.
  - Ekip Üyesi ekip dışı konuşmaları listede görmez.
  - 1 milyon konuşmalı test verisinde ilk sayfa p95 < 800 ms içinde gelir.
  - Boş arşivde iskelet değil, "henüz arşiv yok" mesajı görünür.
- **Riskler / notlar:**
  - ID-01'deki kimlik sözlüğü netleşmeden "satır" tanımı belirsiz kalır. İşe "bağlantı = mevcut nexa thread'i" varsayımıyla başlanabilir.
  - Büyük tabloda `COUNT(*)` pahalıdır; sayaç bu yüzden üst sınırlı.
  - `events` tablosu aylık bölümlüdür. İlk mesaj sorgusu, bölüm budamasının çalışması için zaman aralığı koşulu içermeli.

### AR-02 — Filtreler: tarih (P0), ajan, ekip, puan, etiket, AI/insan, risk bayrağı; filtrelerin URL'de tutulması
- **Alan (panelde nerede, kim kullanır):** Arşiv ekranının üst bandında "Filtre ekle" menüsü ve çipler; tarih çipinde ‹ › ile aralık kaydırma. Tüm arşiv kullanıcıları filtreleri kullanır. Ajan filtresini Ekip Lideri ve üstü kullanır; Ekip Üyesi için bu filtre yalnız "ben" seçeneğini sunar.
- **Mevcut kod karşılığı:**
  - `packages/contract/openapi/paths/chats.yaml:25-72`: mevcut liste parametreleri.
  - `apps/api/src/services/chat/chat-service.ts:2068-2078`: `where` koşulunun kurulması (customer, group, channel, view). `:2099-2114`: keyset sayfalama.
  - `features/inbox/chat-sort.ts`: sıralamanın URL'de tutulma deseni.
  - `features/reports/ReportsPage.tsx:489-519`: UTC gün sınırlı tarih aralığı. Arşivde olduğu gibi kullanılmamalı ya da düzeltilmeli.
  - `apps/api/prisma/schema.prisma`:
    - `:55`: `organizations.timezone`, varsayılan "UTC".
    - `:1095-1106`: `thread_tags` (PK ve `tag_id` indeksi).
    - `:1278-1291`: `ratings` (yalnız `(license_id, created_at)` indeksi).
    - `:816-843`: `threads`.
- **Eklenecek / değişecek yerler:**
  - **Contract** (`GET /archive/conversations` parametreleri):
    - Tarih: `date_from` ve `date_to` (YYYY-MM-DD; kiracının saat diliminde yorumlanır) ya da `from` ve `to` (ISO).
    - `agent_id[]` (uuid) ve `group_id[]`.
    - `rating`: `any|not_rated|good|bad|commented|good_commented|bad_commented`.
    - `tag[]` (en fazla 20), `tag_mode` (`any|all|exclude`) ve `untagged` (bool).
    - `handled_by[]`: `ai|human|mixed`.
    - `risk_flag[]`: AI-27'nin enum değerleri.
    - `channel` ve `status` (`closed|open|all`).
  - **Prisma:**
    - `threads.handled_by` (AR-01).
    - `threads.agent_ids uuid[]`: konuşmada oyuncuya yazan ajanlar; kapanışta yazılır; GIN indeksli.
    - `threads.risk_flags text[]`: AI-27 tarafından yazılır; GIN indeksli.
    - `ratings(license_id, thread_id)` indeksi.
    - Geçmiş veri için tek seferlik doldurma (backfill) betiği, ayrı bir migration olarak.
  - **API** (`archive-service.ts` içindeki filtre derleyici):
    - Tarih filtresi, kiracının saat diliminde `[gün başı, ertesi gün başı)` aralığına çevrilir ve UTC'ye dönüştürülür.
    - Etiket modları: `any` → EXISTS; `all` → GROUP BY ile HAVING COUNT = n; `exclude` → NOT EXISTS.
    - Puan, thread'in son puanına göre değerlendirilir (LATERAL).
    - Ajan filtresi `agent_ids && $1` ile çalışır (seçilen ajanlardan herhangi biri).
    - Görünürlük WHERE koşulunun bir parçasıdır.
  - **Web:**
    - `features/archive/ArchiveFilters.tsx`: çipler ve popover'lar.
    - URL ↔ filtre durumu dönüştürücüsü. URL'de yalnız kimlikler tutulur; e-posta ya da ad yazılmaz.
    - Tarih ön ayarları kiracının saat dilimine göre hesaplanır. ‹ › aralığı kaydırır ve bugünü geçemez.
    - Çelişen filtreler (ör. "atanmamış" + ajan) sessizce silinmez; kullanıcıya uyarı gösterilir.
  - **Testler:**
    - Birim: URL dönüştürücüsü kişisel veri içermez.
    - Entegrasyon: her filtre ve kombinasyonları test edilir. İstanbul saatiyle 23:30'da başlayan bir konuşma doğru güne düşer.
    - E2e: filtreli bir URL yeniden yüklenince aynı sonuç gelir.
- **Kodlama mantığı:**
  - **Filtrelerin birleşimi:** filtreler kendi aralarında AND ile, bir filtrenin seçenekleri kendi içinde OR ile birleşir. Etikette eşleşme modu kullanıcı tarafından seçilir.
  - **"AI çözdü":** `handled_by='ai'` anlamına gelir. Kapanış anında thread'de oyuncuya görünen ajan yazarlı bir olay yoksa ve en az bir bot olayı varsa bu değer verilir. Bu, ADR-09 faturalama tanımıyla aynı yüklemdir ve ortak bir fonksiyonda tutulmalıdır.
  - **Sayaç:** filtre popover'larında canlı sayı gösterilmez, çünkü maliyetlidir. Toplam sonuç sayısı üst sınırlıdır.
  - **Gece vardiyası:** varsayılan gün sınırı 00:00'dır (ID-04 kiracı ayarı).
  - **Performans:** en sık kullanılacak kombinasyon tarih + ekiptir. Bunun için `threads(license_id, created_at)` ve `chat_access(group_id)` indeksleri kullanılır. Sorgular EXPLAIN ile ölçülmeli ve sonuç kanıt olarak yazılmalı.
- **Kabul kriterleri:**
  - "Dün" filtresi, kiracının saat diliminde 00:00–23:59 arasında başlayan konuşmaları getirir.
  - "Hariç: spam" etiket filtresi spam etiketli konuşmaları çıkarır.
  - Aynı tarih aralığında "AI çözdü" sayısı AI raporundaki sayıyla aynıdır.
  - Filtreli bir URL kopyalanıp başka tarayıcıda açılınca aynı liste gelir.
  - URL'de e-posta ya da ad bulunmaz.
  - 20'den fazla etiket seçilemez.
  - Çelişen filtre seçilince uyarı görünür.
- **Riskler / notlar:**
  - Denormalize kolonların geçmiş veriyle doldurulması uzun sürebilir; doldurma toplu ve sayfalı yapılmalı.
  - AI-27 gelene kadar risk filtresi çalışamaz; bu sürede arayüzde gizlenir.

### AR-03 — Arşivde puan ve yorumun gösterimi
- **Alan (panelde nerede, kim kullanır):** Arşiv listesinde satır başına puan ikonu ve metni; arşiv detayında ve Inbox sağ panelinde "Puan" satırı ve yorum. Kimin göreceği 04'teki 1. soruya bağlıdır. Varsayılan: Ekip Üyesi kendi konuşmalarınınkini, Ekip Lideri ve üstü hepsini görür.
- **Mevcut kod karşılığı:**
  - `apps/api/prisma/schema.prisma:1278-1291`: `ratings` tablosu.
  - `apps/api/src/routes/customer.ts:1096-1136`: oyuncu puanı uç noktası. Puan, son sohbetin son thread'ine yazılıyor. Yorum kart maskelemesinden geçiyor. Tekilleştirme yok, RTM push gitmiyor.
  - `packages/contract/openapi/paths/customer-chat.yaml`: puan sözleşmesi (good|bad, yorum ≤1000).
  - Raporlar › Reviews (`openapi.yaml:5728+`).
  - `features/inbox/DetailsPanel.tsx`: puan gösterilmiyor.
- **Eklenecek / değişecek yerler:**
  - **Prisma:** `ratings(license_id, thread_id, created_at DESC)` indeksi.
  - **Contract:**
    - Liste: `ConversationSummary.rating {value, has_comment}`.
    - Detay: `{value, comment, rated_at}`.
    - Inbox paneli için `ChatDetail.thread.rating`.
    - RTM `chat_rated` push'u: `{chat_id, thread_id, value}`; kitle atanan ve ekip.
  - **API:**
    - Okunan puan, thread'in en son puanıdır.
    - `thread_id` boş olan eski satırlar `chat_id` ve thread zaman aralığıyla eşleştirilir; tek seferlik backfill tercih edilir.
    - Görünürlük RL-02'ye göre uygulanır.
  - **Widget (WG-11 ile birlikte):** puan gönderilirken konuşmanın thread kimliği de gönderilir.
  - **Web:** `RatingBadge.tsx` (ikon ve metin; renk tek başına değil). Arşiv satırında, arşiv detayında ve DetailsPanel'de kullanılır.
  - **Testler:**
    - Entegrasyon: ikinci puan gösterimde birincinin yerini alır; başka ekibin ajanı yorumu göremez.
    - Birim testleri.
    - E2e: `csat.spec.ts` genişletilir; widget'tan verilen puan arşivde görünür.
- **Kodlama mantığı:**
  - Yorum düz metin olarak gösterilir, HTML render edilmez. Uzun yorum kısaltılır, tıklayınca tamamı açılır.
  - Puanın kaynağı her zaman oyuncudur; ajan puanı değiştiremez.
  - Yorumdaki hassas veriler: kart maskelemesi zaten var. AI-26'nın genişlettiği maskeleme (IBAN, şifre) aynı yazma yolunda uygulanır.
- **Kabul kriterleri:**
  - Oyuncu "kötü" puan ve yorum bırakınca arşiv satırında "Kötü (yorumlu)", detayda da yorumun kendisi görünür.
  - Inbox'ta açık sohbette puan RTM ile anında güncellenir.
  - Varsayılan kararda Ekip Üyesi başka bir ajanın yorumunu göremez.
  - Gösterilen puan, AR-02'deki puan filtresiyle tutarlıdır.
- **Riskler / notlar:**
  - Bugün puan, oyuncunun "en son sohbetinin en son thread'ine" yazılıyor. Oyuncu yeni bir konuşma açtıktan sonra eskisini puanlarsa puan yanlış konuşmaya düşer. Widget thread kimliğini gönderene kadar bu kayma devam eder.

### AR-04 — Transkripti dışa aktarma, yazdırma, e-postayla gönderme
- **Alan (panelde nerede, kim kullanır):** Arşiv detayında ve Inbox başlık menüsünde üç eylem: "İndir (TXT)", "Yazdır / PDF" ve "E-postayla gönder". Kimin kullanacağı 04'teki 1. soruya bağlıdır. Varsayılan: Ekip Lideri ve üstü; Ekip Üyesi yalnız kendi konuşmasını oyuncuya e-postayla gönderebilir.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/chat/chat-service.ts:1115-1280`: `#emailTranscript`. Kapanışta otomatik çalışır; oyuncuya ve atanan ajana gönderir; `deliver` ve posta kotasını kullanır.
  - `apps/api/src/services/notifications/chat-transcript.ts`: alıcı kararı ve `renderTranscript`. Oyuncu kopyasında iç not bulunmaz.
  - `services/mail/templates/messages.ts`: `customerTranscriptMail` ve `teamTranscriptMail`.
  - `services/mail/mailer.ts:19-73`: `kind: 'chat_transcript'`. Kiracı günlük kotaları `mail-caps.ts` içinde.
  - `apps/api/src/routes/reports-export.ts:212-238`: WinAnsi PDF üretici; Türkçe karakterleri basamıyor.
  - `services/audit/audit-log.ts`: `writeAuditEntry`.
- **Eklenecek / değişecek yerler:**
  - **Contract:**
    - `GET /chats/{chatId}/threads/{threadId}/transcript?format=txt|html&audience=customer|internal`: indirme; `Content-Disposition: attachment`.
    - `POST /chats/{chatId}/threads/{threadId}/transcript/email`: gövde `{to, audience:'customer'}`; yanıt 202; hata türü `recipient_not_allowed`.
  - **Kiracı ayarı:** `inbox_settings.transcript_allowed_domains text[]` (04, Soru 3).
  - **API:**
    - Dışa aktarım servisi `renderTranscript`'i yeniden kullanır; TXT ve yazdırılabilir HTML üretir.
    - Başlıkta şunlar yer alır: kiracı adı, Chat ID ve thread ID (ID-05), oyuncunun kullanıcı adı, kiracı saat diliminde başlangıç ve bitiş, ajanlar, dışa aktaran kişi ve zaman.
    - Denetim kaydı: `chat.transcript_exported` ve `chat.transcript_emailed`. Kaydedilenler: kim, hangi konuşma, alıcının alan adı. Metin kaydedilmez.
    - E-posta `BackgroundMail` ile ve `kind:'chat_transcript'` olarak gönderilir; dış kotaya tabidir.
    - Scope kontrolü ve RL-02 uygulanır.
  - **Web:**
    - `features/archive/TranscriptActions.tsx`.
    - Yazdırma için `/app/archive/:id/print` rotası: kabuksuz sayfa, `@media print` stili, Türkçe karakterleri destekleyen sistem fontu. Kullanıcı tarayıcıdan "PDF olarak kaydet" seçer.
    - E-posta modalı: alıcı varsayılan olarak oyuncunun e-postasıdır; izinli alan adı doğrulaması yapılır.
  - **Testler:**
    - Entegrasyon: oyuncu kopyasında iç not yoktur; izin dışı alan adı reddedilir; denetim satırı yazılır; kiracılar arası istek 404 döner.
    - E2e: yazdırma sayfası "ğşıİ" karakterlerini doğru gösterir; `apps/e2e/tests/mailbox.ts` ile e-posta içeriği doğrulanır.
- **Kodlama mantığı:**
  - **Kopyalar:** "iç kopya" yalnız indirilebilir ve yazdırılabilir. Dışarıya e-postayla yalnız iç not içermeyen oyuncu kopyası gider.
  - **Ekler:** transkriptte dosya adı ve "panelde görüntüleyin" notu olarak gösterilir. Süreli imzalı bağlantılar e-postaya konmaz; hem süreleri dolar hem de dışarı sızarlar.
  - **Maskeleme:** kayıtlı metin zaten maskeli (kart). AI-26'nın genişletmesi otomatik olarak yansır.
  - **Büyük konuşmalar:** akış (stream) halinde üretilir.
  - **Oran sınırı:** kullanıcı başına dakikada N dışa aktarım. Toplu veri sızdırma girişimini tespit etmek için.
  - **Şablon birliği:** kapanışta giden mevcut otomatik e-posta ile isteğe bağlı gönderim aynı şablonu kullanır. WG-06 bunun üzerine oyuncunun widget'tan transkript istemesini ekler.
- **Kabul kriterleri:**
  - Ekip Lideri arşivde bir konuşmayı TXT olarak indirir. Dosyada Chat ID ve thread ID bulunur, saatler kiracının saat diliminde yazılır, iç notlar yalnız "iç kopya"da yer alır.
  - Yazdırma görünümü Türkçe karakterleri doğru basar.
  - Oyuncuya giden e-posta iç not içermez.
  - İzinli olmayan bir alan adına gönderim reddedilir.
  - Her işlem denetim kaydında görünür.
  - Varsayılan kararda Ekip Üyesi iç kopyayı indiremez.
- **Riskler / notlar:**
  - Bu özellik bir veri sızdırma yolu da açar; yetki, denetim kaydı ve oran sınırı şart.
  - Sunucu tarafında PDF üretimi istenirse Türkçe karakterler için gömülü font gerekir. Bu, yeni bir bağımlılık kararı demektir ve reports-export'taki "bağımlılık yok" ilkesiyle çelişir.

## 6. HelpDesk / ticket (HD)

### HD-01 — Ticket'a yanıt verme ve yazışma geçmişi + iç not
- **Alan (panelde nerede, kim kullanır):** Inbox › Ticket'lar › ticket seçili › TicketPane. Üstte ticket bilgileri, ortada yazışma akışı, altta "Yanıt / İç not" modlu yanıt kutusu. Ticket'a yazma yetkisi olanlar kullanır (`tickets--access:rw` / `tickets--all:rw`); RL-02 ile ayarlanır.
- **Mevcut kod karşılığı:**
  - `apps/api/prisma/schema.prisma:1117-1165`: `Ticket` modelinde mesaj yok. `:1167-1181`: takipçiler.
  - `apps/api/src/services/tickets/ticket-service.ts`:
    - `:265-294`: `create`.
    - `:306-334`: `createFromEmail`.
    - `:352-376`: `createFromWidget`.
    - `:378-456`: `update`.
    - `:433-439`: "no reply endpoint" açıklaması.
  - `apps/api/src/routes/tickets.ts:280-373`: durum değişiminde şablonlu bildirim, arka planda e-posta.
  - `services/tickets/ticket-email.ts`: şablon render; pilot "no-reply" satırı `:118-133`.
  - `services/mail/mailer.ts`; `smtp-mailer.ts:159` (Message-ID üretimi); `mime.ts` (`composeMessage`, ek desteği).
  - `packages/contract/openapi/paths/tickets.yaml`: mesaj ucu yok.
  - `apps/web/src/features/inbox/TicketPane.tsx` ve `useTickets.ts`.
  - `canned_responses.scope='ticket'` (`schema.prisma:1314`).
  - `services/webhooks/webhook-service.ts:33`: `ticket_created`.
  - `apps/api/src/plugins/pilot-gate.ts`.
- **Eklenecek / değişecek yerler:**
  - **Prisma:**
    - Yeni `ticket_messages` tablosu. Kolonlar:
      - `id uuid`, `license_id bigint`, `ticket_id varchar(12)`.
      - `kind`: `customer_message|agent_reply|internal_note|system`.
      - `author_type`: `customer|agent|system|bot`; `author_id`.
      - `body_text`; `body_html` (yalnız temizlenmiş, gelen e-postada).
      - `attachments jsonb`: `[{key, name, size, mime, scan_status, sensitive}]`.
      - `email_message_id`, `in_reply_to`.
      - `delivery_status`: `queued|sent|failed|null`.
      - `idempotency_key`, `created_at`.
    - RLS politikası: `license_id = siyahtus_current_license()`.
    - İndeksler: `(ticket_id, created_at)`; `(license_id, email_message_id)` kısmi unique; `(license_id, idempotency_key)` unique.
    - `tickets` tablosuna nullable kolonlar: `first_response_at`, `last_customer_message_at`, `last_agent_message_at`.
  - **Contract:**
    - `GET /tickets/{ticketId}/messages`: sayfalı, eskiden yeniye.
    - `POST /tickets/{ticketId}/messages`: gövde `{kind: reply|note, text (≤20.000), attachment_keys[], set_status?: pending|solved, idempotency_key}`.
    - `TicketMessage` şeması.
    - Hata türleri: `ticket_no_recipient`, `ticket_merged`.
  - **API** (`services/tickets/ticket-message-service.ts`):
    - Yazarken kart maskelemesi (`maskCardNumbers`) ve AI-26 uygulanır.
    - Ticket'ın zaman damgaları güncellenir.
    - İlk ajan yanıtında `first_response_at` yazılır ve SLA değerlendirilir (HD-05).
    - Durum geçişi: yanıttan sonra varsayılan `pending`, oyuncu yazınca `open`.
    - Denetim kaydı: `ticket.replied` / `ticket.note_added`. Metin kaydedilmez.
    - **E-posta gönderimi:**
      - Commit'ten sonra `BackgroundMail` ile.
      - From: sistem adresi + marka adı. Reply-To: HD-03 token adresi.
      - Message-ID saklanır; `In-Reply-To` ve `References` önceki mesajdan alınır.
      - Teslim sonucu `delivery_status`'a yazılır.
      - Yeni posta türü `kind: 'ticket_reply'`; dış kotaya tabidir.
    - **Birleştirilmiş ticket'lar:** birleştirilmiş bir ticket'a yazma reddedilir (`ticket_merged`) ve birincil ticket'a yönlendirilir. Birincilin akışı, birleşen ticket'ların mesajlarını da gösterir.
  - **RTM ve webhook:**
    - RTM `ticket_message_created`; kitle atanan, takipçiler ve ekip.
    - İsteğe bağlı webhook olayı `ticket_message_created`.
  - **Pilot:** 04'teki 3. sorunun kararı `plugins/pilot-gate.ts` içinde uygulanır.
  - **Web:**
    - `TicketThread.tsx`: yazışma akışı. İç not sarı, oyuncu ve ajan mesajları ayrık, ekler görünür.
    - `TicketComposer.tsx`: Composer'ın mod desenini kullanır (Yanıt / İç not). `#` ile `scope=ticket` hazır yanıtlar gelir. "Gönder ve çözüldü yap" seçeneği vardır.
    - `useTicketMessages.ts`.
    - TicketPane'e yerleşim.
    - Gönderim başarısız olursa satırda "tekrar dene" görünür.
  - **Testler:**
    - Entegrasyon (`ticket-messages.test.ts`): iç not hiçbir zaman e-postaya gitmez (mail spool kontrolüyle); kiracılar arası erişim engellenir; idempotency; birleşmiş ticket'a yazma.
    - Birim testleri.
    - E2e: `tickets-reply.spec.ts` ve `apps/e2e/tests/mailbox.ts`.
- **Kodlama mantığı:**
  - **İç not / yanıt ayrımı:** ikisinin karışması en pahalı hatadır. Mod görsel olarak ayrışır (sohbetteki amber not deseni). Sunucu `kind=internal_note` için posta yolunu hiç çağırmaz.
  - **Oyuncunun e-postası yoksa:** yanıt seçeneği açıklamayla birlikte devre dışı kalır; yalnız not yazılabilir.
  - **Giden e-posta:** düz metin ve basit HTML. İçinde son mesaj bulunur; konu satırında ticket numarası (`[#ID]`) yer alır. Önceki yazışmalar alıntılanmaz.
  - **Gelen HTML:** hiçbir zaman ham olarak render edilmez.
  - **Ekler:** mevcut `/uploads` akışıyla yüklenir (virüs tarama, boyut sınırı).
  - **Merge:** tek akışta birincinin ve birleşenlerin mesajları tarih sırasıyla gösterilir. Ayırma (unmerge) yapılınca her mesaj kendi ticket'ında kalır, çünkü mesajın `ticket_id`'si değişmez.
- **Kabul kriterleri:**
  - Ajan yanıt yazınca oyuncunun posta kutusuna (test spool'u) ticket numaralı bir e-posta düşer ve akışta "gönderildi" görünür.
  - İç not hiçbir zaman e-postaya gitmez (test).
  - Oyuncunun e-postası olmayan ticket'ta yanıt kapalıdır.
  - Aynı istek iki kez gelirse tek mesaj oluşur.
  - Birleşmiş ticket'ta yazma reddedilir.
  - Yanıttan sonra ticket "beklemede" durumuna geçer.
  - SMTP hatasında satırda "gönderilemedi · tekrar dene" görünür.
- **Riskler / notlar:**
  - Sistem alan adında SPF, DKIM ve DMARC doğru kurulmalı; aksi halde yanıtlar spam'e düşer.
  - Pilot kapısının kararı verilmeli.
  - Yoğun HelpDesk kullanımında günlük dış posta kotası yetmeyebilir.

### HD-02 — Gelen e-postanın gövdesi ve eklerinin kaydedilmesi
- **Alan (panelde nerede, kim kullanır):** Arka uçta gelen e-posta webhook'u; TicketPane akışında oyuncu mesajı ve ekleri. Ekleri kimin açacağı RL-02'ye bağlıdır; hassas ekler için erişim kısıtlıdır.
- **Mevcut kod karşılığı:**
  - `apps/api/src/routes/channels.ts`:
    - `:100-108`: `inboundBody` (to, from, subject, spam; `text` alanı kabul ediliyor ama saklanmıyor).
    - `:388-448`: webhook; `INBOUND_EMAIL_SECRET` başlığı; `pilotRefused`.
  - `apps/api/src/services/channels/email-inbound.ts:113-169`: spam kapısı, müşteri eşleme, ticket'a yalnız konu.
  - `services/security/spam-filter.ts`.
  - `apps/api/src/lib/cc-mask.ts`.
  - `services/storage/`: `object-store.ts`, `local-store.ts`, `s3-store.ts`, `attachment.ts`, `virus-scanner.ts` (tarayıcı kapalıysa dosyayı reddeder).
  - `packages/contract/openapi/paths/channels.yaml#/emailInbound`.
- **Eklenecek / değişecek yerler:**
  - **Contract:**
    - `emailInbound` gövdesi için normalize bir şema. Alanlar: `to`, `cc[]`, `from`, `subject`, `text`, `html`, `message_id`, `in_reply_to`, `references[]`, `headers {auto_submitted, precedence, x_autoreply}`, `attachments[] {filename, content_type, size, content_base64}`.
    - Sağlayıcıya özgü dönüştürücüler (Postmark, Mailgun, SendGrid, SES) ayrı adaptörlerde yazılır.
  - **API** (`email-inbound.ts` genişletilir; adımlar sırayla):
    1. **Idempotency:** `(license_id, email_message_id)` zaten varsa aynı sonuç döndürülür.
    2. **Eşleştirme:** HD-03'e göre yapılır; eşleşme yoksa yeni ticket açılır.
    3. **Gövde:** alıntılanmış eski yazışma ve imza ayıklanır. Gmail, Outlook ve Apple Mail kalıpları ile Türkçe "… tarihinde … şunu yazdı:" satırı tanınır. Kart maskesi ve uzunluk sınırı uygulanır.
    4. **HTML:** izin listesiyle temizlenir (script, iframe, style ve on* öznitelikleri yok; dış görseller `data-src`'ye alınır). Yalnız `body_html` alanına yazılır.
    5. **Ekler:** tip ve boyut kontrolü, ardından virüs taraması, ardından depolama anahtarı ve `attachments` jsonb. Reddedilen ek için bir sistem notu düşülür.
    6. **Kayıt:** bir `ticket_messages` satırı (`customer_message`) yazılır.
    7. **Spam:** spam değerlendirmesine gövde de dahil edilir.
    - Bu rota için ayrı bir Fastify `bodyLimit` (ör. 30 MB) tanımlanır.
  - **Prisma:**
    - HD-01'deki tablo kullanılır.
    - `attachments[].sensitive` bayrağı: dosya adı ya da konuda "kimlik", "pasaport", "ehliyet" veya "KYC" geçiyorsa, ya da kiracı "tüm ekleri hassas say" ayarını açtıysa işaretlenir.
  - **Web:**
    - `TicketThread.tsx` gövdeyi `white-space: pre-wrap` ile düz metin olarak gösterir.
    - "Biçimli görünüm", sandbox'lı bir iframe içinde açılır (boş `sandbox`, `srcdoc`, CSP).
    - Ek listesi: önizleme yalnız görsel ve PDF için. Hassas ekler yetkiye göre bulanık ya da kilitli gösterilir.
  - **Testler:**
    - Entegrasyon (`channel-email-inbound.test.ts` genişletilir):
      - Gmail'den gelen Türkçe bir yanıt alıntısız saklanır.
      - EICAR test dosyası içeren ek reddedilir ve not düşülür.
      - Aynı Message-ID iki kez gelirse tek ticket oluşur.
      - Script içeren HTML temizlenir.
    - Birim: alıntı ayıklayıcı.
- **Kodlama mantığı:**
  - **Kayıt sırası:** ticket ve mesaj tek bir transaction içinde yazılır. Ekler bundan önce, transaction dışında yüklenir. Başarısız bir ek mesajı engellemez; yalnız not düşülür.
  - **Saklama:** hassas ekler kiracının veri saklama politikasına bağlanır (`services/retention`).
  - **Maskeleme kapsamı:** oyuncunun imzasındaki telefon gibi bilgiler maskelenmez. Yalnız kart, şifre ve IBAN kuralları uygulanır (AI-26).
  - **Erişim kaydı:** hassas bir eki kimin açtığı denetim kaydına yazılır.
- **Kabul kriterleri:**
  - Oyuncunun "Yatırımım geçmedi, 2.500 TL, saat 14:42, dekont ektedir" e-postası ticket'ta metniyle ve dekont ekiyle görünür.
  - Alıntılanmış eski yazışma ana metinde görünmez, açılır bir bölümde durur.
  - Virüslü ek saklanmaz ve ticket'a not düşer.
  - HTML içindeki script çalışmaz.
  - Aynı e-posta iki kez gelirse tek ticket oluşur.
  - Kart numarası maskelenir.
- **Riskler / notlar:**
  - Alıntı ayıklama kusursuz değildir; bu yüzden ham metin de saklanmalı ve "tamamını göster" seçeneği olmalı.
  - Gelen e-posta sağlayıcısı henüz seçilmedi; webhook şeması sağlayıcıdan bağımsız tutulmalı.
  - Kimlik belgeleri hassas veridir; erişim kaydı tutulmalı.

### HD-03 — E-posta yazışma zinciri: müşterinin yanıtı aynı ticket'a bağlanır
- **Alan (panelde nerede, kim kullanır):** Arka uçta gelen ve giden e-posta. Ajan arayüzünde ticket akışında "oyuncunun yanıtı" ve gerekirse "farklı gönderen" uyarısı görünür.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/channels/email-inbound.ts`:
    - `:95-111`: `parseRecipient`; `<org>+<label>` yapısını çözer ve küçük harfe çevirir.
    - `:139-167`: müşteri eşleme ve ticket oluşturma.
  - `services/channels/inbound-email-address.ts:41`: `LABEL_RE` (en fazla 32 karakter, `[a-z0-9-]`).
  - `apps/api/src/routes/channels.ts:414-428`: `email_resolve_inbound_address`; etiketli adreslerin tabloda kayıtlı olması gerekiyor.
  - `services/mail/smtp-mailer.ts:159`: Message-ID üretimi. `mime.ts:68+`: başlık üretimi.
  - `services/tickets/ticket-email.ts:118-133`: giden e-postada Reply-To olmadığına dair not.
  - `Ticket.mergedIntoId` (`schema.prisma:1134`).
  - `packages/types/src/ids.ts`: ticket kimlikleri 10 karakterlik Crockford Base32.
- **Eklenecek / değişecek yerler:**
  - **API** (`services/tickets/ticket-reply-address.ts`):
    - **Yanıt adresi üretimi:** `<org>+t-<ticketid küçük harf>-<imza8>@<INBOUND_EMAIL_DOMAIN>`. Etiket 21 karakterdir ve `LABEL_RE`'ye uyar. İmza, HMAC(lisans sırrı, ticket id) değerinin ilk 8 karakteridir.
    - **Çözümleme:** etiket `t-` ile başlıyorsa tabloya bakılmaz. Lisans, organizasyonun varsayılan adresinden çözülür ve imza doğrulanır.
  - **Eşleştirme sırası** (`email-inbound.ts`):
    1. To, Cc ya da Delivered-To içinde geçerli bir `t-` token'ı.
    2. `In-Reply-To` / `References` → `ticket_messages.email_message_id`.
    3. Konu satırında `[#ID]` ve aynı gönderen e-postası.
    4. Hiçbiri yoksa yeni ticket.
  - **Eşleşme sonrası:**
    - Bulunan ticket birleştirilmişse birincile yönlendirilir.
    - Durum `solved` ise `open` yapılır ve "yeniden açıldı" sistem mesajı düşülür.
    - Durum `closed` ise ya da ticket N günden eskiyse yeni ticket açılır ve `related_ticket_id` ile eskiye bağlanır (04, Soru 1).
    - Gönderen farklıysa mesaj eklenir ve `sender_mismatch=true` işaretlenir.
  - **Giden e-posta:**
    - HD-01 yanıtlarında ve HD-04 otomatik onayında `Reply-To`, konu satırında `[#ID]` ve `References` zinciri bulunur.
    - Bu yol açılınca `ticket-email.ts`'teki pilot "no-reply" satırı kaldırılır.
  - **Döngü koruması:**
    - Gelen e-postada şu başlıklardan biri varsa otomatik yanıt tetiklenmez ve ticket yeniden açılmaz, yalnız not düşülür: `Auto-Submitted` (değeri `no` değilse), `X-Autoreply`, `Precedence: bulk|auto_reply`, `X-Auto-Response-Suppress`.
    - Gönderen başına saatlik ticket açma ve yeniden açma sınırı uygulanır.
  - **Prisma:**
    - `tickets.related_ticket_id varchar(12) NULL`.
    - `ticket_messages.sender_mismatch boolean`.
    - HMAC sırrı: lisans başına `licenses.reply_token_secret` (ilk kullanımda üretilir) ya da deployment sırrı + license id.
  - **Testler:**
    - Entegrasyon:
      - Oyuncunun cevabı aynı ticket'a düşer.
      - Token oynanmışsa yeni ticket açılır.
      - `In-Reply-To` ile eşleşme çalışır.
      - Çözülmüş ticket yeniden açılır.
      - Birleşmiş ticket'a gelen cevap birincile düşer.
      - Otomatik yanıt döngüsü oluşmaz.
    - Birim: adres üretme ve çözme.
- **Kodlama mantığı:**
  - **Token güvenliği:** token tahmin edilemez olmalı (HMAC), çünkü adresi bilen herkes ticket'a mesaj ekleyebilir. Yine de eklenen mesaj yalnız "oyuncu mesajı" olur ve hiçbir yetki vermez.
  - **Büyük/küçük harf:** Crockford alfabesinde I, L, O ve U olmadığı için küçük harfe çevirmek tek anlamlıdır.
  - **Konu satırı eşleşmesi:** yalnız aynı gönderenle yapılır. Aksi halde başka biri konuya "[#ID]" yazarak başkasının ticket'ına mesaj ekleyebilir.
  - **Spam kapısı:** eşleştirmeden önce çalışır.
- **Kabul kriterleri:**
  - Oyuncu ajanın yanıtına "Yanıtla" ile cevap verince yeni ticket açılmaz; mesaj aynı ticket'ta görünür ve ticket "açık" duruma geçer.
  - Reply-To'su silinmiş ama `In-Reply-To` başlığı bulunan cevap da doğru ticket'la eşleşir.
  - İmzası bozuk bir token yeni ticket açar.
  - Çözülmüş ticket'a gelen cevap onu yeniden açar.
  - Kapalı ticket'a gelen cevap, eskisine bağlı yeni bir ticket açar.
  - Otomatik yanıtlar arasında döngü oluşmaz (test).
- **Riskler / notlar:**
  - Bazı e-posta istemcileri Reply-To'yu yok sayar; bu yüzden başlık eşleşmesi şart.
  - Gelen e-posta sağlayıcısının "+" alt adreslemeyi desteklemesi gerekir. Mevcut tasarım zaten buna dayanıyor.

### HD-04 — Otomatik "talebiniz alındı" yanıtı
- **Alan (panelde nerede, kim kullanır):**
  - (a) Ayarlar › Ticket kuralları'nda yeni bir eylem: "Şablon e-postası gönder". Yönetici ve üstü kullanır.
  - (b) Ticket akışında "Otomatik onay gönderildi" sistem satırı.
- **Mevcut kod karşılığı:**
  - `apps/api/src/services/tickets/ticket-rule-matching.ts:30-75`: koşullar (konu içerir, kaynak) ve eylemler (ajan/ekip ata, öncelik, etiket).
  - `apply-ticket-rules.ts`: kurallar ticket oluşturulurken transaction içinde uygulanıyor.
  - `ticket-rule-service.ts` ve `packages/contract/openapi/paths/ticket-rules.yaml`.
  - `services/tickets/ticket-email.ts`: render ve reddetme kuralları. `ticket-email-template-service.ts`: `prepareTicketEmail`.
  - `routes/tickets.ts:296-373`: e-posta commit'ten sonra `backgroundMail` ile gönderiliyor.
  - `packages/types/src/template-variables.ts`: değişken kataloğu.
  - `ticket-service.ts:306-376`: e-posta ve widget kaynaklı ticket'lar.
  - `services/sla/business-hours.ts` ve `work-schedule`: mesai saatleri.
- **Eklenecek / değişecek yerler:**
  - **Types / Contract:**
    - `TicketRuleActions.send_template_id` (uuid). `hasAction` bu eylemi de tanır.
    - Kurallara yeni koşul: `outside_business_hours` (bool).
    - Şablon değişkenlerine `ticket.expected_response` eklenir. Değeri HD-05 hedefinden gelir: mesai içinde "4 saat içinde", mesai dışında "09:00 itibarıyla".
  - **API:**
    - `applyTicketRules`, transaction içinde e-posta göndermez; gönderilecek bildirimleri toplayıp döndürür.
    - Çağıranlar (`create`, `createFromEmail`, `createFromWidget`) bu bildirimleri commit'ten sonra `backgroundMail` ile gönderir.
    - `ticket_messages`'a bir `system` satırı yazılır: "Otomatik onay gönderildi: <şablon adı>".
    - Giden e-postada `Auto-Submitted: auto-replied` başlığı bulunur; Reply-To HD-03 adresidir.
    - Döngü kuralları HD-03 ile ortaktır.
    - Oyuncunun e-postası yoksa gönderim atlanır ve sistem satırına "alıcı yok" yazılır.
  - **Web:** `features/settings/TicketRules.tsx` eylem seçicisine şablon seçimi ve örnek verilerle önizleme eklenir.
  - **Testler:**
    - Entegrasyon:
      - E-postadan açılan ticket için spool'da onay e-postası görünür.
      - Sohbetten açılan ticket'ta, kural kaynağı nedeniyle onay gitmez.
      - Otomatik yanıt e-postasından açılan ticket'a onay gitmez.
      - Şablon devre dışıysa gönderim yapılmaz.
    - E2e: `tickets.spec.ts`.
- **Kodlama mantığı:**
  - Bir ticket'a en fazla bir otomatik onay gider; birden çok kural eşleşirse ilk eşleşen kazanır.
  - Birleştirilmiş ya da spam olarak işaretlenmiş ticket'a onay gönderilmez.
  - Mesai içi ve mesai dışı şablonlar iki ayrı kural olarak yazılır (`outside_business_hours` koşuluyla).
  - Pilot modunda e-posta kapısı HD-01'deki 3. sorunun kararına bağlıdır.
  - Dil: şablon kiracınındır. Çok dillilik, WG-02'den sonra şablon başına bir dil alanıyla eklenir.
- **Kabul kriterleri:**
  - E-postayla gelen talebe 1 dakika içinde ticket numaralı bir onay gider.
  - Mesai dışında mesai dışı şablonu gider.
  - Onay, ticket akışında sistem satırı olarak görünür.
  - Oyuncunun onaya verdiği cevap aynı ticket'a düşer (HD-03).
  - Otomatik yanıt veren bir adresle onay döngüsü oluşmaz.
- **Riskler / notlar:**
  - Spam gönderenlere onay göndermek (backscatter) sistemin e-posta itibarını düşürür. Spam kapısından geçmeyen ya da SPF/DMARC doğrulaması başarısız olan gönderenlere onay gönderilmemeli.

### HD-05 — Ticket ilk yanıt SLA'sı
- **Alan (panelde nerede, kim kullanır):**
  - (a) Ayarlar › SLA: öncelik bazlı "Ticket ilk yanıt hedefi". Yönetici ve üstü düzenler.
  - (b) Ticket listesi ve TicketPane: "İlk yanıt: 1 sa 20 dk kaldı" ya da "aşıldı".
  - (c) Raporlar › Cases: ortalama ve medyan ilk yanıt süresi.
  - (d) İhlal uyarısı: mevcut SLA e-postası ve IN-10.
- **Mevcut kod karşılığı:**
  - `apps/api/prisma/schema.prisma`:
    - `:2779-2790`: `sla_policies` (first_response_minutes, resolution_minutes, business_hours_only); sohbet ve ticket için ortak.
    - `:2805-2827`: `sla_breaches`; `subject_type` ticket ya da thread; idempotent unique kısıtı.
  - `apps/api/src/services/sla/`:
    - `sla-service.ts`: `evaluateSubject` ve `readClock`.
    - `sla-sweep.ts:173-240`: ticket için yalnız çözüm süresi taranıyor.
    - `business-hours.ts`.
  - `services/scheduler/jobs.ts:146-149`: periyodik tarama işi.
  - `services/tickets/ticket-service.ts:428-453`: çözüm saatinin durdurulması.
  - `apps/web/src/features/settings/SlaPolicy.tsx` ve `features/inbox/TicketGrid.tsx`.
  - `apps/api/src/routes/reports.ts`: `/reports/cases`.
- **Eklenecek / değişecek yerler:**
  - **Prisma:**
    - `sla_policies` tablosuna nullable kolonlar: `ticket_first_response_minutes int`, `ticket_resolution_minutes int`, `ticket_targets_by_priority jsonb` (ör. `{urgent: dk, high: dk, …}`).
    - Ticket ilk yanıt alanı boşsa ortak alan kullanılmaz, ölçüm yapılmaz. Bugün de ölçülmüyor, dolayısıyla davranış değişmez.
    - Ticket çözüm hedefi boşsa mevcut ortak değer kullanılmaya devam eder (genişlet → taşı → daralt).
    - `tickets.first_response_at` (HD-01).
  - **API:**
    - HD-01'in yanıt yolunda ilk `agent_reply` geldiğinde `first_response_at` yazılır ve `evaluateSubject` çağrılır: `{subjectType:'ticket', target:'first_response', startedAt: created_at, stoppedAt: now}`.
    - `sla-sweep.ts` adaylarına şu ticket'lar eklenir: `first_response_at IS NULL`, durumu open ya da pending, birleştirilmemiş ve sohbetten açılmamış (`source_chat_id IS NULL`, 04'teki 3. soru).
    - Hedef, önceliğe göre `ticket_targets_by_priority`'den okunur. Mesai hesabı `business-hours.ts` ile yapılır.
    - Ticket yanıtına `sla {first_response_due_at, first_response_breached}` bloğu eklenir.
    - Listeye "SLA'ya en yakın" sıralaması eklenir.
  - **Contract:**
    - `SlaPolicy` şemasına yeni alanlar.
    - `Ticket` / `TicketDetail` şemalarına `sla` bloğu.
    - `/reports/cases` yanıtına `first_response {avg_minutes, median_minutes, breached_count}`.
  - **Web:**
    - `SlaPolicy.tsx`: sohbet ve ticket için ayrı bölümler.
    - `TicketGrid.tsx`: yeni kolon.
    - `TicketPane.tsx`: canlı kalan süre rozeti (renk ve metin birlikte).
    - Raporlar'a yeni kart.
  - **Testler:**
    - Entegrasyon:
      - Hedef içinde verilen ilk yanıtta ihlal oluşmaz.
      - Hedef aşılınca tek bir ihlal satırı yazılır.
      - İç not ve otomatik onay saati durdurmaz.
      - Öncelik değişince hedef yeniden hesaplanır.
      - Mesai dışı süre sayılmaz.
    - Birim: kalan süre hesabı.
- **Kodlama mantığı:**
  - **İlk yanıt tanımı:** yalnız ajanın yazdığı `agent_reply` sayılır. Otomatik onay (`system`) ve iç not (`internal_note`) sayılmaz.
  - **Öncelik değişimi:** hedef yeni önceliğe göre hesaplanır, başlangıç zamanı değişmez.
  - **Yeniden açılma:** ticket yeniden açılınca ilk yanıt saati yeniden başlamaz. "Sonraki yanıt" SLA'sı ileride ayrı bir madde olabilir.
  - **Birleştirme:** birleştirilen ticket'ın saati birincile taşınmaz. Mevcut ilke: birleşen ticket ayrı bir iş olmaktan çıkar.
  - **İhlal kaydı:** ihlal ilk görüldüğü anda sabitlenir (mevcut idempotent unique kısıtı).
- **Kabul kriterleri:**
  - "Acil: 60 dk" hedefli bir ticket'a 45. dakikada yanıt verilince ihlal oluşmaz.
  - 61. dakikada yanıt yoksa tarama ihlal yazar ve bildirim gider.
  - İç not yazmak saati durdurmaz.
  - İş saatleri seçiliyse mesai dışı saatler sayılmaz.
  - Liste kalan süreyi gösterir ve en acile göre sıralanabilir.
  - Rapor ortalama ilk yanıt süresini verir.
- **Riskler / notlar:**
  - Mevcut ortak `first_response_minutes` değeri ticket'lara doğrudan uygulanırsa, mevcut kiracılarda bir anda çok sayıda ihlal oluşur. Bu yüzden ticket hedefi ayrı bir alanda tutulmalı ve varsayılan olarak boş olmalı (açıkça ayarlanmadıkça ölçülmez).
  - Sohbetten açılan ticket'ların SLA dışında bırakılması 04'teki karara bağlı.

---

> Bu parça `05-uygulama-rehberi.md` dosyasının 7–12. bölümleridir. Kimlikler `03-eklenebilecekler.md` ile aynıdır.
> Kod yolları `nexa-main` köküne göredir ve 2026-10-14 tarihinde salt okunarak doğrulanmıştır. Satır numaraları o günkü çalışma kopyasına aittir. Repoda commit'lenmemiş `customer_username` değişiklikleri vardır (`git status`), bu yüzden `customer.ts`, `widget.ts`, `api.ts` satırları birkaç satır kayabilir.
> Kısa yollar: `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `wdg/` = `apps/widget/src/`, `types/` = `packages/types/src/`, `contract/` = `packages/contract/openapi/`, `prisma` = `apps/api/prisma/schema.prisma`.
> Ortak kurallar (her madde için geçerli, tekrar yazılmadı):
> - Sıra **contract-first**: OpenAPI + `@siyahtus/types` → Prisma migration → servis + birim test → web/widget → entegrasyon/E2E (MASTER-PROMPT).
> - Yeni tablo: `license_id` kolonu, `ENABLE ROW LEVEL SECURITY` + `<tablo>_tenant` politikası (`license_id = siyahtus_current_license()`) + `GRANT … TO siyahtus_app`. Örnek: `apps/api/prisma/migrations/20260807090000_work_scheduler/migration.sql:97-109`.
> - Migration'lar "genişlet → taşı → daralt" kuralına uyar (CONVENTIONS §6.3): yeni kolon nullable ya da `DEFAULT`'lu eklenir, dolu tabloda index `CREATE INDEX CONCURRENTLY` ile ve kendi migration dosyasında oluşturulur.
> - Ayar yazan uçlar bugünkü kalıbı izler: `config: { scopes: ['access_rules:rw'], minimumRole: 'admin' }`. Rol eşlemesi (Kurucu/Yönetici/Ekip Lideri/Ekip Üyesi) RL-01/RL-02 ile değişecek. Aşağıdaki "kim kullanır" bilgisi varsayılandır.
> - Zamanlanmış işler `api/services/scheduler/intervals.ts` (`SCHEDULER_JOB_NAMES`) + `jobs.ts` kalıbıyla eklenir. Kiracı listesi `retention_list_tenants()` ile alınır, her okuma/yazma `withTenant` içinde yapılır.
> - Testler gereksinim etiketini başlıkta taşır (CONVENTIONS §7). Ayar formlarına `useLeaveGuard` eklenir (WG-14).

---

## 7. Widget ve sohbet ayarları (WG)

### WG-01 — Pre-chat formu: aç/kapat ve yerleşik alanların zorunluluğu
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Gelen kutusu › Sohbet formları (`/app/settings/chat-forms`), yeni "Yerleşik alanlar" kartı. Yazma: Kurucu, Yönetici. Okuma: Ekip Lideri. Etkiyi oyuncu widget'ta görür.
- **Mevcut kod karşılığı:**
  - `wdg/widget.ts:1123-1125` `needsPrechat()` hiçbir ayara bakmıyor. `:1127-1160` `submitPrechat()` dört sabit alanı zorunlu tutuyor (owner kararı yorumu). `:2619-2660` form elemanları (`required = true`). `:215-219` `state.prechat`, `pendingDetails`.
  - Pre-chat cevabı yazımı: `api/routes/customer.ts` `POST /customer/chat/events` (`:707-727`, `name/username/email` → `customers`). Kullanıcı adı kolonu `apps/api/prisma/migrations/20261014090000_customer_username` (commit'lenmemiş).
  - Formun özel alanları mint ile gidiyor: `api/routes/auth.ts:1594` `POST /customer/token` → `pre_chat_form`. Tanımlar `prisma` `CustomFieldDefinition` (`:1036-1065`), `types/custom-fields.ts:43` `FORM_PLACEMENTS`.
  - Panel: `web/features/settings/ChatFormsSettings.tsx`.
- **Eklenecek / değişecek yerler:**
  - Contract/types: `types/widget.ts` içine `PrechatConfig` (`enabled`, `fields: { name|username|email|message: { visible, required } }`) + `DEFAULT_PRECHAT_CONFIG` (bugünkü davranış) + `normalizePrechatConfig`. `contract/paths/settings.yaml` (yeni `GET/PUT /settings/prechat` ya da `/settings/widget` gövdesine ek), `contract/paths/customer-chat.yaml` (token yanıtına `prechat`).
  - Prisma + migration: `WidgetSettings` (`prisma:2151-2176`) üzerine `prechat_enabled BOOLEAN DEFAULT true`, `prechat_fields JSONB DEFAULT <bugünkü>` + CHECK (jsonb şekli). Satır yoksa varsayılan okunur (mevcut desen).
  - API: `routes/settings.ts` (widget ayarlarının yanına okuma/yazma), `routes/auth.ts` mint (ayar okuyucu `widgetAppearance()` kalıbıyla, hata halinde varsayılana düşer), `routes/customer.ts` yeni sohbet açılışında sunucu tarafı zorunluluk kontrolü.
  - Widget: `wdg/widget.ts` `needsPrechat`/`submitPrechat`/form kurulumu yapılandırmaya göre, `wdg/api.ts` token tipi, `wdg/locales/*` (yeni metin gerekirse).
  - Web: `ChatFormsSettings.tsx` "Yerleşik alanlar" kartı (göster/zorunlu anahtarları, form aç/kapat), canlı önizleme, kirli form koruması.
  - Testler: `wdg/widget.prechat.test.ts`, `apps/api/test/integration/customer-chat.test.ts`, `settings.test.ts`, `apps/e2e/tests/widget.spec.ts`.
- **Kodlama mantığı:**
  - Varsayılan = bugünkü owner kararı (form açık, 4 alan görünür + zorunlu). Hiçbir kiracının davranışı migration ile değişmez.
  - Kurallar: `required ⇒ visible`. Form kapalıysa özel `pre_chat` alanları da sorulmaz. Panel bunu "Özel sorularınız da gizlenecek" diye uyarır. Tüm alanlar gizli ve özel alan yoksa form fiilen kapalıdır.
  - "Mesaj" alanı gizliyse ilk composer mesajı açılış mesajı olur. Bugünkü "pre-chat mesajı composer yolundan gönderilir" akışı korunur.
  - Kullanıcı adı alanı kapatılırken panelde ID-03 / AI-02 uyarısı gösterilir. ID-03 imzalı kimlik getirirse (`siyahtus('identify', …)` gibi), bu alan doğrulanmış değerle doldurulur ve gizlenir.
  - Sunucu zorunluluğu: yalnızca **yeni sohbet açan** ilk mesajda kontrol edilir (`existing` yoksa). Zorunlu alan eksikse API 400 döner, hiçbir kayıt yazılmaz (spam filtresiyle aynı "iz bırakmadan reddet" deseni). Sonraki mesajlarda kontrol yapılmaz. Kanal adaptörleri (Telegram vb.) bu rotadan geçmediği için etkilenmez.
  - Marka: mint bugün marka ayırt etmiyor (`api/routes/auth.ts:1811` `widgetSettings.findFirst()`). Yeni ayar okunurken marka, istek `Origin`'inin eşleştiği `websites` satırının `brand_id`'sinden çözülmeli. Bulunamazsa lisans varsayılanı kullanılır. Aynı çözüm WG-02/WG-05/WG-10 için ortaktır.
- **Kabul kriterleri:**
  - Ayar hiç kaydedilmemiş kiracıda widget bugünkü gibi 4 zorunlu alan gösterir (regresyon testi).
  - `prechat_enabled=false` iken widget doğrudan composer açar ve ilk mesaj sohbeti başlatır.
  - `username.required=false` iken form kullanıcı adı boş gönderilebilir. `true` iken hem widget hem API (`400`) reddeder.
  - Panelde değişiklik, widget yeniden kurulmadan bir sonraki token alımında geçerli olur.
  - Kullanıcı adı kapatılırken uyarı metni görünür.
  - Çok markalı kiracıda B markasının sitesindeki widget B'nin ayarını alır.
- **Riskler / notlar:** Commit'lenmemiş `customer_username` işi aynı dosyalara dokunuyor, önce o tamamlanmalı. Sunucu zorunluluğu, form kapalı bir kiracıda eski önbellekli widget'tan gelen eksik alanlı istekleri reddetmemeli. Kontrol her zaman o anki ayara göre yapılır.

### WG-02 — Widget dili panelden seçilebilir ve tarayıcı dili algılanır
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Kanallar › Widget görünümü (`/app/settings/widget`), "Dil" alanı ("Otomatik" + 8 dil) ve "Yedek dil". Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - `wdg/loader.ts:26-27` (`language?`), `:301` (iframe URL'sine `language`). `wdg/i18n.ts:29-32` `resolveWidgetLocale` boşta `en` döner, `navigator.language` okunmaz. `wdg/widget.ts` `mount()` içinde çevirmen mint'ten **önce** bağlanıyor (`createTranslator(config.language)`).
  - `wdg/locales/index.ts` 8 katalog. `types/widget.ts:31-48` `WidgetAppearance`'ta dil yok. `api/services/websites/website-service.ts:184-200` `snippet()` dil yazmıyor.
  - Ziyaretçi dökümü e-postası her zaman `en`: `api/services/chat/chat-service.ts` `#emailTranscript` (yorum: "the visitor's language is not known to the server").
- **Eklenecek / değişecek yerler:**
  - Types/contract: `WidgetAppearance`'a `language: 'auto' | WidgetLocale` ve `fallback_language: WidgetLocale` + normalizer. `contract/paths/settings.yaml` (`/settings/widget`), `customer-chat.yaml` (token yanıtı).
  - Prisma: `WidgetSettings`'e `language TEXT DEFAULT 'auto'`, `fallback_language TEXT DEFAULT 'en'` + CHECK (izinli değerler). Oyuncu dili için `customers.locale` (ya da sohbet özelliği) nullable kolon.
  - API: `routes/settings.ts` widget uçları, `routes/auth.ts` mint, `routes/customer.ts` ilk mesajda widget'ın gönderdiği `locale`'in kaydı, `chat-service.ts` `#emailTranscript` dili bu değerden alır.
  - Widget: `i18n.ts` çözümleme zinciri, `widget.ts` mint sonrası dil farklıysa arayüzü (ve `dir`) bir kez yeniden kurma, `api.ts` ilk mesaja `locale` ekleme.
  - Web: `web/features/settings/WidgetCustomization.tsx` dil seçici + önizleme dili. Seçici `<form>` içinde Enter ile submit etmemeli (LC dersi).
  - Testler: `wdg/i18n.test.ts`, `loader.test.ts`, `widget.rtl.test.ts`, API entegrasyon (mint + döküm dili), `apps/e2e/tests/i18n.spec.ts`.
- **Kodlama mantığı:**
  - Çözümleme sırası: (1) kurulum kodunda açık `language` → (2) panel ayarı `auto` değilse o dil → (3) `auto` ise `navigator.languages` içinde desteklenen ilk dil → (4) `fallback_language`. Yalnızca birincil alt etiket eşlenir (`tr-TR` → `tr`).
  - Zamanlama: panel ayarı mint ile geldiği için widget ilk çizimi (3)/(4) ile yapar. Mint farklı bir dil söylerse metinler ve `dir` bir kez yeniden kurulur. Alternatif olarak dil seçimi mint'e kadar ertelenebilir. Seçimi kodlayan yapar, ama "önce İngilizce görünüp sonra Türkçe'ye dönme" anı en fazla bir kez olmalı.
  - Seçilen dil ilk mesajla sunucuya gider ve oyuncuya ait yazışmalarda (döküm e-postası, ileride AI-30 ipucu) kullanılır.
  - 50 KB widget bütçesi (NFR-P3): yeni dil eklemek tüm katalogları büyütür. Dil sayısı artacaksa katalogların ayrı yüklenmesi düşünülmeli.
- **Kabul kriterleri:**
  - Tarayıcı dili `tr-TR`, snippet'te dil yok, panel `auto` → widget Türkçe açılır.
  - Panel `en` → tarayıcıdan bağımsız İngilizce. Snippet `language:"de"` → Almanca (panel ayarını geçersiz kılar, panelde bu bilgi notu görünür).
  - Desteklenmeyen tarayıcı dili → yedek dil. `ar` → `dir="rtl"`.
  - Türkçe widget'tan başlayan sohbetin döküm e-postası Türkçe gelir.
- **Riskler / notlar:** Snippet'te dil sabitlenmiş eski kurulumlar panel ayarını yok sayar. Panelde "kurulum kodunuzda dil sabit" uyarısı için mint isteğinde gelen `language` parametresi kaydedilip gösterilebilir.

### WG-03 — Ajan yanıt vermezse sohbeti başka ajana aktarma ve "inactive" durumu
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Gelen kutusu › Sohbet zaman aşımı (`/app/settings/chat-timeout`), adı "Hareketsizlik ve aktarma" olur ve üç satıra çıkar. Yazma: Kurucu, Yönetici. Etki: Ekip Üyesinin sohbeti başkasına geçer, Ekip Lideri bildirim alır.
- **Mevcut kod karşılığı:**
  - Yalnızca kapatma: `api/services/chat/chat-timeout.ts` (`ChatTimeoutSweeper`), zamanlayıcı `api/services/scheduler/jobs.ts:138` (`chat_timeout`, varsayılan 60 sn, `config/env.ts:1012`). Ayar `prisma:2127-2142` `InboxSettings.chatTimeoutSeconds`, uçlar `api/routes/settings.ts:2617,2632`, ekran `web/features/settings/ChatTimeout.tsx`.
  - İlk yanıt zamanı: `threads.first_response_at` (`chat-service.ts:508-512`). Benzer aday sorgusu `api/services/sla/sla-sweep.ts:192`.
  - Aktarma: `ChatService.transfer` (`chat-service.ts:1371`), nedenler `types/domain.ts:64-70` (`agent_disconnected` tanımlı ama kullanılmıyor).
  - Atama zamanı tutulmuyor: `threads` modelinde `assigned_at` yok (`prisma:816-843`). Kapasite sayımı `routing-service.ts` `#selectAgent` (`HAVING COUNT(t.id) < concurrent_chats_limit`, aktif tüm oturumları sayıyor).
  - Ajan bağlantısı kopunca durum değişmiyor: `apps/rtm/src` içinde presence/routing_status yazımı yok. `lastSeenAt` yalnızca API isteklerinde güncelleniyor (`api/plugins/auth.ts:459-466`).
- **Eklenecek / değişecek yerler:**
  - Types/contract: `TRANSFER_REASONS`'a `agent_unresponsive` (genişletme). `contract/paths/settings.yaml` chat-timeout gövdesine `unanswered_transfer_seconds`, `inactive_after_seconds`. `contract/paths/chats.yaml` sohbet özetine `inactive` alanı.
  - Prisma + migration: `InboxSettings`'e iki nullable `INT` kolon. `threads`'e `assigned_at TIMESTAMPTZ NULL`, `inactive_since TIMESTAMPTZ NULL`, `unresponsive_transfers SMALLINT DEFAULT 0`.
  - API:
    - Atama yapan her yer (`route()`, `drainQueue()`, `transfer()`, takeover) `assigned_at`'i yazar.
    - Yeni sweep: `chat_timeout` işine ek adım ya da ayrı `chat_inactivity` işi (yeni iş adı + `SCHEDULE_CHAT_INACTIVITY_MS`, 15–30 sn).
    - `#selectAgent` ve `drainQueue` kapasite sayımı `inactive_since IS NULL` koşuluyla yapılır.
    - `#appendEvent` müşteri/ajan mesajında `inactive_since`'ı temizler.
  - RTM: ajanın son soketi kapanınca tolerans süresi sonunda `offline` durumu + `agent_presence_events` satırı + `routing_status_set` push. Sorumluluk RTM'de ya da API'de olabilir, ama tek yerde olmalı.
  - Web: `ChatTimeout.tsx` üç satır ve sıra doğrulaması (`aktarma < inactive < kapatma`). Inbox listesinde "inactive" rozeti. Ajana "3 dk yanıt vermediğiniz için durumunuz değişti" bildirimi.
  - Testler: entegrasyon (sweep, yarış, kapasite), `apps/e2e/tests/inbox-assign.spec.ts` genişletme.
- **Kodlama mantığı:**
  - **Aday:** `active` + `assignee_id IS NOT NULL` + `first_response_at IS NULL` + `assigned_at < now − X`. LC semantiği gereği yalnızca ilk yanıt beklenir ("Applies only if the chat has just started"). AI devrinde `assigned_at` devir anıdır.
  - **Yarış:** aktarma, işlem içinde "atanan kişi hâlâ aynı ve hâlâ yanıt yok" koşuluyla compare-and-set yapılır. Ajan son saniyede yanıt verirse aktarma yapılmaz.
  - **Hedef seçimi:** aynı ekipte, yanıtsız ajan hariç `#selectAgent`. Uzmanlık şartı korunur. Bulunamazsa sohbet ekibin kuyruğunun **başına** alınır, Ekip Liderine bildirim gider.
  - **Yanıtsız ajan:** (karar 2) `not_accepting_chats` yapılır ve presence olayı yazılır. Aynı sohbet en fazla 2 kez bu nedenle aktarılır (ping-pong'u önlemek için), sonra kuyruk + Ekip Lideri.
  - **Inactive:** son olaydan beri `inactive_after` geçmiş aktif oturum. Kapasiteden düşer, Inbox'ta soluk görünür. Yeni mesajla otomatik aktifleşir. Kapatma sweep'i bugünkü gibi çalışır.
  - **Manuel mod (WG-07)** ekiplerinde X süresi "kimse almadı" uyarısına dönüşür (aktarma yok).
  - **Marka notu:** `InboxSettings` marka bazlı, ama sohbetin markası yok (`Chat` modelinde `brand_id` yok) ve mevcut sweep `findFirst()` ile rastgele marka satırını okuyor (`chat-timeout.ts`, `#sweepTenant`). Yeni ayarlar en azından lisans varsayılanı olarak okunmalı. Marka bazlı davranış ID-01/çok marka işinde ele alınmalı.
- **Kabul kriterleri:**
  - Ayar 3 dk iken atanmış ve yanıtlanmamış sohbet 3 dk + en fazla bir sweep aralığı içinde aynı ekipte başka uygun ajana geçer. Olay geçmişinde `agent_unresponsive` nedeni görünür.
  - Ajan yanıt verdiyse aktarma olmaz (yarış testi).
  - Uygun ajan yoksa sohbet kuyruk başına alınır ve Ekip Lideri bildirim alır.
  - Inactive sohbet ajanın limitine sayılmaz, yeni mesajla aktifleşir.
  - Tarayıcıyı kapatan ajan 2 dk tolerans sonunda `offline` olur ve yeni sohbet almaz.
  - `aktarma ≥ inactive` girildiğinde panel kaydetmeyi reddeder ve açık hata gösterir.
- **Riskler / notlar:** Sweep aralığı (60 sn) 3 dk hedefinde ±1 dk sapma yaratır. Ajanın durumunu otomatik değiştirmek ekipte tepki çekebilir, bu yüzden ayar olarak kapatılabilir olmalı. RTM çok kopyalı çalışırsa "son soket" bilgisi Redis üzerinden tutulmalı.

### WG-04 — Form alan tipleri ve konu/departman seçimiyle ekibe yönlendirme
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Gelen kutusu › Sohbet formları ve Özel alanlar (`/app/settings/chat-forms`, `/app/settings/custom-fields`). Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - Tipler: `types/custom-fields.ts:82` `CUSTOM_FIELD_TYPES = ['text','number','boolean','date']`. Doğrulayıcı `checkCustomFieldValue` (`:176`). Model `prisma:1036-1065` (`options` ve `position` yok).
  - Widget çizimi `wdg/widget.ts:2039` `renderFormFields` (`nx-prechat-check`/`nx-prechat-input`).
  - Düzenleme yok: `web/features/settings/ChatFormsSettings.tsx` (ekle/sil).
  - Yönlendirme: `api/services/routing/routing-service.ts:26-33` `RoutingContext.requestedGroupId`, `#selectGroup` `:261-276` (açık ekip isteği kuralları atlar). Widget sohbet başlatma yalnızca URL iletiyor: `api/routes/customer.ts:840`.
- **Eklenecek / değişecek yerler:**
  - Types/contract: tipler `select`, `multiselect`, `topic` (konu → kuyruk). Tanıma `options: {value,label,target_group_id?}[]` ve `position`. `contract/paths/custom-fields.yaml` (PATCH dahil).
  - Prisma: `custom_field_definitions`'a `options JSONB NULL`, `position INT DEFAULT 0` + CHECK (seçenekli tipte `options` dolu, en fazla 50 seçenek, etiket ≤ 80). Tip CHECK'i genişletilir.
  - API: `routes/custom-fields.ts` (oluştur/düzenle/sırala), `checkCustomFieldValue` (seçenek değeri listede mi), `routes/customer.ts` ilk mesajda `topic` alanının cevabını `RoutingContext.requestedGroupId`'ye çevirme.
  - Widget: `renderFormFields` seçim listesi/açılır liste/çoklu seçim çizimi (ARIA, klavye), `topic` alanı.
  - Web: `ChatFormsSettings.tsx` düzenleme ve sıralama (SkillEditor'daki ok tuşlu sıralama kalıbı), seçenek editörü, `topic` seçeneklerinde ekip seçici.
  - Testler: `types/custom-fields.test.ts`, `wdg/widget.prechat.test.ts`, `apps/api/test/integration/routing.test.ts` (konu → ekip).
- **Kodlama mantığı:**
  - `topic` alanı form başına en fazla 1 tane olur ve yalnızca `pre_chat` yerleşiminde bulunur. Cevap kontak alanına yazılır (mevcut desen), ayrıca sohbetin yönlendirme bağlamına girer.
  - Seçeneğin `target_group_id`'si silinmiş bir ekibi gösteriyorsa yönlendirme kurallara düşer (bugünkü "bilinmeyen ekip yok sayılır" davranışı).
  - Oyuncuya gösterilen etiket ile içerideki kuyruk adı ayrıdır (ör. "Hesap kapatma / ara verme" → Sorumlu Oyun kuyruğu).
  - AI açıksa ve konu seçimi de varsa: konu seçimi **ilk** ekip kararını verir, AI devrinde AI-12'nin hedefi önceliklidir. Çakışma kuralı AI-12 ile birlikte yazılır.
  - Seçenekli tipler raporlanabilir hale gelir (LC "Chat forms" raporu, R11). İleride RP-01 filtresi olarak kullanılabilir.
- **Kabul kriterleri:**
  - Panelde açılır liste tipi soru eklenir, düzenlenir, sırası değiştirilir. Widget'ta doğru sırada ve tipte görünür.
  - Listede olmayan değer API'de 400 ile reddedilir.
  - "Para çekme" seçen oyuncunun sohbeti Finans ekibine atanır ya da o ekibin kuyruğuna girer (AU-01).
  - Silinmiş ekibe bağlı seçenek sohbeti düşürmez, kurallarla yönlendirir.
- **Riskler / notlar:** `topic` cevabı oyuncunun beyanıdır. AI-05'in tespitiyle çelişebilir, raporlarda iki kaynak ayrı tutulmalı (RP-01 kararı).

### WG-05 — Widget metinlerini özelleştirme ve kuyrukta tahmini bekleme süresi
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Kanallar › Widget görünümü (`/app/settings/widget`), yeni "Metinler" sekmesi (dil başına). Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - Sabit metinler: `wdg/locales/tr.ts:9` (`status.queue`), `:10` (`status.offline`), `:27` (`input.placeholder`), `:64-72` (offline form). Çevirmen `wdg/i18n.ts` `createTranslator` (aktif dil → en → anahtar).
  - Karşılama özelleştirmesi deseni: `types/widget.ts` `welcome_title/welcome_text` (yalnızca sunucudan gelir, snippet'e girmez).
  - Kuyruk sırası: `GET /customer/chat` yanıtında `queue_position` (`api/routes/customer.ts`). Bekleme süresi verisi kalıcı değil (bkz. RP-04).
- **Eklenecek / değişecek yerler:**
  - Types: `WIDGET_PHRASE_KEYS` (özelleştirilebilir anahtarların kapalı listesi) + her biri için uzunluk sınırı ve izinli yer tutucular (`{n}`, `{minutes}`).
  - Prisma: `widget_phrases` tablosu (`license_id`, `brand_id`, `locale`, `key`, `text`, benzersiz `(license, brand, locale, key)`) + RLS.
  - API: `GET/PUT /settings/widget/phrases?locale=`, mint yanıtına yalnızca o dilin geçersiz kılmaları. `GET /customer/chat` yanıtına `estimated_wait: {min_minutes, max_minutes} | null`.
  - Widget: `createTranslator` önce geçersiz kılma haritasına bakar. Kuyruk metni `{minutes}` alırsa tahmini gösterir.
  - Web: dil seçmeli metin editörü, varsayılan metni gösteren yer tutucu, "varsayılana dön".
  - Testler: `wdg/i18n.test.ts`, `wdg/locales/locales.test.ts`, API birim (tahmin fonksiyonu), entegrasyon.
- **Kodlama mantığı:**
  - Yalnızca listedeki anahtarlar özelleştirilebilir. Bilinmeyen anahtar reddedilir. Metin düz metindir (HTML yok). Yer tutucu doğrulaması yapılır: `{n}` içermeyen kuyruk metni kabul edilir ama `{x}` gibi bilinmeyen yer tutucu reddedilir.
  - Fallback zinciri: kiracı geçersiz kılması (dil) → katalog (dil) → katalog (en) → anahtar.
  - Tahmin: aynı ekip kuyruğunun son 7 gündeki kuyruk→atanma sürelerinin medyanı ve 80. yüzdeliği (RP-04 verisi) × sıra pozisyonu / o an kabul eden ajan kapasitesi. Örnek sayısı < 20 ise `null` dönülür ve yalnızca sıra gösterilir. Değer dakikaya yuvarlanır, aralık olarak verilir.
  - Tahmin hesabı her 4 sn'lik poll'da yapılmamalı. Ekip başına kısa ömürlü önbellekten (Redis, ~60 sn) okunmalı.
- **Kabul kriterleri:**
  - Panelde TR çevrimdışı metni değiştirilince TR widget'ta yeni metin, EN widget'ta varsayılan görünür.
  - Bilinmeyen yer tutucu kaydedilemez.
  - Yeterli veri varken kuyruk metni "yaklaşık X–Y dk" içerir, veri yokken içermez.
- **Riskler / notlar:** Tahmin yanlış çıkarsa oyuncu algısı kötüleşir. Bu yüzden aralık + "yaklaşık" ifadesi ve en az örnek eşiği şart. AU-01 olmadan tahmin şirket geneli tek kuyruğa göre yapılır ve yanıltıcı olur.

### WG-06 — Oyuncuya sohbet dökümü e-postası ve tüm dökümleri bir adrese iletme
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Gelen kutusu, yeni "Sohbet dökümleri" bölümü (oyuncuya otomatik gönderim anahtarı + iletme adresleri). Yalnızca Kurucu ve Yönetici. Oyuncu: widget menüsünde "Dökümü e-postama gönder".
- **Mevcut kod karşılığı:**
  - Kapanışta otomatik gönderim: `api/services/chat/chat-service.ts` `#emailTranscript` (≈`:1130-1270`). Alıcı kararı `api/services/notifications/chat-transcript.ts:55` `transcriptRecipients` (e-postası olan ziyaretçi + atanan ajan). Şablonlar `api/services/mail/templates/messages.ts:495` `customerTranscriptMail`, `:541` `teamTranscriptMail`. Gönderim türü `chat_transcript` (dış günlük sınıra tabi, `services/mail/mail-caps.ts`).
  - Widget'ta döküm isteme yok (`wdg/locales/en.ts`'te anahtar yok).
- **Eklenecek / değişecek yerler:**
  - Types/contract: `TranscriptSettings` (`customer_auto_send: boolean`, `forward_to: string[]` ≤ 5, `forward_include_notes: boolean`). `contract/paths/settings.yaml`, `customer-chat.yaml` (`POST /customer/chat/transcript`).
  - Prisma: `InboxSettings`'e kolonlar ya da ayrı `transcript_settings` tablosu (RLS).
  - API: `transcriptRecipients` genişler (ayar + iletme adresleri, her biri ayrı `deliver`). Yeni müşteri ucu (oran sınırlı, yalnızca kendi son sohbeti). Dil WG-02'den gelir.
  - Widget: başlık menüsüne "Dökümü e-postama gönder", e-posta yoksa giriş alanı.
  - Web: ayar bölümü, adres doğrulama, iç not uyarısı.
  - Testler: `chat-transcript.test.ts` (saf karar fonksiyonları), entegrasyon (iç not hiç sızmaz), `apps/e2e/tests/widget.spec.ts`.
- **Kodlama mantığı:**
  - Varsayılan (karar 1): `customer_auto_send = false`, yani mevcut ve yeni tüm kiracılarda "yalnızca oyuncu isterse". Bu, bugünkü otomatik gönderimi değiştirir. Geçiş sürüm notunda ve pilot kiracıya ayrıca duyurulmalı. Sahip "mevcutlar değişmesin" derse migration mevcut satırlara `true` yazar.
  - Oyuncu isteği: yalnızca kendi en son sohbetinin dökümü gider. Oyuncunun sohbette yazdığı e-postaya gönderim için oran sınırı uygulanır (ör. sohbet başına 3, saatte 5). Böylece rastgele adrese spam önlenir.
  - İletme: sohbet kapanınca her adrese ayrı teslim yapılır. `forward_include_notes=true` yalnızca adres kiracının doğrulanmış alan adındaysa geçerlidir (SSO domain doğrulaması varsa onu kullan, yoksa ayar reddedilir). Bu türden e-posta `chat_transcript` değil iç bildirim sayılır.
  - Kart numarası maskelemesi yazma anında yapıldığı için dökümde zaten maskeli olur. AI-26 genişlemesi de aynı yoldan geçer.
  - Arşiv kopyası için ileride webhook (`chat_deactivated` + döküm) alternatifi var. E-posta tek yol değil.
- **Kabul kriterleri:**
  - `customer_auto_send=false` iken kapanışta oyuncuya e-posta gitmez, ajana kendi tercihine göre gider.
  - Widget'tan istenince döküm oyuncunun dilinde gelir ve iç notları içermez (otomatik test).
  - 5'ten fazla iletme adresi ve doğrulanmamış alan adına iç notlu iletme reddedilir.
  - Oran sınırı aşıldığında 429 döner.
- **Riskler / notlar:** Dökümlerde finansal bilgi bulunur. Yanlış adrese gönderim KVKK olayı olabilir, bu yüzden varsayılan kararı sahibin onayı belirlemeli. Dış e-posta günlük sınırı (`mail-caps.ts`) yoğun kiracıda dolabilir. İletme e-postalarının bu sınıra sayılıp sayılmayacağı netleştirilmeli.

### WG-07 — Manuel atama modu (herkese bildirim, ilk alan alır)
- **Alan (panelde nerede, kim kullanır):** Ekip › Ekipler › (ekip) düzenleme ekranında "Atama modu: Otomatik / Manuel" (`/app/team/teams`). Kurucu, Yönetici. Ekip Üyesi Inbox'taki "Kuyrukta" görünümünden "Al" der.
- **Mevcut kod karşılığı:** Atama her zaman otomatik: `api/services/routing/routing-service.ts` `route()` `:114-171`, `drainQueue()` `:179-241`. Elle alma var: Traffic ve Inbox'ta "Bana ata" / takeover (`web/features/inbox/DetailsPanel.tsx`, `POST /chats/{id}/takeover`). Mod ayarı yok (`assignment_mode` kodda yok). Ekip modeli `prisma:698-711` `Group`.
- **Eklenecek / değişecek yerler:**
  - Prisma: `groups.assignment_mode TEXT DEFAULT 'auto'` + CHECK (`auto|manual`).
  - Contract/types: `contract/paths/agents.yaml#/group` (`PATCH /groups/{groupId}` gövdesine `assignment_mode`), `GroupAssignmentMode`. API tarafı `api/routes/agents.ts:1006-1040` (grup güncelleme).
  - API: `route()` ve `drainQueue()` manuel ekipte ajan seçmez, sohbeti ekip kuyruğuna koyar. Yeni `POST /chats/{id}/claim` (ya da mevcut takeover'ın kuyruk için kullanımı). RTM push `incoming_chat` ekipteki herkese gider.
  - RTM: kuyruğa giren sohbetin ekip üyelerine yayını (`types/rtm.ts` `RTM_PUSH_ACTIONS` mevcut eylemleriyle).
  - Web: ekip editöründe mod seçici, Inbox'ta "Al" düğmesi ve sesli bildirim (IN-10).
  - Testler: entegrasyon (iki ajan aynı anda "Al" → biri kazanır), E2E.
- **Kodlama mantığı:**
  - "Al" işlemi compare-and-set ile yapılır (`assignee_id IS NULL` koşullu güncelleme). Kaybeden ajan "başka bir ajan aldı" mesajı görür.
  - Alırken eşzamanlı limit kontrol edilir. Limit doluysa reddedilir.
  - Kural (karar 1): Sorumlu Oyun rolündeki kuyruk manuel moda alınamaz (API reddeder).
  - Manuel ekipte WG-03 süresi "X dk kimse almadı → Ekip Lideri uyarısı" olarak çalışır.
- **Kabul kriterleri:**
  - Manuel ekibe gelen sohbet kimseye atanmaz, ekipteki tüm çevrimiçi ajanlara bildirim gider.
  - İki ajanın eşzamanlı "Al" isteğinde yalnızca biri atanır.
  - Sorumlu Oyun ekibi manuel yapılamaz.
- **Riskler / notlar:** AU-01'deki ekip bazlı kuyruk yapısı olmadan manuel mod şirket geneli kuyruğu kirletir. Bu yüzden önce AU-01 yapılmalı.

### WG-08 — "E-posta iste": ajan X dakika yanıt vermezse ya da çevrimdışıyken
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Gelen kutusu › Sohbet formları, yeni "E-posta isteme" bölümü (iki sekme: "Yanıt gecikirse", "Çevrimdışıyken"). Kurucu, Yönetici.
- **Mevcut kod karşılığı:** Çevrimdışı formu yalnızca form alanı tanımlıysa açılıyor: `wdg/widget.ts:1011-1019` `offlineFormOpen()`. Çevrimdışı metinler `wdg/locales/tr.ts:64-72`. Yanıt gecikmesi zamanlayıcısı yok. WG-03'teki aday sorgusu aynı veriyi kullanır (`first_response_at`, yeni `assigned_at`).
- **Eklenecek / değişecek yerler:**
  - Types/Prisma: `InboxSettings`'e `ask_email_after_seconds INT NULL`, `ask_email_when_offline BOOLEAN DEFAULT false`, iki metin (WG-05 metin altyapısıyla da tutulabilir).
  - API: WG-03 sweep'i aynı geçişte "X dk yanıt yok ve oyuncunun e-postası/kullanıcı adı yok" sohbetlerine **bir kez** sistem olayı yazar (ör. `type: 'system'`, `properties.kind: 'ask_email'`). E-posta cevabı için müşteri ucu (`PATCH /customer` ya da mevcut pre-chat yazımı).
  - Widget: `ask_email` sistem olayını satır içi e-posta kartı olarak çizer. Gönderince onay metni gösterir.
  - Web: ayar ekranı ve önizleme.
  - Testler: sweep birim/entegrasyon (tek sefer), widget çizim testi.
- **Kodlama mantığı:**
  - Karar 1: oyuncunun kullanıcı adı ya da e-postası biliniyorsa kart gösterilmez, bunun yerine "size buradan dönülecek" sistem mesajı yazılır (bir kez).
  - Aynı sohbette tekrar sorulmaz (olay varlığı kontrolü, idempotent).
  - Çevrimdışı senaryosu WG-09 kararına bağlıdır: AI açıksa çevrimdışı e-posta isteme yalnızca AI'ın insana devretmek istediği anda tetiklenir.
  - Girilen e-posta pre-chat yazımı gibi maskelenir ve `customers.email` güncellenir. `is_lead` geçişi mevcut mantıkla çalışır.
- **Kabul kriterleri:**
  - Ayar 2 dk iken yanıtlanmayan ve iletişim bilgisi olmayan sohbette widget bir kez e-posta kartı gösterir. E-posta kaydedilir ve onay görünür.
  - Kullanıcı adı bilinen oyuncuya kart gösterilmez.
  - Ayar kapalıyken hiçbir şey olmaz.
- **Riskler / notlar:** WG-03 ile aynı sweep'i paylaşmalı. İki ayrı zamanlayıcı aynı sohbete çakışan sistem olayı yazmamalı (sıra: önce e-posta isteme, sonra aktarma).

### WG-09 — Uygunluk ayarı: "her zaman" / "yalnızca ajan varken"
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Kanallar › Widget görünümü, "Uygunluk" alanı (iki seçenek + açıklama). Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - `api/routes/customer.ts:549` `agentsOnline` (yalnızca `accepting_chats` ve askıda olmayan insan sayısı), `:609` `online: agentsOnline > 0`. AI dikkate alınmıyor, ama aynı yanıt aktif AI personasını `responder` olarak döndürüyor (`:560-575`).
  - `wdg/widget.ts:1011-1019` `offlineFormOpen()` (çevrimiçi değilse + form alanı tanımlıysa).
  - Ajan bağlantısı kopunca `routing_status` değişmediği için `agentsOnline` şişebiliyor (WG-03).
- **Eklenecek / değişecek yerler:**
  - Types/Prisma: `WidgetSettings`'e `availability_mode TEXT DEFAULT 'always'` + CHECK (`always|agents_only`).
  - API: `GET /customer/chat` yanıtı `online`'a ek olarak `can_start_chat` ve `answered_by: 'human'|'ai'|'none'` döndürür. Hesap: AI aktif ve kotası varsa `can_start_chat=true`.
  - Widget: `offlineFormOpen()` `can_start_chat`'e göre karar verir. `agents_only` modunda AI yoksa çevrimdışı formu yerleşik alanlarla (ad + e-posta + mesaj) her zaman açar, özel alan şartı kalkar.
  - Web: ayar ve açıklama metinleri (LC'deki "ne olur" listesi gibi).
  - Testler: `wdg/widget.offline.test.ts`, `apps/e2e/tests/offline-form.spec.ts`.
- **Kodlama mantığı:**
  - Karar tablosu:
    - AI aktif → widget her zaman sohbet açar. İnsan yoksa devir anı AI-12'nin mesai dışı davranışına düşer.
    - AI yok + `always` → sohbet açılır ve kuyrukta/atanmamış bekler (LC "Always" gibi). Gerekirse WG-08 e-posta ister.
    - AI yok + `agents_only` → çevrimdışı formu açılır ve ticket oluşur.
  - AI'ın günlük kotası dolmuşsa (`api/services/ai/ai-daily-budget.ts`) AI "yok" sayılır.
  - "Çevrimiçi" sayımı WG-03'teki bağlantı kopma düzeltmesinden sonra güvenilir olur.
- **Kabul kriterleri:**
  - AI aktif, insan yok, çevrimdışı formu tanımlı → oyuncu AI ile sohbet başlatabilir (bugün başlatamıyor).
  - AI yok + `agents_only` + insan yok → form, yerleşik alanlarla, özel alan tanımlı olmasa da açılır.
  - AI yok + `always` → sohbet açılır ve atanmamış görünür.
- **Riskler / notlar:** Bu madde bugünkü örtük davranışı değiştiriyor. Pilot kiracıda geçişten önce mevcut çevrimdışı form kullanımının kontrol edilmesi gerekir.

### WG-10 — Launcher görünürlük modları ve widget logosu
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Kanallar › Widget görünümü, "Balon görünürlüğü" ve "Logoyu göster". Logo Ayarlar › Genel › Markalar'dan gelir. Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - JS API: `wdg/loader.ts:55-57` (`open/close/destroy`), `:255` `config.open`. Komut yüzeyi `siyahtus(command, payload)` `:115-122` (bugün yalnızca `trackSale` işleniyor, `wdg/widget.ts:1996`).
  - Görünürlük modu yok. Logo: `web/features/settings/Brands.tsx:24` `logo_url`, `prisma` `Brand.logoUrl`. Widget logoyu kullanmıyor.
- **Eklenecek / değişecek yerler:**
  - Types: `WidgetAppearance`'a `launcher_visibility: 'always'|'until_opened'|'never'`, `show_logo: boolean`. Token tipine `logo_url` (`WidgetTokenAppearance`).
  - Prisma: `WidgetSettings`'e iki kolon + CHECK.
  - API: mint, logo URL'sini markanın kaydından okur (yalnızca https ya da kendi `/uploads` adresi).
  - Loader/Widget: `until_opened` modunda balon gizlenir. `siyahtus('open')` ya da `config.open()` paneli açar ve balonu gösterir. `never` modunda balon hiç görünmez, panel yalnızca API ile açılır. Logo başlıkta gösterilir (boyut sınırı, alt metin = marka adı).
  - Web: ayar alanları, önizleme. Kurulum rehberine "kendi düğmeni bağla" örneği (WG-13).
  - Testler: `wdg/loader.appearance.test.ts`, `widget.appearance.test.ts`.
- **Kodlama mantığı:**
  - Görünürlük snippet'e değil mint'e bağlıdır (yeniden kurulum gerekmez). Mint'ten önce balon kısa süre görünüp kaybolmamalıdır. Bu yüzden loader varsayılan olarak balonu iframe hazır olana kadar çizmez (bugün de iframe içinde çiziliyor).
  - Okunmamış mesaj rozeti `never` modunda görünmeyeceği için, site kendi düğmesine rozet koyabilsin diye `siyahtus:unread` olayı ana sayfaya iletilebilir (izinli mesaj listesine eklenir, sayı dışında veri taşımaz).
  - Logo yalnızca güvenli kaynaktan yüklenir, CSP ile uyumlu olmalıdır.
- **Kabul kriterleri:**
  - `until_opened` modunda sayfa yüklenince balon görünmez. `siyahtus('open')` çağrısı paneli açar.
  - `never` modunda balon hiç görünmez.
  - Marka logosu tanımlıysa ve `show_logo=true` ise widget başlığında görünür.
- **Riskler / notlar:** `never` modunda site düğmesi kırılırsa oyuncu desteğe ulaşamaz. Panelde bu risk açıkça yazılmalı.

### WG-11 — Puanlamaya yorum ekleme
- **Alan (panelde nerede, kim kullanır):** Oyuncu: widget'taki puan ekranı. Ajan/Ekip Lideri: Inbox ve arşivde sohbet detayı (AR-03). Raporlar › Memnuniyet (Yorumlar listesi). Yorumları görme: Ekip Lideri (kendi ekibi), Yönetici, Kurucu.
- **Mevcut kod karşılığı:**
  - API hazır: `api/routes/customer.ts:95-98` `rateSchema.comment` (≤ 1000, kart maskelemeli yazım), `:1096-1135` `POST /customer/chat/rating` (her çağrı **yeni satır** açar). Model `prisma:1278-1291` `Rating.comment`.
  - Widget yorum alanı yok (`wdg/widget.ts`'te `comment` yok). Rapor: `api/services/reports/review-insights.ts`, `GET /reports/reviews` (yorum listesi yok). Inbox'ta puan gösterimi yok.
- **Eklenecek / değişecek yerler:**
  - Contract: `PATCH /customer/chat/rating/{id}` (yorumu mevcut puana ekleme) ya da tek istekte değer + yorum. `GET /reports/reviews` yanıtına son yorumlar (sayfalı). Sohbet detayına `rating`.
  - API: yorum ekleme, aynı oyuncunun aynı sohbetteki puanını günceller. Raporda yorum listesi (filtrelerle, RP-01).
  - Widget: puan verildikten sonra isteğe bağlı metin alanı ("Eklemek istediğiniz bir şey var mı?"), kötü puanda öne çıkar.
  - Web: `web/features/inbox/DetailsPanel.tsx` puan + yorum. `web/features/reports/ReportsPage.tsx` yorumlar kartı.
  - Testler: `wdg/widget.rating.test.ts`, entegrasyon, `apps/e2e/tests/csat.spec.ts`.
- **Kodlama mantığı:**
  - Yorum ayrı bir istekle gelirse yeni `Rating` satırı **açılmamalı**. Aksi halde puan sayısı iki kat sayılır (bugün sunucu tekrar puanı engellemiyor). Yorum, oyuncunun o sohbetteki son puan satırına yazılır.
  - Yorum metni maskelenir (mevcut). AI-27 hazır olduğunda yorum da risk sinyali taraması için aynı sınıflandırıcıya verilebilir (bağımlılık notu).
  - Yorum görünürlüğü RL-02'ye bağlıdır: Ekip Üyesi kendi sohbetinin yorumunu görebilir.
- **Kabul kriterleri:**
  - Oyuncu kötü puandan sonra yorum yazar, yorum aynı puan satırına kaydedilir ve puan sayısı değişmez.
  - Yorum Inbox detayında ve raporda görünür.
  - Kart numarası içeren yorum maskeli saklanır.
- **Riskler / notlar:** Yoruma oyuncu kişisel veri yazabilir. Veri saklama sweep'i `ratings` tablosunu da kapsamalı (mevcut retention kapsamı kontrol edilmeli).

### WG-12 — Widget içinde bilgi bankası araması
- **Alan (panelde nerede, kim kullanır):** Oyuncu: widget'ta "Yardım" sekmesi. Ayar: Ayarlar › Kanallar › Widget görünümü, "Yardım sekmesini göster" + Senaryolar › Bilgi bankası (makale yayımı). Makale yazma: Yönetici, Ekip Lideri (AI-20 onay akışıyla).
- **Mevcut kod karşılığı:**
  - Herkese açık KB: `api/routes/public-kb.ts:156` (liste), `:186` (tek makale), `:208` (kategoriler). `listQuery` yalnızca `limit/page_id` alıyor (`:41-44`), arama yok. Kiracı `workspaceSlug` ile çözülüyor (SECURITY DEFINER `kb_resolve_public_slug`). Tek 404 politikası var.
  - Panel: `web/features/playbook/KbArticle*`. Widget'ta KB yok.
- **Eklenecek / değişecek yerler:**
  - Contract: `GET /customer/kb/search?q=&locale=` (müşteri belirteciyle, kiracı belirteçten gelir) + `GET /customer/kb/articles/{slug}`. İsteğe bağlı olarak public uçlara `q` parametresi.
  - Prisma/migration: makale başlık+gövdesi üzerinde arama indeksi (`tsvector` + GIN, Türkçe sözlük ya da `simple` + `unaccent`). Dolu tabloda `CREATE INDEX CONCURRENTLY` ayrı migration'da.
  - API: arama servisi (yalnızca `published`), oran sınırı (müşteri kovası).
  - Widget: "Yardım" sekmesi, arama kutusu, sonuç listesi, makale görünümü (güvenli zengin metin, `wdg/rich-text.ts`), her ekranda "Sohbet başlat" düğmesi.
  - Web: widget ayarında aç/kapat.
  - Testler: entegrasyon (taslak makale asla dönmez, başka kiracının makalesi dönmez), widget birim, E2E.
- **Kodlama mantığı:**
  - Yalnızca yayımlanmış makaleler döner. Taslak ve başka kiracının makalesi aynı boş sonuçla karşılanır.
  - Makale gövdesi widget'ta sanitize edilmiş HTML/markdown olarak çizilir. Dış bağlantılar `rel=noopener` ile ve yeni sekmede açılır.
  - Arama sorgusu loglarda maskelenir, ama "sonuç bulunamayan aramalar" AI-22 bilgi boşluğu raporuna sayı olarak beslenebilir (içerik değil, normalize terim).
  - 50 KB bütçesi: yardım sekmesi ayrı, tembel yüklenen bir modül olabilir.
- **Kabul kriterleri:**
  - Yayımlanmış "Papara ile yatırım" makalesi "papara" aramasında çıkar, taslak makale çıkmaz.
  - Başka kiracının makalesi hiçbir sorguda dönmez (negatif test).
  - Yardım sekmesinden tek tıkla sohbet başlatılır.
- **Riskler / notlar:** AI-14 tek bilgi deposuna geçince arama kaynağı değişebilir. Arama servisinin arayüzü kaynağa bağımlı olmamalı.

### WG-13 — Kurulum: sihirbazda kod + kopyala, platform eklentileri
- **Alan (panelde nerede, kim kullanır):** İlk kurulum sihirbazı (`/app/onboarding`) web sitesi adımı ve Ayarlar › Kanallar › Web sitesi widget'ları (`/app/settings/website-widgets`). Kurucu, Yönetici.
- **Mevcut kod karşılığı:** `web/features/onboarding/OnboardingWizard.tsx` (yalnızca alan adı), `web/features/settings/WebsiteWidgets.tsx:298-306` (kod + kopyala), `:352-366` (yöntem etiketi). `api/services/websites/website-service.ts:26-31` `WEBSITE_SETUPS = ['manual','platform']`, `:184-200` `snippet()`. Kurulum doğrulaması `markWebsiteConnected` (ilk el sıkışmada).
- **Eklenecek / değişecek yerler:**
  - Web: sihirbazın web sitesi adımında `addWebsite` yanıtındaki snippet'i `WebsiteWidgets`'taki kopyalama bileşeniyle göster. Canlı "bekleniyor / bağlandı" göstergesi (mevcut bağlantı durumunu yoklama). "Geliştiriciye gönder" bağlantısı.
  - İçerik: GTM ve iGaming platform paneli için yazılı rehberler (WG-15'teki KB'de).
  - (Ertelenen) WordPress eklentisi: ayrı depo/paket. Yalnızca `organizationId` ayarı + snippet basma.
  - Testler: `apps/e2e/tests/onboarding.spec.ts` (kopyala ve bağlandı göstergesi).
- **Kodlama mantığı:** Snippet tek kaynaktan (`website-service.snippet`) üretilir, sihirbaz kendi kopyasını oluşturmaz. Kopyalama geri bildirimi korunur (LC dersi). Bağlandı göstergesi `websites.status` yoklamasıyla çalışır, sihirbaz bitirilmeden de çıkılabilir.
- **Kabul kriterleri:** Sihirbazda snippet görünür ve kopyalanır. Widget sitede ilk kez yüklendiğinde sihirbaz "bağlandı" gösterir. Rehber bağlantıları açılır.
- **Riskler / notlar:** Platform CMS'leri (BetConstruct vb.) özel script alanlarında `async` script'i engelleyebilir. Rehberler gerçek bir pilot kurulumla doğrulanmalı.

### WG-14 — Ayarlar sayfalarında kaydedilmemiş değişiklik uyarısı
- **Alan (panelde nerede, kim kullanır):** Tüm Ayarlar bölümleri (`/app/settings/*`). Ayar yazan herkes.
- **Mevcut kod karşılığı:** `web/lib/dirty-guard.tsx` (`:87` `shouldWarnOnLeave`, `:98` `useLeaveGuard`, `:129` `confirmLeave`). Yalnızca `web/features/playbook/SkillEditor.tsx:279` kullanıyor. `web/features/settings/SettingsNav.tsx:181-229` `NavLink`'ler `confirmLeave` çağırmıyor. Raydaki ve paletteki geçişler korumalı (`components/AppShell.tsx:235,462,533`, `CommandPalette.tsx:307…`).
- **Eklenecek / değişecek yerler:**
  - Web: her ayar formunda `useLeaveGuard(shouldWarnOnLeave(form.dirty, save.isPending))`. `SettingsNav.tsx`'te bölüm bağlantılarının `onClick`'inde `confirmLeave()` (reddedilirse `preventDefault`). Ortak bir `SettingsForm` sarmalayıcısı tekrarı azaltır.
  - Testler: `web/features/settings/SettingsNav.test.tsx` (kirliyken bölüm değiştirme onay ister), en az iki form için birim test, `apps/e2e/tests/settings.spec.ts`.
- **Kodlama mantığı:** "Kirli", başlangıç değeriyle karşılaştırılarak belirlenir (LC'nin yanlış pozitif dersi). Kaydetme sürerken uyarı çıkmaz. Kayıt başarılı olunca başlangıç değeri güncellenir. Anında kaydeden kontroller (ör. `Tags.tsx` takım kapsamı) kirli sayılmaz (GV-06).
- **Kabul kriterleri:** Herhangi bir ayar formunda değişiklik yapıp başka bölüme tıklamak onay penceresi açar. "Kal" seçilince değişiklik korunur. Değişiklik yokken pencere çıkmaz. Tarayıcı sekmesi kapatılırken de uyarı verilir.
- **Riskler / notlar:** Yeni eklenen her ayar formu (WG-01/03/05/06/09…) bu korumayla gelmeli. PR kontrol listesine eklenmesi önerilir.

### WG-15 — `<noscript>` yedek linki ve kurulum rehberi linki
- **Alan (panelde nerede, kim kullanır):** Kurulum kodu (otomatik). Sihirbaz ve Web sitesi widget'ları ekranında "Kurulum rehberi" bağlantısı. Kurucu, Yönetici.
- **Mevcut kod karşılığı:** `api/services/websites/website-service.ts:184-200` `snippet()` (yalnızca iki `<script>`). Barındırılan sohbet sayfası `apps/widget/chat.html` (`organization_id` parametresiyle). Kodda yardım merkezi bağlantısı yok.
- **Eklenecek / değişecek yerler:**
  - API: `snippet()` sonuna `<noscript><a href="{widgetOrigin}/chat.html?organization_id={id}" …>Bizimle sohbet edin</a></noscript>`. Metin kiracının widget diline göre (WG-02).
  - Config: rehber URL'si dağıtım ayarı (env), panelde sabit metin yerine `GET /deployment`'tan.
  - Web: `OnboardingWizard.tsx`, `WebsiteWidgets.tsx` rehber bağlantısı.
  - Testler: `website-service` birim testi (snippet çıktısı ve kaçışlar).
- **Kodlama mantığı:** Snippet'e giren her değer zaten doğrulanmış (UUID, URL). Yeni metin de sabit listeden gelir, kullanıcı girdisi içermez (enjeksiyon olmaz). Mevcut kurulumlar değişmez. Yalnızca yeni kopyalanan kod `<noscript>` içerir.
- **Kabul kriterleri:** Yeni snippet `<noscript>` içerir ve bağlantı barındırılan sohbet sayfasını doğru kiracıyla açar. Rehber bağlantısı iki ekranda da görünür.
- **Riskler / notlar:** Barındırılan sohbet sayfası güvenilir alan adı kontrolünden muaf (kendi origin'imiz). Bu bilinçli bir istisna ve korunmalı.

---

## 8. Engage / kampanyalar (EN)

### EN-01 — Risk bayraklı oyuncuya kampanya/bonus gösterilmemesi
- **Alan (panelde nerede, kim kullanır):** Ayrı bir ekran değil, tüm proaktif gösterim yollarına konan bir kapı. Görünür yüzleri:
  - Müşteriler › Kampanyalar (`/app/customers/campaigns`): kartta "Risk nedeniyle gösterilmedi: N".
  - Müşteriler › oyuncu profili ve Inbox detay paneli: "Promosyon engelli" rozeti (bayrağın kendisi AI-27).
  - Ayarlar › Güvenlik › Veri bölgesi ve uyumluluk (`/app/settings/compliance`): fraud/şikâyet bayraklarının promosyonu engelleyip engellemeyeceği.
  - Roller: politika ayarı Kurucu ve Yönetici. Bayrak kaldırma Sorumlu Oyun Ekip Lideri ve Yönetici (karar 1). Diğerleri yalnızca görür.
- **Mevcut kod karşılığı:**
  - Teslim kapısı: `api/services/campaigns/campaign-delivery.ts:151-200` `deliverPendingCampaign`. Bugün yalnızca `hasOpenChat`, `bannedAt` ve deneme süresi (`trialState`) kontrol ediliyor. Çağrıldığı yer `GET /customer/chat` (`api/routes/customer.ts:579-588`).
  - Tetikleme: `api/services/campaigns/campaign-trigger.ts:153-200` `fireCampaignsAtVisitor` (`campaign_sends` satırı yazar, `(campaign, customer)` tekil). Sahibin kampanyayı açtığı anda canlı ziyaretçilere ateşleme `api/services/campaigns/campaign-service.ts` (`invited`).
  - Modeller `prisma:1335` `Campaign`, `:1378` `CampaignSend` (`delivered_at`, `converted`).
  - Risk bayrağı modeli yok (AI-27 tanımlayacak). Müşteri kaydında yalnızca `bannedAt` var.
- **Eklenecek / değişecek yerler:**
  - Types (`packages/types`): saf fonksiyon `isPromoSuppressed(activeFlags, policy)` ve `LOCKED_PROMO_FLAGS = ['responsible_gambling','underage_suspected','self_exclusion']`. Bayrak sözlüğü AI-27 ile ortak tek listeden gelir. API, AI ve ileride kanal adaptörleri aynı fonksiyonu kullanır.
  - Prisma + migration:
    - AI-27 bayrakları sohbet düzeyinde saklıyorsa, **oyuncu düzeyinde** okunabilir bir görünüm/tablo gerekir: `customer_risk_flags` (`license_id`, `customer_id`, `kind`, `source` (ai|agent|import), `raised_at`, `raised_by`, `cleared_at`, `cleared_by`, `clear_reason`) + `(license_id, customer_id) WHERE cleared_at IS NULL` kısmi index + RLS. Kesin şema AI-27 sahibiyle birlikte belirlenir.
    - `campaign_sends`'e `suppressed_at TIMESTAMPTZ NULL`, `suppressed_reason TEXT NULL`.
    - Lisans politikası (`promo_block_fraud BOOLEAN DEFAULT true`, `promo_block_complaint BOOLEAN DEFAULT false`) uyum ayarlarına.
  - API:
    - `deliverPendingCampaign` son kapı olur: teslim edilebilir bir gönderim bulunduktan sonra bayrak okunur. Bastırılıyorsa gönderim `suppressed_at` ile işaretlenir ve `null` döner.
    - `fireCampaignsAtVisitor` ve `campaign-service` aktivasyonu bayraklı oyuncuyu hedeflemez (gönderimi bastırılmış olarak yazar ya da hiç yazmaz).
    - AI-27 bir bayrak koyduğunda o oyuncunun bekleyen gönderimleri aynı işlemde bastırılır.
    - Bayrak kaldırma ucu (`POST /customers/{id}/risk-flags/{flagId}/clear`) gerekçe zorunlu, rol kontrollü, `writeAuditEntry` ile denetim kaydı.
  - Web: `web/features/campaigns/CampaignsPage.tsx` metriği, `web/features/customers/CustomerDetailPanel.tsx` rozet + kaldırma diyaloğu, uyum ayarı ekranı.
  - Testler: types birim (kilitli türler kapatılamaz), entegrasyon (bayrak öncesi oluşmuş gönderim de teslim edilmez; çapraz kiracı; bayrak okuma hatasında teslim yok), `apps/e2e/tests/campaigns.spec.ts`.
- **Kodlama mantığı:**
  - **Fail-closed:** diğer "best-effort" yolların tersine, bayrak okunamazsa kampanya **gösterilmez**. Bu bir uyum kapısıdır.
  - **Maliyet:** her açık widget 4 sn'de bir poll yapar. Bayrak sorgusu yalnızca "teslim edilebilir gönderim var" dalında çalışır (deneme kontrolü gibi), böylece yaygın yol (gönderim yok) sıfır ek maliyetle kalır.
  - **Kalıcılık:** bastırılmış gönderim bayrak kalksa bile sonradan gösterilmez (tekil `(campaign, customer)` + `suppressed_at`). Bu muhafazakâr davranış bilinçli bir tercihtir.
  - **Kapsam:** bayrak `customer_id`'ye bağlıdır. ID-03 aynı oyuncunun kayıtlarını birleştirdiğinde bayrakların **birleşimi** geçerli olur (birinde bayrak varsa hepsinde var). Kapsam şirket geneli, tüm markalar (karar 3).
  - **Kilitli türler** politika ucunda reddedilir (400). Bu türleri yalnızca platform sürümü değiştirebilir.
  - Aynı kural sohbet içinde AI-08 (bonus önermeme), zengin kart (EN-02) ve WhatsApp şablon mesajları (KN-01) için de `isPromoSuppressed` ile uygulanır. Tek fonksiyon, birden çok çağıran.
- **Kabul kriterleri:**
  - `self_exclusion` bayraklı oyuncu, eşleşen ve çalışan kampanyayı hiçbir poll'da almaz. Gönderim satırı `suppressed_at` ile işaretlenir.
  - Bayrak konmadan önce yazılmış bekleyen gönderim de teslim edilmez.
  - Kiracı `responsible_gambling` için engeli kapatmaya çalışırsa API 400 döner.
  - Bayrak kaldırma gerekçesiz reddedilir. Yetkisiz rol 403 alır. Başarılı kaldırma denetim günlüğünde görünür.
  - Bayrak tablosu okunamazsa (simüle hata) kampanya teslim edilmez.
  - Kampanya kartında bastırılan sayısı doğru görünür.
- **Riskler / notlar:** Kimliği tanınmayan ziyaretçi (yeni cihaz, giriş yapmamış) bayrağı taşımaz. Koruma ID-03'teki kimlik kalitesi kadar güçlüdür. İmzalı kimlik bu yüzden önemli. AI-27 şeması gecikirse EN-01 en azından ajanın elle koyduğu bayrakla (aynı tablo) devreye alınabilir.

### EN-02 — Zengin kampanya kartı ve aynı kartın bot mesajlarında kullanılması
- **Alan (panelde nerede, kim kullanır):** Müşteriler › Kampanyalar › Oluştur/Düzenle (`CampaignBuilder`), "Kart tipi: Metin / Kart". Senaryolar'da (`/app/playbook`) prosedür adımlarında "hızlı yanıt butonları" (AI-03 kapsamı). Kampanya yazma: Yönetici, Ekip Lideri (bugün `customers:rw`).
- **Mevcut kod karşılığı:**
  - `types/domain.ts:457-460` `CampaignContent { message? }`. `web/features/campaigns/CampaignBuilder.tsx` (tek mesaj alanı, 2000 kr).
  - `wdg/widget.ts:213` `state.campaign: {id, message}`, teslim `campaign-delivery.ts` aynı şekli döndürüyor.
  - `rich_message` yalnızca web Inbox tiplerinde geçiyor (`web/features/inbox/types.ts`), widget çizmiyor.
  - Olay `properties` alanı JSONB (`prisma` `Event.properties`), zengin içerik buraya sığar. Dosya yükleme altyapısı `/uploads` mevcut.
- **Eklenecek / değişecek yerler:**
  - Types: `RichCard { title? (≤80), body (≤220), image? {url, alt}, buttons: CardButton[] (≤5) }`. `CardButton { label (≤20, sayaçlı), style: 'default'|'primary', action: send_message | open_url{url} | copy_coupon{code} }`. Ortak doğrulayıcı: yalnızca `https:`, `javascript:` yok, kupon ≤ 40. `CampaignContent`'e `type: 'text'|'card'` + `card?` (eski `message` korunur).
  - Contract: `contract/paths/campaigns.yaml`, `customer-chat.yaml` (poll yanıtında `campaign.card`, buton tıklama ucu), `chats.yaml` (`rich_message` olay şeması).
  - API: kampanya doğrulama, teslim yanıtı. `POST /customer/chat/events` gövdesine `postback` (buton `send_message` → oyuncu mesajı + `properties.postback`). Tıklama sayımı (`campaign_sends.clicked_at`).
  - Widget: proaktif kart yuvasında ve transkriptte kart çizimi. `copy_coupon` için Clipboard API. Loader iframe'ine `allow="clipboard-write"` gerekebilir (`wdg/loader.ts` iframe oluşturma).
  - Web: CampaignBuilder kart editörü + masaüstü/mobil önizleme (`WidgetCustomization` önizleme bileşeni). Inbox `Transcript` `rich_message`'ı salt okunur ve "oyuncu şu butona bastı" işaretiyle çizer.
  - Testler: types doğrulayıcı birim, `wdg/widget.campaign.test.ts`, `apps/e2e/tests/campaigns.spec.ts`.
- **Kodlama mantığı:**
  - `send_message` butonu normal bir oyuncu mesajı üretir. AI/yönlendirme onu yazılmış mesajla aynı şekilde işler (ayrı yol yok).
  - Kartın her zaman düz metin karşılığı (`fallback_text`) olur. Zengin içerik desteklemeyen kanallarda (Telegram/WhatsApp, e-posta dökümü) bu metin gider. Butonlar numaralı seçenek olarak yazılır.
  - AI'ın gönderdiği kartlarda (karar 1): yalnızca `send_message` ve kiracının güvenilir alan adlarına (`TrustedDomains`) `open_url`. `copy_coupon` AI'da yasak. Doğrulama hem prosedür kaydında hem gönderimde yapılır (AI-08 çıktı denetimi).
  - Buton eylemi değiştirildiğinde eski alan değeri taşınmaz, sıfırlanır (LC dersi). Buton metni sessizce kırpılmaz, sayaç ve hata gösterilir.
  - Görsel yalnızca `/uploads` ya da https'ten gelir. Alt metin zorunludur (a11y).
  - Kart gösterimi EN-01 kapısından geçer.
- **Kabul kriterleri:**
  - Başlık + görsel + 3 butonlu kampanya kaydedilir ve widget'ta doğru çizilir.
  - "Mesaj gönder" butonu sohbeti başlatır ve butonun metni oyuncu mesajı olarak görünür.
  - "Kupon kopyala" panoya yazar ve onay gösterir.
  - `javascript:` URL'si API'de reddedilir.
  - Eski (yalnızca `message`) kampanyalar değişmeden çalışır.
  - Inbox'ta kart ve basılan buton görünür.
- **Riskler / notlar:** Widget'ın 50 KB bütçesi. Kart çizimi tembel yüklenebilir. Clipboard izni bazı tarayıcılarda iframe'de kısıtlıdır, bu durumda kod seçilebilir metin olarak gösterilir.

### EN-03 — Çok koşullu hedefleme
- **Alan (panelde nerede, kim kullanır):** CampaignBuilder Adım 2 "Koşullar" (koşul satırları + "Tümü / Herhangi biri"). Yönetici, Ekip Lideri.
- **Mevcut kod karşılığı:**
  - `types/domain.ts:451-454` `CampaignConditions { url_contains? }`. `api/services/campaigns/campaign-matching.ts:63-86` (`hasTrigger`, `matchesConditions`, yalnızca VE). `campaign-trigger.ts:114-132` `selectTriggeredCampaigns`.
  - Sayfa bilgisi: loader iframe'e `host_url` ve `host_referrer`'ı yalnızca yüklemede bir kez veriyor (`wdg/loader.ts:296-300`, `:329-335`). Tek sayfalık uygulama gezinmesi izlenmiyor. Sunucuya sayfa görüntülemesi yalnızca mesajla gidiyor (`api/routes/customer.ts:765-790`).
  - Geri gelen ziyaretçi bilgisi widget'ta (`wdg/widget.ts:3285` `returningVisitor`). Ülke: `customers.country_code` var ama IP'den dolduran kod yok. Site komut yüzeyi `wdg/loader.ts:115` `siyahtus(command, payload)` (yalnızca `trackSale`).
- **Eklenecek / değişecek yerler:**
  - Types/contract: `CampaignConditions` v2 = `{ match: 'all'|'any', rules: Rule[] }`. `Rule.field ∈ current_url | session_url | referrer | country | visitor_type | time_on_page | exit_intent | custom_var`, `op ∈ contains | not_contains | equals | not_equals | gt | gte | lt | lte`. Eski `{url_contains}` okuyucuda `current_url contains`'e çevrilir (EN-04). `contract/paths/campaigns.yaml`.
  - Prisma: `campaigns.conditions` zaten JSON, şema değişmez, veri dönüştürme migration'ı (eski şekil → v2). `visits`'e `variables JSONB` (özel değişkenler). Ülke için mint'te IP→ülke çözümü ve `customers.country_code` yazımı.
  - API: `matchesConditions` kural motoruna dönüşür. Sunucu kuralları (url, referrer, country, visitor_type, custom_var) burada değerlendirilir. İstemci kuralları (exit_intent, time_on_page) gönderimle birlikte widget'a "bekleyen koşul" olarak gider. Yeni uç: `POST /customer/visit` (sayfa değişimi + değişkenler, oran sınırlı).
  - Loader/Widget: `history.pushState/popstate` dinleme → iframe'e sayfa değişimi mesajı (debounce). `siyahtus('setSessionVariables', {...})` komutu. Çıkış niyeti (`mouseout` üst kenar, mobilde hızlı yukarı kaydırma). Sayfada kalma zamanlayıcısı.
  - Web: koşul satırı oluşturucu (alan → operatör → değer), VE/VEYA.
  - Testler: kural motoru birim testleri (her operatör), eski koşul dönüşümü, loader SPA testi, `widget.campaign.test.ts`.
- **Kodlama mantığı:**
  - **İki aşamalı değerlendirme:** sunucu "uygun" der ve gönderimi yazar. Widget istemci koşulu gerçekleşene kadar kartı tutar.
  - **Teslim damgası:** bugün `delivered_at` poll'da vuruluyor (en fazla bir kez semantiği). İstemci koşullu gönderimlerde damga "gösterildi" bildirimine taşınmalı. Aksi halde çıkış niyeti hiç oluşmayan gönderim "gösterildi" sayılır. Koşulsuz gönderimlerde bugünkü davranış korunur.
  - **Doğrulanmamış veri:** özel değişkenler en fazla 20 anahtar, 100 karakter olabilir, kart numarası maskelenir ve yalnızca hedeflemede kullanılır (karar 2).
  - **Performans:** eşleme sayfa görüntüleme işleminin içinde, bellekte çalışır (bugün ölçülen ≈0,07 ms). Kural sayısı kampanya başına en fazla 10 ile sınırlanır. Sayfa değişimi bildirimleri müşteri oran sınırı kovasına (60/dk) sığacak şekilde debounce edilir.
  - **Ülke:** yerel veritabanıyla mint'te bir kez çözülür. IP saklanmaz, yalnızca ülke kodu yazılır.
- **Kabul kriterleri:**
  - "Ülke = TR VE sayfa /deposit içerir VE sayfada 30 sn" kampanyası yalnızca bu üçü sağlanınca görünür. "Herhangi biri" seçilince biri yeterli olur.
  - Çıkış niyeti kampanyası fare sayfa üst kenarından çıkınca görünür ve o zaman "gösterildi" sayılır.
  - Tek sayfalık sitede sayfa değişimi koşulu doğru tetikler.
  - Eski kampanyalar dönüşümden sonra aynı ziyaretçilere gösterilir (regresyon).
- **Riskler / notlar:** Sayfa değişimi bildirimi trafiği ciddi artırır. Bildirim yalnızca çalışan kampanyası olan kiracılarda açılabilir (mint'te bayrak). GeoIP veritabanı lisansı ve güncelleme süreci operasyonel bir iş yükü getirir.

### EN-04 — "Geçerli sayfa URL'si" koşulunun hatalı çalışmasının düzeltilmesi
- **Alan (panelde nerede, kim kullanır):** CampaignBuilder'daki "Tetikleyici — sayfa URL'si şunu içerir" alanı (`web/locales/tr/customers.ts:277`). Yönetici, Ekip Lideri.
- **Mevcut kod karşılığı:** `api/services/campaigns/campaign-matching.ts:80` `pageUrls.some(url => url.includes(needle))`, oturumdaki tüm sayfalar. `:23` `visitorPageUrls`. Tip yorumu "targets the page they are on" diyor (`types/domain.ts:445-449`). Yani kod, belgelenen niyetle çelişiyor. Sayfa görüntüleme kaydı yalnızca mesajda (`api/routes/customer.ts:765-768`).
- **Eklenecek / değişecek yerler:**
  - API: `matchesConditions` imzası `{ currentUrl, sessionUrls }` alır. `url_contains` yalnızca `currentUrl`'e bakar. "Oturumdaki herhangi bir sayfa" ayrı bir kural olarak EN-03'te gelir.
  - API: sohbet açmamış ziyaretçinin bulunduğu sayfa bilinmediği için en az mint/poll anında `host_url` bir sayfa görüntülemesi olarak kaydedilir (tam SPA takibi EN-03'te).
  - Testler: `campaign-matching.test.ts` (geçmiş sayfa eşleşmez, son sayfa eşleşir), `campaign-trigger.test.ts`.
- **Kodlama mantığı:** "Geçerli sayfa" = ziyaretin `pages` dizisindeki en son kayıt. Eski kampanyaların davranışı değişir (artık geçmiş sayfada tetiklenmez). Bu bir hata düzeltmesidir ve sürüm notuna yazılmalı. Bir kampanya `(campaign, customer)` başına bir kez ateşlendiği için yanlış ateşlenmiş eski gönderimler geri alınmaz.
- **Kabul kriterleri:** Oyuncu `/withdraw` → `/casino` geçişinden sonra `/casino`'da iken "URL `withdraw` içerir" kampanyası yeni tetiklenmez. `/withdraw`'da iken tetiklenir. Sohbet açmamış ziyaretçi için mint anındaki sayfa eşleşmeye katılır.
- **Riskler / notlar:** Mint anında sayfa görüntülemesi yazmak `visits` tablosunu büyütür. Bugünkü "ziyaret başına tek satır, sayfalar JSON'da" deseni korunmalı (`customer-service.ts:248-295` `recordPageView`).

### EN-05 — Kampanya silme, kampanya raporu, şablon galerisi
- **Alan (panelde nerede, kim kullanır):** Müşteriler › Kampanyalar (satır menüsü: Kopyala, Sil). Raporlar › İş › "Kampanyalar". "Şablondan oluştur" galerisi. Silme: Yönetici. Rapor: Yönetici, Kurucu, Ekip Lideri (RL-02).
- **Mevcut kod karşılığı:** `api/routes/campaigns.ts:90` (GET), `:101` (POST), `:122` (PATCH). DELETE yok. Kart sayıları `campaign-matching.ts:201` `campaignPerformance`. Rapor yok (`api/routes/reports.ts`'te yalnızca goals/sales). Şablon dosyası yok (`web/features/campaigns/`). Benzer şablon deseni `web/features/playbook/templates.ts`.
- **Eklenecek / değişecek yerler:**
  - Prisma: `campaigns.archived_at TIMESTAMPTZ NULL` (yumuşak silme), listeleme varsayılanı `archived_at IS NULL`.
  - Contract/API: `DELETE /campaigns/{id}` (arşivler), `POST /campaigns/{id}/duplicate` (ya da istemci tarafında GET→POST). `GET /reports/campaigns?from&to&campaign_id[]` (gösterim, tıklama, sohbet, dönüşüm, bastırılan) + CSV/PDF grubu (`report-csv.ts`).
  - Web: satır menüsü, onaylı silme, `features/campaigns/templates.ts` (TR iGaming şablonları, kategori: Karşıla/Yardım et/Promosyon), rapor sekmesi.
  - Testler: entegrasyon (arşivlenen kampanya yeni ateşlenmez, eski gönderimler raporda kalır), E2E.
- **Kodlama mantığı:**
  - Arşivlenen kampanya `inactive` olur ve yeniden etkinleştirilemez, yalnızca kopyalanabilir. Bekleyen (teslim edilmemiş) gönderimleri teslim edilmez (mevcut `pickDeliverableSend` `inactive`'i zaten eler).
  - Rapor `campaign_sends` üzerinden günlük gruplanır. "Bastırılan" sütunu EN-01'den gelir. Dönüşüm hedef sistemiyle (`converted`) aynı tanımı kullanır.
  - Promosyon şablonları `kind: 'promotion'` etiketini taşır. Bu etiket ileride EN-01 politikasında "promosyon olmayan bilgilendirme kampanyaları bayraklı oyuncuya gösterilebilir mi?" kararına zemin hazırlar. Varsayılan: tüm kampanyalar bastırılır.
- **Kabul kriterleri:** Silinen kampanya listeden kalkar ve bir daha ateşlenmez, ama rapordaki geçmiş verisi durur. Kopyalama aynı ayarlarla yeni pasif kampanya oluşturur. Rapor tarih aralığında doğru toplamları verir ve CSV'si aynı sayıları içerir (ADR-09). Şablondan oluşturulan kampanya düzenlenebilir taslak olarak açılır.
- **Riskler / notlar:** Gerçek silme yerine arşiv seçildiği için KVKK silme taleplerinde `campaign_sends` müşteri silme (erase) akışına dahil edilmeli (mevcut GDPR silme kapsamı kontrol edilmeli).

### EN-06 — Hedeflerde (Goals) özel sayfa olayı
- **Alan (panelde nerede, kim kullanır):** Müşteriler › Hedefler (`/app/customers/goals`) › Hedef oluştur › "Gelişmiş: özel olay". Yönetici. Sitenin geliştiricisi `siyahtus('trackEvent', …)` çağırır.
- **Mevcut kod karşılığı:** `types/domain.ts:518-527` `GoalDefinition` (`url_contains`, `sale_completed`, `lead_captured`, `chat_resolved`). `api/services/goals/goal-matching.ts:66-120`, `goal-triggers.ts:70`. Satış için komut yolu: `wdg/loader.ts:115` → `wdg/widget.ts:1996` (`trackSale`) → `POST /customer/chat/sale` (`api/routes/customer.ts:1154`).
- **Eklenecek / değişecek yerler:**
  - Types/contract: `GoalDefinition.custom_event?: { name: string; value_equals?: string }`. `contract/paths/goals.yaml`, `customer-chat.yaml` (`POST /customer/events`).
  - Prisma: `visitor_events` tablosu (`license_id`, `customer_id`, `name`, `value`, `occurred_at`) + RLS + `(license_id, customer_id, name)` index. Ya da ziyaret JSON'una ekleme (kodlayan seçer, sorgu ihtiyacına göre).
  - API: olay kaydı (ad `^[a-z0-9_]{1,40}$`, değer ≤ 100, oran sınırı), ardından `goals.record` ile değerlendirme (mevcut akış).
  - Widget: `trackEvent` komutu, `trackSale` ile aynı güvenli daraltma deseni (`wdg/widget.ts:3175`).
  - Web: `web/features/goals/GoalBuilder.tsx` gelişmiş bölüm.
  - Testler: goal-matching birim, entegrasyon, `apps/e2e/tests/goals.spec.ts`.
- **Kodlama mantığı:**
  - Olay tarayıcıdan gelir ve doğrulanmamıştır. Hedef raporunda kullanılır, faturalama/yetki kararlarında kullanılmaz.
  - Karar 1 gereği tutar alanı kabul edilmez (şemada yok). Kayıt ve ilk yatırım gibi olaylar yalnızca ad olarak tutulur.
  - Mevcut hedef mantığı "ziyaretin tamamı üzerinden" değerlendirir. Özel olay da ziyarete bağlanır. Atıf penceresi satış izleyicideki ayarla tutarlı olur.
- **Kabul kriterleri:** `siyahtus('trackEvent', {name:'registration_completed'})` çağrısından sonra bu olayı hedefleyen hedefin dönüşüm sayısı artar. Hatalı ad sessizce yok sayılır ve sayfayı kırmaz. Tutar alanı gönderilse bile saklanmaz.
- **Riskler / notlar:** Sitenin aynı olayı defalarca göndermesi dönüşümü şişirmemeli. Hedef başına ziyaretçi bazında tekil sayım yapılmalı (mevcut tekillik kuralı).

---

## 9. Raporlar (RP)

### RP-01 — Ajan, ekip, etiket ve konu filtreleri; ajan/ekip raporlarına derin link
- **Alan (panelde nerede, kim kullanır):** Raporlar (`/app/reports`) üst filtre çubuğu. Ekip › üye profili ve Ekip › Ekipler (`/app/team/teams`) "Raporları gör" bağlantıları. Kurucu ve Yönetici: tümü. Ekip Lideri: kendi ekibi (zorunlu filtre). Ekip Üyesi: varsayılan yok (RL-02).
- **Mevcut kod karşılığı:**
  - `api/routes/reports.ts:200-211` `rangeQuery` (`from/to/baseline`). Uçlar `:1592` overview, `:1603` breakdown, `:1707` team-performance (ilk 20 ajan [T12]), `:1804` export, `:1892` share-links.
  - Sorgular tek yerde: `api/services/reports/report-csv.ts` (JSON, CSV ve zamanlanmış raporlar aynı yardımcıları kullanıyor, ADR-09).
  - `reports_read` yalnızca yönetici setinde (`types/role-scopes.ts`, `ADMIN_SCOPES`).
  - Web: `web/features/reports/ReportsPage.tsx`, `report-views.ts` (localStorage, yalnızca sekme+tarih).
- **Eklenecek / değişecek yerler:**
  - Contract/types: ortak `ReportFilter { agent_id[], group_id[], tag[], topic[], channel? }` parametreleri `contract/paths/reports.yaml`'daki tüm rapor uçlarına. Yalnızca UUID/ID (e-posta değil, GV-05).
  - API: `rangeQuery` → `reportQuery`. `report-csv.ts`'te tek bir `filterClause(filter)` yardımcısı (thread düzeyi: `assignee_id`, `chat_access.group_id`, `thread_tags`, AI konusu). Export, paylaşım linki ve zamanlanmış rapor tabloları filtreyi saklar (`filters JSONB`).
  - Yetki: RL-02 ile ekip kapsamlı bir rapor yetkisi (ör. `reports_read--groups`). Sunucu, istenen ekip filtresini kişinin ekipleriyle **kesiştirir**.
  - Migration: `threads(license_id, assignee_id, created_at)` bileşik index (`CREATE INDEX CONCURRENTLY`, ayrı dosya).
  - Web: çoklu seçimli filtre çubuğu, filtrelerin URL'de tutulması, kayıtlı görünümlerin filtreyi de saklaması. Ekip sayfalarında derin linkler.
  - Testler: her filtre için entegrasyon, Ekip Liderinin parametreyle başka ekibi isteyememesi (kesişim boş → boş sonuç), JSON ile CSV'nin aynı sayıyı vermesi.
- **Kodlama mantığı:**
  - Tanımlar: "ajan" = oturumun son atananı (`threads.assignee_id`). "Ekip" = sohbetin erişim grupları. Etiket = herhangi biri (any-of). "AI konusu" = AI-05'in oturuma yazdığı prosedür kimliği (karar 2: etiketle birleştirilmez).
  - Ekip Lideri kapsamı istemciye güvenmez. Sunucu her istekte rolden ve üyelikten hesaplar.
  - Rapor sorguları okuma kopyasından (`readDb`) çalışır. Yeni filtreler index'li kolonlara dayanmalı.
  - Paylaşım linki filtreyi dondurur. Linki açan kişi filtreyi genişletemez.
- **Kabul kriterleri:**
  - `/app/reports?group_id=5&agent_id=<uuid>` derin linki filtreli açılır ve sayılar o kapsamla tutarlıdır.
  - Ekip Lideri başka ekibin `group_id`'sini verse bile kendi kapsamı dışını göremez.
  - Aynı filtreyle CSV dışa aktarma ekrandaki sayılarla birebir aynıdır.
  - URL'de e-posta yer almaz.
- **Riskler / notlar:** `report-csv.ts` büyük ve çok kullanılan bir dosya. Filtre her sorguya tek tek eklenirse bir sorgu atlanır ve iki sayı birbirini tutmaz. Ortak yardımcı + "tüm uçlar filtreyi uyguluyor" testi şart.

### RP-02 — Kaçan sohbetler ve etkileşim (kim başlattı) raporları
- **Alan (panelde nerede, kim kullanır):** Raporlar › Sohbetler › "Kaçan sohbetler" (grafik + saat×gün ısı haritası + ekip kırılımı) ve "Etkileşim". RP-01 kapsam kuralları geçerli.
- **Mevcut kod karşılığı:**
  - `threads.first_response_at` yalnızca ajan + herkese açık mesajla dolar (`api/services/chat/chat-service.ts:508-512`). AI/bot mesajları saymaz.
  - Kapanışta "ilk yanıt hiç verilmedi" SLA değerlendirmesi `chat-service.ts` `#closeConversation` (≈`:956-990`). Model `prisma:816-843`.
  - AI devri `reason: 'ai_handoff'` ile transfer olayı (`api/services/ai/ai-responder.ts:189-192`). Kampanya kaynaklı sohbet `campaign-engagement.ts:66` `markCampaignEngaged`.
  - "Missed" ve "initiated_by" kavramları yok.
- **Eklenecek / değişecek yerler:**
  - Prisma: `threads`'e `initiated_by TEXT NULL` (customer | agent | campaign | ai | channel) + CHECK, `needs_human_since TIMESTAMPTZ NULL` (kuyruğa giriş, atama ya da AI devri anı), `missed_reason TEXT NULL` (queue_abandoned | unanswered_assigned | unanswered_after_ai). Kapanışta hesaplanıp yazılır.
  - API: oturum oluştururken `initiated_by` (müşteri mesajı, ajanın proaktif başlatması, kampanya etkileşimi, kanal). `#closeConversation` içinde `missed_reason`. Rapor yardımcıları `report-csv.ts` (sayım, saat×gün ısı haritası, ekip/ajan kırılımı) + `GET /reports/missed`, `GET /reports/engagement` + export grupları.
  - Web: iki yeni rapor sekmesi, ısı haritası bileşeni (staffing ısı haritasıyla ortak).
  - Testler: kapanış senaryoları (AI-only → kaçan değil, AI devri sonrası yanıtsız → `unanswered_after_ai`, kuyrukta terk → `queue_abandoned`), rapor toplamları.
- **Kodlama mantığı:**
  - Kaçan = kapanışta `needs_human_since IS NOT NULL AND first_response_at IS NULL` (karar 1). Neden: hiç atanmadan kapandıysa `queue_abandoned`, atanmış ama yanıtsızsa `unanswered_assigned`, son devir AI'dansa `unanswered_after_ai`.
  - Değer kapanışta bir kez yazılır, raporlar hesaplamaz, okur (hızlı ve tutarlı). Yeniden açılan sohbet yeni oturum açtığı için çakışma olmaz.
  - Geçmiş veri: `first_response_at IS NULL` + atanmış/`ai_handoff` olaylı kapalı oturumlar için kısmi geri doldurma migration'ı yazılabilir. Kesin olmadığı rapor notunda belirtilmeli.
  - AI-25'in "devir kalitesi / devir sonrası bekleme" metrikleri aynı alanları kullanır.
- **Kabul kriterleri:**
  - AI ile başlayıp AI ile kapanan sohbet kaçan sayılmaz.
  - AI'ın devrettiği ve insanın yanıtlamadığı sohbet "devir sonrası kaçan" olarak sayılır.
  - Isı haritası şirket saat diliminde gösterilir.
  - Etkileşim raporunda kampanyadan başlayan sohbetler ayrı satırda görünür.
- **Riskler / notlar:** `initiated_by` doğruluğu kanal adaptörlerinin de alanı doldurmasına bağlı. Doldurmayan yol `NULL` bırakır ve raporda "bilinmiyor" olarak görünür.

### RP-03 — Uygunluk ve ajan aktivitesi (durum zaman çizelgesi)
- **Alan (panelde nerede, kim kullanır):** Raporlar › Ekip › "Uygunluk" (durum başına süre, saatlik dağılım) ve "Ajan aktivitesi" (ajan × saat şeridi, gün seçici). Ekip › üye profili "Bugünkü aktivite". Görünürlük karar 2'ye göre.
- **Mevcut kod karşılığı:**
  - Kayıt: `prisma:2840-2855` `AgentPresenceEvent`. Yazılan yerler `api/routes/agents.ts:383` (durum değişikliği) ve `api/services/auth/membership-service.ts:89` (askıya alma).
  - Okuma/aralık hesabı: `api/routes/reports.ts:1295-1310` `presenceEvents` (açılış satırı dahil), `api/services/staffing/presence-coverage.ts`. Plan karşılaştırması `roster-coverage.ts`. Kullanım yalnızca `GET /reports/staffing-forecast` (`:1765`).
  - Bağlantı kopması kaydedilmiyor (bkz. WG-03).
- **Eklenecek / değişecek yerler:**
  - Prisma: `agent_presence_events`'e `source TEXT DEFAULT 'manual'` (manual | disconnect | unresponsive | suspension | login) + CHECK.
  - API: `GET /reports/availability`, `GET /reports/agent-activity?date=&agent_id[]`. `presenceCoverage` tekrar kullanılır. RP-01 filtreleri ve kapsamı uygulanır.
  - RTM/API: WG-03'teki bağlantı kopma → `offline` (`source: disconnect`).
  - Web: rapor sekmeleri, şerit görünümü (renk + desen, renk körü dostu), plan (vardiya) bindirmesi.
  - Testler: aralık hesabı birim testleri (gece yarısını geçen durum, açılış satırı), kapsam testleri.
- **Kodlama mantığı:**
  - Süre, olay değişimleri arasındaki aralıklardan hesaplanır. Pencere başındaki durum için "açılış satırı" deseni korunur. Gün sınırı şirket saat dilimine göredir (ID-04).
  - Bellek sınırı mevcut forecast'taki üst sınır mantığıyla korunur. Çok ajanlı uzun aralıklar sayfalanır.
  - Çalışan izleme verisi olduğu için uç RL-02 kapsamıyla korunur. Ekip Üyesi yalnızca kendini görür (karar 2).
- **Kabul kriterleri:**
  - Gün içinde 09:00 kabul / 12:00 kabul etmiyor / 13:00 kabul / 18:00 çevrimdışı olan ajan için rapor 8 saat kabul ve 1 saat kabul etmiyor gösterir.
  - Tarayıcıyı kapatan ajanın şeridinde tolerans sonrasında "bağlantı yok" dilimi görünür.
  - Ekip Üyesi başka ajanın şeridini isteyemez (403).
- **Riskler / notlar:** WG-03'teki bağlantı kopma düzeltmesi gelmeden rapor "çevrimiçi" süreyi abartır. İkisi aynı sürümde çıkmalı ya da rapor üzerinde uyarı gösterilmeli.

### RP-04 — Kuyruk bekleme ve terk raporları
- **Alan (panelde nerede, kim kullanır):** Raporlar › Sohbetler › "Kuyruk" (giriş sayısı, ortalama/80. yüzdelik bekleme, atanma oranı, saat ısı haritası, ekip kırılımı) ve "Kuyruk terki". RP-01 kapsamı geçerli.
- **Mevcut kod karşılığı:**
  - `threads.queued_at` kuyruğa girişte yazılıyor (`api/services/chat/chat-service.ts:2008`), ama atamada (`api/services/routing/routing-service.ts:219`) ve kapanışta (`chat-service.ts:967`) `null` yapılıyor. Geçmiş bekleme süresi kayboluyor.
  - Raporda yalnızca "şu an kuyrukta" (`queued_now`). "Abandon" kavramı yok.
- **Eklenecek / değişecek yerler:**
  - Prisma: `queue_entries` tablosu (`license_id`, `thread_id`, `group_id`, `entered_at`, `left_at`, `outcome` (assigned | abandoned | closed_by_agent | transferred | timeout)) + RLS + `(license_id, entered_at)` index. Bir oturum birden çok kez kuyruğa girebilir (WG-03 yeniden kuyruklama).
  - API: kuyruğa girilen her yer (`route()` → `queued`, WG-03 yeniden kuyruklama, AU-01 ekip kuyruğu) satır açar. Çıkılan her yer (`drainQueue`, takeover/claim, kapanış, transfer) satırı kapatır. Rapor yardımcıları + `GET /reports/queue`, `GET /reports/queue-abandonment` + export.
  - WG-05 için ekip başına son 7 gün medyan/p80 bekleme özetini veren iç fonksiyon (önbellekli).
  - Web: rapor sekmeleri.
  - Testler: giriş/çıkış eşleşmesi (açık kalan satır olmaz), terk tanımı, ekip kırılımı.
- **Kodlama mantığı:**
  - Terk (karar 1): kuyruktayken oturum müşteri tarafından (`/customer/chat/close`) ya da zaman aşımıyla kapanırsa `abandoned`. Widget penceresinin kapanması bir olay değildir.
  - Kapanış ve atama aynı işlemde satırı kapatır, böylece "açık kalmış giriş" oluşmaz. Ayrıca güvenlik ağı olarak kapalı oturuma ait açık satırları kapatan bir temizlik adımı sweep'e eklenir.
  - Mevcut `queued_at`'in silinmesi davranışı değişmez (sıra numaralandırması ona dayanıyor). Kalıcı kayıt ayrı tablodadır.
  - **Öncelik notu:** tablo ve yazımlar erken gelmeli. Rapor ekranı sonra gelebilir, ama veri birikmeye başlamalı.
- **Kabul kriterleri:**
  - 3 dk kuyrukta bekleyip atanan sohbet raporda 3 dk bekleme ve "atandı" olarak görünür.
  - Kuyrukta oyuncu sohbeti kapatırsa "terk" sayılır.
  - Her ekip için ayrı ortalama gösterilir (AU-01 sonrası).
  - Kapanmış oturumda açık kuyruk satırı kalmaz.
- **Riskler / notlar:** AU-01 olmadan "ekip kuyruğu" kavramı zayıftır. `group_id` sohbetin erişim grubundan alınır ve birden çok grup varsa ilk/ana grup kuralı belirlenmelidir.

### RP-05 — Günlük / haftalık özet e-postaları
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Genel › Bildirimler (`/app/settings/notifications`), kişisel "E-posta özetleri" anahtarları (günlük/haftalık). Kurucu/Yönetici şirket varsayılanını belirler. Alıcılar karar 1'e göre.
- **Mevcut kod karşılığı:**
  - Zamanlanmış rapor altyapısı: `api/services/reports/scheduled-report-service.ts`, `scheduled-report-sweeper.ts`, `scheduled-report-period.ts` (günlük/haftalık/aylık dönem hesabı), `scheduled-report-mail.ts`. İş `api/services/scheduler/jobs.ts:181` (`scheduled_reports`).
  - Şablonlar `api/services/mail/templates/messages.ts` (`:589` `scheduledReportMail`, özet şablonu yok).
  - Kişisel bildirim tercihleri: `types/notifications.ts`, `api/routes/notifications.ts`. Ajan dili `agent_memberships.locale` (migration `20261011090000_membership_locale`).
- **Eklenecek / değişecek yerler:**
  - Types/contract: bildirim tercihlerine `digest_daily`, `digest_weekly`. `contract/paths/notifications.yaml`.
  - Prisma: `digest_deliveries` (`license_id`, `agent_id`, `period_key` benzersiz) + RLS (tekrar gönderimi engeller).
  - API: yeni sweep adımı (mevcut `scheduled_reports` işine ya da yeni `digests` işine). Şirket saat diliminde 08:00 (haftalık: Pazartesi). Sayılar `report-csv.ts` yardımcılarından RP-01 kapsamıyla. Yeni şablon `digestMail` (TR/EN).
  - Web: tercih anahtarları, şirket varsayılanı ayarı.
  - Testler: dönem anahtarı/idempotency birim, şablonda kişisel veri bulunmadığını doğrulayan test, kapsam testi.
- **Kodlama mantığı:**
  - Her alıcı için kapsam rolüne göre hesaplanır (Ekip Lideri → kendi ekipleri). Sayılar raporlarla aynı yardımcılardan gelir (tek kaynak).
  - İçerik (karar 1): toplamlar, önceki döneme göre değişim, kaçan sohbet, ilk yanıt, CSAT, AI çözüm/devir, risk bayraklı sohbet **sayısı**, kuyruk p80. Oyuncu adı, kullanıcı adı ve mesaj metni **yoktur**. Panel bağlantıları yalnızca ID içerir.
  - `notifyEmail` kapalı kullanıcıya gönderilmez. Gönderim iç bildirim sayılır, dış günlük sınıra (`mail-caps.ts`) girmez.
  - Sweep dakikada bir çalışır. "08:00'ı geçmiş ve bu dönem gönderilmemiş" koşulu ile gecikmeli sunucuda da bir kez gönderir.
- **Kabul kriterleri:**
  - Günlük özeti açık Yönetici şirket saatiyle 08:00 sonrası ilk sweep'te tek e-posta alır. Sweep iki kez koşsa da ikinci e-posta gitmez.
  - Ekip Liderinin e-postası yalnızca kendi ekibinin sayılarını içerir.
  - E-posta gövdesinde oyuncu kişisel verisi bulunmaz (otomatik test).
- **Riskler / notlar:** Çok kiracılı ve çok alıcılı dağıtımda sweep süresi uzayabilir. Hesaplar kiracı başına bir kez yapılıp alıcılara dağıtılmalı.

---

## 10. Otomasyon ve yönlendirme (AU)

### AU-01 — Konuya göre ekip yönlendirmesi (Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet)
- **Alan (panelde nerede, kim kullanır):**
  - Ekip › Ekipler (`/app/team/teams`), her ekipte "Kuyruk ayarları": konu rolü, gerekli yetenek, mesai dışı davranışı, atama modu (WG-07).
  - Ayarlar › Yönlendirme › Yetenekler (`/app/settings/skills`): "Sorumlu oyun eğitimi".
  - Inbox "Kuyrukta" görünümü ekip sekmeleriyle.
  - Roller: kurulum Kurucu ve Yönetici. Ekip Lideri kendi kuyruğunu yönetir ve izler (RL-03). Ekip Üyesi kendi ekiplerinin kuyruğunu görür.
- **Mevcut kod karşılığı:**
  - `api/services/routing/routing-service.ts`:
    - `route()` `:114-171`
    - `drainQueue()` `:179-241`. Lisans genelinde sırayla çalışıyor ve uygun ajan bulunamayınca `:215` `if (!assignee) break;` ile duruyor. Bu, ekipler arası baş-tıkanmasıdır.
    - Kuyruk boşaltmada uzmanlık şartı uygulanmıyor (yorum `:203-209`).
    - `renumberQueue()` `:244-257` ve `#nextQueuePosition()` `:407-414` lisans genelinde.
    - `#selectGroup()` `:261-313`, `#fallbackGroup()` `:315-321`, `#selectAgent()` `:341-405` (uzmanlık filtresi var).
  - Modeller `prisma:698-711` `Group` (ad, dil), `GroupAgent.priority`, `:759` `AgentExpertise`.
  - AI devri ekip **adıyla** arıyor: `api/services/ai/ai-responder.ts:174-187`.
  - Takıma transfer API'de var (`contract/paths/chats.yaml:383-386`), arayüz yalnızca ajana aktarıyor (`web/features/inbox/useInbox.ts:822`).
- **Eklenecek / değişecek yerler:**
  - Types/contract: `QUEUE_TOPIC_ROLES = ['finance','kyc_risk','bonus','responsible_gambling','technical','complaint']`. `contract/paths/agents.yaml#/group` (rol, gerekli yetenekler, mesai dışı modu). `GET /routing/queues` (AI-12 ve WG-04 için rol → ekip çözümü).
  - Prisma + migration:
    - `groups`'a `topic_role TEXT NULL` (+ `(license_id, topic_role)` kısmi benzersiz index), `after_hours_mode TEXT DEFAULT 'queue'`.
    - Ekip başına gerekli yetenekler için bağlantı tablosu.
    - `threads`'e `queue_group_id BIGINT NULL` (hangi ekibin kuyruğunda) ve `priority SMALLINT DEFAULT 0`.
    - Mevcut kuyruktaki oturumlar için `queue_group_id` geri doldurması (sohbetin ilk erişim grubu).
  - API (routing):
    - Sıra numarası, yeniden numaralandırma ve boşaltma **ekip başına** yapılır.
    - Ekip içinde sıra: `priority DESC, queued_at ASC`.
    - "İlk eksikte dur" kuralı yalnızca o ekip içinde geçerli olur. Bir ekip tıkanınca diğerleri boşaltılmaya devam eder.
    - Kuyruk boşaltırken ekibin gerekli yetenekleri uygulanır.
    - `responsible_gambling` rolündeki ekip için yedek ekibe düşme **yoktur**.
  - API (ekip yönetimi): yetenek şartını taşımayan ajanı ekibe ekleme 409 (`api/routes/agents.ts:1044` `PUT /groups/{groupId}/agents/{agentId}`). Sorumlu Oyun ekibi silinemez.
  - AI köprüsü: `ai-responder.ts #transfer` adla değil `topic_role`/ekip ID ile çözer. Seçiciyi AI-12 yazar, bu madde `resolveQueue(topicRole)` fonksiyonunu sağlar.
  - Acil öncelik: AI-27/AI-09'un koyduğu bayrak `threads.priority`'yi yükseltir.
  - RTM: mevcut `queue_positions_updated` push'u ekip bazında yayınlanır.
  - Web:
    - Ekip editöründe kuyruk ayarları.
    - Onboarding'de/ekip sayfasında "iGaming kuyruk şablonunu kur" eylemi (6 ekip + yetenek). Bu bir migration değil, kullanıcının bilinçli eylemi.
    - Inbox kuyruk sekmeleri.
    - DetailsPanel'e "Takıma aktar" (IN-04).
  - Testler: entegrasyon (baş-tıkanması: Sorumlu Oyun'da bekleyen sohbet Finans boşaltmasını engellemez), yedek ekip yasağı, yetenek kuralı, öncelik sırası, eşzamanlı boşaltma, AI devrinin rol ile çözülmesi.
- **Kodlama mantığı:**
  - Kuyruk = ekip. Bir oturum aynı anda tek bir ekibin kuyruğundadır (`queue_group_id`). Erişim grupları (`chat_access`) görünürlüğü, `queue_group_id` atama sırasını belirler.
  - Yedek ekip zinciri yalnızca `responsible_gambling` dışındaki ekiplerde çalışır. Sorumlu Oyun'da uygun ajan yoksa (karar 3) sohbet kuyrukta kalır, Ekip Lideri ve Yöneticiye acil bildirim gider, oyuncuya sabit destek mesajı yazılır (bir kez). Mesai dışında AI-12/HD-01 ile talep kaydı açılır.
  - "Eğitimli ajan" kontrolü iki yerde yapılır: üyelik eklenirken (kalıcı kural) ve seçim anında (savunma).
  - Acil öncelik kendi ekip kuyruğunun en önüne geçer. Başka ekibin kuyruğunu etkilemez.
  - Kilit sırası: kuyruk boşaltma işlemi ekip başına kısa işlemlerle yapılır. Uzun tek işlem tüm kiracıyı kilitlememelidir.
  - Bu iş MASTER-PROMPT'taki **[MAX]** dilimidir ("Routing/queue atama algoritması + concurrent limit + fallback"). Efor kapısına uyulmalı.
- **Kabul kriterleri:**
  - Finans ekibinde boş ajan varken Sorumlu Oyun kuyruğunda bekleyen bir sohbet, Finans kuyruğundaki sohbetin atanmasını engellemez.
  - Sorumlu Oyun kuyruğundaki sohbet hiçbir koşulda başka ekibe ya da eğitimsiz ajana atanmaz.
  - Yetenek etiketi olmayan ajan Sorumlu Oyun ekibine eklenemez (409).
  - AI devri `finance` rolüne gönderildiğinde ekip adı değişmiş olsa bile doğru ekibe düşer.
  - Acil öncelikli sohbet kendi kuyruğunun başına geçer.
  - Oyuncunun gördüğü sıra numarası kendi ekip kuyruğuna göredir.
- **Riskler / notlar:** Sıra numarası semantiğinin değişmesi widget'taki "X. sıradasınız" metnini etkiler (artık ekip kuyruğu). Bu bilinçli bir değişiklik. Raporlar (RP-04) ve WG-05 tahmini aynı `queue_group_id`'yi kullanmalı.

### AU-02 — Yönlendirme kuralları arayüzünün API ile eşitlenmesi
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Yönlendirme › Sohbet yönlendirme (`/app/settings/routing-rules`). Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - Arayüz: `web/features/settings/RoutingRules.tsx:84` (`{ url_contains: string[] }`), `:125-142` (tek alan, tek değer).
  - API: `api/routes/settings.ts:421-423` (`url_contains[]`, `url_equals[]`, `country_codes[]`), serileştirme `:3301-3303`.
  - Motor: `api/services/routing/routing-service.ts:423-441` `matches()` (farklı koşul türleri VE, aynı tür içindeki değerler VEYA).
  - Widget sohbeti yalnızca URL iletiyor: `api/routes/customer.ts:840`. Ajanın başlattığı sohbet ülkeyi iletebiliyor: `api/routes/chats.ts:84,255`.
- **Eklenecek / değişecek yerler:**
  - Web: koşul satırları (URL: "içerir / tam eşit", çoklu değer çipleri; Ülke: çoklu seçim, ISO listesi). Kural listesinde okunabilir özet.
  - API: `customer.ts:840` yönlendirme bağlamına müşterinin `country_code`'u eklenir (EN-03'te mint'te doldurulur). Contract değişmez.
  - Testler: `web/features/settings/RoutingRules.test.tsx`, `apps/api/test/integration/routing.test.ts` (ülke ve tam eşleşme).
- **Kodlama mantığı:**
  - Semantik arayüzde açıkça yazılır: "Tüm koşul türleri sağlanmalı. Bir türün değerlerinden biri yeterli."
  - `url_equals` bugün ham dize eşitliği yapıyor (`candidate === context.url`). Widget'ın gönderdiği URL sorgu parametreleri (kampanya izleri vb.) içerebilir. Hem kayıtta hem eşleşmede URL normalleştirilmeli (şema + host küçük harf, sorgu ve `#` atılır, sondaki `/` eşitlenir).
  - Ülkesi bilinmeyen ziyaretçi ülke koşullu kurala hiç uymaz (mevcut davranış). Arayüzde "ülkesi bilinmeyenler sonraki kurala düşer" notu gösterilir.
- **Kabul kriterleri:**
  - Arayüzden "URL tam eşit `https://site.com/tr/para-yatir`" kuralı kaydedilir. Sorgu parametreli aynı sayfadan gelen sohbet eşleşir.
  - "Ülke = TR, AZ" kuralı TR'den gelen widget sohbetini hedef ekibe yönlendirir.
  - Mevcut tek URL'li kurallar değişmeden görünür ve düzenlenir.
- **Riskler / notlar:** Ülke verisi EN-03'e bağlı. O gelmeden ülke koşulu yalnızca ajanın başlattığı sohbetlerde çalışır, bu durum arayüzde belirtilmeli.

### AU-03 — Tetikleyiciler: "sohbet puanlandı" ve ticket yaşam döngüsü olayları
- **Alan (panelde nerede, kim kullanır):**
  - Geliştiriciler (`/app/developers`) › Webhook'lar: olay listesine yeni olaylar.
  - Ayarlar › Yönlendirme › Talep kuralları (`/app/settings/ticket-rules`): "Ne zaman" seçicisi.
  - Ayarlar › Gelen kutusu: "Kötü puan" otomasyonu.
  - Kurucu, Yönetici.
- **Mevcut kod karşılığı:**
  - Olay sözlüğü `api/services/webhooks/webhook-service.ts:28-34` `WEBHOOK_ACTIONS`.
  - Yayıcı `api/services/webhooks/workspace-events.ts:60-62` (`emit` hiç fırlatmaz, işlem sonrasında çalışır, tek deneme + sweep).
  - Yayın yerleri `chat-service.ts:350,580,1108,1503`. Puan ucu `api/routes/customer.ts:1096-1135` olay yaymıyor.
  - Ticket kuralları yalnızca açılışta: `types/domain.ts:559-600` (`subject_contains`, `source`; eylemler atama/öncelik/etiket), `api/services/tickets/apply-ticket-rules.ts`.
  - Zapier/Make manifesti `types/integrations.ts` (5 tetik, 3 eylem), `GET /integrations/manifest` (`api/routes/webhooks.ts:143`).
- **Eklenecek / değişecek yerler:**
  - Types/contract:
    - `WEBHOOK_ACTIONS` += `chat_rated`, `ticket_updated`, `ticket_status_changed`, `ticket_assigned`, `ticket_message_added` (son olay HD-01 ile).
    - Payload şemaları `contract/paths/webhooks.yaml` + manifest.
    - `TicketRule.on: 'created'|'updated'|'status_changed'|'message_added'` + yeni koşullar (`status_to`, `priority_at_least`, `from_requester`).
  - Prisma: `ticket_rules.on TEXT DEFAULT 'created'` + CHECK. Kötü puan otomasyonu için `InboxSettings`'e `bad_rating_actions JSONB` (bildir, QA'ya ekle, ticket aç).
  - API:
    - Puan ucunda işlem sonrası `chat_rated` yayını ve kötü puan otomasyonu.
    - Ticket servisindeki güncelleme yollarında olay yayını ve kural motorunun `on` filtresiyle çalışması.
  - Web: webhook olay listesi manifestten otomatik gelir. TicketRules'a "Ne zaman" seçicisi. Kötü puan ayarı.
  - Testler: olay yayını entegrasyonu (yanlış kiracıya gitmez), kural döngüsü testi, manifest/contract senkron testi.
- **Kodlama mantığı:**
  - **Döngü koruması:** bir kuralın eylemi (ör. öncelik değiştirme) `ticket_updated` üretir. Kural motoru kendi tetiklediği güncellemede kuralları **yeniden çalıştırmaz** (`triggered_by_rule` bağlam bayrağı, derinlik sınırı 1).
  - Olaylar işlem commit edildikten sonra yayılır (mevcut kural). Webhook'un düşmesi asıl akışı bozmaz.
  - `chat_rated` payload'ında yorum maskeli metin olarak gider. Payload'da yalnızca kimlikler ve gerekli alanlar bulunur (dışarıya minimum veri).
  - Kötü puan varsayılanı (karar 1): Ekip Liderine panel bildirimi + AI-24 QA kuyruğuna ekleme. Ticket açma ve webhook isteğe bağlıdır.
- **Kabul kriterleri:**
  - Kötü puan verilince `chat_rated` aboneliği olan webhook bir kez tetiklenir ve Ekip Lideri bildirim alır.
  - "Durum `solved` olduğunda etiket ekle" kuralı yalnızca o geçişte çalışır ve kendi güncellemesiyle tekrar tetiklenmez.
  - Yeni olaylar Zapier manifestinde görünür ve contract'tan üretilen tiplerle uyumludur.
- **Riskler / notlar:** `ticket_message_added` HD-01 (ticket yanıtı) gelmeden anlamsız. Sözlüğe birlikte eklenmeli. Olay sayısı arttıkça teslim günlüğü (KN-03) önem kazanır.

---

## 11. Kanallar ve entegrasyonlar (KN)

### KN-01 — Gerçek WhatsApp kanalı
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Kanallar › Tüm kanallar (`/app/settings/channels`) › WhatsApp › "Bağla" (Meta gömülü kayıt penceresi). Inbox'ta WhatsApp kanal görünümü. Bağlama: Kurucu, Yönetici. Sohbet: Ekip Üyesi.
- **Mevcut kod karşılığı:**
  - `api/services/channels/whatsapp.ts` (açıkça "MOCK": bağlantı `waba_id + phone_number`, gelen mesaj şeması basitleştirilmiş).
  - Ortak sözleşme `api/services/channels/channel-adapter.ts` (`ChannelAdapter`, `NormalizedInbound`; "Provider signature verification is deliberately out of scope").
  - Kayıt `registry.ts`, akış `channel-service.ts`.
  - **Canlı örnek:** `api/services/channels/telegram-live.ts`. Şifreli kimlik bilgisi `channels.credential_ciphertext` (`lib/credential-cipher.ts`, `channelCredentialAad`), `webhook_secret_hash`, kendi webhook yolu (`api/routes/channels.ts:372`), `APPS_LIVE_PROVIDERS` (`config/env.ts:337`), `lib/safe-fetch.ts`.
  - Kanal modeli marka bazlı (`prisma` `Channel`, `brand_id`).
  - Panel `web/features/settings/Channels.tsx` (WhatsApp diyaloğu mock).
- **Eklenecek / değişecek yerler:**
  - API:
    - `whatsapp-live.ts` adaptörü: gömülü kayıt kodu → işletme belirteci + `phone_number_id` + WABA, uygulamanın WABA webhook'una abone edilmesi, belirtecin şifreli saklanması.
    - Uygulama düzeyinde tek webhook ucu (`GET` doğrulama: `hub.verify_token`/`hub.challenge`, `POST`: `X-Hub-Signature-256` HMAC doğrulaması).
    - Cloud API payload ayrıştırma (metin, medya, interaktif cevap, durum).
    - Gönderim (`/{phone_number_id}/messages`, `safe-fetch` ile).
  - Prisma: `channel_messages` benzeri sağlayıcı mesaj kimliği tekilliği (`(channel_id, provider_message_id)` benzersiz) ve oturum başına `last_customer_message_at` (24 saat penceresi).
  - Env: `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, Graph sürümü.
  - Web: gerçek bağlama akışı, durum ("yeniden bağlan gerekli"), ajan composer'ında "24 saat penceresi kapandı" bandı.
  - Testler: imza doğrulama negatif testleri, Meta örnek payload fikstürleri, tekrar teslim (Meta yeniden dener) idempotency, pencere kuralı. Dış servis testte taklit edilir (MASTER-PROMPT §5).
- **Kodlama mantığı:**
  - **Kiracı çözümü:** webhook'ta oturum yok. `phone_number_id` → kanal → lisans eşlemesi SECURITY DEFINER bir çözümleyiciyle yapılır (Telegram/e-posta deseni), sonra her şey `withTenant` içinde çalışır.
  - **Hızlı 200:** Meta yanıt bekler. Ağır iş (AI yanıtı, medya indirme) kalıcı iş kuyruğuna bırakılmalıdır (GV-02). Yoksa zaman aşımında Meta tekrar gönderir.
  - **Tekillik:** `wamid` ile aynı mesaj iki kez sohbete yazılmaz.
  - **Pencere:** son oyuncu mesajından 24 saat sonra serbest metin gönderilemez. F1'de şablon desteği yok (karar 3). Composer kilitlenir.
  - **Medya:** Graph medya ucundan indirilir, `/uploads` deposuna dosya paylaşım ayarındaki MIME ve boyut sınırlarıyla yazılır. Metin AI-26 maskelemesinden geçer.
  - **Okundu bilgisi:** `statuses` (sent/delivered/read) olaylara işlenir (IN-05 ile uyumlu).
  - **Kimlik:** E.164 telefon → müşteri. ID-03 ile kullanıcı adına bağlama ayrı adımdır (oyuncu doğrulamasız telefonla hesap verisi görmez).
  - **Belirteç geçersizleşirse** (Graph hata 190) kanal durumu "yeniden bağlan" olur ve yöneticiye bildirim gider.
- **Kabul kriterleri:**
  - Test numarasından gelen mesaj doğru kiracının Inbox'ında yeni sohbet açar. Ajan yanıtı WhatsApp'a ulaşır.
  - İmzası geçersiz webhook 401 alır ve hiçbir şey yazılmaz.
  - Aynı mesajın iki kez teslimi tek mesaj üretir.
  - 24 saati geçmiş sohbette ajan serbest metin gönderemez ve açıklayıcı uyarı görür.
  - Gelen görsel dosya paylaşım kurallarına uyar.
- **Riskler / notlar:** Meta'nın kumar/bahis politikası ve hesap onayı ticari bir engel olabilir (karar 2), teknik iş bundan sonra planlanmalı. `APP_SECRET` dağıtım sırrıdır, kiracı başına değildir. Sızması tüm kiracıları etkiler.

### KN-02 — Gerçek Messenger / Instagram kanalları
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Kanallar › Messenger / Instagram › "Bağla" (Facebook Login for Business). Inbox kanal görünümleri. Bağlama: Kurucu, Yönetici.
- **Mevcut kod karşılığı:** `api/services/channels/messenger.ts`, `instagram.ts` (mock). `web/features/settings/Channels.tsx` (`MOCK_FACEBOOK_AUTH_CODE`, `:1092-1097`). `apps/e2e/tests/instagram.spec.ts`. Canlı kanal deseni `telegram-live.ts`.
- **Eklenecek / değişecek yerler:**
  - API: KN-01 ile ortak `meta-graph` istemcisi ve webhook doğrulayıcı. Sayfa erişim belirteci (uzun ömürlü) + sayfanın `messages`/`messaging_postbacks` aboneliği. Instagram için profesyonel hesabın bağlı olduğu sayfa üzerinden Instagram Messaging. Gönderim API'si (`messaging_type: RESPONSE`).
  - Prisma: KN-01'deki sağlayıcı mesaj kimliği tekilliği ve pencere alanı ortak.
  - Web: gerçek bağlama akışı ve sayfa/hesap seçimi.
  - Testler: payload fikstürleri (`object: page` / `object: instagram`), imza, tekillik.
- **Kodlama mantığı:**
  - Kimlikler sayfaya özeldir (PSID/IGSID). Aynı kişi iki sayfada iki müşteri olur, birleştirme ID-03'ün işidir.
  - 24 saat penceresi geçerlidir. "HUMAN_AGENT" etiketiyle 7 gün uzatma ayrı Meta izni ister, F1'de kapsam dışıdır.
  - Hikâye yanıtı ve bahsetmeler ayrı olay türü olarak işlenir, ilk sürümde düz mesaj olarak gösterilebilir.
  - Postback butonları EN-02'deki `send_message` butonlarıyla eşlenebilir.
- **Kabul kriterleri:** Bağlanan sayfaya/hesaba gelen DM Inbox'ta görünür ve yanıtı karşı tarafa ulaşır. İmzasız istek reddedilir. Aynı `mid` iki kez yazılmaz.
- **Riskler / notlar:** Meta App Review izinleri (`pages_messaging`, `instagram_manage_messages`) iGaming markalarında zorlaşabilir. KN-01 kararı burada da geçerli.

### KN-03 — Webhook teslim günlüğü arayüzü
- **Alan (panelde nerede, kim kullanır):** Geliştiriciler (`/app/developers`) › Webhook'lar › webhook satırı › "Teslimler" çekmecesi (tablo + "Tekrar gönder" + "Test olayı gönder" + "Aç/Kapat"). Kurucu, Yönetici (`webhooks--all:rw`).
- **Mevcut kod karşılığı:**
  - Model `prisma:2048-2075` `WebhookDelivery` (`state`, `attempt`, `status_code`, `error`, `permanent`, `next_attempt_at`, `payload` yalnızca yeniden deneme beklerken).
  - Uçlar `api/routes/webhooks.ts:132` (liste), `:148` (ekle), `:192` (sil), `:143` (manifest). PATCH yok [D13].
  - Gönderici `services/webhooks/webhook-dispatcher.ts`, yeniden teslim işi `scheduler/jobs.ts:220`. Ekran `web/features/developers/WebhookSubscriptions.tsx`.
- **Eklenecek / değişecek yerler:**
  - Contract/API:
    - `GET /webhooks/{id}/deliveries?state=&cursor=` (yeniden eskiye, sayfalı).
    - `POST /webhooks/{id}/deliveries/{deliveryId}/redeliver`.
    - `POST /webhooks/{id}/test` (imzalı `ping` olayı, `test: true`).
    - `PATCH /webhooks/{id}` (`enabled`).
  - Saklama: terminal durumdaki teslimlerde payload bugün siliniyor. Elle yeniden gönderim için ya `exhausted` satırlarda payload kısa süre (ör. 72 saat) tutulur ya da `event_id`'den yeniden üretilir. Kodlayan seçer, ama "teslim edilmiş payload kalıcı kopya bırakmaz" ilkesi korunmalı.
  - Web: çekmece tablo (zaman, olay, deneme, durum, HTTP kodu, kısa hata), filtre, eylemler.
  - Testler: entegrasyon (başka kiracının teslimi görünmez), test olayı imzası, yeniden gönderimin yeni deneme satırı açması.
- **Kodlama mantığı:**
  - Hata metni gösterilmeden önce temizlenir (sır, belirteç, uzun yanıt gövdesi yok, ≤ 500 karakter).
  - Yeniden gönderim normal gönderici yolundan geçer (SSRF koruması, imza, nonce). Ayrı bir yol açılmaz.
  - Test olayı oran sınırlıdır (dakikada birkaç tane).
  - Teslim satırlarının saklama süresi veri saklama sweep'ine dahil edilmelidir (mevcut kapsam kontrol edilmeli).
- **Kabul kriterleri:** Başarısız teslim tabloda HTTP kodu ve hata özetiyle görünür. "Tekrar gönder" yeni bir deneme üretir ve sonucu tabloya düşer. "Test" imzalı ping gönderir. Kapatılan webhook olay almaz.
- **Riskler / notlar:** Yoğun kiracıda teslim tablosu hızla büyür. Liste sorgusu `(license_id, webhook_id, created_at)` index'ine dayanmalı.

### KN-04 — Barındırılan API dokümanı
- **Alan (panelde nerede, kim kullanır):** Herkese açık doküman sayfası (ör. `/developers/docs`) ve Geliştiriciler ekranında "API dokümanı" bağlantısı. Okuyan: operatörün geliştiricileri.
- **Mevcut kod karşılığı:** `packages/contract/openapi/openapi.yaml` + `paths/*.yaml` (tek doğruluk kaynağı, tipler buradan üretiliyor: `pnpm -w contract:generate`). `web/features/developers/DeveloperPortal.tsx`. Redoc/Swagger servisi yok.
- **Eklenecek / değişecek yerler:**
  - Build: OpenAPI'yi tek dosyada birleştiren ve **yalnızca dış kullanıma açık** operasyonları içeren yayın adımı. Bunun için operasyonlarda açık bir işaret gerekir (ör. `x-public: true`).
  - Sunum: statik doküman sayfası (CSP uyumlu, kendi barındırdığımız Redoc benzeri görüntüleyici), sürüm numarası, değişiklik günlüğü.
  - İçerik: PAT ile kimlik doğrulama örneği, webhook imza doğrulama örneği (HMAC + zaman damgası + nonce), oran sınırları, hata tipleri.
  - CI: birleştirme adımının çalıştığını ve iç operasyonların sızmadığını kontrol eden test.
  - Web: DeveloperPortal'dan bağlantı.
- **Kodlama mantığı:** Doküman elle yazılmaz, sözleşmeden üretilir. Sözleşme değişince doküman da değişir. Dış dokümana yalnızca işaretli operasyonlar girer. Varsayılan "gizli"dir, böylece yeni bir iç uç yanlışlıkla yayımlanmaz.
- **Kabul kriterleri:** Doküman sayfası girişsiz açılır ve aranabilir. İç uçlar (ör. platform yönetimi, sandbox reset) dokümanda yoktur (CI testi). Webhook imza örneği gerçek imza fonksiyonuyla aynı sonucu üretir (test).
- **Riskler / notlar:** Mevcut ≈313 operasyonun hangilerinin dışa açık olacağına bir kez karar vermek gerekir. Bu bir envanter işidir.

### KN-05 — Uygulamaların ajan arayüzüne panel ekleyebilmesi (iframe SDK)
- **Alan (panelde nerede, kim kullanır):** Ayarlar › Entegrasyonlar, yeni "Özel paneller" bölümü (ad, URL, görünür olduğu ekipler). Inbox sağ panelinde panel sekmesi. Tanımlama: Kurucu, Yönetici. Kullanma: Ekip Üyesi (RL-02'ye göre ekip bazlı).
- **Mevcut kod karşılığı:**
  - `web/features/inbox/DetailsPanel.tsx:139-155` (`/chats/{id}/apps` sorgusu), `:300-330` (bağlı uygulama kartları; iframe yok).
  - `packages/types/src/apps.ts:1870-1872` `appPlacement` (yerleşim karma değerle uyduruluyor).
  - Ortak uygulama altyapısı `api/routes/partner-apps.ts` (OAuth istemcileri) ve `web/features/developers/DeveloperPortal.tsx`.
- **Eklenecek / değişecek yerler:**
  - Prisma: `custom_panels` (`license_id`, `name`, `url`, `visible_group_ids`, `enabled`, `signing_secret_ciphertext`) + RLS + CHECK (https).
  - Contract/API: panel CRUD (yönetici) ve `POST /chats/{id}/panels/{panelId}/context-token`. Kısa ömürlü (≤ 5 dk), imzalı belirteç: `org_id`, `chat_id`, `thread_id`, oyuncu kullanıcı adı (varsa ve ID-03'e göre doğrulanmışsa işaretli), ajan ID, `aud = panel`.
  - Web:
    - Sandbox'lı iframe (`allow-scripts allow-forms allow-popups`, farklı origin).
    - `postMessage` köprüsü (origin kontrolü; `ready` → `context`, `resize`, `insertText` (composer'a öneri, ajan onaylar)).
    - Gömülemeyen sayfalar için "yeni sekmede aç" (imzalı kısa ömürlü bağlantı).
  - CSP: web uygulamasının `frame-src`'i kiracının tanımladığı origin'lere izin verecek şekilde yönetilmeli (statik SPA olduğu için başlık sunucu/proxy tarafında).
  - Testler: köprüde yanlış origin'den gelen mesajın yok sayılması, belirteç süresi, ekip görünürlüğü.
- **Kodlama mantığı:**
  - Oyuncu bilgisi URL'ye yazılmaz (GV-05). Bağlam iframe `ready` dedikten sonra `postMessage` ile ve hedef origin belirtilerek gönderilir.
  - Panel F1'de yalnızca bağlam alır. Sohbet geçmişini okuyamaz, mesaj gönderemez (yalnızca composer'a öneri).
  - Panel tanımı değişiklikleri denetim kaydına yazılır.
  - Operatörün back-office'i kendi oturumunu kullanır. SiyahTuş onun kimlik bilgilerini taşımaz.
- **Kabul kriterleri:** Tanımlı panel ilgili ekibin sohbetlerinde görünür, diğer ekiplerde görünmez. Panel `ready` sonrası doğru sohbetin imzalı bağlamını alır ve belirteç 5 dk sonra geçersizdir. Başka origin'den gelen `postMessage` işlenmez. Kullanıcı adı hiçbir URL'de görünmez.
- **Riskler / notlar:** `X-Frame-Options: DENY` kullanan back-office'ler gömülemez, "yeni sekmede aç" yolu şart. Kötü niyetli panel URL'si oltalama riski taşır, bu yüzden yalnızca yöneticiler tanımlayabilir.

### KN-06 — iGaming platform entegrasyonları (BetConstruct, EveryMatrix vb.)
- **Alan (panelde nerede, kim kullanır):**
  - Ayarlar › Entegrasyonlar, yeni "iGaming platformu" bölümü (sağlayıcı, API adresi, kimlik bilgisi, "Bağlantıyı test et").
  - Senaryolar (`/app/playbook`): prosedür adımlarında araç seçimi (AI-28).
  - Inbox sağ panelinde salt okunur "Oyuncu hesabı" kartı.
  - Roller: bağlantı Kurucu, Yönetici. Prosedüre araç bağlama Yönetici, Ekip Lideri (AI-20 onayıyla). Kartı görme RL-02.
- **Mevcut kod karşılığı:**
  - iGaming bağlantısı yok.
  - Kullanılacak desenler: dış sağlayıcı doğrulayıcıları `api/services/apps/verifiers/` (`brevo.ts`, `freshdesk.ts`, `registry.ts`), şifreli kimlik bilgisi `lib/credential-cipher.ts` (`appCredentialAad`), güvenli dış istek `lib/safe-fetch.ts` + `lib/ssrf.ts`, sağ panelde uygulama verisi kartları (`/chats/{id}/apps`, `DetailsPanel.tsx`), maliyet ölçümlü LLM çağrıları `services/ai/metered-llm.ts`.
  - Araç yuvasının şeması AI-28'de (başka yazar) tanımlanıyor. Bu madde o yuvaya **somut araçları** takar.
- **Eklenecek / değişecek yerler:**
  - Types: `PlatformConnector` arayüzü (`findPlayer`, `listTransactions`, `getKycStatus`, `getBonusState`) ve normalleştirilmiş DTO'lar. Örnek: `TransactionSummary { id, type, method, amount, currency, status, created_at }`. Kart/IBAN alanları maskeli.
  - Araç tanımları (AI-28 kayıt formatında): `deposit_lookup`, `withdrawal_status`, `kyc_status`, `bonus_state`. Her biri giriş/çıkış JSON şeması, `read_only: true`, zaman aşımı, önbellek süresi ve veri hassasiyet seviyesi tanımlar.
  - Prisma:
    - `platform_connections` (`license_id`, `brand_id`, `vendor`, `base_url`, `credential_ciphertext`, `status`, `last_verified_at`) + RLS.
    - `tool_invocations` (`license_id`, `chat_id`, `thread_id`, `tool`, maskeli giriş özeti, `outcome`, `latency_ms`, `error_code`, `created_at`) + RLS. ID-08 log zaman çizelgesine de beslenir.
  - API: bağlantı CRUD + doğrulama. Araç yürütücüsü: zaman aşımı ≤ 3 sn, devre kesici, kiracı başına oran sınırı, yalnızca tanımlı host'a `safe-fetch`, kısa önbellek.
  - Satıcı adaptörleri: önce pilot platform (karar 1), her biri ayrı modül ve kayıtlı fikstürlerle sözleşme testi.
  - Web: bağlantı ekranı, Inbox oyuncu kartı, prosedür editöründe araç seçimi (AI-28 UI'ı ile).
  - Testler: adaptör sözleşme testleri (taklit sunucu), zaman aşımı/devre kesici, doğrulanmamış kimlik yolu, çapraz kiracı yalıtımı, loglarda maskeleme.
- **Kodlama mantığı:**
  - **Kimlik kapısı:** araç yalnızca **doğrulanmış** oyuncu kimliğiyle çağrılır (ID-03 imzalı kimlik → platform oyuncu ID). Oyuncunun sohbette yazdığı kullanıcı adıyla araç çağrılmaz. Kimlik yoksa AI F1 akışına (bilgi topla + devret) döner.
  - **Salt okuma** (karar 2). Yazma gerektiren her şey insana devredilir.
  - **Hata davranışı:** zaman aşımı veya hata durumunda AI "kontrol edemiyorum" der ve F1 akışına geçer. Araç sonucunu uydurmaz (G8, G17). Araç başarılı olsa bile AI-08'in söz verme yasakları sürer: "hesabınıza geçmiş görünüyor" denebilir, "5 dakikaya yatar" denemez.
  - **Veri azaltma:** LLM'e yalnızca gereken alanlar gider (ör. son 3 işlem, maskeli). Ham API yanıtı LLM'e verilmez ve loglanmaz.
  - **Bölge:** çağrılar kiracının veri bölgesine (EU/US) uygun çalışır (mevcut bölge ayarı).
  - **Kayıt:** her çağrı `tool_invocations`'a yazılır ve devir kartında (AI-10) "AI şunu kontrol etti" satırı olarak görünür.
- **Kabul kriterleri:**
  - Pilot platformun sandbox'ında doğrulanmış oyuncu için `deposit_lookup` son yatırımı döndürür. AI bunu söz vermeden aktarır, devir kartında görünür.
  - Doğrulanmamış oyuncuda araç çağrılmaz (log kanıtı).
  - Platform 3 sn içinde yanıt vermezse AI F1 akışına geçer, oyuncu hata görmez.
  - Kimlik bilgisi veritabanında şifreli durur, loglarda görünmez.
  - B kiracısının bağlantısı A kiracısının sohbetinde kullanılamaz.
- **Riskler / notlar:** Satıcı API erişimi (NDA, sandbox, IP izin listesi) ticari süreç gerektirir. SiyahTuş'un oyuncu verisini işlemesi veri işleyen sözleşmesi (DPA) ister. F2 işidir. F1'de yalnızca AI-28 şemasının bu ihtiyaçları karşıladığı doğrulanmalı.

---

## 12. Faturalama (BL)

### BL-01 — Gerçek ödeme sağlayıcısı
- **Alan (panelde nerede, kim kullanır):** Faturalandırma (`/app/billing`): ödeme yöntemi, plan/koltuk, ödeme durumu bandı. Yalnızca Kurucu (bugün `billing_manage` yönetici setinde; RL-02 ile Kurucu'ya daraltılır).
- **Mevcut kod karşılığı:**
  - `api/services/billing/payment-provider.ts` (tek yöntem: `registerPaymentMethod`; tahsilat/iade yok; `PAYMENT_PROVIDERS` + mock). `config/env.ts:973` `STRIPE_PROVIDER` varsayılan `mock`.
  - `payment-method-service.ts`, `subscription-service.ts` (`trialing/active/canceled`), `invoice-service.ts`, dönem kapatma `invoice-close-*.ts` (iş `jobs.ts:268`), elle aktivasyon `license-activation.ts`, deneme sonrası salt-okuma `api/plugins/license-gate.ts`.
  - Uçlar `api/routes/reports.ts:2115-2436` (`/billing/*`). Ekran `web/features/billing/BillingPage.tsx`.
- **Eklenecek / değişecek yerler:**
  - Arayüz genişlemesi: `createCustomer`, barındırılan ödeme sayfası/kurulum oturumu (kart verisi bize hiç değmez, PCI SAQ A korunur), `chargeInvoice`, `refund`, sağlayıcı webhook'u (`payment_succeeded/failed`, itiraz).
  - Prisma: `payment_transactions` (`license_id`, `invoice_id`, `provider`, `provider_ref`, `amount_minor`, `currency`, `status`, `failure_code`, `provider_event_id` benzersiz) + RLS. `subscriptions`'a `provider_customer_id`, `provider_subscription_id`, `past_due_since`.
  - Zamanlayıcı: `billing_dunning` işi (başarısız ödemede 1/3/7. gün yeniden deneme, ardından salt-okuma).
  - Elle ödeme yolu: banka havalesi için platform personelinin faturayı "ödendi" işaretlemesi. Mevcut `license-activation` korunur.
  - Web: ödeme sayfasına yönlendirme, "ödeme başarısız" bandı, ödeme geçmişi.
  - Testler: sağlayıcı taklidi + webhook imza doğrulama, idempotency, durum makinesi geçişleri.
- **Kodlama mantığı:**
  - Durum makinesi: `trialing → active → past_due → (ek süre) read_only → canceled`. Her geçiş denetim kaydına yazılır.
  - Tutarlar en küçük birimde (cent) tutulur, para birimi tek kaynaktan gelir (karar 3).
  - Webhook olayları `provider_event_id` ile tekilleştirilir. Aynı ödeme iki kez işlenmez.
  - Vergi ve fatura belgesi BL-02'ye bırakılır. Ödeme yalnızca "fatura tahsil edildi" gerçeğini yazar.
  - Sağlayıcı seçimi açık kaldıkça arayüz sağlayıcıdan bağımsız kalır. Mock, elle havale ve gerçek sağlayıcı aynı arayüzü uygular.
- **Kabul kriterleri:**
  - Sandbox anahtarıyla barındırılan sayfadan ödeme yapılır, abonelik `active` olur, fatura "ödendi" görünür.
  - Başarısız ödemede bant çıkar, dunning planına göre yeniden denenir, ek süre sonunda salt-okuma devreye girer.
  - Aynı webhook olayı iki kez gelse de tek işlem kaydı oluşur.
  - Elle havale işareti aynı sonucu üretir.
- **Riskler / notlar:** Sağlayıcının sektör nedeniyle reddetmesi ya da hesabı kapatması (karar 1) ve ters ibraz. MASTER-PROMPT sınırları gereği gerçek anahtarlar ve canlı ödeme otonom yapımın dışında. Geliştirme yalnızca sandbox/mock ile yapılır, canlıya alma insan kararıdır.

### BL-02 — Fatura PDF'i, fatura adresi, vergi numarası
- **Alan (panelde nerede, kim kullanır):** Faturalandırma › "Fatura bilgileri" formu ve Faturalar listesinde "PDF indir". Yazma: Kurucu. Okuma: Yönetici.
- **Mevcut kod karşılığı:** `GET /billing/invoices` (`api/routes/reports.ts:2196`), indirme yalnızca CSV (`:2208-2235`, `toCsv`). Dönem dondurma `api/services/billing/invoice-close-sweep.ts`. Fatura adresi/vergi alanı yok. PDF üretimi rapor dışa aktarmada mevcut (`GET /reports/export?format=pdf`, `api/routes/reports-export.ts`).
- **Eklenecek / değişecek yerler:**
  - Prisma:
    - `billing_profiles` (`license_id` PK, `legal_name`, adres alanları, `country`, `tax_office`, `tax_id`, `vat_id`, `invoice_email`) + RLS + CHECK (ülke ISO, ülkeye göre vergi no biçimi).
    - Faturalara `number` (ihraççı başına benzersiz, ardışık), `issued_at`, `seller_snapshot`/`buyer_snapshot` (JSON, kesimde dondurulur), `pdf_storage_key`.
    - Numara için satır kilitli sayaç tablosu.
  - Contract/API: `GET/PUT /billing/profile`, `GET /billing/invoices/{period}/pdf`, düzeltme için `credit_note`.
  - Arayüz: `EInvoiceProvider` (TR e-Fatura/e-Arşiv entegratörü için) mock + gerçek uygulama sonra (karar 1).
  - Web: profil formu (doğrulamalı), PDF indirme.
  - Testler: eşzamanlı kesimde numara boşluğu ve çakışması olmaması, kesilen faturanın değiştirilememesi, PDF içerik snapshot testi.
- **Kodlama mantığı:**
  - PDF fatura kesildiği anda bir kez üretilir ve saklanır. Sonradan profil değişse bile eski fatura değişmez (snapshot).
  - Numara yıl bazlı ve boşluksuz olur (karar 2). İptal/düzeltme yeni belgeyle yapılır.
  - Vergi metni faturalandıran şirketin ülkesine bağlıdır (BL-01 kararı): AB B2B KDV numaralı müşteriye "reverse charge" ibaresi, TR şirketiyse KDV ve e-belge.
  - Profil olmadan kesilen faturalar şirket adıyla kesilir, profil tamamlanması için bant gösterilir.
- **Kabul kriterleri:** Profil kaydedilir ve geçersiz vergi numarası açık hatayla reddedilir. Kapanan dönemin PDF'i ünvan, adres, vergi no ve ardışık numarayla indirilir. Profil sonradan değişince eski PDF aynı kalır. İki eşzamanlı kesim farklı ardışık numaralar alır.
- **Riskler / notlar:** Yasal fatura biçimi ülkeye göre değişir, muhasebe/hukuk onayı olmadan "yasal fatura" denmemeli. e-Fatura entegratörü ayrı bir ticari sözleşme ister.

### BL-03 — Abonelik iptali
- **Alan (panelde nerede, kim kullanır):** Faturalandırma › Abonelik › "Aboneliği iptal et" (neden seçimi, sonuçlar listesi, yazarak onay) ve "İptali geri al". Yalnızca Kurucu.
- **Mevcut kod karşılığı:** `api/services/billing/subscription-service.ts` (`canceled` durumu var, akış yok). Model `prisma:2206-2223` `Subscription` (`currentPeriodEnd`). Salt-okuma kapısı `api/plugins/license-gate.ts`. Veri saklama ayarı `web/features/settings/DataRetention.tsx`. Dönem kapatma işi `jobs.ts:268`.
- **Eklenecek / değişecek yerler:**
  - Prisma: `subscriptions`'a `cancel_at_period_end BOOLEAN DEFAULT false`, `canceled_at`, `cancel_reason`.
  - Contract/API: `POST /billing/subscription/cancel`, `POST /billing/subscription/resume` (`minimumRole: 'owner'`). Dönem sonunda iptali uygulayan zamanlayıcı adımı (dönem kapatma işine). Sağlayıcı tarafında da iptal (BL-01). Kurucuya e-posta.
  - Web: iptal akışı, sonuçlar ("dönem sonunda salt-okunur olur, 30 gün dışa aktarabilirsiniz"), dışa aktarma bağlantısı.
  - Testler: rol kontrolü (Yönetici iptal edemez), dönem sonu geçişi, geri alma, 30 gün sonrası silme planlaması.
- **Kodlama mantığı:**
  - İptal anında yalnızca işaret konur. Dönem sonunda durum `canceled` olur ve lisans kapısı salt-okumaya geçer (deneme bitişiyle aynı mekanizma).
  - Dönem bitene kadar "geri al" mümkündür. Sonrasında yeniden abonelik yeni satın alma sayılır.
  - 30 gün sonra veriler kiracının saklama ayarına göre silinir (karar 1). Lisans yükümlülüğü için daha uzun saklama seçen kiracıda süre ona göre uzar. Silme mevcut retention sweep'iyle yapılır.
  - Tüm adımlar denetim kaydına yazılır. İşlemler idempotenttir.
  - İade yapılmaz (karar 2). Yıllık plan istisnası elle yönetilir.
- **Kabul kriterleri:**
  - Kurucu iptal eder, dönem sonuna kadar her şey çalışır, dönem sonunda çalışma alanı salt-okunur olur.
  - Dönem bitmeden "geri al" iptali kaldırır.
  - Yönetici rolü iptal ucunu çağıramaz (403).
  - İptalden 30 gün sonra silme planlanır ve dışa aktarma bu süre içinde çalışır.
- **Riskler / notlar:** iGaming lisansları destek kayıtlarının yıllarca saklanmasını isteyebilir. Kiracı iptal etse de saklama yükümlülüğü operatörde kalır. Silme öncesi tam dışa aktarma imkânı bu yüzden şart.

---

## 13. Güvenlik, altyapı ve UX dersleri (GV)

### GV-01 — Widget'ta kötüye kullanım koruması
- **Alan (panelde nerede, kim kullanır):** Widget (oyuncu; normalde görünmez, şüphede doğrulama kutusu), `Ayarlar → Güvenlik → Kötüye kullanım koruması` (Yönetici: üye başına AI sınırı, doğrulama modu), Home ve AI performans ekranında kota göstergesi (Yönetici ve Kurucu).
- **Mevcut kod karşılığı:**
  - İstek sınırları: `apps/api/src/plugins/rate-limit.ts` (Redis kayan pencere; müşteri token'ı 60/dk, anonim IP 30/dk; Redis yoksa "açık" kalır).
  - Günlük AI tavanı: `apps/api/src/services/ai/ai-daily-budget.ts` (workspace ve platform; Postgres'te, `ai_budget_*` SECURITY DEFINER fonksiyonları; `AiDailyCapError` → ziyaretçi yolunda mesaj insana kalır), `apps/api/src/plugins/ai-budget.ts`.
  - Spam filtresi yalnız sohbeti açan mesajda: `apps/api/src/services/security/spam-filter.ts`, çağrı `apps/api/src/routes/customer.ts:687+`.
  - Token ucu her yeni ziyaretçi için müşteri satırı açıyor: `apps/api/src/routes/auth.ts:1697-1709`.
  - Açık risk kayıtları: `docs/production-checklist.md` "Known risks"; `docs/adr/pilot-public-readiness.md` K-e(5) ("CAPTCHA yok").
  - Ortam ayarları ve canlı ortam kontrolleri: `apps/api/src/config/env.ts` (`productionProblems`).
- **Eklenecek / değişecek yerler:**
  - **env:** `CAPTCHA_PROVIDER = mock | turnstile | none`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; `PILOT_MODE` açıkken `turnstile` ve anahtar zorunluluğu `productionProblems`'a eklenir.
  - **Prisma + migration:** `ai_customer_daily_usage (license_id, customer_id, day, ai_turns, llm_tokens)` PK + RLS (ya da mevcut `ai_daily_usage`'a "müşteri" kapsamı); `security_settings.ai_turns_per_customer_day INT NOT NULL DEFAULT 40`, `security_settings.captcha_mode TEXT NOT NULL DEFAULT 'risk'` (`off` | `risk` | `always_on_chat_start`); `customers.challenge_passed_at`.
  - **contract:** `paths/customer-chat.yaml` ve `paths/auth.yaml` — `challenge_required` hata ayrıntısı (`details.reason`, `site_key`), isteklerde isteğe bağlı `challenge_token`; `paths/settings.yaml` yeni ayarlar.
  - **api:**
    - Risk değerlendirmesi token basımında ve sohbet açılışında. Örnek sinyaller: aynı IP'den 10 dakikada çok sayıda yeni müşteri, dakikada çok mesaj, AI turu / insan mesajı oranı. Sayaçlar Redis'te; Redis yoksa yalnız "doğrulama iste" kararı devre dışı kalır, kota kontrolü Postgres'te kalır.
    - Sağlayıcı adaptörü `apps/api/src/services/security/captcha.ts` (Turnstile doğrulaması + sahte sağlayıcı).
    - AI yolunda, `reserve`'den önce üye başına günlük tur kontrolü (Postgres'te tek ifadeyle artır-ve-kontrol et; mevcut `ai_budget_*` kalıbı).
    - Kota dolunca: mevcut insan yolu + ajanlara iç not ("AI günlük kotası doldu") + `ai_decision_logs` kaydı (`decision = cap_reached`).
    - Kotanın %80'inde Kurucu ve Yöneticilere günde bir kez bildirim.
  - **widget:** yalnız `challenge_required` gelince Turnstile betiği tembel yüklenir, kutucuk gösterilir, istek token'la tekrarlanır. iframe CSP ve sandbox'ın `challenges.cloudflare.com`'a izin vermesi gerekir. 8 dilde metinler.
  - **web:** ayar bölümü (`settings-sections.ts`, scope `access_rules`); kota göstergesi.
  - **testler:** birim (risk eşikleri), entegrasyon (aynı üyenin 41. AI turunda AI cevap vermez ve sohbet insana kalır; sahte sağlayıcıyla geçerli ve geçersiz doğrulama; %80 bildirimi günde bir kez), e2e widget doğrulama akışı (sahte sağlayıcı).
- **Kodlama mantığı:**
  - Katmanlar: (1) üye başına günlük AI turu, (2) IP/ağ hız sınırları (mevcut), (3) yalnız riskte doğrulama, (4) workspace ve platform tavanı (mevcut).
  - Doğrulamayı geçen üye `challenge_passed_at` ile belirli bir süre (ör. 12 saat) tekrar sorulmaz. İmzalı kimlikle doğrulanmış üye (ID-03) hiç sorulmaz.
  - Doğrulama sağlayıcısına ulaşılamazsa sohbet açılır (oyuncu insana ulaşabilsin), ama o ziyaretçiye AI cevabı verilmez.
  - Erişilebilirlik: doğrulama kutusu klavye ve ekran okuyucuyla kullanılabilir olmalı.
- **Kabul kriterleri:**
  - Normal bir ziyaretçi (düşük hız, tek oturum) hiçbir zaman doğrulama görmez.
  - Aynı IP'den kısa sürede eşik üstünde yeni ziyaretçi açan script'e doğrulama istenir; doğrulamasız token ya da sohbet açılamaz.
  - Bir üye günde 40 AI turunu aşınca AI susar, sohbet insan kuyruğuna gider ve ajan notu görünür.
  - Workspace kotası %80'e ulaşınca Kurucu ve Yöneticiler o gün bir kez bilgilendirilir.
  - Geliştirme ve testte gerçek sağlayıcıya ağ çağrısı yapılmaz (sahte sağlayıcı).
- **Riskler / notlar:**
  - Türkiye'de mobil operatörlerin çoğu çok sayıda kullanıcıyı aynı IP arkasında topluyor (CGNAT). IP tabanlı eşikler cömert olmalı; yoksa gerçek oyuncular toplu halde doğrulamaya düşer.
  - Turnstile Cloudflare'e veri gönderir; KVKK aydınlatma ve çerez/izin metinleri kontrol edilmeli.
  - Token basımındaki "her yeni ziyaretçiye müşteri satırı" davranışı bu maddede değişmez; şişirme riski hız sınırı ve doğrulamayla azaltılır.

### GV-02 — Kalıcı AI iş kuyruğu
- **Alan (panelde nerede, kim kullanır):** Ekranda doğrudan yok. Ajan ekranında "AI yanıtı gecikti, insana devredildi" iç notu; yönetici `/health` çıktısında kuyruk derinliği (platform operatörü).
- **Mevcut kod karşılığı:**
  - Bellek içi sıra: `apps/api/src/services/chat/follow-ups.ts` (`FollowUps`: anahtar başına sıra, `MAX_FOLLOW_UPS_PER_KEY = 20`, "Not durable, on purpose", yeniden deneme yok), eklenti `apps/api/src/plugins/follow-ups.ts` (kapanışta boşaltma).
  - Kuyruğa alma: `apps/api/src/routes/customer.ts:342-389` (`followUp` → `respondToCustomerMessage`: önce kural botu, sonra `ai.handle`, sonra atanan kişiye bildirim).
  - AI yanıtı: `apps/api/src/services/ai/ai-responder.ts` (`handle`, `:48`).
  - Yeniden kullanılabilecek kalıp: `apps/api/src/services/webhooks/redelivery.ts` (koşullu "talep et", süreli kilit, ölen işçinin işinin süre dolunca yeniden alınması, kiracılar arası okuma için SECURITY DEFINER sayıcı); `WebhookDelivery` modeli (`schema.prisma:2048+`).
  - Zamanlayıcı ve lider kilidi: `apps/api/src/services/scheduler/scheduler.ts`, `lock.ts`.
  - Risk kaydı: `docs/production-checklist.md` "Known risks" (PLAN §D201).
- **Eklenecek / değişecek yerler:**
  - **Prisma + migration:**
    - `ai_jobs`: `id`, `license_id`, `organization_id`, `chat_id`, `thread_id`, `trigger_event_id`, `kind` (CHECK `visitor_message`), `state` (CHECK `pending | running | done | expired | failed`), `attempts`, `available_at`, `lease_until`, `created_at`, `started_at`, `finished_at`, `outcome`, `last_error`, `request_id`.
    - Tekil `(license_id, trigger_event_id, kind)`; indeks `(state, available_at)`; RLS (lisans).
    - SECURITY DEFINER `ai_jobs_claim(p_limit, p_lease_seconds)`: `FOR UPDATE SKIP LOCKED`, sohbet başına sıra (aynı sohbette süresi geçerli `running` iş varsa o sohbetten alma; her sohbetten en eski `pending`). `ai_jobs_settle(...)`.
  - **api:**
    - Ziyaretçi mesajının yazıldığı **aynı işlemde** iş satırı eklenir. `ChatService.sendEvent` / `start` kendi `withTenant` işlemlerini açtığı için bunlara isteğe bağlı bir "aynı işlemde yaz" (outbox) kancası eklenir.
    - Yeni işçi `apps/api/src/services/ai/ai-job-worker.ts`: API sürecinde eklentiyle başlar; 500 ms yoklama + `LISTEN/NOTIFY` (ekleme sonrası `NOTIFY`) ile düşük gecikme; işler `withTenant` içinde çalışır.
    - `follow-ups.ts`'in AI dalı bu işçiye taşınır; kural botu ve atanan bildirimi de aynı işte, bugünkü sırayla kalır.
    - `/health` (yönetici ayrıntısı) çıktısına `ai_jobs: { pending, oldest_age_s }`.
  - **testler:** entegrasyon (iş, mesajla atomik yazılır; işçi durdurulup yeniden başlatılınca yanıt bir kez gönderilir; iki işçi aynı işi alamaz; sohbet içi sıra; süre aşımı yolu; RLS); `apps/api/test/integration/visitor-follow-ups.test.ts` uyarlanır.
- **Kodlama mantığı:**
  1. **Tazelik:** işi çalıştırmadan önce `now - created_at > 120 sn` ise `expired`: iç not yazılır, sohbet insan yönlendirmesine bırakılır (zaten kuyruktaysa dokunulmaz), karar kaydı `expired` yazılır.
  2. **Uygunluk:** bağlantı hâlâ aktif mi, insan devraldı mı (AI-11), kota var mı (GV-01) kontrol edilir; değilse `done` + uygun `outcome`.
  3. **İdempotens:** AI cevabı `properties.reply_to_event_id = trigger_event_id` taşır. Göndermeden önce bu özellikte bir olay var mı bakılır; varsa iş `done`. Bugünkü "aynı mesaja iki kez cevap yok" garantisi böyle korunur.
  4. **Çökme:** süre dolan `running` iş yeniden alınır (en çok 2 deneme); idempotens kontrolü çift cevabı engeller.
  5. **Sınır:** bir sohbette 20'den fazla bekleyen iş varsa yeni iş `expired` yazılır (bugünkü sınırın kalıcı karşılığı).
  6. **Kapanış:** yeni iş alınmaz, çalışanlar `SHUTDOWN_DRAIN_MS` içinde bitirilir; bitmeyenler süre dolunca başka süreçte devam eder.
  7. Çok turlu AI (AI-03) geldiğinde iş, tek mesaja değil konuşmanın o anki durumuna cevap üretir (geçmiş AI-01'den okunur); arka arkaya gelen iki mesaj için ilk iş çalışırken ikinci bekler.
- **Kabul kriterleri:**
  - API süreci, AI işi bekleyen bir mesajdan hemen sonra zorla durdurulup yeniden başlatılırsa oyuncu cevabı **bir kez** alır (120 sn içinde) ya da süre geçtiyse konuşma insana devredilmiş ve iç not yazılmış olur.
  - Aynı mesaja hiçbir koşulda iki AI cevabı gitmez (iki işçiyle eşzamanlı test).
  - Aynı sohbette mesajların cevapları geliş sırasıyla üretilir.
  - Normal yükte mesaj yazımından AI işinin başlamasına kadar geçen süre p95 < 1 sn.
  - `/health` kuyruk derinliğini ve en eski bekleyen işin yaşını gösterir.
- **Riskler / notlar:** Yoklama veritabanına ek yük getirir (NOTIFY ile azaltılır). Outbox kancası ChatService'in işlem sınırlarına dokunduğu için **[MAX]** dikkat ister. Atanan kişiye bildirim e-postalarının da kalıcılaşması ayrı bir adım olarak planlanabilir.

### GV-03 — Davet akışının kötüye kullanımının engellenmesi
- **Alan (panelde nerede, kim kullanır):** `Team → Davet et` penceresi (Yönetici), davet kabul sayfası `/join` (davetli), davetliye giden doğrulama e-postası.
- **Mevcut kod karşılığı:**
  - `apps/api/src/routes/account-lifecycle.ts:650-729` (`/auth/invitations/preview`, `/auth/invitations/accept`), `:788-860` (`POST /invitations`: kabul bağlantısını yanıtta döndürür, teslim edilemeyenleri listeler).
  - `apps/api/src/services/auth/lifecycle-service.ts:538-608` (`acceptInvitation` → SQL `auth_accept_invitation(token_hash, name, password_hash, trial_days)`; yeni hesapta ad ve şifre bağlantıyla belirleniyor).
  - `Account.emailVerifiedAt` varsayılanı `now()` (`schema.prisma:231`); davetle açılan hesap doğrulanmış sayılıyor.
  - Kayıt için e-posta doğrulama akışı mevcut (`SIGNUP_EMAIL_VERIFICATION`; `lifecycle.requestEmailVerification`, `account-lifecycle.ts:641`).
  - Ekran: `apps/web/src/features/team/InviteTeammates.tsx` (bağlantı kopyalama ve teslim edilemeyenler).
  - Risk kaydı: `docs/production-checklist.md:835-837`.
- **Eklenecek / değişecek yerler:**
  - **SQL fonksiyonu (migration):** `auth_accept_invitation` yeni hesap oluşturduğunda `email_verified_at = NULL` yazar (mevcut hesap yolu, şifre istemeye devam eder).
  - **api:** kabul yanıtı, yeni hesapta oturum yerine `{ verification_required: true }` döner ve davet edilen adrese doğrulama e-postası gönderilir (kayıttaki mekanizma). Girişte doğrulanmamış hesap, kayıttaki gibi reddedilir. Doğrulama sonrası `account.email_verified` denetimi. Workspace başına günlük davet sınırı (ör. 50, aşımda 429 `limit_reached`). İsteğe bağlı: `accept_url` yanıtta yalnız e-posta teslim edilemediğinde döner.
  - **contract:** `paths/account-lifecycle.yaml` kabul yanıtına `verification_required`; davet uçlarına sınır hatası.
  - **web:** `/join` sayfasında "E-postanı doğrula" durumu; davet penceresinde günlük sınır mesajı.
  - **testler:** entegrasyon (davet eden kişi kopyaladığı bağlantıyla şifre belirlese bile hesap doğrulanmadan giriş yapamaz; davetli e-postadaki bağlantıyla doğrular ve girer; mevcut hesap yolu değişmez; günlük sınır); e2e `auth-mail.spec.ts` kalıbıyla (`apps/e2e/tests/mailbox.ts`).
- **Kodlama mantığı:** Bağlantıya sahip olmak "davet edildim" demektir; "bu adresin sahibiyim" demek değildir. Sahiplik yalnız o adrese giden kodla kanıtlanır. Koltuk artışı (`seatEffect`) kabulde mi doğrulamada mı olacağı karara bağlanmalı; öneri: doğrulamada (doğrulanmamış hesap koltuk tüketmesin).
- **Kabul kriterleri:**
  - Yönetici, davet bağlantısını kullanarak başka birinin adresi için şifre belirlerse hesap oluşur ama giriş yapılamaz; davet edilen adrese doğrulama e-postası gider.
  - Davetli e-postadaki bağlantıyı açınca giriş yapabilir ve workspace'e katılmış olur.
  - Zaten hesabı olan kişinin davet kabulü bugünkü gibi şifre ister ve hemen tamamlanır.
  - Günlük 51. davet reddedilir.
  - Doğrulanmamış davet hesabı, kayıt temizleme işine benzer şekilde süresi dolunca temizlenir (ya da süresiz bekler; karar ADR'de).
- **Riskler / notlar:** Doğrulama e-postası günlük posta tavanına takılabilir; kayıttaki "güvenlik rezervi" kuralı burada da uygulanmalı. Koltuk ve faturalama davranışı değişeceği için `invite-seats.test.ts` güncellenmeli.

### GV-04 — Panelin dar ekranlarda kullanılabilir olması
- **Alan (panelde nerede, kim kullanır):** Öncelikle Inbox (liste, transkript, yanıt, devralma), devir kartı (AI-10), zaman çizelgesi (ID-09), onay ve QA kuyrukları (AI-20, AI-24). Ekip Lideri ve Yönetici telefondan; Ekip Üyesi tabletten.
- **Mevcut kod karşılığı:**
  - `apps/web/src/components/NarrowScreenNotice.tsx:23` (`NARROW_SCREEN_MAX = 1024`), `:26` (`localStorage` "yine de devam et"), `:49-61`; kullanım `apps/web/src/components/AppShell.tsx`.
  - Inbox üç bölmeli düzen: `apps/web/src/features/inbox/InboxPage.tsx`, `DetailsPanel.tsx` (daraltılabilir), `ThreadHeader.tsx` (`narrow` özelliği).
  - Dar ekran e2e testi: `apps/e2e/tests/narrow-screen.spec.ts`; tasarım token'ları `apps/web/src/styles/tokens.css`.
  - Mobil uygulama: `apps/mobile` (yalnız İngilizce, sınırlı yönetim).
- **Eklenecek / değişecek yerler:**
  - **web:** kırılım noktaları: ≥1280 üç bölme; 1024–1279 üç bölme, detay paneli varsayılan kapalı; 768–1023 iki bölme (liste + transkript), detay ve Copilot alttan açılan sayfa; <768 tek bölme yığın ve geri düğmesi. Composer altta sabit; dokunma hedefleri en az 44 px. Uyarı bandı rota bazlı: `NavDestination`'a ya da rota tanımına `responsive: true` işareti eklenir; uyarı yalnız henüz uyarlanmamış ekranlarda çıkar.
  - **testler:** Playwright'ta 375×812 ve 768×1024 projeleri; Inbox, zaman çizelgesi ve onay ekranları için akış testleri; axe taraması; kanıt ekran görüntüleri `apps/e2e/kanit/`.
- **Kodlama mantığı:** Önce en kritik akış: telefonda sohbeti aç → oku → yanıtla ya da devral → devir kartını gör. iOS'ta klavye açılınca composer'ın görünür kalması için `visualViewport` dinlenmeli. Sanal liste dokunmatik kaydırmada test edilmeli. Ayar ekranları ilk aşamada tek sütun düzeniyle yetinebilir.
- **Kabul kriterleri:**
  - 375 piksel genişlikte bir Ekip Lideri sohbeti açıp yanıt yazabilir ve devralabilir; yatay kaydırma yoktur.
  - 768 piksel genişlikte Inbox iki bölmeli çalışır; detay paneli açılıp kapanır.
  - Uyarlanmış ekranlarda "masaüstü için tasarlandı" bandı çıkmaz; uyarlanmamışlarda çıkar.
  - Hedef ekranlarda axe taraması kritik hata vermez.
- **Riskler / notlar:** Inbox bileşenleri büyük ve durumlu; düzen değişikliği regresyon riski taşır (mevcut inbox e2e testleri dar görünümde de koşmalı). Mobil uygulamanın Türkçeleştirilmesi ayrı bir iştir.

### GV-05 — Kişisel verinin URL'lerde olmaması
- **Alan (panelde nerede, kim kullanır):** Bütün panel ve widget; geliştirme kuralı. Kullanıcıya görünen bir ekran yok.
- **Mevcut kod karşılığı:**
  - Sunucu: `apps/api/src/lib/log-redact.ts:152-153` (`SENSITIVE_QUERY_KEY`: `email`, `query`, `token`… maskelenir; `q` yok), `:176-179` (`logSafeUrl`), `:191-195` (`requestPath`: izlere sorgu kısmı gitmez); `apps/api/src/server.ts:232-243` (`req.url` maskelemesi).
  - Panel adresleri: `apps/web/src/features/customers/CustomersPage.tsx:115-131` (`?customer=<uuid>` okunup silinir), `:140-146` (koşul filtreleri adrese yazılır: ülke, tarih, ticket var mı; kişisel veri yok); Inbox `?chat=`; `ThreadHeader.tsx` bağlantı kopyalama `?chat=`; `AuditLogPage.tsx:373-386`.
  - Widget: ziyaret edilen sayfalar ve geliş adresi kaydediliyor (`apps/api/src/routes/customer.ts:768-771`, `customerDirectory.recordPageView`); operatör sayfalarının adreslerinde kişisel veri olup olmadığı ve sorgu kısmının saklanıp saklanmadığı **doğrulanmadı**.
- **Eklenecek / değişecek yerler:**
  - **denetim aracı:** `scripts/audit/url-pii.mjs` (salt-okuma; mevcut `scripts/audit/*` kalıbı, CI'a bağlı): `setSearchParams`, `navigate(`, `href=`, `URLSearchParams.set` çağrılarında `email`, `name`, `username`, `phone`, `query`, `q`, `search` anahtarlarını yakalar.
  - **web:** arşiv ve palet aramaları bileşen durumunda (gerekirse yalnız `#` parçasında; sunucuya ve başka sitelere gitmez); panel `index.html`'ine `<meta name="referrer" content="strict-origin-when-cross-origin">` (ya da daha sıkı) — mevcut değer kontrol edilmeli; üçüncü taraf bağlantılarında üye numarası ve e-posta taşınmaz.
  - **api:** ziyaret edilen sayfa adreslerinin ve geliş adresinin saklanmadan önce sorgu kısmından arındırılması ya da `maskPii` + hassas anahtar maskelemesiyle saklanması (mevcut durum doğrulandıktan sonra); dışa aktarmalar `POST` ve kısa ömürlü imzalı indirme bağlantısıyla.
  - **testler:** denetim aracının kendi testi; ziyaret kaydında `?email=` içeren sayfa adresinin maskelenmiş saklandığı entegrasyon testi.
- **Kodlama mantığı:** Adrese yalnız rastgele numaralar (Thread/Chat ID, UUID) ve kişisel olmayan filtreler (tarih, ekip numarası, etiket numarası) yazılır. Üye UUID'si panel içinde kalabilir ama dışarıya giden hiçbir bağlantıya eklenmez (ID-03: bu numara token almakta anahtar gibi çalışıyor). Arama metni kişisel veri sayılır.
- **Kabul kriterleri:**
  - Denetim aracı CI'da yeşil; kuralı ihlal eden örnek kod eklenince kırmızı.
  - Arşivde e-posta ya da kullanıcı adıyla arama yapıldıktan sonra tarayıcı adresinde ve geçmişinde bu metin yoktur.
  - Panelden dış bir siteye tıklandığında giden `Referer` yalnız köken içerir.
  - Operatör sayfasının adresindeki `email=` değeri ziyaret kaydında açık halde saklanmaz.
- **Riskler / notlar:** AR-02'deki "filtreler adreste" isteğiyle çatışmaz; yalnız serbest metin adres dışında kalır. Ziyaret adresi temizliği, kampanya ve hedef eşleşmelerinde sorgu kısmına dayanan kurallar varsa onları etkileyebilir (`services/campaigns/*`, `services/goals/*` kontrol edilmeli).

### GV-06 — Tutarlı kaydetme kalıbı
- **Alan (panelde nerede, kim kullanır):** Bütün ayar bölümleri (`/app/settings/:section`), ekip ve profil formları, Playbook formları; özellikle yetki matrisi (RL-02), AI uyum kuralları (AI-08), veri saklama. Yönetici ve Kurucu.
- **Mevcut kod karşılığı:**
  - `apps/web/src/lib/dirty-guard.tsx` (`useLeaveGuard` `:98`, `shouldWarnOnLeave` `:87`, `confirmLeave` `:129`, `useCloseGuard` `:46`); tek kullanıcı `apps/web/src/features/playbook/SkillEditor.tsx:279`.
  - `apps/web/src/features/settings/SettingsNav.tsx:181-229` (`NavLink`'ler kirli form onayı istemiyor).
  - Anında kaydeden kontrol: `apps/web/src/features/settings/Tags.tsx:90-93` (ekip kapsamı `PATCH`).
  - Form altyapısı: `apps/web/src/lib/form.ts` (`useForm`, doğrulayıcılar, `preventDefault`).
- **Eklenecek / değişecek yerler:**
  - **web:**
    - `apps/web/src/components/settings/SettingsForm.tsx` + `SaveBar.tsx`: yapışkan çubuk; "Kaydedilmemiş değişiklikler", Kaydet / Vazgeç; temizken ya da hatalıyken Kaydet pasif. `useLeaveGuard` bağlı; `SettingsNav` bağlantıları `confirmLeave` çağırır.
    - `InstantToggle`: yalnız kişisel tercihler için; görsel olarak farklı, "Kaydedildi" bildirimi ve geri al.
    - `ConfirmHighRisk` penceresi: değişiklik farkı + zorunlu gerekçe; gerekçe denetim kaydı metadata'sına `reason` olarak gider.
    - `Tags.tsx` ekip kapsamı düzenleme penceresine ve Kaydet'e taşınır.
    - Ayar bölümleri sırayla `SettingsForm`'a geçirilir (WG-14 ile birlikte).
  - **api:** yüksek riskli ayar uçları (`PUT /settings/permissions`, uyum kuralları, saklama süresi) gövdede `reason` kabul eder ve denetim kaydına yazar.
  - **testler:** her ayar bölümünü çizip `SaveBar` ya da `data-save-pattern="instant"` işaretini arayan birim testi (yeni bölümler kalıba uymazsa kırılır); e2e: kirli formdan başka bölüme geçerken onay penceresi; yüksek riskli değişiklikte gerekçe zorunluluğu.
- **Kodlama mantığı:** Kural basit: sunucuyu değiştiren ve başkalarını etkileyen her şey "Kaydet" ister; yalnız kendini etkileyen ve geri alınabilen tercih anında kaydedilebilir. Yüksek riskli ayarlarda onay penceresi atlanamaz. Hata durumunda form verisi korunur (LiveChat dersi: hata ile boş durum karışmamalı).
- **Kabul kriterleri:**
  - Herhangi bir ayar bölümünde değişiklik yapıp kaydetmeden başka bölüme geçmeye çalışınca onay penceresi çıkar; "Vazgeç" seçilirse değişiklikler korunur.
  - Etiket ekip kapsamı artık Kaydet'e basılmadan değişmez.
  - Yetki matrisinde Kaydet → fark özeti → gerekçe → onay sırası zorunludur; gerekçe denetim kaydında görünür.
  - Kalıp testi, `SaveBar` ya da anında kayıt işareti olmayan yeni bir ayar bölümünde kırılır.
- **Riskler / notlar:** Bölümleri tek tek taşımak mekanik ama geniş bir iştir; WG-14 ile aynı iş paketinde yapılmalı. Mevcut e2e testleri anında kayıt varsayıyorsa (`settings.spec.ts`) güncellenmeli.

