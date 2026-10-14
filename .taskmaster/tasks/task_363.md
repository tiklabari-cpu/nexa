# Task ID: 363

**Title:** CANNED-SEARCH-VARS-PRIVATE [OPUS-HIGH] Hazır yanıtlar: içerikte Türkçe katlamalı arama, 6 sonuç sınırının kalkması (sanal liste), değişkenler ({{customer.name}}…), kişisel (private) yanıtlar

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** "#" seçicisi yalnız kısayol başlangıcında ve 6 sonuçla arıyor, "#çekim" seçiciyi kapatıyor; değişken yok; kişisel yanıt yok. Kaynak: IN-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: useCannedResponses.ts:19-26/:35-45/:60-68; Composer.tsx:648-681; schema:1311-1328 (visibility all|group, @@unique(licenseId, scope, shortcut)); canned-response-access.ts:28-80; settings.ts:362, :1853-1873; settings.yaml:734-770; CannedResponses.tsx; template-variables.ts:22-116.
prisma: canned_responses.owner_account_id uuid NULL; visibility CHECK += private (owner dolu, group boş); benzersizlik iki kısmi unique index: paylaşılanlar (license_id, scope, shortcut) WHERE visibility<>'private', kişiseller (license_id, scope, owner_account_id, shortcut) WHERE private. Geçiş: önce yeni indeksler (her biri ayrı CONCURRENTLY migration), sonra eski unique düşürülür (daralt adımı ayrı).
types: CANNED_VARIABLES (customer.name, first_name, username, email, agent.name, first_name, chat.id, thread.id, company.name — chat.id/thread.id etiketleri K1=A sözlüğüyle: "Thread ID"/"Chat ID"); ticket şablonu doğrulayıcısı; Türkçe etiketler.
scope: canned_responses--my:rw, EÜ varsayılan setine (RL-02 #325 matrisine yetenek).
api: kişisel yanıtı yalnız sahibi düzenler; liste private AND owner=actor; Yönetici başkasının kişiselini GÖRMEZ (varsayılan, RL-03); bilinmeyen değişkenle kayıt reddedilir.
web: toLocaleLowerCase('tr-TR') + NFD + \p{M} silme ("cekim"→"çekim"); sıra kısayol başı > kısayol içi > metin içi; # sonrası Unicode harf; VirtualList ≤8 satır; ekleme anında değişken doldurma (ChatDetail, IN-02 bağlamı #331 varsa, ajan), doldurulamayan yerine kiracı yedek ifadesi vurgulu, kaçışlanarak; aynı kısayolda kişisel üstte "Kişisel" rozeti; ayar ekranında "Yalnız ben / Ekip / Herkes", {x} menüsü, liste araması (GV-06).

KABUL KRİTERLERİ:
- "papara" metninde Papara geçen tüm yanıtları listeler; 6'dan fazlası kaydırılır.
- "cekim" "çekim"i bulur.
- {{customer.name}} adı, yoksa yedek ifadeyi getirir.
- EÜ kişisel yanıt oluşturur, yalnız kendisi görür.
- İki ajan aynı kişisel kısayolu kullanabilir.
- Bilinmeyen değişken reddedilir.

KULLANILAN VARSAYIMLAR:
- 04 IN-06 S3: paylaşılanları EL+ yönetir, kişiselleri herkes kendisi.
- Yönetici kişisel yanıtları görmez.

**Test Strategy:**

Birim (katlama, sıralama, doldurma), entegrasyon (görünürlük, kısayol, değişken), e2e inbox-canned-search.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
