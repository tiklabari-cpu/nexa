/**
 * The permanent "PLATFORM · <region>" strip (tm 389.6 · FR-ADMIN-01).
 *
 * An operator who has the workspace panel and this one open in two tabs must never wonder which
 * one a destructive button belongs to. The strip is amber in both themes, sits on top of every
 * screen — sign-in included — and cannot be dismissed. The region comes from the unauthenticated
 * `GET /meta`; while it loads, or if it never does, the strip still says PLATFORM.
 *
 * `children` is the strip's right-hand side: the account controls once signed in, the language
 * and theme switchers before that.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { api } from '../lib/auth-store.js';
import { useTranslate } from '../lib/i18n.js';
import type { PlatformMeta } from '../lib/platform-types.js';

export function usePlatformMeta(): PlatformMeta | undefined {
  const { data } = useQuery({
    queryKey: ['platform', 'meta'],
    queryFn: () => api.get<PlatformMeta>('/meta'),
    // Neither the version nor the region changes under a running deployment.
    staleTime: Infinity,
    retry: 1,
  });
  return data;
}

export function PlatformStrip({ children }: { children?: ReactNode }): ReactElement {
  const t = useTranslate();
  const meta = usePlatformMeta();
  return (
    <header
      data-testid="platform-strip"
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 bg-strip px-4 py-1 text-strip-text"
    >
      <p className="text-xs font-bold tracking-wider">
        {meta
          ? t('shell.strip.label', { region: meta.region.toUpperCase() })
          : t('shell.strip.labelUnknown')}
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </header>
  );
}
