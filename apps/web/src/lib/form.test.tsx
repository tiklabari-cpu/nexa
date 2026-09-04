/**
 * The form primitive: proves the validators decide "valid" the same way for
 * every screen, and the hook gates Submit and surfaces field-under errors.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  cardLast4,
  compose,
  domain,
  email,
  emailList,
  minLength,
  optional,
  required,
  splitList,
  useForm,
} from './form.js';

describe('validators', () => {
  it('required rejects blank and whitespace, accepts content', () => {
    const rule = required('Needed.');
    expect(rule('')).toBe('Needed.');
    expect(rule('   ')).toBe('Needed.');
    expect(rule('x')).toBeNull();
  });

  it('email rejects malformed addresses', () => {
    expect(email()('nope')).not.toBeNull();
    expect(email()('a@b')).not.toBeNull();
    expect(email()('a@b.com')).toBeNull();
    expect(email()('  a@b.com  ')).toBeNull();
  });

  it('minLength counts trimmed characters', () => {
    expect(minLength(3)('ab')).not.toBeNull();
    expect(minLength(3)('abc')).toBeNull();
  });

  it('splitList separates on commas, spaces and newlines', () => {
    expect(splitList('a@b.com, c@d.com\n e@f.com')).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
    expect(splitList('   ')).toEqual([]);
  });

  it('emailList names the offenders and rejects an empty list', () => {
    expect(emailList()('')).toBe('Enter at least one email address.');
    expect(emailList()('a@b.com, broken')).toBe('Not a valid address: broken');
    expect(emailList()('a@b.com, c@d.com')).toBeNull();
  });

  it('domain accepts real hostnames including localhost, rejects the rest', () => {
    expect(domain()('shop.example')).toBeNull();
    expect(domain()('widget-check-7.localhost')).toBeNull(); // dev domains must pass (E2E)
    expect(domain()('shop-123.example')).toBeNull();
    expect(domain()('nodots')).not.toBeNull();
    expect(domain()('has space.com')).not.toBeNull();
    expect(domain()('https://x.com')).not.toBeNull(); // a URL is not a domain
  });

  it('cardLast4 accepts exactly 4 digits, rejects the rest', () => {
    expect(cardLast4()('1234')).toBeNull();
    expect(cardLast4()('')).not.toBeNull();
    expect(cardLast4()('123')).not.toBeNull();
    expect(cardLast4()('12345')).not.toBeNull();
    expect(cardLast4()('12a4')).not.toBeNull();
  });

  it('optional lets a blank value pass but still enforces format when set', () => {
    const rule = optional(email('bad'));
    expect(rule('')).toBeNull();
    expect(rule('   ')).toBeNull();
    expect(rule('nope')).toBe('bad');
    expect(rule('a@b.com')).toBeNull();
  });

  it('compose returns the first failing message, in order', () => {
    const rule = compose(required('first'), minLength(5, 'second'));
    expect(rule('')).toBe('first');
    expect(rule('ab')).toBe('second');
    expect(rule('abcde')).toBeNull();
  });
});

describe('useForm', () => {
  const setup = (onSubmit = vi.fn()) =>
    renderHook(() =>
      useForm({
        initial: { name: '' },
        validators: { name: required('Name is required.') },
        onSubmit,
      }),
    );

  it('starts invalid and blocks submit while a field fails', () => {
    const { result } = setup();
    expect(result.current.isValid).toBe(false);
    expect(result.current.canSubmit).toBe(false);
    // …but hides the error until the person has touched the field.
    expect(result.current.errorFor('name')).toBeNull();
  });

  it('reveals the error on blur and clears it once valid', () => {
    const { result } = setup();
    act(() => result.current.blur('name'));
    expect(result.current.errorFor('name')).toBe('Name is required.');

    act(() => result.current.setValue('name', 'Robin'));
    expect(result.current.errorFor('name')).toBeNull();
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.isDirty).toBe(true);
  });

  it('does not submit an invalid form, but surfaces every error', () => {
    const onSubmit = vi.fn();
    const { result } = setup(onSubmit);
    act(() => result.current.handleSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.errorFor('name')).toBe('Name is required.'); // submit reveals it
  });

  it('submits a valid form with the current values', async () => {
    const onSubmit = vi.fn();
    const { result } = setup(onSubmit);
    act(() => result.current.setValue('name', 'Robin'));
    await act(async () => result.current.handleSubmit());
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Robin' }, expect.anything());
  });

  it('shows a server-set field error until the field changes', () => {
    const { result } = setup();
    act(() => result.current.setValue('name', 'Robin'));
    act(() => result.current.setFieldError('name', 'Already taken.'));
    expect(result.current.errorFor('name')).toBe('Already taken.');

    act(() => result.current.setValue('name', 'Robbie'));
    expect(result.current.errorFor('name')).toBeNull(); // a keystroke clears the stale complaint
  });

  it('reset returns to the initial values and clears state', () => {
    const { result } = setup();
    act(() => result.current.setValue('name', 'Robin'));
    act(() => result.current.setSubmitError('boom'));
    act(() => result.current.reset());
    expect(result.current.values).toEqual({ name: '' });
    expect(result.current.submitError).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });
});
