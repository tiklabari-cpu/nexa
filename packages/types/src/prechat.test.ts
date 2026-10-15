import { describe, expect, it } from 'vitest';
import { DEFAULT_PRECHAT_CONFIG, normalizePrechatConfig, prechatAsksAnything } from './widget.js';

describe('normalizePrechatConfig (WG-01)', () => {
  it('reads anything unusable as today’s form: open, four required fields', () => {
    for (const input of [null, undefined, 'x', 42, {}, { fields: 'no' }]) {
      expect(normalizePrechatConfig(input)).toEqual(DEFAULT_PRECHAT_CONFIG);
    }
  });

  it('keeps valid values and fills the missing ones per field', () => {
    const config = normalizePrechatConfig({
      enabled: false,
      fields: { username: { visible: true, required: false }, email: { visible: 'yes' } },
    });
    expect(config.enabled).toBe(false);
    expect(config.fields.username).toEqual({ visible: true, required: false });
    expect(config.fields.email).toEqual({ visible: true, required: true });
    expect(config.fields.name).toEqual({ visible: true, required: true });
  });

  it('never leaves a hidden field required', () => {
    const config = normalizePrechatConfig({ fields: { name: { visible: false, required: true } } });
    expect(config.fields.name).toEqual({ visible: false, required: false });
  });

  it('does not share the default object with its caller', () => {
    const config = normalizePrechatConfig(null);
    config.fields.name.required = false;
    expect(DEFAULT_PRECHAT_CONFIG.fields.name.required).toBe(true);
  });
});

describe('prechatAsksAnything (WG-01)', () => {
  const allHidden = normalizePrechatConfig({
    fields: {
      name: { visible: false },
      username: { visible: false },
      email: { visible: false },
      message: { visible: false },
    },
  });

  it('is off when the form is switched off, custom questions or not', () => {
    expect(prechatAsksAnything({ ...DEFAULT_PRECHAT_CONFIG, enabled: false }, 3)).toBe(false);
  });

  it('is off when every built-in field is hidden and there are no custom questions', () => {
    expect(prechatAsksAnything(allHidden, 0)).toBe(false);
    expect(prechatAsksAnything(allHidden, 1)).toBe(true);
    expect(prechatAsksAnything(DEFAULT_PRECHAT_CONFIG, 0)).toBe(true);
  });
});
