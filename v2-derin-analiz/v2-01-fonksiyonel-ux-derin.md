# ARAŞTIRMA 2 — text.com/app UX VE HİZMET TASARIMI DERİNLEMESİNE ANALİZİ

> **Hedef sistem:** `https://www.text.com/app` (Text, Inc. — eski adıyla LiveChat Software'in birleşik AI müşteri-destek uygulaması)
> **Rapor tipi:** Kıdemli UX Araştırmacısı / Hizmet Tasarımcısı gözüyle derinlemesine deneyim analizi
> **Derleme tarihi:** 20 Temmuz 2026
> **İlişkili raporlar:** `01-fonksiyonel-analiz.md` (modül/ekran envanteri, MOD-X.Y.Z referansları), `02-teknik-mimari.md`, `research/02-product-pricing-features.md`
> **Kanıt tabanı:** Oturumu açık, 8 günlük deneme aşamasındaki gerçek bir Growth-planı hesabı (rol: Admin, hesap sahibi: Owner "Can"), 17 ekran görüntüsü (`gorseller/`), gerçek DOM/rota gözlemleri.

Bu rapor, önceki fonksiyonel envanterin (MOD-X.Y.Z) **tekrarı değil**, aynı üründe **farklı bir merceğe** — kullanıcı psikolojisi, akış sürtünmesi, duygu durumu, bilgi mimarisi ve erişilebilirlik — odaklanan ikinci bir okumadır. Modül numaralarına yalnızca çapraz referans amacıyla değinilir.

---

## İÇİNDEKİLER

1. [Persona ve Roller](#1-persona-ve-roller)
2. [Uçtan Uca Kullanıcı Yolculukları](#2-uçtan-uca-kullanıcı-yolculukları)
   - [2.a Onboarding → Widget Kurulumu → İlk Canlı Sohbet](#2a-onboarding--widget-kurulumu--i̇lk-canlı-sohbet)
   - [2.b AI Agent Kurulumu](#2b-ai-agent-kurulumu-persona--knowledge--skill--yayına-alma)
   - [2.c Ekip Daveti + Rol Atama](#2c-ekip-daveti--rol-atama)
   - [2.d Sohbetin Bilete Dönüşmesi + Çözüm](#2d-bir-sohbetin-bilete-dönüşmesi--çözüm)
   - [2.e Rapor İnceleme](#2e-rapor-i̇nceleme)
3. [Jobs-to-be-Done (JTBD) Analizi](#3-jobs-to-be-done-jtbd-analizi)
4. [Kullanılabilirlik Denetimi — Nielsen 10 Heuristik](#4-kullanılabilirlik-denetimi--nielsen-10-heuristik)
5. [Bilgi Mimarisi ve Navigasyon Değerlendirmesi](#5-bilgi-mimarisi-ve-navigasyon-değerlendirmesi)
6. [Boş / Yükleme / Hata / RBAC Durumları — UX Kalitesi](#6-boş--yükleme--hata--rbac-durumları--ux-kalitesi)
7. [Erişilebilirlik (WCAG 2.2) Gözlemleri](#7-erişilebilirlik-wcag-22-gözlemleri)
8. [Mikro-Etkileşim Eleştirisi](#8-mikro-etkileşim-eleştirisi)
9. [UX Zayıflıkları + Önceliklendirilmiş İyileştirme Önerileri](#9-ux-zayıflıkları--önceliklendirilmiş-i̇yileştirme-önerileri)
10. [Klon İçin UX/Servis Tasarımı İlkeleri](#10-klon-i̇çin-uxservis-tasarımı-i̇lkeleri-ve-öneri-niteliğinde-tasarım-kararları)

---

## 1. Persona ve Roller

text.com/app'te dört fiili "aktör" vardır: üç insan rolü (Owner, Admin, Member/Agent) ve bir yapay aktör (AI Agent + Copilot). Rollerin sistemde nasıl davrandığı yalnızca izin matrisleriyle değil, **arayüzün kendilerine ne gösterip ne gizlediğiyle** de tanımlanır — bu, RBAC'ın (rol tabanlı erişim kontrolü) bir UX kararı olduğunun kanıtıdır (bkz. `gorseller/mod-07-team-teams-no-access.png`).

### 1.1 Owner (Hesap Sahibi) — gözlemde "Can"
- **Kim:** Aboneliği açan, faturayı ödeyen, hesabı yasal olarak "sahiplenen" tek kişi. Sistemde **tek** olabilir, devredilebilir ama davetle **atanamaz** (yalnızca mevcut bir Admin'e devredilir).
- **Hedefleri:** İşin büyümesini kanıtlamak (ROI), maliyeti kontrol altında tutmak (kullanım/kota), riski yönetmek (güvenlik, uyumluluk), ekibi ölçeklendirmek.
- **Zihinsel model:** "Bu benim işim, bu araç bana para kazandırmalı." Reports ve Billing ekranlarına en sık bakan kişi.
- **Gözlemlenen kanıt:** `gorseller/mod-07-team-teammates.png` içinde "Can — Owner — Accepting chats" satırı; aynı zamanda hâlâ sohbet kabul eden aktif bir temsilci — küçük ekiplerde Owner'ın hem yönetici hem uygulayıcı olduğunu gösterir.

### 1.2 Admin (Yönetici) — gözlemde "Calendertasker (You)"
- **Kim:** Faturaya erişimi olan, ekibi ve yapılandırmayı yöneten ama hesabı "sahiplenmeyen" kişi. Davetle atanabilen en yüksek roldür (`gorseller/mod-07-team-invite-modal.png` — "Admin (billing access)").
- **Hedefleri:** Günlük operasyonu ayakta tutmak (routing, kanal, AI Agent yapılandırması), ekip performansını izlemek, güvenlik/uyumluluk ayarlarını yönetmek.
- **Gözlemlenen çelişki:** Aynı Admin rolü `/app/team/teams` rotasında **erişim reddi** aldı (MOD-7.4) — yani "Admin" etiketi tek bir yetki seviyesi değil, **granüler** bir izin kümesidir; kullanıcı arayüzdeki rozet ile gerçek yetkisi arasında fark olabileceğini öğrenir. Bu, kurumsal beklenti ile fiili deneyim arasında küçük bir güven kırılmasıdır.

### 1.3 Member / Agent (Temsilci)
- **Kim:** Faturaya erişimi olmayan, günlük sohbet/bilet trafiğini yürüten kişi ("Member (no billing access)").
- **Hedefleri:** Hızlı yanıt vermek, doğru bilgiye ulaşmak (canned response, AI önerisi), iş yükünü (eşzamanlı sohbet limiti — örnekte "6 concurrent chats limit") yönetilebilir tutmak, ölçülüyor olmanın (Reports → Team performance) baskısı altında iyi görünmek.
- **Duygusal katman:** Bu persona için arayüzün **hızı ve az-tıklamalı** olması kritik — her saniye müşteri bekliyor. Composer'daki `#` canned response ve `Space` ile reply suggestion tam bu ihtiyacı hedefler (MOD-4.4.2/3).

### 1.4 AI Agent — "dördüncü persona"
- **Kim:** Sistemin insan olmayan ama kendi profili, statüsü ("Not accepting chats" / "AI Agent is off"), performans panosu ve hatta ekip listesinde bir satırı olan **kurumsal bir aktör**. `gorseller/mod-06-ai-agent-profile.png` ekranı bunu açıkça gösteriyor: Name, Status, Instructions, Language, Tone of voice, Answer length — bir insan temsilci profiliyle neredeyse birebir aynı alan seti.
- **Servis tasarımı açısından önemi:** Text, AI Agent'ı bir "özellik" değil bir **ekip üyesi metaforu** olarak konumlandırmış. Bu, kullanıcının zihinsel modelini "bir bot ayarlıyorum"dan "yeni bir çalışan işe alıyorum ve eğitiyorum"a kaydırır — persona tanımı (rol ve kimlik), talimat (instructions), ton (tone of voice) ve deneme alanı (playground) bu metaforu destekler.
- **Copilot (temsilci-tarafı AI):** Ayrı bir "beşinci aktör" gibi davranır — müşteriye değil temsilciye hizmet eder; Team → AI Agents altında AI Agent'ın yanında ayrı bir satırdır. Bu konumlandırma, "müşteriye bakan AI" ile "çalışana bakan AI"yı aynı navigasyon grubunda ama farklı kimliklerle ayırması bakımından zekicedir, ancak isimlendirme (ikisi de "Team" altında, ikisi de "AI Agents" grubunda) ilk bakışta kafa karıştırıcıdır (bkz. §5).

### 1.5 Persona Karşılaştırma Tablosu

| Boyut | Owner | Admin | Member/Agent | AI Agent |
|---|---|---|---|---|
| Birincil ekran | Billing, Reports | Settings, Team, Reports | Inbox (Chats/Tickets) | Playbook, Profile, Knowledge |
| Başarı ölçütü | Gelir/ROI | Operasyonel istikrar | Yanıt hızı, CSAT | Resolution rate, transfer oranı |
| Bilişsel yük kaynağı | Kota/kullanım takibi | Çok sekmeli Settings mimarisi | Çoklu sohbet + araç çubuğu | Talimat metni uzunluğu (10.000 karakter) |
| Duygusal risk | "Deneme bitiyor" kaygısı | "Bunu ben mi bozdum" kaygısı | "Müşteriyi bekletiyorum" kaygısı | Yok (ama hata halinde marka riski insana devredilir) |

---

## 2. Uçtan Uca Kullanıcı Yolculukları

### 2.a Onboarding → Widget Kurulumu → İlk Canlı Sohbet

| # | Adım | Kullanıcı Amacı | Sistemin Cevabı | Sürtünme Noktası | Duygu Durumu |
|---|---|---|---|---|---|
| 1 | Kayıt (`Sign up free`) | Hızlıca denemeye başlamak | 3 adımlı form (e-posta/ad/şifre) veya Google/Apple/Microsoft tek-tık | E-posta doğrulama zorunlu adımı akışı böler | Umutlu ama sabırsız |
| 2 | İlk giriş, `/app` yönlendirmesi | "Ürünü görmek" | Boş hesap yerine **örnek veri** ile karşılanır (Example Customer sohbeti, 13 hazır Knowledge kaynağı) | Yok — bilinçli olarak "boş durum" tamamen atlanmış | Rahat, "demo oynuyorum" hissi |
| 3 | Örnek sohbet üzerindeki mavi kart | Ne yapacağını anlamak | "See how you can qualify a lead… Take tour" CTA'sı | Kart, gerçek sohbet penceresinin **üstüne** biner; ilk saniyede hangisinin gerçek/hangisinin demo olduğu belirsiz | Hafif belirsizlik |
| 4 | Widget'ı siteye kurmak (`Settings → Channels → Website widget → Manage`) | Gerçek trafiği bağlamak | Üç yol: Add website / Install code manually / Invite a developer (`gorseller/mod-10-settings-website-widgets.png`) | "Invite a developer" seçeneği, kurulumun teknik bilgi gerektirdiğini itiraf ediyor — pazarlamadaki "3 dakikada kurulum" vaadiyle hafif çelişir | Teknik olmayan Owner için endişe, geliştirici varsa rahatlama |
| 5 | Kod parçasını yapıştırma | Widget'ın siteye "canlı" bağlanması | `Connected` rozeti ve tablo satırı anlık günceller (localhost/gerçek domain) | Kurulumun **doğrulandığını** gösteren anlık bir "test message" / "ping received" geri bildirimi gözlenmedi — kullanıcı "gerçekten çalışıyor mu?" diye emin olmak için siteyi ayrı sekmede açıp test etmek zorunda | Belirsizlik → doğrulama sonrası rahatlama |
| 6 | İlk gerçek ziyaretçi geldiğinde | Fark etmek ve yanıtlamak | Üst şeritte "Turn on notifications" daveti + Inbox'ta sayaç anlık artışı (WS) | Tarayıcı bildirimi **varsayılan kapalı**; kullanıcı sekmeyi kapatırsa ilk canlı sohbeti kaçırabilir | Kaçırma korkusu (FOMO) |
| 7 | İlk mesajı yanıtlama | Hızlı ve doğru yanıt | Composer'da `Space` ile Reply Suggestion, `#` ile canned response | Message/Note ayrımı ilk kullanımda net değil (dropdown küçük, "Message ▾" etiketi düşük görünürlükte) | Kontrol hissi (AI desteğiyle) |

**Genel değerlendirme:** Onboarding, klasik "boş sayfa + checklist" modelinden bilinçli olarak kaçınıp **"tohum verili keşif"** (product-led growth) modelini seçmiş. Bu, zaman-to-value açısından güçlü bir karardır ama gerçek kurulumun (kod yapıştırma, doğrulama) teknik sürtünmesini gizlemez — yalnızca ertelemiş olur.

### 2.b AI Agent Kurulumu (Persona + Knowledge + Skill + Yayına Alma)

Bu, üründeki en karmaşık ve en yüksek değerli yolculuktur; dört sekme arasında geçiş gerektirir: **Profile → Knowledge → Skills → (yayına alma) Turn on AI Agent**.

| # | Adım | Kullanıcı Amacı | Sistemin Cevabı | Sürtünme Noktası | Duygu Durumu |
|---|---|---|---|---|---|
| 1 | `Team → AI Agents → AI agent → Profile` | Ajanın kim olduğunu tanımlamak | Sarı uyarı bandı: "AI Agent is off. Turn it on to handle chats automatically." (`gorseller/mod-06-ai-agent-profile.png`) | Uyarı, sayfaya girer girmez göze çarpıyor ama **"önce Knowledge'ı doldur, sonra aç"** gibi bir sıralama önerisi yok — acemi kullanıcı hemen "Turn on" diyebilir ve boş bilgiyle ajanı canlıya alabilir | Aciliyet (belki erken) |
| 2 | Instructions alanını doldurma | Ajanın rolünü/kimliğini tanımlamak | Serbest metin, ~10.000 karakter sınırı, "Edit instructions" kalem ikonuyla düzenleme | Boş bir textarea + placeholder örneği dışında **şablon/sihirbaz yok**; sıfırdan iyi bir prompt yazmak deneyimsiz kullanıcı için yüksek bilişsel yük | Yazarlık kaygısı ("ne yazacağımı bilmiyorum") |
| 3 | Language / Tone / Answer length ayarları | Markaya uygun ses tonu | Üç dropdown, sonuç sağdaki Preview panelinde **anında** test edilebilir | Preview, kaydedilmemiş değişikliği mi yoksa son kaydedileni mi yansıtıyor belli değil (canlı otomatik-kaydetme mi, manuel mi, arayüzde net bir "Saved"/"Unsaved changes" göstergesi gözlenmedi) | Deneysel, "oynayarak öğrenme" |
| 4 | `Knowledge (13)` sekmesine geçiş | Ajanı "beslemek" | 4 kaynak tipi (Website/File/Article/FAQ), tablo halinde liste (`gorseller/mod-06-ai-agent-knowledge-sources.png`) | 13 örnek makale önceden yüklü (demo verisi) — gerçek kullanıcı kendi 13 makalesini tek tek eklemek zorunda; **toplu içe aktarma (bulk import/CSV)** arayüzde görünmüyor | Örnek veriyle güven, gerçek veri girerken yorgunluk riski |
| 5 | `Skills` sekmesi / Playbook'tan skill oluşturma | Ajana yeni bir davranış eklemek | `Create skill ▾` → "For AI Agent" (doğal dille) vs "For your workspace" (görsel akış) (`gorseller/mod-06-playbook-skills-list.png`) | İki modun **ne zaman hangisinin kullanılacağı** net değil; "Withdrawal Issue Escalation" gibi adım-tabanlı bir skill hem NL açıklamasıyla hem yapılandırılmış adım kartlarıyla temsil ediliyor — kullanıcı hangisini önce düzenleyeceğini kestiremeyebilir | Hafif kafa karışıklığı, ama editör açıldığında (bkz. adım 6) netleşiyor |
| 6 | Custom Skill Editor'de adımları düzenleme | Skill'in mantığını doğrulamak | Sol: adım akordeonu (6 adım), sağ: **canlı Preview sohbeti** (`gorseller/mod-06-ai-agent-custom-skill-editor.png`) | Preview görsel olarak çok güçlü — "adım yürütülüyor" mesajları (italik gri metin: "Collected username and transaction date…") kullanıcıya AI'ın **neden** o cevabı verdiğini gösteriyor (şeffaflık). Zayıf yön: adımların **sırasını değiştirmek** için sürükle-bırak olup olmadığı görsel olarak belirsiz (tutamaç ikonu yok) | Güven artışı (şeffaflık sayesinde) |
| 7 | `Skill active` toggle + `Save changes` | Skill'i canlıya almak | Üstte "1 run" sayacı, toggle, Save butonu tek satırda | Save butonu **pasif/aktif** durumu (değişiklik olmadan tıklanabilir mi) net değil; "kaydedilmedi" uyarısı sayfa terk edilirken görülmedi (gözlem sınırı, ama risk olarak not edilmeli) | Nötr |
| 8 | Profile'a dönüp `Turn on AI Agent` | Ajanı canlıya almak | Buton tıklanınca (tetiklenmedi, arayüz düzeyinde gözlem) ajan durumu "Not accepting chats" → "Accepting" değişmesi beklenir | Ajanı **açmadan önce** bir "hazır mısın?" kontrol listesi (Knowledge doluluğu, en az 1 skill, ton seçili mi) yok — kullanıcı erken yayına alabilir | Kararsızlık ("hazır mıyım emin değilim") |

**Genel değerlendirme:** Bu yolculuk, ürünün en "ürün-öncüsü" (product-led) ve en yenilikçi kısmı; **canlı Preview** hem Profile hem Skill editöründe tekrarlanan güçlü bir desen. Ancak "hazır olma" durumunun doğrulanması (readiness check) eksik — kullanıcı yarım yapılandırmayla canlıya çıkabilir, bu da müşteri karşısında zayıf bir AI Agent deneyimine yol açabilir.

### 2.c Ekip Daveti + Rol Atama

| # | Adım | Kullanıcı Amacı | Sistemin Cevabı | Sürtünme Noktası | Duygu Durumu |
|---|---|---|---|---|---|
| 1 | `Team → Teammates → + Invite teammates` | Yeni bir kullanıcı eklemek | Modal açılır: e-posta alanı + Role dropdown (`gorseller/mod-07-team-invite-modal.png`) | Modal'da rol açıklaması parantez içinde küçük harfle: "Admin (billing access)" — fatura erişiminin ne anlama geldiği (maliyeti görebilme mi, ödeme yapabilme mi) açılmadan anlaşılmıyor | Nötr, hafif belirsizlik |
| 2 | E-posta girmeden Invite'a basmak (gözlemlenen gerçek hata) | — | Kırmızı satır-içi hata: "At least one email required" | Hata mesajı doğru ama **hangi alanın** hatalı olduğunu (kırmızı çerçeve) görsel olarak vurgulaması dışında ek yönlendirme yok; çoklu e-posta girişinde format hatası (geçersiz e-posta) için ayrı bir doğrulama mesajı gözlemlenmedi | Hafif can sıkıntısı |
| 3 | `Copy invite link` alternatifi | E-posta yazmadan hızlı davet | Link kopyalanır, panoya | Bu link ile davet edilen kişinin **hangi role** düşeceği arayüzde belirtilmiyor (muhtemelen varsayılan Member) — Owner/Admin için gizli bir güvenlik varsayımı | Belirsizlik (güvenlik açısından hafif risk) |
| 4 | Davetlinin e-postayı açması (gözlemlenemedi, arayüz düzeyinde çıkarım) | Hesaba katılmak | Kabul linki → hesap oluşturma/şifre belirleme | — | — |
| 5 | Yeni üyenin `Teammates` tablosunda görünmesi | Ekibin büyüdüğünü görmek | Satır: ad, e-posta, rol rozeti, durum noktası, 2FA sütunu (`gorseller/mod-07-team-teammates.png`) | "Status" sütunu varsayılan olarak "Not accepting chats" (kırmızı nokta) — yeni katılan kişi kendi başına "Accepting chats"e geçmesi gerektiğini bilmeyebilir; sistem bunu **proaktif hatırlatmıyor** | Yeni üye için "ne yapmam gerekiyor" belirsizliği |
| 6 | Sağ panelden `Manage profile` | Eşzamanlı sohbet limiti, grup ataması ayarlamak | "6 concurrent chats limit", "Chatting teams (1): Chatting Team" | Limit sayısının **neye göre** belirlenmesi gerektiğine dair rehberlik (örn. "yeni temsilciler için 3 önerilir") yok | Nötr, deneyimli Admin için sorun değil |
| 7 | Admin'in `Teams` sekmesine gitmesi (gözlemde fiilen reddedildi) | Departman yapılandırmak | "You don't have access to this view" (`gorseller/mod-07-team-teams-no-access.png`) | Aynı "Admin" rozetiyle bazı ekranlara girip bazılarına girememe, kullanıcının rol modelini yanlış anlamasına yol açabilir (bkz. §1.2) | Şaşkınlık → "admin'e sor" ile çözülebilir kaygı |

### 2.d Bir Sohbetin Bilete Dönüşmesi + Çözüm

| # | Adım | Kullanıcı Amacı | Sistemin Cevabı | Sürtünme Noktası | Duygu Durumu |
|---|---|---|---|---|---|
| 1 | Aktif sohbette karmaşık/uzun soru | Konuyu takip edilebilir hale getirmek | Başlık şeridinde "Create ticket from chat" ikonu (`gorseller/mod-04-chats-inbox-all.png`) | İkon yalnızca sembol (📋 benzeri), metin etiketi yok — ilk kullanımda tooltip'e güvenilir; deneyimsiz temsilci bu aksiyonu keşfetmeyebilir | Keşif belirsizliği (ilk kullanımda) |
| 2 | Tıklama | Transkriptin bilete taşınması | (Tetiklenmedi, arayüz düzeyinde) yeni bilet, sohbet geçmişiyle birlikte oluşur | Oluşturma sonrası sohbet penceresinde "Ticket #X oluşturuldu, [bilete git]" gibi bir onay/köprü olup olmadığı doğrulanamadı — bu, akışın en kritik geri bildirim noktasıdır ve eksikse kullanıcı "gerçekten oluştu mu?" diye Tickets listesine gidip kontrol etmek zorunda kalır | Belirsizlik riski |
| 3 | Bilet listesine gitme (`Inbox → Tickets → Unassigned`) | Bileti bulmak | Grid görünüm, sıralama `lastMessageAt desc` | Yeni oluşan biletin **otomatik olarak "Unassigned"da** göründüğünü varsaymak makul ama kimin atanacağı konusunda net bir kural (round-robin mi, manuel mi) arayüzde görünmüyor | Nötr |
| 4 | Bileti kendine atama | Sahiplenmek | (Ticket rules / manuel atama, MOD-9.1 ile ilişkili) | — | — |
| 5 | Yanıtlama, durum "Pending" olması | Müşteriye dönmek | Temsilci yanıtında otomatik "Pending" | Durum geçişleri (Open→Pending→Solved) **otomatik** olduğundan temsilci elle durum yönetmiyor — bu iyi bir tasarım kararı (bilişsel yük azaltır) | Rahatlama |
| 6 | Müşteri yanıtlamazsa | Takip etmek | Zaman aşımı/otomasyon (Ticket rules ile) | Takip hatırlatıcısının (örn. "3 gündür yanıt yok") arayüzde proaktif bir rozet/bildirim olarak sunulup sunulmadığı gözlemlenemedi | Belirsizlik (kaçırma riski) |
| 7 | Müşteri yanıtlarsa | Konuşmayı sürdürmek | Otomatik "Solved" → yeniden "Open"a döner | — | Güven (sistem otomatik yönetiyor) |

**Servis tasarımı notu:** Sohbet→bilet köprüsü, ürünün "senkron canlı destek" ile "asenkron takip" arasındaki en kritik dikiş noktasıdır. Kanıt tabanında bu geçişin **başarı geri bildirimi** (toast/onay) doğrulanamamıştır; bu, klon tasarımında mutlaka açık ve görünür şekilde ele alınmalı (§9'da öncelikli öneri).

### 2.e Rapor İnceleme

| # | Adım | Kullanıcı Amacı | Sistemin Cevabı | Sürtünme Noktası | Duygu Durumu |
|---|---|---|---|---|---|
| 1 | `Reports → Overview` | "İş nasıl gidiyor?" sorusuna hızlı cevap | KPI kartları (Total cases, Total chats, All sales) + tarih karşılaştırma (`gorseller/mod-08-reports-overview.png`) | Sayfa açılır açılmaz **üç** rakip görsel unsur var: (1) "Top chat topics" mor promo bandı, (2) "How useful are Reports?" geri bildirim popover'ı, (3) asıl KPI verisi. Bu, Nielsen'in "estetik ve minimalist tasarım" ilkesini zedeler — göz önce hangisine gitsin belirsiz | Bilgi kirliliği, hafif rahatsızlık |
| 2 | Promo bandını kapatma veya "Remind me later" | Asıl veriye odaklanmak | Banner kapanır/ertelenir | Ek tıklama maliyeti — her oturumda tekrar çıkma ihtimali (kalıcı "dismiss" durumu kaydedilip edilmediği belirsiz) | Hafif can sıkıntısı |
| 3 | Geri bildirim popover'ını kapatma | Odaklanmak | X ile kapanır veya "Remind later" | Aynı anda iki farklı "dikkatini iste" unsuru — kullanıcı ilk girişte 2 mikro-karar vermek zorunda kalıyor | Bilişsel yorgunluk |
| 4 | KPI kartlarını okuma | Trend görmek | "19 ↑19 vs 0 for previous period" — sparkline/çubuk | "vs 0" karşılaştırması (yeni hesap olduğundan) anlamsız büyüme yüzdesi izlenimi verebilir (%∞ artış gibi okunabilir) — deneme hesaplarında yanıltıcı olabilir | Yanlış güven riski (yeni kullanıcılar için) |
| 5 | Manual/Assisted/Automated kırılımına bakma | AI'ın katkısını anlamak | Renkli çubuk + sayı (8/6/5) | Bu kırılım, ürünün AI-değer önermesini **veriyle kanıtlayan** en güçlü tekil ekran öğesi — iyi tasarlanmış | Güven, "AI gerçekten çalışıyor" hissi |
| 6 | Zaman aralığını değiştirme (7/30/90/365 gün) | Farklı pencereden bakmak | Anında yeniden hesaplama | Custom takvim seçici ile birlikte 4 hazır aralık — standart ve öngörülebilir | Nötr, tanıdık desen |
| 7 | `Chat topics` (yeni, kırmızı nokta) | Yeni özelliği keşfetmek | Kırmızı "yeni" göstergesi sol navigasyonda | "Yeni" rozeti hem sol navigasyonda hem üstteki promo bandında **tekrarlanıyor** — aynı özelliği iki kez pazarlamak gereksiz tekrar | Nötr/hafif yorgunluk |

---

## 3. Jobs-to-be-Done (JTBD) Analizi

JTBD çerçevesi, "müşteri bu ürünü hangi işi halletmek için işe alıyor" sorusuna odaklanır. text.com/app için işler üç katmanda toplanır: **işlevsel, duygusal, sosyal**.

### 3.1 Owner/Admin'in işe aldığı işler
- **İşlevsel:** "Dağınık kanallardaki (web, e-posta, WhatsApp, Messenger) müşteri taleplerini **tek bir kutuya** toplamak istiyorum, böylece hiçbir mesaj kaybolmasın." → Kanıt: `gorseller/mod-10-settings-channels.png` — tüm kanallar tek "All channels" ızgarasında.
- **İşlevsel:** "Tekrar eden basit soruları (şifre sıfırlama, para çekme limiti) **insan olmadan** çözmek istiyorum ki ekibim karmaşık vakalara odaklansın." → Kanıt: AI Agent Knowledge kaynakları (13 makale, çoğu SSS niteliğinde: "Şifre Sıfırlama", "Para Çekme Kuralları").
- **Duygusal:** "Ekibimin performansını **kanıtla gösterebilmek** istiyorum — hem üst yönetime hem kendime." → Kanıt: Reports → Team performance, AI Agent Performance KPI kartları.
- **Duygusal:** "Yeni bir araca geçerken **yanlış karar verdiğimi** hissetmek istemiyorum." → Kanıt: 14 gün ücretsiz deneme + kredi kartsız kayıt + örnek veriyle hızlı değer gösterimi (time-to-value).
- **Sosyal:** "Ekibime **modern, AI-destekli** bir araçla çalıştığımı göstermek istiyorum." → Kanıt: AI Agent'ın "ekip üyesi" gibi sunulması (bkz. §1.4), Playbook'un "şablon galerisi" estetiği.

### 3.2 Member/Agent'in işe aldığı işler
- **İşlevsel:** "Aynı soruyu her seferinde yeniden yazmak istemiyorum." → Canned responses (`#` kısayolu).
- **İşlevsel:** "Müşteriyi bekletmeden, doğru tonda cevap üretmek istiyorum ama kelimeleri kendim bulmak zorunda kalmak istemiyorum." → Reply Suggestions (`Space`), AI rephrase/enhance.
- **Duygusal:** "Kim olduğumu, ne zamandır sitede olduğunu, daha önce ne konuştuğumuzu **bilmeden** konuşmak istemiyorum — kör hissetmek istemiyorum." → Sağ bağlam paneli (Visit info, Chat tags, geçmiş sohbet/bilet sayısı).
- **Duygusal:** "Zor bir konuşmayı **yalnız başıma** yürütmek istemiyorum, ekibimle bağlam paylaşabilmeliyim." → Note modu (müşteriye görünmeyen dahili not).
- **Sosyal:** "İyi performans gösterdiğimi objektif verilerle kanıtlayabilmek istiyorum (CSAT, yanıt süresi)." → Team performance raporları.

### 3.3 Müşterinin (widget'ın diğer ucundaki ziyaretçi) işe aldığı iş — dolaylı persona
- **İşlevsel:** "Sorumu sorduğumda **beklemeden** bir cevap istiyorum — insan olsun olmasın önemli değil, doğru ve hızlı olsun."
- **Duygusal:** "Botla konuştuğumu fark ettiğimde **kandırılmış** hissetmek istemiyorum; gerekirse hemen bir insana geçebilmeliyim."
- **Kanıt/risk:** AI Agent'ın müşteriye **açıkça bot olduğu** belirtilip belirtilmediği (widget tarafında "AI Assistant" rozeti var — Custom Skill Editor önizlemesinde "AI agent — AI Assistant" etiketi görünüyor) olumlu bir şeffaflık sinyalidir, ancak canlı widget tarafında (MOD-12) bu bilginin ilk mesajda ne kadar belirgin olduğu doğrulanamamıştır — bu, etik/güven açısından kritik bir doğrulama noktasıdır.

### 3.4 "İşe almama" (terk) riskleri — JTBD'nin ters yüzü
- Kurulumun teknik bilgi gerektirmesi ("Invite a developer" seçeneğinin varlığı) → teknik olmayan küçük işletme sahiplerinin işi "yarım bırakması" riski.
- AI Agent'ın "hazır olmadan" yayına alınabilmesi → müşteriye kötü ilk izlenim, markanın "AI'ı düzgün kuramamış" algısı riski.
- Üç farklı fiyatlandırma yüzeyi (LiveChat / unified Text / ChatBot-HelpDesk ayrı) → satın alma kararı öncesi kafa karışıklığı, "hangi ürünü almalıyım" tereddüdü (bu rapor kapsamı dışı ama JTBD'nin en başındaki iş: "doğru ürünü bulmak").

---

## 4. Kullanılabilirlik Denetimi — Nielsen 10 Heuristik

Her heuristik, somut ekran kanıtlarıyla modül modül değerlendirilmiştir.

### H1 — Sistem durumunun görünürlüğü
- **Güçlü:** Inbox sayaçları (`My chats 1`, `Queued 0`) gerçek zamanlı; AI Agent Performance panosu "vs previous period" ile durumu bağlamsallaştırıyor; mesaj balonlarında çift-tik (gönderildi/okundu) durumu.
- **Zayıf:** AI Agent Custom Skill Editor'de `Save changes` butonunun aktif/pasif durumu (kaydedilecek değişiklik var mı) görsel olarak net ayrışmıyor (`gorseller/mod-06-ai-agent-custom-skill-editor.png` — buton soluk gri, tıklanabilir mi belirsiz). Widget kurulumunda "bağlantı test edildi mi" sinyali eksik (§2.a, adım 5).

### H2 — Sistem ile gerçek dünya arasında eşleşme
- **Güçlü:** "Queued", "Unassigned", "Supervised" gibi terimler çağrı merkezi/destek sektöründe yerleşik jargonla birebir örtüşüyor; AI Agent'ın "Not accepting chats" / "Accepting chats" durumu insan temsilci diliyle aynı (metaforik tutarlılık, bkz. §1.4).
- **Zayıf:** "Playbook" ismi (spor/strateji terimi) ile içeriği (skill/otomasyon kütüphanesi) arasındaki bağlantı ilk kullanımda sezgisel değil; çoğu kullanıcı "Playbook" kelimesinden "prosedür/kural kitapçığı" bekler, karşısına "AI beceri galerisi" çıkması hafif bir kavramsal sıçrama gerektirir.

### H3 — Kullanıcı kontrolü ve özgürlüğü
- **Güçlü:** Custom Skill Editor'de her zaman `X` (Close) ile çıkış; Invite modalında `Cancel`; sürükle-bırak ile kişiselleştirilebilir liste sırası (Inbox grupları, Reports kategorileri, bağlam paneli bölümleri — MOD-4.1.5, MOD-4.5.3, MOD-8.1.5).
- **Zayıf:** Gönderilen mesajlar **düzenlenemez** (yalnızca reaksiyon/kopyalama) — bu bilinçli bir denetim-izi kararı olsa da, yazım hatası yapan bir temsilcinin "geri alma" özgürlüğü yok; tek çare yeni mesajla düzeltmek, bu da sohbeti gürültülü hale getirir.

### H4 — Tutarlılık ve standartlar
- **Güçlü:** Tüm liste ekranları (Teammates, Contacts, Knowledge sources, Skills) aynı düzeni kullanıyor: arama + filter + tablo + satır-sonu `⋯` kebab menü. Bu, öğrenilen deseni her modülde tekrar kullanılabilir kılıyor.
- **Zayıf:** "Create" aksiyonlarının konumu tutarsız — Playbook'ta sağ üstte `Create skill ▾` dropdown, Teammates'te sağ üstte düz buton `+ Invite teammates`, Knowledge'ta `+ New source` dropdown. Üç farklı "oluştur" etkileşim deseni (dropdown/düz buton/dropdown) aynı üst-sağ konumda farklı davranıyor.

### H5 — Hata önleme
- **Güçlü:** Invite formunda boş e-posta göndermeyi engelleyen satır-içi doğrulama; RBAC, yetkisiz rotaya girişi daha en baştan engelliyor (route-level, sadece menü gizleme değil — MOD-7.4).
- **Zayıf:** AI Agent'ın Knowledge'ı boşken veya tek bir skill'i yokken "Turn on" edilebilmesi (§2.b, adım 8) bir hata-önleme fırsatının kaçırılmasıdır — sistem, riskli bir aksiyonu **kolaylıkla ve uyarısız** almasına izin veriyor.

### H6 — Hatırlamak yerine tanımak
- **Güçlü:** Sağ bağlam paneli, temsilcinin müşteri geçmişini "hatırlamasına" gerek bırakmadan tüm bilgiyi (Visit info, Chat tags, Chat ID) yanında tutuyor; `#` canned response ile "hangi kısayolu yazmıştım" diye düşünmeye gerek kalmadan liste beliriyor.
- **Zayıf:** Settings'in 20'den fazla alt-sayfası (Notifications, Company details, Channels×8, Routing×2, Inbox×7, Integrations×3, Security×4, Billing×3) yalnızca sol listede metinle sıralı; hangi ayarın nerede olduğunu **hatırlamak** gerekiyor, arama/filtreleme Settings içinde gözlemlenmedi (global ⌘K arama bunu kısmen telafi ediyor ama Settings'e özel bir "settings search" yok).

### H7 — Esneklik ve kullanım verimliliği
- **Güçlü:** ⌘K komut paleti, klavye kısayolları (Space=öneri, #=canned, Shift+Enter=satır); deneyimli kullanıcı için hız, acemi için keşif — iki seviyeli kullanım.
- **Zayıf:** Sürükle-bırak ile yeniden sıralama (Inbox grupları, rapor kategorileri) için **klavye alternatifi** gözlemlenmedi; bu hem erişilebilirlik hem verimlilik açısından zayıf (bkz. §7, §8).

### H8 — Estetik ve minimalist tasarım
- **Güçlü:** Koyu tema, yüksek bilgi yoğunluğuna rağmen (üç-dört sütunlu Inbox düzeni) düzenli boşluklama ile okunabilir kalıyor.
- **Zayıf:** Reports → Overview'da aynı anda üç rakip unsur (promo banner + feedback popover + KPI verisi) görülüyor (`gorseller/mod-08-reports-overview.png`) — bu, tek bir ekranda gözlemlenen en açık H8 ihlalidir.

### H9 — Kullanıcıların hataları tanıması, teşhis etmesi ve düzeltmesi
- **Güçlü:** "At least one email required" mesajı net, eylem-yönlendirici; RBAC "You don't have access to this view" + "ask an admin for access" + "Go to Inbox" — hem teşhis hem çözüm sunuyor (`gorseller/mod-07-team-teams-no-access.png`).
- **Zayıf:** Diğer olası hata durumları (dosya yükleme boyut/format hatası, Knowledge kaynağı tarama başarısızlığı, ödeme reddi) arayüz düzeyinde gözlemlenemedi — güvenlik nedeniyle tetiklenmedi; bu bir kapsam sınırıdır ama klon ekibi için "her hatanın kendi net mesajı olmalı" ilkesi RBAC örneğinden genellenmelidir.

### H10 — Yardım ve dokümantasyon
- **Güçlü:** Sağ alt `?` yardım ikonu her yerde sabit; uygulama kendi ürünüyle destek veriyor ("Chat with Support" — "kendi yemeğini kendin ye" ilkesi, güven artırıcı); API access sayfasında "Documentation" ve "API pricing" dış bağlantılar.
- **Zayıf:** Bağlamsal (contextual) yardım — örn. AI Agent Instructions alanında "iyi bir talimat nasıl yazılır" için satır-içi ipucu/örnek galerisi — yalnızca placeholder metniyle sınırlı, ayrıntılı rehberlik (link, örnek galeri) gözlemlenmedi.

---

## 5. Bilgi Mimarisi ve Navigasyon Değerlendirmesi

### 5.1 Üst düzey yapı
Sol ikon rayı beş ana modülü sabitliyor: **Inbox · Customers · Team · Playbook · Reports** + ayrı olarak **Settings** (dişli) ve **Trial rozeti**. Bu, 5+1+1 = 7 üst-seviye düğümlü sığ bir hiyerarşi — Miller'ın 7±2 kuralına uygun, bilişsel olarak yönetilebilir.

### 5.2 Etiketleme tutarsızlıkları
- **"Inbox" içinde "Tickets" var, ama "Tickets" ayrı bir üst-seviye ikon değil.** Biletleme, ürünün ikinci büyük sütunu olmasına rağmen (HelpDesk mirası) Inbox'ın alt grubunda "gizli" kalıyor. Bir kullanıcı zihinsel olarak "Chats" ve "Tickets"ı eşit ağırlıkta iki farklı iş modeli olarak görebilir, ama IA bunları hiyerarşik olarak eşitsiz sunuyor.
- **"Team" içinde hem insanlar (Teammates, Teams) hem AI (AI Agent, Copilot) var.** Bu, §1.4'te değinilen "AI'ı ekip üyesi gibi konumlandırma" stratejisiyle tutarlı ama navigasyon etiketi "Team" iken içinde "AI Agents" alt-grubu bulunması ilk kullanımda "AI Agent burada mı olmalıydı, yoksa Playbook'ta mı?" sorusunu doğurabilir — nitekim AI Agent'ın **Skills** sekmesi Team altında, ama skill'lerin **galerisi** (Playbook) tamamen ayrı bir üst-seviye modülde. Aynı kavramın (AI Agent yetenekleri) iki farklı üst-seviye modülde parçalı temsili, bilgi mimarisinin en belirgin zayıf noktasıdır.
- **"Customers" içinde üç farklı iş birimi** (Real-time/Traffic, Contacts/CRM, Campaigns) tek başlık altında toplanmış — bunlar kavramsal olarak "ziyaretçi izleme", "müşteri veritabanı" ve "proaktif pazarlama" gibi birbirinden oldukça farklı işlevler; deneyimsiz bir kullanıcı "Customers" dediğinde yalnızca CRM (Contacts) bekleyebilir, Real-time/Campaigns'i orada bulmayı beklemeyebilir.

### 5.3 Derinlik ve rota tutarlılığı
Rotalar (`/app/inbox/chats/all`, `/app/team/ai-agents/{uuid}/knowledge`, `/app/settings/routing/chat-routing`) tutarlı bir `modül/alt-modül/görünüm` şablonunu izliyor — bu, geliştirme ve klonlama açısından **öngörülebilir ve iyi tasarlanmış** bir URL semantiği. Derinlik genelde 3-4 seviyeyi geçmiyor, bu da "kaybolma" riskini düşürüyor.

### 5.4 Settings'in "geniş ve düz" mimarisi
Settings, 6 kategori (Genel, Channels, Routing, Inbox, Integrations, Security, Billing — fiilen 7) altında 20+ alt sayfaya yayılmış düz bir liste. Kategoriler katlanabilir ama **arama** yok. Büyüyen bir üründe bu, "nerede olduğunu bilmiyorsan kaybolursun" riski taşıyan klasik bir "geniş ve düz" (broad & flat) IA sorunudur. Bunun tek telafisi, global ⌘K komut paletinin "go to…" özelliğidir (MOD-13.1) — ancak bunun Settings alt sayfalarını da indekslediği doğrulanmamıştır.

### 5.5 Öneri özeti (bkz. §9 için detay)
Tickets'ı Inbox'ın **görsel eşit** bir alt-sekmesi (belki de kendi ikonuyla) yapmak, AI Agent yeteneklerinin (Skills + Playbook) tek bir kavramsal ev altında birleştirilmesi, ve Settings için özel bir arama kutusu eklenmesi, IA netliğini önemli ölçüde artırır.

---

## 6. Boş / Yükleme / Hata / RBAC Durumları — UX Kalitesi

Bu, ürünün **tutarsızlığının en somut kanıtlandığı** alandır — aynı üründe hem sektör-lideri kalitede hem de tamamen ihmal edilmiş bir durum ekranı bir arada gözlemlenmiştir.

### 6.1 En iyi örnek: RBAC "erişim yok" ekranı
`gorseller/mod-07-team-teams-no-access.png` — kilit-kalkan ikonu, net başlık ("You don't have access to this view"), açıklayıcı alt metin ("If you need it, ask an admin for access."), ve eylem butonu ("Go to Inbox"). Bu ekran, kullanıcıyı **asla çıkmaza sokmuyor** — her zaman bir sonraki adımı gösteriyor. Ders: hata/kısıtlama ekranları "neden + ne yapmalıyım" ikilisini her zaman içermeli.

### 6.2 En zayıf örnek: Customers → Real-time boş durumu
`gorseller/mod-05-customers-realtime-traffic.png` — sol panelde tüm sayaçlar `0` iken sağdaki içerik alanı **tamamen boş, düz koyu bir dikdörtgen**. Ne bir ikon, ne bir açıklama metni, ne de "Henüz canlı ziyaretçi yok — widget'ı kurduğunuzda burada göreceksiniz" gibi yönlendirici bir mesaj var. Bu, RBAC ekranıyla taban tabana zıt: aynı ürün içinde bir modülde örnek-ders niteliğinde bir boş-durum tasarımı varken, başka bir modülde **hiçbir tasarım** yok. Yeni bir kullanıcı bu ekranı gördüğünde "sayfa bozuk mu?" diye düşünebilir — özellikle deneme hesabında henüz widget kurulmamışsa bu ekranla karşılaşma olasılığı yüksektir (tam da onboarding'in en kritik anında).

### 6.3 Trial/paywall durumu
"8 days" rozeti (sol ray, kalıcı) + "Free trial ends in 8 days" bandı (Billing) + "Add payment details" CTA'sı — çok katmanlı ama **tutarlı** bir aciliyet iletişimi. Rozet rengi (kırmızı) gün azaldıkça daha agresif hale geliyor olabilir (doğrulanmadı) ama mevcut haliyle bile sürekli görünür olması etkili bir dönüşüm mekanizması.

### 6.4 Doğrulama (validation) hatası
Invite formundaki "At least one email required" — kırmızı, satır-içi, spesifik. İyi bir örnek ama tek gözlemlenen örnek olduğundan, ürün genelinde form doğrulama dilinin (ör. geçersiz e-posta formatı, karakter sınırı aşımı) tutarlılığı bu rapor kapsamında doğrulanamamıştır.

### 6.5 Yükleme (loading) durumu
Sayfa geçişlerinde kısa bir spinner/loader gözlemlendi (Playbook, Settings, Billing, API access açılırken). İskelet ekran (skeleton screen) kullanılıp kullanılmadığı net değil — spinner tabanlı yüklemeler, iskelet ekranlara göre algılanan bekleme süresini daha uzun gösterme eğilimindedir; bu, özellikle veri-yoğun ekranlarda (Reports, Contacts tablosu) iyileştirme fırsatıdır.

### 6.6 Genel değerlendirme
Bu tutarsızlık, ürünün **büyürken parça parça inşa edildiğinin** (farklı ekiplerin farklı modülleri farklı zamanlarda tasarladığının) dolaylı bir kanıtıdır. Klon ekibi için en net ders: **durum tasarımı (empty/loading/error/access-denied) merkezi bir tasarım sistemi bileşeni olarak en baştan standardize edilmeli**, modül modül ayrı ayrı icat edilmemeli.

---

## 7. Erişilebilirlik (WCAG 2.2) Gözlemleri ve Riskler

Bu bölüm, ekran görüntüleri ve gözlemlenen etkileşim modelleri üzerinden **çıkarımsal** bir risk değerlendirmesidir; gerçek bir ekran okuyucu/klavye-only denetimi bu oturumda yapılmamıştır — bu dürüstçe belirtilmelidir.

### 7.1 Renk kontrastı (WCAG 1.4.3 / 1.4.11)
- Koyu tema (siyaha yakın #0e0e0e zemin, açık gri metin) genel olarak yüksek kontrastlı görünüyor ancak **ikincil metinler** (zaman damgaları "10h", "51m", placeholder metinler "Enter message or press 'Space'…", tablo alt başlıkları) belirgin biçimde soluklaştırılmış gri tonlarda — bunların 4.5:1 (normal metin) veya 3:1 (büyük metin/UI bileşeni) eşiğini karşılayıp karşılamadığı ölçülmeli. Özellikle Reports'taki sparkline/mini-grafik renkleri (mavi/mor, `gorseller/mod-08-reports-overview.png`) koyu zemin üzerinde düşük doygunlukta — düşük görüşlü kullanıcılar için risk.
- **Yalnızca renkle** ifade edilen durumlar: Teammates tablosunda çevrimiçi/çevrimdışı durumu yeşil/kırmızı nokta ile gösteriliyor (`gorseller/mod-07-team-teammates.png`) — renk körü kullanıcılar için ek bir metin/ikon farkı (ör. dolu/boş daire) olmadan bu ayrım kaybolabilir (WCAG 1.4.1 "Use of Color" ihlali riski).

### 7.2 Yalnızca ikonla ifade edilen aksiyonlar (WCAG 1.1.1, 4.1.2)
- Composer araç çubuğu (Reply suggestions, `#` canned, AI rephrase, emoji, attachment) ve mesaj başlık şeridi (Copy chat link, Create ticket, kebab) **tamamen ikon-tabanlı**, görünür metin etiketi yok (`gorseller/mod-04-chats-inbox-all.png`). Erişilebilir isim (accessible name / aria-label) her ikon için doğru atanmış olsa bile, ekran büyütücü kullanan ya da bilişsel yükü yüksek kullanıcılar için görünür etiket eksikliği bir risktir.

### 7.3 Klavye erişilebilirliği
- **Güçlü:** ⌘K komut paletiyle her yere klavyeden ulaşılabilmesi, `#`/`Space` kısayolları, Enter/Shift+Enter davranışı — bunlar klavye-öncelikli bir tasarım felsefesine işaret ediyor.
- **Riskli:** `Space` tuşunun composer'da boşken "Reply Suggestions" tetiklemesi — ekran okuyucu kullanıcıları veya motor-engelli kullanıcılar için beklenmedik bir yan etki riski taşır (yanlışlıkla boşluk tuşuna basmak bir AI eylemini tetikleyebilir); bu davranışın **iptal edilebilir/geri alınabilir** olup olmadığı ve bir `Escape` ile kapatılabilirliği doğrulanmalı.
- **Eksik:** Sürükle-bırak ile yeniden sıralama (Inbox grupları MOD-4.1.5, bağlam paneli bölümleri MOD-4.5.3, Reports kategorileri MOD-8.1.5) için **klavye alternatifi** (ör. odaklanıp ok tuşlarıyla taşıma) gözlemlenmedi — WCAG 2.1.1 (Keyboard) açısından, sürükle-bırak tek etkileşim yoluysa doğrudan bir ihlal adayıdır.

### 7.4 Hedef boyutu (WCAG 2.5.8 Target Size — WCAG 2.2 yeni kriter)
- Tablo satırlarındaki `⋯` kebab menüleri ve mesaj balonu üzerindeki hover-aksiyonları (reaksiyon/kopyala) küçük tıklama alanlarına sahip görünüyor; WCAG 2.2'nin 24×24 CSS piksel minimum hedef boyutu kriteri karşılanıyor mu, ekran görüntülerinden kesin ölçülemez ama yoğun tablo satırlarının (Contacts, Knowledge sources) satır yüksekliği düşünüldüğünde risk taşıyor.

### 7.5 Odak görünürlüğü (WCAG 2.4.7 Focus Visible)
- Ekran görüntülerinde statik an yakalandığından klavye odak halkası (focus ring) gözlemlenemedi — bu, gerçek bir tarayıcı denetimiyle doğrulanmalı; SPA'larda rota değişimi sonrası **odağın nereye taşındığı** (ör. yeni açılan modal/panel başlığına mı) da kritik bir WCAG 2.4.3 (Focus Order) konusu.

### 7.6 Hover-only etkileşimler (WCAG 1.4.13 Content on Hover or Focus)
- Mesaj balonu satır-içi aksiyonları ("Copy message", "Add reaction") yalnızca **hover'da** görünüyor (MOD-4.3.3) — dokunmatik cihazlarda (tablet/dokunmatik ekranlı laptop) hover kavramı olmadığından bu aksiyonlara erişim ya uzun-basma ile taklit edilmeli ya da her zaman görünür bir alternatif sunulmalı; mevcut haliyle **mobil/dokunmatik masaüstü kullanıcı** için bir kullanılabilirlik ve dolaylı erişilebilirlik açığıdır.

### 7.7 Genel WCAG 2.2 risk özeti

| Kriter | Gözlemlenen Risk | Önem |
|---|---|---|
| 1.4.1 Use of Color | Online/offline durumu yalnızca nokta rengiyle | Orta |
| 1.4.3 Contrast (Minimum) | İkincil/gri metinler, grafik renkleri düşük doygunluk | Orta-Yüksek (doğrulanmalı) |
| 1.4.13 Content on Hover/Focus | Mesaj aksiyonları yalnızca hover'da | Orta |
| 2.1.1 Keyboard | Sürükle-bırak yeniden sıralama için klavye alternatifi yok | Yüksek |
| 2.4.7 Focus Visible | Doğrulanamadı, gerçek denetim gerekli | Bilinmiyor |
| 2.5.8 Target Size (Min) | Yoğun tablo/kebab menüleri küçük olabilir | Orta |
| 4.1.2 Name, Role, Value | İkon-only butonlarda erişilebilir isim varlığı doğrulanmalı | Orta |

---

## 8. Mikro-Etkileşim Eleştirisi

### 8.1 Composer (mesaj kompozisyon kutusu)
- **Message/Note geçişi** ("Message ▾" dropdown): İşlevsel olarak kritik (müşteriye görünür vs dahili not) ama görsel ağırlığı çok düşük — küçük, sol-alt köşede, composer'ın en az dikkat çeken yeri. Yanlışlıkla "Note" modundayken müşteriye gönderilecek bir yanıtı not sanıp yazmak (ya da tersi — dahili notu müşteriye göndermek) risklidir. Bu kritik bir mod-değiştirici (mode switch) olduğundan, modun **arka plan rengiyle** (ör. Note modunda composer'ın tamamen farklı bir renk alması, sarı/amber gibi "dikkat" rengi) çok daha belirgin sinyallenmesi gerekir; mevcut tasarımda bu ayrım zayıf kalıyor.
- **`#` canned response:** Sektör standardı bir desen (Slack/Notion'daki `/` komutuna benzer), ok tuşlarıyla gezinme ve Enter ile seçim — öğrenilebilirlik yüksek. Riski: kullanıcı `#` karakterini gerçekten mesaj içinde kullanmak isterse (ör. "Sipariş #12345") kısayol tetiklenip tetiklenmediği, bir kaçış yolu (Escape ile listeyi kapatıp yazmaya devam etme) olup olmadığı doğrulanmalı.
- **`Space` ile Reply Suggestions:** Yaratıcı ama riskli bir tasarım kararı — placeholder'da açıkça yazıyor ("press 'Space' for Reply Suggestions") bu yüzden keşfedilebilir, ama normal yazım akışında bir kelimeden sonra boşluk tuşuna basmanın **her zaman** bir öneri tetikleyip tetiklemediği (yoksa yalnızca kutu boşken mi) netleştirilmeli — belirsizse tecrübeli kullanıcılar bile yanlışlıkla öneri panelini açabilir.
- **AI rephrase/enhance ikonu:** Yazılmış metni iyileştirme — konumu doğru (yazdıktan sonra erişilebilir) ama bir **önizleme/geri-al** mekanizması olmadan doğrudan metni değiştiriyorsa (gözlemlenemedi) kullanıcı kontrolünü kaybetme riski taşır.

### 8.2 Sürükle-sırala paneller
İnbox grupları (MOD-4.1.5), bağlam paneli bölümleri (MOD-4.5.3) ve Reports kategorileri (MOD-8.1.5) hepsi "Drag to reorder" ile kişiselleştirilebilir. Bu, güçlü bir kişiselleştirme özelliği ama üç farklı yerde **aynı davranışın üç kez öğrenilmesi** gerekiyor — tutamaç ikonunun (varsa) her modülde aynı görsel dilde olup olmadığı tutarlılık açısından önemli. Ayrıca §7.3'te belirtildiği gibi klavye alternatifi eksikliği hem erişilebilirlik hem verimlilik açısından bir boşluk.

### 8.3 Reaksiyon ve kopyalama (hover-aksiyonları)
Mesaj balonlarında hover'da beliren "Copy message" ve "Add reaction" — düşük görsel gürültü sağlıyor (sürekli görünür olsaydı sohbet akışı kalabalıklaşırdı) ama §7.6'da belirtildiği gibi dokunmatik erişilebilirlik açığı taşıyor.

### 8.4 Toggle'lar (aç/kapa anahtarları)
Playbook'taki skill toggle'ları, AI Agent Status toggle'ı, Channel kartlarındaki ON/OFF rozetleri — tutarlı bir yeşil-aktif/gri-pasif dili kullanıyor. Güçlü yön: her toggle'ın yanında **anlık etkisi** açık (ör. "AI Agent is off. Turn it on to handle chats automatically." — sonucu önceden anlatıyor). Bu, "ne olacağını bilmeden tıklama" kaygısını azaltan iyi bir mikro-metin (microcopy) örneği.

### 8.5 Preview/Playground deseni (tekrar eden güçlü desen)
AI Agent Profile ve Custom Skill Editor'de tekrarlanan **canlı Preview paneli**, üründeki en güçlü mikro-etkileşim desenidir — kullanıcı her ayar değişikliğinin sonucunu **anında ve risksiz** görebiliyor (canlı müşteriye gitmeden). Bu, "değişiklik yap → sonucu gör → güvenle yayınla" döngüsünü kısaltan, klon için doğrudan kopyalanması gereken bir desendir.

### 8.6 Kebab (⋯) menü yoğunluğu
Hemen her tablo satırında (Teammates, Knowledge sources, Website widgets) bir `⋯` menüsü var — tutarlı ama aşırı kullanıldığında "her şey üç nokta arkasında saklı" hissi yaratabilir; sık kullanılan aksiyonların (ör. bir Knowledge kaynağını devre dışı bırakma) kebab içine gömülmesi, keşfedilebilirliği düşürür.

---

## 9. UX Zayıflıkları + Önceliklendirilmiş İyileştirme Önerileri

Aşağıdaki liste, klon ekibinin **önce neyi düzeltmesi/iyi kopyalaması gerektiğine** karar vermesi için P0 (kritik/kopyalarken düzelt) → P2 (ince ayar) şeklinde sıralanmıştır.

### P0 — Kritik (kopyalarken mutlaka farklı/daha iyi yapılmalı)
1. **Boş-durum tutarsızlığı** (§6.2): Real-time/Traffic gibi "sıfır veri" ekranlarının tamamen boş bırakılması. Klon: her boş-durum RBAC ekranındaki kalitede (ikon + açıklama + CTA) standardize edilmeli.
2. **AI Agent "hazır olmadan" yayına alınabilmesi** (§2.b, adım 8): Knowledge boşken/skill yokken `Turn on AI Agent` engelsiz çalışıyor. Klon: bir "yayına almadan önce" kontrol listesi (readiness checklist) eklenmeli.
3. **Sohbet→bilet dönüşümünde geri bildirim belirsizliği** (§2.d, adım 2): Kritik bir iş akışı köprüsünde açık bir başarı onayı/köprü linki olup olmadığı doğrulanamadı. Klon: bu geçişte her zaman görünür bir toast + "bilete git" bağlantısı olmalı.
4. **Reports Overview'da rekabet eden dikkat unsurları** (§2.e, §H8): Promo banner + feedback popover + KPI verisi aynı anda. Klon: sayfa yüklendiğinde yalnızca **bir** ikincil unsur (varsa) gösterilmeli, diğerleri gecikmeli/tetiklenerek sunulmalı.
5. **Klavye erişilebilirliği olmayan sürükle-bırak** (§7.3, §8.2): Üç ayrı modülde tekrarlanan bir örüntü. Klon: her sürükle-bırak listesine "Move up/Move down" klavye alternatifi eklenmeli.

### P1 — Önemli (kısa vadede iyileştirilmeli)
6. **AI Agent yeteneklerinin IA'da bölünmüşlüğü** (§5.2): Skills (Team altında) ile Playbook (ayrı üst modül) arasındaki kavramsal kopukluk. Klon: AI yeteneklerini tek bir "AI Agent Hub" altında (Profile+Knowledge+Skills+Performance+galeri) birleştirmek.
7. **Message/Note mod-değişiminin düşük görsel ağırlığı** (§8.1): Yanlış modda yazma riski. Klon: mod'a göre composer arka plan/kenar rengini belirgin biçimde değiştirmek.
8. **Settings içinde arama eksikliği** (§5.4): 20+ alt sayfa, düz liste. Klon: Settings'e özel bir arama kutusu eklemek.
9. **Widget kurulumunda doğrulama sinyali eksikliği** (§2.a, adım 5): "Bağlandı mı, gerçekten çalışıyor mu?" belirsizliği. Klon: kurulum sonrası otomatik bir "test sinyali algılandı" onayı göstermek.
10. **Yalnızca renkle ifade edilen durum göstergeleri** (§7.1): Çevrimiçi/çevrimdışı nokta. Klon: renkle birlikte ikon/şekil farkı (dolu/boş, farklı ikon) eklemek.

### P2 — İnce ayar (uzun vadede, olgunlaştıkça)
11. İkon-only araç çubuğu butonlarına (composer, mesaj başlığı) görünür/kısa metin etiketleri eklemek veya en azından tutarlı tooltip gecikmesi standardize etmek.
12. Kebab menü yoğunluğunun azaltılması — sık kullanılan 1-2 aksiyonu satır üzerine (hover'da) çıkarmak, geri kalanını `⋯` içinde tutmak.
13. Hover-only mesaj aksiyonlarına dokunmatik cihazlar için her-zaman-görünür bir alternatif (ör. uzun basma veya sabit küçük ikon) eklemek.
14. Reports KPI kartlarında "vs 0 for previous period" gibi anlamsız karşılaştırmaları (yeni hesaplarda) gizlemek veya "yeni hesap" bağlamıyla farklı biçimde sunmak.
15. Knowledge kaynakları için toplu içe aktarma (CSV/klasör yükleme) eklemek — mevcut akış tek tek makale girişine dayanıyor.

---

## 10. Klon İçin UX/Servis Tasarımı İlkeleri ve Öneri Niteliğinde Tasarım Kararları

Bu bölüm, önceki dokuz bölümün damıtılmış halidir — bir klon ekibinin "neyi olduğu gibi alıp neyi bilinçli olarak iyileştireceğine" karar verirken kullanabileceği ilke seti.

### 10.1 Temel ilkeler (aynen benimsenmeli)
1. **"AI'ı ekip üyesi gibi tasarla."** Persona, ton, dil, durum (accepting/not accepting) alanlarını insan temsilci profiliyle simetrik kur — bu, kullanıcının zihinsel modelini basitleştiriyor ve AI'a güveni artırıyor (§1.4).
2. **"Her ayarın yanına canlı önizleme koy."** Profile ve Skill editöründeki Preview paneli, ürünün en güçlü tasarım desenidir — risksiz deneme, anında geri bildirim (§8.5). Klon, bu deseni mümkün olduğunca çok ayar ekranına yaymalı.
3. **"Boş sayfa yerine tohum veri ile karşıla."** Örnek sohbet + hazır Knowledge kaynakları + demo skill'ler, zamanı-değere (time-to-value) kısaltıyor (§2.a). Klon, ilk girişte gerçek/boş bir hesap yerine mutlaka temsili örnek veri sunmalı.
4. **"Yetkisizlik durumunu bilgilendirici tasarla, sessizce gizleme."** RBAC "erişim yok" ekranı (§6.1) hem güvenlik hem UX açısından örnek teşkil ediyor — her korumalı rotanın kendi "neden + ne yapmalıyım" ekranı olmalı.
5. **"Rota tabanlı, öngörülebilir URL semantiği kur."** `/modül/alt-modül/görünüm/id` deseni hem geliştirme hem kullanıcı zihin haritası için güçlü bir temel (§5.3).

### 10.2 Bilinçli olarak İYİLEŞTİRİLMESİ gereken kararlar
6. **Boş-durum tasarımını merkezi bir tasarım-sistemi bileşeni yap.** Modül modül ayrı ayrı icat etmek yerine tek bir `EmptyState { icon, title, description, primaryAction }` bileşeni tanımla ve her yerde kullan (§6.6) — bu, Real-time/Traffic'teki boş ekranın tekrarlanmasını önler.
7. **"Yayına alma" (go-live) aksiyonlarının önüne bir hazırlık kontrolü (readiness gate) koy.** AI Agent'ı, bir widget'ı veya bir otomasyon kuralını "aç"madan önce sistem asgari yapılandırmayı (en az 1 knowledge kaynağı, en az 1 skill, ton seçili) doğrulamalı ve eksikse **engellemeden ama net biçimde uyarmalı** (§9, P0-2).
8. **Kritik iş akışı köprülerinde (sohbet→bilet gibi) her zaman görünür bir başarı onayı tasarla.** "Oldu mu, olmadı mı" belirsizliğini asla kullanıcının kendi başına Tickets listesine gidip kontrol etmesine bırakma (§9, P0-3).
9. **Bilgi mimarisinde "aynı kavramın iki eviyle" mücadele et.** AI yeteneklerini (Playbook + Team→AI Agents→Skills) tek bir kavramsal çatı altında birleştir; ya Playbook'u AI Agent detay sayfasının bir sekmesi yap, ya da AI Agent'ı Playbook'un içine taşı — ikisini paralel üst-seviye modüller olarak tutma (§5.2, §9 P1-6).
10. **Mikro-etkileşimlerde mod-değişimlerini (Message/Note gibi) renkle güçlü biçimde kodla.** Küçük bir dropdown yerine, modun tüm composer'ın görsel kimliğini değiştirmesini sağla — yanlış modda gönderim riskini azalt (§8.1, §9 P1-7).

### 10.3 Servis tasarımı (hizmet tasarımı) düzeyinde öneriler
11. **"Insan + AI" el değiştirme anını (handoff) bir hizmet tasarımı sahnesi olarak ele al.** Custom Skill Editor'deki adım-tabanlı handoff mantığı ("niyet tespiti → veri toplama → etiketleme → özetleme → insana aktarma") güçlü bir örüntü; klon bunu yalnızca teknik bir özellik değil, **müşteri deneyiminin bir sahne geçişi** olarak tasarlamalı — geçiş anında müşteriye ne söylendiği (şeffaflık), bekleme süresi beklentisi ve bağlamın kaybolmaması garanti edilmeli.
12. **Ekip büyüme yolculuğunu (davet → rol → hazır olma) uçtan uca tasarla.** Yeni davet edilen bir üyenin "Not accepting chats" durumunda sessizce beklemesi yerine, sistem yeni üyeye aktif olması gerektiğini **proaktif olarak** hatırlatmalı (§2.c, adım 5) — bu, "insan onboarding"inin de en az "AI onboarding" kadar tasarlanması gerektiğinin kanıtıdır.
13. **Trial/dönüşüm baskısını sürekli ama rahatsız etmeyen çok-katmanlı sinyallerle ilerlet.** Rozet + banner + CTA üçlüsü etkili ama agresiflik seviyesi kullanım derinliğine (kaç modül kullanıldı, kaç AI çözümü üretildi) göre kişiselleştirilebilir — salt gün sayacına dayanmak yerine "değer görmüş kullanıcıya" farklı bir dönüşüm mesajı kurgulanabilir.
14. **Erişilebilirliği modül bazında değil, tasarım-sistemi bazında garanti et.** §7'de tespit edilen riskler (renk-only durum, hover-only aksiyon, klavye alternatifi eksik sürükle-bırak) hepsi **tek bir bileşen kütüphanesinden** kaynaklanan sistemik sorunlardır; klon ekibi bunları modül modül değil, bileşen kütüphanesi seviyesinde (Badge, DragList, HoverAction gibi temel bileşenlerde) çözerse tüm ürün genelinde tutarlı biçimde düzelir.
15. **"Kendi ürününü kendi ürününle destekle" ilkesini koru.** Uygulamanın kendi yardım ikonunun kendi LiveChat widget'ını açması (MOD-13.4), hem pazarlama hem güven açısından güçlü bir sinyal — klon, kendi destek kanalını da aynı şekilde ürünün içine gömmeli.

---

*Rapor 2 sonu (v2/01). Kanıt tabanı: `01-fonksiyonel-analiz.md`, `02-teknik-mimari.md`, `research/02-product-pricing-features.md`, `gorseller/*.png`. Bu rapor, önceki fonksiyonel envanterin yerine değil, tamamlayıcısı olarak kullanılmalıdır — modül/rota düzeyindeki kesin gerçekler için MOD-X.Y.Z referanslarına, deneyim/karar gerekçeleri için bu rapora bakılmalıdır.*
