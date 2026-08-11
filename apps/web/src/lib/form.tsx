/**
 * The one form-validation primitive (FR-EK-A.1).
 *
 * Every screen used to validate its own inputs by hand — an ad-hoc `!value.trim()`
 * here, a bespoke email regex there, submit buttons disabled by whatever boolean
 * the author happened to write. That drift is what this module ends: one place
 * that decides what "valid" means, one place that owns field-level error text,
 * and one rule for when Submit is allowed. It is deliberately a small hook plus a
 * handful of validators rather than a heavyweight schema library — the frontend
 * needs field-under errors and a disabled Submit, not a second type system.
 *
 * A validator answers one question about one string: it returns `null` when the
 * value is acceptable, or the message to show underneath the field when it is
 * not. Validators compose in order, first failure wins.
 */
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';

/** Returns `null` for a valid value, or the field-under error message otherwise. */
export type Validator = (value: string) => string | null;

/** Runs validators in order and returns the first message, so rules read top-to-bottom. */
export function compose(...validators: Validator[]): Validator {
  return (value) => {
    for (const validate of validators) {
      const message = validate(value);
      if (message) return message;
    }
    return null;
  };
}

export function required(message = 'This field is required.'): Validator {
  return (value) => (value.trim() ? null : message);
}

export function minLength(length: number, message?: string): Validator {
  return (value) =>
    value.trim().length >= length ? null : (message ?? `Enter at least ${length} characters.`);
}

// One address shape, shared by `email` and `emailList`: a local part, an @, and a
// dotted domain — enough to reject typos without pretending to be RFC 5322.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(message = 'Enter a valid email address.'): Validator {
  return (value) => (EMAIL.test(value.trim()) ? null : message);
}

/** Splits however addresses were pasted — commas, newlines or spaces. */
export function splitList(raw: string): string[] {
  return raw
    .split(/[,\n\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * A textarea of addresses. Empty is an error (nothing to send), and any single
 * bad address is an error that names the offenders — so the person fixes the
 * typo rather than guessing which of ten lines the server will reject.
 */
export function emailList(
  options: {
    emptyMessage?: string;
    invalidMessage?: (bad: string[]) => string;
  } = {},
): Validator {
  const emptyMessage = options.emptyMessage ?? 'Enter at least one email address.';
  const invalidMessage =
    options.invalidMessage ?? ((bad) => `Not a valid address: ${bad.join(', ')}`);
  return (raw) => {
    const addresses = splitList(raw);
    if (addresses.length === 0) return emptyMessage;
    const bad = addresses.filter((address) => !EMAIL.test(address));
    return bad.length > 0 ? invalidMessage(bad) : null;
  };
}

/**
 * A hostname, e.g. `shop.example` — at least two dot-separated labels of letters,
 * digits and hyphens. Kept permissive on purpose: `widget-check-7.localhost` is a
 * perfectly good domain to install a widget on during development.
 */
export function domain(message = 'Enter a valid domain, like shop.example.'): Validator {
  return (value) => {
    const host = value.trim().toLowerCase();
    if (!host || /[\s/@]/.test(host)) return message;
    const labels = host.split('.');
    if (labels.length < 2) return message;
    const wellFormed = labels.every(
      (label) => /^[a-z0-9-]+$/.test(label) && !label.startsWith('-') && !label.endsWith('-'),
    );
    return wellFormed ? null : message;
  };
}

export interface SubmitHelpers<V extends Record<string, string>> {
  /** Pin a server-reported problem onto one field (e.g. "email already invited"). */
  setFieldError: (name: keyof V, message: string | null) => void;
  /** A form-level problem with no single field to blame (auth, network). */
  setSubmitError: (message: string | null) => void;
  reset: () => void;
}

export interface UseFormOptions<V extends Record<string, string>> {
  initial: V;
  /** A validator per field that needs one; fields without one are always valid. */
  validators?: Partial<Record<keyof V, Validator>>;
  onSubmit: (values: V, helpers: SubmitHelpers<V>) => void | Promise<void>;
}

export interface UseFormResult<V extends Record<string, string>> {
  values: V;
  setValue: (name: keyof V, value: string) => void;
  /** Mark a field visited, so its error surfaces once the person has left it. */
  blur: (name: keyof V) => void;
  /** The message to render under a field: server error first, else the validation
   *  error once the field is touched or a submit has been attempted; else null. */
  errorFor: (name: keyof V) => string | null;
  setFieldError: (name: keyof V, message: string | null) => void;
  /** Every field passes its validator right now (independent of touched state). */
  isValid: boolean;
  /** A value differs from its initial — the basis for a discard-changes guard. */
  isDirty: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  setSubmitError: (message: string | null) => void;
  /** `isValid && !isSubmitting` — bind straight to a Submit button's `disabled`. */
  canSubmit: boolean;
  handleSubmit: (event?: FormEvent) => void;
  reset: () => void;
}

/**
 * Owns the state a validated form actually has: values, which fields the person
 * has touched, server-reported field errors, and whether a submit is in flight.
 * Validation is derived, never stored, so the errors can never lie about the
 * current values.
 */
export function useForm<V extends Record<string, string>>(
  options: UseFormOptions<V>,
): UseFormResult<V> {
  const { initial, validators, onSubmit } = options;

  const [values, setValues] = useState<V>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof V, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<keyof V, string>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validationErrors = useMemo<Partial<Record<keyof V, string>>>(() => {
    const errors: Partial<Record<keyof V, string>> = {};
    if (validators) {
      for (const key of Object.keys(validators) as (keyof V)[]) {
        const validate = validators[key];
        const message = validate?.(values[key] ?? '');
        if (message) errors[key] = message;
      }
    }
    return errors;
  }, [values, validators]);

  const isValid = Object.keys(validationErrors).length === 0;
  const isDirty = (Object.keys(initial) as (keyof V)[]).some((key) => values[key] !== initial[key]);
  const canSubmit = isValid && !isSubmitting;

  function setValue(name: keyof V, value: string): void {
    // The stored value is always a string; the cast only re-narrows it to a
    // field whose type may be a string union (a select), which stays this
    // library's single concession to keeping call sites cast-free.
    setValues((current) => ({ ...current, [name]: value }) as V);
    // A keystroke answers a server complaint about that field — clear it so a
    // stale "already invited" does not sit under a freshly corrected address.
    setServerErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function blur(name: keyof V): void {
    setTouched((current) => ({ ...current, [name]: true }));
  }

  function setFieldError(name: keyof V, message: string | null): void {
    setServerErrors((current) => {
      const next = { ...current };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }

  function errorFor(name: keyof V): string | null {
    const server = serverErrors[name];
    if (server) return server;
    if (touched[name] || submitAttempted) return validationErrors[name] ?? null;
    return null;
  }

  function reset(): void {
    setValues(initial);
    setTouched({});
    setServerErrors({});
    setSubmitAttempted(false);
    setSubmitError(null);
    setIsSubmitting(false);
  }

  function handleSubmit(event?: FormEvent): void {
    event?.preventDefault();
    setSubmitAttempted(true);
    // Show every field's error at once, not one blur at a time.
    setTouched(
      (Object.keys(initial) as (keyof V)[]).reduce<Partial<Record<keyof V, boolean>>>(
        (acc, key) => ({ ...acc, [key]: true }),
        {},
      ),
    );
    if (!isValid) return;

    setIsSubmitting(true);
    setSubmitError(null);
    const helpers: SubmitHelpers<V> = { setFieldError, setSubmitError, reset };
    void Promise.resolve()
      .then(() => onSubmit(values, helpers))
      .catch(() => setSubmitError('Something went wrong. Please try again.'))
      .finally(() => setIsSubmitting(false));
  }

  return {
    values,
    setValue,
    blur,
    errorFor,
    setFieldError,
    isValid,
    isDirty,
    isSubmitting,
    submitError,
    setSubmitError,
    canSubmit,
    handleSubmit,
    reset,
  };
}

/**
 * The field-under error line. One component so every form spells "invalid" the
 * same way — same colour, same `role="alert"`, same id an input's
 * `aria-describedby` can point at — instead of each screen inventing its own.
 */
export function FieldError({
  id,
  message,
}: {
  id?: string;
  message: string | null;
}): ReactElement | null {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-danger">
      {message}
    </p>
  );
}
