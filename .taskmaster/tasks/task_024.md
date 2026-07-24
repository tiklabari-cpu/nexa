# Task ID: 24

**Title:** C8 — Veri saklama (retention) isi: suresi gecen veriyi budama (GDPR/KVKK) [MAX]

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Silme CASCADE var (Dilim 3) ama retention job YOK (§7.2 C8 ◐). PRD C1/C2/C8: saklama suresi gecmis veriyi (or. eski anonim ziyaretci/konusma/olay, .data mail) periyodik, tenant-kapsamli, geri-donusu-olmayan sekilde buda. Prod scheduler yok (sinir) — manuel/mock tetik.

**Details:**

1) Saklama politikasi: hangi tablo/kolon TTL'i (events/threads yasi, anonim customer, mail .data). PRD C8 + ADR-12 (tek bolge eu).
2) Job: apps/api/src altinda calistirilabilir script + package.json script (retention:run). GERCEK cron/prod scheduler YOK; SECURITY DEFINER + tenant dongusu, RLS-guvenli, batch + idempotent.
3) Guvenlik: yanlislikla cross-tenant veya suresi GECMEMIS satiri SILMEME — kesin WHERE + dry-run modu + sayac log.
PRD: NFR C1/C2/C8 · PLAN.md §7.2. Sinir: prod scheduler/DNS yok.

**Test Strategy:**

DoD kapisi + guvenlik: irreversible silme icin siki testler. Integration: suresi gecen silinir, gecmeyen KALIR, cross-tenant DOKUNULMAZ, idempotent (tekrar calistir -> ek etki yok), dry-run YAZMAZ (yalniz sayar). Efor [MAX] — geri donusu yok + compliance. Bitince PLAN.md §7.2 C1/C2/C8 ◐→✅ guncellenir.

## Subtasks

### 24.1. Saklama politikasi (tablo->TTL) + dry-run tasarimi

**Status:** pending  
**Dependencies:** None  

Hangi veri ne kadar tutulur; dry-run/uygula ayrimi.

### 24.2. retention:run script + SECURITY DEFINER tenant-dongulu budama

**Status:** pending  
**Dependencies:** 24.1  

package.json script; batch, idempotent, RLS-guvenli.

### 24.3. Guvenlik guard'lari

**Status:** pending  
**Dependencies:** 24.2  

Kesin WHERE; dry-run; silinen sayaci log; cross-tenant koruma.

### 24.4. Testler: integration (gecen siler / gecmeyen kalir / cross-tenant / idempotent / dry-run)

**Status:** pending  
**Dependencies:** 24.3  

Tam kapsama negatif+pozitif.
