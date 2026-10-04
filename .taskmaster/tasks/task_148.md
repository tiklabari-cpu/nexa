# Task ID: 148

**Title:** FIX-PLAN-F0-SAYAC — Faz-0 özet satırındaki bayat ✅ sayacı (54 → 58) sayılarak düzeltildi

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Panelin sağlık taraması PLAN.md:20'deki Faz-0 özet satırının "54 ✅" rakamının, §3.0–§3.10 gereksinim tablolarındaki gerçek damga sayımıyla (58 ✅) uyuşmadığını buldu. §1.2 bu rakamların elle değil SAYILARAK yazılmasını şart koşar; §F.00 faz kapanış kararını bu tabloya bakarak verir, dolayısıyla bayat özet bitmemiş bir fazı bitmiş gösterebilir. Yalnız özet satırı düzeltilir; gereksinim satırlarının damgalarına DOKUNULMAZ (onlar ## K. kanıt bloklarına dayalı).

**Details:**

SEBEP (git ile kanıtlandı, tahminle değil): satır EKLENMEDİ, damga GERİLEMEDİ — Faz-4'ün tm 139.1–139.6 turları dört gruplu Should/Could satırını 🔒 → ✅ çevirdi. Ölçüm: `ada46de^` (tm 139.1 öncesi) §3 = 54 ✅ + 7 🔒; `dda5b1d` (GL-10 sonrası) §3 = 58 ✅ + 3 🔒; satır sayısı iki uçta da 61 (54+7 = 58+3). Çevrilen satırlar: PLAN.md:180 `01.1.1/.4/.5, 01.4, 01.5` → ✅ → K01.1 (tm 139.1–.3, .5) · :181 `01.1.2` → ✅ → K01.1.2 (tm 139.4) · :199 `02.2.3` → ✅ → K02.2.3 (tm 139.5) · :236 `07.2` → ✅ → K07.2 (tm 139.6). Kanıt blokları çevirmeyi zaten yazmıştı ("Satır 180 artık 🔒 değil" vb.) — damga tarafı doğruydu, yalnız §1'in özet tablosu bayat kaldı: satır 20'ye en son 1f50ce56 (GL-3, 2026-07-31) dokunmuştu. tm 139.x aynı commit'lerde §2 matrisini ve §6A satır 12'yi güncelledi, §1'i atladı.

KAPANIŞ KARARI DEĞİŞMEDİ: dört satırın dördü de Should/Could, Must sayacına girmez. §3'ün Must satırları bu turda da sayılarak 48 ✅ · 0 ◐ · 0 ⬜ (+ §7.1'de 3 EK = 51 ✅), yani `51 ✅ · 0 ◐ · 0 ⬜` kapı hücresi doğruydu ve DEĞİŞTİRİLMEDİ.

YAPILAN: (1) PLAN.md:20 `Genel durum` hücresi `54 ✅ · 0 ◐ (§3) · gruplu-🔒 v1'e` → `58 ✅ · 0 ◐ · 3 gruplu-🔒 (§3, **sayılarak** 2026-08-23 — §D123)`; aynı hücredeki "gruplu-🔒 v1'e" ifadesi de bayattı (§D121: v1 2026-07-31'de kapandı, o dört PRD kodu hiçbir v1 satırına taşınmadı) — hücre artık faz iddiası taşımıyor, yalnız sayı veriyor. (2) §D123 sebebi + ölçüm komutunu + kalıcı kuralı kaydetti.

KALICI KURAL (§D100'ün kardeşi): bir gereksinim damgası çevrildiğinde AYNI turda §1'in faz kapısı tablosu da yeniden SAYILIR — bir damga en az üç yerde yaşıyor (gereksinim satırı · §2 matrisi · §1 sayacı).

dependencies BOŞ: düzeltme hemen çalışabilir, bekleyen iş yok (kuyruk boştu, 147 görevin hepsi done). priority `critical`: CONVENTIONS §4.1 gereği panelin "düzeltmeye gönder" akışından doğan görev — kayıt işin nereden geldiğinin izidir, kapanışta değiştirilmez.

ÜRÜN KODU DEĞİŞMEDİ — diff yalnız PLAN.md · HANDOFF.md · .taskmaster/.

**Test Strategy:**

§3 aralığını grep ile sınırla (`^## 3\. FAZ 0` … `^### 3\.11 `), `^|` satırlarının 5. borulu alanını say (ayraç/başlık satırlarını ele, `→ Kxx` ekini kırp) → 58 ✅ · 3 🔒 · 0 ◐ · 0 ⬜ çıkmalı ve PLAN.md:20 ile birebir uyuşmalı. Aynı aralıkta `$4 ~ /Must/` filtresiyle say → 48 ✅ · 0 ◐ · 0 ⬜ (+3 EK = 51) çıkmalı, kapı hücresi değişmemeli. DoD kapısı: typecheck/lint/format:check/test/test:integration/build/test:e2e exit 0. Ürün kodu diff'i 0 olmalı.
