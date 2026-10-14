# ADR-08a — Kuyruk ekip başına, öncelik sırası, "Önce AI"da yönlendirme devir anında

- **Görev:** tm 271 (ADR-ROUTING-QUEUES) · PLAN.md §0 (ADR-08a eki) · §D220
- **Tarih:** 2026-10-14
- **Durum:** Kabul edildi — sahip kararı **K18** ("ADR-08a ve ADR-11a ekleri — ✅ Hepsi onaylı"), dayandığı kararlar **K9** ("Önce AI") ve **K14** (6 hazır kuyruk, Sorumlu Oyun silinemez) (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı).
- **Değiştirdiği karar:** ADR-08 (PLAN.md §0) — lafzı aynen kalır, bu ek yalnız "kuyruk" adımını ve yönlendirmenin **ne zaman** çağrıldığını tarif eder. ADR tablosunun satırı değişmedi.
- **Bağlı görevler:** tm 305 TEAM-TOPIC-QUEUES (AU-01) · tm 293 AI-FIRST-AND-SILENCE (AI-11) · tm 307 AI-HANDOFF-TARGET-PRIORITY (AI-12).
- **Kod değişikliği:** yok. Bu dosya yalnız kararı kayda geçirir; uygulamayı tm 305 / tm 293 / tm 307 yapar.

## 1. Bağlam

ADR-08: _"havuz → priority katmanı (primary>first>normal>last) → en az yüklü → `last_assigned_at ASC` → fallback → kuyruk"_.

Bugünkü uygulama (2026-10-14 HEAD'de yeniden doğrulandı, `apps/api/src/services/routing/routing-service.ts`):

- `route()` (`:114-171`) kural motoruyla grubu seçer (`#selectGroup` `:261`), grupta ajan arar (`#selectAgent` `:341`), bulamazsa yedek gruba bakar (`#fallbackGroup` `:315`), o da yoksa sohbeti kuyruğa alır. Sıra numarasını **lisans genelinde** verir (`#nextQueuePosition` `:407`).
- `drainQueue()` (`:179-241`) bekleyenleri lisans genelinde tek sırayla dolaşır ve ilk atanamayan sohbette durur (`:215` `if (!assignee) break;`). Sorumlu Oyun kuyruğunda bekleyen tek bir sohbet, boşta Finans ajanı olsa bile arkasındaki bütün sohbetleri bekletir: **ekipler arası baş-tıkanması**. Boşaltmada uzmanlık şartı da uygulanmıyor (yorum `:201-206`). `renumberQueue()` (`:244`) yine lisans genelinde.
- Sohbet açılırken yönlendirme hemen çağrılır (`apps/api/src/services/chat/chat-service.ts:398`), yani AI etkin olsa bile sohbet baştan bir ajana atanır ve AI ile ajan aynı sohbette paralel çalışır.
- Sohbet önceliği kavramı yok.

Üç analiz maddesi bu sırayı zorluyor: AU-01 kuyruğu ekip başına böler, AI-12 acil önceliği getirir, AI-11 "Önce AI" (K9) modunda yönlendirmeyi sohbet açılışından devir anına taşır. `SiyahTus-Analiz/05-uygulama-rehberi.md` "Uygulayıcı için kurallar" madde 4: kilitli karar sessizce delinmez, ilgili ADR'ye ek not yazılır. Bu dosya o ek nottur.

## 2. Karar

1. **Kuyruk = ekip.** Bir sohbet aynı anda tek bir ekibin kuyruğundadır: `threads.queue_group_id`. Görünürlüğü bugünkü gibi erişim grupları (`chat_access`) belirler, atama sırasını `queue_group_id` belirler. Sıra numarası, yeniden numaralandırma ve boşaltma **ekip başına** yapılır. Kuyruğa alınan sohbetin ekibi, yönlendirmenin seçtiği (ya da devirde verilen) ekiptir; yedek ekipte de ajan bulunamadıysa sohbet ilk seçilen ekibin kuyruğunda bekler.
2. **Ekip içinde sıra `priority DESC, queued_at ASC`.** "İlk eksikte dur" kuralı (`:215`) korunur ama **yalnız o ekip içinde** geçerlidir: bir ekip tıkanınca diğer ekiplerin boşaltılması sürer. Boşaltma ekip başına kısa işlemlerle yapılır, tek uzun işlem bütün kiracıyı kilitlemez. Boşaltmada ekibin gerekli yetenekleri uygulanır (bugünkü eksik kapanır).
3. **Öncelik üç seviyedir:**
   - `urgent` — G3 kendine zarar, G5 reşit olmayan şüphesi, G1 kendini dışlama (self-exclusion);
   - `high` — aynı gün tekrar gelen (`repeat_same_day`), öfkeli oyuncu (`angry`);
   - `normal` — diğerleri.

   Acil sohbet **kendi ekip kuyruğunun** başına geçer, başka ekibin kuyruğunu etkilemez. Sıralama seviyenin derecesine göre yapılır (`urgent > high > normal`); değerler metin olarak saklanırsa sözlük sırasıyla sıralanmaz (`'urgent' > 'normal' > 'high'` yanlış sonuç verir) — saklama biçimini ve tek tanımı tm 305 sabitler, AI-12 (tm 307) aynı tanımı kullanır.

4. **"Önce AI" (K9).** AI ajanı etkin ve kanal/marka için AI açıkken sohbet **atamasız ve kuyruk dışı** açılır (`assignee = null`, `queue_position = null`, `ai_mode = 'ai'`). Bu sohbet "atanmamış" ve "kuyrukta" görünümlerine girmez, ajanın eşzamanlı sohbet sınırını tüketmez. Yönlendirme **devir anında** çağrılır; hedef ekip ve öncelik AI-12'nin hedef çözücüsünden gelir. Hedef ekip verildiğinde havuz o ekiptir; çözücü ekip bulamazsa yönlendirme bugünkü gibi kurallara ve yedek gruba başvurur. AI'ın takıldığı sohbeti insana yönlendiren bekçi işi (AI-11, `ai_failure`) de aynı devir yolundan geçer. Kuyruk süresi (`queued_at`) devir anından başlar.
5. **"Paralel" mod kiracı ayarı olarak kalır** (`ai_handoff_settings.assignment_mode = 'ai_first' | 'parallel'`): yönlendirme bugünkü gibi sohbet açılışında çağrılır, AI ilk ajan mesajına kadar konuşur. Bu ek paralel modda yalnız 1–3. maddeleri (ekip kuyruğu, öncelik) değiştirir.
6. **Sorumlu Oyun (`topic_role = 'responsible_gambling'`) kuyruğunda yedek ekip zinciri YOK.** Uygun ajan yoksa sohbet o kuyrukta acil öncelikle bekler; Ekip Lideri ve Yöneticiye acil bildirim gider, oyuncuya destek kaynaklarını içeren sabit mesaj bir kez yazılır, mesai dışında talep kaydı açılır (AU-01 soru 3, AI-12 soru 2–3 varsayılanları). Uzmanlık şartı **iki yerde** uygulanır: ekibe üye eklenirken (eğitimsiz ajan 409) ve ajan seçilirken (savunma). Sorumlu Oyun sohbeti otomatik hiçbir yolla (yönlendirme, boşaltma, yedek grup, AI devri) başka ekibe ya da eğitimsiz ajana düşmez.
7. **K14 aynen:** 6 hazır kuyruk şablon olarak gelir (Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet). Şirket bunları yeniden adlandırabilir ve yenisini ekleyebilir; "Sorumlu Oyun" rolündeki kuyruk silinemez (yalnız adı değişir) ve ona yalnız eğitimli ajanlar üye olabilir. Şablon bir migration değildir, kullanıcının bilinçli eylemidir.
8. **Ajan seçme sırası DEĞİŞMEZ:** havuz → priority katmanı (primary>first>normal>last) → en az yüklü → `last_assigned_at ASC` → fallback (ADR-08 aynen). Bu ek yalnız "kuyruk" adımını (hangi kuyruk, hangi sıra) ve yönlendirmenin çağrılma anını değiştirir.
9. **Widget'taki "X. sıradasınız" artık oyuncunun ekip kuyruğundaki sırasıdır.** Bu bilinçli bir davranış değişikliğidir; `queue_positions_updated` push'u ekip bazında yayınlanır. Raporlar (RP-04) ve bekleme tahmini (WG-05) aynı `queue_group_id`'yi kullanır.

## 3. Sonuçlar

- **Uyumlu kalan:** ADR-08'in ajan seçme zinciri ve "kapasitesi dolu ajana yine de atama yapılmaz, kuyruğa alınır" ilkesi aynen geçerli.
- **Değişen:** kuyruk lisans geneli tek sıra olmaktan çıkar, ekip başına sıralanır; kuyrukta öncelik vardır; "Önce AI" modunda yönlendirme sohbet açılışında değil devir anında çalışır.
- **Adlandırma (varsayım):** konu rolleri tek listedir — `QUEUE_TOPIC_ROLES = ['finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint']` (tm 305, `@siyahtus/types`). 05'in AI-12 bölümü ve tm 307 aynı anahtarları `responsible_gaming` / `complaints` diye yazıyor ve listeye `trading`, `general` ekliyor; AI-12'nin konu rotaları bu tek listeden okur, liste genişleyecekse genişletme orada yapılır.
- **Faturalama ayrı:** devredilmiş sohbetin "AI çözümü" sayılmaması (K10) ADR-09'u değiştirir; o ek tm 272 (ADR-09a) işidir, bu dosyanın kapsamında değildir.
- **Açık kalan:** insanın Sorumlu Oyun sohbetini elle başka ekibe aktarması. AU-01 kabul kriteri "hiçbir koşulda" der; elle aktarımın kapatılıp kapatılmayacağını tm 305 / tm 306 (takıma aktarma arayüzü) karara bağlar.
- **Bu eki delen bir değişiklik** (ajan seçme sırasının değişmesi, Sorumlu Oyun için yedek ekip, kuyruğun yeniden kiracı geneline dönmesi) yeni bir ADR eki ve sahip kararı ister.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — AI-11, AI-12, AU-01 satırları.
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — Karar kaydı K9, K14, K18; § AI-11, § AI-12, § AU-01 ("Kilitli kararla ilişkisi", "Netleştirilecek sorular").
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — "Uygulayıcı için kurallar" madde 4; § AI-11 kodlama mantığı 3 ve 7; § AI-12 kodlama mantığı 2–3; § AU-01 kodlama mantığı.
- `SiyahTus-Analiz/07-gorev-plani.md` — #271 Dalga 0; K18 → #271, #273 → #293, #305, #307.
