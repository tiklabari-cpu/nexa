# Task ID: 87

**Title:** GL-3 · F0-KAPAT — Faz-0 §F.00 kapanış turu (§F.1 tam 10 madde) [MAX]

**Status:** done

**Dependencies:** 85 ✓, 86 ✓

**Priority:** high

**Description:** Faz-0'ın 9 kapanış alt-görevi (T1-a/T3-a/T3-b/T4-a/T4-b/T5-a/T6-a/T6-b/T7-a) tm 27-31'de done; ama PLAN üst tablosu hâlâ '45 ✅ · 6 ◐ — ❌ AÇIK' diyor ve §F.1'in 10 maddesi TAM SÜRÜM hiç koşulmadı. Faz kendiliğinden kapanmaz — kapanış bir turdur. PLAN §4.5/GL-3 · §D52. [MAX]: kanıtsız 'geçti' yok (§F.2 uyarısı; §1.3'teki yanlış 'bitti' raporu bir kez yaşandı).

**Details:**

1) SAYAÇ: Faz-0 Must sayacı PLAN §3 tablolarından SAYILARAK doğrulanır (beklenen 51 ✅ · 0 ◐ · 0 ⬜; elle yazılmaz — §1.2 sayım notu). Uyuşmazlık varsa DUR → satır satır incele.
2) §F.1 TAM 10 MADDE (her biri koda karşı, kanıt HANDOFF'a):
(1) Kapsam süpürmesi — PRD §6 Faz-0 satırları tek tek kodda aranır; her satır ✅ veya gerekçeli ⛔/🔒, ◐ SIFIR.
(2) Faz sızıntısı — öne çekilmiş belgesiz iş var mı (belgeliler: Playbook §1.3, GL-5/6/7 §D52).
(3) NFR kapıları — §7.2'nin Faz-0 kapsamındakiler ÖLÇÜLÜR (gecikme, bundle bütçesi P3, a11y taraması, cross-tenant negatifler); tahmin yazılmaz.
(4) Şema artıkları — §8 tablolarının tüketicisi var mı (workflows tablosu ADR-14 gereği bilinçli UI'sız — gerekçeli).
(5) Kontrat bütünlüğü — contract-parity koş.
(6) Sessiz borç — TODO/FIXME/XXX/@ts-expect-error/skip(/only( grep'i, kapatılmış lint kuralları; LİSTELE.
(7) Ölü kod & erişilemez ekran — route'suz bileşen, çağrılmayan servis, UI'sız endpoint.
(8) Doküman tazeliği — PLAN/HANDOFF/README gerçekle uyuşuyor mu (test/endpoint sayıları, 'sıradaki adım').
(9) Temiz kurulum provası — sıfırdan make dev → migrate → seed → demo akışı.
(10) Kapsam dışı doğrulaması — §9'un 10 maddesi yanlışlıkla yapılmamış (özellikle gerçek ödeme, telif içerik).
3) PLAN üst tablo Faz-0 satırı ✅ KAPALI + sayaç güncel; başlık altındaki 'Faz-0 kapanmadı' bloğu tarihçeye çevrilir.
4) §F.2 raporu üretilir (tamamlanan kapsam / yarım kalanlar / bilinçli yapılmayanlar / sessiz borç / sapmalar / açık sorular) → HANDOFF.
PLAN §F.00 (satır ~470) · §F.1/§F.2 · §4.5/GL-3 · §D52.

**Test Strategy:**

[MAX] Her §F.1 maddesinin kanıtı (komut çıktısı / test adı / ölçüm) HANDOFF'a madde madde yazılır; kanıtsız madde = tur bitmemiştir. Tam DoD kapısı (typecheck/lint/unit/integration/build/e2e exit 0) + §F.1/9 temiz kurulum provası. Bulunan her açık: küçükse bu turda kapat + §D'ye, büyükse yeni tm görevi aç (bu görev bloklanmaz, raporlar). KAPANIŞ: PLAN üst tablo Faz-0 ✅ KAPALI + §F.2 raporu HANDOFF'ta + commit + push + tm 87 done.

## Subtasks

### 87.1. Must sayacı sayımı + uyuşmazlık kontrolü

**Status:** done  
**Dependencies:** None  

PLAN §3 satırlarını say (beklenen 51✅·0◐·0⬜); üst tabloyla ve bu sayımla çelişki varsa satır satır çöz.

### 87.2. §F.1 maddeleri 1-5

**Status:** done  
**Dependencies:** 87.1  

Kapsam süpürmesi (PRD §6 Faz-0) + faz sızıntısı + NFR ölçümleri + şema artıkları + contract-parity; kanıtları topla.

### 87.3. §F.1 maddeleri 6-10

**Status:** done  
**Dependencies:** 87.2  

Sessiz borç grep + ölü kod + doküman tazeliği + temiz kurulum provası (make dev) + kapsam dışı doğrulaması; kanıtları topla.

### 87.4. Faz kapatma + §F.2 raporu

**Status:** done  
**Dependencies:** 87.3  

Üst tablo Faz-0 ✅ KAPALI; §F.2 Türkçe raporu HANDOFF'a; commit + push.
