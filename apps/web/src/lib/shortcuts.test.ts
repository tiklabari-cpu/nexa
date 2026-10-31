/**
 * The shortcut register (IN-08): what may be bound, and when a key is heard.
 * The Turkish-keyboard cases are the point — "?" is Shift+*, AltGr+Q is "@".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSER_FIELD_ATTRIBUTE,
  COPILOT_FIELD_ATTRIBUTE,
  SHORTCUTS,
  ShortcutError,
  canonicalCombo,
  comboKeycaps,
  defineShortcuts,
  dispatchShortcut,
  findShortcutConflicts,
  isTextField,
  matchesCombo,
  parseCombo,
  registerShortcutHandler,
} from './shortcuts.js';

const row = (id: string, combo: string) => ({
  id,
  combo,
  scope: 'global' as const,
  descriptionKey: 'shell.shortcuts.help',
});

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

/** A key press whose `target` is `target` (an event not yet dispatched has none). */
function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = key(init);
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

const unbinders: Array<() => void> = [];
function bind(id: string): ReturnType<typeof vi.fn> {
  const handler = vi.fn();
  unbinders.push(registerShortcutHandler(id, handler));
  return handler;
}

/** Replace the page with these elements, each given its attributes. */
function mount(...specs: Array<[tag: string, attrs: Record<string, string>]>): HTMLElement[] {
  document.body.replaceChildren();
  return specs.map(([tag, attrs]) => {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    document.body.append(el);
    return el;
  });
}

afterEach(() => {
  unbinders.splice(0).forEach((off) => off());
  document.body.replaceChildren();
});

describe('the register’s own rules (IN-08)', () => {
  it('ships a table with no combination bound twice (IN-08)', () => {
    expect(findShortcutConflicts(SHORTCUTS)).toEqual([]);
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it('refuses one combination on two actions, however it is spelled', () => {
    expect(() => defineShortcuts([row('a', 'Alt+Shift+U'), row('b', 'Shift+Alt+u')])).toThrow(
      /bound to both a and b/,
    );
    expect(canonicalCombo('Shift+Alt+u')).toBe(canonicalCombo('Alt+Shift+U'));
    expect(() => defineShortcuts([row('a', 'Mod+K'), row('a', 'Mod+J')])).toThrow(/used twice/);
  });

  it('refuses a bare letter, a shifted letter and a bare named key', () => {
    expect(() => defineShortcuts([row('a', 'K')])).toThrow(ShortcutError);
    expect(() => defineShortcuts([row('a', 'Shift+K')])).toThrow(/eat typing/);
    expect(() => defineShortcuts([row('a', 'ArrowDown')])).toThrow(/bare key/);
    expect(() => defineShortcuts([row('a', '?')])).not.toThrow();
  });

  it('refuses Ctrl+Alt+letter — on Windows that is AltGr', () => {
    expect(() => defineShortcuts([row('a', 'Mod+Alt+Q')])).toThrow(/AltGr/);
    expect(() => defineShortcuts([row('a', 'Mod+Alt+ArrowUp')])).not.toThrow();
  });

  it('refuses a key it cannot name', () => {
    expect(() => parseCombo('Meta+K')).toThrow(/unknown modifier/);
    expect(() => parseCombo('Alt+Banana')).toThrow(/unknown key/);
  });
});

describe('matching a key press', () => {
  it('reads "?" off event.key on a US and a Turkish keyboard (IN-08)', () => {
    const help = parseCombo('?');
    expect(matchesCombo(help, key({ key: '?', code: 'Slash', shiftKey: true }))).toBe(true);
    expect(matchesCombo(help, key({ key: '?', code: 'Backslash', shiftKey: true }))).toBe(true);
    expect(matchesCombo(help, key({ key: '/', code: 'Slash' }))).toBe(false);
    expect(matchesCombo(help, key({ key: '?', ctrlKey: true }))).toBe(false);
  });

  it('matches a letter on the physical key, so ⌥U on a Mac still counts', () => {
    const upload = parseCombo('Alt+Shift+U');
    expect(
      matchesCombo(upload, key({ key: 'Dead', code: 'KeyU', altKey: true, shiftKey: true })),
    ).toBe(true);
    expect(matchesCombo(upload, key({ key: 'u', altKey: true, shiftKey: true }))).toBe(true);
    expect(matchesCombo(upload, key({ key: 'u', code: 'KeyU', altKey: true }))).toBe(false);
  });

  it('takes ⌘ or Ctrl for Mod, and nothing extra', () => {
    const palette = parseCombo('Mod+K');
    expect(matchesCombo(palette, key({ key: 'k', metaKey: true }))).toBe(true);
    expect(matchesCombo(palette, key({ key: 'K', ctrlKey: true }))).toBe(true);
    expect(matchesCombo(palette, key({ key: 'k' }))).toBe(false);
    expect(matchesCombo(palette, key({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('who hears a key (IN-08)', () => {
  it('runs Alt+↓ outside a text field and stops the browser’s own use of it', () => {
    const next = bind('inbox.next-chat');
    const event = press({ key: 'ArrowDown', altKey: true });
    expect(dispatchShortcut(event)).toBe('inbox.next-chat');
    expect(next).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a key alone when nothing is bound to it', () => {
    const event = press({ key: 'ArrowDown', altKey: true });
    expect(dispatchShortcut(event)).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores every shortcut while AltGr is down — AltGr+Q is "@" (IN-08)', () => {
    const next = bind('inbox.next-chat');
    const palette = bind('palette.open');
    const altGr = (init: KeyboardEventInit) => {
      const event = press({ ctrlKey: true, altKey: true, ...init });
      event.getModifierState = (name: string) => name === 'AltGraph';
      return event;
    };
    expect(dispatchShortcut(altGr({ key: '@', code: 'KeyQ' }))).toBeNull();
    expect(dispatchShortcut(altGr({ key: 'ArrowDown', code: 'ArrowDown' }))).toBeNull();
    // An engine that reports AltGr as plain Ctrl+Alt, with the character it made.
    expect(
      dispatchShortcut(press({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })),
    ).toBeNull();
    expect(next).not.toHaveBeenCalled();
    expect(palette).not.toHaveBeenCalled();
  });

  it('ignores a shortcut-shaped chord that AltGr is part of (IN-08)', () => {
    const upload = bind('composer.attach-file');
    // AltGr+Shift+U types a letter on some layouts; the engine says Alt, Shift and AltGraph.
    const event = press({ key: 'U', code: 'KeyU', altKey: true, shiftKey: true });
    event.getModifierState = (name: string) => name === 'AltGraph';
    expect(dispatchShortcut(event)).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('is silent while a dialog is open (IN-08)', () => {
    const next = bind('inbox.next-chat');
    mount(['div', { role: 'dialog', 'aria-modal': 'true' }]);
    expect(dispatchShortcut(press({ key: 'ArrowDown', altKey: true }))).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  it('is silent while composing, repeating, or once another control took the key', () => {
    const next = bind('inbox.next-chat');
    expect(
      dispatchShortcut(press({ key: 'ArrowDown', altKey: true, isComposing: true })),
    ).toBeNull();
    expect(dispatchShortcut(press({ key: 'ArrowDown', altKey: true, repeat: true }))).toBeNull();
    const taken = press({ key: 'ArrowDown', altKey: true });
    taken.preventDefault();
    expect(dispatchShortcut(taken)).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  it('never lets a single character reach a handler from a text field (IN-08)', () => {
    const help = bind('shortcuts.open');
    const fields = mount(['textarea', {}], ['input', { type: 'text' }]);
    for (const field of fields) {
      expect(isTextField(field)).toBe(true);
      expect(dispatchShortcut(press({ key: '?', shiftKey: true }, field))).toBeNull();
    }
    expect(help).not.toHaveBeenCalled();
    // Outside a field it does.
    expect(dispatchShortcut(press({ key: '?', shiftKey: true }))).toBe('shortcuts.open');
  });

  it('lets a Ctrl/⌘ chord through from a text field, but not an Alt one', () => {
    const palette = bind('palette.open');
    const copilot = bind('copilot.toggle-drawer');
    const [field] = mount(['input', { type: 'text' }]) as [HTMLElement];
    expect(dispatchShortcut(press({ key: 'k', code: 'KeyK', ctrlKey: true }, field))).toBe(
      'palette.open',
    );
    expect(
      dispatchShortcut(press({ key: 'c', code: 'KeyC', altKey: true, shiftKey: true }, field)),
    ).toBeNull();
    expect(palette).toHaveBeenCalledTimes(1);
    expect(copilot).not.toHaveBeenCalled();
  });

  it('hears the inbox and composer rows from the reply composer only', () => {
    const next = bind('inbox.next-chat');
    const upload = bind('composer.attach-file');
    const [reply, other] = mount(
      ['textarea', { [COMPOSER_FIELD_ATTRIBUTE]: 'composer' }],
      ['textarea', {}],
    ) as [HTMLElement, HTMLElement];
    expect(dispatchShortcut(press({ key: 'ArrowDown', altKey: true }, reply))).toBe(
      'inbox.next-chat',
    );
    expect(
      dispatchShortcut(press({ key: 'u', code: 'KeyU', altKey: true, shiftKey: true }, reply)),
    ).toBe('composer.attach-file');
    expect(dispatchShortcut(press({ key: 'ArrowDown', altKey: true }, other))).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('hears the Copilot row from the drawer field and the reply field, but not from other fields (IN-09)', () => {
    const toggle = bind('copilot.toggle-drawer');
    const [drawer, reply, other, body] = mount(
      ['textarea', { [COPILOT_FIELD_ATTRIBUTE]: 'copilot' }],
      ['textarea', { [COMPOSER_FIELD_ATTRIBUTE]: 'composer' }],
      ['input', { type: 'text' }],
      ['div', {}],
    ) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const chord = { key: 'C', code: 'KeyC', altKey: true, shiftKey: true };
    expect(dispatchShortcut(press(chord, drawer))).toBe('copilot.toggle-drawer');
    expect(dispatchShortcut(press(chord, reply))).toBe('copilot.toggle-drawer');
    expect(dispatchShortcut(press(chord, body))).toBe('copilot.toggle-drawer');
    expect(dispatchShortcut(press(chord, other))).toBeNull();
    expect(toggle).toHaveBeenCalledTimes(3);
  });

  it('refuses to bind a handler for a shortcut that is not in the table', () => {
    expect(() => registerShortcutHandler('nope', () => undefined)).toThrow(/unknown shortcut/);
  });
});

describe('what the "?" window prints', () => {
  it('spells the keycaps for the machine', () => {
    expect(comboKeycaps('Mod+K', true)).toEqual(['⌘', 'K']);
    expect(comboKeycaps('Mod+K', false)).toEqual(['Ctrl', 'K']);
    expect(comboKeycaps('Alt+Shift+U', true)).toEqual(['⌥', '⇧', 'U']);
    expect(comboKeycaps('Alt+ArrowDown', false)).toEqual(['Alt', '↓']);
    expect(comboKeycaps('?', false)).toEqual(['?']);
  });
});
