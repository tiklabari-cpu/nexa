# HANDOFF — SiyahTuş

**Date:** güncel — bkz. Task log · **Branch:** `main` (Faz-0 + v1 + v2 planı burada) · **Remote:** https://github.com/tiklabari-cpu/nexa

---

> **Eski kayıtlar:** `docs/archive/handoff/` (`grep -rn 'tm <id>' docs/archive/handoff`) — canlı dosyada yalnız son 5 görev + açık görevler kalır (CONVENTIONS §3).

## Task log (newest-first)

## tm 474 — DOCS-AUDIT-CONTRADICTIONS: denetimin dört belge çelişkisi kapatıldı — done — 2026-11-12 UTC

- **Yapıldı (dal `docs/audit-contradictions`; yalnız belge + bir şablon testi):** (1) checklist ve `docker-compose.pilot.yml`'de "file sharing stays off" kalmadı (tm 418 zaten yazmıştı); "Outside the pilot" satırı pilot gerçeğiyle çelişmiyor, değişiklik gerekmedi. (2) `production-checklist.md` audit satırı 2026-11-12 ölçümüyle: 19 advisory (4 high, 9 moderate, 6 low), çoğu `apps/mobile`, ama zod (api+rtm), fastify, fast-uri (api) sunucu yolunda; tm 419 ara önlem, tm 477 zod 4.x (deferred, tm 415'in yerine) + "yolları oku". (3) `task_374.md`: seçenek (b) — CONVENTIONS §4'e "durum kaynağı tasks.json, `task_NNN.md` güncel tutulmaz" notu (son üretilen task_388.md, 378 dosya ≠ 474 görev); `generate` koşulmadı. (4) `.env.production.example` `TRIAL_DAYS=90` (yorum üstte; kod varsayılanı 14, env.ts değişmedi, root panel ayarı öne geçer) + checklist maddesi.
- **Doğrulama:** `env.production-example.test.ts` 30 (+1: `TRIAL_DAYS`=90 + yorum), `env.pilot.test.ts` 113 yeşil; prettier temiz. Kapı: ön kontrol `build statik birim` exit 0 (3m51); `pnpm test:gate --e2e` exit 0 (entegrasyon 14m43, e2e 22m13) — önceki iki koşu ilgisiz entegrasyon kırmızısıyla düştü (`push-notifications.test.ts`, `ai-jobs.test.ts` settle; ikisi tek başına yeşil), üçüncü koşu tam yeşil.
- **Varsayımlar:** audit sayısı `pnpm audit --prod` advisory sayısıdır (görev metnindeki 56 yol sayısıydı). Kapıda e2e koşusu belge/şablon değişikliği için de DoD gereği koşuldu.
- **Sonraki pencere:** yok. HANDOFF'tan tm 470.1 bloğu arşive taşındı.

## tm 473 — EMPTY-STATES-WALKTHROUGH: yeni çalışma alanında boş ekranlar ekran ekran gezildi; eylemsiz dördü (Inbox, Arşiv, Müşteriler, Takım › AI ajanları) + Raporlar sıfır görünümü artık bir sonraki adımı sunar — done — 2026-11-12 UTC

- **Yapıldı (dal `feat/empty-states-walkthrough`; yalnız web + e2e; kontrat/migration/env YOK):** yeni `components/EmptyStateActions.tsx` — `InstallWidgetAction` ("Install the chat widget" → Ayarlar › Website widgets) yalnız bölümü açabilene ve henüz web sitesi yokken (`GET /websites`, Website widgets'ın sorgu anahtarı; site eklenince kalkar), yoksa `fallback` "Go to inbox"; `InstallWidgetHint` Raporlar › Genel bakış'ta vaka 0/0 iken; `CreateAiAgentAction` (Playbook'u görebilene). en+tr. §D491 / K473. Gezinti (gerçek kayıt + "Skip setup"):

  | Ekran | Önce | Şimdi |
  |---|---|---|
  | Ana sayfa | "Set up" (kontrol listesi) | aynı |
  | Inbox | "Nothing here yet" — eylemsiz | + Install the chat widget |
  | Arşiv | "No archive yet" — eylemsiz | + Install the chat widget / Go to inbox |
  | Müşteriler | "No customers yet" — eylemsiz | + Install the chat widget / Go to inbox |
  | Raporlar | düğmeler var, sıfırlarda sonraki adım yok | + "No conversations yet — …" + bağlantı |
  | Playbook › Genel / Bilgi / KB / Beceriler | Add AI agent / Add an AI agent / New article / Try this | aynı |
  | Takım / Takımlar | Invite teammates / New team | aynı |
  | Takım › AI ajanları | "No chatbots yet" Playbook'u anıyor, bağlantı yok | + Create an AI agent |
  | Ayarlar › Kanallar | Connect | aynı |
- **Doğrulama:** e2e `empty-states.spec.ts` 3/3 (yeni kayıt + "Skip setup" → 10 ekranın her birinde boş durum + eylem görünür/etkin/doğru adres + axe 0 engel, koyu tam set + açık tema kuralları; widget adımı: bağlantıdan Website widgets'a → site ekle → Inbox'ta bağlantı yok, Arşiv/Müşteriler "Go to inbox", Raporlar ipucu yok). Web `EmptyStateActions.test.tsx` 9, `ArchivePage.test.tsx` (+1), `CustomersPage.test.tsx` (+1), `TeamAiAgentsPage.test.tsx` (+2). Kapı: ön kontrol `build statik birim` exit 0 (4m13); `pnpm test:gate --e2e` exit 0 — entegrasyon 16m00, e2e 591 geçti / 0 kırmızı / 1 flaky `sensitive-data.spec.ts:22` (defterde 9 kez, ilgisiz) (21m54). `audit:url-pii`/`req-coverage`/`log-keys` exit 0. PNG churn geri alındı.
- **Varsayımlar:** kurulum adımı yalnız kurulmamışken (canlı çalışma alanında gece boş Inbox'a "widget kur" denmez); `/websites` okuması başarısızsa bağlantı yok; arama/filtre sonucu boş listelere eylem eklenmedi. Ekip ekranı Ayarlar'da değil `/app/team`.
- **Sonraki pencere:** yok. HANDOFF'tan tm 468 bloğu arşive taşındı.

## tm 472.3 — NARROW-ARCHIVE-REPORTS (472.4 birleşik): Arşiv dar ekranda liste → tam ekran bağlantı + geri; Raporlar'da sekmeler yerine rapor seçici, her tablo kart — ikisi de 375/768 px'te bantsız ve yana kaymasız — done — 2026-11-12 UTC

- **Yapıldı (dal `feat/narrow-archive-reports`; yalnız web + e2e; kontrat/migration/env YOK):** `ArchivePage` 1024 px altında liste tüm ekran, açılan bağlantı onun yerine + `DetailBar` ("‹ Tüm konuşmalar" `?c=`'yi siler; Konuşma/Oyuncu sekmesi, ≥ 44 px). `ReportsPage` dar ekranda `ReportPicker` (`<select>` "Rapor", kategoriler optgroup). Yeni `components/CardTable.tsx` + `.card-table` CSS: dar ekranda her satır kart, değerler sütun adıyla (`data-label` başlıktan, açık ARIA rolleri); Raporlar'ın 23 tablosu çevrildi. Ölçümle bulunan taşmalar: AI metrik ipucu (+144 px), Ajan etkinliği şeridi (~190 px), `sr-only` tablo. `navigation.ts` Arşiv + Raporlar `responsive`. §D490 / KA11Y (◐ kalır).
- **Doğrulama:** e2e `narrow-archive-reports.spec.ts` 4/4 (375 + 768: arşiv liste/bağlantı/oyuncu/geri ölçümü; 16 raporun her biri ölçülür + kart olmayan tablo yok + axe 0 engel); `measureFit` → `tests/narrow-fit.ts` (472.1 spec'i de kullanır); ilgili `archive`/`archive-search`/`reports`/`staffing`/`ai-metrics`/`narrow-screen`/`narrow-settings-customers` 46/46. Web `CardTable.test.tsx` 5, `ReportsPage.narrow.test.tsx` 4, `ArchivePage.test.tsx` 28 (+4), `AppShell.narrow.test.tsx` (+3 iddia). Kapı: ön kontrol `build statik birim` exit 0 (4m12); `pnpm test:gate --e2e` exit 0 — entegrasyon 14m49, e2e 589 geçti / 0 kırmızı / 0 flaky (22m20). `audit:url-pii`/`req-coverage`/`log-keys` exit 0. PNG churn geri alındı.
- **Varsayımlar:** gün × saat ısı ızgaraları (`HourGrid`: Personel planı, Kaçan sohbetler) kart olmadı, kendi kabında yana kayar (24 saat sütunu grafiğin kendisi); `SharedReportPage` ve Raporlar › AI kalite kapsam dışı. Kartta ilk hücre başlık, etiketsiz.
- **Sonraki pencere:** NarrowScreenNotice bandı artık yalnız şu sayfalarda: Ana sayfa, Takım (+ AI ajanları, Takımlar), Playbook, Faturalandırma, Geliştiriciler, Uygulamalar, sahiplik devri, Müşteriler › Gerçek zamanlı/Kampanyalar/Hedefler, Raporlar › AI kalite (+ inceleme). `CardTable` başka geniş tablolara da takılabilir. HANDOFF'tan tm 466 bloğu arşive taşındı.

## tm 472.1 — NARROW-SETTINGS-CUSTOMERS (472.2 birleşik): Ayarlar dar ekranda liste → detay, Müşteriler kart listesi + tam ekran kayıt; ikisi de 375/768 px'te bantsız ve yana kaymasız — done — 2026-11-12 UTC

- **Yapıldı (dal `feat/narrow-settings-customers`; yalnız web + e2e; kontrat/migration/env YOK):** `SettingsLayout` 1024 px altında menüyü yanına koymaz: `/app/settings` gezinmenin kendisi (`SettingsNav variant="page"`), bölüm tüm ekranı alır + "‹ Tüm ayarlar". `CustomersPage` 1024 px altında `CustomerCards` (VirtualList) + "Sırala" menüsü, açılan kayıt liste yerine + "‹ Tüm müşteriler". `navigation.ts` `responsiveChildren` (Ayarlar'ın her bölümü) + Müşteriler `responsive`. 375 px'te her bölüm ölçülüp taşanlar düzeltildi (global `fieldset { min-inline-size: 0 }`, Page telefonda 16 px boşluk, `max-w-full`, satır sarma, tablo kaydırıcılarına `relative`). §D489 / KA11Y (◐ kalır).
- **Doğrulama:** e2e `narrow-settings-customers.spec.ts` 6/6 (375 + 768: ayarların 30+ bölümü tek tek — bant yok, belge/`<main>`/sayfa yana kaymaz, kesik denetim yok; liste → bölüm → geri ≥ 44 px; müşteri kartları, sıralama menüsü, tam ekran kayıt + geri); güncellenen `narrow-screen`/`settings-nav`/`focus-management`/`narrow-inbox` 31/31. Web `SettingsPage.narrow.test.tsx` 8, `CustomersPage.narrow.test.tsx` 8, `AppShell.narrow.test.tsx` 15 (+2). Kapı: ön kontrol `build statik birim` exit 0 (7m06); `pnpm test:gate --e2e` exit 0 — entegrasyon 17m13, e2e 584 geçti / 0 kırmızı / 1 flaky `tickets-reply.spec.ts:52` (defterde 17 kez, ilgisiz) (21m54). `audit:url-pii`/`req-coverage`/`log-keys` exit 0. PNG churn geri alındı.
- **Varsayımlar:** geniş tablolar (İzinler, Denetim günlüğü, AI kalitesi, SLA) kart olmadı, kendi kartında yana kayar; ≥ 44 px yalnız dar ekran gezinmesinde (bölüm içi form denetimleri aynı). Kartta çalışma alanı tablo özel alanları yok. Bant testleri artık Takım ekranını kullanır.
- **Sonraki pencere:** tm 472.3 (Arşiv + Raporlar) aynı ölçümü kullanabilir: `narrow-settings-customers.spec.ts` `measureFit` (belge/`<main>`/sayfa + kesik denetim + taşan öğe adı). Müşteriler'in Gerçek zamanlı/Kampanyalar/Hedefler alt sayfaları hâlâ bantlı. HANDOFF'tan tm 464.3 bloğu arşive taşındı.

## tm 471 — BRAND-LOGO-URL-FIELD: Ayarlar › Markalar'da "Logo adresi" (ekleme formu + her satırda blur'da PATCH + önizleme); API yalnız widget'ın çizeceği https adresini kabul eder; widget "Marka logosunu göster" ipucu alanı adıyla gösterir — done — 2026-11-12 UTC

- **Yapıldı (dal `feat/brand-logo-url-field`; migration/env YOK; kontrat yalnız açıklama):** `routes/brands.ts` `logo_url` artık `brandLogoUrl` (@siyahtus/types, widget mint'iyle aynı) — https dışı/kimlik bilgili → 400, boş/null temizler, `href` saklanır. `Brands.tsx`: ekleme formunda isteğe bağlı "Logo adresi" (`optional(logoAddress)`), her satırda `{ad} logo adresi` alanı (blur'da PATCH, Esc geri alır, geçersiz değer gönderilmez + alan altında neden) + 32 px önizleme (yüklenemezse boş çerçeve). `showLogoHint` en+tr alanın adını verir. §D488 / K11.7.
- **Doğrulama:** int `brands.test.ts` 12 (+1: https saklanır/kırpılır, http/javascript/data/`//`/`/uploads`/kimlik bilgili 400 ve eskiyi bozmaz, oluştururken aynı kural, boş ve null temizler); web `Brands.test.tsx` 25 (+14; satır kuralı kapatılınca 4 red); e2e `brand-logo.spec.ts` (Markalar'da http reddi → https kaydı → Widget görünümünde anahtar → ziyaretçi widget'ında `alt=Default` logo; CDN adresi Playwright route ile 1 px PNG). Kapı: ön kontrol `build statik birim` exit 0 (6m15); `pnpm test:gate --e2e` exit 0 — entegrasyon 16m10, e2e 579 geçti / 0 kırmızı / 0 flaky (23m23). PNG churn geri alındı.
- **Varsayımlar:** API'yi sıkılaştırmak (form sunucudan sıkı olmasın diye) — önceden saklanmış https-dışı değerlere dokunulmadı, widget zaten göstermiyordu. Logo yükleme ucu kapsam dışı. Görev metnindeki `settings.ts` satırları eskiydi; uç `routes/brands.ts`'te.
- **Sonraki pencere:** yok. HANDOFF'tan tm 464.2 bloğu arşive taşındı.
