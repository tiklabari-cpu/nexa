# ADR-14a — Skill çok turlu prosedür olabilir (görsel akış yine yok)

- **Görev:** tm 269 (ADR-SKILL-PROCEDURE) · PLAN.md §0 (ADR-14a eki) · §D217
- **Tarih:** 2026-10-14
- **Durum:** Kabul edildi — sahip kararı **K8** (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı: "✅ Varsayılan onaylandı").
- **Değiştirdiği karar:** ADR-14 (PLAN.md §0) — lafzı aynen kalır, bu ek yalnız kapsamını genişletir. ADR tablosunun satırı değişmedi.
- **Bağlı görevler:** tm 296 AI-PROCEDURE-ENGINE (AI-03) · tm 321 AI-TOOL-SLOT-F1 (AI-28) · tm 322 (AI-28 F2, deferred).
- **Kod değişikliği:** yok. Bu dosya yalnız kararı kayda geçirir; uygulamayı tm 296 / tm 321 yapar.

## 1. Bağlam

ADR-14: _"Tek paradigma = **Skill** (adım listesi). `workflows` tablosu şemada kalır, UI YOK."_

Bugünkü Skill tek mesajda baştan sona koşan sıralı bir adım listesidir (2026-10-14 HEAD'de yeniden doğrulandı):

- Adım tipleri kapalı bir liste: `detect_intent`, `request_info`, `tag`, `summarize`, `send_message`, `transfer_to_team` (`packages/ai-mock/src/steps.ts:9-16`).
- `SkillEngine.run` (`apps/api/src/services/ai/skill-engine.ts:234`) adımları tek geçişte yürütür; `request_info` soruyu sorar ama cevabı okumaz (`skill-engine.ts:443-459`). Koşul, dallanma ve "cevabı bekle" yok.
- `skills.trigger` kolonu var ama hiçbir yerde okunmuyor (`apps/api/prisma/schema.prisma:1667`); `Workflow` modeli (`schema.prisma:1723-1736`, `nodes`/`edges`) ADR-14 gereği ölü.

AI-03 (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md` § AI-03) iGaming destek hacminin çoğunu oluşturan teşhis konuşmalarını ("param yatmadı": yöntem ve saati sor → beklenen süreyle karşılaştır → bekleme açıkla ya da dekont iste → çöz ya da finansa devret) ister. Bu tek mesajlık motorla kurulamaz. `SiyahTus-Analiz/05-uygulama-rehberi.md` §1.0 madde 4 "Kilitli kararlarla uzlaşma" tablosunun ilk satırı uzlaşmayı tarif eder; "Uygulayıcı için kurallar" madde 4 "kilitli karar sessizce delinmez, ilgili ADR'ye ek not yazılır" der. Bu dosya o ek nottur.

Piyasa aynı yöne gitti: Intercom Fin "Procedures", Ada "Playbooks", Decagon "AOP", Sierra "Journeys" — hepsi karar ağacı çizdirmek yerine düz yazıyla desteklenen yapılandırılmış adımlar kullanır (`SiyahTus-Analiz/kaynaklar/igaming-ai-arastirma.md` §1.2–1.3).

## 2. Karar

1. **Skill iki kipte olabilir:** `mode: 'single' | 'procedure'`. `single` bugünkü tek mesajlık davranıştır ve varsayılandır; mevcut skill'ler veri taşıması olmadan aynen çalışır.
2. **Adım listesi korunur.** Prosedür de sıralı bir adım listesidir — yeni bir kavram (akış, workflow, graf) açılmaz.
3. **Adımlara iki yetenek eklenir:**
   - **Koşul** — her adımda isteğe bağlı `when`, ayrıca dallanan `check` adımı (`then` / `else`, hedef adıma `goto`). Koşul dili sabit bir listedir (operatörler + sabit `fn` listesi); serbest ifade / `eval` yoktur, yeni `fn` yalnız kod değişikliğiyle eklenir.
   - **Cevap bekle** — `collect` adımı eksik bilgiyi sorar ve oyuncunun cevabını bekler (`step_status = 'awaiting_answer'`); sonraki tur kaldığı yerden sürer.
4. **`workflows` tablosu ve node/edge tuvali YOK.** `workflows` şemada ölü kalır (ADR-14 aynen), prosedür bu tabloya yazılmaz, görsel akış editörü yapılmaz. Düzenleyici bugünkü `SkillEditor` satır listesinin genişlemesidir.
5. **SOP'tan taslak yardımcısı serbest (K8).** "SOP metnini yapıştır, AI prosedür taslağı çıkarsın" yardımcısı (`POST /skills/compile`, `mode: 'procedure'`) ADR-14'ü delmez: çıktısı yine adım listesidir, kaydetme doğrulamasından geçer ve asla kendiliğinden etkinleşmez.
6. **Araç yuvası bir Skill adım tipidir, ayrı akış aracı değildir (AI-28).** "Burada hesap sistemden kontrol edilecek" yeri prosedürün içinde bir adımdır (05'te AI-28 bölümü `call_tool`, AI-03 bölümü `tool` diye anar; adı tm 296 / tm 321 sabitler). F1'de pasiftir: çalıştırılmaz, kayda düşer, devir kartında "kontrol edilmesi gereken" satırı olur. Aracı F2'de de model değil prosedür motoru deterministik olarak çağırır; bu, LLM ADR'sinin "tool/function calling — HAYIR" kararıyla (`docs/adr/pilot-llm-embedding-provider.md` §6) F1'de çelişmez, F2'de o ADR ayrıca yeniden açılır.

## 3. Sonuçlar

- **Uyumlu kalan:** ADR-14'ün iki sınırı — tek paradigma Skill, görsel workflow UI yok — aynen geçerli. `workflows` tablosuna dokunulmaz.
- **Genişleyen:** Skill'in adım sözlüğü kapalı altı tipten prosedür adımlarına (`say`, `collect`, `check`, `answer_from_knowledge`, `handoff`, `resolve`, `tag`, araç adımı) genişler; konuşma durumu (aktif prosedür, adım, toplanan bilgiler) turlar arasında saklanır. Tasarım ayrıntısı tm 296'nın işidir (`SiyahTus-Analiz/05-uygulama-rehberi.md` § AI-03 "Kodlama mantığı").
- **Tek motor:** `mode='single'` skill'ler prosedür yürütücüsünde bir adaptörle tek adımlı prosedür olarak koşar; iki ayrı motor bırakılmaz.
- **Bu eki delen bir değişiklik** (görsel tuval, `workflows` tablosunun canlanması, modelin aracı kendi seçip çağırması) yeni bir ADR eki ve sahip kararı ister.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — AI-03, AI-28 satırları.
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — Karar kaydı K8; § AI-03 "Kilitli kararla ilişkisi"; § AI-28 "Kilitli kararlarla uzlaştırma".
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — "Uygulayıcı için kurallar" madde 4; §1.0 madde 4 (uzlaşma tablosu) satır 1; § AI-03; § AI-28.
- `SiyahTus-Analiz/07-gorev-plani.md` — #269 Dalga 0.
