/**
 * "Add an AI agent" (tm 390.2) — what a workspace without one sees in place of
 * the persona form.
 *
 * A new sign-up has no AI agent, and until now nothing on the page could make
 * one: skills had nothing to run under, a knowledge source had no agent to
 * belong to. Two fields are enough to begin (the name a visitor sees and, if
 * the admin wants one, a tone); everything else is edited on the General tab
 * the page lands on next. The agent is created switched off — going live is a
 * separate, gated step — so creating it here cannot put an unfinished assistant
 * in front of a customer.
 *
 * Someone who may not create one (the endpoint is admin-only) is told who can,
 * instead of being shown a form that would 403.
 */
import { useMutation } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import type { AiAgent } from './types.js';

export const AI_AGENT_NAME_MAX = 120;
export const AI_AGENT_TONE_MAX = 40;

export function CreateAiAgentCard({
  canCreate,
  onCreated,
  onExists,
}: {
  canCreate: boolean;
  /** The server's answer — the page adopts it and shows the General settings. */
  onCreated: (agent: AiAgent) => void;
  /** 409: somebody else made it first; the page reloads the roster. */
  onExists: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const create = useMutation({
    mutationFn: (body: { name: string; tone?: string }) => api.post<AiAgent>('/ai-agents', body),
    onSuccess: onCreated,
    onError: (error) => {
      if (error instanceof ApiClientError && error.type === 'ai_agent_exists') onExists();
    },
  });

  const form = useForm({
    initial: { name: '', tone: '' },
    validators: { name: required(t('playbook.create.nameRequired')) },
    onSubmit: (values) => {
      const tone = values.tone.trim();
      create.mutate({ name: values.name.trim(), ...(tone ? { tone } : {}) });
    },
  });
  const nameError = form.errorFor('name');

  if (!canCreate) {
    return (
      <Card>
        <EmptyState
          title={t('playbook.create.noAgentTitle')}
          description={t('playbook.create.askAdmin')}
        />
      </Card>
    );
  }

  return (
    <Card>
      <form
        onSubmit={form.handleSubmit}
        noValidate
        aria-labelledby="create-agent-title"
        className="mx-auto flex max-w-md flex-col gap-3 p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 id="create-agent-title" className="text-base font-medium">
            {t('playbook.create.title')}
          </h2>
          <p className="text-sm text-content-secondary">{t('playbook.create.description')}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="create-agent-name"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.create.name')}
          </label>
          <input
            id="create-agent-name"
            value={form.values.name}
            maxLength={AI_AGENT_NAME_MAX}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.blur('name')}
            placeholder={t('playbook.create.namePlaceholder')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'create-agent-name-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="create-agent-name-error" message={nameError} />
        </div>

        <label htmlFor="create-agent-tone" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('playbook.create.tone')}
          </span>
          <input
            id="create-agent-tone"
            value={form.values.tone}
            maxLength={AI_AGENT_TONE_MAX}
            onChange={(event) => form.setValue('tone', event.target.value)}
            placeholder={t('playbook.create.tonePlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>

        {create.isError &&
          !(create.error instanceof ApiClientError && create.error.type === 'ai_agent_exists') && (
            <p role="alert" className="text-2xs text-danger">
              {t(errorMessageKey(create.error))}
            </p>
          )}

        <div>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {t('playbook.create.submit')}
          </button>
        </div>
      </form>
    </Card>
  );
}
