# Task ID: 113

**Title:** reports-billing.test.ts saat kayması flake'ini kapat — "şimdi" yazılan satırlar rapor penceresinin dışına düşüyor

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** apps/api/test/integration/reports-billing.test.ts'te fixture satırları kolon varsayılanı (Postgres CURRENT_TIMESTAMP) ile yazılıyor; rapor penceresinin `to` değeri ise API sürecinin `new Date()`'i. Postgres saati Node'un ~10 ms önünde seyredebildiği için taze satır pencerenin DIŞINA düşüyor ve rapor 0 dönüyor. Fixture'lar `created_at`i açıkça geçmişe damgalayarak bağışıklanır.

**Details:**

KÖK NEDEN (tm 75.4'te ölçüldü, tahmin değil): probe koşusunda satır `created_at=2026-08-10T20:22:37.140Z` ile yazıldı, aynı anda yapılan isteğin penceresi `range.to=2026-08-10T20:22:37.139Z` çıktı — yani DB saati Node sürecinin 9-10 ms önündeydi ve `created_at <= to` filtresi satırı eledi. 40 iterasyonluk probe'ta 13 kayıp ölçüldü; `reports-billing.test.ts`in Reviews bloğu tek başına ~%20-30 koşuda kırmızıya düşüyordu. ÜRÜN HATASI DEĞİL: pencere mantığı (`created_at <= to`) doğru, kusur test ortamının saat kaymasında. Belirti imzası nettir: `createdAt`i AÇIKÇA geçmişe veren testler (ör. "buckets ratings by UTC day", 5/2 gün öncesi) hep yeşil; "şimdi" yazan her test aynı koşuda birlikte kırmızı.

TARİHÇE: tm 75.2 ve tm 75.3 HANDOFF notları bu dosyada "tekrar üretilemeyen flake" kaydetti; kök neden ilk kez tm 75.4'te ölçüldü. tm 75.4 yalnız KENDİ eklediği tracked-sale fixture'ını bağışıkladı (`created_at`i 1 dk geriye damgalayarak) — kapsam disiplini (CONVENTIONS §5) gereği dosyanın geri kalanına dokunmadı.

KAPSAM: `apps/api/test/integration/reports-billing.test.ts` içinde kolon varsayılanına bırakılmış fixture yazımlarını açık `createdAt` damgasına çevir. Bilinen kırılganlar: Reviews bloğundaki `rate()` yardımcısı (CSAT donut + previous-period testleri), "period comparison (07.3.1)" bloğu (goal achievements), CSV export bloğundaki reviews-by-day. Aynı desen dosyanın diğer rapor bloklarında da olabilir — `owner.<model>.create` çağrılarında `createdAt`/`achievedAt`/`startedAt` verilmeyen yerleri tara. Tercih edilen çözüm tek yerde: fixture yardımcılarına ortak bir "biraz önce" sabiti (ör. `const JUST_NOW = () => new Date(Date.now() - 60_000)`), test başına elle tarih değil.

DEĞERLENDİR (bir seçenek, zorunlu değil): aynı kayma `apps/api/test/integration/` altındaki diğer pencere-tabanlı süitleri de vurabilir (goals, traffic, home). Bu görev reports-billing'i kapatır; genel bir tarama bulgusu çıkarsa ayrı görev aç.

KAPSAM DIŞI: Ürün kodunda `resolveRange`/`to` semantiğini değiştirmek — saat kaymasını ürün davranışıyla örtmek yanlış çözümdür, pencere mantığı doğru. Docker/WSL saat senkronizasyonunu ayarlamak (repo dışı, ortam işi).

**Test Strategy:**

Doğrulama ölçümle: `cd apps/api && npx tsx scripts/with-test-datastores.ts vitest run --dir test/integration reports-billing` komutunu art arda EN AZ 10 kez koştur; 10/10 exit 0 olmalı. Değişiklikten önce aynı komutun kırmızı verdiği bir koşu kaydedilirse (kanıt) daha iyi. Ek olarak `pnpm -w test:integration` tam süiti bir kez yeşil. Testlerin iddiaları zayıflatılmamalı: damgalanan tarih pencere İÇİNDE kalır, pencere dışını sınayan testler (45 gün öncesi vb.) aynen korunur.
