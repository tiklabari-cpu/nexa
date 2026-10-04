# Task ID: 179

**Title:** M-COUNT — Sunucu tarafi sayac ve siralama — "yuklenen pencere gercek toplam saniliyor"

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Sayaclar ve siralamalar tarayiciya yuklenmis satirlardan turuyor; veri buyudukce SESSIZCE yanlisa doner ve testler kucuk fixture ile yesil kalir. AI resolution sayaci 50 satirdan sonra yanlis; Tickets siralamasi sunucuya gitmiyor; gorunum filtresi URL e yansimiyor; Traffic sekme sayaclari yalniz yuklenmis sayfalardan turuyor.

**Details:**

PRD satır **496-521** (FR-MOD-02.1.2, 02.7) ve **522-535** (traffic) · denetim `prd-uyum-denetimi.md` §3 D3.

**DB yarısı DOĞRU — dokunma:** `ai_solved` görünüm filtresi (`chat-service.ts` ~1727) ADR-09'un tam predicate'ini uyguluyor ve yorumu bu predicate'e ekstra koşul eklenmesini açıkça yasaklıyor (Solved listesi ile fatura sayacı asla ayrışmamalı). Hata yalnız web katmanında sayımda.

**Çürütme turundan gelen düzeltme:** ilk denetçinin "dar sekmede Traffic sayaçları tüm panoyu temsil etmiyor" eleştirisi **haksızdı** — kod sayaçları yalnız aktif sekme ya da filtresiz pano için gösteriyor. Gerçek sınır sayacın yüklenmiş sayfalardan türemesi. Sekme mantığını değiştirme.

**Test Strategy:**

Kalem bütününün kabul kriteri: sayfa boyutunu aşan veri setlerinde (60+ kayıt, sayfa 25) sayaçlar doğru ve sunucu toplamı fatura sayacıyla aynı; sayfa 2'deki bir bilet sayfa 1'dekinden önce sıralanabiliyor. NFR-P2 okuma bütçeleri aşılmıyor.

## Subtasks

### 179.1. M-COUNT-a [OPUS-XHIGH] AI resolution sayacını sunucudan besle — toplam nereden gelecek kararı

**Status:** done  
**Dependencies:** None  

**Tasarım sorusu:** liste ucuna toplam alanı mı, ayrı sayım ucu mu? Keyset sayfalama ile toplam sayım aynı sorguda pahalı olabilir; kararını ve maliyetini yorumla, NFR-P2 okuma bütçesini bozma. Fatura ile **aynı sayıyı** vermeli — ADR-09 ekseninde Overview = fatura = Copilot BI tutarlılığı korunuyor, yeni sayaç bu üçlüden ayrışırsa hata büyür. **60+ kayıtlı test zorunlu** (kusur tam orada).

**Details:**

Bağımlılık: yok. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 179.2. M-COUNT-b [OPUS-XHIGH] Tickets sıralamasını sunucuya taşı — keyset imleciyle etkileşimi çöz

**Status:** done  
**Dependencies:** None  

`ticketListUrl` (`useTickets.ts:36`) yalnız view+limit+page_id kuruyor; `sortTickets` (`ticket-grid.ts:103`) belleğe yüklenmiş diziyi sıralıyor (`InboxPage.tsx:288`). `/tickets`'e `sort` parametresi (kontrat + uygulama); sıralanabilir alanları PRD'den doğrula. `sortTickets`'ı kaldır ya da görsel yardımcıya indir — çift sıralama sonucu bozar. **Keyset uyarısı:** sıralama alanı değişince imleç anlamını yitirir, sayfalama sıfırlanmalı — teste bağla. e2e: mevcut `paging.spec.ts:70` deseni ("sunucudan farklı sıra iste") biletler için tekrarlanır.

**Details:**

Bağımlılık: yok. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 179.3. M-COUNT-c [SONNET-XHIGH] Tickets görünüm filtresi deep-link`lensin

**Status:** done  
**Dependencies:** None  

PRD 02.7 "deep-link filtre" istiyor; filtre URL'e hiç yansımıyor. `-b`nin `sort` parametresiyle aynı sözleşmede yaşamalı. Geçersiz/bilinmeyen değer geldiğinde sessizce varsayılana düş (URL elle düzenlenebilir) — kararı yorumla. Tarayıcı geri/ileri düğmesi filtre değişimlerini takip etmeli.

**Details:**

Bağımlılık: M-COUNT-b. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 179.4. M-COUNT-d [SONNET-XHIGH] Traffic sekme sayaçlarını sunucu toplamına bağla

**Status:** done  
**Dependencies:** None  

`TrafficPage.tsx:432` civarı. `-a`nın çözdüğü aynı tasarım sorusu geçerli — o iş kalemi bittiyse aynı deseni kullan, yeni yol icat etme. **Sekme davranışını (aktif sekme / filtresiz pano) DEĞİŞTİRME**, mevcut testler kırılmamalı. e2e içinde ölçülen "NFR-P2 filtered GET /traffic" bütçesi aşılmaz.

**Details:**

Bağımlılık: M-COUNT-a. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
