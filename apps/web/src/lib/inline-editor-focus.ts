/**
 * Focus for an editor that opens in place of a button (tm 259.21 · O16).
 *
 * "Edit teams" on a tag, "Edit team" on a saved reply: the button that opens the
 * editor is hidden while it is open, so the focused element is removed from the
 * page and focus drops to `<body>` — a keyboard user lands at the top of the
 * document, with the editor opened somewhere below. Opening should move focus
 * into the editor and closing should hand it back to the button that opened it,
 * which is a *new* element by then (it was unmounted while the editor was up),
 * so it is found again by key rather than remembered.
 *
 * `editingKey` is whatever the page already keeps (`null` closed, otherwise the
 * id of the row being edited). Spread {@link InlineEditorFocus.opener} on the
 * opening button and put {@link InlineEditorFocus.editor} on the editor's root.
 */
import { useCallback, useEffect, useRef } from 'react';

const FIRST_FIELD = 'input, select, textarea, button:not([disabled])';

export interface InlineEditorFocus<K> {
  /** Ref callback for the button that opens the editor of row `key`. */
  opener: (key: K) => (element: HTMLElement | null) => void;
  /** Ref for the editor's root element. */
  editor: (element: HTMLElement | null) => void;
}

export function useInlineEditorFocus<K extends string | number>(
  editingKey: K | null,
): InlineEditorFocus<K> {
  const openers = useRef(new Map<K, HTMLElement>());
  const editorRef = useRef<HTMLElement | null>(null);
  const previousKey = useRef<K | null>(null);

  useEffect(() => {
    const previous = previousKey.current;
    previousKey.current = editingKey;
    if (editingKey !== null) {
      editorRef.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
      return;
    }
    if (previous === null) return;
    // Focus left with the editor it was in (Save/Cancel were just unmounted).
    // If it went somewhere on purpose — a click elsewhere — leave it there.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    openers.current.get(previous)?.focus();
  }, [editingKey]);

  const opener = useCallback(
    (key: K) => (element: HTMLElement | null) => {
      if (element) openers.current.set(key, element);
      else openers.current.delete(key);
    },
    [],
  );
  const editor = useCallback((element: HTMLElement | null) => {
    editorRef.current = element;
  }, []);

  return { opener, editor };
}
