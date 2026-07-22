# PRD Yeterlilik Değerlendirmesi — Nexa (LiveChat / Text klonu)

**Değerlendiren:** Claude · **Tarih:** 2026-07-21 · **Girdi:** `urun-gereksinim-dokumani-PRD.md` (1420 satır) + destekleyici paket (rapor-1, rapor-2, v2-01…05, ER diyagramı, `_evidence/`)

---

## 1. Karar

**Evet — PRD, çalışan bir klonun kodlama planını yazmaya başlamak için yeterli, hatta beklenenin çok üstünde.** Bu bir "gereksinim taslağı"nın ötesinde: gerçek veri modeli (DDL), gerçek API kontratları (JSON örnekleriyle), RTM protokolü, güvenlik/scope modeli ve destekleyici raporlarda üretim-seviyesi iskelet kod içeriyor. MVP ve v1'i kodlamaya bugün başlanabilir.

Eksikler klonun **başlamasını engellemiyor**; üç kategoriye düşüyor: (a) tasarımca bilinçli ertelenen UI/UX katmanı, (b) kaynaktan gözlemlenemeyen ve zaten her klonun kendi kararı olan birkaç sayısal/kontrat detayı, (c) hiçbir PRD'nin baştan tam yazamayacağı doğası gereği Ar-Ge olan parçalar (AI skill derleme, RAG ayarı). Bunların hepsi teknik tasarım aşamasında çözülür ve çoğu zaten PRD'de (§11.2 Q1–Q12) ve `v2-03 §12`'de açıkça işaretlenmiş.

Tek gerçek **iç tutarsızlık uyarısı:** eski ER diyagramı (`LiveChat_ER_Diyagram.mermaid`) ile PRD §8.4 şeması çelişiyor — kod için tek doğruluk kaynağı PRD §8.4 + rapor-2 §5.3 olmalı (detay §5, G8).

---

## 2. Kapsam Haritası — PRD ne kadar örtüyor

| Boyut | Durum | Kod için hazırlık |
|---|---|---|
| Özellik envanteri (MOD-00…13 + çapraz kesit) | Tam — her özellik amaç/akış/KK/bağımlılık/kaynak etiketiyle | **Yüksek** |
| Kullanıcı hikâyeleri + kabul kriterleri | 15 US, her biri ölçülebilir KK ile | **Yüksek** |
| Veri modeli | 30+ tablo, kolon/PK/FK/CHECK/indeks/partition + ER; rapor-2'de tam DDL | **Yüksek** |
| API kontratı | REST RPC deseni + auth (OAuth2.1/PKCE, PAT, customer/bot token) + ~63 scope + 23 hata tipi + gerçek JSON istek/yanıt + OpenAPI parçası | **Yüksek** |
| Realtime (RTM/WebSocket) | Push event kataloğu (~40), login/subscribe akışı, soket limitleri; WS URL "Çıkarım" | **Orta-Yüksek** |
| chat → thread → event modeli | Net tanımlı; yaşam döngüsü akışları (§8.3) | **Yüksek** |
| AI Agent + RAG | Skill motoru, adım tipleri, Knowledge (pgvector 1536), readiness check | **Orta** (derleme/tuning Ar-Ge) |
| Güvenlik / uyumluluk | RLS tenant izolasyonu, STRIDE risk matrisi, HMAC/webhook/SSRF, GDPR/KVKK/HIPAA/PCI/SOC2/ISO | **Yüksek** |
| NFR (perf/ölçek/a11y/i18n) | ID'li, ölçülebilir hedefler; SLO'lar "Çıkarım/öneri" | **Yüksek** (hedefler onaylanmalı) |
| Fazlandırma + efor | MVP/v1/v2/Ent. + kişi-ay + karmaşıklık matrisi | **Yüksek** |
| Fiyat / faturalama | Koltuk+tüketim modeli, metering, trial; Stripe wiring kavramsal | **Orta-Yüksek** |
| UI/UX görsel tasarım | **Bilinçli kapsam dışı** (§11.1.10); 66 ekran görüntüsü var, tasarım sistemi yok | **Düşük** (bkz. G1) |

**Doğrulama:** PRD'nin veri modeli (§8.4) ile rapor-2'nin DDL'i (§5.3) **birebir tutarlı** (chat.id = `varchar(12)` base32, `uq_one_active_chat` kısmi unique index, `events` aylık RANGE partition, `chat_access` join tablosu). API deseni, scope listesi, hata tipleri ve webhook kataloğu da kaynaktan sadık şekilde taşınmış.

---

## 3. Neden Beklenenin Üstünde (güçlü yönler)

Bu paket sıradan bir PRD değil; kodlamayı hızlandıran üç şey içeriyor:

**Gerçek DDL, tahmin değil.** rapor-2 §5.3'te çalıştırılabilir PostgreSQL DDL var (partition, indeks, CHECK kısıtları, kısmi unique index dahil). Şema kararlarının çoğu verilmiş.

**Gerçek API kontratları.** v2-03, `send_event` / `start_chat` / `customer/token` / reports gibi çağrıları gerçek JSON istek-yanıtla belgeliyor; ayrıca klon için önerilen modern REST+WS kontratını (OpenAPI parçası, hata zarfı, `Retry-After` eklemesi) veriyor. Veri yapıları (Chat/Thread/Event/User/Rich Message/Access/Properties/Statistics) alan-alan çıkarılmış.

**Başlangıç iskelet kodu.** rapor-2 §7'de Node.js **ve** Go RTM sunucu iskeleti, auth + `send_event` REST endpoint'i, React müşteri widget bileşeni, örnek Zustand store, `ChatListItem` bileşeni, Dockerfile ve docker-compose var. MVP'nin "boş sayfa" maliyeti düşük.

**Dürüst boşluk beyanı.** v2-03 §12 ve PRD §11.2, neyin gözlemlenemediğini/kararlaştırılması gerektiğini açıkça listeliyor — yani paket kendi sınırlarını biliyor. Bu, gizli boşluklardan çok daha az risklidir.

---

## 4. Boşluk Analizi

| # | Boşluk | Kategori | Kodlama planını engeller mi? | Not / kaynak |
|---|---|---|:--:|---|
| G1 | UI/UX tasarım sistemi (tasarım token'ları, bileşen spec'i, spacing/tipografi, boş/hata/yükleme durumu görselleri) | Tasarım | **Hayır** (fonksiyon için); fidelity için **evet** | Bilinçli kapsam dışı (§11.1.10). 66 ekran görüntüsü referans var, ama üretime dönük tasarım katmanı ayrı çıkarılmalı |
| G2 | Sayısal REST rate-limit değerleri + `Retry-After` politikası | Kontrat detayı | Hayır | Kaynakta hiç yayınlanmamış (`v2-03 §12.2`, PRD Q11). Ekip kendi belirler |
| G3 | Routing atama algoritmasının kesin kuralı (uygun ajanlar arasından seçim: round-robin / yük-tabanlı / priority) | Karar | Hayır | Priority (first/normal/last/primary), concurrent limit ve fallback var; seçim algoritması netleştirilmeli |
| G4 | AI Agent NL→adım derlemesi + RAG ayarı (chunking, top-k, rerank, prompt tasarımı) | Doğası gereği Ar-Ge | Hayır (v1 fazına ait) | Adım tipleri ve embedding boyutu (1536) belli; orkestrasyon build-time R&D — hiçbir PRD tam yazamaz |
| G5 | Kanal adaptörü sağlayıcı-özel detayı + onaylar (WhatsApp Business/Meta app review, Twilio, Messenger OAuth) | Dış bağımlılık | Hayır (v1) | Bağımlılık D3'te var; entegrasyon detayı ve onay süreçleri harici, takvim riski taşır |
| G6 | Stripe metered billing wiring (usage report, proration, ledger) | Kontrat detayı | Hayır | Model ve sayaçlar (`usage_records`) net; Stripe'a özel bağlantı build aşamasında |
| G7 | Global/Customer Accounts API tam endpoint yüzeyi | Kontrat detayı | Hayır | Kaynak ReDoc SPA olduğu için taranamadı (`v2-03 §12.1`). Klon kendi auth'unu tasarladığı için düşük etkili |
| G8 | **İç tutarsızlık:** eski ER diyagramı vs PRD §8.4 şeması | Tutarlılık | Hayır (çözüldüyse) | Eski `LiveChat_ER_Diyagram.mermaid` chat'i `uuid id` + `group_id` + `status` ile modelliyor; PRD §8.4/rapor-2 §5.3 ise `varchar(12)` base32 + `chat_access` join + `active`+partial unique index. **Tek doğruluk kaynağı: PRD §8.4 + rapor-2 §5.3.** Eski mermaid'i kullanma |
| G9 | Mesaj kuyruğu / önbellek teknoloji seçimi (Kafka vs RabbitMQ; Redis kullanım detayı) | Karar | Hayır | Kavramsal olarak var (NFR-R4); somut seçim mimari kararı (`v2-03 §12.5`) |
| G10 | Backend dili kararı (Node.js vs Go RTM çekirdeği için) | Karar | Hayır | PRD Q3; her ikisi için de iskelet kod mevcut, hibrit mümkün |

**Özet:** Engelleyici (blocker) hiçbir boşluk yok. G1 tek başına "iyi görünen" bir klon için en büyük eksik katman, ama fonksiyonel kodlamayı durdurmaz ve zaten ayrı bir tasarım dokümanı olarak planlanmış.

---

## 5. Kodlama Planından Önce Kilitlenmesi Gereken Kararlar

Bunlar "eksik bilgi" değil, **karar**dır; kodlama planına girmeden netleşmeleri planı sağlamlaştırır. PRD §11.2 (Q1–Q12) ve v2-03 §12 ile hizalı:

1. **Backend dili / RTM çekirdeği:** Node.js mi, Go mu, hibrit mi (Q3). MVP kritik yolu buna bağlı.
2. **Tek şema doğruluk kaynağı:** PRD §8.4 + rapor-2 §5.3 sabitlenmeli; eski ER mermaid arşive alınmalı (G8).
3. **API kontrat dondurma:** Action-tabanlı (orijinale sadık) mı, kaynak-tabanlı REST (`/api/v1/...`) mi, yoksa v2-03 §11'deki hibrit mi. `@nexa/types` tek kaynak (Q10).
4. **"AI resolution" kesin tanımı** — billing sayacı ile Reports "Automated" hizası (Q2). Gelir modeli buna bağlı.
5. **Rate-limit sayısal değerleri + `Retry-After`** politikası (Q11, G2).
6. **Routing atama algoritması** — priority + concurrent limit üstüne seçim kuralı (G3).
7. **Veri bölgesi + KVKK** — US/EU (+TR?) barındırma; region immutable kuralı (Q5).
8. **Trial bitiş politikası** — salt-okuma mı tam kilit mi (Q4/C6).
9. **Fiyat yüzeyi** — nihai kademeler + AI aşım birim fiyatı (Q1); tek şeffaf yüzey ilkesi korunacak.
10. **Skill vs görsel Workflow paradigması** — tek mi iki editör mü (Q7).

---

## 6. Öneri

Kodlama planına geçilebilir. Önerilen sıra:

**Önce** yukarıdaki 10 kararı (özellikle 1–6) kısa bir "Mimari Karar Kaydı"na bağla — bunlar planın iskeletini belirler. **Sonra** planı PRD'nin faz yapısına oturt: MVP kritik yolu = RTM WebSocket + chat→thread→event + widget + auth/tenant izolasyonu (RLS) + routing + inbox 3-pane. rapor-2 §7 iskelet kodu MVP'nin başlangıç noktası olabilir.

UI/UX tasarım katmanı (G1) MVP kodlamasıyla **paralel** ilerleyebilir; fonksiyonel gelişimi bloklamaz ama ürün "iyi çalışan bir kopya" hissi için gereklidir — ayrı bir tasarım dokümanı olarak planlanmalı.

Doğası gereği Ar-Ge olan parçalar (AI skill derleme + RAG, G4) v1 fazına ait; MVP bunları beklemeden ilerler. Kanal adaptörleri (G5) ve onay süreçleri erken başlatılmalı çünkü takvim riski dışsaldır.

---

*Değerlendirme sonu. Sonraki adım: kodlama planı (kararlar 1–6 kilitlendikten sonra).*
