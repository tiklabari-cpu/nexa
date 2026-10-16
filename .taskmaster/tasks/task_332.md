# Task ID: 332

**Title:** ID-SEARCH [OPUS-HIGH] (Opus 5.5) ID ile arama: Ctrl+K ve arşivde Thread ID, Chat ID, mesaj ID, üye ID, kullanıcı adı, e-posta ile sunucudan doğrudan bulma (görünürlük süzgeçli, var/yok sızdırmadan)

**Status:** pending

**Dependencies:** 284 ⏱, 286 ⏱, 287 ⏱

**Priority:** high

**Description:** Komut paleti sohbetleri tarayıcıda yalnız en yeni 50 kayıt içinde arıyor (CommandPalette.tsx:206-215); listChats'te arama parametresi yok. "Şu numaraya bak" dendiğinde konuşma iki saniyede açılmalı; CGA sorumlu oyun şikâyetlerinde 5 iş günü hedefi. Kaynak: ID-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

EFOR: high — karar önceden verilmiş, kalıp depoda var; xhigh gerekçesi yeterli değil (2026-10-14 gözden geçirme).
contract: paths/search.yaml GET /search?query=&types=&limit= → items [{kind chat|connection|event|customer|ticket, chat_id?, thread_id?, event_id?, customer_id?, ticket_id?, title, subtitle, matched_on}].
types: classifyIdentifier() (#284).
api: routes/search.ts (sohbet, müşteri ya da ticket okuma yetkilerinden biri), services/search/lookup.ts. Sınıflandırma: mesaj ID biçimi → baştaki bağlantı numarası → thread → chat; 10 karakter → önce chats.id sonra threads.id (tesadüfi çakışmada ikisi); UUID → müşteri (ticket UUID ise ticket); e-posta → customers.email eşitliği; diğer → müşteri (ad, username_normalized önek/eşitlik #278, e-posta) + ticket konusu (+ ID-07 hazır olunca mesaj metni).
GÖRÜNÜRLÜK: sohbet sonuçları chatVisibilityFilter; görünmeyen sohbet "yok" ile aynı yanıt (ID-06-S1). Kullanıcı adı/e-posta araması tüm ajanlara, e-posta yetkisiz role maskeli (S2).
PARAMETRE adı query (log maskelemesi query='yi tanıyor; q tanımıyor — log-redact.ts:152-153); aranan metin tarayıcı adresine yazılmaz (GV-05); istemcide 250 ms bekleme (180/dk ajan sınırı).
RLS altında ILIKE '%…%' indeks kullanamayabilir — önek/eşitlik username_normalized üzerinde, EXPLAIN kanıtı; gerekirse SECURITY DEFINER.
web: CommandPalette sohbet bölümü /search'e; tür rozeti ve numaralar; Enter → /app/inbox?chat=<T>&thread=<C>; InboxPage thread (ve event) parametresini okur, bağlantıya/mesaja kaydırır.

KABUL KRİTERLERİ:
- Thread ID → o günün konuşması; Chat ID → o bağlantıya kaydırılmış; mesaj ID → mesaj vurgulu.
- Üye UUID, e-posta, kullanıcı adı (büyük/küçük duyarsız) müşteriyi bulur.
- En yeni 50 sohbet dışındaki sohbet numarasıyla bulunur.
- Görünmeyen sohbet numarası "sonuç yok"; yanıt hiç olmayan numarayla aynı.
- Sunucu logunda query=[redacted]; tarayıcı adresinde aranan metin yok.

KULLANILAN VARSAYIMLAR:
- ID-06-S1/S2 varsayılanları.

**Test Strategy:**

Entegrasyon search (her tür, görünürlük, kiracılar arası), e2e command-palette.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
