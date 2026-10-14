# Task ID: 325

**Title:** PERMISSION-MATRIX [OPUS-MAX] Yapılandırılabilir izin matrisi (K7): rol × yetenek, kiracı geçersiz kılmaları, alt sınırlar, oturumda anlık hesap (≤60 sn), "own" görünürlük düzeyi, Yetkilerim

**Status:** pending

**Dependencies:** 323 ⏱, 324 ⏱

**Priority:** high

**Description:** "Kim neyi görecek" kararı sonraya bırakıldı; her değişiklik yazılım güncellemesi olmamalı. 70 scope altyapısı var, rol → scope eşlemesi kodda sabit. K7: Ekip Üyesi yalnız kendi ekibini görür; Ekip Lideri raporlarda yalnız kendi ekibini; Yönetici faturalamayı görür ama değiştiremez; matrisi yalnız Kurucu değiştirir. Kaynak: RL-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RL-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 4 — roller ve yetki matrisi.

[MAX] yetki çekirdeği — güvenlik incelemesi zorunlu.
KOD: packages/types/src/scopes.ts (70 scope, expandScope/effectiveScopes); role-scopes.ts; token-service.ts:216, oauth-service.ts:548, rtm/src/auth.ts:169 (rol tavanı kesişimi); plugins/auth.ts (config.scopes, minimumRole, exactRole); /auth/me (auth.ts ~:863); navigation.ts:57-64, settings-sections.ts; services/chat/access.ts (tümü / ekiplerim; "yalnız bana atananlar" yok).
types/capabilities.ts: {key, group, labelKey, scopes, levels? none|own|team|all, floorRole, ownerOnly?, defaults by role}; saf effectiveScopes(role, overrides). Gruplar: Sohbetler (görme own/team/all, devralma, arşiv), Oyuncu verisi (e-posta/kullanıcı adı görme, dışa aktarma, silme), AI (taslak, yayın, uyum kuralları — §1.0 tablosu ai.* anahtarları), Raporlar (ekip/hepsi), Ekip (davet, rol değiştirme), Ayarlar, Faturalama, Loglar (zaman çizelgesi, dışa aktarma, maskesiz dışa aktarma). İlk sürüm 20–30 yetenek.
prisma: role_capability_overrides (license_id, role, capability, value, updated_by, updated_at) PK (license_id, role, capability) + RLS; licenses.permissions_version INT DEFAULT 0.
contract settings.yaml: GET /settings/permissions (varsayılanlar, kiracı değerleri, kilitli hücreler, alt sınırlar), PUT /settings/permissions (değişiklik listesi + reason; exactRole owner); /auth/me capabilities.
api: birinci taraf oturumlarda (parola, SAML) yetkiler her istekte effectiveScopes ile (bugün kayıtlı listenin rol tavanıyla kesişimi — matris yetki VERDİĞİ için anlık hesap; asıl güvenlik değişikliği); partner OAuth/PAT mevcut mantık, tavan matristen; önbellek lisans + permissions_version, 60 sn TTL, değişiklikte sürüm artar + Redis pub/sub; requireCapability(principal, key); sohbet görünürlüğüne own; audit permissions.changed (fark + gerekçe) + tüm Yöneticilere bildirim.
RTM aynı effectiveScopes ve önbellek (iki süreç aynı cevap; role-scopes tm 145 dersi).
KURALLAR: (1) varsayılanlar bugünkü davranışın aynısı (regresyon yok); (2) K7 varsayılan değişiklikleri AYRI ve görünür adım (alt görev 5); (3) alt sınırlar platform güvenliği (oyuncu silme ≥ Yönetici; sahiplik devri, SSO, faturalama değiştirme yalnız Kurucu); rota kapıları son söz.
web: PermissionsMatrix.tsx (gruplu satırlar, rol sütunları, anahtar/düzey seçici, kilit simgesi + açıklama, varsayılana dön, GV-06 kalıbı: Kaydet → fark → gerekçe → onay; #323), "Yetkilerim" salt okunur.
RL-02 açık soruları: S1 EÜ başka ekip görmez, S2 EÜ e-posta/kullanıcı adı görür ama dışa aktaramaz, S3 EL kendi ekip raporu, S4 Yönetici fatura salt okunur, S5 yalnız Kurucu + audit + bildirim, S6 yeni rol tanımı yok.

KABUL KRİTERLERİ:
- Değişiklik yapılmamış workspace'te her rolün erişimi bugünküyle birebir (mevcut yetki testleri yeşil).
- Kurucu bir yeteneği açınca etkilenenler ≤60 sn içinde yeniden giriş yapmadan alır; kapatınca kaybeder (API ve RTM).
- Alt sınırın altına verme 400; kilitli hücre değiştirilemez.
- Her değişiklik audit'te fark + gerekçe; Yöneticilere bildirim.
- Başka kiracının matrisi okunamaz/etkilenmez.
- K7 varsayılanları uygulandıktan sonra: EÜ başka ekibin sohbetini göremez, EL raporda yalnız kendi ekibini, Yönetici faturayı değiştiremez.

KULLANILAN VARSAYIMLAR:
- K7.
- RL-02-S1..S6 varsayılanları.
- 60 sn önbellek gecikmesi kabul (07 açık risk: sahibe bildirilir).

**Test Strategy:**

effectiveScopes birim (alt sınır, kilit, düzeyler), entegrasyon (anlık etki, 403, kiracı izolasyonu, PAT genişlemez, RTM aynı karar), e2e matris; güvenlik incelemesi notu HANDOFF'a; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 325.1. PM-CATALOG [OPUS-MAX] capabilities.ts kataloğu + effectiveScopes + alt sınırlar/kilitler

**Status:** pending  
**Dependencies:** None  

Üst görev 325 ayrıntılarındaki ilgili bölüm.

### 325.2. PM-STORE-CACHE [OPUS-MAX] role_capability_overrides + permissions_version + önbellek/pub-sub + GET/PUT uçları + audit/bildirim

**Status:** pending  
**Dependencies:** 325.1  

Üst görev 325 ayrıntılarındaki ilgili bölüm.

### 325.3. PM-SESSION [OPUS-MAX] token-service/oauth/RTM anlık hesap + requireCapability + own görünürlük

**Status:** pending  
**Dependencies:** 325.2  

Güvenlik incelemesi gerektiren asıl değişiklik.

### 325.4. PM-WEB [OPUS-HIGH] PermissionsMatrix.tsx (GV-06 kalıbı) + Yetkilerim

**Status:** pending  
**Dependencies:** 325.2  

Üst görev 325 ayrıntılarındaki ilgili bölüm.

### 325.5. PM-K7-DEFAULTS [OPUS-XHIGH] K7 varsayılan değişiklikleri ayrı ve görünür adımda (EÜ kendi ekibi, EL ekip raporu, Yönetici fatura salt okunur, matris yalnız Kurucu)

**Status:** pending  
**Dependencies:** 325.3  

XHIGH GEREKÇESİ: (1) erişim varsayılanı değişikliği. Sürüm notu + HANDOFF duyurusu.
