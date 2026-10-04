# Task ID: 228

**Title:** V8-FORM-PLACE [OPUS-XHIGH] Forms builder: ticket + prospect yerlesimi (FR-MOD-08.7.7)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD dort yerlesim sayiyor (pre-chat/post-chat/ticket/prospect) ve KK 'contact/ticket'a yazma' diyor. Kod FORM_PLACEMENTS = ['pre_chat','post_chat'] ve servis form alanini contact entity'siyle sinirliyor: ticket ve prospect formlari yok, ticket'a yazma yolu yok.

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
PRD `:636`: "Forms builder (PRE-CHAT/POST-CHAT/TICKET/PROSPECT; alan builder)" · KK: "En az bir alan;
tip validasyon; widget'ta gosterim -> CONTACT/TICKET'A yazma; SiyahTuş: yas/sorumlu-oyun onayi".
Kod `packages/types/src/custom-fields.ts:32`: `export const FORM_PLACEMENTS = ['pre_chat',
'post_chat'] as const;` — IKI yerlesim. Servis form alanini `contact` entity'siyle sinirliyor.
`#### K08.7.7` (PLAN.md ~6165) denetim maddesi: "Iki bosluk: (1) YERLESIM eksik — FORM_PLACEMENTS
yalnizca ['pre_chat','post_chat'] (custom-fields.ts:32); PRD'nin saydigi 'ticket' ve 'prospect'
formlari yok ve servis form alanini contact entity'siyle sinirliyor (custom-field-service.ts:128-129),
yani ticket[…]". PLAN satiri 661, `Should (v1)`.
NOT: post-chat ayagi ARADA TESLIM EDILDI (`apps/widget/src/api.ts` `post_chat_form` +
`widget.postchat.test.ts`) — §D114'un "0 eslesme" bulgusu artik gecerli DEGIL. Kalan pay ticket +
prospect.

(b) DOKUNULACAK DOSYALAR:
- `packages/types/src/custom-fields.ts` — `FORM_PLACEMENTS` + `CUSTOM_FIELD_ENTITIES`.
- `apps/api/src/routes/custom-fields.ts` (`:26`, `:33` `z.enum(FORM_PLACEMENTS)`).
- `apps/api/src/services/.../custom-field-service.ts` — entity sinirlamasi.
- `apps/api/prisma/schema.prisma` + GENISLET-ONLY migration — mevcut CHECK kisiti KORUNUR
  (`custom-fields.ts:29-30` yorumu: "post-chat answers land on the same contact the pre-chat ones
  do — which a CHECK in the migration enforces"); ticket yerlesimi bu kisiti BOZMADAN eklenmeli.
- `apps/widget/src/api.ts` + `widget.ts` — yerlesim tuketimi (pre/post ZATEN var).
- `apps/web/src/features/settings/` — forms builder ekrani.

(c) CONTRACT-FIRST SIRA: sozlesme (`FORM_PLACEMENTS` + entity sozlugu) -> migration
(genislet-only) -> backend + integration -> `contract:generate` -> widget/web -> e2e.

(d) BILINEN TUZAKLAR:
- MEVCUT CHECK KISITI: post-chat cevabi pre-chat ile AYNI contact'a dusuyor ve bunu bir CHECK
  zorluyor. `ticket` yerlesimi baska bir entity'ye yaziyorsa kisit YENIDEN TASARLANMALI —
  dusurup yeniden kurmak yerine genislet-only bir kosul yaz; mevcut satirlari GECERSIZ KILMA.
- Uygulanmis bir migration'i duzenlemek bu depoda TOLERE EDILIR (`migrate deploy` checksum
  kontrol etmiyor) ama TERCIH EDILEN yol yeni bir genislet-only migration'dir.
- `prospect` PRD'de gecen ama bu depoda karsiligi belirsiz bir kavramdir: once TANIMINI PRD
  satirindan turet ve §C'ye yaz (lead/prospect ayrimi `13.3` huni predikatlariyla CELISMEMELI).
- Pre/post-chat DAVRANISI DEGISMEZ — regresyon testiyle sabitle (`widget.postchat.test.ts` yesil).
- Widget boyut butcesi (NFR-P3: 51.200 B) asilmamali.

(e) KAPSAM SINIRI: custom fields CRUD semasi (08.7.6) yeniden yazilmaz, yalniz genisler ·
ticket yasam dongusu DEGISMEZ · widget gorsel tasarimi DEGISMEZ · yas/sorumlu-oyun onayi
(SiyahTuş'a ozel KK payi) ayrica degerlendirilir, kapsam disi birakilirsa GEREKCESI yazilir.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi beklenmeyen diff YOK, `db:check-drift` "no drift" · `audit:req-coverage` exit 0 ve `FR-MOD-08.7.7` site sayisi ARTMIS. Integration: (1) DORT yerlesim de kabul ediliyor, bes'incisi 400; (2) `ticket` yerlesimli form yaniti TICKET'a yaziliyor; (3) pre/post-chat cevaplari hala AYNI contact'a dusuyor — mevcut CHECK kisiti REGRESYON yesil; (4) eski satirlar migration sonrasi GECERLI kaliyor; (5) CROSS-TENANT negatif ZORUNLU. Widget: `widget.postchat.test.ts` REGRESYON yesil + yeni yerlesim testi; widget bundle NFR-P3 butcesi (51.200 B gzip) ASILMADI. Web unit: forms builder dort yerlesimi sunuyor. e2e: ticket formu doldur -> ticket'ta gorun (kanit PNG). `prospect` tanimi §C'ye yazildi.
