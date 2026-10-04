# Task ID: 242

**Title:** V8-STORE-DEPLOY [OPUS-XHIGH] M-STORE'un DAGITIM ayagi — Helm charti hala STORAGE_PROVIDER: local + maxReplicas 4

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** PLAN §7.2 `M-STORE` satiri `◐ → KM-STORE` kaliyor. tm 177 (a/b/c/d) S3 uyumlu `ObjectStore`u, MinIO'yu, cok-pod dogrulamasini ve iki saglayicili guvenlik paritesini teslim etti ve `done` — ama denetimin D6 bulgusu bir DAGITIM durumudur ve o durum degismedi: `infra/helm/siyahtus/values.yaml:391` hala `STORAGE_PROVIDER: local`, uc bilesende `maxReplicas: 4` (79/118/166), paylasilan volume yok. tm 177 kapandigi icin bu dikisin sahibi kalmamisti.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §3. Sinirlar `CLAUDE.md` —
**PRODUCTION DEPLOY YOK, DNS/TLS YOK, GERCEK SECRET YOK.** Bu gorev MANIFEST yazar, deploy ETMEZ
(emsal: `M-IAC` / tm 164, "Dagitim manifestleri, deploy YOK").
PLAN satiri: §7.2 `| M-STORE |` · kanit blogu `#### KM-STORE` (`grep -n '^#### KM-STORE' PLAN.md`).
PLAN.md ~2,3 MB — BASTAN SONA OKUMA. `#### KM-STORE`nin SON iki maddesi bu gorevin girdisidir.

(a) OLCULEN DURUM (tm 212 · 2026-09-07 · bugunku dosyaya karsi):
- `infra/helm/siyahtus/values.yaml:391` → `STORAGE_PROVIDER: local`
- ayni dosya satir 79 · 118 · 166 → `maxReplicas: 4` (api · rtm · web)
- ayni dosya satir 220-221 → yorum **YANLIS**: "STORAGE_PROVIDERS only has 'local' today —
  apps/api/src/services/storage/object-store.ts". `s3` tm 177.1'de eklendi; manifest kendi
  hakkinda bayat bir sey soyluyor ve o yorum backup CronJob'inin gerekcesini tasiyor.
- Uretilen hata deponun KENDI kontrol grubunda olculu: `apps/api/test/integration/two-pod.test.ts`
  `local-a`/`local-b` cifti — yukleyen pod **200**, oteki pod **404**, ve `attachment_url` tasiyan
  olay oteki pod'da **400 "a file this workspace uploaded"** ile reddediliyor. 400 yeniden
  denenmez ve 4xx kimseyi uyandirmaz: D6'nin pahali yarisi budur.
- Yetenek tarafi hazir: `STORAGE_S3_*` (7 anahtar) `env.ts` + `.env.example` +
  `.env.production.example` + `turbo.json` globalEnv uclusunde, parite nobetcisi
  (`env.parity.test.ts`) yesil; `s3-store.ts` SigV4'u AWS'in kendi test vektorlerine karsi pinli
  ve gercek MinIO'ya karsi kosuldu (tm 177.3).

(b) YAPILACAK IS (uc parca, ucu de manifest/dokuman):
1. `values.yaml` (ve `values.production.example.yaml`) storage hikayesini DURUST hale getir.
   Iki mesru secenek var, karar gerekce ile yazilir:
   (i) varsayilani `s3`e al ve `STORAGE_S3_*`i Secret/ConfigMap'ten besle — `templates/secret.yaml`
       BUGUN SABIT 8 ANAHTAR listeliyor (generic `range` degil; tm 164.4'un kendi notu), yani yeni
       anahtarlar icin o sablon degismeli ya da onerilen dis-secret-yoneticisi yolu belgelenmeli;
   (ii) `local` kalsin ama o zaman `api.hpa.maxReplicas` **1** olmali ve gerekcesi yazili olmali —
       bugunku kombinasyon (local + 4 replika) kirik olan tam olarak odur.
   `values.production.example.yaml`in `config`/`secrets` bolumleri `.env.production.example` ile
   ayni disiplini tasir: gercek secret YOK, her satir placeholder ya da uretim talimati.
2. Satir 220-221'deki bayat yorumu duzelt (backup CronJob'inin gerekcesi buna dayaniyor: "there is
   nothing durable for this CronJob to archive" cumlesi `s3` secildiginde artik dogru degil —
   yuklemeler kovada, veritabani dump'i ayri).
3. `docs/production-checklist.md`e karsilik gelen madde: yuklemeler paylasilan depoda mi.

(c) BILINEN TUZAKLAR:
- `helm template`/`helm lint` ile RENDER EDILEREK dogrulanir; "yaml gecerli" yetmez.
- MinIO `storage` PROFILI arkasindadir (`docker-compose.yml` + `docker-compose.full.yml`): duz
  `docker compose up` / `make dev` / `make demo` onu HIC gormez. Bunu bozma.
- Profil servislerini kaldirirken `docker compose down -v` KULLANMA — proje kapsamlidir, `db`/
  `redis` volume'larini da dusurur; `stop` + `rm -f -v <service>`.
- `STORAGE_PROVIDER=local` **gelistirici varsayilani olarak KALMALI** (tm 177.2'nin kabul
  kriteri): CI'i ve yerel akisi bozma. Degisen sey yalniz DAGITIM manifestidir.

(d) KAPSAM SINIRI: urun kodu (storage servisleri, `attachment.ts`, testler) DEGISMEZ — tm 177 onu
bitirdi. Bu gorev manifest + dokuman isidir. Gercek bir kova/bulut hesabi ACILMAZ.

(e) KAPANIS: §7.2 `M-STORE` satiri `✅ → KM-STORE`; kanit `#### KM-STORE` blogua APPEND edilir
(var olan maddeler silinmez). commit + push + Task Master `done`.

**Test Strategy:**

Olcut manifestin kendi hakkinda dogru olmasidir: (1) `helm template` ile RENDER edilmis cikti api/rtm pod'larina secilen saglayiciyi ve gerekli `STORAGE_S3_*` anahtarlarini fiilen veriyor (grep ile dogrulanir, goz ile degil); (2) `helm lint` exit 0; (3) `values.yaml`in storage yorumu koda karsi DOGRU — `STORAGE_PROVIDERS` sozlugu ile karsilastirilarak; (4) secilen yol (i) ise `templates/secret.yaml`in sabit anahtar listesi yeni anahtarlari kapsiyor ya da dis-yonetici yolu belgelenmis; secilen yol (ii) ise `maxReplicas: 1` ve gerekcesi yazili; (5) `apps/api/test/integration/two-pod.test.ts` degismeden yesil (kontrol grubu dahil) — urun davranisi degismedi; (6) `docker compose config --services` profilsiz `db redis` donduruyor, yani MinIO hala opt-in; (7) tam DoD kapisi (CONVENTIONS §1) exit code'lariyla.
