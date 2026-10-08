/**
 * The whole page while the app cannot draw a screen yet: this deployment's
 * settings are on their way (`DeploymentGate`, tm 259.4), or a stored session
 * is being restored (`App`). One look for both, so the hand-over from one wait
 * to the next does not flicker.
 */
import type { ReactElement } from 'react';
import { useTranslate } from '../lib/i18n.js';

export function LoadingPage(): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas">
      <p role="status" className="text-sm text-content-secondary">
        {t('auth.startup.loading')}
      </p>
    </div>
  );
}
