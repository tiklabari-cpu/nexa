# Task ID: 142

**Title:** M-SEC-a [OPUS-MAX] Faz-3 + Faz-4 güvenlik denetimi (SALT-OKUMA): SAML/SCIM · bölge zorlaması · SIEM zinciri · entitlement · sandbox · mobil oturum/PKCE/deep-link · zamanlayıcı kilidi · sağlayıcı dikişleri — bulgular görev olur, kod bu pencerede DEĞİŞMEZ

**Status:** done

**Dependencies:** 128 ✓, 130 ✓, 131 ✓, 136 ✓

**Priority:** medium

**Description:** Faz-3 (kimlik federasyonu, bölge, denetim izi, yetki, sandbox) ve Faz-4’ün güvenliğe dokunan işleri (mobil giriş/SSO/deep-link/bildirim tıklaması, scheduler Redis kilidi, provider dikişleri, rol değiştirme UI’sı) tek tek pencerelerde yazıldı; hiçbir pencere hepsine birden düşman gözüyle bakmadı. Bu görev CONVENTIONS §5’e uyarak kod YAZMAZ: STRIDE tabanlı salt-okuma denetim yapar, bulguları Critical/High/Medium/Low + dosya:satır + düzeltme önerisiyle HANDOFF/PLAN’a yazar ve her Critical/High için Task Master’da yeni görev açar (priority high; `critical` DEĞİL — o panel akışına rezerve, CONVENTIONS §4.1).

**Details:**

KAPSAM (dosya listesi — hepsi okunur, hiçbiri değişmez): `apps/api/src/lib/{saml,saml-sp,sso-connection}.ts` ·
`routes/{scim,auth,sso*}.ts` · bölge: `plugins/*region*`, `lib/region*`, RTM `auth.ts` · audit/SIEM:
`services/audit/{audit-log,audit-chain,siem-*}.ts` · entitlement/sandbox: `services/billing/entitlements*`,
`services/sandbox*` · mobil: `apps/mobile/src/auth/*`, `app/{services,linking}.ts(x)`, `notifications/*`
(tm 128 sonrası) · scheduler: `services/scheduler/*` (tm 130 sonrası) · provider dikişleri (tm 131 sonrası) ·
rol UI (tm 136.2). Yöntem: STRIDE her yüzey için; özellikle: SAML XSW/replay/imza kapsamı · SCIM bearer
kapsamı + lisans sınırı · 421 bölge kararının üç yüzeyde tutarlılığı · audit zincirinin silme/yeniden sıralama
tespiti · entitlement downgrade sonrası okuma yolu · sandbox → üretim sızıntısı · mobil: verifier/state
yaşam döngüsü, deep-link ile açılan callback'in kötüye kullanımı, bildirim yükünde içerik yokluğu, secure-store
düşme yolu, refresh tek-uçuş yarışları · scheduler kilidinin sahiplik doğrulaması ve TTL · provider fabrikalarında
env ile "null" sağlayıcının üretimde seçilebilmesi (audit sessizleşir mi?). Çıktı: HANDOFF'a rapor (bulgu tablosu)
+ PLAN §D'ye `D11x` (bulgu özeti + açılan görev id'leri) + PLAN §7.2 `M-SEC` satırı `✅ → KM-SEC` (denetim
yapıldı anlamında; bulguların kapanışı açılan görevlerin işi) + Task Master'da her Critical/High için görev
(başlık `SEC-<n> [OPUS-MAX] …`, details'te bulgu + dosya:satır + kabul). Bulgu yoksa da rapor yazılır
("0 Critical/High" ölçülerek). Bu pencere `security-reviewer` gibi bir alt-ajan KULLANMAZ (CLAUDE.md tek
orkestratör) — kendi araçlarıyla okur.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SEC (türetilmiş — NFR-S1–S12 · v2-04 STRIDE)**. Gereksinim satırı: `grep -n '| M-SEC' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SEC' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 tablosunda `M-SEC` satırı bu turda `⬜ → KM-SEC` olarak açıldı.
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

- Kod değişikliği YOK (`git diff --stat` yalnız PLAN.md/HANDOFF.md/.taskmaster).
- HANDOFF'ta bulgu tablosu (severity · dosya:satır · saldırı senaryosu · öneri); PLAN §D kaydı; §7.2 `M-SEC` `✅ → KM-SEC`.
- Her Critical/High bulgu için Task Master görevi (id'leri HANDOFF'ta); Medium/Low için PLAN §D listesi.
- Denetim kapsamındaki dosya listesi HANDOFF'ta (okunduğu kanıtlansın).
