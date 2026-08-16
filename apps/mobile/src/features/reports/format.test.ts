import { formatCount, formatDuration, formatRate } from './format';

describe('formatCount', () => {
  it('groups thousands the way the runtime default locale does', () => {
    // No locale parameter here (unlike the web formatter) — the phone has no
    // i18n store yet — so this asserts against the same `Intl.NumberFormat`
    // call the function makes, rather than a hardcoded separator that would
    // be wrong under a non-`en` default ICU locale.
    expect(formatCount(1234567)).toBe(new Intl.NumberFormat().format(1234567));
  });

  it('returns null for absent or non-finite values, never a fabricated 0', () => {
    expect(formatCount(null)).toBeNull();
    expect(formatCount(undefined)).toBeNull();
    expect(formatCount(Number.NaN)).toBeNull();
  });
});

describe('formatRate', () => {
  it('renders a fraction as a rounded percentage', () => {
    expect(formatRate(0.873)).toBe('87%');
    expect(formatRate(1)).toBe('100%');
  });

  it('returns null rather than 0% for an unknown rate', () => {
    expect(formatRate(null)).toBeNull();
    expect(formatRate(undefined)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders seconds under a minute as seconds', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('renders minutes, dropping a zero-second remainder', () => {
    expect(formatDuration(134)).toBe('2m 14s');
    expect(formatDuration(120)).toBe('2m');
  });

  it('renders hours, dropping a zero-minute remainder', () => {
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h');
  });

  it('renders days, dropping a zero-hour remainder', () => {
    expect(formatDuration(90000)).toBe('1d 1h');
    expect(formatDuration(172800)).toBe('2d');
  });

  it('returns null for absent, negative or non-finite values', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});
