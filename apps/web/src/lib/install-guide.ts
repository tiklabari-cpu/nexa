/**
 * Where the installation guide lives (WG-15 · tm 349).
 *
 * The setup wizard and Settings → Website widgets both link to it. A deployment
 * that runs its own help centre names it in `INSTALL_GUIDE_URL` and
 * `GET /deployment` hands it over (`install_guide_url`); with none named the
 * link goes to the guide the panel ships, a static page next to the bundle
 * (`public/help/install-guide.html`, same origin, no sign-in).
 */
import { useDeployment } from './deployment.js';

export const DEFAULT_INSTALL_GUIDE_URL = '/help/install-guide.html';

export function useInstallGuideUrl(): string {
  return useDeployment().install_guide_url || DEFAULT_INSTALL_GUIDE_URL;
}
