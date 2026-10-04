# Task ID: 70

**Title:** 08.9.5 — CC masking (Luhn, yazma anında) [MAX]

**Status:** done

**Dependencies:** 88 ✓

**Priority:** high

**Description:** FR-MOD-08.9.5 · Should (v2) · [MAX] ↑ · NFR-C5/S9.

**Details:**

FR-MOD-08.9.5 · Should (v2) · [MAX] ↑ · NFR-C5/S9.
↑ GEREKÇE: PII sınırı — DB/log'a maskeli yazma (yazma anında, yalnız UI değil). Güvenlik kuralı — tam derinlik serbest.
KAPSAM: kart no Luhn tespiti + yazma anında maskeleme (event/log); PCI SAQ A.
KK (birebir): "PCI SAQ A; DB/log'a maskeli yazılır (yalnız UI değil)". BAĞLAM: PLAN §5.1.
NOT (v2/v3 derinlik): kod tabanı bu faz başına değişmiş olabilir; başlamadan PLAN §F.0 mini denetimle gözden geçir ve gerekiyorsa subtask'lara böl (PLAN §5.1 bayatlama politikası).

[günlük 2026-07-28 GO-LIVE] v2'den öne çekildi (kullanıcı kararı; PLAN §4.5/GL-5 · §D52). Bağımlılık tm 88 (v1 kapanışı) — faz disiplini. KODA KARŞI (2026-07-28): maskeleme yok; yalnız payment-method-service.ts kendi maskeli alanlarını tutuyor (farklı iş). KAPSAM (atomik kırılım PLAN §4.5/GL-5):
(a) Saf lib apps/api/src/lib/cc-mask.ts — 13-19 haneli aday diziler (boşluk/tire ayraçlı varyantlar dahil) yakalanır, Luhn doğrulanır, geçenler '**** **** **** 1234' biçimine maskelenir.
(b) TÜM event yazım yolları kaynağında maskeler: chats.ts (ajan eventi) + customer.ts (widget eventi + pre-chat custom_fields) + email-inbound.ts (konu). Kaynakta maskelendiği için RTM push + transcript e-postası otomatik maskeli.
(c) Yan kanal doğrulaması: request log, audit_log meta, FileMailer çıktıları (.data/mail), skill/AI yollarına giden metin — ham PAN sızmaz (integration kanıtı). NFR-C5/S9 satırı güncellenir.
KAPANIŞ: PLAN §5 08.9.5 satırı ✅ (§4.5/GL-5 referansıyla) + §7.2 NFR-C5/S9 + HANDOFF + commit + push + tm 70 done.

**Test Strategy:**

[MAX] NEGATİF ÖNCE yazılır ve kırmızı görülür: (a) Luhn GEÇMEYEN 16 hane (sipariş no) maskelenMEZ — yanlış-pozitif sınırı; (b) telefon/UUID/timestamp dokunulmaz. SONRA pozitifler: geçerli PAN (ayraçlı/ayraçsız) → DB'de ham PAN YOK (doğrudan SQL ile doğrula), maskeli metin var; RTM push + .data/mail + audit_log meta'da ham PAN yok. Cross-tenant + iki composer (ajan/widget) + email yolu. DoD tam.

## Subtasks

### 70.1. 08.9.5-a1 — cc-mask çekirdeği (negatif önce)

**Status:** done  
**Dependencies:** None  

lib/cc-mask.ts: aday yakalama + Luhn + maskeleme; unit tablo-testleri — yanlış-pozitif sınırı ÖNCE kırmızı görülür.

### 70.2. 08.9.5-a2 — yazım yollarına bağlama

**Status:** done  
**Dependencies:** 70.1  

chats.ts + customer.ts (+pre-chat custom_fields) + email-inbound.ts kaynağında maskeler; integration: DB'de ham PAN yok (SQL doğrulama).

### 70.3. 08.9.5-b — log/yan-kanal doğrulaması

**Status:** done  
**Dependencies:** 70.2  

request log + audit_log + .data/mail + skill/AI giriş metni; ham PAN sızmaz integration kanıtı; NFR-C5/S9 güncelle.
