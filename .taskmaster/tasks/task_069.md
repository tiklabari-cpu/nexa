# Task ID: 69

**Title:** 08.9.3 — Spam filtre [MAX]

**Status:** done

**Dependencies:** 88 ✓

**Priority:** medium

**Description:** FR-MOD-08.9.3 · Should (v2) · [MAX] ↑.

**Details:**

FR-MOD-08.9.3 · Should (v2) · [MAX] ↑.
↑ GEREKÇE: dış girdi sınırı + otomatik filtre (yanlış-pozitif/negatif riski). Güvenlik kuralı — tam derinlik serbest (§5.1).
KAPSAM: spam sohbet/ticket otomatik filtre (SecuritySettings.spamFilterEnabled zaten var, email-inbound kullanıyor).
KK (birebir): "Spam sohbet/ticket otomatik filtre". BAĞLAM: PLAN §5.1, §C-A9 (email spam bağı).
NOT (v2/v3 derinlik): kod tabanı bu faz başına değişmiş olabilir; başlamadan PLAN §F.0 mini denetimle gözden geçir ve gerekiyorsa subtask'lara böl (PLAN §5.1 bayatlama politikası).

[günlük 2026-07-28 GO-LIVE] v2'den öne çekildi (PLAN §4.5/GL-7 · §D52). Bağımlılık tm 88. KODA KARŞI (2026-07-28): spamFilterEnabled var ve YALNIZ email-inbound.ts kullanıyor (sağlayıcı spam bayrağı); chat yolunda filtre yok. KAPSAM (PLAN §4.5/GL-7):
(a) DETERMİNİSTİK kural motoru services/security/spam-filter.ts — link yoğunluğu, tekrar oranı, karakter/entropi eşiği, blocklist; LLM YOK (test edilebilirlik + yanlış-pozitif denetimi).
(b) Widget chat start / ilk mesaj yoluna bağlanır (spamFilterEnabled kapısı); email yolundaki mevcut kanca AYNI motora bağlanır (tek doğruluk kaynağı).
(c) Spam kararının davranışı (sessiz drop mu, zarflı red mi) task içinde kararlaştırılır → PLAN §C'ye yazılır.
KAPANIŞ: PLAN §5 08.9.3 satırı ✅ + karar §C'de + HANDOFF + commit + push + tm 69 done.

**Test Strategy:**

[MAX] NEGATİF ÖNCE: normal müşteri mesajı GEÇER (yanlış-pozitif sınırı — gerçekçi örnek seti: kısa selamlama, link içeren meşru soru, tekrar eden ama meşru mesaj). SONRA: spam örnek seti düşer; filtre kapalıyken geçer; email + chat İKİ yol da aynı motordan; cross-tenant ayar izolasyonu. DoD tam.

## Subtasks

### 69.1. 08.9.3-a1 — deterministik kural motoru (negatif önce)

**Status:** done  
**Dependencies:** None  

spam-filter.ts kural motoru + unit tablo-testleri; yanlış-pozitif sınırı ÖNCE kırmızı görülür.

### 69.2. 08.9.3-a2 — chat + email yollarına bağlama

**Status:** done  
**Dependencies:** 69.1  

Widget chat start/ilk mesaj + email-inbound aynı motora; davranış kararı §C'ye; integration iki yol + cross-tenant.
