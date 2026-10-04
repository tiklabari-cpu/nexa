# Task ID: 177

**Title:** M-STORE — Paylasilan nesne deposu — NFR-R1 stateless ihlali bugun uretimde kiriliyor

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Yuklemeler pod-yerel diske gidiyor (`LocalStore`, `STORAGE_LOCAL_DIR`), `attachment.ts:36` capraz-pod eki REDDEDIYOR ve Helm charti ayni poda `maxReplicas: 4` HPA takiyor. Yani yatay olcek altinda ek indirmeleri rastgele basarisiz olur.

**Details:**

PRD satır **768-777** (NFR-R1) · denetim `prd-uyum-denetimi.md` §3 D6.

**Genişleme noktası HAZIR:** `ObjectStore` arayüzü (`services/storage/object-store.ts`) `put`/`get`/`exists` ile var; `createObjectStore` fabrikası `STORAGE_PROVIDERS` enum'u üzerinden seçiyor ve kodun kendi yorumu bunu öngörüyor: *"the exhaustive form is what makes adding `s3` to the enum later a compile error here"*.

**Çağrı yerlerine dokunulmaz:** `routes/chats.ts:93`, `routes/customer.ts:203`, `routes/uploads.ts:63` zaten fabrikadan geçiyor. Üçünü de değiştirmen gerekiyorsa tasarımı yanlış kurmuşsundur.

**Test Strategy:**

Kalem bütününün kabul kriteri: iki API örneği ayakta; birinden yüklenen ek diğerinden indirilebiliyor, ve `virus-scanner.ts` fail-closed davranışı ile `upload-url.ts` imzalı PUT akışı her iki sağlayıcıda da aynı.

## Subtasks

### 177.1. M-STORE-a [OPUS-MAX] BÖLÜNMEZ: S3 uyumlu ObjectStore — güvenlik sınırları ve hata yolları

**Status:** done  
**Dependencies:** None  

`services/storage/s3-store.ts`. `STORAGE_PROVIDERS`'a `s3` ekle → fabrika switch'i derleme hatası verir, oradan doldur. Env `STORAGE_S3_*` (`config/env.ts:426-428` yanına); gerçek secret YOK. **Korunacak garantiler:** `attachment.ts` `exists` kontrolü bir güvenlik sınırıdır (verilmiş ama kullanılmamış anahtara işaret eden `attachment_url`'i reddeder) — S3'te aynı kesinlikte çalışmalı; **ağ hatası ile "yok" karışmamalı**, `exists` ağ hatasında `false` dönerse güvenlik kontrolü sessizce açılır; `local-store.ts` yol kaçışı doğrulamasının S3 karşılığı anahtar doğrulamasıdır (`../` kabul edilmez).

**Details:**

Bağımlılık: yok. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 177.2. M-STORE-b [SONNET-XHIGH] MinIO servisi (iki compose dosyası) + bucket bootstrap + geliştirici talimatı

**Status:** done  
**Dependencies:** None  

`docker-compose.yml` ve `docker-compose.full.yml`. `siyahtus-*` adlandırma deseni, port çakışması yok (db 5433, redis 6380 kullanılıyor). Bucket servis hazır olunca mevcut olsun. **Varsayılan `STORAGE_PROVIDER=local` KALMALI** — mevcut geliştirici akışını ve CI'ı bozma, S3 opt-in. `docker compose config` geçerli.

**Details:**

Bağımlılık: M-STORE-a. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 177.3. M-STORE-c [OPUS-XHIGH] Çok-pod ek doğrulaması: pod A yükler, pod B indirir

**Status:** done  
**Dependencies:** None  

Kalemin asıl iddiası bu; testsiz düzeltme düzeltme sayılmaz. Desen: `apps/rtm/test/integration/two-pod.test.ts` iki örnek kaldırıp aralarındaki davranışı doğruluyor. İçerik ve content-type korunur; `attachment.ts` doğrulaması B üzerinde de geçer. `STORAGE_PROVIDER=local` ile aynı senaryonun **neden geçmediğini** belgelendir — testin gerçekten bir şey ölçtüğünün kanıtı. Helm `maxReplicas: 4` durumunu HANDOFF'a yaz.

**Details:**

Bağımlılık: M-STORE-b. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 177.4. M-STORE-d [OPUS-MAX] BÖLÜNMEZ: virüs taraması + imzalı URL güvenlik paritesi (local ↔ s3)

**Status:** done  
**Dependencies:** None  

Depolama değişikliği sessiz bir güvenlik gerilemesi olmamalı. **Yalnız güvenlik testlerini** iki sağlayıcıda parametrik koş (tüm yükleme süitini ikiye katlama — kapı süresi). Korunacak: fail-closed AV (tarayıcı cevap veremiyorsa dosya kabul EDİLMEZ), imzalı PUT (geçersiz imza / süresi geçmiş / yeniden kullanım reddi), izin verilen tür ve boyut sınırları, `nosniff`. İki sağlayıcıda sonuç farklıysa parite yok demektir ve kalem tamamlanmamıştır.

**Details:**

Bağımlılık: M-STORE-b. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
