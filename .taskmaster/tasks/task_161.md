# Task ID: 161

**Title:** M-LOAD — Yük ayağı (k6): NFR-M4 ün beşinci katmanı kurulur + NFR-P1/P2 doğrulanır + NFR-P8 (20k WS/pod) İLK KEZ ölçülür — ölçüme dayanmayan damga yazılmaz

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** NFR-M4 beş katman istiyor: unit · integration (testcontainers) · contract · E2E (Playwright) · LOAD (k6/Gatling). İlk dördü örnek düzeyde kurulmuş (3317 + 2541 + 5 + 205). Beşincisi depoda HİÇ YOK — k6, gatling, load-test aramaları sıfır sonuç. Sonuç: ürünün ölçek davranışı hiç ölçülmedi. NFR-P8 "~20k WS bağlantı/pod (uWebSockets.js)" diyor; apps/rtm Node un ws kütüphanesini kullanıyor (MASTER-PROMPT kilitli kararı, sapma değil) ama kapasite hiç ölçülmedi. NFR-P2 için tek bir uçta 43 ms medyan ölçüldü, YÜK ALTINDA değil. NFR-U1-U3 ün SLO ları da ölçülemedi.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124 bulgu 5 ve 6) — tm 156.3 (M-GUARD-c) bu iki borcu
PLAN §D ye "Faz-6 M-LOAD a atandı" diye yazdı. Bu kalem onu ödüyor.

KALEMİN VARLIK SEBEBİ §D122 NİN DERSİDİR: bir NFR damgası, onu ölçen komut fiilen koşmuyorsa
iddiadan ibarettir. Bu kalem ÖNCE ölçme aracını kurar, SONRA ölçer, EN SON damgayı yazar.
Ölçüm sonucu hedefi tutmuyorsa damga YALAN YAZILMAZ — gerekçeli bir hedef revizyonu (§D) ya da
yeni bir iş kalemi doğar (161.4 tam olarak bu karardır).

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar.

SINIR (CLAUDE.md): production deploy / DNS / TLS / gerçek secret YOK. Her kalem ya yerelde koşulabilir
ya --dry-run ile doğrulanabilir olmalı. Mock sağlayıcıları gerçeğe çekmek de KAPSAM DIŞI.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-LOAD** (türetilmiş — NFR-M4 (yük ayağı) · NFR-P1/P2/P8 · NFR-U1-U3). Gereksinim satırı: `grep -n "| M-LOAD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-LOAD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Dört alt-görev done. Ölçülebilir kapanış kanıtı:
1. apps/load koşulabiliyor (make load) ve eşikleri NFR bütçelerinden türüyor.
2. REST ve RTM senaryoları GERÇEK sayı üretiyor ve sayılar PLAN §7.2 ye yazılıyor.
3. NFR-P8 için bir SAYI var (tek pod da kaç eşzamanlı bağlantı) — hedef tutmuyorsa §D de gerekçeli revizyon.
4. PLAN §7.2 M-LOAD → "✅ → KM-LOAD"; P1/P2/P8 satırları ölçülmüş değerleri taşıyor.

## Subtasks

### 161.1. M-LOAD-a [OPUS-XHIGH] apps/load (k6) iskeleti: senaryo çerçevesi · oturum/tohum yardımcıları · eşikler NFR bütçelerinden · make load + README

**Status:** done  
**Dependencies:** None  

Yük testi koşulabilir bir hedef haline geldi.

**Details:**

NE YAPILACAK: yeni bir workspace paketi — apps/load.
- k6 senaryolarını barındırır (JavaScript; k6 kendi runtime ında koşar, Node değil).
- Oturum yardımcısı: tohumlanmış bir hesapla giriş yapıp erişim jetonu alan ortak modül
  (POST /auth/login → POST /auth/authorize → POST /auth/token akışı).
- EŞİKLER (k6 thresholds) NFR bütçelerinden TÜRETİLİR, elle uydurulmaz:
  NFR-P1 RTM fan-out p99 < 500 ms · NFR-P2 REST p99 < 300 ms yazma / < 150 ms okuma.
  Eşik aşılırsa k6 non-zero exit verir — yani yük testi bir KAPI olur, bir rapor değil.
- Makefile e load hedefi + apps/load/README.md: nasıl koşulur, hangi yığına karşı, sayılar nereye yazılır.
- pnpm-workspace.yaml zaten apps/* i kapsıyor; paketin kendi package.json ı olmalı ve kök
  typecheck/lint/test görevlerini KIRMAMALI (k6 kaynağı Node tiplerinde derlenmez —
  turbo görev listesinden uygun şekilde dışla ya da lint i k6 global larına göre yapılandır).

DOSYALAR: apps/load/ (yeni: package.json · README.md · lib/session.js · lib/thresholds.js) ·
Makefile (load hedefi) · turbo.json / eslint.config.js (yeni paketin kapı davranışı).
REFERANS: apps/e2e nin paket yapısı (kendi package.json ı, kök kapılarına nasıl katıldığı) ve
Makefile in mevcut hedef biçimi (## açıklama yorumları help çıktısını besliyor).

TUZAKLAR:
1. k6 BİR NODE PAKETİ DEĞİLDİR — kendi ikili dosyasıyla koşar. Kurulumu README de anlat; CI ya
   EKLEME (bu tur CI ya yük testi eklenmiyor, koşu elle tetiklenir). Bunu README de açıkça yaz.
2. Yeni paket kök kapılarını KIRMAMALI: pnpm -w typecheck / lint / build hâlâ exit 0 olmalı.
   Ölç, varsayma.
3. Yük testi GERÇEK bir yığına karşı koşar (make dev ya da make demo). Hangi yığın olduğunu
   README de sabitle; e2e ile AYNI ANDA koşulamaz (sabit portlar) — uyarıyı yaz.
4. Tohum verisi yük için yetersizse (161.2/161.3 fark eder) ihtiyacı burada DEĞİL, o alt-görevde çöz.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-LOAD** (türetilmiş — NFR-M4). Gereksinim satırı: `grep -n "| M-LOAD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-LOAD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 161.2. M-LOAD-b [SONNET-XHIGH] REST senaryosu: /chats liste + transcript + mesaj gönderme karışımı → NFR-P2 ölçümü (p99 < 300 ms yazma / < 150 ms okuma)

**Status:** done  
**Dependencies:** 161.1  

REST API nin yük altındaki gecikmesi ilk kez ölçüldü.

**Details:**

NE YAPILACAK: apps/load/scenarios/rest.js — gerçekçi bir ajan karışımı:
- Sohbet listesi okuma (GET /chats?view=...) — okuma bütçesi.
- Transcript okuma (GET /chats/{id}/events) — okuma bütçesi.
- Mesaj gönderme (POST /chats/{id}/events) — yazma bütçesi.
- Sanal kullanıcı sayısı kademeli artan bir profil (ramp-up), plato, ve düşüş.
Eşikler 161.1 in thresholds modülünden gelir; okuma ve yazma AYRI ölçülür (bütçeleri farklı).
Sonuç özeti makine-okunur bir dosyaya da yazılmalı (161.4 onu okuyacak).

DOSYALAR: apps/load/scenarios/rest.js · apps/load/lib/ (paylaşılan yardımcılar).
REFERANS: ADR-07 hız sınırları — agent 180/dk (burst 30). YÜK TESTİ KENDİ SINIRINA TAKILMAMALI:
ya tohumda birden çok ajan kullan ya yığını yükseltilmiş RATE_LIMIT_* ile koş (e2e nin
RATE_LIMIT_ANON_PER_MIN=500 emsali). Hangi yolu seçtiğini README ye yaz — aksi hâlde ölçtüğün şey
ürünün gecikmesi değil, kendi hız sınırının olur.

TUZAK: yazma senaryosu gerçek veri üretir ve veritabanını şişirir. Yük koşusu sonrası temizlik
yolunu README de anlat; siyahtus geliştirme veritabanını DROP ETME (CLAUDE.md sınırı), tohum sıfırlama yeterli.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-LOAD** (türetilmiş — NFR-P2). Gereksinim satırı: `grep -n "| M-LOAD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-LOAD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 161.3. M-LOAD-c [OPUS-XHIGH] RTM senaryosu: N eşzamanlı WS bağlantısı + fan-out gecikmesi → NFR-P1 doğrulaması ve NFR-P8 in İLK GERÇEK ölçümü (tek pod da kaç bağlantı)

**Status:** done  
**Dependencies:** 161.1  

WebSocket kapasitesi ve fan-out gecikmesi ilk kez ölçüldü.

**Details:**

NE YAPILACAK: apps/load/scenarios/rtm.js — WebSocket yük senaryosu.
- N sanal kullanıcı RTM e bağlanır (ws://.../v1/agent/rtm/ws), login olur, sohbetlere abone olur.
- Bir mesaj üretilir ve fan-out un aboneye ULAŞMA süresi ölçülür → NFR-P1 (p99 < 500 ms).
- Bağlantı sayısı kademeli artırılır ve TEK POD un nerede bozulduğu bulunur → NFR-P8 in ilk sayısı.
  "Bozulma" tanımı önceden yazılır: fan-out p99 bütçeyi aşıyor MU, bağlantı reddi başlıyor mu,
  bellek/CPU doyuyor mu. Tanımı yazmadan ölçme — yoksa sayı yoruma açık kalır.
- Reconnect + missed-event sync davranışı yük altında da çalışıyor mu (NFR-R2) gözlenir.

DOSYALAR: apps/load/scenarios/rtm.js · apps/load/lib/.
REFERANS: apps/rtm/test/integration/rtm.test.ts — protokol zarfı (ADR-15: {request_id, action,
payload} → {request_id, action, type, success, payload}), login akışı ve abonelik mesajları orada;
senaryo aynı zarfı kullanmalı, tahmin etmemeli.
ADR-07: RTM WS 10 msg/sn/bağlantı sınırı — senaryo bunu aşmamalı.

TUZAKLAR:
1. ÖLÇÜMÜN SINIRINI DÜRÜSTÇE YAZ: tek bir geliştirme makinesinde 20.000 soket açmak işletim sistemi
   sınırlarına (dosya tanıtıcı, efemeral port) takılır. Ulaşılan sayı ile ULAŞILAMAYAN sayının sebebi
   AYRI AYRI raporlanmalı — "20k a çıkamadık" ile "20k da ürün bozuldu" çok farklı iki sonuçtur.
   Bu ayrımı yapmayan bir rapor 161.4 ün kararını yanlış besler.
2. k6 nin WebSocket desteği (k6/ws ya da k6/experimental/websockets) sürüme bağlıdır; hangisini
   kullandığını README ye yaz.
3. RTM in Redis pub/sub üzerinden fan-out yaptığını unutma — ölçtüğün gecikme Redis i de içerir.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-LOAD** (türetilmiş — NFR-P1 · NFR-P8 · NFR-R2). Gereksinim satırı: `grep -n "| M-LOAD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-LOAD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 161.4. M-LOAD-d [OPUS-MAX] Ölçüm turu + KARAR: sonuçlar PLAN §7.2 ye yazılır; NFR-P8 hedefi tutmuyorsa gerekçeli hedef revizyonu (§D) ya da yeni iş kalemi — ölçüme dayanmayan damga yazılmaz

**Status:** done  
**Dependencies:** 161.2, 161.3  

Ölçülen sayılar plana girdi ve hedefle arasındaki fark karara bağlandı.

**Details:**

NE YAPILACAK: bu bir KARAR GÖREVİDİR, kod görevi değil (ya da çok az kod).
1. 161.2 ve 161.3 ün ürettiği sayılar toplanır ve koşu koşulları (donanım, profil, yığın türü)
   ile birlikte PLAN §7.2 nin ilgili NFR satırlarına yazılır: P1 · P2 · P8 (ve mümkünse U1-U3 için
   bir ilk gözlem).
2. Her hedef için ÜÇ sonuçtan biri seçilir ve GEREKÇESİ yazılır:
   (a) TUTUYOR → satır ölçülmüş değeriyle ✅.
   (b) TUTMUYOR ama ürün kusuru değil (ölçüm ortamının sınırı) → §D ye gerekçeli not, satır ölçüm
       koşuluyla birlikte damgalanır; hedef DEĞİŞMEZ.
   (c) TUTMUYOR ve ürün kusuru → §D ye gerekçeli HEDEF REVİZYONU (ör. ws kütüphanesiyle gerçekçi
       kapasite N dir; PRD nin uWebSockets varsayımı bu depoda geçerli değil) YA DA yeni bir iş kalemi
       Task Master a açılır (öncelik high; critical KULLANILMAZ — CONVENTIONS §4.1).
3. NFR-M4 satırının beşinci ayağı artık dolu — satırın metni güncellenir.

NEDEN OPUS-MAX: burada verilen karar PRD nin bir hedefini değiştirebilir. Yanlış karar iki yönde de
pahalıdır: gereksiz bir mimari değişiklik ya da kayıtsız bir kapasite yalanı.

DİSİPLİN: §D122 nin dersi burada uygulanır — ÖLÇÜLMEYEN HİÇBİR ŞEY DAMGALANMAZ.
PLAN §1.2: tablo hücresine kanıt yazma; hücre damga + referans taşır, sayılar K bloğuna gider.

DOSYALAR: PLAN.md (§7.2 satırları · §D yeni madde · #### KM-LOAD bloğu) · HANDOFF.md ·
gerekirse .taskmaster (yeni görev).

TUZAK: bu alt-görev ürün kodu YAZMAZ (ya da çok az). git diff büyükse kapsam kaymış demektir.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-LOAD** (türetilmiş — NFR-P1/P2/P8 · NFR-M4). Gereksinim satırı: `grep -n "| M-LOAD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-LOAD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
