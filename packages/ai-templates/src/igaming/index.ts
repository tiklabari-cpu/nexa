/**
 * The iGaming catalogue in Turkish (AI-15). #311.1 ships the worked example;
 * #311.2 adds the other nineteen and the `igaming_core` pack's default rules
 * and sample table rows.
 */
import type { AiTemplate, AiTemplatePack } from '../catalogue.js';
import { DEPOSIT_NOT_CREDITED } from './deposit-not-credited.js';

/** The package's version (`package.json`), which the pack carries — `package.test.ts` holds them equal. */
export const AI_TEMPLATES_PACKAGE_VERSION = '0.1.0';

export const IGAMING_TEMPLATES_TR: readonly AiTemplate[] = [DEPOSIT_NOT_CREDITED];

export const IGAMING_CORE_PACK: AiTemplatePack = {
  key: 'igaming_core',
  version: AI_TEMPLATES_PACKAGE_VERSION,
  industry: 'igaming',
  lang: 'tr',
  template_keys: IGAMING_TEMPLATES_TR.map((template) => template.key),
};

/** The template with this key, or null — what `GET /ai-templates/{key}` serves. */
export function igamingTemplate(key: string): AiTemplate | null {
  return IGAMING_TEMPLATES_TR.find((template) => template.key === key) ?? null;
}
