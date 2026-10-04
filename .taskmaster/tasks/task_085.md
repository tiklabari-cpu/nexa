# Task ID: 85

**Title:** GL-1 · SYNC-a — PLAN v1 bayat satır senkron denetimi (06.2.4 / 06.3.2 / 10.1.4)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** PLAN §4.2/§4.3 üç satırı ◐ gösteriyor ama işler TM'de done (tm 33 alt-görevleri 06.2.4-a drag-reorder + 06.3.2-a website crawl; tm 54 meter UI) ve kod mevcut (step-reorder.ts + SkillEditor.tsx drag/klavye; web-crawler.ts + lib/ssrf.ts + playbook.ts type:website; BillingPage.tsx meter + quota_warning). Panelin 'TM'de bitti, PLAN'da ◐' bulgu deseninin son üç örneği. Satırlar KANITLA (odaklı test koşusuyla) ✅'a çevrilir. PLAN §4.5/GL-1 · §D52.

**Details:**

DENETİM GÖREVİ — kod değişikliği ÇIKMAMALI; KK açığı bulunursa satır ◐ KALIR, açık §D'ye yazılır ve ayrı görev açılır (satır asla kanıtsız çevrilmez).
1) 06.2.4 — KK (birebir): 'Her adım araç çağrısı; drag reorder (+ klavye alternatifi); zorunlu parametre (ör. transfer hedefi) boşsa hata'. Kanıt yüzeyi: apps/web/src/features/playbook/SkillEditor.tsx (draggable + ↑↓ reorder, satır ~198-230) + step-reorder.ts (moveStep/describeMove/stepIssues) + step-reorder.test.ts + SkillEditor.test.tsx. Odaklı süit koş; zorunlu-parametre-boş → hata davranışını testte GÖR. Geçerse PLAN §4.2 06.2.4 satırı ✅ (kanıt: dosya+test adları + tm 33 referansı).
2) 06.3.2 — KK (birebir): 'Geçersiz URL/tür reddi; crawl/parse; RAG indeksleme; bulk/CSV import (SiyahTuş)'. Kanıt yüzeyi: services/ai/web-crawler.ts (+test) + lib/ssrf.ts + routes/playbook.ts type enum website/file/article/faq. SSRF negatif testlerin (169.254.169.254 / localhost reddi) fiilen var ve yeşil olduğunu GÖR. NOT: bulk/CSV, §4.4 06.3.2-a kırılımında bilinçli kapsam dışıydı ('Kapsam dışı: bulk/CSV (ayrı Should)') → satır ✅'a çevrilirken PLAN §5.1 tablosuna yeni satır '06.3.2-bulk — bulk/CSV import (Should, v2)' eklenir; KK'nın bu payı gizlenmez.
3) 10.1.4 — KK (birebir): 'Sayaç N/limit (% used); aşım paketi; %80 proaktif uyarı (SiyahTuş)'. Kanıt yüzeyi: apps/web/src/features/billing/BillingPage.tsx (quota_warning, overage pack fiyat teklifi) + testleri (tm 54). Odaklı süit koş. Geçerse PLAN §4.3 10.1.4 satırı ✅.
4) PLAN §4.4 girişindeki bayat denetim bloğu ('Eksik (grep/okuma ile doğrulandı): ... drag-reorder (06.2.4 — 0 eşleşme), website crawl ...') güncellenir — 2026-07-28 durumuyla yeniden yazılır.
5) PLAN §2 matrisi yeniden değerlendirilir: MOD-05 ve MOD-06 satırları v1 payı tamamsa ✅'a çevrilir (sayarak, elle değil).
PRD: FR-MOD-06.2.4 / FR-MOD-06.3.2 / FR-MOD-10.1.4 · PLAN §4.5/GL-1 · §D52.

**Test Strategy:**

Kanıt zorunlu: satır başına odaklı süit FİİLEN koşulur — web unit (SkillEditor + step-reorder + BillingPage) + api integration (knowledge crawl + SSRF negatifler) + contract-parity; çıktı özetleri HANDOFF'a yazılır. Kod değişikliği çıkarsa DUR → §D'ye yaz, ayrı görev aç. KAPANIŞ: PLAN satırları ✅ (kanıt metniyle) + §4.4 denetim bloğu güncel + §5.1'e 06.3.2-bulk satırı + HANDOFF task log + commit (docs(plan)) + push + tm 85 done.

## Subtasks

### 85.1. 06.2.4 doğrulaması + satır çevirisi

**Status:** done  
**Dependencies:** None  

SkillEditor/step-reorder odaklı süit koş; zorunlu-param-boş → hata testini gör; PLAN §4.2 satırını kanıtla ✅ yap.

### 85.2. 06.3.2 doğrulaması + satır çevirisi + 06.3.2-bulk satırı

**Status:** done  
**Dependencies:** 85.1  

Crawl+SSRF negatif süiti koş; PLAN §4.2 satırını ✅ yap; §5.1'e '06.3.2-bulk (Should, v2)' satırı ekle.

### 85.3. 10.1.4 doğrulaması + satır çevirisi

**Status:** done  
**Dependencies:** 85.2  

BillingPage meter/quota_warning süiti koş; PLAN §4.3 satırını ✅ yap.

### 85.4. §4.4 denetim bloğu + §2 matris senkronu + kapanış

**Status:** done  
**Dependencies:** 85.3  

Bayat denetim bloğunu yeniden yaz; §2 MOD-05/06 satırlarını sayarak güncelle; HANDOFF + commit + push.
