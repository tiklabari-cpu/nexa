# Task ID: 167

**Title:** M-SEC-e [OPUS-MAX] Faz-6 salt-okuma güvenlik denetimi (STRIDE): production konfig · proxy hop · nginx başlıkları · drenaj · replika yolu · IaC secret yüzeyi — bulgular görev olur, ürün kodu YAZILMAZ

**Status:** done

**Dependencies:** 159 ✓, 160 ✓, 162 ✓, 164 ✓

**Priority:** medium

**Description:** Faz-6 nın dokunduğu yüzeyler düşman gözüyle okunur. tm 142 (M-SEC-a) ve tm 157 (M-SEC-d) emsali: bu görev DENETLER, DÜZELTMEZ. High bulgular Task Master a ayrı görev olur (öncelik high; critical KULLANILMAZ — CONVENTIONS §4.1); Medium/Low PLAN §D ye yazılır. Denetimin ikinci yarısı olarak kusur BULUNMAYAN yerler de ismen raporlanır.

**Details:**

NE YAPILACAK: Faz-6 nın ürettiği yapılandırma ve manifest yüzeyleri STRIDE ile okunur.
Odak noktaları:
- TRUST_PROXY_HOPS (tm 159.2): yanlış değerle IP allow-list baypas edilebiliyor mu; env den gelen
  değer doğrulanıyor mu (negatif/absürt sayı); varsayılan güvenli tarafta mı.
- nginx güvenlik profili (tm 159.2): widget in iframe izolasyonu (NFR-S6) CSP ile KIRILDI mı;
  panel in frame-ancestors ı gerçekten kapalı mı; HSTS in yerel http yığınını bozmadığı doğrulandı mı.
- CORS çoklu origin (tm 159.2): liste ayrıştırma fail-closed mu; boş/hatalı girdi her origin i açıyor mu.
- Zarif drenaj (tm 160.2): kapanış sırasında yetkilendirme atlanan bir pencere doğuyor mu;
  scheduler kilidi bırakılırken başka bir sürecin işini yarıda kesme riski var mı.
- /health ayrımı (tm 160.1 + 151.2): live ucu bilgi sızdırıyor mu; ready ucu anonim mi olmalı.
- Read-replica yolu (tm 162.3): replika istemcisi siyahtus_app ile mi bağlanıyor (sahip rolüyle bağlanırsa
  RLS sessizce devre dışı kalır — tm 150 nin kapattığı sınıfın aynısı); kiracı bağlamı replika yolunda
  da kuruluyor mu; yazma sorgusu oraya sızabiliyor mu.
- IaC secret yüzeyi (tm 164): şablonlarda gerçek secret var mı; Secret manifesti base64 i "şifreleme"
  gibi sunuyor mu; values.production.example gerçek değer içeriyor mu.
- Yedek/prova (tm 165): yedek dosyası PII taşır — saklama yolu ve retention politikası NFR-C8 ile
  tutarlı mı; restore-drill in isim koruması gerçekten çalışıyor mu.

YÖNTEM (tm 142 ve tm 157 emsali): ÜRÜN KODU SIFIR SATIR DEĞİŞİR.
Rapor HANDOFF a: bulgular (High/Medium/Low) kaynak + kanıt + dosya:satır ile; ayrıca
DENETİMİN İKİNCİ YARISI olarak kusur BULUNMAYAN yerler ismen — bir denetimin değeri neyi elediğindedir.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-e** (türetilmiş — NFR-S1..S12 · v2-04 STRIDE). Gereksinim satırı: `grep -n "| M-SEC-e" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-e" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

- Kapı: typecheck · lint · format:check · build yeşil (kod değişmediği için FULL TURBO cache-hit beklenir;
  bu kusur değil KANIT — turbo nun girdi karması hiçbir kaynak dosyanın değişmediğini söylüyor).
- git diff --stat: yalnız PLAN.md · HANDOFF.md · .taskmaster/tasks/tasks.json.
- Çıktı: HANDOFF a bulgu raporu; her High için açılmış tm numarası; PLAN §7.2 M-SEC-e → "✅ → KM-SEC-e".
