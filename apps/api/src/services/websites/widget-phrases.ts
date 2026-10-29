/**
 * A brand's own widget texts, per language (tm 344 · WG-05).
 *
 * Two readers share this file: the settings screen (`/settings/widget/phrases`)
 * and the token mint, which hands the widget the texts of the one language it
 * will show. The rules — which keys, how long, which placeholders — live in
 * `@siyahtus/types` (`WIDGET_PHRASE_RULES`), so the panel checks the same
 * thing before it sends.
 *
 * Inside the caller's transaction: RLS scopes every read and write to the
 * licence and, when the request names one, the brand.
 */
import { pickWidgetPhrases, type WidgetPhraseKey, type WidgetUiLocale } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

export interface BrandWidgetPhrases {
  phrases: Partial<Record<WidgetPhraseKey, string>>;
  /** The newest change among them; null when the language has none. */
  updatedAt: Date | null;
}

/** The brand's custom texts in `locale`. */
export async function readWidgetPhrases(
  tx: TenantClient,
  brandId: string,
  locale: WidgetUiLocale,
): Promise<BrandWidgetPhrases> {
  const rows = await tx.widgetPhrase.findMany({
    where: { brandId, locale },
    select: { key: true, text: true, updatedAt: true },
  });
  let updatedAt: Date | null = null;
  for (const row of rows) {
    if (updatedAt === null || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
  }
  return { phrases: pickWidgetPhrases(rows), updatedAt };
}

/**
 * Make `phrases` the brand's whole set for `locale`: a key left out goes back
 * to the widget's own text, a text that did not change keeps its timestamp.
 * `phrases` is already checked (`checkWidgetPhrases`).
 */
export async function replaceWidgetPhrases(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    brandId: string;
    locale: WidgetUiLocale;
    phrases: Partial<Record<WidgetPhraseKey, string>>;
  },
): Promise<{ changed: WidgetPhraseKey[]; reset: WidgetPhraseKey[] }> {
  const { licenseId, brandId, locale, phrases } = input;
  const current = await tx.widgetPhrase.findMany({
    where: { brandId, locale },
    select: { key: true, text: true },
  });
  const before = new Map(current.map((row) => [row.key, row.text]));
  const kept = Object.keys(phrases);

  const reset = current
    .map((row) => row.key)
    .filter((key) => !kept.includes(key)) as WidgetPhraseKey[];
  if (reset.length > 0) {
    await tx.widgetPhrase.deleteMany({ where: { brandId, locale, key: { in: reset } } });
  }

  const changed: WidgetPhraseKey[] = [];
  const now = new Date();
  for (const [key, text] of Object.entries(phrases) as Array<[WidgetPhraseKey, string]>) {
    if (before.get(key) === text) continue;
    changed.push(key);
    await tx.widgetPhrase.upsert({
      where: { licenseId_brandId_locale_key: { licenseId, brandId, locale, key } },
      create: { licenseId, brandId, locale, key, text, updatedAt: now },
      update: { text, updatedAt: now },
      select: { key: true },
    });
  }
  return { changed, reset };
}
