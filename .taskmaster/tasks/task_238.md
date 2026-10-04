# Task ID: 238

**Title:** V8-RULEBOT [OPUS-MAX] Kural-tabanli bot (LLM'siz, AI Agent'tan ayri) — FR-MOD-06.6

**Status:** done

**Dependencies:** 211 ✓

**Priority:** medium

**Description:** PLAN satiri 06.6 `⬜` kaliyor: tm 211 triyaji "one cekilen v1 AI Agent bu payi karsiliyor" kapsam iddiasini koda karsi olctu ve iddia DUSTU — KK'nin iki maddesinin ikisi de karsilanmiyor. Bu gorev PRD'nin istedigi ayri, deterministik, LLM'siz kural botunu yazar ve gruplara priority ile atanmasini saglar.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §3. Sinirlar `CLAUDE.md`.
PLAN satiri: `grep -n '^| 06.6' PLAN.md` (~satir 328, §3.5) · kanit blogu `#### K06.6`
(`grep -n '^#### K06.6' PLAN.md`). PLAN.md ~2,3 MB — BASTAN SONA OKUMA.

(a) GEREKCE — tm 211'in olctugu sey (tekrar olcme, uzerine kur):
PRD `urun-gereksinim-dokumani-PRD.md`:577 → `FR-MOD-06.6 | Chatbot (kural-tabanli bot) —
deterministik akis/bot (AI Agent'tan AYRI, LLM'siz) | Should (MVP temel) | KK: "Kural bazli bot;
gruplara priority ile atanir" | Sema: §8 bots`.
tm 211 KK'yi iki maddeye ayirip koda karsi saydi; IKISI DE DUSTU:
  1. "Kural bazli bot" — depoda tek bot AI Agent'tir (`ai_agents` tablosu, `kind` = ai_agent|copilot).
     Cevap yolu `services/ai/skill-engine.ts` → `matchIntent` (@siyahtus/ai-mock) + RAG
     (`knowledge-service.ts` retrieval + `shapeAnswer`). Bu, MASTER-PROMPT §5'in "LLM icin
     deterministik stub"idir — yani stub oldugu icin deterministik, TASARIMI GEREGI degil.
     PRD "AI Agent'tan AYRI, LLM'siz" der; ayri bir motor YOK.
     `@@map("bots")` ve `model Bot ` → 0 eslesme (yeniden dogrulandi 2026-09-07).
  2. "gruplara priority ile atanir" — `GroupAgent` (`group_agents`) `priority String @default("normal")`
     TASIYOR, ama `agentId` bir `Account`tir ve `group-service.ts` `workspaceMemberIds()` ile
     `agent_memberships`e karsi dogrular; `AiAgent` bir Account DEGILDIR ve model uzerinde hicbir
     grup iliskisi yok. Yani BUGUN bir bot bir gruba hicbir priority ile atanamaz.
Ek olcum (bu gorevin isi DEGIL, ama tasarimda ise yarar): `skills.trigger` (jsonb) kolonunu HICBIR
kod okumuyor — `grep -rn "\btrigger\b" apps/api/src/services/ai apps/api/src/routes/playbook.ts` → 0.
Kural motorunun tetikleyicisi icin hazir bir kolon duruyor.

(b) PRD IC CELISKISI — karar vermeden once oku:
Satirin "Sema" sutunu `§8 bots` diyor, AMA PRD §8.4 (CLAUDE.md'ye gore sema icin TEK dogruluk
kaynagi, `rapor-2-teknik-mimari.md` §5.3 ile birlikte) `bots` diye bir tablo TANIMLAMIYOR.
§8.4'te `bot` yalnizca uc yerde bir DEGER olarak geciyor: `events.author_type` [agent/customer/bot/
system] · `webhooks.type` [license/bot] · `api_tokens.kind` [pat/oauth/bot]. Ayrica FR-MOD-04.6
("Chatbots / Suspended agents sekmeleri", `✅ → K04.6`) bot hesabini `ai_agents` uzerinden
karsilamis ve "bot=ai_agent, koltuk tutmaz" demis.
Yani yeni tablonun adi/sekli SERBEST DEGIL ama `bots` diye hazir bir DDL de yok — tasarim karari
bu gorevin ilk isidir ve PLAN'a `Assumption:` olarak yazilir (MASTER-PROMPT §4).

(c) SIRA (contract-first, MASTER-PROMPT):
1. KARAR + Assumption: bot varligi nerede yasar? Iki secenek gercekci:
   (i) ayri `bots` tablosu (PRD'nin satirina en yakin) + `bot_groups` (bot ↔ group, `priority`),
   (ii) `ai_agents.kind`'a ucuncu bir deger (`rule_bot`) + `ai_agent_groups` baglanti tablosu.
   Hangisi secilirse secilsin KK'nin ikinci maddesi (gruba priority ile atama) BIR BAGLANTI
   TABLOSU ister — `group_agents` yeniden kullanilamaz (`agent_id` → `accounts` FK).
   Karar gerekcesiyle PLAN §C'ye `Assumption:` olarak yazilir.
2. Sozlesme: OpenAPI (`packages/contract/openapi/paths/...`) + `@siyahtus/types` — bot CRUD + kural
   CRUD + gruba atama/priority. `pnpm -w contract:generate` sonrasi generated diff BOS olmali.
   TUZAK: yeni her OpenAPI yolu `apps/mobile` parite testinin sabit uc sayisini kirar
   (`parity.test.ts` `contractEndpoints`) — sayiyi yorumla birlikte bump et (mevcut yorum zinciri
   deseni orada yazili).
3. Migration (expand-only; CONVENTIONS §6.3) + RLS (license-scoped, `routing_rules`/`ticket_rules`
   deseni) + drift temiz (`pnpm -w db:check-drift`).
4. Backend: DETERMINISTIK motor. `@siyahtus/ai-mock`'a, embedding'e, RAG'a, `matchIntent`'e
   BAGIMLILIK YOK — bu satirin butun anlami budur. Emsal: `services/tickets/ticket-rule-matching.ts`
   (saf kosul/eylem eslestirici, `apply-ticket-rules.ts` uygular) ve `routing-service.ts`
   (`is_fallback ASC, priority ASC` siralamasi). Kosullar: mesaj metni (exact/contains/regex-siz
   kelime), sayfa URL'i, kanal, calisma saati gibi ucuz yuklemler; eylemler: mesaj gonder,
   etiketle, takima devret.
5. Devreye girme noktasi: `services/ai/ai-responder.ts` musteri mesajini AI'ya vermeden ONCE
   kural botunu dener (deterministik once, olasilikli sonra) — SIRA bir karardir, kod yorumunda
   gerekcesiyle yazilir. Musteri mesajinin once kalici olmasi kurali (ai-responder.ts dosya
   basligi) DEGISMEZ.
6. Frontend: Team → Chatbots sekmesi (`TeamPage.tsx`, K04.6) zaten var — bot listesi/kural editoru
   ve gruba atama (priority secici) buraya baglanir. `GroupAgent.priority`nin web'deki mevcut
   priority secicisi (`Teams.tsx`/`TeamMembers.tsx`) desen kaynagidir.
7. Test: saf eslestirici unit (negatifler once) + integration (kural → otomatik yanit; cross-tenant
   404; grup priority sirasi) + e2e (musteri mesaji → bot yaniti, LLM stub'i devrede DEGILKEN).
   Etiket bicimi CONVENTIONS §7: `(FR-MOD-06.6)`.

(d) BILINEN TUZAKLAR:
- ADR-14 ("Tek paradigma = Skill; `workflows` tablosu semada kalir, UI YOK") bu satiri KAPSAMAZ —
  o karar Skill ile Workflow arasindadir, kural botu ile AI Agent arasinda degil. ADR-14'u bu
  satiri kapatmak icin GEREKCE OLARAK KULLANMA; kullanmak istersen once ADR'yi genislet.
- `06.6` Faz-0'in TEK `⬜` satiridir ama `Should (MVP temel)`tir → §F.00'in `Must` sayacini
  BLOKLAMAZ (Faz-0 53/53 ile kapali). Aceleye getirme, dogru yap.
- Damga: is tam bitmezse `◐` + eksik yazilir; `✅` uydurulmaz (CONVENTIONS §1.2).

(e) KAPSAM SINIRI:
- AI Agent / Skill / Copilot yollarini YENIDEN YAZMA — kural botu onlarin YANINA gelir.
- `skills.trigger` olu kolonunun temizligi tm 215'in (V8-DEADEND) isidir, bu gorevin degil.
- Faz-8'in 21 kalemlik paydasi DEGISMEZ — bu gorev tm 211'in dogurdugu bir is kalemidir
  (emsal: tm 233-237), §6D tablosunun satir sayisina girmez.

(f) KAPANIS: PLAN.md satir 328 damgasi + `#### K06.6` maddesi + HANDOFF + commit + push +
Task Master `done` (CONVENTIONS §2/§3/§4).

**Test Strategy:**

Kapanis kriterleri, PRD:577'nin KK sutunu MADDE MADDE: (1) Kural botu AI Agent'tan AYRI bir varliktir ve calisma yolunda `@siyahtus/ai-mock` / embedding / RAG cagrisi YOKTUR — bu bir testle kanitlanir (motor modulunun import grafinde ai-mock bulunmaz, ya da motor bu bagimliliklar mock'lanmadan kosar). (2) Bir bot bir gruba `priority` ile atanabilir ve siralama gozlemlenebilir bir fark yaratir (integration: iki bot, farkli priority, hangisinin once denendigi). (3) Kural → eylem yolu uctan uca kosar (e2e: musteri mesaji → bot yaniti). (4) Cross-tenant negatifi: baska lisansin botu/kurali 404. (5) `pnpm -w db:check-drift` exit 0 · `contract:generate` sonrasi generated diff bos · `pnpm audit:req-coverage` exit 0. (6) Tam DoD kapisi (CONVENTIONS §1, §1.3'e gore parcalanabilir) yesil.
