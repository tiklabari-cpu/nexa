/**
 * The template gallery (EN-05): Turkish iGaming starting points by category.
 * Picking one hands it to the builder as a draft — nothing is saved until the
 * author presses Create — so a template is a head start, never a finished
 * campaign. A promotion says on its card that a risk-flagged player is not sent
 * it (EN-01).
 */
import type { ReactElement } from 'react';
import { Modal } from '../../components/ui/index.js';
import { useTranslate } from '../../lib/i18n.js';
import { CAMPAIGN_TEMPLATE_CATEGORIES, templatesIn, type CampaignTemplate } from './templates.js';

export function CampaignTemplateGallery({
  onPick,
  onClose,
}: {
  onPick: (template: CampaignTemplate) => void;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <Modal
      onClose={onClose}
      title={t('campaigns.gallery.title')}
      description={t('campaigns.gallery.description')}
      align="top"
      className="max-h-[80vh] max-w-[40rem] overflow-y-auto"
    >
      <div className="flex flex-col gap-5">
        {CAMPAIGN_TEMPLATE_CATEGORIES.map((category) => (
          <section key={category} aria-labelledby={`campaign-gallery-${category}`}>
            <h3
              id={`campaign-gallery-${category}`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary"
            >
              {t(`campaigns.gallery.category.${category}`)}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {templatesIn(category).map((template) => (
                <li
                  key={template.id}
                  className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <div>
                    <h4 className="text-sm font-medium">
                      {t(`campaigns.template.${template.id}.name`)}
                    </h4>
                    <p className="mt-1 text-xs text-content-secondary">
                      {t(`campaigns.template.${template.id}.description`)}
                    </p>
                    {template.kind === 'promotion' && (
                      <p className="mt-1 text-2xs text-content-tertiary">
                        {t('campaigns.gallery.promotionNote')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onPick(template)}
                    aria-label={t('campaigns.gallery.useNamed', {
                      name: t(`campaigns.template.${template.id}.name`),
                    })}
                    className="self-start rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary hover:bg-surface-2"
                  >
                    {t('campaigns.gallery.use')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
