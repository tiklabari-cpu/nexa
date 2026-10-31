/**
 * The keyboard-shortcut register (IN-08).
 *
 * Until now the only document-level key listener was the palette's Ctrl+K, and
 * nothing said which keys the console answers to. This file is the one place
 * that does: every shortcut is a row in `SHORTCUTS`, one listener (mounted by
 * the shell, `useShortcutDispatcher`) reads the register, and the "?" window
 * lists the same rows — so the help can never describe a key that is not bound,
 * nor leave one out.
 *
 * **Combos.** `Mod+K`, `Alt+ArrowDown`, `Alt+Shift+U`, `?`. `Mod` is Ctrl, or ⌘
 * on a Mac (the console has always accepted either). A letter is matched on the
 * physical key (`event.code`, "KeyU") when the event has one, because on a Mac
 * ⌥U is a dead key whose `event.key` is not "u", and on a Turkish keyboard the
 * letter at that position is not the one the shortcut is named after.
 *
 * **What the register refuses** (`defineShortcuts` throws at import time, so a
 * bad row fails the first test, not a customer):
 *  - the same combination on two actions — the second would silently never run;
 *  - a bare letter or digit, with or without Shift: it would eat typing;
 *  - Ctrl+Alt+character: on Windows AltGr *is* Ctrl+Alt, and on a Turkish
 *    keyboard AltGr+Q is "@", AltGr+E is "€";
 *  - a bare key of any sort other than "?".
 *
 * **When a key is heard** (`dispatchShortcut`):
 *  - never while AltGr is down (`getModifierState('AltGraph')`), however the
 *    browser reports the chord — the agent is typing a character;
 *  - never while a dialog is open (`aria-modal`): the palette, a modal, the
 *    "?" window itself. The page behind a dialog is not the agent's focus;
 *  - never while an input method is composing, on a key repeat, or when a
 *    control closer to the key (a menu, the canned-reply picker) already
 *    claimed it (`defaultPrevented`);
 *  - in a text field, only what cannot be typed: a Ctrl/⌘ chord (global), and
 *    — when the field is the reply composer — the inbox and composer rows. A
 *    single character never reaches a handler from a field, so typing "?" in a
 *    reply writes a question mark.
 *
 * "?" is `event.key === '?'`, not "Shift+/": on a Turkish keyboard it is
 * Shift+*, and Shift is not part of that combination.
 *
 * Anything hard to undo stays out of this table or asks first — a shortcut is
 * one stray key away from a mistake the agent did not intend.
 */
import { useEffect, useRef } from 'react';

export type ShortcutScope = 'global' | 'inbox' | 'composer';

export interface ShortcutDefinition {
  /** Stable name; also the handler's key. */
  id: string;
  /** `Mod+K`, `Alt+ArrowDown`, `?` — see the module doc. */
  combo: string;
  scope: ShortcutScope;
  /** Catalogue key of the one-line description shown in the "?" window. */
  descriptionKey: string;
}

export interface ParsedCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** `K` (letters upper-cased), `ArrowDown`, `?`. */
  key: string;
}

/** A row that breaks the register's rules. */
export class ShortcutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShortcutError';
  }
}

const MODIFIERS = new Set(['Mod', 'Ctrl', 'Alt', 'Shift']);
const NAMED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Enter']);

export function parseCombo(combo: string): ParsedCombo {
  const tokens = combo.split('+');
  const key = tokens.pop() ?? '';
  const parsed: ParsedCombo = { mod: false, alt: false, shift: false, key: '' };
  for (const token of tokens) {
    if (!MODIFIERS.has(token)) throw new ShortcutError(`"${combo}": unknown modifier "${token}"`);
    if (token === 'Mod' || token === 'Ctrl') parsed.mod = true;
    else if (token === 'Alt') parsed.alt = true;
    else parsed.shift = true;
  }
  if (key.length === 1) parsed.key = key.toUpperCase();
  else if (NAMED_KEYS.has(key)) parsed.key = key;
  else throw new ShortcutError(`"${combo}": unknown key "${key}"`);
  return parsed;
}

/** One spelling per combination, so `Shift+Alt+U` and `Alt+Shift+u` collide. */
export function canonicalCombo(combo: string): string {
  const p = parseCombo(combo);
  return [p.mod && 'Mod', p.alt && 'Alt', p.shift && 'Shift', p.key].filter(Boolean).join('+');
}

function validateCombo(combo: string): void {
  const p = parseCombo(combo);
  const printable = p.key.length === 1;
  if (p.mod && p.alt && printable) {
    throw new ShortcutError(`"${combo}": Ctrl+Alt+character is AltGr on Windows`);
  }
  if (printable && !p.mod && !p.alt && p.key !== '?') {
    throw new ShortcutError(`"${combo}": a bare character would eat typing`);
  }
  if (!printable && !p.mod && !p.alt && !p.shift) {
    throw new ShortcutError(`"${combo}": a bare key is not a shortcut`);
  }
}

/** Pairs of rows bound to the same combination. */
export function findShortcutConflicts(
  rows: readonly ShortcutDefinition[],
): Array<[ShortcutDefinition, ShortcutDefinition]> {
  const seen = new Map<string, ShortcutDefinition>();
  const conflicts: Array<[ShortcutDefinition, ShortcutDefinition]> = [];
  for (const row of rows) {
    const key = canonicalCombo(row.combo);
    const earlier = seen.get(key);
    if (earlier) conflicts.push([earlier, row]);
    else seen.set(key, row);
  }
  return conflicts;
}

/** Validate a table of shortcuts and freeze it; throws on any broken rule. */
export function defineShortcuts(
  rows: readonly ShortcutDefinition[],
): readonly ShortcutDefinition[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new ShortcutError(`shortcut id "${row.id}" is used twice`);
    ids.add(row.id);
    validateCombo(row.combo);
  }
  const [conflict] = findShortcutConflicts(rows);
  if (conflict) {
    throw new ShortcutError(
      `"${conflict[0].combo}" is bound to both ${conflict[0].id} and ${conflict[1].id}`,
    );
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export const SHORTCUTS = defineShortcuts([
  {
    id: 'palette.open',
    combo: 'Mod+K',
    scope: 'global',
    descriptionKey: 'shell.shortcuts.palette',
  },
  { id: 'shortcuts.open', combo: '?', scope: 'global', descriptionKey: 'shell.shortcuts.help' },
  {
    id: 'inbox.next-chat',
    combo: 'Alt+ArrowDown',
    scope: 'inbox',
    descriptionKey: 'shell.shortcuts.nextChat',
  },
  {
    id: 'inbox.prev-chat',
    combo: 'Alt+ArrowUp',
    scope: 'inbox',
    descriptionKey: 'shell.shortcuts.prevChat',
  },
  {
    id: 'inbox.toggle-copilot',
    combo: 'Alt+Shift+C',
    scope: 'inbox',
    descriptionKey: 'shell.shortcuts.copilot',
  },
  {
    id: 'composer.add-tag',
    combo: 'Alt+Shift+T',
    scope: 'composer',
    descriptionKey: 'shell.shortcuts.addTag',
  },
  {
    id: 'composer.attach-file',
    combo: 'Alt+Shift+U',
    scope: 'composer',
    descriptionKey: 'shell.shortcuts.attachFile',
  },
]);

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

// --- matching ---------------------------------------------------------------

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

export function matchesCombo(parsed: ParsedCombo, event: KeyEventLike): boolean {
  if (parsed.mod !== (event.ctrlKey || event.metaKey)) return false;
  if (parsed.alt !== event.altKey) return false;
  // "?" is Shift+/ on a US keyboard and Shift+* on a Turkish one: Shift is how
  // the character is made, not part of the shortcut.
  if (parsed.key !== '?' && parsed.shift !== event.shiftKey) return false;
  if (parsed.key === '?') return event.key === '?';
  if (parsed.key.length > 1) return event.key === parsed.key;
  const letter = parsed.key;
  if (/^(Key|Digit)/.test(event.code ?? '')) {
    return event.code === `Key${letter}` || event.code === `Digit${letter}`;
  }
  return event.key.toUpperCase() === letter;
}

// --- who may hear the key ---------------------------------------------------

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type.toLowerCase());
  }
  const editable = target.getAttribute('contenteditable');
  return editable === '' || editable === 'true' || editable === 'plaintext-only';
}

/** Marks the reply composer's field: the one text field that hears the inbox rows. */
export const COMPOSER_FIELD_ATTRIBUTE = 'data-shortcut-field';

function inComposerField(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(`[${COMPOSER_FIELD_ATTRIBUTE}="composer"]`) !== null
  );
}

function hears(row: ShortcutDefinition, target: EventTarget | null): boolean {
  if (!isTextField(target)) return true;
  const parsed = parseCombo(row.combo);
  if (row.scope === 'global') return parsed.mod && !parsed.alt;
  return inComposerField(target);
}

function altGraphDown(event: KeyboardEvent): boolean {
  if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) {
    return true;
  }
  // Some engines report AltGr as Ctrl+Alt with no AltGraph state: a character
  // typed with both held is a character, not a command.
  return event.ctrlKey && event.altKey && event.key.length === 1;
}

// --- handlers ---------------------------------------------------------------

const handlers = new Map<string, () => void>();

/** Bind the handler of a registered shortcut; returns the unbinder. */
export function registerShortcutHandler(id: string, handler: () => void): () => void {
  if (!SHORTCUTS.some((row) => row.id === id)) {
    throw new ShortcutError(`unknown shortcut "${id}"`);
  }
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

/**
 * Run the shortcut a key press names, if one is bound and may be heard here.
 * Returns its id, or null when the key was left alone (and not prevented).
 */
export function dispatchShortcut(
  event: KeyboardEvent,
  doc: Pick<Document, 'querySelector'> = document,
): string | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;
  if (altGraphDown(event)) return null;
  if (doc.querySelector('[aria-modal="true"]')) return null;
  for (const row of SHORTCUTS) {
    if (!matchesCombo(parseCombo(row.combo), event)) continue;
    const handler = handlers.get(row.id);
    if (!handler || !hears(row, event.target)) return null;
    event.preventDefault();
    handler();
    return row.id;
  }
  return null;
}

/** The shell's one listener. Mount it once. */
export function useShortcutDispatcher(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      dispatchShortcut(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Bind a registered shortcut for as long as the calling component is mounted.
 * The handler may change identity every render; the latest one is what runs.
 * `null` leaves the key unbound (and untouched — the browser keeps it).
 */
export function useShortcut(id: ShortcutId, handler: (() => void) | null): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const bound = handler !== null;
  useEffect(() => {
    if (!bound) return undefined;
    return registerShortcutHandler(id, () => latest.current?.());
  }, [id, bound]);
}

// --- display ----------------------------------------------------------------

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad/i.test(platform);
}

const ARROWS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** The keycaps of a combo, in the order they are pressed: ⌘/Ctrl, ⌥/Alt, ⇧/Shift, key. */
export function comboKeycaps(combo: string, mac: boolean = isMacPlatform()): string[] {
  const p = parseCombo(combo);
  const caps: string[] = [];
  if (p.mod) caps.push(mac ? '⌘' : 'Ctrl');
  if (p.alt) caps.push(mac ? '⌥' : 'Alt');
  if (p.shift) caps.push(mac ? '⇧' : 'Shift');
  caps.push(ARROWS[p.key] ?? p.key);
  return caps;
}
