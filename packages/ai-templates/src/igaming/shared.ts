/**
 * What several iGaming templates write the same way (tm 311.2 · AI-15): the
 * player's username, the crypto-method test, the "örnek — doğrulayın" rows the
 * scenarios run on and the forbidden phrases every money topic carries. Types
 * only from outside the package, like the rest of the entry point's graph.
 */
import type { Cond } from '@siyahtus/types';
import type {
  ScenarioOption,
  TemplateForbiddenPhrase,
  TemplateScenario,
  TemplateSlot,
} from '../catalogue.js';

/** The username slot: who the player is on the site, never verified by the AI. */
export function usernameSlot(): TemplateSlot {
  return {
    name: 'kullanici_adi',
    label: 'Kullanıcı adı / üye no',
    type: 'username',
    ask: 'Sitedeki kullanıcı adınızı ya da üye numaranızı yazar mısınız?',
    pii: 'low',
  };
}

/**
 * A crypto method, by the name the tenant's table gives it. The table has no
 * "is crypto" column (AI-13), so the name decides; the checklist tells the
 * tenant to name crypto methods so.
 */
export const CRYPTO_METHOD =
  'USDT|[Uu]sdt|[Kk]ripto|[Cc]rypto|TRC20|ERC20|BEP20|BTC|[Bb]itcoin|[Tt]ether';

/** The named enum slot holds a crypto method. */
export function cryptoMethod(slot: string): Cond {
  return { slot: { name: slot, op: 'matches', value: CRYPTO_METHOD } };
}

/** The scenarios' facts, one table row's "örnek — doğrulayın" values. */
export type ScenarioFacts = TemplateScenario['facts'];

/** The deposit methods a scenario's player may name. */
export function depositMethodOptions(): ScenarioOption[] {
  return [
    { value: 'Papara' },
    { value: 'Havale', aliases: ['eft', 'fast'] },
    { value: 'USDT (TRC20)', aliases: ['usdt', 'tether'] },
  ];
}

/** The withdrawal methods a scenario's player may name. */
export function withdrawalMethodOptions(): ScenarioOption[] {
  return [
    { value: 'Papara' },
    { value: 'Havale', aliases: ['eft', 'fast', 'banka'] },
    { value: 'USDT (TRC20)', aliases: ['usdt', 'tether'] },
  ];
}

/** The bonuses a scenario's player may name. */
export function bonusOptions(): ScenarioOption[] {
  return [
    { value: 'Hoş geldin bonusu', aliases: ['hoş geldin', 'hosgeldin', 'ilk yatırım bonusu'] },
    { value: 'Kayıp bonusu', aliases: ['kayıp', 'cashback'] },
    { value: 'Haftalık free spin', aliases: ['free spin', 'freespin', 'spin'] },
  ];
}

/** "The AI saw the account" — G8, in every money topic's own list. */
export function unverifiedStatusPhrases(): TemplateForbiddenPhrase[] {
  return [
    {
      phrase: 'kontrol ettim',
      match: 'word',
      why: 'Yapay zekâ hiçbir sistemi kontrol etmez (G8).',
    },
    {
      phrase: 'sistemde görünüyor',
      match: 'word',
      why: 'Doğrulanmış bilgi varmış gibi konuşmak yasak (G8).',
    },
  ];
}
