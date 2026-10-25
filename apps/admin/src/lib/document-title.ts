/**
 * The browser tab's title (tm 389.6). Every tab of the root panel starts with `[OPS]`, so a row
 * of tabs tells it apart from the workspace panel's at a glance — the same job the PLATFORM
 * strip does inside the page.
 */
import { useEffect } from 'react';

export const BASE_TITLE = '[OPS] SiyahTuş';

/** What the tab should say for a page title. */
export function composeTitle(page: string | null): string {
  return page ? `[OPS] ${page} · SiyahTuş` : BASE_TITLE;
}

/**
 * Name the screen in the tab title while the calling component is mounted. Leaving restores
 * the bare product name, so a screen that does not name itself never inherits the previous one's.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = composeTitle(title || null);
    return () => {
      document.title = composeTitle(null);
    };
  }, [title]);
}
