import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SENSITIVE_POLICY,
  SENSITIVE_TYPES,
  SENSITIVE_WARNING_LANGUAGES,
  SENSITIVE_WARNING_TEXTS,
  isSensitiveType,
  sensitiveWarningText,
  sensitiveWarningTypes,
  sharesAccountSecret,
} from './sensitive-data.js';

describe('DEFAULT_SENSITIVE_POLICY (AI-26-S2)', () => {
  it('masks every type in a player message', () => {
    expect([...DEFAULT_SENSITIVE_POLICY.customer].sort()).toEqual([...SENSITIVE_TYPES].sort());
  });

  it('masks the account secrets in staff and bot messages, never the IBAN', () => {
    for (const author of ['agent', 'bot'] as const) {
      expect([...DEFAULT_SENSITIVE_POLICY[author]].sort()).toEqual(
        ['card', 'cvv', 'otp', 'password', 'private_key', 'seed_phrase'].sort(),
      );
      expect(DEFAULT_SENSITIVE_POLICY[author]).not.toContain('iban');
    }
  });
});

describe('warning and AI-context helpers', () => {
  it('warns about every secret but not an IBAN, once each, in catalogue order', () => {
    expect(sensitiveWarningTypes(['otp', 'iban', 'card', 'otp'])).toEqual(['card', 'otp']);
    expect(sensitiveWarningTypes(['iban'])).toEqual([]);
  });

  it('flags a shared password or one-time code for the AI context', () => {
    expect(sharesAccountSecret(['card', 'otp'])).toBe(true);
    expect(sharesAccountSecret(['password'])).toBe(true);
    expect(sharesAccountSecret(['card', 'iban', 'seed_phrase'])).toBe(false);
  });

  it('recognises the catalogue and nothing else', () => {
    expect(isSensitiveType('seed_phrase')).toBe(true);
    expect(isSensitiveType('phone')).toBe(false);
    expect(isSensitiveType(null)).toBe(false);
  });
});

describe('sensitiveWarningText', () => {
  it('has a text for every warning language', () => {
    for (const language of SENSITIVE_WARNING_LANGUAGES) {
      expect(SENSITIVE_WARNING_TEXTS[language].length).toBeGreaterThan(40);
    }
  });

  it("speaks the player's language, by primary subtag", () => {
    expect(sensitiveWarningText('tr')).toBe(
      'Güvenliğiniz için şifre, SMS kodu veya kart bilgilerinizi paylaşmayın. Mesajınızdaki bu bilgiyi gizledik.',
    );
    expect(sensitiveWarningText('en-GB')).toBe(SENSITIVE_WARNING_TEXTS.en);
    expect(sensitiveWarningText('RU')).toBe(SENSITIVE_WARNING_TEXTS.ru);
    expect(sensitiveWarningText('az_AZ')).toBe(SENSITIVE_WARNING_TEXTS.az);
  });

  it('falls back rather than skipping the warning', () => {
    expect(sensitiveWarningText('ja')).toBe(SENSITIVE_WARNING_TEXTS.tr);
    expect(sensitiveWarningText(null)).toBe(SENSITIVE_WARNING_TEXTS.tr);
    expect(sensitiveWarningText(undefined, 'en')).toBe(SENSITIVE_WARNING_TEXTS.en);
  });
});
