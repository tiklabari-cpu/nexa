# 03 — Araştırma: iGaming Canlı Destek için Konuşan Yapay Zekâ (SiyahTuş)

> Tarih: 2026-10-14 · Kapsam: piyasadaki yapay zekâ destek ajanlarının kavram modeli, SiyahTuş tenant'larının girmesi gereken bilgiler, iGaming niyet kataloğu, uyum kuralları ve kalite ölçümü.
> Varsayım: Faz 1'de yapay zekâ **yalnızca konuşur**. Backend entegrasyonu yok (BetConstruct, EveryMatrix vb. yok). Hesabı göremez, bakiye ya da işlem durumu sorgulayamaz. Bilgi toplar, kurala dayalı yanıt verir, gerekirse yapılandırılmış özetle insana devreder.
> Kaynak notu: Vendor belgeleri ve resmi düzenleyici sayfaları birincil kaynaktır. eesel.ai, getmacha gibi üçüncü taraf blog kaynakları "ikincil" olarak işaretlenmiştir.

---

## 1. Önde gelen yapay zekâ destek ajanları girdileri nasıl yapılandırıyor?

### 1.1 Ortak kavram modeli
Tüm büyük vendor'lar aynı beş katmana yakınsıyor:

1. **Bilgi (Knowledge):** Ajanın yanıtlarını dayandırdığı içerik (yardım makaleleri, URL'ler, PDF, snippet/soru-cevap). Ajan "ne" sorusunu bununla yanıtlar.
2. **Davranış talimatı (Guidance / Instructions / Coaching):** Doğal dilde yazılmış kurallar: ton, ne zaman netleştirme sorusu sorulacağı, hassas konular, yasaklar. Ajan "nasıl" konuşacağını bununla öğrenir.
3. **Prosedür (Procedure / Playbook / AOP / Journey):** Çok adımlı iş akışı. Giriş koşulu ("bu prosedür ne zaman kullanılır"), adımlar, dallanmalar ve araç çağrıları içerir. "Para yatmadı" gibi teşhis akışları bu katmandadır.
4. **Aksiyon / veri bağlayıcı (Data connector / Tool / Action):** API ile okuma ya da yazma (bakiye sorgula, işlemi kontrol et). SiyahTuş Faz 1'de yok. Ama modelde yeri baştan ayrılmalı.
5. **Devretme kuralları (Escalation / Handoff):** Ne zaman insana geçileceği, hangi ekibe gidileceği ve müşteriye ne söyleneceği. Intercom bunu Guidance'tan ayrı bir nesne olarak tutar.

Bunların çevresinde ortak bir **yaşam döngüsü** var: Simülasyon/test → yayınlama (versiyon) → analiz (çözülemeyen sorular, içerik boşlukları) → koçluk/iyileştirme.

### 1.2 Vendor karşılaştırma tablosu

| Vendor | Bilgi | Davranış talimatı | Prosedür (çok adımlı) | Aksiyon / Veri | Devretme | Test / Simülasyon | İyileştirme döngüsü |
|---|---|---|---|---|---|---|---|
| **Intercom Fin** | Yardım merkezi, URL'ler, snippet'ler, dosyalar | **Guidance**: iletişim stili, bağlam ve netleştirme ("önce iOS mu Android mi sor, o bilgi olmadan cevap verme" örneği) | **Procedures**: adımlar, Tools ve Guidance birleşimi, "When to use" giriş koşulu | **Data connectors**: API GET/POST. Girdileri Fin kendisi çıkarır. Hassas kimlik değerleri Intercom'dan doğrudan enjekte edilmeli | Ayrı **Escalation Guidance** (Train → Escalation) ve yönlendirme için Workflow dalı | Procedure **Simulations**: yapay zekâ ile üretilen veya manuel senaryolar, sahte connector çıktısı, simüle edilmiş saat. Preview ve batch test de var | **Optimize** paneli / Unresolved questions (benzer çözülmemiş soruları kümeler), yapay zekâ içerik önerileri (boşluk, çelişki, tekrar), talimat çakışma denetimi |
| **Zendesk AI agents** | Yardım merkezi içeriğinden **generative replies** | Persona ve ton ayarları, talimatlar | **Use cases (intents)** + **generative procedures** (iş politikasını yansıtan agentic akış). Klasik **dialogues** ile birlikte kullanılabilir ("hibrit ajan") | API entegrasyonları / aksiyonlar | Use case bazlı devretme ve yönlendirme | Test paneli | **Automated resolution** (yapay zekâ ile doğrulanan çözüm), BSAT (bot memnuniyeti), Zendesk QA / autoQA ile yapay zekâ konuşmalarının puanlanması |
| **Ada** | Bilgi kaynakları (ilk kurulum katmanı) | **Coaching**: geçmiş konuşmalardan ajanı düzeltme | **Playbooks**: düz dilde SOP gibi sıralı adımlar. Her adımı denetleyen bir "adherence supervisor" var | API çağrıları (Playbook içinden) | Playbook içinde eskalasyon adımı | Test konuşmaları | Konuşma inceleme ve koçluk. **Kısıt:** Coaching, Playbook çalışırken dikkate alınmaz. Playbook içinde bilgi tabanı araması yapılamaz, bilgi Playbook'a gömülmeli |
| **Decagon** | Bilgi tabanı | AOP içindeki doğal dil talimatları | **AOP (Agent Operating Procedures)**: ad, giriş koşulları, düğüm düğüm adımlar. "Doğal dil esnekliği ile kod hassasiyeti" | AOP'den çağrılan Tools (API, hesaplama) | AOP adımı olarak devretme | **Duet / AOP Copilot**: SOP'tan AOP taslağı üretir, simüle konuşmalarla test eder | Akıl yürütme izlerinden mantık iyileştirme, iş akışı boşluk teşhisi |
| **Sierra** | Agent Studio'da bilgi yapılandırması | Journey içindeki talimatlar | **Journeys**: no-code (Agent Studio) ya da kod olarak (Agent SDK, versiyon kontrolü ile) | SDK araçları, API'ler | Journey kuralı | **Simulations**: SOP, bilgi tabanı ve koçluk transkriptlerinden otomatik test üretimi. "Simüle hakem" SOP'a uyumu puanlar. Regresyon testi | Konuşma izleri, regresyon |
| **Freshworks Freddy** | Dosya, URL, KB, harici connector'lar (SharePoint, Drive, Confluence) | Agent Studio'da talimatlar | **Agentic workflows** (doğal dil ile tarif edilerek oluşturma) | Workflow, uygulama entegrasyonları | Workflow içinde | Önizleme | Freddy Insights |
| **LiveChat / ChatBot (Text)** | ChatBot ayrı bir üründür. Bilgi tabanı yanıtları + akış tasarımcısı | Sınırlı | Görsel akış (karar ağacı) | Webhook'lar | Sohbeti LiveChat ajanına aktarma | Akış testi | Temel raporlar |

**Çıkarım:** Pazarın yönü açık. "Karar ağacı" yerine **doğal dilde yazılmış prosedürler + ayrı davranış talimatları + ayrı devretme kuralları + yayın öncesi simülasyon + çözülemeyen soru analizi** kullanılıyor. SiyahTuş Faz 1 için Aksiyon katmanı boş kalır. Prosedürlerdeki "kontrol et" adımları ise şimdilik "**oyuncudan bilgi topla → kuralı uygula → gerekirse devret**" biçiminde yazılır. Böylece entegrasyon geldiğinde aynı prosedüre bir araç adımı eklemek yeterli olur.

### 1.3 Dikkat çeken yazım (authoring) UX desenleri
- **Doğal dil prosedürü:** Ada, Decagon ve Intercom "SOP'unuzu yapıştırın" yaklaşımını kullanıyor. Decagon ve Intercom, SOP metninden taslak prosedür üretiyor.
- **Giriş koşulu ("When to use"):** Her prosedürün hangi niyette tetikleneceği ayrı bir alanda tutuluyor.
- **Talimat optimizasyonu:** Intercom "Optimize" aracı talimatlardaki belirsizlik, tekrar ve çelişkileri işaretliyor. Japonca en iyi uygulama makalesi, talimatların "sen" diye hitapla ve tam cümleyle yazılmasını öneriyor.
- **Simülasyon:** Yapay zekâ ile üretilen ve manuel senaryolar, sahte veri, simüle zaman (ör. "çekim 24 saati geçti mi?"), geçme kriterleri. Sierra ayrıca bir hakem modeli ile SOP uyumunu puanlıyor.
- **Versiyon ve yayın:** Taslak → test → yayın akışı. Sierra SDK'da değişiklikler kod gibi izleniyor.
- **Çözülemeyen sorular:** Fin, cevap verilemeyen, insan istenen veya terk edilen konuşmaları kümeler. İnsan ajanın başarılı yanıtlarından makale önerisi üretir.
- **Koçluk:** Ada'da konuşma üzerinden "bu durumda şunu yap" düzeltmesi yapılır.
- **Limitler:** Intercom Escalation Guidance için 100 aktif kural sınırı bildiriliyor (ikincil kaynak). Ayrıca bir yanıtta en fazla 2 Guidance uygulandığı yönünde doğrulanmamış bir kullanıcı gözlemi var. Ders: kural sayısı arttıkça çakışma yönetimi gerekir.

**Kaynaklar (Bölüm 1):**
- Intercom – Building Fin Procedures: https://intercom.com/help/en/articles/13449439-building-fin-procedures
- Intercom – Data connectors in Procedures: https://www.intercom.com/help/en/articles/13459820-how-to-use-data-connectors-in-fin-procedures
- Intercom – Data and actions FAQ: https://www.intercom.com/help/en/articles/9916507-data-and-actions-faqs
- Intercom – Fin Guidance blog: https://intercom.com/blog/fin-guidance/ · https://fin.ai/updates/fin-guidance
- Intercom – Fin Guidance en iyi uygulamalar (JA): https://www.intercom.com/help/ja/articles/10560969
- Intercom – Run simulations for Fin Procedures: https://www.intercom.com/help/en/articles/12599517-run-simulations-for-fin-procedures · https://fin.ai/updates/simulations-for-procedures
- Intercom – Simulations vs batch tests vs previews: https://fin.ai/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews
- Intercom – Analyze unresolved questions: https://fin.ai/help/en/articles/13975776-analyze-unresolved-questions
- Intercom – AI-powered content suggestions: https://www.intercom.com/help/en/articles/11394959-use-ai-powered-suggestions-to-improve-fin-s-content
- Intercom – How to optimize Fin: https://intercom.com/help/en/articles/8890980-how-to-optimize-fin
- Escalation Guidance kurulumu (ikincil): https://www.getmacha.com/blog/intercom-fin-handoff-setup
- Zendesk – AI agents glossary: https://support.zendesk.com/hc/en-us/articles/8357751626266-AI-agents-glossary
- Zendesk – Agentic AI agent başlangıç: https://support.zendesk.com/hc/en-us/articles/8979864024346
- Zendesk – Advanced email AI agents duyurusu: https://support.zendesk.com/hc/en-us/articles/10563281043738
- Ada – Playbooks (Classic): https://docs.ada.cx/docs/automation/playbooks/playbooks-classic
- Ada – Playbook management: https://docs.ada.cx/docs/automation/playbooks/playbook-management
- Ada – SOP blog: https://www.ada.cx/blog/your-next-star-service-rep-won-t-ask-for-a-desk-just-your-sops/
- Decagon – AOPs: https://decagon.ai/modules/aops · https://decagon.ai/resources/from-sops-to-agent-operating-procedures · https://decagon.ai/blog/why-we-built-decagon-duet-on-agent-operating-procedures
- Sierra – Agent SDK / Studio / Simulations: https://sierra.ai/product/agent-sdk · https://sierra.ai/uk/product/agent-studio · https://sierra.ai/blog/simulations-the-secret-behind-every-great-agent
- Procedures vs AOPs vs Journeys (Intercom bakışı): https://fin.ai/learn/ai-agent-procedures-aops-journeys
- Freshservice – AI Agent Studio: https://support.freshservice.com/en/support/solutions/articles/50000012643-introduction-to-ai-agent-studio-in-freshservice
- Freddy bilgi kaynakları (ikincil): https://www.eesel.ai/blog/freddy-ai-agent-knowledge-sources
- LiveChat AI rehberi (ikincil): https://myaskai.com/blog/livechat-ai-complete-guide-2026

---

## 2. SiyahTuş için önerilen "girdi modeli" (tenant ekranları ve alanlar)

Rol eşlemesi: **Kurucu/Yönetici** her şeyi düzenler ve yayınlar. **Ekip Lideri** taslak hazırlar, test eder, koçluk önerir ve yayın onayı ister. **Ekip Üyesi** konuşma üzerinden "düzeltme önerisi" ve "bilgi eksik" işareti gönderir.

### Ekran A — Marka ve Kimlik (Persona)
| Alan | Tip | Not |
|---|---|---|
| Asistan adı, avatar | metin/görsel | Oyuncuya yapay zekâ olduğu açıkça söylenir (şeffaflık) |
| Marka/site adları (çoklu brand) | liste | Bir tenant birden fazla operatöre hizmet verebilir. Her brand ayrı bilgi kümesine bağlanır |
| Dil(ler) | çoklu seçim | TR varsayılan. EN/AZ/RU vb. |
| Hitap | seçim | "siz" önerilir |
| Ton | seçim + serbest metin | Resmî-sıcak, emoji yok/az |
| Yasak ifadeler | liste | "Kesin yatacak", "garanti", "kazanırsınız" vb. |
| Çalışma saatleri ve insan ekibi saatleri | zaman tablosu | Mesai dışı devirde verilecek mesaj |

### Ekran B — Bilgi Bankası (Knowledge)
| Alan | Not |
|---|---|
| Makaleler (başlık, içerik, etiket, brand, dil, geçerlilik tarihi, sahibi) | "Son gözden geçirme tarihi" zorunlu. Ödeme ve bonus bilgisi hızlı eskir |
| Soru-cevap snippet'leri | Kısa, tek gerçek. Ör. "Papara min. yatırım: X TL" |
| URL/PDF içe aktarma | Operatörün kurallar ve şartlar sayfası, bonus şartları |
| **Yapılandırılmış tablolar** (serbest metin yerine) | Aşağıdaki ödeme yöntemi tablosu gibi. Yapay zekâ hesaplamayı ve karşılaştırmayı bunlardan yapar |

**Ödeme Yöntemleri tablosu** (en kritik yapılandırılmış veri):
`yöntem adı | yön (yatırım/çekim) | min | max | beklenen süre (normal) | "gecikme sayılır" eşiği | çalışma saatleri | gerekli açıklama/referans formatı | dekont gerekli mi | sık hatalar (ör. yanlış IBAN, açıklama eksik, farklı isimden gönderim, yanlış kripto ağı) | aktif mi | güncelleme tarihi`

**Bonus/Promosyon tablosu:** `ad | tip | min yatırım | çevrim katı | çevrime sayılan oyunlar/oranlar | max bahis | max çekim | süre | talep yöntemi (otomatik/canlı destek/kod) | hariç tutulan yöntemler | aktif dönem`

**KYC belge tablosu:** `belge türü | kabul kriterleri (renkli, 4 köşe görünür, son X ay) | hangi durumda istenir | inceleme süresi | yükleme yolu`

**Limitler ve Kurallar:** Çekim limitleri, günlük/haftalık sayılar, hesap başına tek hesap kuralı, yaş sınırı, bahis iptal politikası.

### Ekran C — Davranış Kuralları (Guidance)
Kategorilere ayrılmış doğal dil kuralları (Intercom modeline benzer):
- **İletişim** (ton, uzunluk, tek mesajda en fazla 2 soru)
- **Netleştirme** ("Ödeme sorununda, yöntem ve tutar öğrenilmeden çözüm önerme")
- **Hassas konular** (sorumlu oyun, şikâyet, tehdit)
- **Yasaklar** (Bölüm 4'teki guardrail'ler. Platform tarafından kilitli ve tenant tarafından gevşetilemez temel set + tenant ekleri)

Her kural için alanlar: `başlık | kural metni | kapsam (tüm konuşmalar / belirli niyetler / brand) | aktif | öncelik | sahip | son düzenleme`. Kaydederken **çakışma denetimi** çalışır (iki kural aynı durumda farklı şey söylüyor mu?).

### Ekran D — Prosedürler (Konu Akışları)
Her niyet için bir prosedür (Bölüm 3 kataloğu hazır şablon olarak gelir):
| Alan | Not |
|---|---|
| Ad, açıklama | "Yatırım hesaba geçmedi" |
| **Ne zaman kullanılır** (giriş koşulu) + örnek oyuncu cümleleri | "param yatmadı", "yatırdım gözükmüyor", "bakiye gelmedi" |
| **Toplanacak alanlar** (slot'lar) | ad, zorunlu mu, doğrulama (tarih, tutar, TXID formatı), hassas mı (ör. kart no **asla**) |
| **Adımlar** (doğal dil, sıralı, dallanmalı) | "Eğer süre < beklenen süre ise → bekleme açıklaması" |
| **Çözüm yanıt kalıpları** | Değişkenli şablonlar: {yöntem}, {beklenen_süre} |
| **Devretme koşulları** | Prosedüre özel + global |
| **Devir özeti şablonu** | Ajan ekranında görünen yapılandırılmış kart |
| **Gelecek entegrasyon yuvası** | "Burada `deposit_status(tx_id)` aracı çağrılacak". Faz 1'de pasif |
| Durum | Taslak / Testte / Onay bekliyor / Yayında / Arşiv. Her yayın bir versiyon numarası alır |

### Ekran E — Devretme ve Yönlendirme
- Global devir tetikleyicileri (Bölüm 4 + "oyuncu insan istedi", "2 tur anlaşılamadı", "olumsuz duygu yükseldi").
- Hedef kuyruk/ekip eşlemesi: Finans, KYC/Risk, Bonus, Sorumlu Oyun (yalnız eğitimli ajanlar), Teknik, Şikâyet.
- Öncelik kuralları: Sorumlu oyun ve reşit olmayan şüphesi → **acil**.
- Mesai dışı davranışı: Talep kaydı + beklenen dönüş süresi mesajı.
- **Devir özeti şablonu** (standart): `niyet | oyuncu kimliği (kullanıcı adı/ID, oyuncunun beyanı) | toplanan alanlar | yapay zekânın verdiği yanıtlar | neden devredildi | duygu/risk bayrakları | önerilen sonraki adım | ekler (dekont)`.

### Ekran F — Test ve Simülasyon
- Senaryo listesi (her prosedür için otomatik üretilmiş + manuel): `açılış mesajı | oyuncu profili (sabırsız, kızgın, eksik bilgi veren, sorumlu oyun sinyali veren) | simüle zaman | beklenen sonuç (çözüldü / X ekibine devredildi) | geçme kriterleri (zorunlu alanlar toplandı mı, yasaklı ifade var mı)`.
- Yayın öncesi **regresyon**: Tüm senaryolar yeniden koşulur ve sonuç farkı gösterilir.
- Canlı önizleme ("Oyuncu gibi konuş").

### Ekran G — Analiz ve Koçluk
- **Çözülemeyen sorular kümeleri** (hacim, terk, devir oranına göre sıralı).
- Devir nedenleri dağılımı.
- İnsan ajanın yanıtından **"makale/kural önerisi"** üretme. Ekip Lideri onaylar.
- Konuşma üzerinden **koçluk notu** ("burada önce yöntemi sormalıydın") → kural taslağına dönüşür.
- QA örneklem kuyruğu (Bölüm 5).

### Ekran H — Değişiklik Geçmişi ve Onay
- Her bilgi, kural ve prosedür değişikliği: kim, ne zaman, diff, versiyon.
- "Dört göz" onayı: Ekip Lideri taslak → Yönetici/Kurucu yayın. Uyum kuralları için Kurucu onayı.
- Geri alma (rollback).

---

## 3. iGaming niyet kataloğu

> Genel not: iGaming destek temaslarının sıralaması için güvenilir kamuya açık veri bulunamadı. Bulunan kaynaklar operatör pazarlama sayfaları. Liste, sektörde tekrar eden temalardan (ödeme, çekim, KYC, bonus, hesap, teknik) ve düzenleyici gerekliliklerden derlendi. Tenant kendi geçmiş sohbet etiketleriyle sıralamayı doğrulamalı.
> Faz 1 sınırı: Yapay zekâ **hiçbir zaman** "kontrol ettim, hesabınıza geçti/geçmedi" diyemez. Yalnızca "bilgilerinize göre" konuşur ve doğrulama gereken her durumda devreder.

| # | Konu | Toplanacak bilgi | Teşhis soruları | Çözüm yanıtı kalıbı | İnsana devret koşulu |
|---|---|---|---|---|---|
| 1 | **Yatırım hesaba geçmedi** | kullanıcı adı/ID, yöntem, tutar, tarih-saat, gönderen ad-soyad, işlem no/TXID, dekont, sitede talep oluşturuldu mu | Ne zaman? Hangi yöntem? Sitedeki yatırım ekranından talep oluşturdunuz mu? Kendi adınıza kayıtlı hesaptan mı gönderdiniz? Açıklama/referans yazıldı mı? Dekont var mı? | Süre beklenen sürenin altındaysa bekleme açıklaması. Talep oluşturulmamışsa doğru adım anlatılır. Diğer durumlarda bilgi toplanır ve finansa iletilir (bkz. 3.1) | Beklenen süre aşıldı, dekont mevcut, farklı isimden gönderim, yanlış IBAN/ağ, tutar uyuşmazlığı, mükerrer şikâyet |
| 2 | **Çekim beklemede** | kullanıcı adı, yöntem, tutar, talep zamanı, durum ekranında görünen ifade | Talebi ne zaman verdiniz? Ekranda "beklemede/onaylandı/işlemde" hangisi yazıyor? İlk çekiminiz mi? Hesap doğrulamanız tamam mı? Aktif bonus var mı? | Yöntemin normal işlem süresi ve mesai saatleri anlatılır. İlk çekimde KYC gerekebileceği, aktif bonusta çevrim şartı söylenir. **Ödeme zamanı için söz verilmez** | Normal süre aşıldı. "Onaylandı ama gelmedi". Tutar yüksek (tenant eşiği). Oyuncu ısrarlı veya öfkeli |
| 3 | **Çekim reddedildi / iptal edildi** | ret mesajı metni, tarih, yöntem, tutar | Ekranda veya SMS/e-postada hangi gerekçe yazıyor? Bonus kullandınız mı? Hesap bilgileriniz (isim/IBAN) sitedeki isimle aynı mı? | Genel ret nedenleri listelenir (isim uyuşmazlığı, çevrim tamamlanmadı, KYC eksik, limit). Kesin gerekçe için devir yapılır | **Her zaman** kesin gerekçe için Finans/Risk'e devredilir. Yapay zekâ ret kararını yorumlamaz veya tartışmaz |
| 4 | **KYC / doğrulama belgeleri** | istenen belge türü, yükleme durumu, ret mesajı | Hangi belge istendi? Yüklediniz mi, ne zaman? Ret geldiyse gerekçesi ne? | Kabul kriterleri (renkli, 4 köşe, okunaklı, güncel adres belgesi) ve yükleme yolu anlatılır. İnceleme süresi bildirilir | Belge reddi itirazı, inceleme süresi aşıldı, belge sohbet içinde gönderilmek istendi (kanal politikası), kimlik uyuşmazlığı, **reşit olmayan şüphesi** |
| 5 | **Bonus nasıl alınır / tanımlanmadı** | bonus adı, yatırım tutarı ve zamanı, talep yöntemi | Hangi bonus? Yatırımdan önce mi talep ettiniz? Kullandığınız yöntem bonus dışı mı? Min. yatırım karşılandı mı? | Bonus tablosundan koşullar açıklanır. Talep yöntemi anlatılır | Koşullar sağlanmış ama tanımlanmamış (manuel tanım gerekir). Tenant "bonus tanımı sadece insan" diyorsa |
| 6 | **Çevrim şartı / bonus kuralları** | bonus adı, oynanan oyunlar | Hangi bonus? Hangi oyunlarda oynadınız? | Çevrim katı, katkı oranları ve max bahis kuralı **genel hesap örneğiyle** açıklanır. Kalan çevrim tutarı söylenmez (görülemez) | Kalan çevrim tartışması, "bonusum silindi", max bahis ihlali nedeniyle kazanç iptali |
| 7 | **Bahis sonuçlandırma itirazı** | kupon ID, maç/etkinlik, seçim, beklenen ve gerçekleşen sonuç | Kupon numarası? Hangi seçim? Neden yanlış sonuçlandığını düşünüyorsunuz? | Genel kurallar açıklanır (iptal/void, ertelenen maç, uzatma dahil mi). **Sonucu değiştirme sözü verilmez** | Her itiraz kayıt ve inceleme için Trading/Risk'e devredilir |
| 8 | **Canlı oyun/slot teknik sorun** (oyun dondu, bakiye düştü) | oyun adı, sağlayıcı, zaman, round ID (varsa), cihaz/tarayıcı, ekran görüntüsü | Ne zaman oldu? Round/oyun geçmişinde görünüyor mu? Başka oyunlar açılıyor mu? | Temel adımlar: önbellek temizleme, başka tarayıcı, oyun geçmişini kontrol, sağlayıcının kesintide round'u tamamlama mantığı | Bakiye kaybı iddiası, round sonucu belirsiz, tekrarlayan hata (sağlayıcı ticket gerekir) |
| 9 | **Giriş yapamıyorum / şifre** | kullanıcı adı, hata mesajı, cihaz | Hangi hata çıkıyor? "Şifremi unuttum" denendi mi? Kayıtlı telefon/e-posta erişilebilir mi? | Şifre sıfırlama adımları. **Şifre hiçbir koşulda sohbette istenmez** | Kayıtlı iletişime erişim yok, hesap ele geçirildi şüphesi, 2FA sorunu |
| 10 | **Hesap kilitli / kapatıldı** | kullanıcı adı, görülen mesaj | Ne zaman fark ettiniz? Bir uyarı e-postası/SMS aldınız mı? Daha önce kendiniz kapatma veya ara verme talep ettiniz mi? | Kilit nedenleri yorumlanmaz. Bir uzmanın inceleyeceği bildirilir | **Her zaman** devredilir. Kendi talebiyle kapatma (self-exclusion) ise yeniden açma talebi **sadece insan** ve politika gereği reddedilebilir |
| 11 | **Hesabımı kapatmak / ara vermek istiyorum (self-exclusion, cool-off)** | süre tercihi (oyuncu söylerse) | Sormadan önce: talebi teyit et. İkna etmeye çalışma | "Talebinizi aldım, sorumlu oyun ekibine hemen aktarıyorum". Destek kaynakları paylaşılır | **Derhal ve her zaman** Sorumlu Oyun ekibine devredilir. Bonus ve promosyon teklifi **yasaktır** |
| 12 | **Sorumlu oyun sinyali** (kayıp kovalama, borç, "her şeyimi kaybettim", "maaşımı yatırdım", çaresizlik) | (bilgi toplama yok) | Yok. Teşhis değil, destek | Empatik kabul + limit araçlarını ve yardım kaynaklarını tanıtma + insana geçiş | **Derhal** devredilir. Kendine zarar ifadesi varsa acil öncelik ve kriz kaynağı paylaşılır |
| 13 | **Limit ayarlama** (yatırım/kayıp/oturum limiti) | limit türü, tutar, süre | Hangi limiti, hangi tutarda istiyorsunuz? | Siteden nasıl ayarlanacağı anlatılır. Limit düşürme genelde anında, yükseltme bekleme süresine tabi | Limit **yükseltme** veya kaldırma talebi (insan + bekleme süresi). Siteden ayarlanamıyorsa |
| 14 | **Ödeme yöntemleri bilgisi** (Papara, havale/EFT/FAST, kripto, kart vb.) | ilgilendiği yöntem, yön | Yatırım mı çekim mi? | Ödeme tablosundan min/max, süre ve adımlar anlatılır. Kripto için doğru ağ ve memo uyarısı verilir | Tabloda olmayan yöntem, oyuncuya özel limit talebi |
| 15 | **Yanlış hesaba/ağa gönderim** (yanlış IBAN, yanlış kripto ağı, eski hesap bilgisi) | yöntem, tutar, gönderilen adres/IBAN (son haneler), TXID, zaman | Hangi adrese/IBAN'a gönderdiniz? Hangi ağı seçtiniz (TRC20/ERC20/BEP20)? TXID? | Geri alınamayabileceği dürüstçe söylenir. İnceleme için bilgiler toplanır. **Kurtarma sözü verilmez** | **Her zaman** Finans'a devredilir |
| 16 | **Promosyon / turnuva / kampanya bilgisi** | kampanya adı | Hangi kampanya? | Bilgi bankasından koşullar anlatılır | Kampanya ödülü tanımlanmadı, katılım itirazı |
| 17 | **Hesap bilgisi değişikliği** (isim, telefon, e-posta, IBAN) | değiştirilecek alan | Neden değişiklik gerekiyor? | Güvenlik gereği yalnızca doğrulama ile yapılabileceği anlatılır | **Her zaman** devredilir. Kimlik doğrulama gerekir. Ele geçirme riski var |
| 18 | **Şikâyet / resmi itiraz** | konu, tarih, beklenen çözüm | Şikâyetinizi kısaca özetler misiniz? Daha önce destekle görüştünüz mü? | Şikâyet prosedürü ve süreleri (tenant politikası, ör. CGA: 4 hafta, sorumlu oyun şikâyetleri 5 iş günü) anlatılır | Resmi şikâyet her zaman insana gider. Karmaşık şikâyetler ve sorumlu oyun şikâyetleri **yapay zekâ tarafından yürütülemez** (CGA yönergesi) |
| 19 | **Erişim / giriş adresi** ("site açılmıyor", "güncel adres") | cihaz, hata | Hangi hatayı alıyorsunuz? | Tenant'ın onayladığı resmi kanal bilgisi verilir (bkz. guardrail G14) | Tenant politikası belirsizse |
| 20 | **Çoklu hesap / hesap paylaşımı / üçüncü kişi ödemesi** | durum | (Bilgi amaçlı) | Kurallar açıklanır | Fraud şüphesi her zaman Risk'e devredilir |

### 3.1 Tam örnek: "Para yatırdım hesabıma geçmedi"

**Giriş koşulu (örnek cümleler):** "param yatmadı", "yatırım yaptım bakiyem gelmedi", "havale attım gözükmüyor", "papara ile yatırdım düşmedi", "usdt gönderdim gelmedi".

**Zorunlu alanlar (slot'lar)**
| Alan | Zorunlu | Doğrulama / Not |
|---|---|---|
| Kullanıcı adı / üye no | evet | Şifre **asla** istenmez |
| Ödeme yöntemi | evet | Ödeme tablosundaki değerlerden biri |
| Tutar ve para birimi | evet | Sayısal. Yöntemin min/max'ı ile karşılaştırılır |
| İşlem tarih-saati | evet | "Az önce" denirse saat sorulur. Saat dilimi TR |
| Sitede yatırım talebi oluşturuldu mu | evet | Havale/Papara akışlarında talep olmadan gönderim sık hatadır |
| Gönderen hesap sahibi kendisi mi | evet | Üçüncü kişi ödemesi kuralı |
| İşlem/referans no veya TXID | koşullu | Kripto için zorunlu |
| Dekont / ekran görüntüsü | koşullu | Kanal izin veriyorsa ek. Kart no ve IBAN maskelenmeli |
| Gönderilen IBAN'ın son 4 hanesi / kripto ağı | koşullu | Yanlış hesap/ağ tespiti için |

**Akış**
1. **Empati + kapsam:** "Yaşadığınız durumu anlıyorum, hemen birlikte bakalım. Birkaç bilgiye ihtiyacım var." (Tek mesajda en fazla 2 soru.)
2. **Yöntem ve zaman:** "Hangi yöntemle ve saat kaçta yatırım yaptınız?"
3. **Süre kontrolü (bilgi tablosundan):**
   - Geçen süre < yöntemin beklenen süresi → **Bekleme yanıtı** (Kalıp A).
   - Yöntem mesai saatine bağlıysa ve işlem mesai dışında yapıldıysa → **Mesai yanıtı** (Kalıp B).
4. **Süreç kontrolü:** "Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu ve size gösterilen hesap bilgisine mi gönderdiniz?"
   - Talep yok → Kalıp C (talep oluşturma + dekontla birlikte devir).
   - Farklı/eski IBAN ya da yanlış ağ → Kalıp D (yanlış hesap) → **devir**.
5. **Kimlik/isim kontrolü:** "Gönderim kendi adınıza kayıtlı hesaptan mı yapıldı?" Hayır ise üçüncü kişi kuralı anlatılır → **devir**.
6. **Tutar kontrolü:** Min altı/max üstü ise kural anlatılır → **devir** (iade veya manuel işlem gerekir).
7. **Kanıt:** "İşlem numarası veya dekontu paylaşabilir misiniz? Kart numaranızı ya da şifrenizi paylaşmayın. Dekonttaki hesap numarasının ilk hanelerini kapatabilirsiniz."
8. **Karar:**
   - 3. adım beklemeyle sonuçlandıysa ve oyuncu kabul ettiyse → "çözüldü (bekleme bilgisi)" etiketi + takip önerisi ("{beklenen_süre} sonra hâlâ görünmezse bu sohbete yazın").
   - Aksi halde → **yapılandırılmış devir**.

**Yanıt kalıpları**
- **A (normal süre içinde):** "{yöntem} ile yapılan yatırımlar genellikle {beklenen_süre} içinde hesaba yansır. İşleminiz {geçen_süre} önce yapılmış, yani hâlâ normal süre içinde. {beklenen_süre} dolduğunda bakiye görünmezse bize yazın, dekontunuzla hemen finans ekibine iletelim."
- **B (mesai dışı):** "{yöntem} işlemleri {çalışma_saatleri} arasında işlenir. Talebiniz bir sonraki işlem penceresinde ({sonraki_pencere}) değerlendirilecek."
- **C (talep oluşturulmamış):** "Bu yöntemle gönderimden önce site üzerinden yatırım talebi oluşturulması gerekiyor. Gönderiminizin eşleştirilebilmesi için bilgilerinizi finans ekibimize iletiyorum."
- **D (yanlış hesap/ağ):** "Gönderimin farklı bir hesaba/ağa yapılmış olma ihtimali var. Bu tür işlemlerin geri alınması her zaman mümkün olmayabilir. Ama bilgilerinizi inceleme için hemen finans ekibine iletiyorum."
- **Devir:** "Bilgilerinizi finans ekibimize ilettim. Bir uzman en kısa sürede bu sohbetten size dönecek. {mesai_dışı ise: Ekibimiz {saat} itibarıyla dönüş yapacak.}"

**Yasak yanıtlar:** "Hesabınıza geçti", "kontrol ettim", "5 dakikaya yatar", "kesin geri alırız", "tekrar yatırın" (mükerrer yatırımı teşvik etmek).

**Devir özeti (ajan kartı) örneği**
```
Niyet: Yatırım hesaba geçmedi
Oyuncu: kullanıcı adı "ali123" (oyuncu beyanı, doğrulanmadı)
Yöntem: Papara | Tutar: 2.500 TRY | Zaman: 14.10.2026 13:42 (geçen süre 95 dk; beklenen ≤30 dk)
Talep oluşturuldu: Evet | Gönderen kendisi: Evet | Gönderilen hesap: sitede gösterilen (oyuncu beyanı)
Referans/TXID: PPR-...-8841 | Dekont: Ekli (1 görsel)
Yapay zekânın verdiği bilgi: normal süre ve takip; söz verilmedi
Devir nedeni: Beklenen süre aşıldı + dekont mevcut
Risk/duygu: Hafif sabırsız; sorumlu oyun sinyali yok
Önerilen adım: Papara referansı ile ödeme sağlayıcı panelinde eşleştirme
```

**Gelecek entegrasyon yuvası:** 3. adımdan sonra `deposit_lookup(user_id, amount, time_window)` aracı çağrılır. Bulunursa durum söylenir. Bulunamazsa aynı akış devam eder.

### 3.2 Türkiye ödeme bağlamı notları (bilgi bankasına girilmesi gerekenler)
- **FAST:** 7/24 anlık transfer. Papara'nın sayfasına göre limit dahilinde ücretsiz, tek işlem/gün limitleri var. **EFT** ise iş günü ve mesai saatlerine bağlı (bankaya göre yaklaşık 09:00–17:30). Yapay zekâ "EFT mi FAST mı?" sorusunu sormalı. Saatler tenant tablosundan gelmeli, kod içine sabitlenmemeli.
- **Kripto (USDT):** Ağ seçimi kritik (TRC20 adresleri "T", ERC20 "0x" ile başlar). TRON finaliti genelde 1 dakikanın altındadır. Ama alıcı tarafın onay eşikleri farklı olabilir. Yanlış ağ gönderimleri kurtarılamayabilir. TXID her zaman istenir.
- **Papara/havale aracıları:** Operatörlerin çoğu ödeme aracısı kullanır. "Talep oluştur → gösterilen hesaba gönder → açıklamaya kod yaz" akışı sık hata kaynağıdır. Tenant bu akışı yöntem bazında tabloya yazmalı.
- Kaynaklar: https://www.papara.com/en/money-transfer/fast · https://www.isbank.com.tr/blog/eft-havale-nedir-aralarindaki-farklar · https://eco.com/support/en/articles/15197999-usdt-trc-20-confirmation-time-block-speeds-and-finality-in-2026 · https://eco.com/support/en/articles/15197978-why-is-my-usdt-trc-20-transfer-stuck-troubleshooting-in-2026 · https://www.dextools.io/tutorials/trc20-vs-erc20-usdt-comparison-guide-2026-tr

---

## 4. Uyum ve risk guardrail'leri

### 4.1 Düzenleyici dayanaklar (özet)
- **Curaçao (CGA, LOK):** LOK 24.12.2024'te yürürlüğe girdi. CGA Sorumlu Oyun Politikası; oyuncu koruma, yaş doğrulama, öz değerlendirme ve **self-exclusion** zorunluluklarını, personelin "kumar sıkıntısı işaretlerini tanıma ve yapılandırılmış hassas konuşma yürütme" yetkinliğini ve yatırım limiti gibi araçların tanıtılmasını içerir. "Kendi isteğiyle ya da zorla oyundan men edilmiş" kişiler ve iflas etmiş kişiler "kırılgan kişi" tanımındadır.
  - **CGA Oyuncu Şikâyetleri Politika Yönergesi v1.1 (Haziran 2025):** Yapay zekâ kullanımına koşullu izin verir. **Sorumlu oyunla ilgili olarak tespit edilen şikâyette iletişim yapay zekâ ile değil insan ile yürütülmelidir.** Makul ölçüde **karmaşık şikâyetler insan** tarafından ele alınmalıdır. Yapay zekâ kayıtları, önerilen çözümlerin makul ve benzer şikâyetlerde **tutarlı** olduğunu doğrulamak için izlenmelidir. Sorumlu oyun şikâyetleri için 5 iş günü, diğerleri için yaklaşık 4 hafta hedefi, CGA onaylı ADR'ye yönlendirme vardır. (Not: AI maddeleri europeangaming.eu kopyasından, resmi PDF'ten teyit edilmeli.)
- **MGA (Malta):** Player Protection Directive (2 of 2018, 2023 değişiklikleri) sorumlu oyun yükümlülüklerini ve **problemli kumar göstergelerini** güçlendirdi. Lisanslılar şikâyet prosedürünü ve ADR'ye başvuru yolunu oyuncuya açıkça sunmak zorundadır. Yapay zekâ özelinde MGA kuralı bulunamadı.
- **UKGC (BK):** Uzaktan operatörler için Müşteri Etkileşimi rehberi ve SR Code 3.4.3 (12.09.2022'den itibaren) kapsamında göstergeler izlenmelidir: harcama, harcama örüntüsü, oyun süresi, **müşterinin başlattığı temas** ve sorumlu oyun araçlarının kullanımı. Güçlü göstergelerde otomatik süreçler gerekir. Riskli müşteriye pazarlama ve bonus engellenmelidir (bu gereklilik ertelenmişti). Önemli etkisi olan otomatik kararlar müşteriye bildirilmeli, itiraz edilebilir olmalı ve manuel incelenmelidir. Üçüncü taraf sağlayıcılar da kapsamdadır. Bu, SiyahTuş'u doğrudan ilgilendirir. Yapay zekâ chatbot'una özel UKGC rehberi bulunamadı. Sektör yorumu "sorumlu oyun etkileşimleri hızla eğitimli insana yönlendirilmeli, yapay zekâ bağlam sağlamalı" yönünde.
- **Araştırma:** Sisal sohbetlerinde problemli kumarın dilsel belirteçleri tespit edilebilir (Barone vd., J. Gambling Studies 2026). Kayıp kovalama DSM tanı kriteridir. Operatör müşteri hizmetleri iletişim göstergeleri ile vakaların yaklaşık %77'si doğru tahmin edildi (Haefeli vd. 2011).

### 4.2 Guardrail listesi (platform tarafından kilitli temel set)

**Sorumlu oyun ve kırılganlık**
- **G1:** Self-exclusion, ara verme, hesap kapatma veya "oynamayı bırakmak istiyorum" talebi → yapay zekâ ikna etmez, alternatif sunmaz. **Derhal** Sorumlu Oyun kuyruğuna devreder.
- **G2:** Problemli kumar sinyalleri (kayıp kovalama: "kaybımı geri almam lazım", borç ve kredi ile oynama, "maaşımı/kiramı yatırdım", çaresizlik, aile sorunu, kontrol kaybı, art arda yatırım sonrası öfke) → empatik yanıt, limit araçları ve yardım kaynağı, **insana devir**. Konuşmaya risk bayrağı konur.
- **G3:** Kendine zarar/intihar ifadesi → acil öncelik. Tenant'ın tanımladığı kriz hattı/acil numarası paylaşılır.
- **G4:** Risk bayrağı olan konuşmada **bonus, promosyon, "yatırım yap" yönlendirmesi yasak** (UKGC mantığı + iyi uygulama).
- **G5:** Reşit olmayan şüphesi (yaş beyanı, okul ifadesi vb.) → oyun hakkında bilgi verilmez, devredilir, bayrak konur.
- **G6:** Limit **yükseltme** veya kaldırma talepleri yapay zekâ tarafından kolaylaştırılmaz. İnsan ve bekleme süresi politikası uygulanır.

**Para ve vaatler**
- **G7:** Ödeme, çekim, iade, bonus tanımı, bahis sonucu düzeltme için **söz/garanti/süre taahhüdü yok**. Yalnızca "genellikle", "politikamıza göre" ifadeleri kullanılır.
- **G8:** Faz 1'de yapay zekâ hesap durumu hakkında **doğrulanmış bilgi varmış gibi konuşamaz** ("kontrol ettim", "sistemde görünüyor" yasak).
- **G9:** **Bahis/oyun tavsiyesi yok:** Hangi maça/oyuna oynanacağı, "kazandıran slot", RTP'ye dayalı strateji, "şimdi yatırırsan" yasak. RTP gibi genel bilgi istenirse bilgi bankasındaki resmi metin verilir.
- **G10:** Mükerrer yatırımı teşvik etmek ("bir daha deneyin") yasaktır.

**Veri gizliliği ve güvenlik**
- **G11:** Şifre, tek kullanımlık kod (OTP/SMS kodu), tam kart numarası, CVV, internet bankacılığı bilgileri, kripto özel anahtarı ve seed phrase **asla istenmez**. Oyuncu paylaşırsa mesaj maskelenir/redakte edilir ve uyarı verilir.
- **G12:** KYC belgeleri yalnızca tenant'ın tanımladığı güvenli kanaldan alınır. Sohbet içinde belge kabulü tenant ayarına bağlıdır. Yapay zekâ belge içeriğini yorumlayıp "onaylandı" demez.
- **G13:** Hesap bilgisi değişikliği, hesap ele geçirme şüphesi, çoklu hesap veya fraud/AML şüphesi → insana devir. Yapay zekâ AML/risk kontrollerini **açıklamaz** (tipping-off riski). "Hesabınız güvenlik incelemesinde" gibi nötr ifade kullanılır.

**Yasal / bölgesel**
- **G14:** Erişim engeli aşma (VPN, ayna site, "güncel adres") yönlendirmesi platform düzeyinde tenant politikasına bağlanmalı ve hukuki değerlendirme gerektirir. Türkiye'de lisanssız çevrimiçi bahis/kumar hizmeti suç kapsamındadır. Varsayılan ayar: yapay zekâ engel aşma yöntemi önermez.
- **G15:** Şikâyet ve itirazlar → resmi şikâyet prosedürü ve ADR bilgisi verilir, insana devredilir. Karmaşık şikâyetler yapay zekâda kalmaz (CGA).

**Şeffaflık ve tutarlılık**
- **G16:** Oyuncuya yapay zekâ ile konuştuğu söylenir. "İnsanla görüşmek istiyorum" talebi her zaman karşılanır (en fazla 1 netleştirme sorusu sorulabilir).
- **G17:** Bilgi bankasında yanıt yoksa uydurmak yerine "bu konuda kesin bilgi veremiyorum" denir ve devredilir.
- **G18:** Aynı soruya tutarlı yanıt verilmelidir. Yapay zekâ çözüm önerileri örneklemle denetlenir (CGA tutarlılık şartı).
- **G19:** Hakaret/tehdit karşısında yapay zekâ sakin kalır, iki uyarıdan sonra devreder.

**Kaynaklar (Bölüm 4):**
- CGA Responsible Gaming Policy (PDF): https://gobiernu.cw/wp-content/uploads/2025/05/CGA-responsible-gaming-policy.pdf
- CGA Player Complaints Policy Guidelines v1.1 (kopya): https://europeangaming.eu/portal/latest-news/2025/06/18/185027/player-complaints-policy-guidelines-version-1-1-18th-june-2025/
- CGA portalı yayın: https://portal.gamingcontrolcuracao.org/uploads/publications/A95NYeh4Ux7oTAPaOFditIfEGUQkAq89sl8pc5mc.pdf
- Curaçao şikâyet kuralları haberi: https://www.curacaochronicle.com/post/local/curacao-gaming-authority-tightens-oversight-with-new-complaint-rules-for-online-casinos · https://sigma.world/news/curacao-gambling-dispute-resolution-laws/
- Curaçao RG politika danışması: https://www.yogonet.com/international/news/2025/02/27/96435-curacao-regulator-seeks-feedback-on-responsible-gaming-policy
- MGA ADR Directive: https://www.mga.org.mt/mga-publishes-alternative-dispute-resolution-adr-directive/
- MGA PPD değişiklikleri: https://www.mondaq.com/gaming/1358788/gaming-%7C-what-are-the-recent-changes-to-the-player-protection-directive · https://gvzh.mt/insights/gaming-what-recent-changes-player-protection-directive
- UKGC müşteri etkileşimi (ikincil): https://sbcnews.co.uk/europe/uk/2022/04/14/ukgc-to-apply-new-rulebook-on-customer-care-duties/ · https://sbcnews.co.uk/latestnews/2022/06/21/ukgc-issues-guidance-on-inbound-consumer-protection-demands/ · https://igamingfuture.com/managing-responsible-gambling-in-light-of-the-new-uk-customer-interaction-guidance/
- Yapay zekâ ve sorumlu oyun yorumu: https://sigma.world/news/ai-gambling-support-70-percent/
- Birincil doğrulama için: https://www.gamblingcommission.gov.uk (Remote customer interaction guidance)
- Barone vd. 2026 (Sisal sohbetleri): https://publicatt.unicatt.it/handle/10807/334666 (DOI: 10.1007/s10899-026-10500-8)
- Online casinoda kayıp kovalama metrikleri (2022): https://link.springer.com/article/10.1007/s10899-022-10144-4
- Haefeli vd. 2011: https://ideas.repec.org/a/taf/intgms/v11y2011i3p273-288.html
- LLM ile problemli kumar tespiti: https://arxiv.org/pdf/2312.00804
- GambleAware/PwC uzaktan kumar araştırması: https://www.gambleaware.org/our-research/publication-library/articles/remote-gambling-research-interim-report-on-phase-1/

---

## 5. Kalite kontrol ve metrikler

### 5.1 Neden "containment" yetmez
Containment (insan devreye girmedi) ile resolution (sorun gerçekten çözüldü) farklı şeylerdir. Vazgeçen veya çıkmaza giren oyuncu da "contained" sayılır. Bir örnekte containment %72,6 iken gerçek çözüm %35,2'dir. Intercom Fin, "assumed resolution" kavramıyla oyuncu bir şey sormadan ayrılırsa çözülmüş sayar. Bu durum **yanlış çözüm (false resolution)** üretebilir. Zendesk ise automated resolution'ı LLM ile doğruladığını belirtir (ikincil kaynak). iGaming'de "para yatmadı" diye yazıp yanıt alamayan oyuncu çoğu zaman başka kanaldan tekrar yazar ya da siteyi terk eder. Bu yüzden **tekrar temas** kritik bir sinyaldir.

### 5.2 Önerilen metrik seti (SiyahTuş paneli)
| Metrik | Tanım | Not / hedef yönü |
|---|---|---|
| **Onaylı çözüm oranı** | Oyuncunun "çözüldü" onayı verdiği yapay zekâ konuşmaları / tüm yapay zekâ konuşmaları | Ana başarı metriği |
| **Varsayılan çözüm oranı** | Oyuncu ayrıldı, devir ve tekrar temas yok | Ayrı raporlanır, doğrudan başarı sayılmaz |
| **Yanlış çözüm oranı** | Varsayılan/onaylı çözümlerden, QA örneklemde "çözülmemiş" bulunan veya **72 saat içinde aynı niyetle tekrar temas** eden oran | iGaming için kritik. Düşmeli |
| **Containment** | İnsan devreye girmedi | Tek başına KPI değildir |
| **Devir oranı + devir nedenleri** | Niyet ve neden dağılımı (zorunlu devir, oyuncu talebi, bilgi yok, anlaşılamadı, duygu) | "Bilgi yok" nedeni içerik boşluğu demektir |
| **Devir kalitesi** | İnsan ajanın devir özetini "yeterli" işaretleme oranı. Ajanın oyuncuya aynı soruları tekrar sorma oranı | Faz 1'in asıl değeri burada |
| **Zorunlu devir uyumu** | G1–G5, G13, G15 tetiklenip devredilen / tetiklenmesi gereken (QA ile) | **%100 hedef**. Her ihlal olay kaydıdır |
| **Guardrail ihlali** | Yasaklı ifade, söz verme, hassas veri isteme | Otomatik tarama + QA |
| **BSAT / CSAT** | Yapay zekâ konuşmasında 1–5 puan. İnsan CSAT'ından ayrı (Zendesk modeli) | Devredilen konuşmalarda ayrı ölçülür |
| **Netleştirme verimliliği** | Prosedürün zorunlu alanlarını toplamak için gereken tur sayısı | Az tur, iyi deneyim |
| **İlk yanıt ve devir sonrası bekleme süresi** | Oyuncu insan ajana ne kadar sürede ulaştı | Mesai dışı ayrı |
| **Çözülemeyen soru kümeleri** | Haftalık küme listesi (hacim, terk, devir) | İçerik backlog'unu besler |
| **Tutarlılık skoru** | Aynı niyet + benzer girdilerde verilen çözüm/yanıt kalıbının aynı olma oranı | CGA tutarlılık şartı |

### 5.3 QA süreci önerisi
1. **Örneklem:** Haftalık rastgele %5–10 yapay zekâ konuşması. Buna ek olarak **%100 inceleme** yapılacaklar: risk bayrağı (sorumlu oyun/reşit olmayan) olanlar, düşük BSAT, 72 saatte tekrar temas, guardrail tarayıcısının işaretledikleri.
2. **Puan kartı (rubrik):** (a) Doğru niyet, (b) zorunlu bilgiler toplandı, (c) bilgi bankasına sadık ve uydurma yok, (d) guardrail uyumu, (e) doğru zamanda devir, (f) devir özeti eksiksiz, (g) ton. Zendesk autoQA ve Sierra hakem modeline benzer biçimde bir LLM ön puanlama yapar, Ekip Lideri onaylar.
3. **Koçluk döngüsü:** QA bulgusu → kural/bilgi/prosedür değişiklik taslağı → simülasyon senaryosuna eklenir (regresyon) → onay → yayın (versiyon).
4. **Kalibrasyon:** Ayda bir, ekip liderleri aynı 20 konuşmayı puanlar ve sapmalar konuşulur.
5. **Uyum kaydı:** Sorumlu oyun etkileşimlerinin ve devirlerin denetlenebilir kaydı tutulur (UKGC "değerlendirme kanıtı" ve CGA "yapay zekâ kayıtlarının izlenmesi" beklentisi).

**Kaynaklar (Bölüm 5):**
- Containment vs resolution: https://kaizo.com/blog/what-is-containment-rate/ · https://kaizo.com/blog/containment-rate/ · https://www.whizdom.ai/insights/containment-is-not-resolution
- Fin resolution tanımı (ikincil): https://aimdoc.ai/blog/intercom-resolution-pricing-explained
- Zendesk automated resolutions / BSAT: https://support.zendesk.com/hc/en-us/articles/6970583409690 · https://support.zendesk.com/hc/de/articles/8357749459482 · https://eesel.ai/blog/zendesk-ai-agent-metrics-to-track-automated-resolutions (ikincil)
- Zendesk QA / autoQA (ikincil): https://www.eesel.ai/blog/zendesk-qa-quality-assurance

---

## 6. SiyahTuş için kısa karar önerileri
1. Veri modelini 5 katmanlı kurun (Bilgi, Kurallar, Prosedür, Araç yuvası, Devir). Faz 1'de Araç katmanı boş kalsa da şema hazır olsun.
2. Ödeme yöntemi, bonus ve KYC bilgilerini **yapılandırılmış tablo** olarak alın, serbest metin olarak değil. Yanlış yanıtların büyük kısmı burada önlenir.
3. Guardrail'lerin temel setini platform düzeyinde kilitleyin. Tenant ekleyebilsin, kaldıramasın.
4. Her prosedür için simülasyon senaryosu olmadan yayın yapılmasın (taslak → test → onay → yayın, versiyonlu).
5. Faz 1 KPI'ı "containment" değil **devir kalitesi + yanlış çözüm oranı + zorunlu devir uyumu** olsun.
