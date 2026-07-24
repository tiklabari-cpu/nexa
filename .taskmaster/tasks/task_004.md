# Task ID: 4

**Title:** 08.9.4-d — Virus taramasi

**Status:** pending

**Dependencies:** 2

**Priority:** medium

**Description:** PRD FR-MOD-08.9.4 'izinli tur/boyut + virus tarama' diyor; tarama ayagi hic yok. PLAN.md bunu Cikarim (AV) olarak isaretlemis — yani PRD'de arac adi yok, karar bize ait.

**Details:**

Tarama tamamlanana kadar dosya musteriye servis EDILMEZ (event gorunur olmadan once temiz olmali). Secilen arac ve neden PLAN.md C (Assumptions) bolumune yazilir. Tarama basarisizsa event reddedilir, sessizce gecilmez.

PRD: FR-MOD-08.9.4 · PLAN.md §3.7 · Dilim 13

**Test Strategy:**

Kabul: taranmamis dosya musteriye servis EDILMEZ. Negatif: EICAR test dosyasi reddedilir, event olusmaz. Tarayici erisilemezse dosya KABUL EDILMEZ (fail-closed) — bu davranis testle sabitlenir, varsayima birakilmaz.
