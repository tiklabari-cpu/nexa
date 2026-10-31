/**
 * The "?" window (IN-08): every keyboard shortcut the console answers to,
 * grouped by where it works and searchable.
 *
 * It is drawn from `SHORTCUTS` (`lib/shortcuts.ts`) — the same table the key
 * listener reads — so a key cannot be bound without being listed here, and the
 * keycaps follow the machine: ⌘ ⌥ ⇧ on a Mac, Ctrl Alt Shift elsewhere.
 *
 * `ShortcutsHost` is what the shell mounts: it owns the one document listener,
 * binds "?" to this window, and renders nothing while it is closed.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useTranslate } from '../lib/i18n.js';
import {
  SHORTCUTS,
  comboKeycaps,
  isMacPlatform,
  useShortcut,
  useShortcutDispatcher,
  type ShortcutScope,
} from '../lib/shortcuts.js';
import { foldForSearch } from '../lib/text-fold.js';
import { Modal } from './ui/index.js';

const GROUPS: ReadonlyArray<{ scope: ShortcutScope; titleKey: string }> = [
  { scope: 'global', titleKey: 'shell.shortcuts.group.global' },
  { scope: 'inbox', titleKey: 'shell.shortcuts.group.inbox' },
  { scope: 'composer', titleKey: 'shell.shortcuts.group.composer' },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }): ReactElement {
  const t = useTranslate();
  const [query, setQuery] = useState('');
  const mac = useMemo(() => isMacPlatform(), []);

  const needle = foldForSearch(query.trim());
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: SHORTCUTS.filter((row) => row.scope === group.scope).filter((row) => {
      if (!needle) return true;
      const caps = comboKeycaps(row.combo, mac).join(' ');
      return foldForSearch(`${t(row.descriptionKey)} ${caps}`).includes(needle);
    }),
  })).filter((group) => group.rows.length > 0);

  return (
    <Modal
      onClose={onClose}
      title={t('shell.shortcuts.title')}
      description={t('shell.shortcuts.description')}
      className="w-full max-w-lg"
    >
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t('shell.shortcuts.search')}
        placeholder={t('shell.shortcuts.search')}
        className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm outline-none placeholder:text-content-tertiary"
      />
      <div className="mt-4 flex max-h-[55vh] flex-col gap-4 overflow-y-auto">
        {groups.length === 0 && (
          <p className="text-sm text-content-secondary">{t('shell.shortcuts.none')}</p>
        )}
        {groups.map((group) => (
          <section key={group.scope} aria-labelledby={`shortcuts-${group.scope}`}>
            <h3
              id={`shortcuts-${group.scope}`}
              className="mb-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t(group.titleKey)}
            </h3>
            <ul className="divide-y divide-border">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  data-shortcut={row.id}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                >
                  <span>{t(row.descriptionKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {comboKeycaps(row.combo, mac).map((cap) => (
                      <kbd
                        key={cap}
                        className="min-w-6 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-2xs text-content-secondary"
                      >
                        {cap}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** Mounted once by the shell: the key listener, and the window "?" opens. */
export function ShortcutsHost(): ReactElement | null {
  const [open, setOpen] = useState(false);
  useShortcutDispatcher();
  useShortcut('shortcuts.open', () => setOpen(true));
  return open ? <ShortcutsModal onClose={() => setOpen(false)} /> : null;
}
