/**
 * The widget's welcome message, edited from the AI agent's General tab (tm 390.2).
 *
 * The message is the first bubble a visitor sees from the assistant, so an admin
 * setting up the persona looks for it next to the name and tone. It is not the
 * agent's own data, though: it lives in the widget settings (`/settings/widget`,
 * tm 267) and is written through the same endpoint Settings › Widget uses, so the
 * two places cannot disagree. Widget settings are per brand; this card edits the
 * workspace default and only when there is exactly one story to tell — with
 * several brands (or a brand selected in the header) it points at Settings
 * instead of silently editing one of them. If the settings cannot be read the
 * card is left out rather than drawn empty.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { WIDGET_WELCOME_TEXT_MAX, WIDGET_WELCOME_TITLE_MAX } from '@siyahtus/types';
import { Card } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useBrand } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

const WIDGET_SETTINGS_PATH = '/app/settings/widget';

interface WelcomeSettings {
  welcome_title: string | null;
  welcome_text: string | null;
}

export function WelcomeMessageCard({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const inRouter = useInRouterContext();
  const { brandId } = useBrand();
  const [draft, setDraft] = useState<{ title: string; text: string } | null>(null);

  const settings = useQuery({
    queryKey: ['settings', 'widget', brandId],
    queryFn: () => api.get<WelcomeSettings>('/settings/widget'),
  });
  const brands = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: unknown[] }>('/brands'),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (body: { welcome_title: string; welcome_text: string }) =>
      api.put<WelcomeSettings>('/settings/widget', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'widget', brandId], data);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'websites'] });
      setDraft(null);
    },
  });

  if (settings.isPending || brands.isPending || settings.isError) return null;

  const several = (brands.data?.items.length ?? 0) > 1 || brandId !== null;
  const title = draft?.title ?? settings.data.welcome_title ?? '';
  const text = draft?.text ?? settings.data.welcome_text ?? '';

  const gotoLabel = t('playbook.welcome.goToWidget');
  const gotoClass = 'text-sm font-medium text-content-brand hover:underline';

  return (
    <Card>
      <section aria-labelledby="welcome-card-title" className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 id="welcome-card-title" className="text-sm font-medium">
            {t('playbook.welcome.title')}
          </h2>
          <p className="text-2xs text-content-tertiary">{t('playbook.welcome.description')}</p>
        </div>

        {several || !canEdit ? (
          <p className="text-sm text-content-secondary">
            {several ? t('playbook.welcome.perBrand') : t('playbook.welcome.readOnly')}{' '}
            {inRouter ? (
              <Link to={WIDGET_SETTINGS_PATH} className={gotoClass}>
                {gotoLabel}
              </Link>
            ) : (
              <a href={WIDGET_SETTINGS_PATH} className={gotoClass}>
                {gotoLabel}
              </a>
            )}
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (draft && !save.isPending) {
                save.mutate({ welcome_title: draft.title.trim(), welcome_text: draft.text.trim() });
              }
            }}
            className="flex flex-col gap-3"
          >
            <label htmlFor="agent-welcome-title" className="flex flex-col gap-1">
              <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                {t('playbook.welcome.titleLabel')}
              </span>
              <input
                id="agent-welcome-title"
                value={title}
                maxLength={WIDGET_WELCOME_TITLE_MAX}
                onChange={(event) => setDraft({ title: event.target.value, text })}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
              />
            </label>
            <label htmlFor="agent-welcome-text" className="flex flex-col gap-1">
              <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                {t('playbook.welcome.textLabel')}
              </span>
              <textarea
                id="agent-welcome-text"
                value={text}
                rows={3}
                maxLength={WIDGET_WELCOME_TEXT_MAX}
                onChange={(event) => setDraft({ title, text: event.target.value })}
                className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
              />
            </label>
            {save.isError && (
              <p role="alert" className="text-2xs text-danger">
                {t(errorMessageKey(save.error))}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={draft === null || save.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
              >
                {t('playbook.welcome.save')}
              </button>
              {save.isSuccess && draft === null && (
                <span role="status" className="text-2xs text-content-tertiary">
                  {t('playbook.welcome.saved')}
                </span>
              )}
            </div>
          </form>
        )}
      </section>
    </Card>
  );
}
