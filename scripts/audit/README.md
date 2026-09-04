# §F.1 audit scanners

PLAN.md §F.0/§F.1'in maddelerini **ölçen** betikler (ilk yazımı: tm 126 · GL-9 Faz-3 kapanış
turu; kalıcı komutlarla çağrılabilir hale getirildi: tm 132.4). Prose bir denetim raporu yeniden
koşulamaz; bunlar koşulabilir. Hepsi salt-okunurdur — hiçbiri dosya yazmaz.

| Betik                  |  §F.1 maddesi  | Komut                         | Ne ölçer                                                                                                                                                                                                                                   |
| ---------------------- | :------------: | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sweep.cjs`            |       1        | `pnpm audit:sweep`            | PRD §6'nın 138 `FR-MOD` satırını çıkarır ve her birinin PLAN'daki damgasını bulur. Hücre-bazlı okur (glif saymaz — §D68–§D77'nin yanlış-pozitif tarihçesi).                                                                                |
| `schema-consumers.cjs` |       4        | `pnpm audit:schema-consumers` | `schema.prisma`'daki her modelin `apps/api` + `apps/rtm` kaynağında tüketicisi var mı. Ham SQL / SECURITY DEFINER ile okunan tabloları yanlış-pozitif verir — §8'in GL-9 notuna bak.                                                       |
| `silent-debt.cjs`      |       6        | `pnpm audit:silent-debt`      | `TODO`/`FIXME`/`XXX`/`HACK`/`@ts-expect-error`/`@ts-ignore`/`.skip`/`.only`/`eslint-disable` taraması, izlenen tüm kaynakta.                                                                                                               |
| `dead-code.cjs`        |       7        | `pnpm audit:dead-code`        | Referanssız api route'u, web `features/` modülü ve api servisi. CLI girişleri (`package.json` script'leri) yanlış-pozitif çıkar.                                                                                                           |
| `endpoint-ui.cjs`      |       7        | `pnpm audit:endpoint-ui`      | Sözleşmedeki hangi path'in web/widget/mobile'da çağıranı yok (önce `pnpm contract:generate` gerekir). Başsız-tasarım uçlarını (SCIM, IdP ACS, sağlayıcı webhook'ları, public KB) ayırt etmez — sonucu elle sınıflandır.                    |
| `unpaged-lists.cjs`    |     NFR-P5     | `pnpm audit:unpaged-lists`    | `apps/web/src`'te sabit `limit` ile yapılıp aynı istekte imleç (`page_id`/`before_event_id`/`after_event_id`) taşımayan liste çağrıları. Sayfalaması OLMAYAN uçlar da `limit` alır — bunlar `paging-exempt:` ile muaf tutulur (aşağı bak). |
| `req-coverage.cjs`     | CONVENTIONS §7 | `pnpm audit:req-coverage`     | `prd-uyum-denetimi.md` Ek A'nın 247 satırını, test başlıklarındaki gereksinim etiketleriyle kesiştirir: **hangi kabul kriterini kimse üstlenmemiş**. Etiketin kriteri DOĞRU ölçtüğünü göremez (aşağı bak). `--json` makine biçimini verir. |

Kökten koş: `pnpm audit:<ad>` (ör. `pnpm audit:sweep`) veya doğrudan `node scripts/audit/<betik>`.
Bulguların değerlendirmesi HANDOFF'un ilgili turunun §F.1 bölümündedir (ilk tam koşu: `## 126` bloğu).

## `unpaged-lists.cjs` — tek nöbetçi, tek istisna (tm 153.7)

Diğer beşi **rapor**; bu **kapı**: bulgu varsa `process.exitCode = 1`. Gerekçe P5-PAGE'in
kapattığı kusurun şeklidir — bir liste tek sayfa isteyip tek sayfa alır ve onu her şeymiş gibi
çizer. Ekran dolu, satırlar doğru, çoğu geliştirme çalışma alanında elli birinci satır hiç yok:
kusur "bozuk" gibi okunmaz. Her zaman 0 dönen bir denetim bunun geri gelmesini engellemez.

**Muafiyet:** çağrının en fazla on satır üstünde `paging-exempt: <gerekçe>` içeren bir yorum.
Gerekçe zorunludur — gerekçesiz işaret yokmuş sayılır. Bugün beş muafiyet var: iki type-ahead
(`CommandPalette` müşteri/bilet aramaları), bir sayaç (`AppShell` Leads pill, `limit=1` yalnız
`total` için), bir "son çalıştırma" rozeti (`ScheduledExports`) ve `CommandPalette`'in sohbet
araması — sonuncusu gerçek bir sınır (yalnız en yeni 50 sohbet aranabiliyor) ve gerekçesi
sayfalamanın onu kaldırmayacağını, `GET /chats`'e `query` parametresi gerektiğini yazıyor.

**Sezgisel, ve nerede durduğu:** metin okur, tip okumaz — çağrı yerinde kurulmayan bir `limit`
görünmez, hiç `limit` almayan bir uç da (sunucunun varsayılan sayfası devreye girer) hakkında
bir şey söylemez. "Aynı istek" ±8 satır olarak yaklaşıklanır. Yalnız `apps/web/src` taranır:
widget'ta liste yok, mobil kendi sayfa boyunu kendi taşır.

## `req-coverage.cjs` — kapsama raporu ve NE SATIN ALMADIĞI (tm 184.2)

CONVENTIONS §7 test başlığına bir gereksinim etiketi koyar; bu betik o etiketleri denetimin
247 satırlık kataloğuyla kesiştirir ve **kimsenin üstlenmediği maddeleri** listeler.
Bugünkü tablo: 246 ayrık madde (`NFR-C8` iki kez listelenmiş) → 8 muaf → **238 kapsamda,
75 etiketli, 163 etiketsiz**.

**Kritik okuma uyarısı — §7.7.** "Etiketsiz" **test edilmemiş demek DEĞİLDİR.** §7.5 kuralı
yalnız yeni/değişen testler için zorunlu kılar, 472 dosya geriye dönük etiketlenmez; 163 sayısı
bir kalite notu değil, bir **benimseme** ölçüsüdür. Ters yön de aynı derecede önemli: etiketli
bir madde, testin o kriteri **doğru** ölçtüğünü kanıtlamaz. Denetimin kendi dersi `FR-MOD-07.4`
— test yeşil, kriter yanlış, fixture kör; etiketli olsaydı burada da yeşil görünürdü. Bu betik
**iddiaları** sayar, iddiaların doğruluğunu değil.

**Muafiyet listesi (`WAIVERS`, betiğin içinde).** Yazılı bir karar varsa madde paydadan çıkar,
yoksa her koşuda kapanmış bir tartışma yeniden açılır. Karşı risk de gerçek — muafiyet borcun
saklandığı yerdir — o yüzden üç kural: (1) her muafiyet `reason` + `source` taşır, taşımayan
**hata** olarak raporlanır; (2) muaf maddeler kendi başlığı altında **yazdırılır**, asla
"kapsandı"ya karışmaz — `non-code` bir muafiyet (`NFR-C2` KVKK/VERBIS) kapanış DEĞİL, yalnız
"teste konu değil" demektir; (3) liste bilerek kısadır — bugün kodda karşılığı olmayan ama
istediğinin bir kısmı KOD olan maddeler (`NFR-C3` opt-out ucu, `NFR-C10` bildirim mekanizması,
`FR-MOD-06.6` kural-tabanlı bot) kasten paydada bırakıldı.

**Çıkış kodu.** Kapsama borcu bu betiği kırmızı YAPMAZ (§7.5 benimsemeyi kademeli kılıyor;
kalıcı kırmızı bir rapor okunmaz). Kırmızı yapan tek şey **raporun kendisi hakkında yalan
söylemesi**: katalogda olmayan bir ID'yi anan etiket, artık var olmayan bir madde için muafiyet,
gerekçesiz muafiyet, ya da satır sayısı `EXPECTED_ROWS`'tan sapmış bir katalog ayrıştırması.
Kapının CI'a bağlanması ayrı bir iştir (tm 184.3).

**§7.6'nın örnek komutuyla farkı — ölçüldü.** Betik grep'in bulduğu her yeri buluyor, artı 8
tanesini daha: §7.6'nın çıkarma adımı (`\(<ID>[^)]*\)`) katalog ID'sinin parantezin **başında**
olmasını şart koşuyor, §7.4 ise böyle bir sıra dayatmıyor — `(400, NFR-S8)` ve
`(M-LOAD-CAP · NFR-R2)` grep'e görünmez. Bu yüzden §7.1'in tablosu 74 madde / 141 dosya derken
betik **75 / 146** diyor. Ayrıca JS alternasyonu leftmost-**first** olduğu için §7.6'nın regex'i
birebir taşınırsa `FR-MOD-04.RBAC` → `FR-MOD-04.` olur; betik dallanmayı düzeltti.
