/**
 * The frame of every signed-out screen (tm 389.6): the PLATFORM strip — present before sign-in
 * too, so the operator knows which panel they are about to authenticate to — and a centred
 * card on the amber-tinted stage.
 */
import type { ReactElement, ReactNode } from 'react';
import { PlatformStrip } from '../../components/PlatformStrip.js';
import { PreferenceControls } from '../../components/PreferenceControls.js';
import { usePageTitle } from '../../lib/document-title.js';

export const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm aria-[invalid=true]:border-danger';
export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50';
export const LINK_BUTTON_CLASS =
  'rounded-md px-1 py-0.5 text-sm font-medium text-content-brand underline underline-offset-2';

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement {
  usePageTitle(title);
  return (
    <div className="flex min-h-full flex-col">
      <PlatformStrip>
        <PreferenceControls />
      </PlatformStrip>
      <main className="auth-stage flex flex-1 items-center justify-center bg-canvas p-6">
        <div className="auth-card w-full max-w-md rounded-xl border border-border p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {description && <p className="mt-1 text-sm text-content-secondary">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
