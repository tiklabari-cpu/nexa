# ADR — SMTP taşıyıcısı: depoda yazılan oturum, kütüphane değil

- **Görev:** tm 255.3 (PILOT-MAIL-SMTP) · PLAN.md §D178
- **Tarih:** 2026-09-22
- **Durum:** Kabul edildi (pencere kararı; görev detayı bu kararı pencereye bıraktı).
- **Yöntem:** nodemailer 10.0.10'un (npm'deki en son sürüm, 2026-09-22) yayımlanmış kaynağı okundu (`dist/esm/smtp-connection/index.js`). Hiçbir SMTP sunucusuna bağlanılmadı; bütün doğrulama `apps/api/test/helpers/fake-smtp-server.ts`'e karşı, 127.0.0.1 üzerinde, gerçek TLS ile yapıldı. Bu dosyada hiçbir sır değeri yoktur.
- **PRD:** FR-MOD-00.3 (şifre sıfırlama e-postası) · FR-MOD-04.4 (davet e-postası) · FR-MOD-08.2 (e-posta bildirimleri) · NFR-S9 (aktarımda TLS 1.2+).

## 0. Karar — tek tabloda

| #   | Soru                       | Cevap                                                                                                                                                                                                                              |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Kütüphane mi, el yazımı mı | **El yazımı** (`node:net` + `node:tls`). Yeni runtime bağımlılığı YOK, `pnpm-lock.yaml` değişmedi.                                                                                                                                 |
| 2   | Belirleyici gerekçe        | Teslim güvencesi (§2): "sonlandırıcı `.` yazıldı mı" bilgisi olmadan hem "zaman aşımı → geçici, yeniden dene" hem "250'den sonra asla ikinci DATA yok" aynı anda sağlanamıyor; nodemailer bu bilgiyi hata yüzeyinde vermiyor.      |
| 3   | TLS                        | Zorunlu. `SMTP_SECURE=true` → ilk bayttan TLS (465); `false` → STARTTLS zorunlu (587), sunmayan sunucu kimlik bilgisi gönderilmeden reddedilir. `rejectUnauthorized: true` açıkça yazılı; kapatan bir ayar YOK. En az TLS 1.2.     |
| 4   | AUTH                       | PLAIN (sunulursa) → LOGIN. İkisi de yoksa kalıcı hata; kimliksiz gönderim yok. Yalnız TLS'ten sonra.                                                                                                                               |
| 5   | MIME                       | Tek `text/plain; charset=utf-8` parça, quoted-printable (RFC 2045 §6.7). Konu ASCII değilse RFC 2047 `B` kodlu, satır ≤ 76, karakter bölünmez. Konudaki CR/LF boşluğa çevrilir (başlık enjeksiyonu). Dot-stuffing SMTP katmanında. |
| 6   | Hata ayrımı                | `TransientMailError` (`retryable: true`) · `PermanentMailError` (`retryable: false`). 255.4 bu tipe göre davranır (§3).                                                                                                            |
| 7   | Yeniden deneme             | Yalnız geçici hatada; 1 s'den üstel, 8 s tavan, toplam 3 deneme (webhook burst deseni). Mesaj bir kez kurulur: her denemede aynı `Message-ID`.                                                                                     |

## 1. Kütüphanenin gerçekten sağladığı

nodemailer olgun, bağımlılıksız (MIT-0) ve STARTTLS/implicit TLS, AUTH PLAIN/LOGIN/CRAM-MD5/XOAUTH2, RFC 2047 ve QP/base64 MIME kodlamasını yıllardır sahada taşıyor. Görevin saydığı dört eksenin üçünde (TLS, AUTH, MIME) kütüphane el yazımından **daha** güvenilir bir başlangıç noktası — bu kabul ediliyor, küçümsenmiyor. Karar bu üç eksende değil, dördüncüsünde verildi: hatanın **nerede** olduğunu bilmek.

## 2. Belirleyici eksen: hata hangi aşamada oldu

Görevin kalbi olan iki kural birbirine bağlı:

- Test stratejisi (6): zaman aşımı **geçici** tiptir ve yeniden denenir.
- Test stratejisi (7): sunucu mesajı kabul ettikten sonra hiçbir koşulda ikinci DATA gönderilmez.

İkisini birden sağlamanın tek yolu, sonlandırıcı `.`'nın yazılıp yazılmadığını bilmektir. Yazılmadan önceki bir zaman aşımı güvenle yeniden denenir (sunucuda hiçbir şey yok). Yazıldıktan sonra `250`'yi beklerken olan bir zaman aşımında ise sunucu mesajı **almış olabilir**. Yeniden denemek, tek kullanımlık token taşıyan bir davet ya da şifre sıfırlama e-postasının iki kez gitmesi demektir.

nodemailer 10.0.10 bu ayrımı hata yüzeyinde vermiyor (ölçüldü, `dist/esm/smtp-connection/index.js`):

- `_onTimeout()` (satır 846–847) her aşamada `new Error('Timeout')`, `code: 'ETIMEDOUT'`, `command: 'CONN'` üretir. Bağlantı zaman aşımı ile "`.` gönderildi, cevap yok" aynı hatadır.
- `_onClose()` (satır 803–823) beklenmedik kapanışı her aşamada `ECONNECTION` / `'CONN'` olarak bildirir.
- `_formatError()` (satır 773–795) sunucu cevabını `err.message`'a ekler (`message += ': ' + response`). RCPT reddi çoğu sunucuda alıcı adresini geri yansıtır, yani hata mesajı log'a PII taşır. Bu, ayrıca bir temizlik katmanı gerektirirdi.

Kütüphaneyle kalıp kuralı korumanın iki yolu vardı, ikisi de kötü: (a) iç durum alanlarına (`_responseActions`, `_envelope`) bakmak, yani yayımlanmamış bir API'ye bağlanmak; (b) her zaman aşımını kalıcı saymak, yani (6)'yı ve bağlantı düzeyindeki en yaygın geçici hataları feda etmek. Depoda yazılan oturumda bu bilgi tek bir alandır (`smtp-session.ts` `#handedOver`, `.` yazılmadan hemen önce kurulur).

İkincil gerekçeler: depo geleneği, dış servislere depoda yazılan kodla ulaşmaktır (`s3-store.ts` SigV4, `createHttpWebhookSender`). Gereken protokol alt kümesi de küçüktür: tek parça, sekiz başlık, yedi komut.

## 3. Hata sözlüğü (255.4 bunu okur)

"Kalıcı", **sonuca** göre değil **yeniden denemeye** göre tanımlıdır: bu taşıyıcı o mesajı bir daha göndermeyecek.

| `code`            | Tip                     | Ne zaman                                                                                                     |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timeout`         | geçici                  | Bağlantı, karşılama ya da bir komutun cevabı `SMTP_TIMEOUT_MS` içinde gelmedi (mesaj teslim edilmeden önce). |
| `connection`      | geçici                  | Bağlantı açılamadı ya da mesaj teslim edilmeden önce koptu.                                                  |
| `rejected`        | 4xx geçici · 5xx kalıcı | Bir adımı reddeden SMTP cevabı.                                                                              |
| `auth`            | 454 geçici · 5xx kalıcı | AUTH reddi (535 dahil) ya da ortak mekanizma yok.                                                            |
| `tls`             | kalıcı                  | Sertifika doğrulanmadı, ana makine adı uyuşmadı, STARTTLS sunulmadı ya da el sıkışma başarısız oldu.         |
| `protocol`        | kalıcı                  | SMTP'nin o noktada izin vermediği bir cevap; STARTTLS'ten sonra düz metin enjeksiyonu.                       |
| `unconfirmed`     | kalıcı                  | `.` yazıldı, `250` gelmedi (zaman aşımı/kopma). Mesaj teslim edilmiş **olabilir**; en fazla bir kez.         |
| `invalid_message` | kalıcı                  | Alıcı adres değil. Hiçbir sunucuya bağlanılmadı.                                                             |

`250`'den sonra olan hiçbir şey (QUIT'e cevap gelmemesi, kopma) gönderimi başarısız saymaz.

## 4. Log ve sır sınırı

- Olaylar pino ile yazılır: `smtp.attempt` (debug) · `smtp.accepted` (info) · `smtp.retry` (warn) · `smtp.failed` (error). Alanlar: host, port, secure, kind, attempt, messageId, code, phase, smtpCode, enhancedCode, TLS sürümü.
- **Alıcı adresi, konu ve gövde hiçbir alanda yok.** Sunucu cevap metni yalnız temizlendikten sonra tutulur: alıcı (büyük/küçük harf fark etmeksizin), kimlik bilgileri (düz ve base64, telde geçtikleri biçimlerde), sonra `maskPii`, sonra 200 karakter sınırı.
- `SMTP_SECRET_LOG_PATHS` (`SMTP_USERNAME`/`SMTP_PASSWORD`, `smtp.*`, `mail.smtp.*`; üst düzeyde ve bir alt düzeyde) sunucunun pino `redact.paths` listesine eklendi. Sunucu artık mailer'ı Fastify'dan **sonra** kurar, böylece taşıyıcı aynı logger'ı (akış, seviye, redaction) kullanır. `*:run` betikleri stderr'e yazan, aynı redaction'lı bir pino alır.
- Yan bulgu (düzeltildi): sunucunun `censor` fonksiyonu `path.join('.')` kullanıyordu. `*.` ile başlayan bir yol, pino'nun Symbol anahtarlı alanlarını da gezer ve `join` Symbol'de patlar, yani log çağrısının tamamı düşer. `path.map(String).join('.')` yapıldı.

## 5. Kapsam dışı (bilerek)

Mailer arayüzü ve dokuz çağrı yeri değişmedi. Kuyruk/outbox tablosu, bounce/complaint webhook'u, gelen e-posta, SPF/DKIM/DMARC DNS kaydı (kod değil, sahibin işi; herkese açık pilotta kayıt açılmadan önceki kapı olarak `docs/production-checklist.md` §9'da), HTML şablonlar, SMTPUTF8 (ASCII dışı adres) ve CRAM-MD5/XOAUTH2 kapsam dışıdır. PrivateEmail PLAIN/LOGIN sunar ve pilot adresleri ASCII'dir. Hata durumunda çağrı yerinin davranışı tm 255.4'tür.
