/**
 * Compliance guardrails (tm 301.4 · AI-08) — the AI Agent screen's "Uyum
 * Korumaları" tab.
 *
 * One page for everything that keeps the AI from saying the wrong sentence in a
 * regulated product: the platform's locked rules (read-only), the texts the
 * workspace owes them (crisis text, complaint procedure), the stricter rules and
 * forbidden phrases the workspace adds, and the log of what they caught. The
 * owner writes; an admin sees the same page without the buttons.
 */
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { ReactElement } from 'react';
import { ForbiddenPhrases } from './ForbiddenPhrases.js';
import { GuardrailHits } from './GuardrailHits.js';
import { GuardrailRules } from './GuardrailRules.js';
import { GuardrailSettings } from './GuardrailSettings.js';
import type { GuidanceSkillOption } from './GuidanceRules.js';
import { canWriteGuardrails } from './guardrails.js';
import { PlatformGuardrailList } from './PlatformGuardrailList.js';
import type { AiAgent } from './types.js';

export function GuardrailsPage({
  agent,
  skills,
  hasAiScope,
}: {
  agent: AiAgent;
  skills: readonly GuidanceSkillOption[];
  /** Whether the signed-in person may write the AI's configuration at all (`agents-bot--all:rw`). */
  hasAiScope: boolean;
}): ReactElement {
  const t = useTranslate();
  const role = useAuth((s) => s.agent?.role ?? null);
  const canWrite = canWriteGuardrails(role, hasAiScope);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-2xs text-content-tertiary">
        {canWrite ? t('playbook.guardrails.intro.owner') : t('playbook.guardrails.intro.reader')}
      </p>
      <GuardrailSettings agent={agent} canWrite={canWrite} />
      <PlatformGuardrailList />
      <GuardrailRules agent={agent} skills={skills} canWrite={canWrite} />
      <ForbiddenPhrases agent={agent} skills={skills} canWrite={canWrite} />
      <GuardrailHits agent={agent} />
    </div>
  );
}
