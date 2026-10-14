# 06 — Kullanım Kılavuzu

> Bu klasör, SiyahTuş'u (nexa-main) LiveChat, ChatBot.com ve piyasadaki AI destek ajanlarıyla karşılaştıran ve sisteme eklenebilecekleri çıkaran analiz paketidir. Tarih: 2026-10-14.
> Bu kılavuz şunları anlatıyor: hangi dosya ne işe yarar, hangi sırayla okunmalı, sorular nasıl cevaplanır, bir madde kodlatılmak istenirse nasıl ilerlenir.

---

## 1. Klasör yapısı

```
SiyahTus-Analiz/
├─ 01-nexa-mevcut-durum.md        Sistemimizde (nexa-main) bugün olanlar, ayrıntılı
├─ 02-diger-sistemler.md          Diğer sistemlerde olanlar, başlıklar halinde
├─ 03-eklenebilecekler.md         Eklenebilecek 109 madde, başlıklı liste (ana liste)
├─ 04-gerekceler-ve-sorular.md    Her maddenin sebebi, gerekçesi ve sana soruları (+ Karar kaydı)
├─ 05-uygulama-rehberi.md         Her maddenin alanı, kod karşılığı ve kodlama mantığı
├─ 06-kullanim-kilavuzu.md        Bu dosya
└─ kaynaklar/                     Ham keşif ve araştırma raporları (kanıtlar)
   ├─ livechat-kesif-raporu.md    LiveChat'in ekran ekran BFS dökümü (~2.700 satır)
   ├─ eksikler.md                 LiveChat ↔ nexa karşılaştırma tabloları (561 satır, kod kanıtlı)
   ├─ nexa-ozellikler.md          nexa özellik envanteri (ürün, ön yüz, backend)
   ├─ nexa-ai-motoru.md           nexa AI motorunun bugün nasıl çalıştığı (kod incelemesi)
   ├─ nexa-kimlik-modeli.md       nexa Chat/Thread/üye kimliği, arama ve loglar (kod incelemesi)
   ├─ igaming-ai-arastirma.md     Sektör araştırması: vendor modeli, 20 iGaming konusu, uyum kuralları, kalite ölçümü (kaynak linkli)
   └─ chatbot/
      ├─ chatbot-uygulama.md      ChatBot.com uygulamasının dökümü
      └─ chatbot-builder.md       ChatBot.com bot oluşturma ve builder dökümü
```

## 2. Dosyalar nasıl birbirine bağlı?

Bütün maddelerin **kalıcı bir kimliği** var (ör. `AI-03`, `ID-02`, `WG-01`). Aynı kimlik üç dosyada geçiyor:

| Dosya | Maddede ne var | Kimin için |
|---|---|---|
| **03** | Kısa tanım, öncelik (P0/P1/P2), faz (F1/F2), efor (S/M/L), kaynak | Sen: genel resim, önceliklendirme |
| **04** | Ne, neden gerekli, gerekçe/kanıt, yapılmazsa ne olur, bağımlılıklar, **sorular** | Sen: karar verme |
| **05** | Panelde nerede, bugünkü kod, değişecek katmanlar, kodlama mantığı, kabul kriterleri, riskler | Kodlama yapan AI / teknik ekip |

Bir maddeyi bulmak için dosyada kimliğini arayın (Ctrl+F `AI-03`).

**Kimlik önekleri:**

| Önek | Bölüm |
|---|---|
| AI | AI Agent çekirdeği |
| ID | Thread ID / Chat ID, gün içi hafıza, aranabilir kayıtlar |
| RL | Roller ve yetkiler |
| IN | Inbox |
| AR | Arşiv |
| HD | HelpDesk |
| WG | Widget ve sohbet ayarları |
| EN | Kampanyalar |
| RP | Raporlar |
| AU | Otomasyon ve yönlendirme |
| KN | Kanallar ve entegrasyonlar |
| BL | Faturalama |
| GV | Güvenlik, altyapı ve UX dersleri |

**Öncelik:**
- **P0:** pilot ve iGaming kullanımı için şart. 42 madde.
- **P1:** önemli. 57 madde.
- **P2:** olsa iyi olur. 10 madde.

**Faz:**
- **F1:** şimdi. AI yalnızca konuşur, entegrasyon yok.
- **F2:** iGaming platform entegrasyonlarından (BetConstruct, EveryMatrix vb.) sonra.

## 3. Önerilen okuma sırası

1. **03-eklenebilecekler.md:** Önce listenin tamamına göz at; özet tablo ve 13 bölüm 10 dakikada okunur.
2. **04-gerekceler-ve-sorular.md:** En baştaki **"Önce cevaplanması gereken kararlar"** tablosu (K1–K16). Bu kararlar birçok maddeyi etkiliyor.
3. İlgilendiğin maddelerin 04'teki "Neden gerekli" ve "Netleştirilecek sorular" kısımları.
4. **01** ve **02:** Bir maddenin arka planını merak edersen. 01'in başındaki §A–§H özeti 5 dakikada okunur.
5. **05:** Yalnızca teknik ayrıntı gerektiğinde. Ya da doğrudan kodlama yapacak AI'a verilir.

## 4. Soruları nasıl cevaplarım?

- 04'te toplam **245 soru** var. Hepsinin yanında **"Önerilen varsayılan"** yazılı. Hiçbirini cevaplamasan da iş ilerleyebilir; kodlayan AI varsayılanı kullanır ve görev notuna yazar.
- **Durum (2026-10-14):** K1–K16 cevaplandı ve 04'teki tabloya işlendi. K4, K9, K13 ve K15'in maddelere etkisi 04'teki "Kararların maddelere etkisi" bölümünde.
- **Mutlaka cevaplaman önerilenler** K1–K16. Bunlar 04'ün başında tablo halinde duruyor; özellikle şunlar önemli:
  - **K1:** Thread ID / Chat ID modeli
  - **K4:** farklı cihazdan gelen üyenin nasıl tanınacağı (güvenlik)
  - **K7:** izin matrisi
  - **K9:** "önce AI" mı, paralel mi
  - **K13:** erişim adresi sorularında AI ne diyecek (hukuki)
- **Cevabı yazma yeri:** 04'ün başındaki tablonun **"Senin cevabın"** sütunu. Madde içindeki başka bir soruyu cevaplamak istersen tabloya yeni bir satır ekle (ör. `| K17 | AI-03 S3: konu değişince ne olsun | AI-03 | … | cevabın |`). Tablo, maddelerdeki varsayılanların önüne geçer.
- İstersen soruları bana (Claude) sohbette de cevaplayabilirsin; tabloya ben işlerim.

## 5. Bir maddeyi kodlatmak istersem

nexa-main'in kendi kuralları var (`CLAUDE.md`): tek orkestratör, contract-first, Task Master görevi, DoD kapısı. Kodlayan AI'a aşağıdaki gibi bir istem vermen yeterli:

```
nexa-main üzerinde şu maddeyi uygula: <MADDE-ID> (ör. IN-01).
Önce şunları oku:
- C:\Users\Hobbie\Desktop\SiyahTus-Analiz\03-eklenebilecekler.md (madde ve sabit kararlar)
- C:\Users\Hobbie\Desktop\SiyahTus-Analiz\04-gerekceler-ve-sorular.md (Karar kaydı tablosu + maddenin bölümü)
- C:\Users\Hobbie\Desktop\SiyahTus-Analiz\05-uygulama-rehberi.md ("Uygulayıcı için kurallar" + maddenin bölümü)
- Repo kuralları: CLAUDE.md, MASTER-PROMPT.md, CONVENTIONS.md
05'teki kodlama mantığını ve kabul kriterlerini esas al; kod referanslarını yeniden doğrula.
Karar kaydında cevabı olmayan sorularda "Önerilen varsayılan"ı kullan ve görev notuna yaz.
Madde için bir Task Master görevi aç, DoD kapısından geçir, commit et.
Bağımlı olduğu maddeler bitmemişse önce bana söyle.
```

**Önerilen başlangıç dalgası** (bağımlılık sırasıyla; ayrıntısı 05'in başında):
1. **Hemen yapılabilir, küçük ama kritik:**
   - IN-01 (taslağın ve dosyanın yanlış oyuncuya gitmesi)
   - WG-01, WG-02
   - RL-04 (davette varsayılan rol)
   - GV-03 (davet kötüye kullanımı)
   - AI-16 (gerçek LLM'in açılması)
2. **Temel:** ID-01…ID-04 (Thread/Chat modeli ve gün sınırı), ID-08 (karar logu), GV-02 (kalıcı AI kuyruğu)
3. **AI çekirdeği:** AI-11, AI-01, AI-02, AI-04, AI-03, AI-05…AI-10, AI-12, AU-01
4. **iGaming bilgi modeli:** AI-13, AI-14, AI-15
5. **Test, yayın ve kalite döngüsü:** AI-19…AI-25

## 6. Kod incelemesinde çıkan, dikkat edilmesi gereken bulgular

Bunlar karşılaştırmadan bağımsız olarak nexa'da bulunan sorunlar. Her biri ilgili maddenin 04 ve 05 bölümlerinde ayrıntılı anlatılıyor.

| Bulgu | Madde |
|---|---|
| Inbox'ta yazılan taslak ve eklenen dosya başka oyuncunun sohbetine geçebiliyor | IN-01 |
| Sohbet açılır açılmaz ajana atanıyor; AI ile ajan aynı sohbette paralel çalışıyor | AI-11 |
| AI'ın devir özeti kaydediliyor ama Inbox'ta hiçbir yerde görünmüyor | AI-10 |
| Kimse çevrimiçi değilken takıma devir hatayla bitiyor; takıma transfer edilen sohbet kimseye atanmadan, kuyruk dışında kalıyor | AI-12, IN-04 |
| AI cevap kuyruğu bellekte; çökmede kayıp, birden fazla sunucuda çift cevap riski | GV-02 |
| Kuyruk şirket genelinde tek sıra; Sorumlu Oyun'da bekleyen sohbet Finans'ı da bekletiyor | AU-01 |
| İnsan ajan yokken AI açık olsa bile widget "mesaj bırakın" formuna düşüyor | WG-09 |
| Tarayıcısını kapatan ajan "sohbet kabul ediyor" görünmeye devam ediyor | WG-03, RP-03 |
| Kuyruğa giriş zamanı siliniyor; geçmiş bekleme süreleri kayboluyor | RP-04 |
| Widget token uç noktası herkese açık; üyenin müşteri ID'sini bilen biri açık sohbetini okuyabilir | ID-03 |
| Davetle açılan hesaplar e-postası doğrulanmış sayılıyor | GV-03 |
| Devredilmiş ama ajanın hiç yazmadığı sohbetler "AI çözümü" diye faturalanıyor | AI-11 (ADR-09) |
| Sohbet kapanınca transkript oyuncuya sorulmadan ve her zaman İngilizce gidiyor | WG-06, WG-02 |
| Rapor PDF'inde ğ, ş, ı ve İ harfleri "?" oluyor; raporlarda gün sınırı UTC | AR-04, AR-02 |
| Türkçe klavyede AltGr ve noktalı İ, kısayolları ve ayar aramasını bozuyor | IN-08, IN-11 |
| Kampanyanın "geçerli sayfa" koşulu, ziyaretçinin gezdiği tüm sayfalara bakıyor; sohbet açmamış ziyaretçide sayfa bilgisi sunucuya ulaşmıyor | EN-04, EN-03 |
| Commit'lenmemiş `customer_username` işi (44 dosya) `main` üzerinde bekliyor | ID-03 |

## 7. Dikkat ve sınırlar

- **Kod referansları** 2026-10-14 tarihli koddan okundu. Kod değiştikçe satır numaraları kayabilir; 05 uygulayıcıya yeniden doğrulamasını söylüyor.
- **Efor tahminleri** kabadır (S ≈ 1–2 gün, M ≈ 1 hafta, L > 1 hafta).
- **Hukuki konular** tavsiye niteliğinde değildir ve hukukçuya danışılmalıdır: AI-08/G14 erişim engeli, KVKK yurt dışı aktarım (AI-16), Curaçao şikâyet yönergesindeki AI maddeleri (ikincil kaynaktan doğrulandı, resmi PDF'ten teyit edilmeli).
- **iGaming konu sırası** (20 konu) kamuya açık veriye dayanmıyor. Kiracıların kendi sohbet etiketleriyle doğrulaması önerilir.
- **Keşif sırasında hesaplarda oluşan test verileri:**
  - **LiveChat:**
    - İki ürün turu tamamlandı.
    - Home kontrol listesinde iki madde işaretlendi.
    - Copilot'a otomatik sorular gitti.
    - 13 gün geçerli bir davet linki üretildi.
    - "untitled_445" adlı bir workflow taslağı oluşmuş olabilir.
    - "Quality of customer support" ayarı bir an kapatılıp açıldı; son değeri değişmedi.
  - **ChatBot.com:**
    - İki "CLAUDE-TEST …" bot oluşturuldu. Kanala bağlı değiller, ama ChatBot.com bunları "Published" durumunda açtı.
    - "Customer Service Bot — Newsletter" segmenti oluştu.
    - İstersen bunları silebilirsin.
- **Ham raporlar** (`kaynaklar/`) İngilizce arayüz metinlerini birebir içerir; ChatBot.com yalnızca İngilizce arayüzüyle incelendi.
