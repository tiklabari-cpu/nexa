/**
 * The "Enterprise feature — upgrade the plan" notes, as the public pilot words
 * them (tm 257.15 · ADR docs/adr/pilot-public-readiness.md K-d §3.1).
 *
 * Six settings screens answer a plan-gated refusal with a sentence ending in
 * "Upgrade the plan". In the pilot that points at a door that is not there —
 * Billing is hidden and nothing can be bought — so each note is routed through
 * here: an ordinary deployment gets its own sentence, untouched, and a pilot
 * gets "this feature is not available in the pilot — contact {email}".
 *
 * Decided where the note is drawn rather than in the catalogue, because the
 * pilot's sentence needs a parameter (the address) the six keys do not have and
 * a catalogue entry cannot read `GET /deployment`.
 */
import { useDeployment } from './deployment.js';
import { useTranslate } from './i18n.js';

export function useEntitlementNote(): (key: string) => string {
  const t = useTranslate();
  const { pilot_mode: pilotMode, contact_email: email } = useDeployment();
  return (key) => {
    if (!pilotMode) return t(key);
    return email
      ? t('settings.pilot.unavailable', { email })
      : t('settings.pilot.unavailableNoContact');
  };
}
