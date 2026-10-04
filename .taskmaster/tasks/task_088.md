# Task ID: 88

**Title:** GL-4 · V1-KAPAT — v1 §F.00 kapanış turu (Must kapısı + §F.1 + tam E2E) [MAX]

**Status:** done

**Dependencies:** 87 ✓

**Priority:** high

**Description:** v1 Must kapısı (05.1/05.3/05.5 · 06.1-06.4 · 08.5.4-.6 · 08.8.4 · 02.1.2 · 04.2 · 13.8-mobil-push 🔒) tm 85 sonrası 0 ◐/⬜ bekleniyor; kapanış turu hiç koşulmadı. GL-5/6/7 (öne çekilen güvenlik kalemleri) bu görev bitmeden BAŞLAYAMAZ (faz disiplini, §D52). PLAN §4.5/GL-4 · §D52. [MAX].

**Details:**

1) SAYAÇ: v1 Must listesi PLAN §4 satırlarından SAYILARAK doğrulanır: 05.1/05.3/05.5 · 06.1/06.2.x/06.3.x/06.4 · 08.5.4-.6 · 08.8.4 · 02.1.2 · 04.2 (hepsi ✅ beklenir) + 13.8-mobil-push (🔒 gerekçeli — bloklamaz).
2) §F.1 TAM 10 MADDE v1 kapsamı için (tm 87 ile aynı disiplin). ÖZEL: faz-sızıntısı maddesinde GL-5/6/7 öne çekmesi §D52'de BELGELİ sapmadır, ihlal değildir — belgesiz BAŞKA sızıntı aranır.
3) Tam E2E süiti koşulur — HANDOFF 2026-07-28 notu: son bakım penceresi tam kapıyı koşmadı; borç burada kapanır.
4) Should kalemlerinden ⬜ kalanlar §F.2 raporunda İSMEN listelenir (06.3.2-bulk dahil; tm 85'in eklediği satır).
5) PLAN üst tablo v1 satırı kapatılır; §F.2 raporu → HANDOFF; kullanıcıya 'GO-LIVE hardening (tm 70/68/69) hazır' bildirilir.
PLAN §4.4 v1 kapanış kapısı (satır ~562) · §4.5/GL-4 · §D52.

**Test Strategy:**

[MAX] tm 87 ile aynı kanıt disiplini: her §F.1 maddesi kanıtlı, HANDOFF'a madde madde. Tam DoD kapısı + TAM E2E süiti (Playwright, tüm spec'ler) exit 0. KAPANIŞ: PLAN üst tablo v1 ✅ KAPALI + §F.2 raporu + commit + push + tm 88 done → tm 70/68/69 bağımlılığı çözülür.

## Subtasks

### 88.1. v1 Must sayacı sayımı

**Status:** done  
**Dependencies:** None  

PLAN §4 satırlarından Must listesi sayılır; ◐/⬜ kalan varsa DUR → görevleştir, bu tur bekler.

### 88.2. §F.1 tam tur (v1 kapsamı) + faz sızıntısı kontrolü

**Status:** done  
**Dependencies:** 88.1  

10 madde v1 için; GL-5/6/7 = belgeli sapma (§D52), belgesiz sızıntı ara.

### 88.3. Tam E2E + DoD borcu kapatma

**Status:** done  
**Dependencies:** 88.2  

Tam Playwright süiti + tam DoD kapısı (son bakım penceresinin koşmadığı kapı).

### 88.4. Faz kapatma + §F.2 raporu

**Status:** done  
**Dependencies:** 88.3  

Üst tablo v1 ✅ KAPALI; rapor HANDOFF'a; commit + push.
