# §F.1 audit scanners (tm 126 · GL-9 Faz-3 kapanış turu)

Faz-3'ün §F.00 kapanış turunda §F.1'in maddelerini **ölçen** betikler. Prose bir denetim
raporu yeniden koşulamaz; bunlar koşulabilir. Hepsi salt-okunurdur — hiçbiri dosya yazmaz.

| Betik                  | §F.1 maddesi | Ne ölçer                                                                                                                                                                             |
| ---------------------- | :----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sweep.cjs`            |      1       | PRD §6'nın 138 `FR-MOD` satırını çıkarır ve her birinin PLAN'daki damgasını bulur. Hücre-bazlı okur (glif saymaz — §D68–§D77'nin yanlış-pozitif tarihçesi).                          |
| `schema-consumers.cjs` |      4       | `schema.prisma`'daki her modelin `apps/api` + `apps/rtm` kaynağında tüketicisi var mı. Ham SQL / SECURITY DEFINER ile okunan tabloları yanlış-pozitif verir — §8'in GL-9 notuna bak. |
| `silent-debt.cjs`      |      6       | `TODO`/`FIXME`/`XXX`/`HACK`/`@ts-expect-error`/`@ts-ignore`/`.skip`/`.only`/`eslint-disable` taraması, izlenen tüm kaynakta.                                                         |
| `dead-code.cjs`        |      7       | Referanssız api route'u, web `features/` modülü ve api servisi. CLI girişleri (`package.json` script'leri) yanlış-pozitif çıkar.                                                     |
| `endpoint-ui.cjs`      |      7       | Sözleşmedeki hangi path'in web/widget/mobile'da çağıranı yok. Başsız-tasarım uçlarını (SCIM, IdP ACS, sağlayıcı webhook'ları, public KB) ayırt etmez — sonucu elle sınıflandır.      |

Kökten koş: `node .audit-tm126/<betik>`. Bulguların değerlendirmesi HANDOFF'un
`## 126` bloğundaki §F.1 bölümündedir.
