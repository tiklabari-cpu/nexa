# Task ID: 181

**Title:** M-UI — Eksik konsol yuzeyleri — "API`de var, konsolda yok" deseni (denetim D2)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Bu maddelerin arka tarafi yazilmis, konsol yuzeyi yok: etiket grup kapsami API`de yaziliyor ama duzenlenemiyor, PAT icin `apps/web/src` icinde tek satir yok, yonlendirme kurali olusturma ucu ve ekrani yok, bildirimler yalniz InboxPage`de mount ediliyor, denetim kaydinin metadata`si hicbir yerde gorunmuyor, sablon rozetleri render edilmiyor, preview ozeti basilmiyor, ajan bazli performans lisans geneli gosteriliyor, formlarin yarisi ortak kutuphaneyi atliyor.

**Details:**

Denetim `prd-uyum-denetimi.md` §3 D2 · ilgili PRD satırları her iş kaleminde.

**Her iş kaleminde geçerli:** önce mevcut ucu bul ve sözleşmesini oku — yeni uç icat etmen gerekmiyor olabilir. Ortak form kütüphanesi `apps/web/src/lib/form.tsx` kullanılır. i18n `apps/web/src/locales` (en+tr). `apps/e2e/tests/a11y.spec.ts` iki temada axe tarıyor ve istisna listesi BOŞ; yeni rota eklediysen rota listesine de ekle. Sunucu 4xx gövdesi **görünür alan-altı hataya** dönüşmeli, sessizce yutulmamalı.

**Test Strategy:**

Her iş kalemi kendi DoD kapısından geçer. `apps/web` test süiti (1541 test) sayıca düşmez; a11y taraması iki temada da yeşil kalır.

## Subtasks

### 181.1. M-UI-a [SONNET-XHIGH] Etiket grup kapsamı ekranı — ucun ölü kolon olmadığını da doğrula

**Status:** done  
**Dependencies:** None  

PRD **594-659** (08.7.1). API `group_ids`'i yazıyor (`settings.ts:2572` civarı) ama `Tags.tsx:139` yalnız sayı basıyor. Grup seçici ekle. **Ayrıca:** denetim canned responses için "group_id kolonu var ama create/update kabul etmiyor → ölü kolon" demişti; etiket ucunun gerçekten yazdığını doğrula, yazmıyorsa uç tarafı da bu iş kaleminin kapsamındadır.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.2. M-UI-b [OPUS-XHIGH] Kişisel erişim jetonu (PAT) ekranı — kimlik bilgisi yüzeyi

**Status:** done  
**Dependencies:** None  

PRD **594-659**. `apps/web/src` içinde `personal-access-token` geçen TEK SATIR yok; API hazır (`routes/auth.ts` ~955 yükselme kapısı: oturumun sahip olmadığı scope verilemez). Oluştur/listele/iptal. **Jeton yalnız oluşturulduğu anda bir kez gösterilir**, ekran bunu açıkça söylemeli. Scope seçici yalnız oturumun sahip olduklarını göstermeli (`role-scopes.ts`) — kullanıcıya reddedilecek seçenek sunma. Jetonu log'lama, URL'e koyma, analitiğe gönderme. e2e: oluştur → jetonla API çağrısı çalışır → iptal → 401.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.3. M-UI-c [OPUS-XHIGH] Bilet yönlendirme kuralı: POST/DELETE uçları + ekran

**Status:** done  
**Dependencies:** None  

PRD **594-659** (08.6.2). `/settings/routing-rules` yalnız GET (`settings.ts:2332`) + PATCH (`:2364`); oluşturma ve silme yok. `RoutingRule` kısıtları: `kind` (vars. chat), `conditions` (Json yüklemler), `targetGroupId`, `priority` (Int), `isFallback` **lisans+kind başına EN FAZLA BİR** — tekilliği uçta zorla, iki fallback yönlendirmeyi belirsizleştirir. **M-TEAM ile etkileşim:** M-TEAM-a takımı hedefleyen kural varken takım silmeyi 409 ile reddediyor; buradan kural silinince o refüz kalkmalı — teste bağla.

**Details:**

Bağımlılık: M-TEAM-d. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.4. M-UI-d [OPUS-MAX] BÖLÜNMEZ: bildirimleri AppShell`e taşı — soket yaşam döngüsü sahipliği

**Status:** done  
**Dependencies:** None  

PRD **707-733** (13.8). `useNotifications` ve `useRealtime` reponun TAMAMINDA yalnız `InboxPage.tsx:209-210`'da mount ediliyor; ajan Reports'a geçince ses/masaüstü/rozet susuyor ve soket kapanıyor. **Asıl riskler:** (1) çift mount → aynı mesaj iki kez bildirilir; push verisi Inbox'a nasıl akacak (bağlam mı store mu)? (2) soket yaşam döngüsü tek yerden yönetilmeli — yeniden bağlanma, arka plan sekmesi, oturum kapanışı; sayfa geçişlerinde bağlantı fırtınası olmamalı (bağlantı sayısı ölçülür). (3) ajan zaten o sohbete bakıyorsa bildirim gösterilsin mi — mevcut davranışı koru, değiştiriyorsan yorumla. **e2e asıl kanıt:** Reports sayfasındayken gelen mesaj bildirim üretir — bugün üretmiyor, kırmızıdan yeşile dönen test kanıttır. Mobil push (`pushToAgentDevices`) kapsam dışı.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.5. M-UI-e [OPUS-XHIGH] Denetim kaydı detayı: GET /audit-log/:id + genişletilebilir satır

**Status:** done  
**Dependencies:** None  

PRD **594-659** (08.9.7). Zincir (HMAC + gapless `chain_seq`), imzalı export ve SIEM çıkışı sağlam — **dokunma**. Eksik olan detay: kaydın `metadata`sı hiçbir yerde görünmüyor, tekil kayıt ucu yok. **Gizlilik tasarım sorusu:** metadata bazı kayıtlarda hassas (rol değişimi, IP, e-posta) ve tasarım bilinçli olarak bazı alanları yazmıyor (ban audit'inde IP'nin kasten yazılmaması gibi) — hangi alanların gösterileceğine karar ver ve gerekçeni yorumla; her şeyi ham JSON basmak kolay ama doğru olmayabilir. Scope: liste görebilen detayı da görebilir, fazlası değil.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.6. M-UI-f [SONNET-XHIGH] Form kütüphanesi pilotu: Payment ve Add-website (PRD adıyla sayıyor)

**Status:** done  
**Dependencies:** None  

PRD **722-733** (FR-EK-A.1). `useForm(` kullanan 20 dosya var ama `<form` içeren 40 dosya var; atlananlar tam da PRD'nin adıyla saydığı bu ikisini içeriyor. KK: istemci tarafı anlık validasyon + **alan-altı** hata mesajı + geçerli girdi olmadan submit pasif. **Davranışı değiştirme, kuruluşu değiştir** — mevcut testler kırılıyorsa davranış değişmiş demektir, dur ve incele. Payment bir ödeme yüzeyi: kart verisi log/URL'e girmez.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.7. M-UI-g [SONNET-MAX] Form kütüphanesi süpürmesi: kalan formların envanteri ve taşınması

**Status:** done  
**Dependencies:** None  

Geniş mekanik yüzey (~20 dosya). Önce envanter: `comm -23 <(grep -rln "<form" apps/web/src --include=*.tsx|sort) <(grep -rln "useForm(" apps/web/src --include=*.tsx|sort)`. Öncelik: kullanıcı verisi yazan ve hata gösterme ihtiyacı yüksek olanlar (ayarlar, davet, kural oluşturma); salt arama kutusu olanlar düşük — taşınmaya değmiyorsa nedenini yaz. Her taşımadan sonra o dosyanın testini koş, hepsini sona bırakma. **Taşınanları ve kalanları HANDOFF'a açıkça listele** — sessiz kısmi teslim denetimin en çok şikayet ettiği şey.

**Details:**

Bağımlılık: M-UI-f. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.8. M-UI-h [SONNET-XHIGH] AI Agent şablon rozetleri — tip ve veri var, render yok

**Status:** done  
**Dependencies:** None  

PRD **552-561** (05.2). `TemplateBadge` tipi tanımlı (`templates.ts:54`), `badge` alanı dört kayıtta dolu, hiçbir bileşen render etmiyor → Popular/Essential kartlarda görünmüyor. Rozet bir kategori değil vurgu — kategori ucu (prebuilt/ai/trending) zaten basılıyor, karıştırma. Yeni renk eklersen `tokens.test.ts` AA kontrast eşiğini de güncelle. i18n.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.9. M-UI-i [SONNET-XHIGH] Skill preview özet narrasyonu + editörün ilk testleri

**Status:** done  
**Dependencies:** None  

PRD **562-578** (06.2.5). API `summary` DÖNÜYOR (`playbook.ts:441`) ve DTO'da alan var; editörün `PreviewResult`'ı render etmiyor (yalnız StatusDot/errors/reply/transfer). PRD dört eylemin anlatılmasını istiyor: toplama, etiket, **özet**, transfer + hata gösterimi. **Editör tarafında HİÇ test yok** — maddenin KISMİ çıkma sebebinin yarısı budur; yalnız render eklemek kapatmaz.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 181.10. M-UI-j [SONNET-XHIGH] Ajan bazlı AI performansı (şu an lisans geneli)

**Status:** done  
**Dependencies:** None  

PRD **536-551** (04.2). Team sayfası `<AiPerformance agentActive={anyActive} />` ile hiçbir ajana özel olmayan veri gösteriyor. **`agentPerformance` sorgusu zaten ajan bazlı** (`report-csv.ts`, `AgentPerformanceRow`: agent_id, name, chats, closed, manual, assisted, automated) — yeni sorgu yazma, bağla. M-RPT bittiyse düzeltilmiş figür tanımlarını kullan. Yetki: scope kontrolünü uçta zorla, UI gizlemeye güvenme (PRD §7 RBAC).

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
