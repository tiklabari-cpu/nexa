/**
 * The `#` saved-reply picker both composers open above their textarea (IN-06).
 *
 * Every match, not the first six: the list is windowed (`VirtualList`) and at
 * most {@link CANNED_PICKER_VISIBLE_ROWS} rows tall, so "papara" can bring up
 * the ten replies that mention it and the agent scrolls — or arrows — to the
 * eleventh. Rows are one line high on purpose: the window maths needs a fixed
 * height, and the full text is what the reply becomes once picked anyway.
 *
 * A personal reply carries a "Personal" badge; `rankCannedResponses` already
 * puts it above a shared reply with the same shortcut.
 */
import type { ReactElement } from 'react';
import { VirtualList } from '../../components/VirtualList.js';
import { useTranslate } from '../../lib/i18n.js';
import type { CannedResponse } from './useCannedResponses.js';

/** One row: `py-2` around a `text-sm` line. */
export const CANNED_PICKER_ROW_HEIGHT = 36;
/** Keys the open picker handles itself — a composer must not re-read the `#token` on their key-up. */
export const PICKER_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'Enter',
  'Tab',
  'Escape',
]);

/** How many rows show before the list scrolls. */
export const CANNED_PICKER_VISIBLE_ROWS = 8;

export function CannedPicker({
  matches,
  highlighted,
  onHighlight,
  onPick,
  label,
}: {
  matches: CannedResponse[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (item: CannedResponse) => void;
  label: string;
}): ReactElement {
  const t = useTranslate();
  return (
    // Above the input: the composer sits at the bottom of the window, so a
    // list opening downwards would fall off screen.
    <div className="absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-md">
      <VirtualList
        role="listbox"
        label={label}
        items={matches}
        rowHeight={CANNED_PICKER_ROW_HEIGHT}
        maxHeight={CANNED_PICKER_ROW_HEIGHT * CANNED_PICKER_VISIBLE_ROWS}
        scrollToIndex={highlighted}
        renderRow={(item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            onMouseEnter={() => onHighlight(index)}
            // `onMouseDown` rather than `onClick`: a click would blur the
            // textarea first, losing the caret the insertion depends on.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
            style={{ height: CANNED_PICKER_ROW_HEIGHT }}
            className={`flex w-full items-center gap-2 px-3 text-left text-sm transition-colors ${
              index === highlighted ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
            }`}
          >
            <code className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-2xs">
              #{item.shortcut}
            </code>
            {item.visibility === 'private' && (
              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs text-content-secondary">
                {t('inbox.composer.picker.personal')}
              </span>
            )}
            <span className="truncate text-content-secondary">{item.text}</span>
          </button>
        )}
      />
    </div>
  );
}
