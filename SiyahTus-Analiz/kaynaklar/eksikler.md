# LiveChat ↔ SiyahTuş (nexa) — Eksik Analizi

- **Tarih:** 2026-10-14
- **Kaynaklar:** [report.md](report.md) (LiveChat canlı keşfi) + [nexa-ozellikler.md](nexa-ozellikler.md) + nexa-main kodu. Kod yalnızca okundu; her "Yok" ve "Kısmi" kararı kodda doğrulandı ve kanıt dosya yoluyla verildi.
- **Durum:** **Var** · **Kısmi** · **Yok** · **Mock** (kod var ama gerçek entegrasyon sahte)
- **Öncelik:** **P0** rakip olmak / pilot için şart · **P1** önemli eşitlik · **P2** olsa iyi olur
- **Efor:** **S** (küçük) / **M** (orta) / **L** (büyük)

## Genel tablo

| Alan | Karşılaştırılan | Var | Kısmi | Yok | Mock | P0 | P1 | P2 |
|---|---|---|---|---|---|---|---|---|
| Kurulum · Home · Kabuk · Chats · Archives | 110 | 35 | 31 | 42 | 2 | 5 | 23 | 48 |
| Engage · Automate | 132 | 39 | 34 | 55 | 4 | 5 | 28 | 60 |
| Team · Reports · Billing · Apps · HelpDesk | 236 | 114 | 47 | 63 | 12 | 5* | 32 | 82 |
| Settings · Widget · Kanallar | 83 | 28 | 21 | 32 | 2 | 4 | 20 | 31 |
| **Toplam** | **561** | **216 (%39)** | **133 (%24)** | **192 (%34)** | **20 (%4)** | **19** | **103** | **221** |

\* Bu alandaki 5 P0 satırı 3 ayrı sorunu temsil ediyor; HelpDesk e-posta eksiği plan tablosunda tekrar ediyor.

## Yol haritası — önce yapılacaklar

### P0 — Pilot ya da rakip olmak için şart

| # | Eksik | Alan | Efor | Nerede (nexa) |
|---|---|---|---|---|
| 1 | **Ticket'a yanıt verilemiyor.** Ticket'ta mesaj gövdesi, yazışma geçmişi ve iç not yok. | HelpDesk | L | `ticket-service.ts:433`, `TicketPane.tsx` → `ticket_messages` tablosu + `POST /tickets/{id}/messages` + SMTP |
| 2 | Gelen e-postadan yalnızca **konu** kaydediliyor; gövde ve ekler atılıyor. | HelpDesk | M | `services/channels/email-inbound.ts:161` |
| 3 | **E-posta yazışma zinciri (threading) yok.** Müşterinin her yanıtı yeni ticket açıyor. | HelpDesk | M | `inbound-email-address.ts` → In-Reply-To / plus-address eşleştirme |
| 4 | **Yazılan taslak sohbetler arasında taşınıyor.** Enter'a basılınca yanlış müşteriye gidebilir. Kod okumasıyla bulundu, çalıştırılarak doğrulanmadı. | Chats | **S** | `Composer.tsx:97`, `InboxPage.tsx:883` → `key={selectedId}` |
| 5 | **Arşivde serbest metin arama yok.** Komut paleti yalnızca son 50 sohbette arıyor. | Archives | L | `contract/openapi/paths/chats.yaml` → `query` parametresi + FTS/pg_trgm |
| 6 | Arşivde **tarih filtresi** yok; ajan, etiket ve puan filtreleri de eksik. | Archives | M | `group_id` API'de var ama arayüz kullanmıyor |
| 7 | Inbox'ın sağ panelinde **müşteri kartı yok** (ad, e-posta, konum, pre-chat cevapları, geçmiş sohbetler). | Chats | M | `DetailsPanel.tsx` |
| 8 | **Gerçek web sitesi taraması yok.** Tarayıcı sahte, tek sayfa okuyor. | Automate | L | `services/ai/web-crawler.ts:32` |
| 9 | **Gerçek dil modeli ve embedding varsayılan olarak kapalı**; skill derleyicisi kural tabanlı. | Automate | M | `config/env.ts:685`, `:746` |
| 10 | **PDF bilgi kaynağı eklenemiyor.** | Automate | M | `knowledge-file-parse.ts:42` |
| 11 | **Pre-chat formu kapatılamıyor**; dört alanın dördü de zorunlu. | Widget | **S** | `apps/widget/src/widget.ts:1123` |
| 12 | **Widget dili** panelden seçilemiyor, tarayıcı dili de algılanmıyor. Türkçe pilotta widget İngilizce açılıyor. | Widget | **S** | `apps/widget/src/loader.ts:27`, `i18n.ts` |
| 13 | **Ajan yanıt vermezse sohbet başka ajana aktarılmıyor**; "inactive" durumu yok. | Settings / Chats | M | `services/chat/chat-timeout.ts` |

**Hızlı kazanımlar (efor S):**
- #4, #11 ve #12
- Settings sayfalarına kaydedilmemiş değişiklik uyarısı
- Davette varsayılan rolün `admin` yerine `agent` olması
- Okundu bilgisinin gösterilmesi
- Takıma transfer için arayüz

### P1 — Önemli eşitlik (öne çıkanlar)

**Kampanyalar**
- Yalnızca düz metin; buton (mesaj gönder / URL aç / kupon kopyala), görsel ve başlık yok. Bu yüzden LiveChat'in 10 kampanya şablonunun hiçbiri kurulamıyor; şablon galerisi de yok.
- Hedefleme tek koşul (URL). Çıkış niyeti, sayfada kalma süresi, yeni/geri gelen ziyaretçi, ülke, referrer ve AND/OR yok.
- Kampanya silinemiyor (silme API ucu yok); kampanya raporu yok.
- "Geçerli sayfa URL'si" koşulu, ziyaretçinin gezdiği tüm sayfalara bakıyor (`campaign-matching.ts:80`).

**Reports**
- Yalnızca tarihe göre filtre var; ajan, grup, etiket, ülke ve anahtar kelime filtresi yok.
- Eksik raporlar: kaçan sohbetler, etkileşim (engagement), uygunluk ve ajan aktivitesi, kuyrukta bekleme ve terk. Kuyruk zamanı (`threads.queued_at`) şemada var ama kullanılmıyor.

**Automate**
- Olaya bağlı önerilen yanıtlar yok.
- Kayıtlı yanıtlarda özel (private) görünürlük, değişken ve otomatik etiket yok.
- Yönlendirme kuralları arayüzü yalnızca tek bir "URL içerir" koşulu gönderiyor. API ise tam eşleşmeyi, ülkeyi ve birden fazla URL'yi destekliyor.
- Workflow'larda ticket yaşam döngüsü ve "sohbet puanlandı" tetikleyicileri yok.

**Widget ve Settings**
- Form alanı tipleri yalnızca metin, sayı, evet/hayır ve tarih. Seçim listesi, dropdown, çoklu seçim ve departman seçimi yok.
- Widget metinleri (çevrimdışı, kuyruk, placeholder) özelleştirilemiyor.
- Müşteriye transcript e-postası ve transcript iletme (forwarding) yok.
- Manuel atama modu yok.
- Ajan yanıt vermezse e-posta isteme yok.
- Uygunluk (Availability) ayarı yok.
- Launcher görünürlük modları yok.
- Widget logo göstermiyor.
- Puanlamaya yorum eklenemiyor.
- Widget içinde bilgi bankası araması yok.
- GTM, WordPress ve Shopify ile kurulum yok.

**Kanallar:** Messenger, WhatsApp, SMS ve Instagram mock.

**Kabuk**
- Her ekrandan açılabilen bir Copilot paneli yok.
- Kısayol listesi (Shift+/) ve Alt+↑/↓ ile sohbetler arası geçiş yok.
- Olay bazlı bildirim tercihleri yok.

**Team ve Billing**
- Profil düzenleme, uygulama içinden şifre değiştirme ve owner devri yok.
- Günlük/haftalık özet e-postası yok.
- Ödeme mock.
- Faturalar yalnızca CSV olarak iniyor.
- Fatura adresi ve vergi numarası alanı yok.
- Abonelik iptal edilemiyor.

**Apps ve geliştirici platformu**
- 103 uygulama kartı mock; yalnızca Brevo, Freshdesk ve Telegram canlı.
- Üçüncü taraf uygulamalar ajan arayüzüne kendi panelini ekleyemiyor.
- Barındırılan API dokümanı yok.
- Webhook teslim günlüğü arka uçta var ama arayüzü yok.

### Bilinçli olarak yapılmayanlar (ADR)
- Görsel workflow ve bot akış editörü, koşullu dallanma/bekleme (ADR-14; `workflows` tablosu kodda kullanılmıyor)
- Sektör benchmark'ı
- Masaüstü uygulaması

## nexa'nın önde olduğu yerler (özet)

**Tek planda sunulanlar** (LiveChat'te Business ya da Enterprise planına kilitli):
- ajan performansı ve yanıt süreleri
- personel ihtiyacı tahmini
- zamanlanmış raporlar ve vardiya planlayıcı
- denetim günlüğü
- SSO/SCIM ve HIPAA

**Güvenlik ve uyumluluk:**
- SAML/SCIM, workspace genelinde 2FA zorunluluğu, IP/CIDR izin listesi
- hash zincirli denetim günlüğü, SIEM, veri saklama süresi, AB/ABD veri bölgesi
- Luhn kontrollü kart maskeleme; veritabanında, loglarda, e-postada ve yapay zekâ girdisinde maskeli

**Ürün:**
- HelpDesk, ChatBot ve bilgi bankası ürünün içinde.
- Rapor paylaşım linkleri, PDF dışa aktarma ve doğal dille rapor sorgusu var.
- İmzalı ve yeniden denenen webhook'lar; Zapier, Make ve MCP desteği var.
- Mesaj yazarken yanıt önerisi ve Copilot taslağı çıkıyor. Mesaj düzenlenebiliyor, başarısız mesaj yeniden denenebiliyor.
- Kurulum otomatik doğrulanıyor ve onboarding kapısı kalıcı kapanıyor.
- Koyu tema, Arapça (sağdan sola) ve markaya göre ayrı widget görünümü var.

## LiveChat hatalarından dersler: nexa'da durum

| Ders | nexa |
|---|---|
| Kaydedilmemiş değişiklik uyarısı tutarsız | ⚠️ **Kısmen tekrarlıyor.** Altyapı var (`lib/dirty-guard.tsx`, AppShell koruması) ama yalnızca Playbook/SkillEditor kullanıyor. Settings bölümleri bunu bildirmiyor; bölüm değiştirince taslak sessizce kayboluyor (S) |
| Davette varsayılan rol en yetkili rol | ⚠️ **Tekrarlıyor:** `InviteTeammates.tsx:110` → `'admin'`. `'agent'` olması önerilir (S) |
| Karışık kaydetme kalıbı (anında kaydeden toggle ile Save butonlu sayfalar bir arada) | ⚠️ Kısmen: `Tags.tsx`'teki takım kapsamı anında kaydediyor |
| Değerlerin sessizce düzeltilmesi | ✅ Tekrarlamıyor (açık hata mesajı veriliyor) |
| Enter ile sayfanın eski tip form olarak gönderilmesi | ✅ Tekrarlamıyor (`lib/form.ts` `preventDefault` çağırıyor) |
| Esc'in üstteki modalı da kapatması | ✅ Tekrarlamıyor (modal yığını doğru yönetiliyor) |

---
Aşağıda dört alanın tam tabloları var; her satırda kanıt dosyası ve uygulama ipucu yer alıyor.


---

# Boşluk Analizi 01 — Onboarding · Home · Global kabuk · Chats/Inbox · Archives

> LiveChat (referans) ↔ SiyahTuş/nexa (`C:\Users\Hobbie\Desktop\nexa-main`). Tarih: 2026-10-14. Salt okuma, statik kod incelemesi. Hiçbir şey çalıştırılmadı.
> Kaynaklar: `report.md` s.54–477 ve 1004–1077 (LiveChat) · `nexa-ozellikler.md` (nexa envanteri) · nexa kaynak kodu (aşağıdaki yollar `apps/…` köküne göredir).
> Durum: **Var** (eşdeğeri var) · **Kısmi** (bir kısmı var veya başka yerde) · **Yok** · **Mock** (yalnız etiket/sahte yüzey).
> Öncelik: **P0** = LiveChat rakibi için çekirdek / pilotu engeller · **P1** = önemli eşitlik · **P2** = olsa iyi olur. Efor: **S** (≤2 gün) · **M** (≤1 hafta) · **L** (>1 hafta).
> "Var" satırlarında öncelik/efor "—" yazıldı (açık boşluk yok).

## 1. Karşılaştırma tablosu

### A. Onboarding / kod kurulumu

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı / uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A1 | Kurulum kapısı (yeni hesabı onboarding'e yönlendirme) | `/install-code` tam ekran kapı; her yüklemede yeniden çıkıyor | Var | `web/src/App.tsx:104-121` (`onboarding_completed === false` → `/app/onboarding`) | Kapı sunucuda kalıcı olarak kapanıyor, LiveChat'teki gibi tekrar açılmıyor. | — | — |
| A2 | Kurulum ekranında snippet + **Copy code** | Kod kutusu + Copy code (+ ardından Check status) | Kısmi | `web/src/features/onboarding/OnboardingWizard.tsx` (website adımı yalnız domain alıyor: `auth.onboarding.website.domainLabel`); snippet + kopyala yalnız `features/settings/WebsiteWidgets.tsx:298-306` | Sihirbazda snippet görünmüyor; kullanıcı onboarding'i bitirse bile kodu almak için Settings'e gitmesi gerekiyor. İpucu: website adımı `addWebsite` yanıtındaki snippet'i `WebsiteWidgets`'taki kopyalama bileşeniyle göstersin. | P1 | S |
| A3 | Kurulum durumu kontrolü ("Check status" → "Code not installed") | Elle tetiklenen kontrol | Var | `api/src/services/websites/website-service.ts:230-245` (`markWebsiteConnected`: widget'ın ilk el sıkışmasında pending→connected) | Kontrol pasif yapılıyor ve LiveChat'inkinden iyi. Eksikler: sihirbazda canlı "bekleniyor/bağlandı" göstergesi yok, isteğe bağlı "şimdi kontrol et" (siteyi tarama) yok. | P2 | S |
| A4 | **Invite your developer** (e-posta + Send invite, doğrulama) | Sunucu tarafında davet e-postası | Kısmi | `WebsiteWidgets.tsx:293` (`mailto:` ile yöneticinin kendi posta istemcisi) | Sunucu e-postası, takip ve onboarding içinde akış yok. İpucu: mevcut SMTP taşıyıcısıyla `POST /websites/{id}/invite-developer` (snippet + kurulum linki). | P2 | S |
| A5 | Copy invite link (süreli) | 13 gün geçerli link, tooltip | Var | `web/src/features/team/InviteTeammates.tsx:9,268` | Geliştiriciye özel kısıtlı rol yok (bkz. Dersler §3). | — | — |
| A6 | Install guide (yardım makalesi linki) | Kod kartında ve GTM'de ↗ | Yok | `apps/web/src` içinde "help center/install guide" araması sonuç vermedi | İpucu: Public KB'de (`features/playbook/KbArticle*`) "Widget kurulumu" makalesi açıp sihirbazdan ve Settings'ten link vermek. | P2 | S |
| A7 | Google Tag Manager ile kurulum (Connect + rehber) | OAuth ile GTM bağlantısı | Mock | Yalnız etiket: `web/src/locales/en/settings.ts:434` "Platform (Shopify / WordPress / GTM)" | GTM entegrasyonu yok. İpucu: GTM Community Template Gallery'ye "Custom Template" yayınlamak (OAuth gerekmez). | P2 | M |
| A8 | Platform eklentileri (14 adet: WordPress, Shopify, WooCommerce, BigCommerce, Wix, Webflow, Squarespace, Magento, Joomla, Drupal, Segment…) | Her biri marketplace eklentisine dış link | Mock | `WebsiteWidgets.tsx:352-366` (şema yalnız `manual \| platform`; yorum: "marks the install method rather than the specific platform brand") | Hiçbir platform eklentisi yok. İpucu: önce WordPress eklentisi (snippet + organizationId ayarı) ve Shopify theme app embed; loader zaten tek satır. | P1 | L |
| A9 | `<noscript>` "Chat with us" yedek linki | Snippet içinde | Yok | `apps/api/src` ve `apps/web/src` içinde `noscript` yok; hosted `widget/chat.html` mevcut | İpucu: snippet üreticisine hosted Chat page linkli `<noscript>` eklemek. | P2 | S |
| A10 | "I don't want to chat yet" / kurulumu atla | Buton | Var | `OnboardingWizard.tsx` (`auth.onboarding.skip`) | — | — | — |

### B. Home

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı / uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| B1 | Karşılama + "Let's get you started" kontrol listesi | 8 madde, akordeon, sağda illüstrasyon | Var | `web/src/features/home/HomePage.tsx`, `api/src/services/home/home-service.ts:93-112` | 5 madde var (install_widget, invite_teammate, customize_widget, add_canned_response, set_up_ai_agent) ve ilerleme çubuğu. Maddeler sunucuda veriden türetiliyor. | — | — |
| B2 | Eksik checklist maddeleri (sample chat dene, Copilot'u dene, kanal ekle, kampanya, chatbot'u test et) | Var | Kısmi | `home-service.ts:108-112` | İpucu: `#activation` fonksiyonuna kampanya sayısı, bağlı kanal ve (seed edilmişse) demo sohbet maddelerini ekle. | P2 | S |
| B3 | Madde başına birden çok aksiyon + açıklama + illüstrasyon | Akordeon kartları | Kısmi | `HomePage.tsx` (tek "Set up" linki: `home.activation.setUp`) | Görsel ve açıklama zenginliği az. | P2 | S |
| B4 | Maddeyi atla (Skip) | Madde 5 ve 8'de | Yok | `HomePage.tsx` içinde skip/dismiss yok | Durum türetildiği için atlanan maddeyi saklayacak bir alan gerekiyor (`onboarding` tablosuna `skipped_steps`). | P2 | S |
| B5 | "0/5 recommended users invited" teşviki | Şirket büyüklüğüne göre öneri | Yok | — | Onboarding'de şirket büyüklüğü zaten toplanıyor; öneri sayısı buradan türetilebilir. | P2 | S |
| B6 | Örnek sohbet (sample chat: kısıtlı eylemler, bilgi bandı, tur) | Otomatik hazır, "End sample chat" | Kısmi | `api/src/services/onboarding/onboarding-service.ts:73` (opsiyonel demo seed gerçek bir chat açıyor) | Demo sohbet "sample" olarak işaretlenmiyor, bilgi bandı yok, tehlikeli eylemler kısıtlanmıyor. İpucu: `chats.is_sample` bayrağı + Inbox'ta band. | P2 | M |
| B7 | Preview widget (kendi sitesinde) + site URL'sini satır içinde düzenleme | Var | Kısmi | `features/settings/WidgetCustomization.tsx` (panel içi canlı önizleme), `widget/demo.html` | Kendi sitesinde önizleme yok, Home'dan URL düzenlenemiyor. | P2 | S |
| B8 | Ürün turu (6 adım, sol ray ikonlarını vurgulayan spotlight) | Var | Kısmi | `web/src/components/Tour.tsx` (ortalanmış Modal adımları; "spotlight değil" yorumu), yalnız Inbox'ta `features/inbox/TakeTourBanner.tsx:66-69` (4 adım) | Home'da modüller arası tur yok, öğe vurgulaması yok. | P2 | M |
| B9 | Canlı sayaçlar + performans ve haftalık KPI | Yok (yalnız checklist) | Var | `HomePage.tsx` (`home.live.*`, `home.performance.*`, `home.weekly.*`) | nexa önde. | — | — |

### C. Global üst bar ve kabuk

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı / uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| C1 | Sol ray modülleri + rozetler | Var | Var | `web/src/components/navigation.ts`, `AppShell.tsx` (`shell.nav.badge.*`) | — | — | — |
| C2 | Kenar çubuğunu gizle/göster (`[` kısayolu) | Var | Kısmi | `AppShell.tsx:36,418` (daraltma/sabitleme düğmesi var) | Klavye kısayolu yok. | P2 | S |
| C3 | Trial banner + Upgrade now | Var | Var | `AppShell.tsx` (`shell.trial.remaining`, `shell.subscribe`) | — | — | — |
| C4 | Sohbet kabul eden ajan göstergesi → Team | "(A) 1" | Var | `components/PresenceAvatars.tsx` | — | — | — |
| C5 | "+ Invite" menüsü (Invite teammate / Set up ChatBot) | Var | Var | `AppShell.tsx:578-667` (QuickCreateMenu: davet + yeni takım; boş koltuk sayısı) | "Set up AI agent" kısayolu eklenebilir (P2). | — | — |
| C6 | Davet modalı (çoklu e-posta, satır başına rol, kopya kontrolü, doluyken kapatma onayı) | Var | Var | `features/team/InviteTeammates.tsx`, `lib/dirty-guard.tsx` | — | — | — |
| C7 | Ctrl+K komut paleti (aç, ok tuşları, Enter, Esc) | Var | Var | `components/CommandPalette.tsx:155,414-438` | — | — | — |
| C8 | Palet: ayar alt sayfalarına ve rapor sekmelerine gitme ("set" → Invite settings, Chat forms…) | Onlarca hedef | Kısmi | `components/navigation.ts` (yalnız 9 modül: home, inbox, customers, team, playbook, reports, billing, settings, developers) | 33 ayar bölümü palette aranamıyor. İpucu: `features/settings/settings-sections.ts` zaten etiket ve anahtar kelime taşıyor; `NAV_DESTINATIONS`'a eşle. | P1 | S |
| C9 | Palet komutları (Stop/Start Accepting Chats) | Var | Var | `components/actions.ts` (tek eylem) | — | — | — |
| C10 | Palet: bağlama duyarlı eylemler (End chat, Tag chat, Upload file) | Composer'da Ctrl+K | Yok | `actions.ts` ("This turn wires exactly one action") | İpucu: `ACTIONS`'a seçili sohbet bağlamı (`useInbox` mutasyonları) ekle. | P2 | M |
| C11 | Palet: "Search in archives" modu | Arşivde arama | Kısmi | `CommandPalette.tsx:206-215`: "Chats have no free-text endpoint… the fifty most recent conversations are searchable" | En yeni 50 sohbetle sınırlı ve istemci tarafında. Kök neden E2 ile aynı (`GET /chats?query=`). | P0 | M |
| C12 | Palet: müşteri ve ticket araması | Archives üzerinden | Var | `CommandPalette.tsx:183-204` (`/customers?query=`, `/tickets?query=`) | — | — | — |
| C13 | Palet: Ask Copilot / "Summarize my team's activity" | Var | Kısmi | `CommandPalette.tsx` `ai:ask` → `POST /palette/ai-query` (yalnız rapor metrikleri, `reports_read`) | Ürün yardımı ve genel soru yok. | P2 | S |
| C14 | Palet: Walkthrough kartı, satır içi otomatik tamamlama, eylem rozetleri | Var | Yok | `CommandPalette.tsx` | Kullanılabilirlik cilası. | P2 | S |
| C15 | **Global Copilot paneli** (Ctrl+G, sağ çekmece, genişlet, "Train me with sources", ürün yardımı ve metrikler) | Var | Kısmi | Sohbete bağlı `features/inbox/CopilotPanel.tsx` ("Ask about your reports" dahil) + palette Ask AI; kabukta panel yok | Sohbet dışında, her ekrandan erişilen bir asistan yok. İpucu: CopilotPanel'in rapor ve KB RAG yollarını `AppShell`'de çekmece olarak sunmak; Ctrl+G. | P1 | M |
| C16 | News / What's new paneli (rozetli) | Beamer | Yok | Kod tabanında "what's new/changelog" yok | İpucu: Public KB'de "Changelog" kategorisi + rayda okunmamış rozeti. | P2 | M |
| C17 | Profil menüsünde Accept chats anahtarı | Var | Kısmi | Müsaitlik Inbox rayında ve palette (`actions.ts`); hesap menüsünde yok (`AppShell.tsx`: language, theme, font, signOut) | İpucu: hesap menüsüne `useSetRoutingStatus` anahtarı. | P2 | S |
| C18 | Dark mode | Yalnız Home, Chats, Traffic | Var | `lib/theme.ts`, `styles/tokens.css` | Tüm panelde var, nexa önde. | — | — |
| C19 | Bildirim tercihleri: tarayıcı izni, ses aç/kapa | Var | Var | `features/settings/NotificationSettings.tsx:84-191` | — | — | — |
| C20 | Olay bazlı bildirim seçimi (New messages sabit açık, Incoming chats, Visitors in queue, New/Returning visitors, New tickets) | Var | Yok | `NotificationSettings.tsx` yalnız enabled/sound/desktop/push/email anahtarlarını taşıyor | İpucu: tercih şemasına `events: {incoming_chat, queue, new_visitor, returning_visitor, ticket}` ekle, `features/notifications/notifications.ts:70-87` filtrelesin. | P1 | M |
| C21 | "New message" sesini okunana kadar tekrarla | Var | Yok | `notifications.ts` | Kaçırılan sohbet riski var. İpucu: aralıklı ses; `useMarkSeen` tetiklenince dursun. | P1 | S |
| C22 | Ses testi `(test)` / ses seçimi | Var | Yok | — | — | P2 | S |
| C23 | Uygulama indirme linkleri (Android, iOS, Desktop) | Var | Yok | Mobil uygulama var (`apps/mobile`) ama panelde link yok | Desktop bilerek yok (PRD). Mobil mağaza linkleri yayın sonrasında eklenir. | P2 | S |
| C24 | Help Center linki | Var | Yok | — | A6 ile birlikte. | P2 | S |
| C25 | Report an issue (tanı paketi indir) | Var | Yok | — | İpucu: son API `request_id`'leri, istemci sürümü ve RTM durumunu içeren bir JSON indirme. | P2 | M |
| C26 | Klavye kısayolları modalı (Shift+/) | Var | Yok | Global keydown dinleyicisi yalnız `CommandPalette.tsx:155` (diğerleri Modal/Dropdown içi) | İpucu: `components/ShortcutsModal.tsx` + tek bir global kısayol kaydı. | P1 | S |
| C27 | Şirket bilgileri (ad, website, şehir, ülke, 110 sektör, büyüklük, B2B/B2C kitle) | Var | Kısmi | `features/settings/CompanyDetails.tsx` (ad, 13 sabit sektör, büyüklük, adres, saat dilimi) | Kitle (B2B/B2C/iç kullanım) ve sektör listesi dar. | P2 | S |
| C28 | Panel içinde satıcının kendi destek widget'ı | Turuncu balon | Yok | — | İpucu: pilot desteği için panelde nexa'nın kendi widget'ını (dogfooding) yüklemek. | P2 | S |

### D. Chats / Inbox (ajan sohbet deneyimi)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı / uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| D1 | Liste bölümleri (My chats, Queued, Unassigned, Supervised) | Var | Var | `features/inbox/views.ts`, `chats.yaml` `view` enum | Ek olarak AI, kanal ve kayıtlı görünümler var (nexa önde). | — | — |
| D2 | Liste içinde daraltılabilir gruplu bölümler | "˅ My chats (1)" | Kısmi | Görünümler sol rayda, liste tek görünüm gösteriyor | Tek ekranda birden fazla bölüm görülemiyor. | P2 | S |
| D3 | Newest/Oldest sıralama | Var | Var | `InboxPage.tsx:261-266,637-647`, `chat-sort.ts` (URL'de) | — | — | — |
| D4 | Satırda avatar + geçen süre (canlı artan "33m") | Var | Yok | `InboxPage.tsx:748-797` (satırda ad, kuyruk sırası, okunmamış, son mesaj, etiketler) | Bekleme süresi görünmüyor, oysa ajanlar önceliği buna göre belirler. İpucu: `last_event.created_at`'tan göreli zaman + baş harfli avatar. | P1 | S |
| D5 | Satır hover eylemleri (✕ kapat, ⋯ transfer/ticket) | Var | Yok | `InboxPage.tsx:748-797` | — | P2 | S |
| D6 | Ajana transfer | Var | Var | `DetailsPanel.tsx` assign, `useInbox.ts:822` (`/transfer {agent_id}`) | — | — | — |
| D7 | Takıma (gruba) transfer | Var | Kısmi | API destekliyor: `packages/contract/openapi/paths/chats.yaml:383-386` ("Exactly one of `group_id` or `agent_id`"); UI yalnız `agent_id` gönderiyor (`useInbox.ts:822`) | İpucu: DetailsPanel atama menüsüne "Takıma aktar" listesi eklemek. | P1 | S |
| D8 | Create HelpDesk ticket (sohbetten) | Var | Var | `features/inbox/CreateTicketButton.tsx` | — | — | — |
| D9 | Ban this customer (sohbet menüsünden) | Var | Kısmi | Ban yalnız Customers'ta (`features/customers/CustomerDetailPanel.tsx`); Inbox'ta yok | — | P2 | S |
| D10 | Sohbeti bitir / arşivle (+ yeniden aç) | End chat | Var | `DetailsPanel.tsx:408-420`, `useInbox.ts:795` | Yeniden açma da var. | — | — |
| D11 | Supervise / devral | Var | Var | `DetailsPanel.tsx` takeover, Traffic "Supervise chat" | — | — | — |
| D12 | Kuyruktan müşteri al (Ctrl+Alt+J) | Var | Kısmi | Takeover ve Traffic'te "Assign chat to me" var, kısayol yok | — | P2 | S |
| D13 | Composer Message/Note modu (Note sarı) | Var | Var | `Composer.tsx:509-560` | — | — | — |
| D14 | Enter gönder, Shift+Enter yeni satır, yanlış gönderim koruması | Var ("#" tek başına Send'i aktif ediyor) | Var | `Composer.tsx:142-143` (boşlukları kırpıyor), `460-492` (picker açıkken Enter'ı picker alıyor) | nexa daha güvenli. | — | — |
| D15 | **Sohbet başına taslak kalıcılığı** | Taslak sohbete bağlı ve sayfa değişiminde korunuyor | Kısmi | `Composer.tsx:97` `useState('')`; `InboxPage.tsx:883` `<Composer chatId=…>` key almıyor ve chatId değişince metni sıfırlayan efekt yok | Kodda görülen risk (çalıştırılarak doğrulanmadı): A sohbetinde yazılan taslak B sohbetine geçince composer'da kalıyor ve Enter ile **yanlış müşteriye** gidebilir. Modülden çıkınca da taslak kayboluyor. İpucu: chatId anahtarlı zustand/sessionStorage taslak deposu + `key={selectedId}`. | P0 | S |
| D16 | "#" ile kayıtlı yanıt ekleme | Var | Var | `Composer.tsx:125-126,648-681`, `useCannedResponses.ts` | — | — | — |
| D17 | Canned: grup ve adetle gezinme, içerikte arama | "#he" → help grubu; GENERAL başlığı | Kısmi | `useCannedResponses.ts:60-68` (yalnız shortcut `startsWith`, `.slice(0, 6)`) | Metin içinde arama yok, 6'dan fazlası görünmüyor. | P1 | S |
| D18 | Canned değişkenleri (%customer-name%, %agent-name%, e-postalar) | {x} menüsü | Yok | `features/settings/CannedResponses.tsx` (alanlar: shortcut, text, visibility, group_id) | İpucu: `applyShortcut` sırasında `chat.users` ve `agent` ile yer tutucuları doldurmak; ayar ekranına {x} menüsü. | P1 | M |
| D19 | Canned Shared/Private | Var | Kısmi | `CannedResponses.tsx:38-56` (`visibility: all \| group`) | Kişisel (yalnız ben) yanıt yok. | P2 | M |
| D20 | Bir yanıta birden çok kısayol | Var | Yok | Şemada `shortcut` tek değer | — | P2 | S |
| D21 | Ajan mesajından "Save as canned response" | Var | Yok | `Transcript.tsx` (yalnız edit) | — | P2 | S |
| D22 | Composer'dan "+ New" canned ve ⚙ yönet | Var | Yok | — | — | P2 | S |
| D23 | Araç çubuğunda "#" butonu | Var | Yok | `Composer.tsx:728-821` | Fareyle çalışan kullanıcı için keşfedilebilirlik. | P2 | S |
| D24 | Event-based canned önerileri ve canned ile otomatik etiket | Var | Yok | — | Kısmen Reply Suggestions karşılıyor (D25). | P2 | M |
| D25 | Reply suggestions (AI) | Kaynak eklenmezse disabled | Var | `Composer.tsx:325-443` (boş alanda Space → şablon çipleri + Copilot taslağı) | nexa önde. | — | — |
| D26 | Emoji seçici (arama, 8 kategori, tam set) | Var | Kısmi | `features/inbox/emoji.ts:15-19` (3 kategoride 24 emoji, arama yok) | — | P2 | S |
| D27 | ":" emoji kısayolu (":smi" önerileri) | Var | Yok | `Composer.tsx` onKeyDown içinde `:` işlenmiyor | İpucu: `activeShortcutQuery` desenini `:` için kopyalamak. | P2 | S |
| D28 | Dosya yükleme | Var | Var | `Composer.tsx:229-246,807-817` | — | — | — |
| D29 | Composer ve sohbet kısayolları (Alt+↑/↓ sohbet geçişi, Ctrl+Alt+M etiket, Ctrl+Alt+U dosya, Ctrl+Alt+C öneri, Ctrl+Alt+Backspace kapat) | Var | Yok | Composer onKeyDown yalnız Space/Esc/Enter/ok tuşlarını işliyor (`Composer.tsx:445-493`) | Yoğun ajanlar için Alt+↑/↓ en kritik olanı. C26 ile tek kısayol kaydında toplanabilir. | P1 | M |
| D30 | Tek kelimelik hayalet otomatik tamamlama | Var (yalnız EN) | Yok | — | Düşük değerli. | P2 | M |
| D31 | Etiket ekle/kaldır, öneri listesi | Var | Var | `Composer.tsx:861-924` TagPicker, `DetailsPanel.tsx:234-287` | Yeni etiket de oluşturulabiliyor (nexa önde). | — | — |
| D32 | Etiket seçicide arama/filtre, sabitleme (📌), "No tags found" | Var | Kısmi | TagPicker listeyi filtrelemiyor, sabitleme yok | — | P2 | S |
| D33 | Mesaj tepkileri (reactions) | Var | Yok | `Transcript.tsx` | — | P2 | M |
| D34 | Okundu bilgisi ("Read • 33m") | Var | Yok | Veri var: contract `ChatSummary.users[].seen_up_to` (`packages/contract/openapi/openapi.yaml:1076+`), `features/inbox/types.ts:71`; `Transcript.tsx` bunu göstermiyor | İpucu: müşterinin `seen_up_to` değerinden sonraki son ajan mesajına "Okundu" eklemek. | P1 | S |
| D35 | Mesaj zaman damgası | Hover tooltip | Var | `Transcript.tsx:479-493` (satır içi, yerel saat) | — | — | — |
| D36 | Ürün kartı / zengin mesaj (görsel, fiyat, buton) | Var | Yok | — | E-ticaret entegrasyonuyla birlikte değerlendirilmeli. | P2 | M |
| D37 | **Müşteri kartı** (ad, e-posta, konum ve harita) sağ panelde | Var | Yok | `features/inbox/DetailsPanel.tsx` bölümleri: conversation, tags, teams, apps, visitedPages, visitInfo; e-posta, ülke ve şehir yok | Ajan kiminle konuştuğunu Inbox'ta göremiyor ve Customers'a geçmek zorunda. İpucu: `chat.users` (name/email) + customer kaydı + GeoIP ülke/şehir ile üstte kart, "Profili aç" linki. | P0 | M |
| D38 | Pre-chat form cevapları sohbet panelinde | Var | Kısmi | Yalnız Traffic `features/traffic/VisitorPanel.tsx`'te; Inbox'ta yok | — | P1 | S |
| D39 | Aynı müşterinin geçmiş sohbetleri panelde | Var ("browsing or chat history") | Kısmi | Yalnız `CustomerDetailPanel.tsx:263-275`'te; Inbox'ta yok | İpucu: `GET /chats?customer_id=` zaten var (`chats.yaml:62`). | P1 | S |
| D40 | Ek bilgi: sohbet süresi, gruplar | Var | Var | `DetailsPanel.tsx:376-392` (süre, cihaz, referrer, IP), teams bölümü | — | — | — |
| D41 | Panel bölümlerini sürükle/daralt, kartı kompakt moda alma | Var | Kısmi | Panelin tamamı daraltılabiliyor (`rightPanel.ts`), bölümler ayrı ayrı daraltılamıyor | — | P2 | S |
| D42 | Panele uygulama ekleme (+) | Var | Var | `DetailsPanel.tsx:304-330` Apps bölümü | — | — | — |
| D43 | Chats turu | 5–6 adım | Var | `TakeTourBanner.tsx` (4 adım) | — | — | — |
| D44 | Mobil ajan: canned, emoji, dosya | Var (LC mobil) | Kısmi | `apps/mobile/src/features/inbox/Composer.tsx` (yalnız metin + not) | Kapsam dışı notu: mobilde canned ve dosya yok. | P2 | M |

### E. Archives (sohbet geçmişi ve arama)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı / uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| E1 | Ayrı Archives modülü (liste + transkript + müşteri paneli) | `/archives` | Kısmi | Inbox "Archive" görünümü (`chats.yaml` `view=archived`), `features/inbox/views.ts` | Arama/filtre odaklı bir tarih ekranı yok. | P1 | M |
| E2 | **Serbest metin arama** (mesaj içeriği, müşteri, e-posta; URL'de `query=`) | Var | Yok | `packages/contract/openapi/paths/chats.yaml:25-70` (`listChats` parametreleri: view, channel, customer_id, group_id, sort, page; `query` yok); `CommandPalette.tsx:206-215` notu | Geçmiş bir konuşmayı bulmanın yolu yok. İpucu: `GET /chats?query=` + `events.text` üzerinde Postgres FTS veya `pg_trgm` (aylık partition'lar için partition başına GIN), RLS altında. | P0 | L |
| E3 | Filtre: Tarih (Today…Custom period, iki aylık takvim, ‹ › ile kaydırma) | Var | Yok | `chats.yaml` (date_from/date_to yok) | İpucu: `date_from/date_to` parametresi + Reports'taki tarih aralığı bileşenini yeniden kullanmak. | P0 | M |
| E4 | Filtre: Ajan (çoklu) | Var | Yok | Yalnız `view=my` (kendisi) | Not: LiveChat ajan e-postasını URL'ye koyuyor, nexa UUID kullanmalı (bkz. Dersler). | P1 | S |
| E5 | Filtre: Grup/takım | Var | Kısmi | API'de `group_id` var (`chats.yaml:65`), UI'da kullanılmıyor (`features/inbox`'ta `group_id=` yok) | — | P1 | S |
| E6 | Filtre: Puan (rated good/bad/commented, not rated) | Var | Yok | Inbox'ta puan gösterimi de yok (`features/inbox` içinde rating/CSAT yok) | — | P1 | M |
| E7 | Filtre: Etiket (any/all/exclude, en fazla 20) | Var | Yok | `chats.yaml` (tag parametresi yok) | Liste satırında etiket çipleri zaten var (`InboxPage.tsx:783-795`). | P1 | M |
| E8 | Filtre: Atama (assigned/unassigned) | Var | Kısmi | `view=unassigned` yalnız açık sohbetler için | — | P2 | S |
| E9 | Filtre: Availability (sohbet başladığında online/offline) | Var | Yok | — | — | P2 | M |
| E10 | Filtre: Ülke | Var | Yok | Ülke filtresi yalnız Customers'ta (`CustomersFilters.tsx`) | — | P2 | S |
| E11 | Filtrelerin URL'de tutulması (deep link) | Var | Kısmi | Sıralama URL'de (`chat-sort.ts`), filtre yok | E3–E7 ile birlikte yapılmalı. | P1 | S |
| E12 | Sonuç sayacı ("0 chats") | Var | Var | `chats.yaml` `total` | — | — | — |
| E13 | Liste yoğunluğu (Detailed/Default/Compact) | Var | Yok | — | — | P2 | S |
| E14 | Arşiv sohbetinde puan ve yorum gösterimi | Var | Yok | `DetailsPanel.tsx` | — | P1 | S |
| E15 | Transkripti dışa aktarma / yazdırma / e-postayla gönderme | Var (ajan ve ziyaretçi tarafında "Send transcript") | Yok | `apps/web`, `apps/api`, `apps/widget` içinde transcript export/print/email araması sonuç vermedi | İpucu: `GET /chats/{id}/transcript.(txt\|pdf)` + mevcut SMTP ile e-posta; widget menüsüne "Transcript gönder". | P1 | M |
| E16 | Arşivde toplu seçim ve dışa aktarma | Var | Yok | Toplu işlem yalnız ticket'larda (`TicketBulkBar.tsx`) | — | P2 | M |
| E17 | Ctrl+Shift+L "filtre ekle" kısayolu | Var | Yok | — | C26 ile birlikte. | P2 | S |
| E18 | Boş arşiv durumu (Install / invite developer CTA) | Var (ama liste tarafı sonsuz skeleton) | Var | `components/EmptyState.tsx` | nexa'da boş durum ile yükleniyor durumu ayrı. | — | — |
| E19 | Arşivlenmiş sohbeti yeniden açma | — | Var | `DetailsPanel.tsx:419-420` | nexa önde. | — | — |

### Sayım

| Durum | Adet |
|---|---|
| Var | 35 |
| Kısmi | 31 |
| Yok | 42 |
| Mock | 2 |
| **Toplam satır** | **110** |

| Öncelik (75 boşluk + A3'teki küçük iyileştirme = 76) | Adet |
|---|---|
| P0 | 5 (C11, D15, D37, E2, E3) |
| P1 | 23 |
| P2 | 48 |

---

## 2. nexa'nın önde olduğu yerler

1. **Kurulum doğrulaması pasif ve otomatik.** Widget'ın ilk el sıkışmasında site "Connected" oluyor (`website-service.ts:230-245`). LiveChat'te elle "Check status" gerekiyor.
2. **Onboarding kapısı kalıcı ve sunucu taraflı** (`onboarding_completed`). LiveChat'teki gibi her yenilemede kapıya geri düşme yok.
3. **Onboarding'de şirket büyüklüğü, ekip daveti, kanal tanıtımı ve tek tıkla örnek veri** var (`OnboardingWizard.tsx`, `onboarding-service.ts`).
4. **Home gerçek bir dashboard.** "Right now" canlı sayaçları, 7 günlük performans karşılaştırması ve haftalık özet var. LiveChat Home'u yalnız kontrol listesinden ibaret.
5. **Dark mode tüm panelde** çalışıyor. LiveChat'te yalnız Home, Chats ve Traffic'te.
6. **Komut paleti müşteri ve ticket'ları sunucu tarafında arıyor**, eşleşme yoksa doğal dilde rapor sorusu ("Ask AI") sunuyor. Yetkisiz kapsamdaki sonuçlar gösterilmiyor.
7. **Inbox görünümleri daha zengin:** AI agent, AI solved, kanal görünümleri ve kayıtlı özel görünümler var. Sıralama URL'de tutuluyor.
8. **Composer güvenliği:** yalnız boşluktan oluşan mesaj gönderilemiyor, canned picker açıkken Enter picker'a gidiyor. LiveChat'te tek "#" bile Send'i aktif ediyor.
9. **Reply Suggestions:** boş alanda Space ile şablon çipleri ve 3 saniye içinde gelen Copilot taslağı. Bilgi kaynağı olmasa da çalışıyor; LiveChat'te kaynak eklenmeden düğme disabled.
10. **Copilot paneli** (özet → iç not, KB tabanlı yanıt taslağı, ton iyileştirme: rephrase/friendlier/formal/grammar).
11. **Mesaj düzenleme** ("edited"), **başarısız mesajı yeniden dene**, eşzamanlı düzenleme çakışma bandı, zengin metin (kalın/italik/liste).
12. **Ticket'lar Inbox'a entegre** (sohbetten ticket, "zaten var → aç"). Arşivlenmiş sohbet **yeniden açılabiliyor**, sohbet linki kopyalanabiliyor.
13. **Composer'dan yeni etiket** oluşturulabiliyor. LiveChat'te "No tags found" çıkıyor ve oluşturma seçeneği yok.
14. **Kaydedilmemiş değişiklik koruması** palet, ray ve tarayıcı için tek mekanizma (`lib/dirty-guard.tsx`). Modal yığınında Esc'e yalnız en üstteki modal yanıt veriyor (`components/ui/Modal.tsx:19-20,96-103`).
15. **Boş, yükleniyor ve hata durumları ayrıştırılmış** (`EmptyState`, `Skeleton`, `LoadError`).

---

## 3. LiveChat hatalarından dersler

1. **Kapı tutarsızlığı ve kaybolan deep link.** LiveChat'te tam yüklemede kapı tekrar çıkıyor ve Skip sonrası orijinal URL kayboluyor.
   - nexa'da kapı kalıcı kapanıyor (iyi).
   - Ama onboarding sırasında `*` → `/app/onboarding` `replace` yapılıyor (`App.tsx:117-121`). Bir bildirimden gelen `?chat=` linki onboarding bitince korunmuyor. Düşük risk, yalnız yeni sahip etkileniyor.
2. **Kopyalama geri bildirimi.** LiveChat Copy invite link'te "Copied" göstermiyor.
   - nexa'da snippet kopyalamada (`WebsiteWidgets.tsx:298-306`) ve sohbet linkinde (`ThreadHeader.tsx:146`) geri bildirim var. Yeni eklenecek kopyalama düğmelerinde de korunmalı.
3. **En yetkili rol varsayılan olmamalı.** LiveChat "invite developer" bağlamında bile Admin (billing access) seçiyor.
   - nexa'da da `InviteTeammates.tsx:110` varsayılan rol **`'admin'`**. Aynı sorun var. Varsayılan `'agent'` olmalı; geliştirici daveti için ayrı ve kısıtlı bir yol düşünülmeli.
4. **Kalıcı davet taslakları.** LiveChat'te iptal edilen form başka sekmede geri geliyor.
   - nexa'da taslağın tersine, sohbet composer taslağı sohbetler arasında sızıyor (D15). Taslaklar **sohbete bağlı** olmalı; iptal veya gönderimde temizlenmeli.
5. **Esc ile iç içe katmanda veri kaybı.** LiveChat'te Esc, popover açıkken alttaki modalı da kapatıyor.
   - nexa'nın modal yığını bunu çözüyor. Canned {x} menüsü, emoji ve etiket dropdown'ları eklenirken Dropdown içi Esc'in modalı kapatmadığı test edilmeli.
6. **Hata stili ve zamanlaması.** LiveChat'te doğrulama yalnız blur'da güncelleniyor, boş form açılır açılmaz hata gösteriliyor, duplicate hatası varken Send aktif kalıyor. Doğrulama yazarken temizlenmeli, ilk etkileşimden önce hata gösterilmemeli, hata varken birincil düğme pasif olmalı.
7. **Boş durum yükleniyor gibi görünmesin.** LiveChat Archives'ta boş liste sonsuz skeleton gösteriyor. nexa'da bu ayrım var; yeni Archives ekranında da korunmalı.
8. **Arama ve filtre gizlenmesin.** LiveChat'te arşiv boşken arama ve "Add filter" `display:none`. nexa Archives'ta arama çubuğu her zaman görünür olmalı.
9. **URL'de PII olmasın.** LiveChat Archives ajan filtresinde e-postayı (`agent[]=<e-posta>`), News linkinde kullanıcı e-postasını üçüncü tarafa query parametresi olarak taşıyor. nexa filtrelerinde yalnız UUID ve ID kullanılmalı; üçüncü taraf "News" entegrasyonu yapılırsa e-posta gönderilmemeli.
10. **Sessiz filtre çakışması.** LiveChat'te Assignment=Unassigned seçilince Agent filtresi uyarısız siliniyor. Birbirini dışlayan filtreler UI'da açıkça gösterilmeli.
11. **Sayı ve metin tutarlılığı.** LiveChat'te "+11" rozeti 14 öğe gösteriyor, tur adım sayaçları tutarsız (2/6 ve 1/5), tur "chatbot kuruldu" diyor ama checklist "chatbot yok" diyor. Sayılar aynı kaynaktan türetilmeli (nexa Home zaten sunucudan türetiyor).
12. **Yinelenen seed içerik.** LiveChat'te "anytime" ve "sure" canned grupları birebir aynı. nexa demo seed'i (`onboarding-service.ts`) benzersiz içerikle tutulmalı.
13. **Bayat "News" akışı.** LiveChat'in son haberi 18 ay önceden. What's new eklenecekse besleme bakımı süreçle güvenceye alınmalı, yoksa hiç eklenmemeli.
14. **Destek balonu panel düğmelerinin üstüne binmesin.** LiveChat'in kendi widget'ı sağ paneldeki "Add public source" düğmesini kapatıyor. C28 yapılırsa panelin sağ alt güvenli alanı hesaba katılmalı.
15. **Mesaj kutusunda Send'in "#" ile aktifleşmesi.** nexa bunu zaten önlüyor (`Composer.tsx:142,474-478`); canned değişkenleri eklenirken de korunmalı.


---

# 02 — Boşluk Analizi: Engage & Automate (LiveChat ↔ SiyahTuş/nexa)

> Kaynaklar: `report.md` §02 (satır 478–982, LiveChat), `nexa-ozellikler.md` (ön yüz §1.6–1.10, arka uç §3.x), ve nexa kodunun salt-okunur doğrulaması.
> Kök dizin: `C:\Users\Hobbie\Desktop\nexa-main\` (aşağıdaki yollar buna göredir). Kod değiştirilmedi, build/test çalıştırılmadı.
> Durum: **Var** (eşdeğer çalışıyor) · **Kısmi** (bir kısmı var, ya da yalnız arka uçta var) · **Yok** · **Mock** (arayüz/akış var, alttaki iş sahte/deterministik).
> Öncelik: **P0** (LiveChat rakibi için çekirdek / pilotu engeller) · **P1** (önemli eşdeğerlik) · **P2** (olsa iyi olur). Efor: **S** (≤2 gün) · **M** (≤1–2 hafta) · **L** (daha büyük).

## Doğrulamada öne çıkan teknik bulgular (tablonun dayanağı)

- **Kampanya koşul modeli tek alanlı:** `packages/types/src/domain.ts:451` → `CampaignConditions { url_contains?: string }`; `CampaignContent { message?: string }`. Prisma yorumu (`apps/api/prisma/schema.prisma:1341`) "url, time on page, exit intent, geo…" diyor ama yalnız `url_contains` uygulanmış; `campaign-matching.ts:83` "Future condition kinds (geo, time-on-page, …) push their own check here".
- **"Current page URL" aslında "oturumdaki herhangi bir sayfa":** `campaign-matching.ts:80` `pageUrls.some(...)` — ziyaretçinin ziyaret ettiği tüm sayfalarda arıyor; LiveChat'in "Current page URL" ve "Any page from session" koşullarının ikisinin de yarım karşılığı.
- **Kampanya kartı yalnız düz metin:** widget `state.campaign = { id, message }` (`apps/widget/src/widget.ts:213`, `:1221`); buton/görsel/rich kart yok. `rich_message` olayı widget'ta hiç render edilmiyor (yalnız `apps/web/src/features/inbox/types.ts` içinde tip olarak geçiyor).
- **Kampanya silme/kopyalama API'si yok:** `apps/api/src/routes/campaigns.ts` yalnız GET/POST/PATCH.
- **Web crawler mock + tek sayfa:** `apps/api/src/services/ai/web-crawler.ts:32` `mockFetcher` (URL'den deterministik sahte HTML); iç sayfa takibi/sitemap yok. Dosya kaynağı yalnız metin türleri; **PDF bilinçli olarak yok** (`knowledge-file-parse.ts:42`), sınır 4 MiB.
- **LLM/embedding varsayılanı mock:** `apps/api/src/config/env.ts:685` `LLM_PROVIDER ... default('mock')`, `:746` `EMBEDDING_PROVIDER ... default('mock')`; OpenAI sağlayıcıları mevcut (`services/ai/provider/openai-*.ts`). Skill derleyici `packages/ai-mock/src/compiler.ts` kural tabanlı.
- **Routing arka ucu UI'dan zengin:** `services/routing/routing-service.ts:423-440` `url_contains[]`, `url_equals[]`, `country_codes[]`, `expertise_ids[]` destekliyor; `apps/web/src/features/settings/RoutingRules.tsx:142` yalnız tek bir `url_contains` gönderiyor.
- **Kayıtlı yanıtlarda kişisel (private) görünürlük, değişken, etiket otomasyonu, olay-bazlı öneri yok:** `schema.prisma:1311` `CannedResponse { shortcut, text, groupId, visibility }`; `CannedResponses.tsx:39` `visibility: 'all' | 'group'`. Şablon değişkenleri (`packages/types/src/template-variables.ts`) yalnız ticket e-posta şablonları için.
- **Workflow:** `schema.prisma:1723` `model Workflow { nodes, edges, status }` — hiçbir kodda kullanılmıyor (ADR-14: tek paradigma Skill; görsel builder **bilinçli olarak yok**). Otomasyon karşılıkları dağınık: ticket kuralları, rule bot, chat timeout, skill'ler, giden webhook (5 olay: `packages/types/src/integrations.ts` → `chat_started`, `chat_deactivated`, `chat_transferred`, `event_created`, `ticket_created`), Zapier/Make manifesti (3 eylem: send_message, create_ticket, add_tag).

---

## 1. Özellik Tablosu

### 1.A Engage → Traffic

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| E-01 | Canlı ziyaretçi listesi (ad, e-posta, aktivite, ülke) | Var (widget kurulunca) | **Var** | `apps/web/src/features/traffic/TrafficPage.tsx`, `apps/api/src/routes/traffic.ts`, `services/traffic/traffic-service.ts` | — | — | — |
| E-02 | Ziyaretçi durum filtreleri (Chatting/Browsing…) | Var (gözlemlenemedi) | **Var** | `TrafficPage.tsx` (7 sekme + Activity/URL/Came from/Country/Lead/Team filtreleri) | — | — | — |
| E-03 | Proaktif "Start chat" | Var | **Var** | `TrafficPage.tsx`, `VisitorPanel.tsx` | — | — | — |
| E-04 | "Supervise chat" | Var | **Var** | `services/traffic/supervision-service.ts` | Ayrı "whisper" modu yok (iç not kullanılıyor) | — | — |
| E-05 | Boş durum: "Install chat widget" + "Invite developer" | Var | **Var** | `TrafficPage.tsx:105` (boş durum CTA → kanal bağlama), `settings/WebsiteWidgets.tsx:345` (geliştiriciyi e-postayla davet) | Traffic boş durumunda doğrudan "geliştiriciyi davet et" butonu yok; ayarlarda var | — | — |
| E-06 | İkincil menüde canlı sayaçlar ("0 customers", "5 active", "0 active") | Var | **Yok** | `apps/web/src/features/customers/CustomersTabs.tsx` (sayaç/rozet yok) | Customers alt sekmelerinde canlı ziyaretçi / aktif kampanya / aktif hedef sayısı gösterilmiyor | P2 | S — `CustomersTabs.tsx`'e `/traffic`, `/campaigns?status=ongoing`, `/goals?status=active` toplamlarından rozet |

### 1.B Engage → Campaigns (liste)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| E-07 | Kampanya listesi + satırda Status aç/kapa | Var | **Var** | `features/campaigns/CampaignsPage.tsx`, `routes/campaigns.ts` (PATCH `active`) | — | — | — |
| E-08 | Displayed / Chats / Conversion kolonları | Var | **Var** | `services/campaigns/campaign-matching.ts:201` `campaignPerformance` | — | — | — |
| E-09 | Recurring / One-time ayrımı | Var (iki sekme) | **Kısmi** | `domain.ts:480` `recurring: boolean` var ama `CampaignBuilder.tsx` hiç göndermiyor; sekmeler All/Ongoing/Scheduled/Inactive | "Tek seferlik" kampanya kavramı UI'da yok; alan ölü | P2 | S — `CampaignBuilder.tsx`'e recurring anahtarı; `campaign-trigger.ts`'te one-time için tek gösterim kuralı |
| E-10 | "Multiple campaigns" anahtarı (aynı ziyarette birden çok kampanya) | Var | **Yok** | `widget.ts:920-942` tek kart yuvası, kampanya greeting'e üstün | Çalışma alanı düzeyinde "birden fazla kampanya göster" tercihi yok | P2 | S — `campaign-delivery.ts`'te ayar bayrağı + widget kuyruk |
| E-11 | Satır hover'ında koşul özeti tooltip'i | Var | **Kısmi** | `CampaignsPage.tsx` (tetik metni listede) | Koşul zenginleşince özet bileşeni gerekecek | P2 | S |
| E-12 | Kampanya başına "Reports" linki / Campaigns conversion raporu | Var (`/reports/campaigns?greeting[]=`) | **Yok** | `apps/api/src/routes/reports.ts` (kampanya raporu yok; yalnız goals/sales) | Kampanyaya göre tarih aralıklı dönüşüm raporu ve filtresi yok | P1 | M — `campaign_sends` üzerinden `/reports/campaigns` + `ReportsPage.tsx` Business sekmesi |
| E-13 | "Last 7 days stats" mini grafik | Var | **Yok** | `CampaignsPage.tsx` | Satır içi 7 günlük trend yok | P2 | S — `campaign_sends.delivered_at` günlük gruplama |
| E-14 | Kebab: Duplicate | Var | **Yok** | `routes/campaigns.ts` (yalnız GET/POST/PATCH) | Kopyalama yok | P2 | S — istemci tarafında GET→POST ile kopya |
| E-15 | Kebab: Delete | Var | **Yok** | `routes/campaigns.ts` (DELETE yok) | Kampanya silinemiyor, yalnız pasife alınabiliyor | P1 | S — `DELETE /campaigns/{id}` (+ `campaign_sends` cascade, contract `paths/campaigns.yaml`) |

### 1.C Engage → Campaigns (şablonlar ve Adım 1: görünüm)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| E-16 | Şablon galerisi, 3 hedef kategorisi (Greet and inform / Promote and convert / Generate leads) | Var | **Yok** | `features/campaigns/` (yalnız `CampaignBuilder.tsx` modalı) | Hedefe göre şablon seçimi yok; her kampanya boş formdan başlıyor | P1 | M — `features/campaigns/templates.ts` (Playbook `templates.ts` deseni) |
| E-17 | Şablon: Offer instant help (4 hızlı buton) | Var | **Yok** | — | Buton altyapısına bağlı (E-25) | P1 | S (E-25 sonrası) |
| E-18 | Şablon: Welcome visitors ("Chat with us") | Var | **Kısmi** | `widget.ts` greeting kartı ("Let's chat"), `settings/WidgetCustomization.tsx` karşılama mesajı | Kampanya şablonu olarak değil, genel greeting olarak var | P2 | S |
| E-19 | Şablon: Share important updates (metin tipi, `%name%`) | Var | **Kısmi** | `CampaignBuilder.tsx` (düz metin) | Metin kampanyası var; `%name%` kişiselleştirme yok (E-33) | P2 | S |
| E-20 | Şablonlar: Personalize experience / Announce new products / Share valuable resources | Var | **Yok** | — | Görsel + buton gerektiriyor | P2 | S (E-24/E-25 sonrası) |
| E-21 | Şablon: Hook leaving visitors (exit intent + kupon kopyala) — "Trending" | Var | **Yok** | `apps/widget/src` (exit-intent/mouseleave yok), `apps/api/src` (exit_intent yok) | Exit intent + Copy coupon ikisi de yok | P1 | M — E-36 + E-29 |
| E-22 | Şablonlar: Increase social engagement / Grow your audiences / Invite and capture interest (lead) | Var | **Yok** | — | Open URL/Sign up butonları ve lead yakalama kartı yok | P2 | S (E-25 sonrası) |
| E-23 | Kart tipi seçimi: rich kart vs metin (T) | Var | **Yok** | `domain.ts:457` `CampaignContent { message }` | Yalnız metin | P1 | M — `CampaignContent`'e `type: 'text'|'card'`, `title`, `image`, `buttons[]`; widget render |
| E-24 | Görsel: yükle (2300×1500, png/jpg/gif) / hazır kütüphane / alt metin | Var | **Yok** | `widget.ts` kampanya kartı | Görsel ve alt metin yok | P2 | M — mevcut dosya yükleme altyapısı (`file-sharing`) + `CampaignContent.image{url,alt}` |
| E-25 | Başlık (80) + gövde (220) + en fazla 5 buton | Var | **Kısmi** | `CampaignBuilder.tsx` (tek mesaj alanı, 2000 kr.) | Başlık/gövde ayrımı ve buton dizisi yok | P1 | M |
| E-26 | Buton stili (Default/Primary/Danger) | Var | **Yok** | — | | P2 | S |
| E-27 | Buton eylemi: Send message (buton metnini mesaj olarak gönder) | Var | **Yok** | `widget.ts` | Tıklayınca sohbet başlatan hızlı yanıt butonu yok | P1 | S (E-25 ile) |
| E-28 | Buton eylemi: Open URL (yeni sekme) | Var | **Yok** | — | | P1 | S (E-25 ile; `rel=noopener`, URL doğrulama) |
| E-29 | Buton eylemi: Copy coupon | Var | **Yok** | — | | P1 | S (E-25 ile; widget iframe'de Clipboard API) |
| E-30 | Buton eylemi: Phone call (`tel:`) | Var | **Yok** | — | | P2 | S |
| E-31 | Buton eylemi: Open Moment (widget içinde web görünümü) | Var | **Yok** | — | "Moments" kavramı yok | P2 | M |
| E-32 | Buton eylemi: Dismiss | Var | **Kısmi** | `widget.ts:982-984` (kart kapatma, oturum boyunca hatırlanır) | Ayrı Dismiss butonu değil, kapatma ikonu | P2 | S |
| E-33 | Kişiselleştirme değişkeni `%name%` | Var | **Yok** | `domain.ts:457`, `campaign-delivery.ts` | Mesaj sabit metin | P2 | S — teslimde müşteri adıyla şablon doldurma (`template-variables.ts` deseni) |
| E-34 | Kart altında "Write a message…" alanı (kapalı widget'tan yazma) | Var | **Kısmi** | `widget.ts` greeting/kampanya kartı (tıklayınca panel açılır) | Kartın kendi giriş alanı yok | P2 | S |
| E-35 | Önizleme: Desktop / Mobile | Var | **Yok** | `features/campaigns/` ("preview" yok) | Oluştururken widget önizlemesi yok (widget ayarlarında var) | P2 | M — `WidgetCustomization.tsx` önizleme bileşenini yeniden kullan |

### 1.D Engage → Campaigns (Adım 2: koşullar)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| E-36 | Koşul: Customer's activity → **about to leave page** (exit intent) | Var | **Yok** | `apps/widget/src` (exit-intent/`mouseleave` yok) | Loader'da çıkış niyeti algısı yok | P1 | M — `loader.ts`'te `mouseout` üst kenar / mobilde geri-kaydırma → widget'a postMessage → istemci tarafı tetik |
| E-37 | Koşul: Customer's activity → actively browsing | Var | **Yok** | — | | P2 | S |
| E-38 | Koşul: Current page URL (contains / does not contain / is exactly / is not) | Var | **Kısmi** | `campaign-matching.ts:75-86` yalnız `url_contains`, ve oturumdaki **tüm** sayfalarda arıyor | 3 operatör yok; "şu anki sayfa" semantiği yanlış (geçmiş sayfa da eşleşiyor) | P1 | S — `CampaignConditions`'a `{field, op, value}[]`; son sayfa için `pageUrls.at(-1)` |
| E-39 | Koşul: Any page from session (4 operatör) | Var | **Kısmi** | `campaign-matching.ts:80` (fiilen bu, yalnız contains) | does not contain / is exactly / is not yok | P2 | S |
| E-40 | Koşul: Customer's location (ülke/şehir) | Var | **Yok** | `campaign-matching.ts` (geo yok); ülke verisi Traffic/routing'de var | Coğrafi hedefleme yok | P1 | S — `fireCampaignsAtVisitor`'a ziyaret ülkesi |
| E-41 | "Time on page is more than N sn" (0–900) | Var | **Yok** | `widget.ts:2016` yalnız sabit `GREETING_DELAY_MS` (greeting için) | Kampanya başına gecikme yok; kampanya poll ile hemen gösteriliyor | P1 | S — `CampaignContent.delay_seconds`; widget kartı geciktirsin |
| E-42 | Koşul: Customer's browsing time (oturum süresi) | Var | **Yok** | — | | P2 | S |
| E-43 | Koşul: Number of viewed pages ≥ N | Var | **Yok** | `Visit.pages` JSON mevcut | Veri var, koşul yok | P2 | S |
| E-44 | Koşul: Referring website address | Var | **Yok** | Referrer toplanıyor (`apps/widget/src/loader.ts:329-334`), koşulda kullanılmıyor | Kaynak siteye göre hedefleme yok | P1 | S |
| E-45 | Koşul: Pages visited in exact order (+ next page) | Var | **Yok** | — | Sıralı yol eşleme | P2 | M |
| E-46 | Koşul: Custom variable (8 operatör: is exactly / is not / > / ≥ / contains / does not contain / < / ≤) | Var | **Yok** | `apps`, `packages` içinde `session_variables`/`custom_variable` yok | Sitenin JS'ten oturum değişkeni geçirme API'si yok | P1 | M — `window.siyahtus('setSessionVariables', {...})` (loader) → visit'e kaydet → koşul |
| E-47 | Hedef kitle: All / First time / Returning visitors | Var | **Yok** | `widget.ts:2024` `returningVisitor()` var, kampanyada kullanılmıyor | Segment hedefleme yok | P1 | S — müşteri ziyaret sayısından koşul |
| E-48 | Eşleşme: Match all / Match one (AND/OR) | Var | **Kısmi** | `campaign-matching.ts:85` `checks.every` (yalnız AND) | OR yok (tek koşul olduğundan şimdilik görünmez) | P1 | S (E-38 koşul dizisiyle birlikte) |
| E-49 | Kaydedilmemiş değişiklik uyarısı | Var (yanlış pozitifli) | **Var** | `CampaignBuilder.tsx:16` `useCloseGuard` | — | — | — |
| E-50 | Kampanya yeniden adlandırma (düzenlemede) | Var | **Var** | `routes/campaigns.ts` PATCH `name` (≤120) | — | — | — |

### 1.E Engage → Goals & Sales tracking

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| E-51 | Hedef listesi + huni (Visitors → Chats → Goals, son 7 gün) | Var | **Var** | `features/goals/GoalsPage.tsx`, `GoalsFunnel.tsx`, `/reports/goals` | — | — | — |
| E-52 | "Order placed" hazır hedef / "Start from scratch" | Var | **Var** | `GoalBuilder.tsx`, `domain.ts:518` (Page reached, Sale completed, Lead captured, Chat resolved) | — | — | — |
| E-53 | Page visited: The URL **is exactly** / contains | Var | **Kısmi** | `goal-matching.ts:20-25,105-108` yalnız `url_contains` | "is exactly" yok | P2 | S — `GoalDefinition.url_equals` |
| E-54 | Birden çok URL path (chip girişi) | Var | **Yok** | `GoalDefinition.url_contains?: string` (tekil) | | P2 | S |
| E-55 | Öneri chip'leri (`/thank-you`, `/success`, `/order-confirmation`…) | Var | **Yok** | `GoalBuilder.tsx` | | P2 | S |
| E-56 | Advanced: Custom Page Event (değişken adı + değeri) | Var | **Yok** | (E-46 ile aynı: oturum değişkeni API'si yok) | Sitenin JS olayıyla hedef tamamlama yok | P1 | M — E-46 altyapısı + `GoalDefinition.custom_variable` |
| E-57 | Advanced: API Request (Goals API, sunucudan sunucuya) | Var | **Kısmi** | `POST /customer/chat/sale` + `sale_completed` bayrağı (`domain.ts:521`) | Yalnız satış için; genel "hedefi API ile işaretle" uç noktası yok | P2 | M — `POST /goals/{id}/achievements` (PAT/OAuth ile) |
| E-58 | Hedef aç/kapa, düzenle | Var (gözlemlenemedi) | **Var** | `paths/goals.yaml` PATCH | Silme bilinçli yok (geçmiş korunur) | — | — |
| E-59 | Hedef başına dönüşüm raporu | Var (Reports) | **Var** | `routes/reports.ts:54` `goalConversionsByGoal` | — | — | — |
| E-60 | Sales tracker (sipariş → sohbet atfı, para birimi, atıf penceresi) | Var (LiveChat'te Settings altında; bu turda gözlemlenmedi) | **Var** | `settings/SalesTracker.tsx`, `services/sales/attribution.ts`, widget `trackSale` | — | — | — |

### 1.F Automate → Overview & Copilot

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A-01 | Automate Overview (özellik kartları + "Manage" yönlendirmeleri) | Var | **Kısmi** | `features/home/HomePage.tsx` (aktivasyon listesi), Playbook | Otomasyon özelliklerini tek yerde gösteren keşif sayfası yok | P2 | S |
| A-02 | Copilot paneli (soru-cevap, kopyala) | Var | **Var** | `features/inbox/CopilotPanel.tsx`, mobil `CopilotScreen.tsx` | — | — | — |
| A-03 | Copilot ürün kullanım sorularını yanıtlama ("How do I…") | Var | **Yok** | `CopilotPanel.tsx` (Summary / Suggested reply / Improve / Ask about reports) | Ürün yardım bilgisi Copilot'a yüklenmemiş | P2 | M — yardım dokümanlarını sistem Copilot kaynağı olarak indeksle |
| A-04 | Chat summary | Var | **Var** | `CopilotPanel.tsx` Summary → iç not | — | — | — |
| A-05 | Mesaj iyileştirme: ton (profesyonel/samimi/gündelik), genişlet, özetle, yeniden yaz, dilbilgisi, sıfırdan üret | Var | **Kısmi** | `CopilotPanel.tsx` (Rephrase / Friendlier / More formal / Fix grammar), `packages/ai-mock/src/assist.ts` | Expand / shorten / generate yok | P2 | S |
| A-06 | Reply suggestions (bilgi tabanından hazır yanıt) | Var | **Var** | `features/inbox/replySuggestions.ts`, `Composer.tsx:325-408` | — | — | — |
| A-07 | Auto-tag (canned kullanılınca etiket ata) | Var | **Yok** | `schema.prisma:1311` `CannedResponse` (etiket alanı yok) | | P2 | S — `canned_responses.tag_ids` + composer'da gönderimde etiketle |
| A-08 | AI tag suggestions (100+ etiketli sohbetten öneri) | Var | **Yok** | `apps` içinde tag-suggest yok | | P2 | M — `packages/ai-mock/src/topics.ts` / embedding benzerliği |
| A-09 | Çalışma saatleri | Var | **Var** | `features/team/WorkSchedule.tsx` | — | — | — |

### 1.G Automate → Chatbots / AI Agent

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A-10 | Chatbot listesi (Name / Status) + Add chatbot | Var (ChatBot.com iframe) | **Var** | `features/team/TeamAiAgentsPage.tsx`, `RuleBots.tsx`, `features/playbook/PlaybookPage.tsx` | — | — | — |
| A-11 | Bot adı + karşılama mesajı | Var | **Kısmi** | `playbook/ProfileForm.tsx` (ad, avatar, ton, dil, uzunluk); karşılama mesajı widget ayarında (`WidgetCustomization.tsx`) | AI ajana özel açılış mesajı yok | P2 | S — `ai_agents.persona.welcome` |
| A-12 | "Accepting chats" anahtarı | Var | **Var** | Playbook "Answering / Paused", "Pause all skills" | — | — | — |
| A-13 | Skill: Small talk (gündelik konuşma) | Var | **Kısmi** | `packages/ai-mock/src/intent.ts` (selamlama niyeti yok); gerçek LLM açıkken doğal | Mock modda selamlaşma yanıtı yok | P2 | S |
| A-14 | Skill: Transfer to agent | Var | **Var** | Skill adımı `transfer_to_team`, devir nedeni `ai_handoff` (`schema.prisma:1664`) | — | — | — |
| A-15 | Bot için web sitesi bilgi kaynağı | Var | **Mock** | `services/ai/web-crawler.ts:32` `mockFetcher` | Gerçek HTTP getirme yok → AI ajan gerçek siteden öğrenemez | **P0** | M — `resolvePublicHttpTarget` + `pinnedConnection` (`lib/ssrf.ts`) ile gerçek fetcher |
| A-16 | Custom answers (soru → sabit cevap) | Var (🔒 Premium) | **Var** | Knowledge FAQ türü; rule bot `message_contains → send_message` (`packages/types/src/rule-bot.ts:90-117`) | — (nexa'da ücretsiz) | — | — |
| A-17 | Canlı önizleme / test sohbeti | Var | **Var** | `POST /skills/preview`, `ProfileForm.tsx` canlı önizleme | — | — | — |
| A-18 | Gerçek üretken AI yanıtı (LLM + embedding) | Var | **Kısmi** | `config/env.ts:685,746` varsayılan `mock`; `provider/openai-llm-provider.ts`, `openai-embedding-provider.ts` mevcut; skill derleyici `packages/ai-mock/src/compiler.ts` kural tabanlı | Pilotta gerçek sağlayıcı açılmazsa AI ajan "deterministik stub"; "Compile to steps" LLM'siz | **P0** | M — pilot env'de `LLM_PROVIDER/EMBEDDING_PROVIDER=openai` + derleyiciyi LLM'e bağla, `knowledge-reembed-run.ts` ile yeniden embed |
| A-19 | Bot yanıtlarında buton / hızlı yanıt / kart (rich message) | Var (ChatBot) | **Yok** | `rich_message` widget'ta render edilmiyor (`apps/widget/src` içinde yok) | AI/rule bot yalnız düz metin gönderebiliyor | P1 | M — E-25 ile ortak `buttons[]` olay tipi + widget render |
| A-20 | Gelişmiş akış yapılandırıcı ("advanced configurator") | Var | **Yok** (bilinçli) | ADR-14; skill adım editörü (`SkillEditor.tsx`) | Görsel akış yerine adım listesi | P2 | — (karar gereği) |

### 1.H Automate → Knowledge hub

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A-21 | Kaynak: Website — **All pages** (iç içe tüm sayfalar) | Var (200 sayfa sınırı) | **Yok** | `web-crawler.ts` tek URL; link takibi/sitemap yok; toplu içe aktarma satır başına tek URL (`knowledge-bulk-crawl.ts`) | Site tarama yok; yardım merkezi tek tek URL ile eklenmek zorunda | **P0** | L — aynı-origin link/sitemap takibi, sayfa bütçesi, kuyruk işi (`scheduler/jobs.ts`) |
| A-22 | Kaynak: Website — Single page | Var | **Mock** | `web-crawler.ts:32` | Tek sayfa akışı var, getirme sahte (A-15 ile aynı kök) | P0 | (A-15) |
| A-23 | URL doğrulama ("It doesn't seem like a real website") | Var | **Var** | `assertPublicHttpUrl` (SSRF guard, route'ta) | — | — | — |
| A-24 | "For internal use only" (yalnız Copilot, müşteri sohbetinde değil) | Var | **Var** | Ayrı havuzlar: `/copilot/knowledge` vs `/knowledge-sources` (`team/CopilotKnowledge.tsx`) | Tek kaynakta bayrak değil, iki ayrı liste | — | — |
| A-25 | Auto-update her N günde (5–365) | Var | **Var** | `knowledge-refresh.ts:41`, `knowledge-refresh-sweep.ts` (saatlik iş) | (getirme mock olduğu için fiilen aynı içerik) | — | — |
| A-26 | Source name (boşsa otomatik) | Var | **Var** | `web-crawler.ts:55` başlıktan ad | — | — | — |
| A-27 | Kaynak: **PDF** (46 MB, sürükle-bırak) | Var | **Yok** | `knowledge-file-parse.ts:42` "Deliberately NOT here: PDF, DOCX…"; dosya sınırı 4 MiB | Broşür/kılavuz PDF'leri eklenemiyor | **P0** | M — PDF metin çıkarımı (ör. pdf.js/pdf-parse) + boyut sınırını büyüt + virüs tarama kancası |
| A-28 | Websites / PDF alt listeleri + sayaçlar + boş durumlar | Var | **Var** | `playbook/knowledge-tabs.ts`, `KnowledgeSourceActions.tsx` | PDF sekmesi yok (A-27'ye bağlı) | — | — |

### 1.I Automate → Canned responses & Suggested responses

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A-29 | Kayıtlı yanıt CRUD + `#kısayol` ile sohbette kullanım | Var | **Var** | `settings/CannedResponses.tsx`, `inbox/useCannedResponses.ts`, `/settings/canned-responses` | — | — | — |
| A-30 | Shared / **Private** (kişisel) yanıtlar + filtre | Var | **Kısmi** | `CannedResponses.tsx:39` `visibility` yalnız `'all'` veya `'group'` | Takım kapsamı var, kişiye özel yok | P1 | S — `visibility: 'private'` + `owner_account_id`; okuma filtresi |
| A-31 | Group selection | Var | **Var** | `CannedResponses.tsx:53` `group_id` | — | — | — |
| A-32 | Yanıt başına **birden çok kısayol** | Var | **Kısmi** | `schema.prisma:1315` `shortcut String` (tekil, unique) | Tek kısayol | P2 | S — `shortcuts String[]` |
| A-33 | Değişkenler `%customer-name%`, `%customer-email%`, `%agent-name%`, `%agent-email%` | Var | **Yok** | `inbox/useCannedResponses.ts` (değişken ikamesi yok); `template-variables.ts` yalnız ticket e-postası | | P1 | S — `template-variables.ts` kataloğunu canned için yeniden kullan, composer eklerken doldur |
| A-34 | Ayarlar listesinde arama | Var | **Yok** | `CannedResponses.tsx` (arama/filtre yok) | Composer seçicide kısayolla arama var | P2 | S |
| A-35 | Create copy | Var | **Yok** | `CannedResponses.tsx` | | P2 | S |
| A-36 | Hazır örnek yanıtlar (23 adet, yeni hesapta) | Var | **Var** | `services/onboarding/onboarding-service.ts` (örnek veri: canned, tags) | Onboarding'de "örnek veri ekle" seçilirse | — | — |
| A-37 | Olay-bazlı öneriler: chat started / transferred / went idle / rated good / rated bad / AI canned proposed (Shared + Private) | Var | **Yok** | `Composer.tsx` öneriler yalnız Space tuşu + niyet şablonu (`replySuggestions.ts`) | Olaya bağlı canned öneri eşlemesi yok | P1 | M — `canned_responses.suggest_on_events[]` + `/automate/suggested-responses` ekranı + composer'da olaya göre çip |
| A-38 | Ajanın kendisi için öneriyi kapatma | Var | **Yok** | — | | P2 | S |

### 1.J Automate → Routing rules

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A-39 | Öncelik sıralı kurallar + fallback grubu | Var | **Var** | `settings/RoutingRules.tsx`, `services/routing/routing-service.ts:280-312` | — | — | — |
| A-40 | Koşul: Customer visits URL — Contains | Var | **Var** | `routing-service.ts:426` | — | — | — |
| A-41 | Koşul: Customer visits URL — **Is exactly** | Var | **Kısmi** | Arka uç `url_equals` (`routing-service.ts:430`); UI göndermiyor (`RoutingRules.tsx:142`) | Yalnız API ile | P1 | S — UI'a operatör seçimi |
| A-42 | "+ Add another URL" (koşulda çoklu URL) | Var | **Kısmi** | Arka uç dizi; UI tek değer | | P2 | S |
| A-43 | Koşul: Customer visits domain | Var | **Kısmi** | `url_contains` alt dize ile dolaylı | Ayrı domain koşulu yok | P2 | S |
| A-44 | Koşul: Customer's location | Var (🔒 üst plan) | **Kısmi** | Arka uç `country_codes` (`routing-service.ts:433`); UI'da yok | | P1 | S — `RoutingRules.tsx`'e ülke seçici |
| A-45 | Eylem: Route to group | Var | **Var** | `target_group_id` | — | — | — |
| A-46 | Eylem: **Turn chat off** (widget'ı bu sayfalarda gizle) | Var | **Yok** | `routing-service.ts` (yalnız grup hedefi); `TrustedDomains.tsx` alan adı düzeyinde | Sayfa/ülke bazında widget'ı kapatma yok | P2 | M — `routing_rules.action='hide_widget'`, loader yapılandırmasında değerlendirme |

### 1.K Automate → Workflows (Beta)

> Not: nexa'da görsel workflow editörü **bilinçli karar** (ADR-14) olarak yok; `workflows` tablosu (`schema.prisma:1723`) ölü. Aşağıdaki satırlar LiveChat yeteneklerini nexa'nın dağınık karşılıklarıyla eşler.

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A-47 | Görsel no-code workflow editörü (tetik → eylem tuvali, Draft/Publish, yeniden adlandır, Discard) | Var | **Yok — bilinçli karar** | ADR-14; `model Workflow` kullanılmıyor | — | P2 | L (karar değişirse) |
| A-48 | Workflow şablon galerisi (39 şablon, Product/Category filtreleri) | Var | **Kısmi** | Playbook şablon galerisi ~33 skill şablonu (`playbook/templates.ts`, Prebuilt/AI/Trending) | Skill şablonları var; entegrasyonlu olanlar (Shopify/Stripe/Salesforce/Klaviyo…) mock entegrasyona dayanıyor | P2 | — |
| A-49 | Import / Export workflow (.json) | Var | **Yok** | — | Skill'ler için dışa/içe aktarma yok | P2 | S — skill JSON export/import |
| A-50 | Tetik: Time schedule | Var | **Kısmi** | `settings/ScheduledExports.tsx` (yalnız rapor e-postası) | Genel zamanlanmış otomasyon yok | P2 | M |
| A-51 | Tetik: Manual trigger / "For selected chat" / "For selected ticket" | Var | **Yok** | Komut paleti tek eylem (`components/actions.ts`) | Ajanın seçili sohbette makro çalıştırması yok | P2 | M — "macro" = skill'i elle çalıştır |
| A-52 | Tetik: Webhook trigger (gelen) | Var | **Yok** | Yalnız giden webhook (`developers/WebhookSubscriptions.tsx`) | | P2 | M |
| A-53 | Tetik: Chat started / Chat ended / Chat transferred | Var | **Var** | Giden webhook `chat_started`, `chat_deactivated`, `chat_transferred` (`packages/types/src/integrations.ts`); skill/rule bot sohbet başında | — | — | — |
| A-54 | Tetik: Specific keywords in chat | Var | **Var** | Rule bot `message_contains/word/equals` (`rule-bot.ts:90-96`) | — | — | — |
| A-55 | Tetik: Chat rated | Var | **Yok** | Webhook kataloğunda yok | Kötü puan → ticket/takip otomasyonu kurulamıyor | P1 | S — `chat_rated` webhook + rule/ticket kuralı tetiği |
| A-56 | Tetik: Chat tagged / commented | Var | **Kısmi** | RTM `thread_tagged` push var (`packages/types/src/rtm.ts:154`), otomasyon tetiği değil | | P2 | S |
| A-57 | Tetik: Customer left chat / Chat inactivity | Var | **Kısmi** | `settings/ChatTimeout.tsx` (yalnız otomatik kapatma) | İnaktivitede mesaj/etiket gibi başka eylem yok | P2 | S |
| A-58 | Tetik: Customer email set / custom fields updated | Var | **Yok** | Webhook kataloğu | | P2 | S |
| A-59 | Tetik: Ticket created | Var | **Var** | `settings/TicketRules.tsx`, webhook `ticket_created` | — | — | — |
| A-60 | Tetikler: Ticket updated / status / priority / tags / followers / assignment / custom fields / message added / requester message / agent message / private note | Var | **Yok** | Ticket kuralları yalnız "açılınca" (`TicketRules.tsx`; `domain.ts:559-574`) | Ticket yaşam döngüsü otomasyonu yok | P1 | M — ticket kurallarına `on: created|updated|status_changed|message_added` |
| A-61 | Uygulama tetikleri (HubSpot / Mailchimp / Slack) | Var | **Mock** | `packages/types/src/apps.ts` (103 kart, mock OAuth; yalnız brevo/freshdesk canlı) | | P2 | L |
| A-62 | Eylem: Webhook (giden) | Var | **Var** | `developers/WebhookSubscriptions.tsx` | — | — | — |
| A-63 | Eylemler: Conditional paths / Wait / End workflow | Var | **Yok — bilinçli karar** | Skill adımları doğrusal (`schema.prisma:1664`) | Dallanma/bekleme yok | P2 | M |
| A-64 | Eylem: AI Agent reasoning / Summarize / Categorize / Sentiment / Extract order (OpenAI) | Var | **Kısmi** | Skill adımları `detect_intent`, `summarize` (`skill-engine.ts`); Chat topics kümeleme | Duygu analizi, sipariş çıkarımı, moderasyon yok | P2 | M |
| A-65 | Eylem: Detect language | Var | **Kısmi** | `ai_agents.languages`, widget dil algısı | Otomasyon adımı olarak yok | P2 | S |
| A-66 | Eylem: Match agent / Notify agent / Collect data from agent | Var | **Kısmi** | Routing (`routing-service.ts`), atanan bildirimi (`followUps`) | "Ajandan veri topla" yok | P2 | M |
| A-67 | Chat eylemleri: Transfer / Tag / Send message / Close / Send transcript | Var | **Var** | Skill `transfer_to_team`, `tag`, `send_message`; chat-timeout; transkript e-postası (`services/notifications/chat-transcript.ts`) | — | — | — |
| A-68 | Chat eylemleri: Supervise / Get chat details / Get chats report / Get agent status / List archived | Var | **Kısmi** | REST API'de mevcut (`routes/chats.ts`, `/reports/*`), otomasyon adımı değil | | P2 | — |
| A-69 | Customer eylemleri: Get / List / Update / **Ban** / Set custom fields | Var | **Kısmi** | Manuel UI + REST (`CustomerDetailPanel.tsx` Ban, özel alanlar) | Otomasyon adımı değil | P2 | S |
| A-70 | Ticket eylemleri (15: followers, tags, create, find, status, priority, assignment, summarize, spam…) | Var | **Kısmi** | Ticket kuralları: öncelik / etiket / ata (`TicketRules.tsx`); Zapier eylemi `create_ticket` | Takipçi, durum, özet, spam otomasyon eylemi yok | P2 | M |
| A-71 | Uygulama eylemleri (HubSpot, Klaviyo, Mailchimp, OpenAI, Salesforce, Shopify, Slack) | Var | **Mock** | `packages/types/src/apps.ts`; skill şablonları `shopify-order-lookup`, `salesforce-case-sync`, `klaviyo-abandoned-cart`… (`playbook/templates.ts:502-692`) | Gerçek çağrı yok (brevo/freshdesk hariç) | P1 | L — öncelikli 2–3 entegrasyon (Shopify, HubSpot, Slack) canlı |
| A-72 | Zapier/Make üzerinden dış otomasyon | (LiveChat Marketplace) | **Kısmi** | Manifest: 5 tetik, 3 eylem (`packages/types/src/integrations.ts:132-154`) | Eylem kataloğu dar | P2 | S |

---

## 2. nexa'nın önde olduğu yerler

1. **Kampanya zamanlaması:** başlangıç/bitiş tarihi ve `ongoing/scheduled/inactive` yaşam döngüsü (`campaign-matching.ts:99-170`); LiveChat'te kampanya planlama görülmedi.
2. **Kampanya sayılarının dürüstlüğü:** Displayed yalnız gerçekten teslim edilen gönderimleri sayıyor (`delivered_at`), Conversion bunun alt kümesi; idempotent `(campaign, customer)` tekilliği (`campaign-trigger.ts`). Ziyaret anında + kayıt anında çift yönlü tetikleme.
3. **Boş kampanyayla başlama:** LiveChat her kampanyayı şablondan başlatıyor; nexa doğrudan form açıyor. Kaydedilmemiş değişiklik koruması yanlış pozitif vermiyor.
4. **Hedef türleri:** Sale completed, Lead captured, Chat resolved bayrakları ve bunların AND kombinasyonu (`goal-matching.ts`); LiveChat yalnız sayfa/özel olay/API.
5. **Sales tracker:** sipariş → sohbet atfı, para birimi, atıf penceresi, Reports → Sales sekmesi (`services/sales/attribution.ts`).
6. **Traffic:** 7 durum sekmesi, PII gizleme, "Assign chat to me", kapsamlı filtreler.
7. **AI ajan (Playbook):** doğal dil → adım derleme, önizleme ("Would answer / hand over / do nothing"), çalıştırma günlüğü (token maliyetiyle), Performance (çözüm oranı, CSAT, devir), Recommended skills, skill sahipliği/sıralama filtreleri. LiveChat'in "Custom answers" özelliği Premium'da kilitli; nexa'da FAQ kaynağı + rule bot ile ücretsiz.
8. **Deterministik rule bot** (LLM'siz, takım önceliği, mesai açık/kapalı koşulu) AI ajandan ayrı — LiveChat'te ChatBot.com iframe'i ayrı ürün.
9. **Bilgi kaynakları:** Article, FAQ, dosya (.txt/.md/.csv), CSV toplu içe aktarma (şablon, önizleme, sonuç tablosu), yeniden indeksleme, otomatik yenileme, SSRF korumalı URL'ler; ayrıca **SEO'lu Public KB** (makale, kategori, slug, yayımla).
10. **Copilot "Ask about your reports":** doğal dilde BI sorusu + komut paletinde "Ask AI"; LiveChat Copilot'u yalnız genel metrik veriyor.
11. **Routing:** uzmanlık (skill) tabanlı atama, takım içi üye öncelik katmanları (Primary/First/Normal/Last), en az yüklü + `last_assigned_at` dengeleme, ayrı **ticket routing** ve **SLA** politikaları; ülke koşulu (arka uçta) plan kilidi olmadan.
12. **Kayıtlı yanıt kapsamı:** sohbet ve ticket için ayrı kapsam (`CANNED_RESPONSE_SCOPES = ['chat','ticket']`).
13. **Dürüst UI tutarlılığı:** ortak `dirty-guard` ve form doğrulama katmanı (`lib/form.ts`, `lib/dirty-guard.tsx`) her builder'da aynı davranıyor.

## 3. LiveChat hatalarından dersler

- **Kaydedilmemiş değişiklik koruması tutarlı olmalı:** LiveChat'te Campaigns/Canned/Routing'de var (Campaigns'te hiçbir şey değişmemişken yanlış pozitif), Goals/Chatbots/Workflows'ta yok. nexa'nın ortak `useCloseGuard`'ı her yeni editöre (kampanya şablon akışı, olay-bazlı öneriler, routing operatörleri) de uygulanmalı; "değişti mi" kontrolü başlangıç değeriyle kıyaslamalı.
- **Doğrulama tek kaynaktan:** LiveChat bir yerde URL'yi doğruluyor ("It doesn't seem like a real website"), chatbot ve routing'de doğrulamıyor. Yeni buton eylemleri (Open URL, Phone, Copy coupon) için doğrulayıcılar `packages/types`'ta ortak olmalı.
- **Eylem tipi değişince eski değeri taşıma:** LiveChat Open URL → Phone call'a geçince URL'yi telefon alanına taşıyıp hata gösteriyor. Buton eylemi değiştiğinde alanları sıfırlayın.
- **Sessiz kırpma yapmayın:** 20 karakterlik buton metni uyarısız kesiliyor; sayaç gösterin.
- **Yan etkisiz keşif:** "Tell me more" butonları Copilot'a kullanıcı onayı olmadan mesaj gönderiyor; "Empty workflow" tıklanır tıklanmaz sunucuda taslak oluşturuyor. Kayıtlar yalnız açık kullanıcı eylemiyle yaratılmalı.
- **Durum sızıntısı:** Add PDF modalı başka sayfaya gidince yeniden açık geliyor; modal durumu rota bazlı sıfırlanmalı.
- **Deep link'ler çalışmalı:** LiveChat her tam yüklemede `/install-code`'a yönlendiriyor. nexa'nın `?chat=` / `?ticket=` derin bağlantı yaklaşımı korunmalı; widget kurulmamış uyarısı banner olmalı, kapı değil.
- **Kategori/sekme adları tutarlı olsun:** Workflow şablon kategorileri sayfada ve editörde farklı adlandırılmış; URL'lerde çift kodlama (`%2520`). Şablon kategorileri tek sabit listeden üretilmeli.
- **Erişilebilirlik:** şablon kartları tıklanabilir `div` (klavye erişimi yok), kebab menü "Toggle menu" (satır adı yok), iframe içerik erişilebilirlik ağacında görünmüyor. nexa'nın a11y test kapısı (axe, landmark, odak) yeni kampanya şablon galerisine de uygulanmalı.
- **Riskli varsayılanlar:** "Invite developer" varsayılan rolü "Admin (billing access)". Davet akışlarında en düşük yetki varsayılan olmalı.
- **Boş kaydetmeyi engelleyin:** LiveChat boş "Enter a string" koşuluyla ve boş Goal name ile kaydetmeye izin veriyor gibi; nexa'nın "boş tetik kimseyle eşleşmez + yazmada reddet" disiplini (`hasTrigger`, `hasGoalTrigger`) yeni koşul tiplerine de taşınmalı.

---

## 4. Özet sayımlar

**Toplam satır: 132** (Engage 60: E-01…E-60 · Automate 72: A-01…A-72)

| Durum | Adet |
|---|---|
| Var | 39 |
| Kısmi | 34 |
| Yok | 55 (3'ü "bilinçli karar": A-20, A-47, A-63) |
| Mock | 4 (A-15, A-22, A-61, A-71) |
| **Toplam** | **132** |

| Öncelik (Var olmayan 93 satır) | Adet |
|---|---|
| P0 | 5 (A-15, A-18, A-21, A-22, A-27) |
| P1 | 28 |
| P2 | 60 |

### En kritik 5 boşluk
1. **A-21/A-15/A-22 — Gerçek web sitesi taraması yok (P0, L):** crawler `mockFetcher`; tüm alt sayfaları tarama/sitemap yok. AI ajan ve Copilot müşterinin sitesinden öğrenemiyor.
2. **A-18 — Gerçek LLM/embedding varsayılan kapalı, skill derleyici kural tabanlı (P0, M):** pilotta `LLM_PROVIDER`/`EMBEDDING_PROVIDER` gerçek sağlayıcıya alınmalı ve derleyici LLM'e bağlanmalı.
3. **A-27 — PDF bilgi kaynağı yok (P0, M):** yalnız .txt/.md/.csv, 4 MiB.
4. **E-23/E-25/E-27–E-29/A-19 — Rich kampanya kartı ve butonlar yok (P1, M):** kampanya ve bot mesajları düz metin; Send message / Open URL / Copy coupon butonları, görsel, başlık yok → 10 LiveChat şablonunun hiçbiri kurulamıyor.
5. **E-36–E-48 — Kampanya hedefleme tek koşullu (P1, S–M):** yalnız "URL içerir" (ve aslında tüm oturum sayfalarında); exit intent, sayfada kalma süresi, ilk/geri dönen ziyaretçi, ülke, referrer, özel değişken, AND/OR yok.


---

# 03 — Gap analizi: Team · Reports · Billing/Planlar · Apps & Geliştirici platformu · HelpDesk

> Referans: LiveChat (`report.md` satır 1078–2045). Hedef: SiyahTuş / nexa (`C:\Users\Hobbie\Desktop\nexa-main`, salt-okuma, 2026-10-14).
> Kanıt yolları repo köküne görelidir. "Yok" ve "Kısmi" kararlarının hepsi Grep/Glob ile kodda doğrulandı (apps/web, apps/api, packages/contract, packages/types).
> Durum: **Var** · **Kısmi** · **Yok** · **Mock** (UI/API var, dış sağlayıcı sahte). Öncelik: **P0** (LiveChat rakibi için çekirdek / pilotu bloklar) · **P1** (önemli parite) · **P2** (olsa iyi olur). Efor: **S** (≤2 gün) · **M** (≤1 hafta) · **L** (>1 hafta).
> "—" = boşluk yok, öncelik/efor gerekmiyor.

---

## 1. Özellik tablosu

### 1.1 Team (agents, chatbots, groups, suspended, invite, roles, chat limit, profile)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| T1 | Ajan listesi (Name · Role · Status) | Var | **Var** | `apps/web/src/features/team/TeamPage.tsx` | — | — | — |
| T2 | Ajan arama (anlık, harf duyarsız) | Var | **Var** | `TeamPage.tsx:138-142` (arama + rol/müsaitlik/2FA filtresi) | — | — | — |
| T3 | Status kolonuna göre sıralama | Var | **Kısmi** | `TeamPage.tsx` (yalnız filtre) | Kolon başlığından sıralama yok | P2 | S |
| T4 | Ajan davet (çoklu e-posta + rol) | Var | **Var** | `features/team/InviteTeammates.tsx`, `POST /invitations` | — | — | — |
| T5 | Davet linki kopyala | Var | **Var** | `InviteTeammates.tsx` | — | — | — |
| T6 | Bekleyen davetler / "Complete invites" | Var | **Var** | `GET/DELETE /invitations` (`routes/account-lifecycle.ts`) | — | — | — |
| T7 | Invite settings → Allowed domains (davetsiz katılım) | Var | **Yok** | Grep `allowed_domain`/`allowedDomain`: 0 sonuç | Alan adı eşleşmesiyle otomatik katılım yok | P2 | M — `settings/security`'e `allowed_join_domains` + `account-lifecycle.yaml` join akışında eşleşme |
| T8 | Ajan durumu dropdown (başka ajanı Accepting/Not accepting/Log out yapma) | Var | **Kısmi** | Yalnız `PUT /agents/me/routing-status` (`packages/contract/openapi/paths/agents.yaml`) | Yönetici başka ajanın durumunu değiştiremez / oturumunu kapatamaz | P2 | S — `PUT /agents/{id}/routing-status` (`agents--all:rw`) `routes/agents.ts` |
| T9 | Change chat limit | Var (1–20) | **Var** | `routes/agents.ts:205` (1–50), `AgentProfile.tsx` | — | — | — |
| T10 | "View agent reports" (ajan filtreli rapora derin link) | Var | **Yok** | `routes/reports.ts:200` `rangeQuery` yalnız `from/to/baseline` | Raporlarda ajan filtresi yok → link kurulamaz | P1 | M — `rangeQuery`'ye `agent_id[]`, SQL'lere `assignee_id` koşulu; TeamPage'den `/app/reports?agent=` |
| T11 | Details paneli (chat limit, login status, last seen, groups) | Var | **Var** | `features/team/AgentProfile.tsx` (`last_seen`) | — | — | — |
| T12 | Details → Performance (total chats, goals, CSAT) | Var | **Kısmi** | Ajan KPI'ları yalnız `GET /reports/team-performance` (`routes/reports.ts:1157`, ilk 20 ajan) | Profilde performans kartı yok; raporda 20 ajan sınırı | P2 | S — AgentProfile'a `team-performance` satırını çek; LIMIT'i sayfalamaya çevir |
| T13 | Working hours / work scheduler | 🔒 Business | **Var** | `features/team/WorkSchedule.tsx`, `PUT /agents/{id}/work-schedule` | — | — | — |
| T14 | Profil: Full name düzenleme | Var | **Yok** | `agents.yaml`'da profil PATCH yok; yalnız chat-limit/expertise/role/suspension/work-schedule | Kendi adını değiştiremez | P1 | S — `PATCH /agents/me` (name) + AgentProfile formu |
| T15 | Profil: Job title | Var | **Yok** | Grep `jobTitle`/`job_title`: 0 | — | P2 | S — `accounts.job_title` kolonu + aynı PATCH |
| T16 | Avatar yükleme | Var | **Yok** | `components/PresenceAvatars.tsx` yalnız baş harf; `/uploads` altyapısı mevcut | Fotoğraf yok (widget'ta ajan avatarı da baş harf) | P2 | M — `/uploads` + `accounts.avatar_url`, widget'a taşı |
| T17 | E-posta (kilitli) gösterimi | Var | **Var** | `AgentProfile.tsx` | — | — | — |
| T18 | Change password (oturum içinden) | Var | **Yok** | Yalnız `/auth/password-reset` (`account-lifecycle.yaml:173`) | Mevcut şifreyle değiştirme yok; e-posta sıfırlamaya mecbur | P1 | S — `POST /auth/password` (current+new, scrypt, diğer oturumları iptal) |
| T19 | Gruba atama (profilden / gruptan) | Var | **Var** | `features/team/TeamEditor.tsx`, `PUT /groups/{id}/agents/{agentId}` | — | — | — |
| T20 | "Agent status after logging in" (accept / don't / working hours'a göre) | Var | **Kısmi** | Çalışma takvimi var (`WorkSchedule.tsx`); girişte varsayılan durum tercihi bulunamadı | Giriş sonrası otomatik durum kuralı yok | P2 | S — `ui-preferences`'e `status_on_login`, `auth-store.ts`'te uygula |
| T21 | 2FA etkinleştir | Var | **Var** | `features/settings/TwoFactor.tsx`, `/auth/2fa/*` | — | — | — |
| T22 | Rol görüntüleme / rol değiştirme | Var | **Var** | `features/team/RoleMenu.tsx`, `PUT /agents/{id}/role` | — | — | — |
| T23 | Change owner (sahiplik devri) | Var | **Yok** | `RoleMenu.tsx:6-7,35` sahiplik devrini açıkça reddeder | Owner ayrılırsa workspace sahipsiz kalır | P1 | M — `POST /organization/owner-transfer` (yalnız owner, onay + audit) |
| T24 | Saat biçimi 12/24 (kişisel) | Var | **Kısmi** | `apps/web/src/lib/format.ts` locale'den türetir | Kullanıcı tercihi yok | P2 | S — `ui-preferences.time_format` |
| T25 | E-posta özetleri: Daily summary / Weekly summary | Var | **Yok** | `services/mail/templates/messages.ts` şablon listesinde yok | Ajan/yöneticiye günlük-haftalık özet gitmiyor | P1 | M — `scheduled_reports` işini kişisel özet şablonuyla yeniden kullan |
| T26 | E-posta: "New unassigned chat" | Var | **Kısmi** | `GET/PUT /agents/me/notification-preferences` (e-posta kanalı), atanan bildirimi `backgroundMail` | Atanmamış sohbet için ayrı e-posta tetiği bulunamadı | P2 | S |
| T27 | Kaydedilmemiş değişiklik uyarısı | Yok (bug) | **Var** | `apps/web/src/lib/dirty-guard.tsx` | — | — | — |
| T28 | Chatbots sekmesi | ChatBot.com bağlantısı | **Var** | `features/team/TeamAiAgentsPage.tsx`, `RuleBots.tsx` | — | — | — |
| T29 | Groups listesi (üye, x/y accepting) | Var | **Var** | `features/team/Teams.tsx`, `GET /groups` | — | — | — |
| T30 | Create group (ad + üyeler) | Var | **Var** | `CreateTeamButton.tsx`, `POST /groups` | — | — | — |
| T31 | Varsayılan "General" grup (silinemez) + Group ID kopyala | Var | **Kısmi** | `services/team/group-service.ts` — varsayılan grup kavramı yok | Grupsuz ajan/sohbet için garanti hedef yok; ID kopyalama yok | P2 | S |
| T32 | Grup Details → Performance + "View reports" (grup filtresi) | Var | **Yok** | `routes/reports.ts:200` grup parametresi yok | Grup bazlı rapor yok (Breakdown'da takım kırılımı var) | P1 | M — T10 ile aynı iş: `group_id[]` filtresi |
| T33 | Grup → Chat assignment / Routing rules linkleri | Var | **Var** | `features/settings/RoutingRules.tsx` | — | — | — |
| T34 | Grup düzenle/sil, dil, üye önceliği | Kısmi (General kilitli) | **Var** | `PATCH/DELETE /groups/{id}`, öncelik `primary/first/normal/last` | — | — | — |
| T35 | Suspended agents sekmesi | Var | **Var** | `TeamPage.tsx:111` (`/agents?status=suspended`) | — | — | — |
| T36 | Suspend / reinstate | Var | **Var** | `PUT /agents/{id}/suspension` | — | — | — |
| T37 | Remove agent (kalıcı çıkarma) | Var | **Yok** | `agents.yaml`'da `DELETE /agents/{id}` yok | Yalnız askıya alma; koltuk/üyelik temizliği yok | P2 | S — `DELETE /agents/{id}` (sohbet/ticket atamalarını boşalt + audit) |

### 1.2 Reports — rapor menüsü (LiveChat'in rapor listesi tek tek)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| R1 | My saved views | Var (sunucu) | **Kısmi** | `features/reports/report-views.ts` — localStorage; yalnız tab + tarih + baseline | Filtre saklamaz (filtre yok), cihazlar arası yok | P2 | S — sunucu tarafı `report_views` tablosu |
| R2 | Last 7 days (My stats / All agents) | Var | **Kısmi** | `features/home/HomePage.tsx` (7g vs önceki 7g) | "My stats" kişisel görünüm yok | P2 | S — `/home?scope=me` |
| R3 | Dashboard (duvar/TV, koltuksuz) | Var | **Kısmi** | Home + hesapsız paylaşım `features/reports/SharedReportPage.tsx` | Otomatik yenilenen wallboard modu yok | P2 | M — SharedReportPage'e `?wall=1` + polling |
| R4 | Total chats | Var | **Var** | `GET /reports/overview` (`routes/reports.ts:547`) | — | — | — |
| R5 | Chat engagement (campaign / customer / agent başlattı) | Var | **Yok** | `routes/reports.ts`: `engagement`/`started_by`/`campaign` 0 sonuç | Sohbeti kimin başlattığı raporlanmıyor | P1 | M — thread'e `initiated_by` (+`campaign_id`), overview'a kırılım |
| R6 | Missed chats + heatmap | Var | **Yok** | `apps/api/src/routes`, `services`: "missed" kavramı yok | Kaçırılan sohbet metriği yok — canlı destekte temel KPI | P1 | M — kuyrukta/yanıtsız kapanan thread sayımı + saatlik ısı haritası |
| R7 | Campaigns conversion | Var | **Kısmi** | `features/campaigns/CampaignsPage.tsx` (Displayed/Chats/Conversion) | Tarih aralıklı rapor ve export yok | P2 | S |
| R8 | Tags usage (tagged / not tagged %, etiket başına) | Var | **Kısmi** | Overview "Top tags" (`routes/reports.ts:564`) | Etiketsiz oran ve ayrı rapor yok | P2 | S |
| R9 | Chat satisfaction | Var | **Var** | `GET /reports/reviews` (CSAT, günlük, içgörü) | — | — | — |
| R10 | Chat availability (accepting süresi, online/offline dağılımı) | Var | **Yok** | Presence log yalnız staffing'de (`routes/reports.ts:1301`) | Ajan müsaitlik süresi raporu yok (veri mevcut) | P1 | M — presence aralıklarını (`services/staffing/*presenceCoverage`) rapora aç |
| R11 | Chat forms (pre/post-chat kapalı soru cevapları) | Var | **Yok** | `routes/reports.ts`: `survey`/`pre_chat` 0 | Form yanıtları raporlanmıyor | P2 | M — custom-field cevaplarını seçenek bazında say |
| R12 | Chat duration (ajan/etiket/grup) | 🔒 Business | **Kısmi** | `avg_duration_seconds` (`routes/reports.ts:666`) | Etiket/grup kırılımı yok | P2 | S |
| R13 | Agent performance | 🔒 Business | **Var** | `GET /reports/team-performance` (`routes/reports.ts:1157`) | 20 ajan sınırı (bkz. T12) | — | — |
| R14 | Chat response times | 🔒 Business | **Var** | `avg_first_response_seconds` (overview + ajan bazında) | — | — | — |
| R15 | Staffing prediction | 🔒 Business | **Var** | `GET /reports/staffing-forecast` (7×24 gerekli/planlanan/çevrimiçi) | — | — | — |
| R16 | Agent activity (ajan durum zaman çizelgesi) | 🔒 Business | **Yok** | Presence verisi var (`routes/reports.ts:1301`), rapor yok | Ajan bazında gün içi durum çizelgesi yok | P1 | M — R10 ile aynı veri, ajan × saat şerit görünümü |
| R17 | Queued customers (queue conversion, ort. bekleme, heatmap) | Var | **Kısmi** | Yalnız `queued_now` (`routes/reports.ts:576`); `threads.queued_at` şemada (`prisma/schema.prisma:823`) ama raporda kullanılmıyor | Bekleme süresi/dönüşüm yok | P1 | M — `queued_at`→atanma farkı; kuyruktan girdi/çıktı sayımı |
| R18 | Queue abandonment | Var | **Yok** | Grep `abandon`: 0 | Kuyruğu terk eden ziyaretçi metriği yok | P1 | S — R17 ile birlikte |
| R19 | Top customer questions (Insights) | Var (iframe bozuk) | **Var** | `GET /reports/topics` (Chat topics) | — | — | — |
| R20 | Alerts (Insights anomali uyarıları) | Var | **Yok** | `ReportsPage.tsx`/`reports.ts`: alert yok | Hacim/CSAT sapması uyarısı yok | P2 | M — `review-insights.ts` mantığını eşikli e-posta uyarısına çevir |
| R21 | Achieved goals | Var | **Var** | `GET /reports/goals`, `GoalsFunnel.tsx` | — | — | — |
| R22 | Tracked sales | Var | **Var** | `GET /reports/sales` | — | — | — |
| R23 | Generate report (ham veri, tek seferlik) | 🔒 Business | **Kısmi** | `GET /reports/export` (grup bazlı CSV/PDF, `routes/reports.ts:220`) | Ham sohbet/olay dökümü yok | P2 | M |
| R24 | Scheduled reports | 🔒 Business | **Var** | `services/reports/scheduled-report-service.ts` (günlük/haftalık/aylık) | Yalnız CSV (`format: 'csv'`, satır 35); TSV/XLS yok | P2 | S |
| R25 | Reviews (iyi puan + uzun yorum vitrini) | Var | **Kısmi** | `services/reports/review-insights.ts` — puan yorumları raporda gösterilmiyor | Yorum listesi/paylaşımı yok | P2 | S — `/reports/reviews`'e son yorumlar |

### 1.3 Reports — ortak şablon: filtre / karşılaştırma / dışa aktarma

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| RF1 | Save view (ad, kişisel) | Var | **Kısmi** | `report-views.ts` (ad ≤40, localStorage) | Bkz. R1 | P2 | S |
| RF2 | Filtre: Keyword | Var | **Yok** | `routes/reports.ts:200` | Anahtar kelimeyle sayım yok | P2 | M |
| RF3 | Filtre: Agent | Var | **Yok** | aynı | Bkz. T10 | P1 | M |
| RF4 | Filtre: Group | Var | **Yok** | aynı | Bkz. T32 | P1 | M |
| RF5 | Filtre: Tag | Var | **Yok** | aynı | — | P2 | S |
| RF6 | Filtre: Assignment / Availability | Var | **Yok** | aynı | — | P2 | S |
| RF7 | Filtre: Country | Var | **Yok** | aynı | (Breakdown'da kanal kırılımı var, ülke yok) | P2 | S |
| RF8 | Tarih presetleri (Today, Yesterday, Last 7/30, Last month, Current month, Custom) | Var | **Kısmi** | `report-views.ts:35` `7|30|90|365|custom` | Today/Yesterday/Last month/Current month yok | P2 | S |
| RF9 | Dönem kaydırma `<` `>` | Var | **Yok** | `ReportsPage.tsx` (preset + custom) | — | P2 | S |
| RF10 | Compare: previous period | Var | **Var** | `baseline=previous_period` (`routes/reports-metrics.ts:81-134`) | — | — | — |
| RF11 | Compare: previous year | Var | **Var** | `baseline=previous_year` | — | — | — |
| RF12 | Compare: custom period | Var | **Yok** | `BENCHMARK_BASELINES` kapalı enum | — | P2 | S |
| RF13 | 24-hour distribution | Var | **Var** | `by_hour` (`ReportsPage.tsx:128,1600`) | — | — | — |
| RF14 | Heatmap (chats/missed/queued) | Var | **Kısmi** | Yalnız staffing ısı haritası | Sohbet/kaçırılan/kuyruk ısı haritası yok | P2 | S |
| RF15 | Industry benchmark | 🔒 Business | **Yok** (bilinçli) | `reports-metrics.ts:70-73` cross-tenant baseline'ı reddeder | Gizlilik gerekçesiyle tasarım kararı | P2 | L |
| RF16 | Breakdown tablosu | Var | **Var** | `GET /reports/breakdown` (gün/ajan/saat/takım/kanal) | — | — | — |
| RF17 | Export CSV (her kart) | Var | **Var** | `GET /reports/export?format=csv|pdf` | — | — | — |
| RF18 | "View chats →" (rapordan filtreli sohbet listesine) | Var | **Yok** | Raporlardan Inbox'a filtreli link yok | Arşiv araması da yok (bkz. 01/02 gap dosyaları) | P2 | M |
| RF19 | Reports API | Var | **Var** | Tüm `/reports/*` PAT ile; MCP `get_report` (`services/mcp/tools/`) | — | — | — |

### 1.4 Billing / Planlar

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| B1 | Plan kademeleri (Starter/Team/Business/Enterprise) | 4 plan | **Kısmi** | `services/billing/subscription-service.ts` — `growth` + `enterprise` | Tek fiyatlı plan; giriş/orta kademe yok (bilinçli ürün kararı, $99) | P2 | M |
| B2 | Annual / Monthly | Var | **Var** | `billing_cycle` (`routes/reports.ts:184`), yıllık = 10 ay | — | — | — |
| B3 | 2 / 3 yıllık döngü | Var | **Yok** | `BILLING_CYCLES` yalnız aylık/yıllık | — | P2 | S |
| B4 | Plan karşılaştırma modalı (See all features) | Var | **Yok** | `features/billing/BillingPage.tsx`; `locales/en/billing.ts` matris yok | Satın almadan önce özellik görünürlüğü yok | P2 | S |
| B5 | Özellik tooltip'leri / "Recommended" rozeti | Var | **Yok** | aynı | — | P2 | S |
| B6 | Plan bazlı özellik kilitleme | Var (165 satır) | **Kısmi** | `packages/types/src/entitlements.ts` — 6 Enterprise yetkisi | Kademe yok → kilit de yok | P2 | M |
| B7 | Upsell / paywall ekranı ("Upgrade plan", highlighted feature) | Var | **Kısmi** | Kapalı özellik gizleniyor (`components/PilotHidden.tsx`, entitlement gate) | Kilitli özelliği tanıtan upgrade ekranı yok | P2 | S |
| B8 | Manage/sepet önizlemesi (Immediate changes, toplamlar) | Var | **Mock** | `BillingPage.tsx` plan yönetimi + tahmini toplam; `STRIPE_PROVIDER=mock` | — | P1 | L — B11 ile |
| B9 | Koltuk sayacı | Var (1–999) | **Var** | `BillingPage.tsx` koltuk +/−, min koltuk; davet koltuk uyarısı | — | — | — |
| B10 | Add-on'lar (GA vb.) / API paketleri | Var | **Mock** | `/billing/api-packages`, `/billing/ai-packages` | Uygulama eklentisi faturalanmıyor | P2 | M |
| B11 | Checkout / gerçek ödeme | Var | **Mock** | `services/billing/payment-provider.ts` (mock) | Pilot elle aktivasyonla dönüyor; ücretli lansman için gerçek sağlayıcı şart | P1 | L — Stripe/iyzico adaptörü `payment-provider.ts` arayüzüne |
| B12 | Faturalar listesi | Var (bozuk) | **Var** | `GET /billing/invoices` (Paid/Open/Trial) | — | — | — |
| B13 | Fatura indirme (PDF) | Var | **Kısmi** | `GET /billing/invoices/{period}/download` → CSV | Yasal PDF fatura yok | P1 | S — `reports-export` PDF üreticisini yeniden kullan |
| B14 | Account details: fatura adresi / vergi no / hesap sahibi kartı | Kısmi | **Yok** | Grep `billing_address`/`tax`/`vat`: 0 | Kurumsal fatura bilgisi yok (TR'de VKN/e-fatura) | P1 | M |
| B15 | Ödeme kartı ekle | Var | **Mock** | `GET/PUT /billing/payment-method` (marka/son4) | — | P1 | — (B11 kapsamında) |
| B16 | Trial banner + Upgrade now | Var | **Var** | `components/AppShell.tsx` banner; `plugins/license-gate.ts` read-only | — | — | — |
| B17 | Abonelik iptali | Var ("until you cancel") | **Yok** | `subscription-service.ts`: `canceled` durumu var, iptal akışı/endpoint yok | Self-servis iptal yok | P1 | S — `POST /billing/subscription/cancel` (dönem sonu) |
| B18 | Enterprise "Request a call / Contact sales" | Var | **Yok** | `locales/en/billing.ts` yalnız plan adı | — | P2 | S |
| B19 | Kullanım ölçümü (API çağrısı, AI çözümü) | Kısmi (API kredi) | **Var** | `GET /billing/usage`, `plugins/metering.ts` | — | — | — |
| B20 | Dönem sonu fatura dondurma | Var | **Var** | `invoice_close` işi (`services/billing/invoice-close-*.ts`) | — | — | — |

### 1.5 LiveChat plan karşılaştırma tablosu (özellik kontrol listesi olarak)

> Kapsam dışı kategoriler (kanallar, widget, güvenlik) burada yalnız durum olarak işaretlendi; ayrıntısı ilgili gap dosyalarında. Ürün dışı hizmet satırları (Help Center, 24/7 destek, eğitim, hukuk desteği, KAM, profesyonel hizmetler, security assistance) sayılmadı.

| # | Özellik (LiveChat planı) | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| P1 | Website (widget) | Tüm planlar | **Var** | `apps/widget` | — | — | — |
| P2 | Apps (mobil uygulamaya gömülü widget SDK) | Tüm planlar | **Yok** | Müşteri tarafı mobil SDK yok | — | P2 | L |
| P3 | Direct Chat Link | Tüm planlar | **Var** | `apps/widget/chat.html` | — | — | — |
| P4 | Facebook Messenger | Tüm planlar | **Mock** | `services/channels/messenger.ts` | — | P1 | L |
| P5 | SMS | Team+ | **Mock** | `services/channels/twilio.ts` | — | P2 | M |
| P6 | Apple Messages for Business | Business+ | **Yok** | Grep `apple`: yalnız stil | — | P2 | L |
| P7 | Email (kanal) | Marketplace | **Kısmi** | `services/channels/email-inbound.ts` | Bkz. H2–H4 | P0 | — |
| P8 | Instagram / WhatsApp | Marketplace | **Mock** | `services/channels/instagram.ts`, `whatsapp.ts` | — | P1 | L |
| P9 | X (Twitter) | Marketplace | **Yok** | — | — | P2 | M |
| P10 | Reply suggestions | Team+ | **Var** | `features/inbox/CopilotPanel.tsx` | — | — | — |
| P11 | Insights (TI) | Team+ | **Var** | `/reports/topics` | — | — | — |
| P12 | Tag suggestions | Team+ | **Kısmi** | `routes/settings.ts:3156` (yazarken etiket listesi) | Geçmiş etiketlemeden öğrenen öneri yok | P2 | M |
| P13 | Chat summary | Business+ | **Var** | `POST /copilot/chats/{id}/summary` | — | — | — |
| P14 | Text enhancement | Business+ | **Var** | `POST /copilot/chats/{id}/enhance` | — | — | — |
| P15 | Sentiment analysis | Enterprise (early) | **Yok** | Grep `sentiment`: 0 | — | P2 | M |
| P16 | AI chatbots | Ayrı ürün ($52+) | **Var** | `features/playbook/*`, `RuleBots.tsx` | — | — | — |
| P17 | Traffic tracking | 100/400/1000 | **Var** | `GET /traffic` (sınırsız) | — | — | — |
| P18 | Multiple website support | Tüm planlar | **Var** | `GET/POST /websites` | — | — | — |
| P19 | Applications (web/desktop/mobil ajan) | Tüm planlar | **Kısmi** | `apps/web`, `apps/mobile`; masaüstü bilinçli yok | — | P2 | L |
| P20 | Pre-chat & post-chat surveys | Team+ (tam) | **Var** | `settings/ChatFormsSettings.tsx` | — | — | — |
| P21 | Inactivity message (yanıt gecikince e-posta iste) | Tüm planlar | **Yok** | Grep `inactivity`: yalnız playbook şablon metni | — | P2 | S |
| P22 | Customer details | Tüm planlar | **Var** | `features/inbox/DetailsPanel.tsx` | — | — | — |
| P23 | Agent rating | Tüm planlar | **Var** | `POST /customer/chat/rating` | — | — | — |
| P24 | Transfers | Tüm planlar | **Var** | `POST /chats/{id}/transfer` | — | — | — |
| P25 | Smart chat routing | Tüm planlar | **Var** | `services/routing/routing-service.ts` | — | — | — |
| P26 | Manual chat routing (kuyruktan elle alma) | Tüm planlar | **Var** | Inbox Unassigned/Queued + "Assign chat to me" | — | — | — |
| P27 | Canned responses | Team+ | **Var** | `settings/CannedResponses.tsx` | — | — | — |
| P28 | Private canned responses | Team+ | **Yok** | Grep: kişisel/özel canned yok (yalnız takım kapsamı) | — | P2 | S |
| P29 | Canned response suggestions | Team+ | **Var** | Composer öneri çipleri | — | — | — |
| P30 | Custom customer segments | Team+ | **Kısmi** | `CustomersPage.tsx` sabit segmentler | Kaydedilebilir özel segment yok | P2 | S |
| P31 | Chat tagging | Team+ | **Var** | `POST /chats/{id}/tags` | — | — | — |
| P32 | File sharing | Team+ | **Var** | `/uploads`, `settings/FileSharing.tsx` | — | — | — |
| P33 | Routing rules (URL) | Team+ | **Var** | `settings/RoutingRules.tsx` | — | — | — |
| P34 | Automated tags (canned → tag) | Team+ | **Yok** | Grep: canned yanıt–etiket bağı yok | — | P2 | S |
| P35 | Routing rules (geolocation) | Business+ | **Var** | `routing-service.ts:433` (`country_codes`) | — | — | — |
| P36 | Chat takeover | Business+ | **Var** | `POST /chats/{id}/takeover` | — | — | — |
| P37 | Work scheduler | Business+ | **Var** | `WorkSchedule.tsx` | — | — | — |
| P38 | Asynchronous availability | Tüm planlar | **Var** | chat→thread modeli, aynı sohbete dönüş | — | — | — |
| P39 | Chat history | 60 gün / sınırsız | **Var** | `settings/DataRetention.tsx` | — | — | — |
| P40 | Email transcripts | Tüm planlar | **Var** | `customerTranscript` şablonu (`mail/templates/messages.ts`) | — | — | — |
| P41 | Daily & Weekly summary | Tüm planlar | **Yok** | Bkz. T25 | — | P1 | M |
| P42 | LiveChat Dashboard | Team+ | **Var** | `/app/home` | — | — | — |
| P43 | Chat statistics | Team+ | **Var** | `/reports/overview` | — | — | — |
| P44 | Tags usage | Team+ | **Kısmi** | Bkz. R8 | — | P2 | S |
| P45 | Campaign conversions | Team+ | **Kısmi** | Bkz. R7 | — | P2 | S |
| P46 | Agent activity | Business+ | **Yok** | Bkz. R16 | — | P1 | M |
| P47 | Agent performance | Business+ | **Var** | Bkz. R13 | — | — | — |
| P48 | Chat duration | Business+ | **Kısmi** | Bkz. R12 | — | P2 | S |
| P49 | Chat response | Business+ | **Var** | Bkz. R14 | — | — | — |
| P50 | On-demand reporting | Business+ | **Var** | Bkz. R24 | — | — | — |
| P51 | Staffing prediction | Business+ | **Var** | Bkz. R15 | — | — | — |
| P52 | Proactive chats | Tüm planlar | **Var** | Traffic "Start chat" | — | — | — |
| P53 | Eye-catcher | Tüm planlar | **Yok** | Grep `eye.?catcher`: 0 | — | P2 | S |
| P54 | Recurring campaigns | Team+ sınırsız | **Kısmi** | `CampaignBuilder.tsx` (yalnız URL tetiği) | — | P1 | M |
| P55 | One-time campaigns | Team+ | **Yok** | Kampanyada "ziyaretçi başına bir kez" yok | — | P2 | S |
| P56 | Chat window translations (48 dil, özel ifadeler) | Team+ | **Kısmi** | Widget 8 dil (`apps/widget/src/locales`) | Özel ifade düzenleme yok | P2 | M |
| P57 | Dark mode | Tüm planlar | **Var** | Widget tema auto/light/dark | — | — | — |
| P58 | Live editor | Tüm planlar | **Var** | `settings/WidgetCustomization.tsx` önizleme | — | — | — |
| P59 | Right-to-left | Tüm planlar | **Var** | Widget `ar` | — | — | — |
| P60 | Themes | Tüm planlar | **Kısmi** | Yalnız renk + açık/koyu | Tema galerisi yok | P2 | S |
| P61 | Accessibility (WCAG 2.1 AA) | Tüm planlar | **Kısmi** | PLAN NFR A11Y ◐ | — | P2 | M |
| P62 | Custom logo in chat widget | Team+ | **Yok** | Widget'ta logo ayarı yok | — | P2 | S |
| P63 | Multi-brand customization | Team+ | **Var** | `settings/Brands.tsx` | — | — | — |
| P64 | Language selection (panelden) | Team+ | **Kısmi** | Yalnız snippet `language` parametresi | — | P2 | S |
| P65 | White label | Enterprise | **Var** | `white_label` entitlement | — | — | — |
| P66 | User roles | Tüm planlar | **Var** | `packages/types/src/role-scopes.ts` | — | — | — |
| P67 | Supervision | Tüm planlar | **Var** | `POST /chats/{id}/supervise` | — | — | — |
| P68 | Allowed domains | Tüm planlar | **Yok** | Bkz. T7 | — | P2 | M |
| P69 | Group organization | Team+ | **Var** | `/groups` | — | — | — |
| P70 | Inactivity timeout (yanıtsız ajandan otomatik transfer) | Team+ | **Kısmi** | `settings/ChatTimeout.tsx` yalnız otomatik kapatma | Transfer yok | P2 | S |
| P71 | Internal notes | Team+ | **Var** | Composer "Internal note" | — | — | — |
| P72 | Marketplace | Tüm planlar | **Mock** | Bkz. A1 | — | P1 | L |
| P73 | API | Kredi bazlı | **Var** | 313 REST operasyonu, PAT, OAuth | — | — | — |
| P74 | HelpDesk (eklenti) | $29+ | **Kısmi** | Bkz. 1.7 | — | P0 | L |
| P75 | KnowledgeBase (eklenti) | $24+ | **Var** | Public KB (`routes/kb.ts`, `public-kb*.ts`) | — | — | — |
| P76 | ChatBot (eklenti) | $52+ | **Var** | Playbook + Rule bots | — | — | — |
| P77 | Shopify / WooCommerce / BigCommerce | Tüm planlar | **Mock** | `packages/types/src/apps.ts` kartları | — | P2 | M |
| P78 | Goals | Team+ | **Var** | `/goals` | — | — | — |
| P79 | Sales tracker | Team+ | **Var** | `settings/SalesTracker.tsx`, widget `trackSale` | — | — | — |
| P80 | Banned visitors list | Tüm planlar | **Var** | `settings/BannedCustomerIps.tsx` | — | — | — |
| P81 | Credit card masking | Tüm planlar | **Var** | `apps/api/src/lib/cc-mask.ts` | — | — | — |
| P82 | Data center US/EU | Tüm planlar | **Var** | Bölge `eu|us` | — | — | — |
| P83 | Login with Google / Microsoft / Apple | Tüm planlar | **Yok** | Grep `social.?login|oidc`: yalnız yorum | — | P2 | M |
| P84 | Two-Factor Authentication | Tüm planlar | **Var** | `/auth/2fa/*` | — | — | — |
| P85 | Require login with Google | Tüm planlar | **Kısmi** | SAML "SSO zorunlu" (`settings/SsoConnection.tsx`) | Google'a özel zorlama yok | P2 | S |
| P86 | Trusted domains | Tüm planlar | **Var** | `settings/TrustedDomains.tsx` | — | — | — |
| P87 | Access restriction (IP) | Business+ | **Var** | `settings/IpAllowlist.tsx` | — | — | — |
| P88 | Audit log | Enterprise | **Var** | `features/audit/AuditLogPage.tsx` | — | — | — |
| P89 | HIPAA | Enterprise | **Var** | `settings/Compliance.tsx` (BAA) | — | — | — |
| P90 | SSO (SAML 2.0) | Enterprise | **Var** | `routes/saml.ts` + SCIM | — | — | — |

### 1.6 Apps marketplace ve geliştirici platformu (webhooks, API, build your app)

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| A1 | Uygulama kataloğu (117 app) | Var | **Mock** | `packages/types/src/apps.ts` (103 kart, mock OAuth + sahte veri); canlı: brevo, freshdesk, telegram (`services/apps/verifiers/`) | Gerçek entegrasyon sayısı 3 | P1 | L — önce 5 kritik canlı adaptör (Slack, HubSpot, Shopify, Zapier, WhatsApp) |
| A2 | Collections (By text, AI-Powered, New, Staff Picks) | Var | **Var** | `features/apps/AppsMarketplace.tsx:115` | — | — | — |
| A3 | Kategori filtresi | 13 kategori | **Var** | `AppsMarketplace.tsx:105` (8 kategori) | — | — | — |
| A4 | Payment type filtresi | 4 tip | **Var** | `AppsMarketplace.tsx:118-124` (free/paid; fiyat deterministik mock, `apps.ts:151-158`) | — | — | — |
| A5 | Placement filtresi (Campaigns/Navigation/Message box/Details/Settings) | Var | **Kısmi** | `AppsMarketplace.tsx:132` filtre var | Yerleşimler gerçek uzantı noktası değil (bkz. A16) | P2 | — |
| A6 | Uygulama arama | Var | **Var** | `AppsMarketplace.tsx` | — | — | — |
| A7 | Sıralama (A–Z, Price, Popularity, Recommended, Recent) | Var | **Yok** | `AppsMarketplace.tsx`: `sort` 0 sonuç | — | P2 | S |
| A8 | Puan ve yorumlar | Var | **Yok** | `AppsMarketplace.tsx`: `rating`/`review` 0 | — | P2 | M |
| A9 | Uygulama detay sayfası (Overview, Key features, Benefits, Terms, Support, galeri) | Var | **Kısmi** | Kart açıklaması + scope onayı | Ayrı detay sayfası/rota yok | P2 | M |
| A10 | Ücretli uygulama satın alma + Cart + deneme | Var | **Yok** | `AppsMarketplace.tsx`: `cart`/`price` 0 | Uygulama faturalaması yok | P2 | L |
| A11 | Get / Install (OAuth onayı veya API anahtarı) | Var | **Mock** | `POST /settings/apps/{id}/oauth/start|callback` (mock), `/connect` (canlı kartlarda AES-GCM) | — | P1 | — (A1 kapsamında) |
| A12 | Kurulu uygulamalar görünümü | Yok | **Var** | Connected rozeti + Details paneli "Apps" (`GET /chats/{id}/apps`) | — | — | — |
| A13 | External integrations / self-setup kurulum rehberleri (74) | Var | **Kısmi** | `settings/WebsiteWidgets.tsx` (manuel/platform yöntemi, geliştiriciye e-posta) | Platform rehber kütüphanesi yok | P2 | M |
| A14 | Partners dizini | Var | **Yok** | — | Ticari ekosistem; ürün önceliği düşük | P2 | L |
| A15 | Creators (geliştirici listesi) | Var | **Yok** | — | — | P2 | S |
| A16 | Uygulama UI uzantıları (Details / Message box / Fullscreen iframe widget SDK) | Var | **Yok** | `apps/web/src`: app iframe yok (yalnız `WidgetCustomization.tsx` önizleme) | 3. taraf geliştirici panel içine UI ekleyemez | P1 | L — `DetailsPanel.tsx`'te sandbox iframe + postMessage köprüsü, `partner/apps` manifestine `placements` |
| A17 | Public listing (uygulamayı markete yayınlama) | Var | **Yok** | `features/developers/DeveloperPortal.tsx` yalnız private OAuth istemcisi | — | P2 | L |
| D1 | Build your app: OAuth istemci kaydı (PKCE/confidential, secret rotate) | Developer Console (harici) | **Var** | `DeveloperPortal.tsx`, `/partner/apps/*` | — | — | — |
| D2 | API Console / interaktif dokümantasyon | Var | **Yok** | Grep `swagger|redoc|openapi.json`: 0 (yalnız `packages/contract/openapi/openapi.yaml`) | Dış geliştirici dokümanı servis edilmiyor | P1 | S — `openapi.yaml`'ı Redoc ile `/developers/docs` olarak servis et |
| D3 | API usage raporu (istek, metot bazında) | Var | **Kısmi** | `GET /billing/usage` (`api_calls` toplamı) | Metot/uygulama kırılımı yok | P2 | S |
| D4 | Messaging API (olay tabanlı, sync/async) | Var | **Var** | REST + RTM WebSocket (`apps/rtm`) | RTM mutasyonları bilinçli `not_allowed` | — | — |
| D5 | Add webhook (event + target URL) | Var | **Var** | `features/developers/WebhookSubscriptions.tsx`, `POST /webhooks` | — | — | — |
| D6 | Webhook olayı: chat_started | Var | **Var** | `services/webhooks/webhook-service.ts:28-34` | — | — | — |
| D7 | Webhook olayı: chat_ended | Var | **Var** | `chat_deactivated` | — | — | — |
| D8 | Webhook olayı: chat_changed (etiket/özellik değişimi) | Var | **Kısmi** | Yalnız `chat_transferred` | Etiket/özellik değişimi olayı yok | P2 | S |
| D9 | Webhook olayı: visitor_queued | Var | **Yok** | `WEBHOOK_ACTIONS` | — | P2 | S |
| D10 | Webhook olayı: canned_response_changed | Var | **Yok** | aynı | — | P2 | S |
| D11 | Webhook data type seçimi (chat / visitor / pre_chat_survey) | Var | **Yok** | `routes/webhooks.ts:54` `registerBody` | Payload şekli seçilemez | P2 | S |
| D12 | Webhook listesi + silme | Var | **Var** | `GET/DELETE /webhooks` | — | — | — |
| D13 | Webhook düzenleme / aç-kapa | Kısmi | **Yok** | Contract'ta `PATCH /webhooks/{id}` yok (`enabled` alanı var) | — | P2 | S |
| D14 | Webhook teslim günlüğü / test gönderimi | Developer Console | **Kısmi** | `webhook_deliveries` + `webhook_redelivery` işi (backend) | Panelde teslim geçmişi ve "send test" yok | P1 | S — `GET /webhooks/{id}/deliveries` + WebhookSubscriptions'a tablo |
| D15 | API paketleri / kredi | $25 kredi + paket | **Mock** | `/billing/api-packages` | — | P2 | — |

### 1.7 HelpDesk / ticketing

| # | Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı | Öncelik | Efor |
|---|---|---|---|---|---|---|---|
| H1 | Yerleşik ticket sistemi (liste, görünümler) | Ayrı ürün ($29+) | **Var** | Inbox → Tickets (`features/inbox/TicketGrid.tsx`, `TicketPane.tsx`), `GET /tickets` | — | — | — |
| H2 | E-posta → ticket (gövde + ekler) | Var | **Kısmi** | `services/channels/email-inbound.ts:161-167` ve `services/tickets/ticket-service.ts:306-328` — **yalnız konu saklanıyor**, gövde/ek yok | Ajan müşterinin ne yazdığını göremiyor | P0 | M — `ticket_messages` tablosu; inbound gövde + ekleri `/uploads`'a |
| H3 | Ticket'a yanıt verme (ajan → müşteri e-posta, konuşma geçmişi) | Var | **Yok** | `ticket-service.ts:433-436`: "there is no reply endpoint" | HelpDesk'in temel döngüsü yok | P0 | L — `POST /tickets/{id}/messages` (public/internal), SMTP gönderimi (`smtp-mailer.ts`), TicketPane'e transcript + composer |
| H4 | Müşteri yanıtının aynı ticket'a bağlanması (e-posta threading) | Var | **Yok** | Inbound her e-postada yeni ticket açar (`email-inbound.ts:161`) | Her yanıt yeni ticket → kopya ticket yığını | P0 | M — `Message-ID`/`In-Reply-To` + plus-adresli `Reply-To` (`inbound-email-address.ts`) |
| H5 | Otomatik yanıt (oluşturma onayı) | Var ("Automatically send a reply") | **Kısmi** | `services/tickets/ticket-email.ts` (şablonlu durum e-postası) | Ticket açılışında otomatik onay tetiği doğrulanamadı | P1 | S — ticket-rules'a `send_template` eylemi |
| H6 | Öncelik (Urgent/High/Normal/Low) | Var | **Var** | `Ticket.priority` (`prisma/schema.prisma:1117`) | — | — | — |
| H7 | Takıma otomatik yönlendirme (ör. "IT Support") | Var | **Var** | `settings/TicketRules.tsx`, `services/tickets/apply-ticket-rules.ts` | — | — | — |
| H8 | Ticket iç notu | Var | **Yok** | Ticket modelinde mesaj/not yok | — | P1 | — (H3 kapsamında) |
| H9 | Ticket SLA: ilk yanıt süresi | Var | **Kısmi** | `ticket-service.ts:433` yalnız çözüm saati | İlk yanıt ölçülemiyor (yanıt yok) | P1 | S — H3 sonrası |
| H10 | Viewer rolü (koltuksuz salt-okuma) | Var | **Yok** | Roller `owner/viceowner/admin/agent` (`role-scopes.ts`) | — | P2 | M |
| H11 | Merge/unmerge, takipçi, özel alan, toplu işlem, spam durumu | Kısmi | **Var** | `/tickets/{id}/merge`, `/followers`, `/tickets/bulk` | — | — | — |
| H12 | Ticket raporları | Var | **Var** | `GET /reports/cases` | — | — | — |
| H13 | Sohbetten ticket oluşturma | Var | **Var** | `CreateTicketButton.tsx`, `source_chat_id` | — | — | — |

---

## 2. nexa'nın önde olduğu yerler

- **LiveChat'te Business planına kilitli olanlar nexa'da tek planda açık:** Agent performance (R13), Chat response times (R14), Staffing prediction (R15), Scheduled reports (R24), Work scheduler (T13), Chat takeover, coğrafi yönlendirme, IP erişim kısıtı.
- **Enterprise'a kilitli olanlar da yerleşik:** Audit log (hash zinciri + access review CSV), SAML SSO + SCIM, HIPAA BAA, white-label, SIEM, sandbox workspace.
- **Rapor paylaşımı:** süreli ve iptal edilebilir, hesapsız okunan paylaşım linki (`features/reports/ShareControl.tsx`, `SharedReportPage.tsx`). LiveChat'te yok.
- **PDF export** (LiveChat yalnız CSV), **AI Agent / Chat topics / Cases / Leads raporları**, Reviews'ta otomatik içgörüler.
- **Doğal dilde rapor sorgusu:** Copilot BI ve ⌘K "Ask AI" (`POST /copilot/bi`, `/palette/ai-query`). Ayrıca MCP `get_report` aracı.
- **Ekip yönetimi:** chat limiti 50'ye kadar; skills (uzmanlık) tabanlı yönlendirme; grup içi üye önceliği (Primary/First/Normal/Last); rol/müsaitlik/2FA filtreleri; koltuk sınırı uyarılı davet; kaydedilmemiş değişiklik koruması.
- **HelpDesk, ChatBot ve KnowledgeBase ayrı ürün değil, dahil:** merge/unmerge, takipçiler, özel alanlar, toplu işlem, ticket kuralları, markalı e-posta şablonları, SLA çözüm hedefi, SEO'lu public KB.
- **Faturalama şeffaflığı:** kullanım sayaçları (API çağrısı + AI çözümü), %80 kota uyarısı, deneme bitince salt-okunur workspace (`license-gate.ts`).
- **Geliştirici platformu panelin içinde:** OAuth istemci kaydı + secret rotasyonu, PAT, HMAC + zaman damgası + nonce imzalı webhook'lar, 8 denemeli otomatik yeniden teslim, SSRF koruması, Zapier/Make REST Hooks manifesti, MCP sunucusu. Ayrıca `ticket_created` / `event_created` olayları LiveChat'in panel webhook'larında yok.
- **Kurulu uygulamalar görünür:** "Connected" durumu ve Details panelinde müşteri başına app kartları. LiveChat'te "My apps" görünümü yok.

---

## 3. LiveChat hatalarından dersler

1. **Taslak kalıcılığı:** "Cancel inviting" taslağı silmiyor, sonraki açılışta geri geliyor. İptal gerçekten temizlemeli.
2. **Sessiz kıstırma:** Chat limit 999→20, 0→1 hata mesajı vermeden değişiyor. Sınırı göster ve aşımı açıkça reddet (nexa API'de 1–50 doğrulaması doğru yönde).
3. **Kirli form uyarısı yok:** "Get feature" ile sayfadan çıkınca değişiklikler sessizce kayboluyor. nexa'nın `dirty-guard.tsx`'i korunmalı.
4. **Tutarsız modal kapanışı:** Grup modalı Esc'de onaysız kapanıyor, davet modalı onay soruyor. Tek bir kural seçilmeli.
5. **İstemci tarafı doğrulama boşlukları:** aynı adlı grup oluşturulabiliyor, maxlength yok, Save view adında trim yok. Benzersizlik ve uzunluk sunucuda zorlanmalı.
6. **PII URL'de:** e-posta adresi `/team/agent/<e-posta>` ve `agent[]=<e-posta>` olarak URL'ye yazılıyor. nexa ID kullanmalı (rapor filtresi eklenirken `agent_id` olmalı).
7. **Filtre sızıntısı:** rapora özgü olmayan query parametreleri başka raporlara taşınıyor. Filtre durumu rapor bazında saklanmalı.
8. **Kalıcı "Loading..." ve iframe spinner'ları:** veri gelmesine rağmen yükleniyor satırı kalıyor; Insights iframe'i hiç yüklenmiyor. Her bileşende ayrı yükleme/hata/boş durumu olmalı.
9. **Hata ile boş durum karışıyor:** Invoices'ta "Failed to fetch" toast'u ile "Nothing in your Invoices" aynı anda gösteriliyor. nexa `LoadError`/`EmptyState` ayrımını korumalı.
10. **Fiyat ve döngü tutarsızlığı:** Monthly seçilip plan seçilince annual açılıyor; modal ile sayfa radyoları senkron değil; sepet monthly, billing annual gösteriyor. Tek bir fatura durumu kaynağı olmalı.
11. **Gereksiz beforeunload:** değişiklik yokken "Leave site?" çıkıyor. Yalnız gerçekten kirli durumda sorulmalı.
12. **Yanlış upsell vurgusu:** `highlighted=` yanlış maddeyi vurguluyor; geri oku önceki sayfaya değil `/subscription`'a götürüyor.
13. **Erişilebilirlik:** `href`'siz `<a>` menüleri, `<button>` ile açılan dış linkler, "promo" alt metni, yinelenen gizli DOM. Gerçek linkler ve anlamlı alt metinler kullanılmalı.
14. **Marketplace hijyeni:** boş kategori listeleniyor; 117 uygulamadan 39'u kategorisiz; arama sonucu boşken boş-durum mesajı yok; ilk tuş vuruşu kayboluyor; geçersiz `sortBy` sessizce varsayılana dönüyor.
15. **Webhook modalı:** URL anlık doğrulanmıyor; tooltip butonları örtüyor; `chat_ended` için `post_chat_survey` yerine `pre_chat_survey` sunuluyor. Olay ve payload eşlemesi sözleşmeden üretilmeli (nexa manifest yaklaşımı doğru).
16. **Deep link kırılması:** tam sayfa yüklemede `/install-code`'a yönlendirme var ve sekmeler arası senkron diğer sekmeleri de sürüklüyor. Onboarding kapısı derin linki ezmemeli.


---

# 04 — Ayarlar + Müşteri Widget'ı / Kanallar: LiveChat ↔ nexa (SiyahTuş) Boşluk Analizi

Kaynak: `report.md` §05 (satır 2046–2738, LiveChat Settings'in 26 menü öğesi), `nexa-ozellikler.md` (§1.10, §2, §4). Yöntem: Her "Yok" ve "Kısmi" kararı nexa kodunda Grep/Glob/Read ile kontrol edildi. Repoya salt okunur erişildi.
Kök dizin kısaltmaları: `web/` = `apps/web/src/`, `wdg/` = `apps/widget/src/`, `api/` = `apps/api/src/`, `types/` = `packages/types/src/`.

Durum: **Var** (eşdeğer veya daha iyi) · **Kısmi** · **Yok** · **Mock** (arayüzü var, sağlayıcı sahte)
Öncelik: **P0** = LiveChat rakibi için çekirdek, pilotu engeller · **P1** = önemli eşdeğerlik · **P2** = olsa iyi olur. Efor: **S** (≤1–2 gün) / **M** (≤1 hafta) / **L** (>1 hafta).

## 1. Özellik tablosu

### 1.1 Kanallar ve kurulum

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Kurulum snippet'i + "Copy code" | Var | **Var** | `web/features/settings/WebsiteWidgets.tsx` | — (snippet, panelde kaydedilen görünüm ayarlarını da içeriyor) | — | — |
| "Invite your developer" (e-posta) | Modal, rol seçimli | **Var** | `WebsiteWidgets.tsx` (geliştiriciyi e-postayla davet et) | — | — | — |
| Kurulum algılama (OFF/ON rozeti) | Kırmızı "!" + OFF | **Var** | `WebsiteWidgets.tsx` ("Waiting for first message", connected/ready) | — | — | — |
| GTM / WordPress / Shopify / WooCommerce / Wix vb. 15 kurulum yolu | Var (OAuth/eklenti) | **Yok** | `WebsiteWidgets.tsx:352-366` — `setup: 'manual' \| 'platform'` yalnız etiket; `api/services/websites/website-service.ts:30` | GTM topluluk şablonu + WordPress eklentisi (snippet'i `organizationId` ile basan), ardından Shopify app embed. `WEBSITE_SETUPS`'a platform kimliği eklenmeli | P1 | M |
| "Preview live" (barındırılan önizleme) | `cdn…/preview/<lic>` | **Kısmi** | `apps/widget/demo.html` var; panelden linkli değil. `WidgetCustomization.tsx:409` panel içi sahte önizleme | Panele "Test it out" → `chat.html?organization_id=` linki eklemek yeterli | P2 | S |
| Email kanalı | Ayrı ürün (HelpDesk deneme) | **Var** (önde) | `Channels.tsx:176-182, 338+` (`<orgId>@domain` yönlendirme, test mesajı); `api/services/channels/email-inbound.ts` | — Yerel e-posta→ticket | — | — |
| Facebook Messenger | OAuth (+$39 PRO) | **Mock** | `Channels.tsx:126, 1092-1097` (`MOCK_FACEBOOK_AUTH_CODE`); `api/services/channels/messenger.ts` | Gerçek Meta Graph OAuth + webhook doğrulama; adapter arayüzü (`channel-adapter.ts`) hazır | P1 | L |
| WhatsApp | Marketplace üzerinden | **Mock** | `Channels.tsx:1247+`, `api/services/channels/whatsapp.ts` | WhatsApp Cloud API adapter'ı; TR pazarında kritik | P1 | L |
| Apple Messages for Business | Business/Enterprise planı | **Yok** | `Channels.tsx` kanal listesi (website, chat-page, email, messenger, whatsapp, sms, instagram, telegram) — Apple yok | Apple MSP onayı gerekir; ertelenebilir | P2 | L |
| Chat page (barındırılan link) | Var | **Var** | `Channels.tsx:300-337` (`ChatPageLink`), `apps/widget/chat.html` | — | — | — |
| Chat page özelleştirme (sayfa başlığı ≤60, display name ≤40, logo, kalite bölümü) | Var | **Yok** | `apps/widget/chat.html:8` sabit `<title>Chat</title>`; ayar endpoint'i yok | `settings/widget`'a `chat_page_title`, `display_name` alanları ekle; `chat.html` mint yanıtından başlığı/logoyu uygulasın | P2 | S |
| Chat page QR kodu / X-Facebook paylaşım | Var (statik kartlar) | **Yok** | `Channels.tsx` ChatPageLink yalnız kopyala | İstemci tarafı QR (küçük kütüphane) + PNG indir | P2 | S |

### 1.2 Website widget › Customization (görünüm)

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Tema Light/Dark | Var | **Var** (+Auto) | `WidgetCustomization.tsx:217` `THEMES = auto/light/dark` | — | — | — |
| Ana renk (hex + seçici) | 9 hazır renk + özel | **Var** | `WidgetCustomization.tsx:221-265` (native color + hex, hata mesajlı) | Hazır renk paleti (swatch) yok — kozmetik | P2 | S |
| "More color settings" (bar metni, ikon, sohbet arka planı, müşteri/ajan balonu ve metin rengi, sistem mesajı) | 10 ayrı renk | **Yok** | `types/widget.ts:30-48` `WidgetAppearance` yalnız `primary_color` | `WidgetAppearance`'a opsiyonel renk alanları + `normalizeWidgetAppearance` doğrulaması + widget CSS değişkenleri | P2 | M |
| Opaklık (%) | Var | **Yok** | `WidgetAppearance` alanı yok | Düşük değer; gerekirse tek alan | P2 | S |
| Küçültülmüş pencere: Bubble / Bar | Var | **Yok** (yalnız balon) | `wdg/widget.ts` launcher yalnız balon; `minimized`/`bar` eşleşmesi yok | `launcher_style: 'bubble' \| 'bar'` + widget'ta bar render | P2 | M |
| Konum sağ/sol | Var | **Var** | `WidgetCustomization.tsx:216`; RTL'de aynalanıyor (`wdg/loader.ts:86-94`) | — | — | — |
| Kenar boşlukları (side/bottom spacing 0–100 px) | Var | **Yok** | `wdg/loader.ts:47` `FRAME_EDGE='0px'` sabit | `offset_x/offset_y` alanı, loader'da iframe konumuna uygula | P2 | S |
| Görünürlük: her zaman / etkinleşene kadar gizle / launcher'ı hep gizle | 3 mod | **Kısmi** | `wdg/loader.ts:52-56` `open()/close()/destroy()` JS API var; launcher gizleme modu yok | `visibility: 'always' \| 'hidden_until_active' \| 'never'`; loader launcher'ı gizlesin, `open()` gösterir | P1 | S |
| Mobilde göster/gizle + mobil için ayrı görünüm | Var | **Kısmi** | `WidgetCustomization.tsx:148` yalnız `mobile_fullscreen` | `show_on_mobile` bayrağı (loader `MOBILE_MAX_WIDTH` ile) | P2 | S |
| Logo göster / yükle | Var | **Kısmi** | `Brands.tsx:24` `logo_url` var ama `wdg/widget.ts`'te logo kullanımı yok | Marka `logo_url`'ünü token mint'inde (`WidgetTokenAppearance`) taşı, widget başlığında göster; yükleme için mevcut `uploads` deposu | P1 | S |
| Ajan fotoğrafını göster (toggle) | Var | **Kısmi** | `wdg/widget.ts` ajan avatarı/baş harfi her zaman; toggle yok | `show_agent_photo` bayrağı | P2 | S |
| Müşteriye ses bildirimleri | Var (toggle) | **Yok** | `wdg/widget.ts`'te `Audio`/sound yok | Yeni ajan mesajında kısa ses + panelde aç/kapa, widget'ta sessize alma | P2 | S |
| "Let customers rate agents" toggle | Var | **Kısmi** | Puanlama var (`wdg/widget.rating.test.ts`), kapatma ayarı yok (`rate_agents` grep boş) | `rating_enabled` bayrağı; widget menüsü ve kapanış CSAT'i buna bağlansın | P2 | S |
| "Let customers get chat transcripts" (müşteriye transcript e-postası) | Var | **Yok** | `wdg/locales/en.ts` transcript anahtarı yok; `nexa-ozellikler.md:693` "Bulunamadı" | Widget menüsüne "Transcript'i e-postala"; api'de `BackgroundMail` + `cc-mask` ile maskeli gönderim | P1 | M |
| White label ("Powered by" kaldır) | Plan kilitli | **Var** | `WidgetCustomization.tsx:155`, `api/lib/entitlements.ts:57,153` (`white_label`) | — | — | — |
| Canlı önizleme | Var | **Var** | `WidgetCustomization.tsx:409-493` | — | — | — |
| Sitede doğrudan özelleştirme (on-site editor) | NEW! | **Yok** | — | Sonraya | P2 | L |
| Marka bazlı farklı widget görünümü | Yok | **Var** (önde) | `WidgetCustomization.tsx:45-56` brandId'ye göre | — | — | — |

### 1.3 Website widget › Language / Availability / Welcome screen

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Widget dili seçimi (panelden) | 48 dilli aranabilir combobox | **Kısmi** | `wdg/loader.ts:27,301` yalnız snippet `language` parametresi; `WebsiteWidgets.tsx`'te dil seçimi yok; `wdg/i18n.ts` tarayıcı dili algılamıyor → varsayılan EN | `WidgetAppearance`'a `language` ekle, panelde seçici, mint'te uygula; yoksa `navigator.language`'a düş. TR pilotunda widget'ın İngilizce açılması doğrudan pilot sorunu | **P0** | S |
| Dil sayısı | 48 | **Kısmi** (8: en, tr, de, fr, es, it, pt, ar) | `wdg/locales/index.ts` | Talep olan dilleri `locales/*.ts` ile ekle (ru, nl, pl, ja, zh…) | P2 | M |
| Phrase özelleştirme: karşılama mesajı | Var | **Var** (başlık + metin, link) | `WidgetCustomization.tsx:347-400`; `types/widget.ts:50-51` (120/500 sınır) | — | — | — |
| Phrase: varsayılan müşteri adı, mesaj placeholder'ı | Var | **Yok** | `wdg/locales/en.ts:27` sabit `input.placeholder` | `phrases` haritası (dil başına override) mint'te; widget `t()` önce override'a baksın | P1 | M |
| Phrase: çevrimdışı bilgi metni | Var | **Yok** | `wdg/locales/en.ts:10,65` sabit | Aynı `phrases` mekanizması | P1 | (yukarıdakiyle) |
| Phrase: kuyruk metni (`%number%`, `%minutes%` değişkenli) | Var | **Kısmi** | `wdg/locales/en.ts:9` "You are number {n}…" sabit; tahmini bekleme süresi yok | Override + `{minutes}` için kuyruk tahmini (api chat-service) | P1 | M |
| Availability: "Always" vs "Only when agents accepting" | Açık ayar | **Kısmi** (örtük) | `wdg/widget.ts:1011-1019` `offlineFormOpen()` — çevrimdışı form yalnız ticket/prospect alanı tanımlıysa çıkar, yoksa sohbet açık kalır | Açık bir `availability_mode` ayarı; "only accepting" modunda offline formu yerleşik alanlarla zorla | P1 | S |
| Welcome screen (Home/Chat sekmeli ana ekran) + göster/gizle | Var | **Kısmi** | `wdg/widget.ts` greeting kartı ("Hi there 👋", `wdg/locales/en.ts:40-43`) sabit metin, ayarı yok | Greeting kartını `welcome_*` ayarına bağla + aç/kapa | P2 | S |
| Welcome screen başlık metni (≤50) | Var | **Kısmi** | `welcome_title` (≤120) karşılama balonunda, ayrı başlık değil | — | P2 | S |
| Custom links (yardım merkezi, toplantı, sosyal; ad ≤30) | Var | **Yok** | grep `custom.?links` boş | `widget_links[]` (label, url, `ssrf`/şema doğrulamalı) + greeting kartında liste | P2 | M |
| Widget içinde KB / WhatsApp kartı | KB "coming soon", WhatsApp marketplace | **Yok** | `nexa-ozellikler.md:690`; Public KB ayrı (`web/features/playbook/Kb*`) | Public KB arama kartı widget'a; nexa'nın KB'si zaten var — farklılaştırıcı olabilir | P1 | M |

### 1.4 Forms

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Pre-chat form aç/kapa | Var (toggle) | **Yok** — her zaman açık | `wdg/widget.ts:1123-1125` `needsPrechat()` ayara bakmıyor | `prechat_enabled` ayarı; kapalıyken doğrudan composer | **P0** | S |
| Pre-chat yerleşik alanların zorunluluğu (Name/Email "Required" seçimli) | Opsiyonel (varsayılan zorunlu değil) | **Kısmi** — ad, **kullanıcı adı**, e-posta, mesaj 4'ü de zorunlu, değiştirilemez | `wdg/widget.ts:1128-1138` ("All four fixed fields are required (owner, 2026-10-14)") | Yerleşik alanlar için göster/zorunlu bayrakları; "Username" alanı çoğu web sitesi için anlamsız, sürtünme yaratır | **P0** | S |
| Özel soru ekleme (pre/post/ticket/prospect) | Var | **Var** | `web/features/settings/ChatFormsSettings.tsx`; `wdg/widget.ts:1196-1206` | — | — | — |
| Alan tipi: Question (metin) | Var | **Var** | `types/custom-fields.ts:82` `text` | — | — | — |
| Alan tipi: number / yes-no / date | Yok | **Var** (önde) | `types/custom-fields.ts:82` | Tip doğrulamalı, kayda (contact/ticket) yazılıyor | — | — |
| Alan tipi: Choice list (radio), Dropdown, Multiple choice (checkbox) | Var | **Yok** | `CUSTOM_FIELD_TYPES = ['text','number','boolean','date']` | `select`, `multiselect` (+`radio` görünümü) tipleri; tanımlara `options[]` sütunu (`infra/db` migration + contract), widget `renderFormFields` | P1 | M |
| Alan tipi: Group selection (departman seç → takıma yönlendir) | Var | **Yok** | widget prechat'te grup/takım seçimi yok | `group_select` tipi; cevap `RoutingRules`'a girdi olsun | P1 | M |
| Information (metin bloğu) / Thank-you mesajı | Var | **Kısmi** | Sabit `prechat.intro`, `postchat.thanks` (`wdg/locales/en.ts:30,62`) | `info` tipi + metin override | P2 | S |
| Eleman sıralama (sürükle-bırak) | Var | **Yok** | `ChatFormsSettings.tsx` düz liste, sıra alanı yok | `position` sütunu + ok tuşlu sıralama (SkillEditor'daki kalıp) | P2 | S |
| Soru düzenleme (etiket/required değiştirme) | Var | **Yok** — yalnız ekle/sil | `ChatFormsSettings.tsx:85-88, 237-253` (yalnız delete) | `PATCH /settings/custom-fields/:id` UI'ı | P1 | S |
| Post-chat: Chat rating + yorum | Var (👍/👎 + yorum) | **Kısmi** | Puanlama good/bad var; yorum alanı yok (`wdg/widget.ts` "comment" grep boş) | Rating sonrası opsiyonel yorum textarea'sı + rapora yansıt | P1 | S |
| Pre-chat'i kampanya sonrası göster (toggle) | Var | **Yok** | — | Kampanya cevabında prechat atlama bayrağı | P2 | S |
| Ask for email — ajan X dk yanıt vermezse | Var (1–60 dk, mesaj + onay metni) | **Yok** | api'de yanıtsızlık zamanlayıcısı yok (grep `no_response/unanswered` ilgisiz) | `chat-timeout` sweeper kalıbıyla "ilk yanıt gecikti" sweep'i → widget'a sistem mesajı + e-posta isteme | P1 | M |
| Ask for email — çevrimdışıyken | Var | **Kısmi** | Offline form e-posta alıyor (`wdg/locales/en.ts:64-72`) ama yalnız ticket/prospect alanı tanımlıysa görünür (`widget.ts:1011-1019`) | Offline'da her zaman e-posta iste (yerleşik), alan şartını kaldır | P1 | S |
| Ticket form (çevrimdışı → ticket) | HelpDesk'e bağlı | **Var** (önde — yerleşik HelpDesk) | `ChatFormsSettings.tsx:273-278` `ticket`/`prospect`; `wdg/widget.ts:2190+` | — | — | — |

### 1.5 Engagement, Tags, Sales tracker

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Eye-catcher (görsel, 119'luk galeri, sürüklenebilir konum, yalnız masaüstü) | Var | **Yok** | grep `eye.?catcher` boş; benzer: greeting kartı + kampanyalar | `eye_catcher {enabled, image_url, offset}` + launcher üstünde görsel; galeri yerine birkaç hazır SVG | P2 | M |
| Chat buttons (görsel/metin, online/offline durumlu, kod üret) | Var | **Kısmi** | grep `chat.?button` boş; `wdg/loader.ts:52-56` `siyahtus.open()` JS API var | Panelde "buton kodu" üretici: `<a onclick="siyahtus.open()">` + online/offline metni (presence zaten widget'ta, `widget.ts:453-457`) | P2 | S |
| Quality page / quality badge (public CSAT sayfası) | Var | **Yok** | grep `quality.?(badge\|page)` boş | Paylaşılan rapor altyapısı (`web/features/reports/SharedReportPage.tsx`) üzerine halka açık CSAT sayfası | P2 | M |
| Tags: oluştur / sil | Var | **Var** | `web/features/settings/Tags.tsx:86,254` | — | — | — |
| Tags: kullanım sayısı, takıma özel | Yok | **Var** (önde) | `Tags.tsx:15,39,90-92` | — | — | — |
| Tags: yeniden adlandırma | Yok | **Kısmi** | `Tags.tsx:92` PATCH yalnız `group_ids` | Rename eklemek ucuz (LiveChat'te de yok) | P2 | S |
| "Remind agents to tag" | Var | **Yok** | grep `remind.*tag` boş | Arşivlerken etiketsizse Composer/Details'te uyarı + ayar | P2 | S |
| Tag → Reports / Archives kısayolu | Var | **Kısmi** | Raporlarda "Top tags" var; arşivde etiket filtresi yok (`nexa-ozellikler.md:740`) | Tag satırına rapor linki | P2 | S |
| Sales tracker: dinamik değer + sipariş no | Var | **Var** | `wdg/widget.ts:1259-1275` `trackSale`; `types/sales-tracker.ts:71-83` (`external_order_id` UNIQUE) | — | — | — |
| Sales tracker: para birimi, dönüşüm penceresi (gün) | Var | **Var** (doğrulamalı) | `web/features/settings/SalesTracker.tsx:36-45`, `types/sales-tracker.ts:20` | — | — | — |
| Sales tracker: birden çok adlandırılmış tracker, Fixed / Non-monetary değer | Var | **Yok** (tek, workspace geneli) | `SalesTracker.tsx` tekil ayar formu | `sales_trackers` tablosu (ad, tip fixed/dynamic/none, sabit tutar); `trackSale({tracker})` | P2 | M |

### 1.6 Chat settings

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Otomatik atama (eşit dağıtım, limit, kuyruk) | Var | **Var** (önde: kural/skill/SLA) | `web/features/settings/RoutingRules.tsx`, `Skills.tsx`, Team chat limit | — | — | — |
| Manuel seçim (herkese bildirim, ilk alan alır) | Var | **Yok** | grep `routing_mode/manual_selection` boş | `assignment_mode: 'auto' \| 'manual'`; manualde kuyruk "Queued" görünümünden "Take" ile alınsın (Inbox'ta Take over zaten var) | P1 | M |
| Transcript forwarding (tüm transcript'leri e-postaya) | Var (trial'da 1 adres) | **Yok** | grep `transcript.?forward` boş | Sohbet kapanınca `BackgroundMail` ile alıcı listesine maskeli transcript; `ScheduledExports` alıcı UI'ı kalıp | P1 | S |
| File sharing aç/kapa | Agents / Visitors ayrı | **Kısmi** | `web/features/settings/FileSharing.tsx:25` tek `file_sharing_enabled` | `agent_file_sharing`, `visitor_file_sharing` ayrımı | P2 | S |
| File sharing: MIME izin listesi + maks. boyut | Yok | **Var** (önde) | `FileSharing.tsx:26-27, 168-185` | — | — | — |
| İnaktivite: ajan X dk yanıt vermezse başka ajana aktar | Var (3 dk) | **Yok** | `api/services/chat/chat-timeout.ts` yalnız kapatma; aktarma sweep'i yok | `chat-timeout-run.ts` kalıbında "ilk yanıt yok → yeniden ata" sweep'i; mevcut transfer (`routes/chats.ts:93` `TRANSFER_REASONS`) kullanılsın | **P0** | M |
| İnaktivite: X dk mesaj yoksa sohbeti "inactive" yap (limit dışı) | Var (10 dk) | **Yok** | Sohbet durumunda inactive yok | `inactive` bayrağı + eşzamanlı limit hesabından çıkar | P1 | M |
| İnaktivite: X dk mesaj yoksa sohbeti kapat | Var (1–60 dk) | **Var** (1 dk–30 gün, dk/saat) | `web/features/settings/ChatTimeout.tsx:1-41`, `api/services/chat/chat-timeout.ts` | — | — | — |

### 1.7 Security

| Özellik | LiveChat | nexa durumu | Kanıt (dosya) | Eksik detayı + uygulama ipucu | Öncelik | Efor |
|---|---|---|---|---|---|---|
| Trusted domains (alt alan adlarını kapsar) | Var | **Var** | `web/features/settings/TrustedDomains.tsx`; `api/routes/settings.ts:921-1005` (audit'li) | — | — | — |
| Detected domains sekmesi | Var | **Kısmi** | `WebsiteWidgets.tsx` bağlantı durumu var; widget'ın göründüğü (onaysız) alan adları listelenmiyor | Mint'te `Origin`/referrer'ı kaydet, "algılanan" listesi + tek tıkla güven | P2 | S |
| Banned customers (IP) | Var | **Var** (IPv4/IPv6 doğrulamalı) | `BannedCustomerIps.tsx`; `api/routes/settings.ts:496-502` + `api/lib/banned-ip.ts` | — | — | — |
| Ban süresi (1 gün … 3 yıl) | Var | **Yok** (kalıcı) | `banned_customer_ips: string[]` (`FileSharing.tsx:24`) | `{ip, expires_at}` yapısı + sweep | P2 | S |
| Kişi bazlı ban (contact) + GDPR silme | Yok (IP) | **Var** (önde) | `web/features/customers/CustomerDetailPanel.tsx:10,36` | — | — | — |
| Kredi kartı maskeleme | Göster/maskele seçimi (görüntüleme) | **Var** (önde — yazma anında, DB+log, Luhn'lu, her zaman açık) | `api/lib/cc-mask.ts`; kullanım `routes/chats.ts:13`, `routes/customer.ts:28`, `channel-service.ts:37`, `email-inbound.ts:25` | "Göster" seçeneği bilinçli olarak yok (PCI SAQ A) | — | — |
| Login settings: e-posta/şifre, 2FA, Custom SSO | Dış panelde | **Var** (önde: SAML+SCIM, 2FA zorunlu kılma) | `SsoConnection.tsx`, `TwoFactor.tsx`, `IpAllowlist.tsx` | — | — | — |
| Login: Google ile giriş | Var | **Yok** | `web/features/auth/*`, `api/routes/auth.ts`'de "google" yok | OIDC sağlayıcısı olarak Google (SSO altyapısı PKCE'li hazır) | P2 | M |

## 2. Sayım

| Durum | Adet |
|---|---|
| Var | 28 (10'u nexa'nın önde olduğu satır) |
| Kısmi | 21 |
| Yok | 32 |
| Mock | 2 |
| **Toplam satır** | **83** |

| Öncelik (55 boşluk: Kısmi + Yok + Mock) | Adet |
|---|---|
| P0 | 4 (2 Kısmi, 2 Yok) |
| P1 | 20 (6 Kısmi, 12 Yok, 2 Mock) |
| P2 | 31 (13 Kısmi, 18 Yok) |

(Not: "Ana renk" satırı Var sayıldı; yalnız hazır renk paleti eksikliği için kozmetik bir P2 notu taşıyor. "Phrase: çevrimdışı bilgi metni"nin eforu placeholder satırına dahil edildi.)

### En kritik 5 boşluk
1. **Pre-chat formu kapatılamıyor ve 4 yerleşik alanın hepsi (Username dahil) zorunlu** (P0/S). `wdg/widget.ts:1123-1138`. LiveChat'te form kapatılabiliyor, Name/Email varsayılanda opsiyonel. Her ziyaretçide sürtünme yaratıp dönüşümü düşürür.
2. **Widget dili panelden seçilemiyor, tarayıcı dili de algılanmıyor** (P0/S). `wdg/loader.ts:27`, `wdg/i18n.ts`. Snippet elle düzenlenmezse TR pilotunda widget İngilizce açılır.
3. **Ajan yanıt vermezse başka ajana aktarma yok** (P0/M). Yalnız otomatik kapatma var (`api/services/chat/chat-timeout.ts`). Yanıtsız kalan müşteri kaybolur; LiveChat'te varsayılan olarak açık (3 dk).
4. **Form alan tipleri yetersiz: seçim listesi / dropdown / çoklu seçim / departman seçimi yok** (P1/M). `types/custom-fields.ts:82`. Departman seçimiyle yönlendirme LiveChat'in temel pre-chat kullanımı.
5. **Phrase özelleştirmesi (çevrimdışı, kuyruk, placeholder) ve transcript e-postası (müşteriye ve forwarding) yok** (P1/M). `wdg/locales/en.ts` sabit metinler.
   Yakın aday: **Messenger ve WhatsApp mock** (P1/L).

## 3. nexa'nın önde olduğu yerler

- **Kurumsal kimlik**: SAML 2.0 SSO (doğrulanmış alan adı, IdP-initiated, SSO zorunlu) + **SCIM** token'ları (`SsoConnection.tsx`). LiveChat'te bunlar uygulama dışında, accounts panelinde.
- **Workspace genelinde 2FA zorunluluğu**, **IP/CIDR izin listesi** ve oturum politikası (boşta kalma zaman aşımı, eşzamanlı oturum sınırı) (`IpAllowlist.tsx`).
- **Denetim günlüğü** (hash zinciri, Access review CSV), **SIEM dışa aktarma**, **veri saklama** (30/60/365/sınırsız), **HIPAA BAA**, **EU/US veri bölgesi** (`features/audit/*`, `SiemExport.tsx`, `DataRetention.tsx`, `Compliance.tsx`).
- **Kart maskeleme yazma anında yapılıyor**: Luhn kontrollü, DB'de, loglarda, e-postada, AI girdisinde (`api/lib/cc-mask.ts`). LiveChat'inki görüntüleme seçeneği; nexa'da ham PAN hiç saklanmıyor.
- **Dosya paylaşımında MIME izin listesi ve maks. boyut** (`FileSharing.tsx`). Ayrıca `spam_filter_enabled` güvenlik ayarı var.
- **Yerleşik HelpDesk ve e-posta kanalı**: e-posta→ticket, ticket formu, ticket kuralları, markalı e-posta şablonları. LiveChat'te bunlar ayrı ürün/deneme (HelpDesk).
- **Canlı Telegram kanalı**; SMS ve Instagram adapter iskeletleri (mock).
- **Çoklu marka**: markaya göre ayrı widget görünümü (`WidgetCustomization.tsx:45-56`, `Brands.tsx`).
- **Widget**: Auto tema (OS'a uyar), Arapça RTL ve aynalanan konum, sandbox'lı cross-origin iframe ve beyaz listeli postMessage, kampanya kartı, okunmamış rozeti.
- **Form cevapları tip doğrulamalı** (number/boolean/date) ve doğrudan contact/ticket kaydına yazılıyor. Ayrı bir form deposu yok, CRM'de görünür.
- **Etiketler**: takıma özel kapsam ve kullanım sayısı.
- **Yönlendirme**: sıralı routing kuralları, skill tabanlı yönlendirme, SLA politikası, ticket kuralları. LiveChat Settings'teki iki radyo seçeneğinden çok daha zengin.
- **Sohbet zaman aşımı** 1 dk–30 gün arası, dakika/saat birimiyle (LiveChat'te en fazla 60 dk).
- **Settings araması** (etiket + anahtar kelime), Sandbox, PAT, MCP, planlı rapor dışa aktarma.

## 4. LiveChat hatalarından dersler (nexa'da tekrarlanıyor mu?)

| LiveChat hatası | nexa'da durum | Kanıt / öneri |
|---|---|---|
| **Sessiz değer düzeltme**: opacity 250→2%, 9999→60, -50→050, geçersiz hex mesajsız reddediliyor | **Tekrarlanmıyor** | `ChatTimeout.tsx`, `FileSharing.tsx:68,185`, `SalesTracker.tsx:36-45` doğrulayıcılar açık hata mesajı veriyor; hex hatası `WidgetCustomization.tsx:258-262` `role="alert"` ile gösteriliyor. Yeni sayı alanlarında (spacing, inaktivite) aynı `useForm` + `Validator` kalıbı korunmalı. |
| **Kaydedilmemiş değişiklik koruması tutarsız** (bazı sayfalarda modal var, bazılarında yok) | **Tekrarlanıyor (daha kötü)** | `lib/dirty-guard.tsx` içindeki `useLeaveGuard` yalnız `playbook/SkillEditor.tsx:279`'da kullanılıyor. Hiçbir Settings bölümü (WidgetCustomization, ChatTimeout, FileSharing, SalesTracker…) kendini kaydetmiyor. `SettingsNav.tsx:181-229` `NavLink`'leri `confirmLeave` çağırmıyor. Bölüm değiştirince taslak sessizce siliniyor. Öneri: her ayar formunda `useLeaveGuard(shouldWarnOnLeave(dirty, saving))`, SettingsNav'da `confirmLeave()`. Efor S. |
| **Language combobox'ta Enter → native GET submit**, form değerleri URL'ye sızıyor | **Tekrarlanmıyor** | `lib/form.ts:266-267` `handleSubmit` `preventDefault` çağırıyor; `WidgetCustomization.tsx:111-112` de öyle. Settings araması Enter'ı kendisi işliyor (`SettingsNav.tsx:111`). Yeni dil seçici eklenirken combobox bir `<form>` içine konmamalı ya da Enter `preventDefault` edilmeli. |
| **Bayat sayfa başlığı ve aktif menü** (route değişince güncellenmiyor) | Büyük olasılıkla tekrarlanmıyor | `SettingsPage.header.test.tsx` başlık-route senkronunu test ediyor; `NavLink` aktif durumu route'tan geliyor. |
| **Kaydetme kalıpları karışık** (sticky çubuk / satır içi / anlık kayıt) | **Kısmen tekrarlanıyor** | Çoğu bölüm kendi Save butonunu kullanıyor, ama `Tags.tsx:90-92` takım kapsamı checkbox'ı anında PATCH ediyor. Anlık kaydeden kontroller görsel olarak ayrılmalı ya da toast ile onaylanmalı. |
| **Mantıksal tutarsızlığın kabulü** (Inactive 60 > Close 15) | Şimdilik geçerli değil | nexa'da tek zaman aşımı var. "Aktarma / inactive / kapat" eklenirken sıralama `transfer < inactive < close` olarak doğrulanmalı. |
| **Validasyon boşlukları** (negatif satış değeri, geçersiz IP'nin canlı doğrulanmaması, boş zorunlu alan) | **Çoğunlukla tekrarlanmıyor** | IP sunucuda `isIP` ile doğrulanıyor (`api/routes/settings.ts:496-502`). İstemcide canlı IP doğrulaması yok (`BannedCustomerIps.tsx:62`, yalnız submit'te), bu küçük bir UX iyileştirmesi. Karşılama alanlarında `maxLength` var (`types/widget.ts:50-51`). |
| **Uzunluk sınırında hatalı hata** (tam 50 karakterde "cannot be longer than 50" ve Save etkin kalıyor) | Tekrarlanmıyor | `maxLength` girişte zorlanıyor, ayrıca bir hata durumu yok. |
| **Sınırsız seçenek sayısı ve uzunluk sınırı olmayan metin** | Kısmen geçerli değil | Seçenekli alan tipi henüz yok. Eklenirken `options` için üst sınır (örn. 50) ve etiket uzunluğu sınırı konmalı. |
