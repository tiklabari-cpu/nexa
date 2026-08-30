# PRD ↔ Kod Uyum Denetimi — Nexa

**Denetleyen:** Claude (12 denetçi + 12 çürütücü ajan) · **Tarih:** 2026-08-30
**Girdi:** `urun-gereksinim-dokumani-PRD.md` (1419 satır) ↔ monorepo kaynak kodu (1493 TS/TSX dosyası, 7 app + 3 paket)
**Referans durum:** Task Master `master` etiketi — 174 task / 457 subtask, tamamı `done`

> Bu doküman `prd-yeterlilik-degerlendirmesi.md`'nin **tersidir**. O, PRD'nin kod yazmaya yetip yetmediğini sordu.
> Bu, yazılan kodun PRD'yi karşılayıp karşılamadığını soruyor.

---

## 1. Karar

**Ürün çalışır durumda ve çekirdeği gerçek; ama "bitti" değil — PRD'nin 247 gereksinim maddesinin 93'ü (%38) eksiksiz karşılanmış.**

Task Master'ın 174/174 `done` tablosu yanlış değil, **eksik ölçüyor**: planlanan işler bitmiş, fakat plan PRD'nin kabul kriterlerinin tamamını taşımamış. Aradaki fark tek bir cümlede özetlenebilir:

> **Gereksinimlerin çoğu %70–90 oranında karşılanıp son kabul kriterinde duruyor.**

Bu bir "yarım ürün" tablosu değil, **"son adımı atılmamış ürün"** tablosu. 141 `KISMİ` maddenin büyük kısmında altyapı, veri modeli ve backend mantığı hazır; eksik olan şey ekranın son düğmesi, sayacın doğru kaynaktan beslenmesi ya da testin gerçekten kriteri ölçmesi.

| Nihai verdict | Adet | Oran | Anlamı |
|---|---:|---:|---|
| **TAM** | 93 | %38 | Tüm kabul kriterleri kodda karşılanmış **ve** en az bir test koruyor |
| **KISMİ** | 141 | %57 | Ana akış var, kabul kriterlerinin bir kısmı eksik / test yok / ölü kod yolu |
| **YOK** | 13 | %5 | Kodda karşılığı bulunamadı |

Eyleme dönük çekirdek: **2 kritik + 61 "önemli"** madde. Kalan 64 `küçük` madde cila seviyesi.

---

## 2. Yöntem — ve neden bu sayılara güvenilebilir

İki turlu, adversaryal bir denetim çalıştırıldı:

**Tur 1 — Denetim (12 paralel ajan).** Her ajan PRD'nin kendisine atanan satır aralığını okudu, gereksinimleri madde madde çıkardı, sonra kaynak kodu ve testleri açarak `dosya:satır` kanıtıyla verdict verdi.

**Tur 2 — Çürütme (12 ajan, `high` effort).** Her birimin sonucu kendi muhalifine gitti. Muhalifin görevi `TAM` iddialarını yıkmaktı: kanıt dosyası gerçekten o şeyi mi yapıyor, stub/TODO mu, test `.skip` mi, sadece mutlu yol mu kodlanmış.

İki kural ajanlara sabitlendi: **`dist/` kanıt sayılmaz** (derlenmiş çıktı) ve **"Task Master done demiş" kanıt değildir** — kanıt yalnızca kaynak kodun kendisi.

### Çürütme turu neden gerekliydi

| Revizyon yönü | Adet |
|---|---:|
| TAM → KISMİ (düşürüldü) | **27** |
| KISMİ → YOK (düşürüldü) | 2 |
| KISMİ → TAM (haksız kırmızı düzeltildi) | 1 |

**İlk turun verdiği her beş `TAM`'dan biri ikinci turda çöktü.** Tek yönlü bir denetim çalıştırılsaydı tablo %49 TAM görünecekti — yani gerçekte olmayan 27 maddelik bir "tamamlandı" iddiası rapora girecekti. Bu, aynı zamanda Task Master'ın 174/174 tablosunun neden fazla iyimser olduğunun da mekanizması: tek turlu, kendi işini onaylayan bir kapı.

> **Not:** Revize edilen 30 maddenin `önem` alanı ilk turdan kalmadır (çoğu `yok` yazıyor çünkü ilk denetçi `TAM` demişti). Bu maddelerin önem derecesi yeniden triyaj gerektirir — Ek A'da `↓` ile işaretlendiler.

---

## 3. Yapısal desenler — asıl bulgu

Tek tek maddelerden daha önemlisi, boşlukların **rastgele değil, tekrar eden birkaç kök nedende** toplanması. Sekiz desen, 141 `KISMİ`nin çoğunu açıklıyor:

### D1. Omnichannel tek yönlü — *en ağır sistemik kusur*

`ChannelService.ingestInbound` hem girişte hem çıkışta kısa devre yapıyor:

- **Girişte:** gelen metin maskelenmeden ve spam süzgecinden geçmeden veritabanına yazılıyor. Yani CC maskeleme (`FR-MOD-08.9.5`) ve spam filtresi (`FR-MOD-08.9.3`) route katmanında duruyor, webhook yolu onu atlıyor.
- **Çıkışta:** `sendOutbound` repoda **yalnızca** `POST /channels/:type/messages` admin API'sinden çağrılıyor ([apps/api/src/routes/channels.ts:161](apps/api/src/routes/channels.ts:161)). Ajanın inbox composer'ından yazdığı cevap bu yolu **hiç** kullanmıyor.

Sonuç: **bağlanmış beş kanal (Twilio SMS, Instagram DM, Telegram, Messenger, e-posta) pratikte tek yönlü bir gelen kutusu besleyicisi.** Müşteri yazıyor, inbox'a düşüyor, ajan cevaplıyor — cevap müşteriye gitmiyor. e2e testleri bile bu adımı elle atmak zorunda kalmış.

Etkilenen maddeler: `08.5.5`, `08.5.7`, `08.5.8`, `08.9.3`, `08.9.5`.

### D2. Backend sağlam, ürün yüzeyi yarım

Neredeyse her birimde aynı asimetri: API katmanı ve veri modeli PRD'yi karşılıyor, `apps/web` son parçayı bırakıyor.

- `FR-02`: 19 maddenin 13'ü KISMİ, boşlukların **neredeyse tamamı** `apps/web` tarafında.
- `FR-05-06`: skill motoru, RAG (pgvector 1536, ivfflat cosine), doğal-dil derleyicisi gerçekten çalışıyor — ama şablon rozetleri (`Popular`/`Essential`) sadece veri olarak var, hiçbir bileşende render edilmiyor.
- **"API'de var, konsolda yok"** alt-deseni: Tags grup kapsamı API'de yazılıyor ama konsoldan ulaşılamıyor; PAT için `apps/web`'de tek satır yok; ticket routing kuralı oluşturma ekranı yok (`/settings/routing-rules` yalnızca GET+PATCH).

### D3. "Yüklenen pencere" gerçek toplam sanılıyor

Sayaçlar ve sıralamalar sunucuya değil, tarayıcıya yüklenmiş satırlara uygulanıyor:

- AI resolution sayacı yüklenmiş satırdan türüyor → **50 satırdan sonra sistematik olarak yanlış** (`FR-MOD-02.1.2`).
- Tickets grid sıralaması sunucuya gitmiyor; `/tickets` isteğinde `sort` parametresi yok (`FR-MOD-02.7`).
- Traffic sekme sayaçları yalnız yüklenmiş sayfalardan türüyor.

Bu, veri büyüdükçe **sessizce yanlışa dönüşen** bir sınıf hata — testler küçük fixture'larla yeşil kalıyor.

### D4. Şemada tablo var, kodda karşılığı yok (ölü tablo)

`workflows` tablosu ([apps/api/prisma/schema.prisma:1427](apps/api/prisma/schema.prisma:1427)) `nodes`/`edges` JSON kolonlarıyla duruyor ama **ölü**: repoda tek bir `prisma.workflow` okuma/yazması, tek bir route, tek bir kontrat yolu yok. Şemanın kendi yorumu bunu itiraf ediyor:

> *"The table exists so the schema matches PRD §8.4, but ADR-14 defers the editor to v2 — nothing writes here yet."*

Bu dürüst bir kayıt, ama PRD §5.5 görsel Workflow builder'ı **v2 ana teslimi** olarak listeliyor. Ayrıca `bots` tablosu hiç yok — kural tabanlı, LLM'siz bot motoru (`FR-MOD-06.6`) mevcut değil; Team sayfasındaki "Chatbots" bölümü `/ai-agents`'a yönlendirdiği için yanıltıcı.

### D5. Uyumluluk katmanı teknik olarak var, hukuki olarak yok

`NFR-C` ailesinde **12 maddeden 5'i YOK** — ve hepsi aynı sebepten: teknik dayanaklar (hard-delete sweep, log redaction, denetim izi, bölge zorlaması) mevcut, ama maddelerin **kendi adıyla saydığı çıktılar** repoda hiç yok:

- **GDPR (`NFR-C1`):** DPA / SCC Module 2 / UK Addendum metni yok, 10 günlük alt-işleyen bildirimi ve 5 günlük itiraz penceresi yok.
- **KVKK (`NFR-C2`):** `grep -rln 'KVKK|VERBIS'` yalnızca PRD ve analiz dosyalarını dönüyor — **TR hedef pazar olmasına rağmen** kodda tek karşılık yok.
- **CCPA/CPRA (`NFR-C3`), ISO 27001 (`NFR-C7`), alt-işleyen şeffaflığı (`NFR-C10`):** hiçbir karşılık yok.

Çürütücü burada bir kanıt hilesi de yakaladı: ilk denetçi `NFR-C1` için gösterdiği dört dosyanın hepsini **başka NFR satırlarından ödünç almıştı** (`retention.ts` → C8'in, `log-redact.ts` → S9'un, `audit-log.ts` → S12'nin kanıtı).

### D6. Stateless ihlali — üretimde kullanıcı-görünür

`NFR-R1` "stateless servisler" diyor. Dosya yüklemeleri **pod-yerel diske** gidiyor, `attachment.ts:36` çapraz-pod bir eki reddediyor — ve Helm chart'ı tam da bu poda `maxReplicas: 4`'lük bir HPA takıyor. Yani yatay ölçek altında **ek indirmeleri rastgele başarısız olur.** Paylaşılan nesne deposu (S3/MinIO) yok.

### D7. Test kriteri değil, dönüş kodunu ölçüyor

Birkaç yerde test var ama kabul kriterini korumuyor:

- `FR-MOD-07.4` deflection metriği `chat_transferred` olaylarını `reason` ayrımı yapmadan sayıyor → **insan-insan devirlerini AI devri gibi raporluyor.** İlgili test fixture'ı `reason`suz olay yazdığı için hatayı yakalayamıyor bile.
- `NFR-P6` "sabit zaman" hedefi için gösterilen iki test, sırasıyla başka bir sorgu şekli ve **başka bir tablo** üzerinde ölçüm yapıyor.

### D8. Kural tersine uygulanmış

`FR-MOD-06.1` readiness check: PRD "Knowledge boş **VEYA** hiç aktif skill yokken uyarı göster" diyor. Kod `ready = hasKnowledge || hasSkill` ([readiness.ts:42](apps/api/src/services/ai/readiness.ts:42)) — yani uyarı **yalnızca ikisi birden boşken** çıkıyor. Bilgi tabanı dolu ama hiç skill yokken AI Agent "hazır" görünüyor. Mantık operatörü ters.

---

## 4. Birim birim tablo

| Birim | Madde | TAM | KISMİ | YOK | TAM % | Kritik | Önemli |
|---|---:|---:|---:|---:|---:|---:|---:|
| SEMA-MIMARI — Veri modeli + mimari + fazlandırma | 26 | 15 | 9 | 2 | **58%** | 0 | 5 |
| FR-00-01 — Auth + Global Shell | 21 | 15 | 6 | 0 | **71%** | 0 | 2 |
| FR-08 — Settings / Omnichannel | 35 | 17 | 16 | 2 | 49% | 0 | 10 |
| FR-07-12 — Reports + Copilot | 14 | 6 | 8 | 0 | 43% | 0 | 2 |
| FR-09-10-11 — Marketplace + Billing + Widget | 20 | 8 | 12 | 0 | 40% | 0 | 4 |
| NFR-SEC-COMP — Güvenlik + Uyumluluk | 24 | 9 | 10 | 5 | 38% | 0 | 6 |
| FR-02 — Inbox / Chats | 19 | 6 | 13 | 0 | 32% | 0 | 7 |
| FR-03-04 — Customers + Team | 19 | 6 | 13 | 0 | 32% | **2** | 3 |
| FR-05-06 — Playbook + AI Agent | 19 | 4 | 14 | 1 | 21% | 0 | 7 |
| NFR-A11Y-I18N-OBS — Erişilebilirlik + i18n + gözlem | 16 | 3 | 12 | 1 | 19% | 0 | 2 |
| FR-13-EK — Engage/Goals/Workflow/Mobil + çapraz | 16 | 2 | 13 | 1 | 13% | 0 | 4 |
| NFR-PERF-SCALE — Performans + Ölçek + SLA | 18 | 2 | 15 | 1 | **11%** | 0 | 9 |
| **TOPLAM** | **247** | **93** | **141** | **13** | **38%** | **2** | **61** |

### En güçlü iki alan

**Auth (%71)** ve **veri modeli (%58)** denetimden neredeyse çizik almadan çıktı. Çürütücü, Auth'un **tüm** TAM iddialarını tek tek açtı ve hiçbirini yıkamadı: S256-zorunlu PKCE, yeniden kullanılan refresh token'da aile iptali, scrypt + sabit zamanlı karşılaştırma, PAT'te "oturumun sahip olmadığı scope verilemez" yükselme kapısı. Veri modelinde PRD §8.4'ün **36 tablosunun tamamı** doğrulandı — `uq_one_active_chat` DDL'i PRD ile birebir, `events` aylık RANGE partition + üç indeks + bakım fonksiyonları gerçek, dokuz CHECK ailesi yerinde.

Bu iki alan, PRD'nin en teknik ve en kesin yazılmış bölümleri. **Spesifikasyon ne kadar somutsa, uygulama o kadar eksiksiz** — denetimin en net korelasyonu bu.

### En zayıf iki alan

**NFR-PERF-SCALE (%11)** düşük ama yanıltıcı: ölçüm kültürü gerçek ve dürüst etiketlenmiş — `apps/load/test/budgets.test.ts` bütçeleri PRD §7.1/§7.4 tablolarından her koşuda yeniden okuyor, `thresholds.js` U1/U2'nin koşu-kapsamlı oluşunu **kendisi itiraf ediyor.** Eksik olan süreklilik (CI'da k6 yok), üretim SLO'su (30 günlük pencere / hata bütçesi / alarm yok), kuyruk, PITR ve paylaşılan nesne deposu.

Bu birimde denetimin kaçırdığı, çürütücünün yakaladığı bir olgu tüm P1/U3 tablosunu gölgeliyor: **müşteri tarafındaki widget hiç soket tutmuyor**, 4 saniyelik poll ile çalışıyor ([apps/widget/src/widget.ts:24](apps/widget/src/widget.ts:24) `POLL_INTERVAL_MS = 4_000`). Yani "fan-out p99 < 500 ms" bütçesi konuşmanın **yalnızca temsilci yarısını** kapsıyor.

**FR-13-EK (%13)** ise gerçekten zayıf: görsel Workflow builder yok (D4), Home'un Response time / Efficiency metrikleri hiç hesaplanmıyor, mobil parite karşılanmıyor (`apps/mobile/src/features` altında Traffic/Campaigns/Goals/Tickets/Home klasörlerinin **hiçbiri yok**).

---

## 5. Kritik bulgular

### K1. `/groups` yalnızca okuma — sıfırdan açılan workspace yönlendirme yapamaz

`FR-MOD-04.5` (Teams / departmanlar), PRD'de **"Must / MVP"** işaretli. `PLAN.md:218` bu maddeyi `✅ Dilim 8 · /groups` diye kapatmış. Kodda ise:

- `GET /groups` ([apps/api/src/routes/agents.ts:669](apps/api/src/routes/agents.ts:669)) **tek** grup uç noktası.
- `POST` / `PATCH` / `DELETE /groups` yok. Üye ekle/çıkar yok. `priority` yazma yolu yok.
- `group` / `groupAgent` için repoda **tek bir yazma çağrısı yok**. SCIM `/Groups` da salt-okunur.
- Kayıt akışı grup yaratmıyor.

Yönlendirme tümüyle `group_agents`'a bağlı olduğundan, **sıfırdan açılan bir workspace pratikte hiç yönlendirme yapamaz.** Bu, MVP kapsamındaki bir modülün ürünü çalışmaz kılan boşluğu.

### K2. Kampanya "otomatik gönderim" yok — modülün asıl vaadi boşta

`FR-MOD-03.3.2`: tetikleyici/mesaj zorunluluğu, canlı ziyaretçi eşleştirme, tenant izolasyonu ve idempotent yeniden-ateşleme **gerçekten var.** Ancak eşleşen ziyaretçiye yazılan tek şey bir `campaign_sends` satırı ([campaign-service.ts:240](apps/api/src/services/campaigns/campaign-service.ts:240)):

- Hiçbir chat event'i, RTM push'u veya widget mesajı üretilmiyor.
- `apps/widget` ve `apps/rtm` tarafında **"campaign" kelimesi bile geçmiyor.**
- `engaged` üretimde hiç `true` yapılmıyor.
- Yeni bir ziyaretçinin gelişi hiçbir kampanyayı tetiklemiyor — tetikleme yalnız create/update anında, son 30 dk içindeki ziyaretçilere karşı çalışıyor.

Ayrıca kampanya durumu (`Ongoing`/`Scheduled`/`Inactive`) **yalnız yazma anında** hesaplanıp kolona sabitleniyor; zamanın geçişiyle durumu yeniden değerlendiren hiçbir zamanlayıcı yok. Yani sekme filtreleri zamanla yanlışa dönüşüyor.

---

## 6. Kodda hiç karşılığı olmayanlar (13 madde)

| ID | Gereksinim | Önem | Not |
|---|---|---|---|
| `FR-MOD-08.3` | Company details (şirket adı/sektör/adres/saat dilimi) | **Önemli** | `Organization` modelinde yalnız `name`+`region` var |
| `FR-MOD-13.4` | Görsel Workflow builder (nodes/edges) | **Önemli** | Tablo var, kod yok — bkz. D4 |
| `SEMA-MIMARI.5.5` | §5.5 faz matrisi: Workflow builder v2 ana teslimi | **Önemli** | ADR-14 ile bilinçli ertelenmiş |
| `NFR-C1` | GDPR — DPA + SCC Module 2 + UK Addendum | **Önemli** | Teknik dayanak var, hukuki çıktı yok |
| `NFR-C2` | KVKK (TR) + VERBIS | **Önemli** | TR hedef pazar — tek karşılık yok |
| `FR-MOD-06.6` | Kural tabanlı chatbot (LLM'siz) | Küçük | `bots` tablosu şemada hiç yok |
| `FR-MOD-08.4` | Desktop app (Windows/macOS) | Küçük | PRD önceliği Could/v1 |
| `NFR-U5` | Enterprise SLA + kredi mekanizması | Küçük | `sla.ts:12` bilinçli kapsam dışı bırakıyor |
| `NFR-C3` | CCPA/CPRA — Service Provider | Küçük | — |
| `NFR-C7` | ISO 27001 sertifikasyon hedefi | Küçük | Kontroller var, ISMS çerçevesi yok |
| `NFR-C10` | Alt-işleyen şeffaflığı | Küçük | C1'in 10/5 gün penceresi buna bağlı |
| `NFR-I18N4` | Canlı çeviri (Enterprise) | Küçük | `PLAN.md:2152` bilinçli kapsam kararı |
| `SEMA-MIMARI.8.1c` | §8.1 IA iyileştirmeleri (Tickets üst-seviye, AI tek ev, Settings içi arama) | Küçük | Üçünün de karşılığı yok |

**Not:** Bu 13 maddenin en az 4'ü (`NFR-U5`, `NFR-I18N4`, `SEMA-MIMARI.5.5`, kısmen `08.4`) **kodda dürüstçe kapsam dışı işaretlenmiş.** Bunlar denetim hatası değil, kayıtlı ürün kararı — kapatma değil, kabul gerektiriyor.

---

## 7. Ne yapmalı — öncelik sırası

### Öncelik 1 — Ürünü çalışmaz kılanlar

1. **Omnichannel outbound'u bağla (D1).** `sendOutbound`'u chat-service'in cevap yoluna bağla; `ingestInbound`'u maskeleme + spam süzgecinden geçir. Tek kök neden, beş maddeyi birden kapatıyor.
2. **`/groups` yazma uç noktalarını ekle (K1).** POST/PATCH/DELETE + üye yönetimi + priority. Kayıt akışına varsayılan grup yaratma ekle.
3. **Kampanya gönderimini gerçek kıl (K2).** `campaign_sends` satırından widget/RTM mesajına giden yolu kur; durum yeniden değerlendirme için zamanlayıcı ekle.
4. **Stateless ihlalini kapat (D6).** Yüklemeleri paylaşılan nesne deposuna taşı — HPA `maxReplicas: 4` ile birlikte bu bugün üretimde kırılır.

### Öncelik 2 — Sessizce yanlış veri üretenler

5. **Sayaç/sıralamayı sunucuya taşı (D3).** AI resolution sayacı, Tickets sort, Traffic sayaçları.
6. **Deflection metriğini düzelt (D7).** `chat_transferred` olaylarını `reason` ile ayır; `skill_runs`'ı ai_agent/copilot sınırına göre filtrele. Test fixture'ını da düzelt — mevcut hâli hatayı yakalayamıyor.
7. **Readiness mantık operatörünü çevir (D8).** `hasKnowledge || hasSkill` → `&&`, ve `aktif` bayrağını oku.

### Öncelik 3 — Ürün yüzeyi boşlukları (D2)

8. Tags grup kapsamı, PAT yönetimi, ticket routing kural oluşturma ekranları.
9. Şablon rozetleri, preview özet narrasyonu, per-agent performance, audit log kayıt detayı.
10. Notifications'ı `InboxPage`'den ayır — ajan başka ekrana geçtiğinde ses/masaüstü/badge tamamen susuyor.

### Öncelik 4 — Karar gerektirenler (kod değil)

11. **Uyumluluk çıktıları (D5).** DPA/SCC metinleri, KVKK/VERBIS, alt-işleyen listesi. Bunlar mühendislik değil hukuk/operasyon işi — ama `NFR-C1`/`C2` "Önemli" işaretli ve TR hedef pazar.
12. **Workflow builder** ve **desktop app** için ADR'yi netleştir: v2'ye erteleme kararı PRD'ye geri yazılmalı, aksi hâlde bu boşluk her denetimde yeniden "eksik" olarak çıkar.

---

## 8. Task Master için ne anlama geliyor

174/174 `done` tablosu **yanlış değil ama yetersiz bir kapı.** İki somut kanıt:

- `PLAN.md:218`, `FR-MOD-04.5`'i `✅ Dilim 8 · /groups` diye kapatmış — kodda yalnız `GET` var (K1).
- İlk turdaki denetçiler bile `TAM`'ların %22'sini fazla cömert verdi; ancak ikinci bir muhalif tur bunu yakaladı.

Öneri: DoD kapısına **"kabul kriteri başına test"** koşulu eklenmeli. Mevcut kapı "kod var + testler yeşil"i ölçüyor; PRD'nin istediği "kabul kriterinin **kendisi** test ediliyor mu"yu ölçmüyor. `FR-MOD-07.4`'ün fixture'ı bunun ders niteliğinde örneği: test yeşil, kriter yanlış.

---

## Ek A — 247 gereksinim maddesinin tam tablosu

Sütunlar: `↓` = çürütme turunda düşürüldü, `↑` = yükseltildi.
`Önem` sütunu revize edilen maddelerde ilk turdan kalmadır (yeniden triyaj gerekir).

### FR-00-01 — Auth + Global Shell/Navigation

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-00.1` | Login (email+password + opsiyonel Google/Microsoft/Apple SSO + 2FA adimi) | **TAM** ↑ | Küçük | — |
| `FR-MOD-00.2` | Signup + 14 gunluk kartsiz trial; yeni license/account, Owner atanir | **TAM** | — | — |
| `FR-MOD-00.3` | Forgot password: sureli reset token + notr mesaj (enumeration korumasi) | **TAM** | — | — |
| `FR-MOD-00.4` | Onboarding sihirbazi (5 adim) + tohum veri (ornek sohbet, hazir KB, ornek skill) | KISMİ | Küçük | Sihirbaz 4 adim: welcome/website/team/sample (OnboardingWizard.tsx:31). PRD'nin 'ek kanallar' ve 'sirket buyuklugu' adimlari yok (/onboarding/survey farkli bir soru soruyor: ONBOARDING_SURVEY_ANSWERS = agent_performance/team_sharing/... — sirket buyuklugu deg… |
| `FR-MOD-01.1.1` | Logo/Hamburger — marka + nav daraltma/genisletme; menu/uygulama secici | KISMİ | Küçük | Pin/unpin yarisi tam ve erisilebilir (aria-expanded + aria-controls, Enter/Space). Ancak logo bir menu acmiyor: 'Menu/uygulama secici acilir' karsiligi yok. Shell'deki tek secici BrandSwitcher (AppShell.tsx:393) ve o da tek license icindeki markalari degistir… |
| `FR-MOD-01.1.2` | "N Leads qualified" pill — nitelikli lead sayisini canli gosterir | **TAM** | — | — |
| `FR-MOD-01.1.3` | Global arama / Command Palette (⌘K) — aksiyon + navigasyon + AI sorgu, klavye ↑↓/esc | **TAM** | — | — |
| `FR-MOD-01.1.4` | Avatar grubu (presence) — cevrimici takim uyeleri; online/offline halka, hover isim | **TAM** | — | — |
| `FR-MOD-01.1.5` | Invite +N — her ekrandan ekip daveti, MOD-04.4 modalini acar | **TAM** | — | — |
| `FR-MOD-01.1.6` | Trial rozeti "N days" + Subscribe CTA; expired → kisit | **TAM** | — | — |
| `FR-MOD-01.2` | Sol ikon rayi — modul rotalari, aktif vurgu, badge sayac, yetkiye gore gizleme | KISMİ | Önemli | Uc eksik: (a) Yetkiye gore gizleme yalniz Developers'a uygulanmis (navigation.ts:90 tek `scope` alani). DEFAULT_AGENT_SCOPES (role-scopes.ts:34-77) reports_read, billing_manage veya properties.configuration:rw tasimadigi icin agent rolundeki bir kullanici Rep… |
| `FR-MOD-01.3` | Sag panel anahtari — Details ↔ Copilot ↔ Expand; tum uygulamada kalici, gecis persist | KISMİ | Küçük | Details↔Expand secimi localStorage'da persist ediliyor ve testi var; ancak Details↔Copilot sekmesi duz `useState` (InboxPage.tsx:251) — reload'da her zaman 'details'e donuyor, yani KK'nin 'Details/Copilot gecisi persist' yarisi karsilanmiyor. Ayrica rightPane… |
| `FR-MOD-01.4` | Promosyon/onboarding banner'lari (dismiss + CTA; kalici dismiss, segmentli gosterim) | **TAM** | — | — |
| `FR-MOD-01.5` | Unpin side navigation — nav daraltma, tercih kullanici bazinda persist | **TAM** | — | — |
| `FR-00-01.A` | OAuth 2.1 + PKCE yetkilendirme akisi (S256 zorunlu, kod tek kullanimlik, refresh rotasyonu) | **TAM** | — | — |
| `FR-00-01.B` | Personal Access Token (PAT) yasam dongusu ve yetki yukseltme korumasi | **TAM** | — | — |
| `FR-00-01.C` | Customer (widget ziyaretci) token'i — imzali, kisa omurlu, tek organizasyona kapali | **TAM** | — | — |
| `FR-00-01.D` | Bot token / bot principal — uretim yolu | KISMİ | Önemli | `bot` principal'i tam tanimli, cozumleniyor, denetim izine yaziliyor ve rota kapilarinda enforce ediliyor — ama urunde hicbir uc nokta `kind: 'bot'` token uretmiyor. `app.tokens.issue` cagrilarinin tamami pat / enrollment / scim / oauth (auth.ts:361, auth.ts:… |
| `FR-00-01.E` | Scope modeli — katalog, ima (rw→ro, all→access), rol tavani, rota bazli zorlama | **TAM** | — | — |
| `FR-00-01.F` | Oturum yasam dongusu — TTL tavani, idle timeout, eszamanli oturum limiti, iptal | **TAM** | — | — |
| `FR-00-01.G` | Tenant (workspace) secimi — giristen sonra oturum icinde workspace degistirme | KISMİ | Küçük | Sunucu tarafi dogru: /auth/login uyelikleri listeliyor, /auth/authorize license_id'yi uyelik + client organizasyonuna karsi dogruluyor ve token tek license'a baglaniyor (tenant izolasyon testi mevcut). Eksik olan istemci tarafi: workspace secimi yalnizca giri… |

### FR-02 — Inbox / Chats (Agent Dashboard)

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-02.1.1` | Chats grubu — All / My chats / Queued / Unassigned / Supervised / Archive + canlı sayaç | KISMİ | Önemli | "Supervised" görünümü inbox'ta hiç yok: /chats view enum'u yalnız all/my/queued/unassigned/archived/ai/ai_solved (chats.ts:21) ve viewFilter'da supervised dalı yok (chat-service.ts:1691-1737); web VIEWS dizisinde de yok (InboxPage.tsx:59-65). Gözetleme yalnız… |
| `FR-MOD-02.1.2` | AI Agents grubu — AI agent (aktif) / Solved | KISMİ ↓ | — | PRD'nin bu satırdaki kabul kriteri iki parçalı: "AI konuşmalarını insan kuyruğundan ayırır; **Solved → AI resolution sayacı**" (urun-gereksinim-dokumani-PRD.md:501). Ayırma yarısı gerçekten doğru ve derin testli (viewFilter 'ai'/'ai_solved', chat-service.ts:1… |
| `FR-MOD-02.1.3` | Tickets grubu — All / Unassigned / My open / More (grid) | KISMİ | Küçük | Sıralama kriteri (lastMessageAt desc, nulls last) doğru karşılanmış (ticket-service.ts:136). Ancak PRD'deki dördüncü öğe "More (grid)" yerine "Solved" konmuş (InboxPage.tsx:97-102) ve PRD'nin açıkça andığı "Ticket views unavailable" hata-empty durumu yok: use… |
| `FR-MOD-02.1.4` | Views grubu — kanal görünümleri + "My recent chats" + kullanıcı-tanımlı custom views | KISMİ | Önemli | Kanal görünümleri gerçek bir görünüm değil: her satır <Link to="/app/settings"> (InboxPage.tsx:832-839) — tıklanınca orta listeyi kanala göre filtrelemiyor, Ayarlar'a gidiyor. /chats sorgu şemasında kanal filtresi parametresi de yok (chats.ts:20-27), yani fil… |
| `FR-MOD-02.2.1` | Liste başlığı + sıralama (Oldest/Newest, My chats kapsam) | **TAM** | — | — |
| `FR-MOD-02.2.2` | Sohbet liste öğesi (avatar+isim+önizleme+zaman+durum; unread; typing) — tıklama transcript aça… | KISMİ | Önemli | Kabul kriterinin "RTM'de yukarı taşınır" yarısı karşılanmıyor: liste sunucuda chats.created_at DESC + id ile sıralanıyor (chat-service.ts:1555) ve created_at hiç değişmiyor; yeni mesaj yalnız satırın last_event/unread alanını yerinde güncelliyor (useInbox.ts:… |
| `FR-MOD-02.2.3` | Onboarding "Take tour" banner — tek sefer + kalıcı kapatma | **TAM** | — | — |
| `FR-MOD-02.3.1` | Transcript — müşteri+ajan+AI+sistem olayları kronolojik; canlı akış, skeleton, reverse infinit… | **TAM** | — | — |
| `FR-MOD-02.3.2` | Reply Suggestions çipleri (AI, Space ile) — çip composer'a düzenlenebilir metin koyar | KISMİ | Küçük | Ana kabul kriteri (çip → composer'da düzenlenebilir metin) karşılanmış ve testli. Ancak öneri üretimi AI değil, sabit İngilizce regex/şablon (replySuggestions.ts:29-60: GREETING/THANKS/ORDER kalıpları ve iki sabit "holding" cümlesi); i18n katmanından geçmiyor… |
| `FR-MOD-02.3.3` | Composer (çok satır, placeholder, Enter gönder / Shift+Enter satır) — boş mesaj engellenir; op… | KISMİ | Önemli | "Hata retry" karşılanmıyor: submit() metni gönderim sonucunu beklemeden temizliyor (Composer.tsx:123), hata halinde optimistic.onError yalnız transcript cache'ini geri alıyor (useInbox.ts:539) — ajanın yazdığı metin geri gelmiyor ve tekrar-gönder aksiyonu sun… |
| `FR-MOD-02.3.4` | Message type dropdown (Reply / Internal note) — note müşteriye gitmez; farklı stil; Note modun… | **TAM** | — | — |
| `FR-MOD-02.3.5` | Composer araçları (canned #, #tags, rich text, emoji, attach) | KISMİ | Önemli | PRD'nin saydığı beş araçtan yalnız ikisi var: canned `#` menüsü ve attach (dosya kuralı /uploads'a bağlanmış, attachment.ts:23-36). Rich text (kalın/italik/liste) yok — düz <textarea> (Composer.tsx:411-441); emoji seçici hiç yok (apps/web genelinde "emoji" ar… |
| `FR-MOD-02.3.6` | Send butonu (optimistic, disabled/loading/error) — boşken pasif; hata retry | KISMİ | Küçük | Disabled (boş metin + eksik ek), pending ve error durumları var; optimistic ekleme/rollback de var. Eksik olan yine "hata retry": başarısız gönderimi tekrar deneyecek bir kontrol yok (Composer.tsx:478-486 yalnız submit çağırıyor, metin de temizlenmiş durumda)… |
| `FR-MOD-02.4.1–.6` | Details paneli — Chat info, Chat tags, Visited pages, Visit info (Device/Referring/Duration/IP… | KISMİ | Önemli | Bölümler katlanır (<details>, Panel.tsx:83) ve tag ekleme/silme anında kaydediyor. Ama "assignee anında kaydeder" karşılanmıyor: panel yalnız "Assigned/Unassigned" metni gösteriyor, ajan adı bile yok ve atama/transfer kontrolü hiç yok (DetailsPanel.tsx:98-115… |
| `FR-MOD-02.5` | Copilot özeti — internal note ("Summarize this chat as internal note") | **TAM** | — | — |
| `FR-MOD-02.6` | Sohbet aksiyonları — Create ticket / Copy chat link / Reopen (arşiv reopen → yeni thread + "Re… | KISMİ | Küçük | Üç aksiyon da mevcut ve reopen sunucu tarafında doğru (yeni thread + chat_resumed sistem olayı, chat-service.ts:849-877; teklik kuralı korunuyor). Boşluklar: (1) Copy chat link için hiçbir test yok — ne birim ne e2e; (2) Reopen'in UI yolu için de test yok (ya… |
| `FR-MOD-02.7` | Tickets grid — sıralanabilir tablo, deep-link filtre; satır → ticket konuşması; URL param sıra… | KISMİ ↓ | — | İki kabul kriteri parçası eksik. (1) "Sıralanabilir tablo": sıralama sunucuya gitmiyor. /tickets isteğinde sort parametresi yok (useTickets.ts:35-38, ticketListUrl yalnız view+limit+page_id kuruyor), sortTickets sadece belleğe yüklenmiş diziyi sıralıyor (tick… |
| `FR-MOD-02.8` | Archive — salt-okuma transcript + Copilot özeti; Reopen/Create ticket; denetim kaydı | KISMİ | Önemli | Salt-okuma doğru (composer yerini "This conversation is archived" notu alıyor, Composer.tsx:256-262) ve Reopen/Create ticket erişilebilir. Ama PRD'nin arşiv için istediği "Copilot özeti" alınamıyor: buton chatActive false iken disabled (CopilotPanel.tsx:131) … |
| `FR-MOD-02.9` | Live typing preview — RTM sender_typing/send_typing_indicator + sneak-peek (müşteri yazarken) | **TAM** | — | — |

### FR-03-04 — Customers (CRM/visitor tracking) + Team (roller ve izinler)

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-03.1.1` | Real-time sekmeleri (All/Chatting/Supervised/Queued/Waiting/Invited/Browsing) + canlı ziyaretç… | KISMİ | Küçük | Kabul kriterindeki 'RTM traffic akışı' yok: pano WebSocket tutmuyor, 8 saniyede bir ilk sayfayı yeniden okuyan polling ile çalışıyor (TrafficPage.tsx:67 TRAFFIC_REFRESH_MS, :333 setInterval) ve dosya başlığı bunu 'A true RTM traffic feed is a larger, separate… |
| `FR-MOD-03.1.2` | Empty state + Add more channels CTA (anlamlı boş durum zorunlu) | **TAM** | — | — |
| `FR-MOD-03.1.3` | Ziyaretçi tablosu + satır aksiyonları (Name/Email/Activity/Chatting with; Start chat / Supervi… | **TAM** | — | — |
| `FR-MOD-03.2.1` | Contacts header + arama + filter ('Enter name, email, or phone'; 'N customers') | KISMİ | Küçük | Debounce arama, 'N people' sayacı ve sonuç-yok boş durumu var; ancak PRD'nin istediği 'filtre paneli' Contacts tarafında yok — sadece 4 segment sekmesi (all/leads/recent/banned) mevcut. Trafik panosunda gerçek bir koşul tabanlı filtre paneli (TrafficFilters.t… |
| `FR-MOD-03.2.2` | Contacts alt sekmeler — All / Leads / Last 30 days (sortBy=last_activity) | **TAM** | — | — |
| `FR-MOD-03.2.3` | Contacts tablosu — Name/Email/Phone/Country(flag)/Last active/Chats/Tickets; sıralanabilir; sa… | KISMİ | Önemli | Tabloda yalnız 4 sütun var: Name (e-posta/telefon ikincil satır olarak), Country, Chats, Last active (CustomersPage.tsx:212-215). PRD'nin saydığı ayrı Email ve Phone sütunları, ülke bayrağı ve Tickets sütunu tabloda yok (tickets_count API'den geliyor ama sade… |
| `FR-MOD-03.3.1` | Campaigns alt sekmeler — All/Ongoing/Scheduled/Inactive (durum bazlı filtre) | KISMİ ↓ | — | Kampanya durumu SADECE yazma anında hesaplanıp kolona sabitleniyor (`computeCampaignStatus` yalnız create ve update yolundan çağrılıyor); durumu zamanın geçişiyle yeniden değerlendiren hiçbir zamanlayıcı/worker yok (`apps/api/src` içinde kampanyaya dokunan te… |
| `FR-MOD-03.3.2` | New campaign builder — tetikleyici+mesaj zorunlu; kayıt sonrası eşleşen ziyaretçiye OTOMATİK G… | KISMİ | **Kritik** | Tetikleyici/mesaj zorunluluğu, canlı ziyaretçi eşleştirme, tenant izolasyonu ve idempotent yeniden-ateşleme gerçekten var. Ancak 'otomatik gönderim' YOK: #fireIfRunning yalnızca `campaign_sends` satırı yazıyor (campaign-service.ts:240-250), hiçbir chat event'… |
| `FR-MOD-03.3.3` | Kampanya kartı — Edit / View report; grid/list; active toggle; Recurring/One-time; Displayed/C… | KISMİ | Önemli | Edit, active toggle ve üç sayaç kartta var. Eksikler: (1) `engaged` alanını üretim kodunda HİÇBİR yer true yapmıyor — `grep -rn engaged apps/api/src` yalnız okuma noktalarını (campaign-matching.ts:88, traffic-service.ts:483) döndürüyor; entegrasyon testi bile… |
| `FR-MOD-04.1` | Team kenar çubuğu — AI Agents (AI agent + Copilot), Teammates, Teams; '+' hızlı oluştur | KISMİ | Küçük | Üç varlık grubu (Teammates, AI agents + Copilot, Teams) tek sayfada `Section` blokları olarak var, ancak PRD'nin tarif ettiği modül-içi kenar çubuğu/gezinme yok; ayrıca '+' hızlı oluştur yalnızca teammate davetini açıyor (AppShell.tsx:268 InviteRailButton) — … |
| `FR-MOD-04.2` | AI Agents (team tarafı) — per-agent performance + Copilot knowledge yönetimi | KISMİ ↓ | — | Kabul kriterinin iki yarısından yalnız biri var. 'Copilot knowledge yönetimi' gerçekten tam (liste + ekle + sil, ro/rw kapsam kapıları, entegrasyon + bileşen testi). Ancak 'per-agent performance' KODDA YOK: Team sayfası `<AiPerformance agentActive={anyActive}… |
| `FR-MOD-04.3.1` | Header aksiyonları — Copy invite link / Invite teammates | KISMİ | Küçük | 'Invite teammates' butonu ve modal var; 'Copy invite link' ise bağımsız bir header aksiyonu DEĞİL — yalnız davet POST edildikten sonra modal içinde, oluşturulan ilk davetin `accept_url`'ü için beliriyor (InviteTeammates.tsx:71-75, :182-195). Tasarım gerekçesi… |
| `FR-MOD-04.3.2` | Teammates arama + filter (role/status/2FA), debounce; sonuç yoksa empty | **TAM** | — | — |
| `FR-MOD-04.3.3` | Teammates tablosu (Name/Role/Status/2FA + satır menüsü); Owner tekil; kendi rolünü düşürme kıs… | **TAM** | — | — |
| `FR-MOD-04.3.4` | Profile paneli — avatar/isim/rol/last seen/email/concurrent chats limit/Manage profile/Chattin… | KISMİ | Önemli | PRD'nin tarif ettiği ayrı profil paneli hiç yok; bilgiler roster tablosunun sütunlarına dağılmış. Eksikler: 'last seen' hiçbir yerde yok (accounts.last_seen_at alanı için access-review.ts:21 'nothing writes it' diyor), 'Manage profile' bağlantısı ve insan tea… |
| `FR-MOD-04.4` | Invite teammates modal — çoklu email + Role dropdown (default Admin) + davet/rol ön-atama + ko… | KISMİ | Küçük | Çoklu email, satır-içi geçersiz-adres hatası (invalid_emails), default 'admin' rolü, rol ön-atama, yarım-form kapatma onayı ve rol-tavanı reddi hepsi var ve test edilmiş. Eksik olan tek kabul kriteri 'koltuk faturaya yansır': `ensureSeatsCoverHeadcount` yalnı… |
| `FR-MOD-04.5` | Teams (Chatting Teams / departmanlar) — grup CRUD, üye ekle/çıkar, Primary agent önceliği, yön… | KISMİ | **Kritik** | PLAN.md:218 bu maddeyi '✅ Dilim 8 · /groups' diye kapatmış, ancak kodda yalnızca OKUMA var. `GET /groups` (agents.ts:669-689) tek grup uç noktası; ne POST/PATCH/DELETE /groups, ne üye ekle/çıkar, ne priority yazma uç noktası mevcut (`grep -rn "tx.group.create… |
| `FR-MOD-04.6` | Chatbots / Suspended agents sekmeleri (bot hesabı ücretsiz; suspend/unsuspend) | **TAM** | — | — |
| `FR-MOD-04.RBAC` | RBAC netleştirme — yetki hem UI hem API/route katmanında zorlanır; yetkisiz kullanıcı 'You don… | KISMİ | Küçük | API/route katmanı gerçekten çift kapılı (scope + minimumRole + RLS) ve kapsamlı test edilmiş — bu kısım TAM. Eksik olan UI tarafı: PRD 'yetkisiz kullanıcı boş-durum görür' derken, uygulama çoğu yerde menü öğesini gizliyor (AppShell.tsx:173 isNavVisible) ve 'e… |

### FR-05-06 — Playbook (Automation/Skills) + AI Agent (Chatbot/RAG)

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-05.1` | Header — Browse templates + Create skill ▾ (AI agent skill / Workspace workflow) | KISMİ | Önemli | "Browse templates" butonu ve sablon galerisi tam calisiyor. Ancak "Create skill" bir dropdown degil, tek bir "New skill" butonu (PlaybookPage.tsx:275-284) — PRD'nin istedigi tur secimi (AI agent skill / Workspace workflow) yok. POST /skills govdesinde kind sa… |
| `FR-MOD-05.2` | Recommended skills (sablon kartlari) — Prebuilt/AI/Trending/Popular/Essential; Try this / See … | KISMİ ↓ | — | Gereksinim kart etiketlerini 'Prebuilt/AI Agent/Trending/Popular/Essential' olarak sayiyor (PRD satir 557). Kodda kategori ucu (prebuilt/ai/trending) gercekten basiliyor, fakat Popular/Essential SADECE veri: `TemplateBadge` tipi tanimli (templates.ts:54), `ba… |
| `FR-MOD-05.3` | Skill listesi sekmeleri — All / AI agents / Workspace / Drafts | KISMİ | Küçük | Dort sekme, ✦/⚡ glyph'leri, sayaclar ve tam partition (All = AI ∪ Workspace ∪ Drafts) var ve birim testiyle kanitli. Fakat GET /skills sadece kind='ai_agent' donuyor (playbook.ts:290-293) ve POST /skills baska bir kind uretemiyor — dolayisiyla Workspace (⚡) s… |
| `FR-MOD-05.4` | Liste kontrolleri — Search / Sort / Filter | KISMİ ↓ | — | KK: 'Ada gore arama; tur/durum/sahip filtre'. Arama, durum ve siralama tam. Fakat (a) 'sahip' filtresi PRD'nin kastettigi sahip degil: `skillMatchesControls` owner'i `ai_agent_id`'ye esitliyor ve dosyanin kendi yorumu bunu itiraf ediyor ('The skill row carrie… |
| `FR-MOD-05.5` | Skill satiri — ikon + Name + N runs + tarih + sahip + [+AI agent] + chat-trigger + enable togg… | KISMİ | Önemli | Satirda isim, adim sayisi, "N runs" (runs_count), durum noktasi ve canli enable/disable toggle var; satira tiklayinca editor aciliyor. Eksik olanlar: tarih (updated_at API'de doniyor ama satirda basilmiyor), sahip/owner (yalnizca filtre acisi var, satirda gor… |
| `FR-MOD-06.1` | AI Agent sekmeleri — Performance / Profile / Skills / Knowledge + readiness check | KISMİ ↓ | — | Readiness check kodda VAR ama PRD'nin kuralinin TERSINI uyguluyor. PRD satir 298 (KK4): 'Knowledge bos VEYA hic aktif skill yokken uyari gosterilir'. Kod: `ready = hasKnowledge || hasSkill` (readiness.ts:42) — yani uyari sadece IKISI birden bosken cikiyor. Bi… |
| `FR-MOD-06.2.1` | Skill editor ust bari — Run log (N run ▾) + Skill active toggle + … + Save changes | KISMİ | Önemli | Save changes + dirty/saving durumlari var (SkillEditor.tsx:166-174, 241). Ama web editorunde: (a) Run log paneli YOK — GET /skills/:id/runs endpoint'i var ve testli, fakat web'de tek tuketici yok; run log sadece mobilde salt-okunur gosteriliyor (SkillDetailSc… |
| `FR-MOD-06.2.2` | Skill name — bos isim kaydedilemez | KISMİ | Küçük | Sunucu tarafinda zod ile bos isim reddediliyor (createSkillBody/updateSkillBody: z.string().trim().min(1)). Ancak web editorunde canSave sadece dirty + adim sorunlarina bakiyor, isim alanina bakmiyor (SkillEditor.tsx:174) — ismi silen admin devre disi buton y… |
| `FR-MOD-06.2.3` | Dogal dil talimat textarea'si (~10.000 karakter) → ordered steps derlemesi | **TAM** | — | — |
| `FR-MOD-06.2.4` | Ordered steps (akordeon, reorder) — 6 adim tipi; drag reorder + klavye alternatifi; zorunlu pa… | KISMİ | Önemli | Alti adim tipi PRD ile birebir; drag-drop + ↑/↓ klavye alternatifi + aria-live duyurusu (NFR-A11Y4) var; zorunlu parametre eksikse Save bloklaniyor ve satirda role="alert" hata cikiyor; API de gecersiz adim listesini adim numarasi vererek reddediyor. Eksikler… |
| `FR-MOD-06.2.5` | Preview (canli simulasyon) — ornek mesaja karsi skill'i calistirir, adimlari anlatir | KISMİ ↓ | — | KK dort eylemin narrasyonunu istiyor: 'toplama, etiket, OZET, transfer' + hata gosterimi. API dogru sekilde `summary` donuyor (playbook.ts:441) ve DTO'da alan var (types.ts:51) — ama editorun PreviewResult'i summary'yi HIC render etmiyor: sadece StatusDot, er… |
| `FR-MOD-06.3.1` | Knowledge alt sekmeler — All / Websites / Files / Articles / FAQ | **TAM** | — | — |
| `FR-MOD-06.3.2` | + New source — Website(crawl)/File/Article/FAQ; chunk+embedding+index; bulk/CSV import | KISMİ | Önemli | Dort tur, SSRF korumali crawl, ayni islemde chunk+embed+index, pgvector(1536) + ivfflat cosine indeksi, ve bulk CSV importu (satir/karakter/bayt butceleri, website satirlari icin ayri 20-satir fetch butcesi, dry-run) hepsi var ve genis testli. Eksik: 'file' t… |
| `FR-MOD-06.3.3` | Kaynak tablosu — Name/Last Updated/Added by/Actions; duzenle/sil/yeniden-crawl; silme onayi; g… | KISMİ | Önemli | Tabloda isim, tur, chunk sayisi, son guncelleme tarihi, URL, indeks durumu ve Sil var. Eksikler: (1) "Added by" — addedBy kolonu semada var ve yaziliyor (schema.prisma:1452, playbook.ts:549) ama GET /knowledge-sources serialisation'inda hic donmuyor (playbook… |
| `FR-MOD-06.4` | Profile (persona) — Name/Avatar/Tone/Language/Answer length + canli Preview; widget'ta persona… | KISMİ | Önemli | Bes alan da duzenlenebilir/kalici, canli PersonaPreview var, zorunlu isim e2e ile kanitli, widget basliginda persona adi+avatari gerçekten gorunuyor. Ama persona cevap uretimini hic etkilemiyor: tone, languages ve answer_length degerleri apps/api/src icinde p… |
| `FR-MOD-06.5` | Performance (AI analitigi) — Resolution rate, AI chats, CSAT, Transferred %; dusuk-baz uyarisi… | KISMİ ↓ | — | Dort KPI karti PRD'nin saydigi dort metrigi karsilamiyor. PRD: 'Resolution rate, AI chats, CSAT, Transferred %'. Kod: resolution_rate, 'AI chats resolved' (= report.resolutions, yani cozulen sohbet SAYISI), csat, transfer_rate (performance.ts:50-78). Yani iki… |
| `FR-MOD-06.6` | Chatbot (kural-tabanli bot) — deterministik akis, LLM'siz, §8 bots, gruplara priority ile atan… | **YOK** | Küçük | Semada `bots` tablosu / `model Bot` hic yok (grep: @@map("bots") ve `model Bot ` sonucsuz); AI Agent, Skill, SkillRun, Workflow, KnowledgeSource/Chunk disinda bot varligi tanimlanmamis. Kural-tabanli, LLM'siz ayri bot motoru veya route'u yok. Team sayfasindak… |
| `FR-05-06.EK1` | Skill motoru calisma zamani — tek skill/mesaj, tag/summary/transfer uygulanmasi, hata izolasyo… | **TAM** | — | — |
| `FR-05-06.EK2` | RAG geri getirme — pgvector 1536, benzerlik esigi, bilgi yoksa insana devir | **TAM** | — | — |

### FR-07-12 — Reports (Analytics) + Copilot (Agent-Assist AI)

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-07.1` | Reports kenar çubuğu — Overview / AI Agent / Metrics breakdown / Chat topics / Leads / Cases /… | KISMİ | Küçük | PRD 'kenar çubuğu' (sol dikey nav) + KK 'Kategoriler + grup genişleticiler' istiyor; kod düz bir yatay tablist, kategori grubu/akordeon yok. 'Export' PRD'de bir kenar çubuğu öğesi olarak listeleniyor, kodda ise sayfa başlığındaki bir indirme kontrolü (ayrı bi… |
| `FR-MOD-07.2` | Onboarding survey popover ("What are you tracking?") — tek sefer, atlanabilir, kişiselleştirme… | **TAM** | — | — |
| `FR-MOD-07.3.1` | Overview header — range tabs (7/30/90/365 + custom) + vs previous period + Share | KISMİ | Küçük | KK'daki 'Share export/link'in yalnız 'export' yarısı var. Paylaşılabilir bir rapor bağlantısı (share link / paylaşım kontrolü) kodda yok: apps/web/src/features/reports/ altında Share adında bir kontrol veya token'lı rapor URL'i üreten bir uç bulunmuyor; PLAN.… |
| `FR-MOD-07.3.2` | KPI kartları — Manual/Assisted/Automated split + Total cases + All sales; billing AI resolutio… | KISMİ | Önemli | KK'nın 'düşük-baz uyarısı' maddesi split kartlarında yok. low_confidence bayrağı yalnızca SLA bloğu için üretiliyor (reports.ts:572) ve UI'da yalnızca SLA kartında gösteriliyor (ReportsPage.tsx:745-747). Manual/Assisted/Automated ve Total cases kartlarında ör… |
| `FR-MOD-07.3.3` | Chats bölümü kartları — automated chats/hour, durations, response times, satisfaction (dönemse… | KISMİ | Küçük | KK 'Dönemsel + karşılaştırmalı' diyor; Chats bölümünün üç kartı (automated/hour, automated avg duration, total duration) yalnız dönemsel — benchmark bloğu bu üç figürü hiç ölçmüyor (report-csv.ts:1676-1689), dolayısıyla UI'da da vs-previous rozeti yok. Respon… |
| `FR-MOD-07.4` | AI Agent raporu — resolution / deflection / AI resolution; billing sayacıyla ilişkili | KISMİ ↓ | — | PRD 07.4 üç figür istiyor: resolution / deflection / AI resolution. Denetçinin doğruladığı tek yarım 'AI resolution' (ADR-09 automated) — o gerçekten fatura sayacıyla çivilenmiş. Ama raporun 'Deflection' bloğunun iki figürü de yanlış tanımlı: (1) transferCoun… |
| `FR-MOD-07.5` | Metrics breakdown — ajan/takım/kanal/saat boyutlarında kırılım | **TAM** | — | — |
| `FR-MOD-07.6` | Chat topics (AI-clustered) — konu kümeleme, hacim/trend, yeterli veri yoksa empty | **TAM** | — | — |
| `FR-MOD-07.7` | Rapor grupları — Leads / Cases / Sales / Team performance / Export (CSV/PDF), benchmark, Save … | KISMİ | Önemli | İki eksik: (1) **Sales rapor grubu boş** — buildSalesReport (reports.ts:949-970) hâlâ sabit `configured:false` iskeleti döndürüyor; oysa aynı dosyadaki trackedSalesBlock (reports.ts:811-834) tracked_sales tablosundan gerçek figür okuyabiliyor. Yani PRD'nin dö… |
| `FR-MOD-07.8` | Reviews / Ratings — rated good/bad, iki dönem karşılaştırma, Ecommerce/Tracked sales, Insights | KISMİ | Küçük | PRD satırının 'Insights' kalemi kodda yok: apps/web/src ve apps/api/src genelinde 'insight' geçen tek bir dosya/bileşen/uç yok. KK'daki üç madde (CSAT donut, günlük bar, e-ticaret satış izleme) tam ve testli; eksik olan yalnız açıklamadaki Insights bloğu. |
| `FR-MOD-12.1` | Copilot butonu — her sohbette sağ panel sekmesi; bağlamda yardım; Assisted metriğini besler | KISMİ | Küçük | Details ↔ Copilot seçimi kalıcı değil. Seçim InboxPage.tsx:251'de bileşen-yerel useState; kalıcılaştırılan tek şey details/expanded (rightPanel.ts:14-15, localStorage 'nexa.inbox.right-panel'), ve o dosyanın yorumu (rightPanel.ts:8-9) Copilot'u hâlâ gelecek b… |
| `FR-MOD-12.2` | Copilot knowledge base — AI Agent'tan ayrı RAG; ajana-özel kaynaklar, müşteriye açık değil | **TAM** | — | — |
| `FR-MOD-12.3` | Özet + yanıt yardımı — "Summarize as internal note", reply taslağı composer'a, enhance/rephrase | **TAM** | — | — |
| `FR-MOD-12.4` | Copilot BI komutu — rapor/metrik sorusu → cevap (PRD §5.5 MOD-12 v2 hücresi "○ (BI komut)", §5… | **TAM** | — | — |

### FR-08 — Settings / Omnichannel Configuration

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-08.1` | Settings kabuğu / gruplu kenar çubuğu + izin bazlı görünürlük + Settings içi arama | KISMİ | Önemli | Settings tek bir düz sayfa: 28 bölüm alt alta render ediliyor (SettingsPage.tsx:73-101). PRD'nin istediği gruplu navigasyon (Notifications / Company details / Desktop app / Channels / Routing / Inbox / Integrations / Security / Billing) YOK; Settings içi aram… |
| `FR-MOD-08.2` | Notifications — ses/masaüstü/e-posta/tarayıcı tercihleri (yeni sohbet/atama/mention), kullanıc… | KISMİ | Önemli | Tercihler kanal bazında (enabled/sound/desktop/push/email), hesap üzerinde saklanıyor ve tarayıcı izni daveti var (enableDesktop, NotificationSettings.tsx:66-73) — buraya kadar tam. Eksik olan PRD'nin parantez içi kriteri: OLAY bazında granülerlik yok. decide… |
| `FR-MOD-08.3` | Company details — şirket adı/sektör/adres/saat dilimi | **YOK** | Önemli | Hiçbir kaynak dosyada company details yüzeyi yok: `/settings/company` benzeri endpoint yok (settings.ts'teki 46 route'un hiçbiri şirket bilgisi yazmıyor), Organization/License modelinde sektör/adres/saat dilimi alanı yok, web tarafında böyle bir bölüm yok. Re… |
| `FR-MOD-08.4` | Desktop app — Windows/macOS indirme; native bildirim/ayrı pencere | **YOK** | Küçük | Masaüstü uygulaması indirme bağlantısı, kurulum kartı veya Electron/Tauri türü bir kabuk repoda yok. 'desktop' geçen tek yerler tarayıcı Notification API'siyle ilgili (notifications.ts 'desktop' tercihi) — bu masaüstü UYGULAMASI değil, tarayıcı bildirimidir. … |
| `FR-MOD-08.5.1` | All channels kart gridi (icon+name+status+desc+CTA) | **TAM** | — | — |
| `FR-MOD-08.5.2` | Website widgets — Add website / snippet / platform / Connected doğrulama sinyali / per-row get… | **TAM** | — | — |
| `FR-MOD-08.5.3` | Email (forwarding→ticket) — çoklu adres forward; test doğrulama | KISMİ | Önemli | Ana akış (forward → ticket, gönderen eşleme, spam süzme, CC maskeleme) tam. İki kabul kriteri eksik: (1) ÇOKLU ADRES yok — adres şeması sabit `<organization_id>@<INBOUND_EMAIL_DOMAIN>` (email-inbound.ts:57-70, Channels.tsx:332); bir workspace'in birden fazla … |
| `FR-MOD-08.5.4` | Messenger (Facebook page OAuth) — OAuth; mesaj → inbox chat | **TAM** | — | — |
| `FR-MOD-08.5.5` | Twilio SMS — Twilio kimlik/numara; SMS gönder-al | KISMİ ↓ | — | PRD'nin kabul kriteri acikca 'SMS gonder-al' diyor; 'al' tarafi calisiyor ama 'gonder' tarafi ajan yuzeyine hic baglanmamis. `sendOutbound` repoda TEK bir yerden cagriliyor: `POST /channels/:type/messages` (routes/channels.ts:161). Ajanin inbox composer'indan… |
| `FR-MOD-08.5.6` | WhatsApp (Business) — WhatsApp bağlama; mesaj → chat | **TAM** | — | — |
| `FR-MOD-08.5.7` | Instagram (DM) — Coming soon → Get notified → tam entegrasyon | KISMİ ↓ | — | Kabul kriteri 'Coming soon → Get notified → tam entegrasyon'. Iki noktada eksik: (1) CIFT YONLU DEGIL — Instagram DM ile yazan musteriye ajanin cevabi gitmiyor; outbound yalnizca `POST /channels/instagram/messages` ile mumkun ve bu cagriyi ne web konsolu ne d… |
| `FR-MOD-08.5.8` | Telegram — Get notified → tam entegrasyon (TR pazarı önceliği) | KISMİ ↓ | — | Ayni kok neden: 'tam entegrasyon' kriteri tek yonlu ingest ile karsilanmis. Telegram'dan gelen mesaj inbox'a dusuyor, ama ajanin composer'dan yazdigi cevap Telegram'a gitmiyor — outbound icin `POST /channels/telegram/messages` cagrilmasi gerekiyor ve bunu uru… |
| `FR-MOD-08.5.9` | Chat page (hosted, paylaşılabilir link) — Get link; site olmadan sohbet | **TAM** | — | — |
| `FR-MOD-08.6.1` | Chat routing kural motoru + New rule + fallback team | KISMİ | Önemli | Motor tam: koşullar (url_contains/url_equals/country_codes/expertise_ids) AND'lenerek eşleşiyor, sıralama `is_fallback ASC, priority ASC`, fallback devre dışı bırakılamıyor (settings.ts:2372-2379), concurrent limit `HAVING COUNT(t.id) < m.concurrent_chats_lim… |
| `FR-MOD-08.6.2` | Ticket rules (atama/etiket/öncelik otomasyonu) — koşul+eylem zorunlu | **TAM** | — | — |
| `FR-MOD-08.6.3` | Skills-based routing + supervision/takeover | **TAM** | — | — |
| `FR-MOD-08.7.1` | Tags kütüphanesi (CRUD; grup kapsamı; yinelenen ad engeli; kullanımda silme uyarısı) | KISMİ ↓ | — | Denetci, canned responses'ta (08.7.2) 'group_id kolonu var ama create/update kabul etmiyor → olu kolon' diyerek KISMI verdi; tags'te ayni kusur var ama TAM verilmis — tutarsiz. API tarafinda `group_ids` gercekten yaziliyor (settings.ts:2572-2577) ama KONSOLDA… |
| `FR-MOD-08.7.2` | Canned responses (Chat/Ticket; shortcut #+text+grup kapsamı; yinelenen shortcut engeli; Modifi… | KISMİ | Önemli | # kısayolu composer'da çalışıyor, yinelenen shortcut `(license, scope, shortcut)` unique ile engelleniyor, 'Modified by' izi updatedBy/updatedAt olarak tutuluyor ve serialise ediliyor. EKSİK: GRUP KAPSAMI bağlanmamış — şemada `group_id` ve `visibility` kolonl… |
| `FR-MOD-08.7.3` | Chat timeout (boşta/timeout eşikleri; pozitif süre; ölü sohbet otomatik kapanma) | **TAM** | — | — |
| `FR-MOD-08.7.4` | Chat transcripts (bitişte müşteri/ekibe otomatik transcript e-postası) | **TAM** | — | — |
| `FR-MOD-08.7.5` | Ticket email templates (markalı, değişkenli; geçersiz değişken/format engeli) | KISMİ | Önemli | CRUD ve 'geçersiz değişken/format engeli' kriteri karşılanmış (servis `{{ group.field }}` yer tutucularını @nexa/types kataloğuna karşı doğruluyor). AMA şablon TÜKETİCİSİ YOK: `renderTemplate` (packages/types/src/template-variables.ts:130) repoda yalnızca ken… |
| `FR-MOD-08.7.6` | Custom fields (ticket/contact özel alanları; tip/zorunluluk; Details+CRM'de görünür) | **TAM** | — | — |
| `FR-MOD-08.7.7` | Forms builder (pre-chat/post-chat/ticket/prospect; widget'ta gösterim → contact/ticket'a yazma) | KISMİ | Önemli | İki boşluk: (1) YERLEŞİM eksik — FORM_PLACEMENTS yalnızca ['pre_chat','post_chat'] (custom-fields.ts:32); PRD'nin saydığı 'ticket' ve 'prospect' formları yok ve servis form alanını contact entity'siyle sınırlıyor (custom-field-service.ts:128-129), yani ticket… |
| `FR-MOD-08.8.1` | Apps (marketplace) girişi | **TAM** | — | — |
| `FR-MOD-08.8.2` | API access — APIs & SDKs + Personal access tokens; PAT üret; pricing/docs; API call billing sa… | KISMİ | Önemli | Sunucu tarafı sağlam: PAT bir kez döndürülüyor (auth.ts:988-999, Cache-Control:no-store), scope'lar oluşturmada sabitleniyor ve yetki yükseltmeye karşı korunuyor (auth.ts:953-965), api_calls sayacı usage_records'a işleniyor ve faturaya giriyor. EKSİK OLAN KON… |
| `FR-MOD-08.8.3` | MCP server (mcp URL + Copy + Claude setup + örnek prompt; 4 tool; scope bazlı; tenant izole) | **TAM** | — | — |
| `FR-MOD-08.8.4` | Webhooks (register/list/unregister) — HMAC-SHA256 + timestamp/nonce; retry 3×; SSRF; secret lo… | **TAM** | — | — |
| `FR-MOD-08.9.1` | Trusted domains (widget allowlist) — yalnız izinli origin widget yükler | **TAM** | — | — |
| `FR-MOD-08.9.2` | Banned customers (IP/visitor yasak) — yasaklı sohbet başlatamaz | **TAM** | — | — |
| `FR-MOD-08.9.3` | Spam (filtre) — spam sohbet/ticket otomatik filtre | KISMİ ↓ | — | Motor gercek ve testli, ama yalnizca IKI giris noktasina bagli: widget chat-start (customer.ts:426-433, ustelik yalnizca sohbeti ACAN mesaj) ve inbound e-posta (email-inbound.ts:96). `evaluateSpam` cagiran baska hicbir yer yok (grep: sadece bu iki dosya + tes… |
| `FR-MOD-08.9.4` | File sharing (izinli tür/boyut + virüs tarama) — izinsiz tür/boyut reddi | **TAM** | — | — |
| `FR-MOD-08.9.5` | CC masking (kart no maskeleme, yazma anında, Luhn; DB/log'a maskeli) | KISMİ ↓ | — | PRD 'DB/log'a maskeli yazilir (yalniz UI degil)' diyor; maskeleme ROUTE katmaninda yapiliyor (chats.ts:126 normaliseEvent, customer.ts:406 maskOptional, email-inbound.ts:85 sadece subject) ve omnichannel webhook yolu bu katmani tamamen atliyor. `ChannelServic… |
| `FR-MOD-08.9.6` | IP allowlist / oturum güvenliği (Enterprise) | **TAM** | — | — |
| `FR-MOD-08.10` | Billing (Settings içinde): Subscription / Payment details / Invoices grubu | KISMİ | Küçük | Subscription, kullanım/AI sayacı, fatura ve ödeme yöntemi yüzeyleri var ve MOD-10 akışı çalışıyor. Ancak PRD'nin bu maddesi 'Settings içinde' grubunu istiyor: Billing ayrı bir üst seviye rota (/app/billing, App.tsx:96) ve SettingsPage'te ne bir Billing bölümü… |
| `NFR-C8` | Veri saklama (retention) — yapılandırılabilir 30/60/365/sınırsız + gerçek hard-delete + right … | KISMİ | Önemli | Periyodik süpürme işi ve HIPAA tavanı var, ama PRD'nin 'yapılandırılabilir' kriteri karşılanmamış: pencereler yalnızca ortam değişkenlerinden (RETENTION_THREAD_DAYS/VISIT/MAIL/AUDIT) okunuyor, TENANT BAZINDA ayarlanamıyor — settings.ts'in 46 route'unun hiçbir… |

### FR-09-10-11 — Apps Marketplace + Billing/Subscription + Customer Widget

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-09.1` | Entegrasyon kartları gridi — koleksiyonlar + kategori/ödeme/yerleşim filtreleri + arama | KISMİ | Küçük | Kabul kriteri (kart → izin/OAuth akışı; bağlanınca veri sohbet içinde) tamamen karşılanmış: ConsentDialog izinleri listeliyor, Authorize start→callback çalıştırıyor, GET /chats/:chatId/apps sohbet içi veriyi döndürüyor. Eksik olan filtre taksonomisi: listQuer… |
| `FR-MOD-09.2` | Tam entegrasyon listesi (15–20 kart; v2 100+) — her biri OAuth/API key; kanal-tipli olanlar Ch… | KISMİ | Önemli | Katalog 102 kart ve kanal çapraz-bağı gerçek (isChannelApp → connect reddi + karttan Channels linki). İki gerçek boşluk: (1) `provider: 'api_key'` yalnız bir etiket — AppService.oauthStart/oauthCallback'te api_key için ayrı dal yok (app-service.ts:172-223) ve… |
| `FR-MOD-09.3` | API istek paketleri (marketplace) — Essential/Pro/Pro+ | **TAM** | — | — |
| `FR-MOD-09.4` | Zapier/Make + Build-your-app + webhooks (partner/creator portalı) | KISMİ | Küçük | 'Build your app' ayağı gerçek: OAuth 2.1 client kaydı, scope tavanı, client_secret rotasyonu, audit, developer portalı UI'ı ve e2e mevcut. Webhook'lar da ayrı bir route olarak var. Eksik olan otomasyon ayağı: Zapier ve Make yalnızca katalogda iki mock kart (a… |
| `FR-MOD-10.1.1` | Plan + Change plan (plan tier geçişi; downgrade kısıtları) | KISMİ | Önemli | API tarafı eksiksiz ve testli: PATCH /billing/subscription plan kabul ediyor, bilinmeyen planı reddediyor, downgrade guard'ı (yeni planın kotası bu ayki kullanımın altındaysa red) subscription-service.ts:191-201'de gerçek. Boşluk panelde: BillingPage'in mutas… |
| `FR-MOD-10.1.2` | Billing cycle (Monthly/Annual) + yıllık indirim | **TAM** | — | — |
| `FR-MOD-10.1.3` | Users stepper ($/user/mo × qty) — alt sınır = aktif kullanıcı | **TAM** | — | — |
| `FR-MOD-10.1.4` | AI resolutions meter + stepper (dahil kota + aşım paketi) + %80 proaktif uyarı | KISMİ | Küçük | Sayaç (N/limit + gerçek %, 100 üstünü kırpmadan), %80 proaktif uyarı ve aşım fiyatının önden gösterimi eksiksiz. Eksik olan PRD başlığındaki 'stepper': AI çözüm aşım paketi satın alınabilir bir kalem değil — 50'lik paket yalnızca fiyat vitrini olarak render e… |
| `FR-MOD-10.1.5` | API calls (aşım paketi) — aşım faturaya + sayaç | **TAM** | — | — |
| `FR-MOD-10.1.6` | Subscription summary + Enter payment details (trial bitince X; Billed now $0) | **TAM** | — | — |
| `FR-MOD-10.2` | 14 günlük trial mantığı (global rozet + canlı gün sayacı + bitince kısıt) | KISMİ ↓ | — | Trial çekirdeği (14 gün, canlı gün sayacı, bitince read-only) gerçekten eksiksiz ve testli — lifecycle-service.ts:23 TRIAL_DAYS=14, metering.ts:227 trialState, license-gate.ts:38 mutasyon reddi, AppShell TrialBanner, integration + e2e kanıtı hepsi doğrulandı.… |
| `FR-MOD-10.3` | Invoices (fatura geçmişi/indirme) + Payment details yönetimi | KISMİ ↓ | — | "Fatura geçmişi" kalıcı değil, okuma anında TÜRETİLİYOR ve geçmiş dönemleri BUGÜNKÜ abonelik satırından fiyatlıyor. schema.prisma'da Invoice modeli hiç yok (yalnız PaymentMethod/Subscription/UsageRecord/ApiPackagePurchase var) ve Subscription tek satır olup y… |
| `FR-MOD-11.1` | Launcher bubble (sağ alt; unread rozeti) — aç/kapa; yeni greeting'te rozet/animasyon; trusted … | KISMİ | Önemli | Aç/kapa, konum (sağ/sol) ve trusted-domain kapısı tam. Unread rozeti hiç yok: widget.ts'te 'unread'/'badge' geçen tek bir satır bile yok, launcher yalnız metin taşıyor (widget.ts:1168). Daha kötüsü, poll döngüsü `if (state.open && !doc.hidden)` koşuluyla çalı… |
| `FR-MOD-11.2` | Greeting card + quick replies (Let's chat / Just browsing) — proaktif karşılama campaigns'ten | KISMİ | Önemli | Kart, iki hızlı yanıt ve davranışları gerçek: 'Let's chat' pre-chat formunu açıyor, 'Just browsing' kartı sessionStorage ile oturum boyu erteliyor (widget.ts:558-563) — ikisi de e2e ile korunuyor. Ancak KK'nın 'proaktif karşılama (campaigns'ten)' yarısı bağla… |
| `FR-MOD-11.3` | Agent identity (AI persona / insan adı görünür) | **TAM** | — | — |
| `FR-MOD-11.4` | Composer (mesaj + attach + emoji + send) — canlı iletim, file sharing kuralı, boş mesaj engeli | KISMİ | Küçük | KK'nın üç maddesi de karşılanmış: canlı iletim (Customer Chat API + optimistic bubble), file-sharing kuralı sunucuda zorlanıyor (uploads.ts:105 fileSharingEnabled kapalıysa red), boş mesaj engeli `if ((!text && !attachment) || state.sending) return` ile gerçe… |
| `FR-MOD-11.5` | 'Powered by' alt bilgisi — üst planda kaldırılabilir / Enterprise white-label | **TAM** | — | — |
| `FR-MOD-11.6` | Embed snippet (async JS + window config, </body> öncesi) — license-scoped iframe; RTM bağlantı… | KISMİ | Küçük | Snippet (async script + `window.__nexa`), çapraz-origin sandbox iframe (aynı origin'de çalışmayı reddediyor), postMessage origin+source doğrulaması ve trusted-domain kapısı eksiksiz. KK'daki 'RTM bağlantısı' karşılanmıyor: widget WebSocket kurmuyor, 4 saniyel… |
| `FR-MOD-11.7` | Widget customization (Appearance/Position/Mobile; canlı önizleme; 45+ dil; WCAG) | KISMİ | Küçük | Renk/tema/konum/mobil-tam-ekran ve canlı önizleme gerçek; mobil tam ekran loader'da uygulanıyor (loader.ts:144), RTL desteği ve reduced-motion var. Dil ayağı eksik: widget yalnız 8 locale taşıyor (ar, de, en, es, fr, it, pt, tr — apps/widget/src/locales/), PR… |
| `FR-MOD-11.8` | Typing indicator (sneak-peek) — müşteri yazarken ajana önizleme | **TAM** | — | — |

### FR-13-EK — Engage/Goals/Home/Workflow Builder/Sales Tracker/Mobil + Capraz kesit desenler

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `FR-MOD-13.1` | Home dashboard (dolu hal) — kisisellestirilmis karsilama + onboarding checklist + Performance … | KISMİ | Önemli | Uc kabul kriterinin ikisi eksik. (1) "Kisisellestirilmis karsilama" yok: sayfa basligi sabit 'Home' / 'Your workspace at a glance' (locales/en/home.ts:11-12); ajanin adini kullanan bir karsilama satiri hicbir yerde uretilmiyor. (2) Performance overview PRD'ni… |
| `FR-MOD-13.2` | Engage / Traffic (gelismis) — Match all filters + Add filter; ziyaretci 360 panel | KISMİ | Küçük | Uc kabul kriteri (gelismis filtre / ziyaretci gecmisi / proaktif aksiyon) karsilaniyor, ama PRD'nin tarif ettigi "ziyaretci 360 panel" Engage yuzeyinde degil: Traffic satirindaki 'Edit contact' aksiyonu kullaniciyi /app/customers?customer=... adresine goturuy… |
| `FR-MOD-13.3` | Goals — ziyaretci->sohbet->donusum hunisi (satis/lead/cozum); Create goal; Reports "Achieved g… | KISMİ | Küçük | Huni + hedef tanimi + rapor entegrasyonu tam calisiyor, ancak hedef tanim dili tek bir yuklem ile sinirli: `url_contains`. `GoalBuilder.tsx:35` formda yalnizca bu alani sunuyor, `goal-matching.ts:20-36` baska hicbir yuklem tanimiyor ve dosyanin kendi yorumu b… |
| `FR-MOD-13.4` | Gorsel Workflow builder (nodes/edges) — no-code surukle-birak dugum/kenar akis editoru; Empty … | **YOK** | Önemli | Dort kabul kriterinden hicbiri urunde yok. `workflows` tablosu semada duruyor (schema.prisma:1427-1440, nodes/edges Json) ama **olu**: repo genelinde tek bir `tx.workflow` / `prisma.workflow` okuma-yazmasi yok, `apps/api/src/routes/` altinda workflow route'u … |
| `FR-MOD-13.5` | Sales tracker — satis/donusum izleme kodu/kurali; Ecommerce/Tracked sales | **TAM** | — | — |
| `FR-MOD-13.6` | Omnichannel Ticketing / HelpDesk katmani — asenkron ticket sistemi (merge/unmerge, followers, … | **TAM** | — | — |
| `FR-MOD-13.7` | Mobil uygulamalar — tum modulleri kapsayan tek iOS/Android app + push bildirim; tam modul pari… | KISMİ | Önemli | Push tarafi (kayit + teslim + derin baglanti) gercekten var ve testli. "Tam modul paritesi" kriteri ise karsilanmiyor ve bunu reponun kendi parite matrisi acikca yaziyor: dort yuzeyin her biri daraltilmis — CRM salt-okunur dizin, duzenleme/ban/custom field/zi… |
| `FR-MOD-13.8` | Notifications (bildirim sistemi) — ses/masaustu/tarayici/e-posta + mobil push; kanallar arasi … | KISMİ ↓ | — | Kanallarin kendisi (ses/masaustu/tab-badge/e-posta/push) gercekten var ve testli, ama konsol tarafindaki UC kanal tek bir route'un omrune bagli. `useNotifications` ve `useRealtime` reponun tamaminda YALNIZCA InboxPage'de mount ediliyor (apps/web/src/features/… |
| `FR-EK-A.1` | Form & girdi mantigi — istemci-tarafi anlik validasyon + gecerli girdi olmadan submit pasif + … | KISMİ ↓ | — | 'Tek form/validasyon kutuphanesi; alan-alti hata mesaji' kriteri urun genelinde tutmuyor. apps/web/src icinde `useForm(` kullanan 20 dosya var, ama `<form` iceren 40 dosya var — yani formlarin yaklasik yarisi lib/form.tsx'i atlayip elle useState ile kuruluyor… |
| `FR-EK-A.2` | Ortak girdi davranislari — debounce arama, filtre panelleri, dropdown, stepper, toggle (optimi… | KISMİ | Küçük | Stepper, dirty-guard, optimistic ve Dropdown icin ortak primitif var; **debounce icin yok**. Alti ayri ekran ayni setTimeout dansini elle yazmis ve uc farkli gecikmeyle: 250 ms (CustomersPage.tsx:85, TeamPage.tsx:154, AppsMarketplace.tsx:142), 200 ms (Playboo… |
| `FR-EK-B.1` | Sayfalama & yukleme — virtualized grids (Contacts/Teammates/Skills/Tickets/Knowledge/Apps/Camp… | KISMİ | Küçük | PRD'nin virtualized olmasini istedigi yedi izgaradan altisi VirtualList/VirtualTable kullaniyor; **Campaigns kullanmiyor** — CampaignsPage.tsx:177 duz `visible.map(...)` ile tum satirlari DOM'a basiyor, dolayisiyla o liste icin "10.000+ satirda 60fps / yalniz… |
| `FR-EK-C.1` | Realtime katman — yeni sohbet/sayac/transcript/traffic/presence/duration canli (WebSocket push… | KISMİ | Önemli | Yeni sohbet / transcript / sayac / presence gercekten WS push ile geliyor ve reconnect'te kacirilan olaylar chat basina cursor ile `sync` uzerinden telafi ediliyor (realtime.ts:51,7-9). Ama PRD'nin listesindeki **traffic** push ile beslenmiyor: TrafficPage.ts… |
| `FR-EK-C.2` | Banner/dropdown/panel/modal — dismiss/CTA banner, hover/click dropdown, kalici sag panel, moda… | KISMİ | Küçük | Dort primitif tek bir seam'den (components/ui/index.ts) sunuluyor ve 28 ekran oradan tuketiyor; ama "tek tasarim sistemi" kriteri tam degil: iki yuzey Modal'i atlayip kendi `role="dialog"` overlay'ini elle kuruyor — CommandPalette.tsx:465 ve TemplateGallery.t… |
| `FR-13-EK.1` | Capraz kesit: arama (global command palette — kayit arama + modul atlama + aksiyon) | KISMİ | Küçük | Kayit arama (customers, tickets), modul atlama, scope-gate'li aksiyonlar ve AI sorusu var. Eksik olan tek yer sohbet aramasi: `GET /chats` uzerinde `query` parametresi olmadigi icin palette en yeni 50 sohbeti indirip istemcide filtreliyor (CommandPalette.tsx:… |
| `FR-13-EK.2` | Capraz kesit: audit log (filtreli okuma, detay, export, tamper-evident zincir) | KISMİ ↓ | — | Filtreli okuma, tamper-evident zincir (HMAC + gapless chain_seq + imzali export sayfasi) ve SIEM export gercekten saglam ve testli — bunlara itirazim yok. Eksik olan 'detay' ayagi: konsolda bir kaydin NE degistirdigi hicbir yerde gorunmuyor. Tablo bes kolon b… |
| `FR-13-EK.3` | Capraz kesit: bulk islem (toplu ice aktarma / toplu liste aksiyonlari) | KISMİ | Küçük | Toplu islem yalnizca iki noktada var: knowledge source CSV/site toplu ice aktarma (`POST /knowledge-sources/bulk`, satir-bazli kismi basari + butce siniri) ve SCIM uzerinden kullanici saglama. Liste yuzeylerinde toplu aksiyon yok: Inbox, Tickets ve Customers … |

### NFR-PERF-SCALE — NFR Performans + Olceklenebilirlik/Guvenilirlik + SLA/SLO

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `NFR-P1` | RTM mesaj teslim gecikmesi (fan-out) p99 < 500 ms | KISMİ | Önemli | Olcum gercek ve durust (yayinci POST -> commit -> Redis -> gateway -> soket, tek saat; ustsinir olarak isaretlenmis). AMA (1) butce yalnizca ~6.000 aliciya kadar tutuyor: rtm-6000.json p99 466 ms, rtm-8000.json p99 550 ms (README'de 599 ms'lik ilk kosu da kay… |
| `NFR-P2` | Core REST API gecikmesi p99 < 300 ms yazma / < 150 ms okuma | KISMİ | Küçük | Olculen degerler butcenin rahat icinde: okuma p99 116,2 ms (butce 150), yazma p99 87,9 ms (butce 300); okuma/yazma `op` etiketiyle AYRI butceler olarak surulmus ve `nexa_measured{op:...} count>0` sayaci sayesinde ornek almamis bir esik yesil gorunemiyor (budg… |
| `NFR-P3` | Widget ilk yukleme (bundle) < 50 KB, async, ana sayfayi bloklamaz, CDN edge | KISMİ | Küçük | < 50 KB gercek bir kapi: gzip'li TUM dist varliklari toplaniyor (18.484 B / 51.200 B, PLAN.md §7.2 P3 hucresi) ve loader'a ayrica 8 KB'lik daha sikı bir butce konmus (1.635 B). `async` da kanitli — uretilen snippet `<script async src=".../loader.js">` (websit… |
| `NFR-P4` | Liste render (virtualization) — 10.000+ satirda 60 fps, yalniz gorunur satir DOM'da | KISMİ | Küçük | "Yalniz gorunur satir DOM'da" yarisi TAM ve testli: 10.000 veri satirinda DOM'daki satir sayisi <= 20 (VirtualList.test.tsx:364-385), spacer yuksekligi 10.000 x rowHeight olarak dogrulanmis. "60 fps" yarisi ise OLCULMUYOR — testin kendi adi bunu durustce "60f… |
| `NFR-P5` | Transcript yukleme — reverse infinite scroll + keyset pagination + skeleton | **TAM** | — | — |
| `NFR-P6` | DB buyuk liste sorgulari — events aylik RANGE partition + kompozit indeks + cursor pagination … | KISMİ ↓ | — | PRD satirinin uc parcasindan ikisi (aylik RANGE partition + cursor pagination) var, ama asil hedef olan 'sabit-zaman' KARSILANMIYOR ve gosterilen testler onu korumuyor. Transcript sorgusu imleci `(split_part(id,'_',2))::bigint` ifadesi uzerinden suruyor (chat… |
| `NFR-P7` | Agir raporlar — read-replica / ayri kolon-tabanli analitik depo (OLTP'yi yormaz) | KISMİ | Küçük | Read-replica DIKISI gercekten var ve iyi savunulmus: `app.dbRead` replika yoksa `app.db` ile AYNI NESNE (nullable degil, boylece unutulan bir `?? db` sessizce birincilde kalamiyor), `withTenantRead` islemi `SET TRANSACTION READ ONLY` ile aciyor, 13 rapor rota… |
| `NFR-P8` | Eszamanli baglanti olcegi — ~20k WS baglanti/pod (uWebSockets.js), yatay olcek | KISMİ | Önemli | PRD'nin yazdigi hedef KARSILANMIYOR ve karsilanamaz: apps/rtm Node'un `ws`'ini kullaniyor (package.json), PRD'nin parantezindeki uWebSockets.js bu depoda hic yok. Olculen: pod 8.000 soketi TUTUYOR ama fan-out ile ayni JS iş parcacigini paylastigi icin 8.000'd… |
| `NFR-R1` | Yatay olcek — stateless servisler + RTM pod olcegi + Redis Pub/Sub fan-out | KISMİ ↓ | — | 'Redis Pub/Sub fan-out' ve 'RTM pod olcegi' gercekten var ve two-pod.test.ts ile korunuyor; ancak PRD satirinin ilk kalemi olan 'Stateless servisler' api tarafinda ACIKCA IHLAL EDILIYOR ve bu, yatay olcek altinda kullanici-gorunur bir bozulma uretiyor. Dosya … |
| `NFR-R2` | RTM dayaniklilik — otomatik reconnect (exponential backoff) + kacirilan olay sync (son event i… | **TAM** | — | — |
| `NFR-R3` | Veri kaliciligi — PostgreSQL + Redis (presence/unread/rate-limit) + vektor depo (RAG) + object… | KISMİ | Önemli | Dort ayagin ucu var: PostgreSQL (Prisma + partition + RLS), Redis (rate-limit, presence, fan-out bus, scheduler kilidi) ve vektor depo (pgvector; knowledge-service.ts embedding INSERT + `<=>` en yakin komsu aramasi). DORDUNCU AYAK EKSIK: object storage yalniz… |
| `NFR-R4` | Darbogaz yonetimi — Postgres yazim throughput'u ana darbogaz -> partition + read-replica + kuy… | KISMİ | Önemli | Uc kalemin ikisi var (partition + read-replica, ikisi de testli). KUYRUK YOK: depoda Kafka, RabbitMQ, BullMQ ya da herhangi bir mesaj kuyrugu bagimliligi yok (grep 0). Yerine gecen sey Postgres tablosunu Redis kilidiyle yoklayan bir zamanlayici (scheduler/job… |
| `NFR-R5` | Felaket kurtarma — yedekleme + point-in-time recovery; yedekler de retention politikasina tabi | KISMİ | Önemli | Yedekleme ayagi beklenenden guclu: gecelik `pg_dump -Fc` CronJob'u, ayri PVC, `concurrencyPolicy: Forbid`, BACKUP_RETENTION_DAYS ile butun-dosya silme (NFR-C8 ile hizali) ve en onemlisi bir GERI YUKLEME PROVASI (restore-drill.sh, `pg_restore --exit-on-error` … |
| `NFR-U1` | RTM login basari orani SLO %99.9 — hata butcesi ~43 dk / 30 gun | KISMİ | Önemli | Kosu-kapsamli bir TABAN var ve durustce oyle etiketlenmis (thresholds.js:22-27: "bir kosu bunu curutebilir, dogrulayamaz"): kirmizi basamakta bile nexa_rtm_login_success rate 1,00 (8253/8253). AMA SLO'nun kendisi — 30 gunluk pencere, %99.9 hesabi, ~43 dakikal… |
| `NFR-U2` | Core API kullanilabilirlik SLO %99.95 (5xx haric) — hata butcesi ~21 dk / 30 gun | KISMİ | Önemli | Ham SLI'lar dogru yerde: `http.server.requests` sayaci, `http.server.request.duration` histogrami ve `http.server.errors` (yalniz 5xx) sayaci, hepsi dusuk-kardinaliteli rota deseniyle etiketli (telemetry.ts:199-208, plugins/telemetry.ts:52-70). Health ayagi d… |
| `NFR-U3` | RTM mesaj fan-out p99 SLI/SLO < 500 ms | KISMİ | Önemli | NFR-P1 ile ayni sayiyi tekrarlayan satir; guzel olan sey iki tablonun sessizce ayrisamamasi — budgets.test.ts:100-105 §7.4'un NFR-U3 satirini AYRICA okuyup §7.1'in NFR-P1'iyle karsilastiriyor. Uretim tarafinda SLI de var: `rtm.fanout.delay` histogrami (teleme… |
| `NFR-U4` | Webhook teslimi (3 deneme icinde) SLO %99 | KISMİ | Önemli | MEKANIZMA tam: istek icinde 3 deneme (WEBHOOK_REQUEST_ATTEMPTS=3, saniye olcekli backoff), sonra satir `pending` + `next_attempt_at` ile zamanlayiciya devrediliyor ve toplam WEBHOOK_MAX_ATTEMPTS=8'e kadar dakika olcekli egriyle (4/8/16/32/64/128 dk, ~4 saat) … |
| `NFR-U5` | Enterprise SLA — sozlesmeli uptime taahhudu + kredi mekanizmasi | **YOK** | Küçük | Kodda karsiligi yok ve bu bilincli: packages/types/src/sla.ts:12-19 NFR-U5'i ADIYLA disarida birakiyor ("...no code in this repo can promise it, so it is out of scope and nothing here touches an invoice"). Depodaki `sla` kavrami tamamen baska bir sey — FR-MOD… |

### NFR-SEC-COMP — NFR Guvenlik + Gizlilik/Uyumluluk

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `NFR-S1` | Kimlik dogrulama (OAuth 2.1 + PKCE S256, PAT, customer token, bot token; implicit yok) | KISMİ ↓ | — | Denetcinin gosterdigi kanitlarin buyuk kismi dogru: OAuth 2.1 tarafi gercekten saglam — `createAuthorizationCode` S256 disindaki her methodu `oauthError('invalid_request')` ile reddediyor (oauth-service.ts:260-267), `code_verifier` 43-128 unreserved karakter … |
| `NFR-S2` | Token yonetimi (TTL <=1s, refresh, 25+25 sinir, revocation, hash'li saklama) | KISMİ | Küçük | Access token tarafi tam: TTL sema seviyesinde max 3600 sn'ye kilitli, 25'lik es-zamanli oturum tavani advisory lock ile atomik uygulaniyor, PAT/token yalniz SHA-256 ozeti olarak saklaniyor, parola scrypt. Eksik olan refresh yarisi: `#pruneOldest` `kind !== 'o… |
| `NFR-S3` | Yetkilendirme: rol (Owner/Admin/Agent) + scope, rota/API seviyesinde zorlama | **TAM** | — | — |
| `NFR-S4` | Tenant izolasyonu: org/license filtresi + PostgreSQL RLS + TenantScopedRepository + CI capraz-… | **TAM** | — | — |
| `NFR-S5` | IDOR korumasi: kisa base32 ID tek basina yetmez; her istekte org+scope; enumeration icin 404 | **TAM** | — | — |
| `NFR-S6` | Widget izolasyonu: cross-origin sandbox iframe, trusted domain allowlist, HTML escape, CORS | KISMİ ↓ | — | Dort kabul kriterinden ucu gercekten TAM — cross-origin sandbox iframe same-origin'i acikca reddediyor (loader.ts:97) ve `allow-scripts allow-same-origin allow-forms allow-popups` ile kuruluyor (loader.ts:115), postMessage relay'i hem `event.origin !== widget… |
| `NFR-S7` | Webhook guvenligi: HMAC-SHA256 imza + timestamp + nonce (+-5 dk) + timingSafeEqual; SSRF korum… | KISMİ | Önemli | Giden (outbound) bacak eksiksiz: imza `{timestamp}.{nonce}.{body}` uzerinden, ±5 dk pencere, constantTimeEqual, her gonderimde DNS yeniden cozumleme (TOCTOU), `redirect: 'manual'`, yalniz http(s), secret hicbir header/hata/donus degerinde yok. Eksik olan gele… |
| `NFR-S8` | Rate limiting: katmanli token-bucket (Redis), her 429'da Retry-After; RTM 10 bekleyen istek/so… | **TAM** | — | — |
| `NFR-S9` | PII / sifreleme: transit TLS 1.2+ / WSS + HSTS; at rest CMEK / sutun-sifreleme; CC masking (Lu… | KISMİ | Önemli | Ucu dorde bolunuyor. (1) CC masking TAM: Luhn kapili, yazma aninda, chats/customer/email-inbound uc yazma yolunda, testli. (2) Log/telemetri PII maskesi TAM ve kosulsuz. (3) At-rest sifreleme HIC YOK: `grep -rn 'createCipheriv|createDecipheriv|aes-256|ENCRYPT… |
| `NFR-S10` | File sharing guvenligi: izinli tur/boyut + AV taramasi; imzali URL object storage | **TAM** | — | — |
| `NFR-S11` | 2FA / SSO: 2FA (tum planlar, zorunlu politika); SSO OAuth; SAML 2.0 / OIDC + SCIM (Enterprise) | KISMİ | Önemli | 2FA (TOTP + kayit + kurtarma kodlari + workspace zorunlulugu) ve SAML 2.0 + SCIM bacaklari tam ve yogun test edilmis. OIDC bacagi tamamen yok: `grep -rn 'oidc|OIDC|OpenID Connect' apps/api/src apps/api/prisma/schema.prisma` sifir sonuc dondu; `SsoConnection` … |
| `NFR-S12` | Denetim izi: temel audit (login, rol degisimi, veri silme, webhook degisimi, son 30 gun) tum p… | **TAM** | — | — |
| `NFR-C1` | GDPR uyumu — DPA + SCC Module 2 + UK Addendum; Nexa=Processor; 10 gun alt-isleyen bildirimi + … | **YOK** ↓ | Önemli | Denetcinin kanit olarak gosterdigi dort dosyanin hicbiri bu PRD satirinin istedigi seyi karsilamiyor; hepsi baska satirlarin karsiligi: retention.ts NFR-C8'in, log-redact.ts NFR-S9'un, audit-log.ts NFR-S12'nin, plugins/auth.ts:374-383 ise NFR-C9'un kaniti. Ay… |
| `NFR-C2` | KVKK (TR) uyumu — GDPR uzerinden + yerel KVKK gereklilikleri; VERBIS | **YOK** | Önemli | Depoda KVKK'ya ya da VERBIS'e dair tek bir kod, konfigurasyon, belge ya da test yok: `grep -rln 'KVKK|VERBIS'` yalnizca urun-gereksinim-dokumani-PRD.md ve v2-derin-analiz altindaki analiz dosyalarini donduruyor — yani gereksinimin kendisi disinda hicbir karsi… |
| `NFR-C3` | CCPA/CPRA uyumu — Service Provider konumu | **YOK** | Küçük | Depoda CCPA/CPRA'ya dair hicbir sey yok: 'do not sell/share' tercihi, opt-out ucu, Service Provider taahhut metni ya da bunlara karsilik gelen bir veri modeli alani bulunmuyor. Bolge ayrimi (`us`/`eu`) veri sakinligini cozuyor ama CCPA'nin talep ettigi tuketi… |
| `NFR-C4` | HIPAA — sartli (imzali BAA + yalniz US hosting), Enterprise; EU/fra bolgesinde kapsam yok | **TAM** | — | — |
| `NFR-C5` | PCI DSS SAQ A — kart verisi saklanmaz; CC masking | **TAM** | — | — |
| `NFR-C6` | SOC 2 Type II hedefi (Enterprise fazi) | KISMİ | Küçük | Denetcinin isteyecegi kaniti URETEN kontroller var ve iyi kurulmus: CC6.1 icin erisim inceleme raporu, denetim izinde bosluksuz `chain_seq` + HMAC zinciri + disari verilen sayfa icin ayrik imza, SIEM aktarimi. Eksik olan program tarafi: kontrol matrisi, polit… |
| `NFR-C7` | ISO 27001 sertifikasyon hedefi (Enterprise fazi; RFP elenme riski) | **YOK** | Küçük | Depoda ISO 27001'e dair hicbir yapay yok: Ek-A kontrol eslesmesi, ISMS kapsam belgesi, risk degerlendirme kaydi ya da sertifikasyon hazirlik notu bulunmuyor. Guvenlik kontrollerinin cogu teknik olarak mevcut ama hicbiri bir ISMS cercevesine baglanmamis. |
| `NFR-C8` | Veri saklama: yapilandirilabilir (30/60/365/sinirsiz) + gercek hard-delete + right to erasure … | KISMİ | Önemli | Gercek hard-delete tarafi guclu: RLS altinda tenant tenant, batch'li, yas yuklemi zorunlu (`cutoffFor` sifir/negatif pencereyi reddediyor), audit_log icin append-only invaryantini bozmadan tek bir SECURITY DEFINER fonksiyonuyla, ve her sweep kendi audit satir… |
| `NFR-C9` | Veri bolgesi: dal (US) / fra (EU); region token+RTM'de zorunlu, kayitta immutable; yanlis bolg… | **TAM** | — | — |
| `NFR-C10` | Alt-isleyen seffafligi: kamuya acik alt-isleyen listesi + degisiklik bildirimi | **YOK** | Küçük | Depoda ne bir alt-isleyen listesi (kod, veri, sayfa ya da markdown olarak) ne de bir degisiklik bildirim mekanizmasi var: `grep -rln 'subprocessor|sub-processor|alt-isleyen'` yalnizca PRD ve v2 analiz dosyalarini donduruyor. NFR-C1'in 10 gun/5 gun penceresi d… |
| `NFR-C11` | Regule dikey (bahis/fintech): KYC/withdrawal/responsible-gambling sablon; yas/sorumlu-oyun pre… | KISMİ | Küçük | Maddenin genel amacli uc bacagi var ve testli: IP allowlist (workspace basina, her kimlikli istekte taze okunuyor, reddi audit'liyor), CC masking, denetim izi. Dikey'e ozgu iki bacak yok: (1) KYC / withdrawal / responsible-gambling icin hazir sablon (canned r… |
| `NFR-C12` | Erisilebilirlik uyumu: WCAG 2.1 AA beyani + VPAT (Enterprise satis) | KISMİ | Küçük | Olcum tarafi var: axe-core ile 22 yuzeyde otomatik WCAG taramasi, `serious`/`critical` sert kapi olarak, ayrica kontrast token testleri. Eksik olan maddenin kendi ciktisi: ne bir erisilebilirlik uygunluk BEYANI (accessibility statement) ne de bir VPAT/ACR bel… |

### NFR-A11Y-I18N-OBS — NFR Erisilebilirlik + Cok dillilik + Bakim/Gozlemlenebilirlik

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `NFR-A11Y1` | Standart — WCAG 2.1 AA (widget + panel), 2.2 hedefi | KISMİ | Küçük | WCAG 2.1 AA tarafi gercekten olculuyor ve kapi olarak kosuyor: axe-core `wcag2a/wcag2aa/wcag21a/wcag21aa` etiketleriyle, iki temada, ~25 panel ekrani + widget iframe'i + public KB uzerinde; istisna listesi bos; a11y.spec.ts:950 App.tsx router'ini parse edip t… |
| `NFR-A11Y2` | Renk bagimsiz durum — online/offline yalniz renkle degil, metin/ikonla da (1.4.1) | **TAM** | — | — |
| `NFR-A11Y3` | Kontrast — ikincil gri metin/grafik renkleri AA kontrast (1.4.3) | KISMİ ↓ | — | Gereksinim iki yari tasiyor: 'ikincil gri METIN' ve 'GRAFIK renkleri' AA kontrast. Metin yarisi gercekten TAM — tokens.test.ts --text-secondary/--text-tertiary'yi dort yuzeye karsi iki temada 4.5:1'e olcuyor (satir 110-125, 195-210) ve axe calisma zamaninda a… |
| `NFR-A11Y4` | Klavye — tum etkilesim klavyeyle; surukle-birak yeniden siralamaya klavye alternatifi (2.1.1) | KISMİ | Küçük | PRD'nin 'Nexa kritik' diye isaretledigi yari TAM: repodaki TEK surukle-birak yeniden siralama SkillEditor'daki adim listesi (grep ile dogrulandi) ve hem drag hem ok-tuslu butonlar ayni `moveStep`'ten geciyor, hareket sr-only aria-live=polite ile duyuruluyor, … |
| `NFR-A11Y5` | Odak & isim — focus visible (2.4.7); ikon-only butonlarda erisilebilir isim (4.1.2); target si… | KISMİ | Küçük | Uc alt-kriterin ikisi guclu: focus visible icin axe'in kurali OLMADIGI kabul edilip kendi olcumu yazilmis (outline rengi arkaplana kompozit edilerek 1.4.11'in 3:1'ine karsi olculuyor, `:focus-visible` gercekten eslesti mi diye ayrica kontrol ediliyor — a11y.t… |
| `NFR-A11Y6` | ⌘K & liste — komut paleti tam klavye gezilebilir; role/aria-current | **TAM** | — | — |
| `NFR-I18N1` | Widget dilleri — 45+ dil, RTL destegi | KISMİ | Önemli | Mekanizma tam ve genisletilebilir (yeni dil = bir <lang>.ts + index.ts'te bir satir), RTL gercekten uygulanmis (`doc.documentElement.dir = 'rtl'`, widget.ts:140) ve testli; BCP-47 bolge etiketi normalize ediliyor, eksik anahtar Ingilizce'ye dusuyor. Ama SAYI … |
| `NFR-I18N2` | Panel i18n — en az TR/EN (genisletilebilir); tema+i18n provider | **TAM** | — | — |
| `NFR-I18N3` | AI cok dilli — AI Agent Language/Tone/Answer length; talimat ~10.000 karakter | KISMİ | Önemli | Yapilandirma yuzeyi var ve dogru: `tone`, `languages` (String[]), `answer_length` (short/medium/long, persona JSON icinde) semada ve API'de mevcut, ProfileForm'dan duzenlenebiliyor, ve talimat siniri PRD'nin istedigi rakama birebir oturuyor — playbook.ts:42/4… |
| `NFR-I18N4` | Canli ceviri (Enterprise) — agent↔musteri gercek zamanli ceviri | **YOK** | Küçük | Kodda hicbir karsiligi yok: apps/api/src, apps/rtm/src, apps/widget/src ve packages/contract/src icinde ceviri motoru, ceviri saglayicisi ya da mesaj-basi dil donusumu aranmis, yalnizca i18n/locale eslesmeleri ve ilgisiz 'translates' kelimeleri cikmistir. Bu … |
| `NFR-I18N5` | Yerellestirme — tarih/saat/para/sayi bicimleri; saat dilimi (Company details) | KISMİ | Küçük | Bicim tarafi TAM: tarih/saat (`Intl.DateTimeFormat` dateStyle/timeStyle), para (`style:'currency'`, cent'ten bolunerek — float degil), sayi (`Intl.NumberFormat` binlik ayirici) ve gun adlari hepsi Intl uzerinden ve aktif locale'e `setFormatLocale` ile bagli; … |
| `NFR-M1` | Monorepo — pnpm/Turborepo; ortak @nexa/types (chat/thread/event/webhook kontratlari tek kaynak) | KISMİ | Küçük | pnpm workspace + Turborepo altyapisi tam (pnpm-workspace.yaml apps/* + packages/*, turbo.json global env/task grafigi) ve @nexa/types gercekten paylasilan tek kaynak olarak kullaniliyor: chat/thread/event kontratlari domain.ts:32-56'da (EVENT_TYPES, EventReci… |
| `NFR-M2` | Domain sinirlari — DDD bounded contexts (messaging/routing/configuration/ai/reports/billing/id… | KISMİ | Küçük | Dizin duzeyinde yapi var ve PRD'nin saydigi baglamlarin hepsi karsiliginı buluyor: apps/api/src/services altinda 31 baglam klasoru (chat, routing, ai, reports, billing, auth/identity, webhooks, tickets, retention, staffing...), apps/web/src altinda feature-sl… |
| `NFR-M3` | SOLID — transport↔domain ayrik; repository (DIP); skill step tipleri Strategy deseni (OCP) | KISMİ | Küçük | Uc iddianin ucu de kismen ya da hic tutmuyor. (1) Strategy/OCP: skill adim tipleri Strategy DEGIL, skill-engine.ts:192'de duz bir `switch (step.type)` — yeni adim tipi eklemek bu switch'i DEGISTIRMEYI gerektirir, ki bu OCP'nin tam tersi; bir handler tablosu/R… |
| `NFR-M4` | Test — Unit + Integration (testcontainers) + Contract (JSON Schema webhook/RTM) + E2E (Playwri… | KISMİ | Küçük | Alti test turunun altisi da fiilen var ve hacimli: apps/api/test/integration altinda 110 dosya, apps/e2e altinda 39 Playwright spec'i (musteri→routing→ajan→arsiv akisi demo-flow.spec.ts'te), apps/load'da uc k6 senaryosu, guvenlik tarafinda tenant-isolation + … |
| `NFR-M5` | Gozlemlenebilirlik — yapilandirilmis log (correlation request_id), OpenTelemetry izleme, metri… | KISMİ | Küçük | Bu maddenin govdesi gercekten saglam ve mock degil: pino ile yapilandirilmis JSON log + secret/PII redaction (server.ts:130-152, req.url maskeli ama korunuyor), `genReqId` ile x-request-id → log reqId → OTel span attribute `request_id` uclu koprusu (plugins/t… |

### SEMA-MIMARI — Veri modeli (8.4) + Ust duzey mimari/akislar (8.2, 8.3) + Fazlandirma (5)

| ID | Gereksinim | Verdict | Önem | Eksik olan |
|---|---|---|---|---|
| `SEMA-MIMARI.5.1` | §5.1 MVP (Faz 0) kapsami — canli sohbet cekirdegi | KISMİ ↓ | — | PRD §5.1 MVP tablosunun Inbox satiri composer'i madde madde sayiyor: "composer (canned `#`, emoji, attach, message-type)". Kodda dordunden ucu var — canned kisayolu (Composer.tsx:62-63 useCannedResponses/useMatchingResponses), attach (Composer.tsx:444-462 giz… |
| `SEMA-MIMARI.5.2` | §5.2 v1 (Faz 1) kapsami — AI Agent + omnichannel + mobil | KISMİ | Önemli | Guvenlik satirinin iki kalemi eksik: (a) "SSO (Google/Microsoft OAuth)" — kodda yalnizca SAML 2.0 baglantisi var (apps/api/prisma/schema.prisma:397 SsoConnection tamamen IdP EntityID/SSO URL/X.509 uzerine kurulu), auth.ts icinde google/microsoft/oidc gecen te… |
| `SEMA-MIMARI.5.3` | §5.3 v2 (Faz 2) kapsami — skill builder + Copilot BI + gelismis operasyon | KISMİ | Önemli | Otomasyon satirinin ana teslimi olan "gorsel node/edge Workflow builder (Workspace skill) + canli preview" yok — ayrintisi SEMA-MIMARI.5.5'te. Diger v2 kalemleri (chat topics, team performance, zamanlanmis export, public KB, skills-based routing, MCP, multibr… |
| `SEMA-MIMARI.5.4` | §5.4 Enterprise (Faz 3) kapsami — uyumluluk, olcek, kurumsal kontrol | KISMİ | Küçük | Uc kalem kodda yok: (a) "Sesli/telefon (voice/IVR), skills-based + IVR routing" — voice/IVR gecen tek uretim dosyasi yok, channels_type_check listesi de ses kanali icermiyor (20260722154008_domain_model/migration.sql:825); (b) "Gercek zamanli canli ceviri (ag… |
| `SEMA-MIMARI.5.5` | §5.5 Modul->Faz matrisi: Gorsel Workflow builder (nodes/edges) — v2 ana teslimi | **YOK** | Önemli | Yalnizca tablo var. schema.prisma:1425-1426 bunu kendi yorumunda itiraf ediyor: "The table exists so the schema matches PRD §8.4, but ADR-14 defers the editor to v2 — nothing writes here yet." Dogrulandi: packages/contract/openapi altinda tek bir workflow end… |
| `SEMA-MIMARI.8.1a` | §8.1 Iki yuzey: Agent SPA (kalici kabuk + client-side routing + React.lazy kod bolme) ve cross… | KISMİ | Küçük | Kalici kabuk (TopBar + Icon Rail + 3-pane + Right panel) ve cross-origin iframe widget tam; ancak PRD'nin ayni cumlede sart kostugu "kod bolme (React.lazy)" hic uygulanmamis — apps/web/src altinda `React.lazy` veya `lazy(` iceren tek bir satir yok, App.tsx:1-… |
| `SEMA-MIMARI.8.1b` | §8.1 Rota semantigi (ongorulebilir derin rotalar) | KISMİ | Önemli | PRD'nin blok halinde yazdigi rota agacinin neredeyse tamami yok. Gerceklesen: duz `/app/inbox`, `/app/customers`, `/app/team`, `/app/reports`, `/app/settings`. Eksikler: (1) `/app/inbox/chats/{all|my|queued|unassigned|supervised|archive}/{threadId}/{chatId}` … |
| `SEMA-MIMARI.8.1c` | §8.1 IA iyilestirmeleri (Tickets ust-seviye, AI tek ev, Settings ici arama) | **YOK** ↓ | Küçük | Denetcinin kendi bosluk metni ile verdicti celisiyor: "Uc iyilestirmenin ucu de karsilanmamis" deyip KISMI vermis. PRD §8.1'in son paragrafi bu maddenin kabul kriterlerini uc adet olarak sayiyor ve kodu acinca ucunun de hicbir karsiligi yok. (1) Tickets ust-s… |
| `SEMA-MIMARI.8.2AB` | §8.2 (A) Customer Edge + (B) Auth/Accounts — OAuth 2.1, customer token (cookie grant), PAT, bo… | **TAM** | — | — |
| `SEMA-MIMARI.8.2C` | §8.2 (C) Realtime/RTM — kalici WebSocket, login->subscribe->push, kacirilan olay senkronizasyo… | **TAM** | — | — |
| `SEMA-MIMARI.8.2D` | §8.2 (D) Backend Services — Chat/Messaging, Routing, Configuration, AI Orchestration, Reports,… | **TAM** | — | — |
| `SEMA-MIMARI.8.2E` | §8.2 (E) Data+Cache — PostgreSQL, Redis (presence/unread/fan-out/rate-limit), vektor depo (pgv… | KISMİ | Küçük | Dort bilesenden ucu tam. Object storage yalnizca arayuz + yerel disk uygulamasi (local-store.ts) olarak var; CDN karsiligi yok. object-store.ts:12-20 `signedUrl`/`delete` metotlarinin bilerek disarida birakildigini yaziyor. CLAUDE.md dis servisleri mock'lamay… |
| `SEMA-MIMARI.8.2F` | §8.2 (F) AI+MCP — LLM saglayicilar + disa donuk MCP server | **TAM** | — | — |
| `SEMA-MIMARI.8.3-1` | §8.3 Akis 1 — Auth / Session (signup->org+license+account+trial, OAuth 2.1 PKCE, RTM login, se… | **TAM** | — | — |
| `SEMA-MIMARI.8.3-2` | §8.3 Akis 2 — Sohbet yasam dongusu (chat -> thread -> event) | **TAM** | — | — |
| `SEMA-MIMARI.8.3-3` | §8.3 Akis 3 — AI Agent skill akisi (NL->adimlar, RAG, preview, readiness, skill_runs) | KISMİ | Küçük | Alti adim tipi (detect_intent, request_info, tag, summarize, send_message, transfer_to_team), preview'in gercek motoru calistirmasi, skill_runs logu ve `runsCount` artimi tam. Eksik olan yalniz PRD'nin 4. adimindaki readiness check'in bilgi-bankasi yarisi: pl… |
| `SEMA-MIMARI.8.3-4` | §8.3 Akis 4 — Omnichannel gelen kutusu (adapter normalizasyonu, channels tablosu, async->ticke… | **TAM** | — | — |
| `SEMA-MIMARI.8.3-5` | §8.3 Akis 5 — Faturalandirma / Trial (trial sayaci, usage_records, AI resolution, %80 uyari, t… | KISMİ | Önemli | 1., 2., 3. ve 5. adim tam (trial sayaci, aylik `usage_records` toplulastirmasi, ADR-09 AI-resolution sayaci, trial bitiminde `read_only` kapisi). 4. adimin yarisi eksik: PRD "Kota %80 -> proaktif uyari **e-postasi**" diyor; kodda yalnizca `GET /billing/usage`… |
| `SEMA-MIMARI.8.4a` | §8.4 Tablo envanteri — 36 cekirdek tablonun tamami | **TAM** | — | — |
| `SEMA-MIMARI.8.4b` | §8.4 Kritik kisit — chats kismi unique index (lisans+musteri basina 1 aktif chat) | **TAM** | — | — |
| `SEMA-MIMARI.8.4c` | §8.4 events — aylik RANGE partition + idx_events_thread / _chat / _license_time | **TAM** | — | — |
| `SEMA-MIMARI.8.4d` | §8.4 CHECK kisitlari (role, routing_status, event.type/author_type/recipients, ticket.status, … | **TAM** | — | — |
| `SEMA-MIMARI.8.4e` | §8.4 Kiraci izolasyonu — her tabloda organization_id/license_id + RLS zorlamasi (NFR-S4) | **TAM** | — | — |
| `SEMA-MIMARI.8.4f` | §8.4 knowledge_chunks — vector(1536) + ivfflat (vector_cosine_ops) indeksi | **TAM** | — | — |
| `SEMA-MIMARI.8.4g` | §8.4 ID stratejisi — chat/thread/event base32 kisa token, kullanici/org/AI uuid, grup integer | **TAM** | — | — |
| `SEMA-MIMARI.8.4h` | §8.4 Diger kritik indeks/unique kisitlari — threads(chat_id,created_at), tickets(license,statu… | **TAM** | — | — |
