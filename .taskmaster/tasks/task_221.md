# Task ID: 221

**Title:** V8-SKILL-OWNER [SONNET-XHIGH] Playbook "sahip" filtresi insan sahibi suzsun (FR-MOD-05.4)

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Kabul kriteri 'Ada gore arama; tur/durum/sahip filtre'. Koddaki 'owner' sahip AJANDIR (ai_agent_id), PRD'nin kastettigi insan degil. Dosyanin kendi yorumu bunu acikca bir borc olarak yaziyor ama izleyen gorev yoktu.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2) — ve gecerli olan blogun SON maddesidir, ortadaki `◐` glifleri
tarihcedir.
KAYITLI KARAR ARAMASI (§D149un dersi): damgayi degistirmeden once `grep -n "D1[0-9][0-9] (" PLAN.md`
ile ilgili kodu ara ve `git log --oneline --since=2026-08-30` ile denetimden SONRA is yapilmis mi bak.
NUMARALANDIRMA: bu faz **8**dir — `Faz-7` §7Cnindir (tm 175-184). Onek `V8-`, `V7-` KULLANMA.

(a) GEREKCE + KANIT:
PRD `:559`: "Liste kontrolleri — Search / Sort / Filter" · KK: "Ada gore arama; tur/durum/SAHIP filtre".
Kod `apps/web/src/features/playbook/skill-filter.ts`:
- `:14-18` dosya yorumu BIREBIR: "'Owner' is the AI agent a skill belongs to (its ai_agent_id) ...
  The row also shows the human account that created the skill (FR-MOD-05.5, `created_by_name`),
  but that is a display fact, not a filter axis here — this 'owner' is deliberately the owning
  agent. CONFLATING THE TWO IS A SEPARATE, TRACKED GAP (FR-MOD-05.4), NOT FIXED HERE."
- `:66-71` `skillMatchesControls` -> `skill.ai_agent_id !== controls.owner`.
`#### K05.4` (PLAN.md ~8074) denetim maddesi ayni seyi soyluyor. PLAN satiri 616, `Should`.
Arama, durum ve siralama TAM — yalniz "sahip" ekseni yanlis seyi suzuyor.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/playbook/skill-filter.ts` (+ `skill-filter.test.ts`).
- `apps/web/src/features/playbook/PlaybookPage.tsx` — `:133` `useState<SkillOwnerFilter>('all')` ·
  `:233` `ownerOptions` · `:252` "secili sahip listeden dusunce" mantigi · `:106` `'All owners'`
  etiketi.
- `apps/web/src/locales/{en,tr}/playbook.ts` — iki eksen olursa iki etiket.
- `apps/web/src/features/playbook/types.ts` — `created_by_name` zaten var (FR-MOD-05.5);
  filtreleyebilmek icin sabit bir KIMLIK (`created_by_id`) gerekiyorsa sozlesmeye eklenir.

(c) CONTRACT-FIRST SIRA: `created_by_id` yaniten geliyor mu BAK; gelmiyorsa sozlesme -> backend ->
`contract:generate` -> saf filtre + tablo testi -> UI + unit.

(d) BILINEN TUZAKLAR:
- MEVCUT AJAN EKSENI KAYBEDILMEZ. Karar iki secenekten biridir ve `#### K05.4`e YAZILIR:
  (i) ikinci bir eksen eklemek (Agent + Owner ayri filtreler), (ii) "owner"i insana cevirip
  ajan eksenini "Agent" adiyla ayirmak. Sessizce anlam degistirme.
- Ada gore suzme YANLIS bir kimliktir (iki ajan ayni ada sahip olabilir, ad degisebilir) —
  `created_by_name` GORUNTU, filtre kimlik uzerinden olmali.
- `'none'` degeri bugun "ai_agent_id null" demek; insan ekseninde karsiligi (sistem/ silinmis
  hesap) ayrica dusunulmeli.
- `PlaybookPage.tsx:252`'deki "secili sahip listeden dusunce sifirla" mantigi yeni eksen icin de
  gerekli, yoksa filtre bos liste gosterip kilitlenir.

(e) KAPSAM SINIRI: sekme bolunmesi (`skill-tabs.ts`) DEGISMEZ · arama/durum/siralama DEGISMEZ ·
skill CRUD/editor DEGISMEZ · bulk import DEGISMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 (sozlesme degistiyse `contract:generate` sonrasi beklenmeyen diff YOK) · `audit:req-coverage` exit 0 ve `FR-MOD-05.4` site sayisi ARTMIS. Birim: `skill-filter.test.ts` tablo testleri — (1) insan sahibi ekseni KIMLIK uzerinden suzuyor (ad uzerinden DEGIL); (2) ajan ekseni hala calisiyor (REGRESYON — kaybedilmedi); (3) iki eksen BIRLIKTE daraltiyor; (4) `'all'` her ikisinde de her seyi geciriyor; (5) sahibi olmayan skill icin tanimli davranis. Web unit (`PlaybookPage`): secili sahip listeden dusunce filtre sifirlaniyor (kilitlenmiyor) + etiketler i18n'li + `i18n-coverage.test.ts` yesil. Karar (iki eksen mi, yeniden adlandirma mi) `#### K05.4` blogunda YAZILI olmali — bu gorevin belge kabul kriteridir.
