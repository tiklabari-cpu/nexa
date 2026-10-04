# Task ID: 170

**Title:** M-LOAD-CAP [OPUS-XHIGH] RTM pod'una bağlantı tavanı + geri-basınç: ölçülen tavanı pod'un kendisi bilsin ve uygulasın (tm 161.4 · §D127 bulgusu)

**Status:** done

**Dependencies:** 161 ✓

**Priority:** high

**Description:** Gateway hizmet veremeyeceği sayıda soketi kabul etmeyi bırakır; tavan yapılandırılabilir, aşımı adıyla reddedilir ve gözlemlenebilir.

**Details:**

NE YAPILACAK: tm 161.4'ün ölçümü bir tavan buldu, ama POD O TAVANI NE BİLİYOR NE UYGULAYABİLİYOR.

BULGUNUN KANITI (§D127 · #### KM-LOAD, tekrar ölçmene gerek yok):
- `apps/rtm/src`'te `MAX_CONN|maxConnections|CONNECTION_LIMIT` → 0 eşleşme. Bağlantı tavanı YOK.
- `apps/rtm/src/server.ts` `http.listen(env.RTM_PORT, env.RTM_HOST, cb)` — Node'un varsayılan
  backlog'u (511), açıkça seçilmiş bir değer değil.
- Ölçülen davranış: gateway kabul etmeye devam ediyor, bozulma SESSİZCE gecikmeye dönüşüyor.
  6000 alıcıya fan-out p99 466 ms (bütçe 500), 8000'de 599 ms + 60 bağlantı reddi — ve reddin
  sebebi bir kaynak tükenmesi değil, kabul ile fan-out'un aynı JS iş parçacığı için yarışması
  (fan-out kaldırılınca aynı 8000 basamağı `connect_failed 0` verdi).

NE İSTENİYOR (kapsam dar tut):
1. `RTM_MAX_CONNECTIONS` env (üçlü parite: `env.ts` ↔ `.env.example` ↔ turbo `globalEnv`;
   M-ENV deseni). Unset ise bugünkü davranış (sınırsız) DEĞİŞMEZ — sessiz bir regresyon
   üretmeden dikişi açmak esas.
2. Tavan aşıldığında upgrade ADIYLA reddedilir (M-OPS-b'nin `draining` reddiyle aynı yol:
   503 + gerekçe), sessizce kabul edilip gecikmeye dönüşmez. İstemci tarafı: web istemcisi
   kendi başlatmadığı her kapanışta zaten reconnect ediyor (NFR-R2) — reddin bu döngüyü
   sonsuz sıcak bir yeniden deneme haline GETİRMEDİĞİNİ doğrula.
3. Sayı gözlemlenebilir olsun: `/health` zaten eşzamanlı bağlantı sayısını veriyor
   (tm 161.3 `siyahtus_rtm_connections_observed` onu okuyor) — tavan da orada görünsün.
4. `http.listen(...)` backlog'u açıkça seçilir ve seçim gerekçesi yorumda yazılır.

KAPSAM DIŞI (bunlar BAŞKA görevlerin işi, tekrarlama):
- Metrik/telemetri yüzeyi → tm 163 (`M-OTEL-b`: eşzamanlı bağlantı sayısı · fan-out gecikmesi).
- HPA/PDB/kaynak sınırları, yani ölçek POLİTİKASI → tm 164 (`M-IAC`).
- Çapraz-pod fan-out doğrulaması → tm 162 (`M-SCALE-a`).
- `ws` → uWebSockets.js göçü: YAPILMAZ. MASTER-PROMPT'un kilitli stack kararı + §D124'ün
  kullanıcı kapsam kararı (mimari/sağlayıcı göçü Faz-5 ve Faz-6'nın DIŞINDA).

TUZAK: tavanı "ölçtüğümüz 6000" diye koda gömme. Ölçüm TEK organizasyonda, tek makinede,
k6 aynı CPU'da yapıldı; `fanout.ts` döngüsü `registry.forOrganization(...)` ile sınırlı olduğu
için gerçek çok-kiracılı bir podda mesaj başına maliyet daha küçüktür. Doğru teslim bir
YAPILANDIRILABİLİR tavan + adıyla reddetme, sabit bir sayı değil.

DOSYALAR: `apps/rtm/src/server.ts` · `apps/rtm/src/config/env.ts` · `.env.example` ·
`turbo.json` · `apps/rtm/test/integration/*` · gerekirse `apps/load/README.md`.

BAĞLAM (bu pencere sıfırdan açılır): TASK-RUNNER-PROMPT.md §0 sırası. Bulgunun tam gerekçesi
`grep -n 'D127' PLAN.md`; ölçüm kanıtı `grep -n '^#### KM-LOAD' PLAN.md`.

KAPANIŞ: PLAN §7.2 `P8` satırı bu görevle `✅` OLMAZ — P8'in kalan yarısı yatay ölçektir
(tm 162). Kanıt `#### KM-LOAD` bloğunun sonuna madde olarak eklenir (CONVENTIONS §1.2:
tablo hücresine kanıt YAZMA). DoD kapısı CONVENTIONS §1, exit code'larla.

**Test Strategy:**

- `RTM_MAX_CONNECTIONS` üçlü paritesi test edilir (env.ts ↔ .env.example ↔ turbo globalEnv), M-ENV deseniyle.
- Integration testi: tavan N'e ayarlanır, N+1'inci upgrade adıyla reddedilir (503 + gerekçe), N tanesi ayakta kalır.
- Unset ise davranış bugünküyle BİREBİR aynı (sınırsız) — bunu kilitleyen ayrı bir test.
- `/health` tavanı ve o anki sayıyı birlikte raporlar; `apps/load/scenarios/rtm.js` bu alanı okuyabilir.
- Reddedilen istemci sonsuz sıcak yeniden denemeye girmiyor (NFR-R2 ile etkileşim).
