# Task ID: 68

**Title:** 08.9.2 — Banned customers (IP/visitor yasak)

**Status:** done

**Dependencies:** 88 ✓

**Priority:** medium

**Description:** FR-MOD-08.9.2 · Should (v2).

**Details:**

FR-MOD-08.9.2 · Should (v2).
NEDEN: Customer.banned alanı + ban yazma yolu ✅ (F4); yönetim UI + IP yasağı eksik.
KAPSAM: banned müşteri yönetim ekranı + IP/visitor yasağı; yasaklı sohbet başlatamaz.
KK (birebir): "Yasaklı sohbet başlatamaz". BAĞLAM: PLAN §5.1 (§8 ratings/banned).
NOT (v2/v3 derinlik): kod tabanı bu faz başına değişmiş olabilir; başlamadan PLAN §F.0 mini denetimle gözden geçir ve gerekiyorsa subtask'lara böl (PLAN §5.1 bayatlama politikası).

[günlük 2026-07-28 GO-LIVE] v2'den öne çekildi (PLAN §4.5/GL-6 · §D52). Bağımlılık tm 88. KODA KARŞI (2026-07-28): visitor/customer yasağı ÇALIŞIYOR — Customer.bannedAt + segment banned + PATCH ban/unban (customers.ts:183-200) + token mint reddi (auth.ts:573 customer_banned) + chat start reddi (chat-service.ts:332). EKSİK: SecuritySettings.bannedCustomerIps kolonu şemada (schema.prisma:1126) ama HİÇBİR YERDE OKUNMUYOR (grep 0) → IP yasağı uygulanmıyor; Settings→Security yönetim yüzeyi yok. KAPSAM (PLAN §4.5/GL-6):
(a) IP enforcement: /customer/token mint + chat start yolunda istemci IP'si bannedCustomerIps ile karşılaştırılır → customer_banned zarfı.
(b) Kontrat: /settings/security GET/PATCH'e banned_customer_ips alanı (tm 1 deseni) + Settings→Security UI listesi.
(c) CustomersPage'de ban/unban aksiyonunun UI'dan erişilebilirliği doğrulanır; yoksa eklenir.
KAPANIŞ: PLAN §5 08.9.2 satırı ✅ + HANDOFF + commit + push + tm 68 done.

**Test Strategy:**

integration: yasaklı IP → token 403 + sohbet başlatamaz; yasaklı visitor → aynı (regresyon); unban → tekrar başlatabilir; CROSS-TENANT: A lisansının yasağı B'yi etkilemez (ZORUNLU). UI unit: liste düzenleme + ban/unban aksiyonu. Kontrat: contract-parity yeşil. DoD tam.

## Subtasks

### 68.1. 08.9.2-a1 — IP yasağı enforcement

**Status:** done  
**Dependencies:** None  

Token mint + chat start yolunda bannedCustomerIps kontrolü; customer_banned zarfı; integration + cross-tenant testler.

### 68.2. 08.9.2-a2 — Kontrat + Security UI + müşteri ban aksiyonu

**Status:** done  
**Dependencies:** 68.1  

banned_customer_ips kontrata + Settings→Security listesi; CustomersPage ban/unban UI doğrula/ekle; E2E görsel kanıt.
