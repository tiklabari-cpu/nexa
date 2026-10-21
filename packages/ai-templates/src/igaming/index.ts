/**
 * The iGaming catalogue in Turkish (AI-15): the twenty templates, in the order
 * of {@link IGAMING_TEMPLATE_KEYS} (research §3), and the `igaming_core` pack
 * with its default rules, persona style and sample table rows. #311.1 shipped
 * the worked example; #311.2 the other nineteen and the pack's contents.
 */
import {
  IGAMING_TEMPLATE_KEYS,
  type AiTemplate,
  type AiTemplatePack,
  type IgamingTemplateKey,
} from '../catalogue.js';
import { ACCOUNT_DETAILS_CHANGE } from './account-details-change.js';
import { ACCOUNT_LOCKED } from './account-locked.js';
import { BET_SETTLEMENT_DISPUTE } from './bet-settlement-dispute.js';
import { BONUS_CLAIM } from './bonus-claim.js';
import { COMPLAINT_FORMAL } from './complaint-formal.js';
import { DEPOSIT_NOT_CREDITED } from './deposit-not-credited.js';
import { GAME_TECHNICAL_ISSUE } from './game-technical-issue.js';
import { KYC_DOCUMENTS } from './kyc-documents.js';
import { LIMIT_CHANGE } from './limit-change.js';
import { LOGIN_PASSWORD } from './login-password.js';
import { MULTI_ACCOUNT_THIRD_PARTY } from './multi-account-third-party.js';
import { IGAMING_DEFAULT_RULES, IGAMING_PERSONA_STYLE, IGAMING_SAMPLE_ROWS } from './pack.js';
import { PAYMENT_METHODS_INFO } from './payment-methods-info.js';
import { PROMOTION_INFO } from './promotion-info.js';
import { RESPONSIBLE_GAMBLING_SIGNAL } from './responsible-gambling-signal.js';
import { SELF_EXCLUSION } from './self-exclusion.js';
import { SITE_ACCESS } from './site-access.js';
import { WAGERING_RULES } from './wagering-rules.js';
import { WITHDRAWAL_PENDING } from './withdrawal-pending.js';
import { WITHDRAWAL_REJECTED } from './withdrawal-rejected.js';
import { WRONG_ACCOUNT_OR_NETWORK } from './wrong-account-or-network.js';

export { IGAMING_DEFAULT_RULES, IGAMING_PERSONA_STYLE, IGAMING_SAMPLE_ROWS } from './pack.js';

/** The package's version (`package.json`), which the pack carries — `package.test.ts` holds them equal. */
export const AI_TEMPLATES_PACKAGE_VERSION = '0.1.0';

const BY_KEY: Readonly<Record<IgamingTemplateKey, AiTemplate>> = {
  deposit_not_credited: DEPOSIT_NOT_CREDITED,
  withdrawal_pending: WITHDRAWAL_PENDING,
  withdrawal_rejected: WITHDRAWAL_REJECTED,
  kyc_documents: KYC_DOCUMENTS,
  bonus_claim: BONUS_CLAIM,
  wagering_rules: WAGERING_RULES,
  bet_settlement_dispute: BET_SETTLEMENT_DISPUTE,
  game_technical_issue: GAME_TECHNICAL_ISSUE,
  login_password: LOGIN_PASSWORD,
  account_locked: ACCOUNT_LOCKED,
  self_exclusion: SELF_EXCLUSION,
  responsible_gambling_signal: RESPONSIBLE_GAMBLING_SIGNAL,
  limit_change: LIMIT_CHANGE,
  payment_methods_info: PAYMENT_METHODS_INFO,
  wrong_account_or_network: WRONG_ACCOUNT_OR_NETWORK,
  promotion_info: PROMOTION_INFO,
  account_details_change: ACCOUNT_DETAILS_CHANGE,
  complaint_formal: COMPLAINT_FORMAL,
  site_access: SITE_ACCESS,
  multi_account_third_party: MULTI_ACCOUNT_THIRD_PARTY,
};

export const IGAMING_TEMPLATES_TR: readonly AiTemplate[] = IGAMING_TEMPLATE_KEYS.map(
  (key) => BY_KEY[key],
);

export const IGAMING_CORE_PACK: AiTemplatePack = {
  key: 'igaming_core',
  version: AI_TEMPLATES_PACKAGE_VERSION,
  industry: 'igaming',
  lang: 'tr',
  template_keys: IGAMING_TEMPLATES_TR.map((template) => template.key),
  default_rules: IGAMING_DEFAULT_RULES,
  persona_style: IGAMING_PERSONA_STYLE,
  sample_rows: IGAMING_SAMPLE_ROWS,
};

/** The template with this key, or null — what `GET /ai-templates/{key}` serves. */
export function igamingTemplate(key: string): AiTemplate | null {
  return IGAMING_TEMPLATES_TR.find((template) => template.key === key) ?? null;
}
