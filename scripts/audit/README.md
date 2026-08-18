# §F.1 audit scanners

PLAN.md §F.0/§F.1'in maddelerini **ölçen** betikler (ilk yazımı: tm 126 · GL-9 Faz-3 kapanış
turu; kalıcı komutlarla çağrılabilir hale getirildi: tm 132.4). Prose bir denetim raporu yeniden
koşulamaz; bunlar koşulabilir. Hepsi salt-okunurdur — hiçbiri dosya yazmaz.

| Betik                  | §F.1 maddesi | Komut                         | Ne ölçer                                                                                                                                                                                                                |
| ---------------------- | :----------: | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sweep.cjs`            |      1       | `pnpm audit:sweep`            | PRD §6'nın 138 `FR-MOD` satırını çıkarır ve her birinin PLAN'daki damgasını bulur. Hücre-bazlı okur (glif saymaz — §D68–§D77'nin yanlış-pozitif tarihçesi).                                                             |
| `schema-consumers.cjs` |      4       | `pnpm audit:schema-consumers` | `schema.prisma`'daki her modelin `apps/api` + `apps/rtm` kaynağında tüketicisi var mı. Ham SQL / SECURITY DEFINER ile okunan tabloları yanlış-pozitif verir — §8'in GL-9 notuna bak.                                    |
| `silent-debt.cjs`      |      6       | `pnpm audit:silent-debt`      | `TODO`/`FIXME`/`XXX`/`HACK`/`@ts-expect-error`/`@ts-ignore`/`.skip`/`.only`/`eslint-disable` taraması, izlenen tüm kaynakta.                                                                                            |
| `dead-code.cjs`        |      7       | `pnpm audit:dead-code`        | Referanssız api route'u, web `features/` modülü ve api servisi. CLI girişleri (`package.json` script'leri) yanlış-pozitif çıkar.                                                                                        |
| `endpoint-ui.cjs`      |      7       | `pnpm audit:endpoint-ui`      | Sözleşmedeki hangi path'in web/widget/mobile'da çağıranı yok (önce `pnpm contract:generate` gerekir). Başsız-tasarım uçlarını (SCIM, IdP ACS, sağlayıcı webhook'ları, public KB) ayırt etmez — sonucu elle sınıflandır. |

Kökten koş: `pnpm audit:<ad>` (ör. `pnpm audit:sweep`) veya doğrudan `node scripts/audit/<betik>`.
Bulguların değerlendirmesi HANDOFF'un ilgili turunun §F.1 bölümündedir (ilk tam koşu: `## 126` bloğu).
