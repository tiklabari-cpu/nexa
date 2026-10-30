/**
 * The campaign card editor (EN-02 · tm 353): a title, an image, a body and up
 * to five buttons, with the card drawn beside it at a desktop or a phone's
 * width. The limits are the API's (`richCardProblems`, the same function the
 * server runs): a field over its limit is counted and named, never cut short
 * — so there is no `maxLength` here, which would silently stop the typing.
 * Switching a button's action starts its address or code empty
 * (`emptyCardAction`): a coupon code must not quietly become a link.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  CARD_ACTION_TYPES,
  CARD_BUTTON_LABEL_MAX,
  CARD_BUTTON_STYLES,
  RICH_CARD_BODY_MAX,
  RICH_CARD_BUTTONS_MAX,
  RICH_CARD_TITLE_MAX,
  emptyCardAction,
  normalizeRichCard,
  richCardProblems,
  type CardActionType,
  type CardButton,
  type RichCard,
  type RichCardProblem,
} from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';
import { RichCardView } from './RichCardView.js';

const CONTROL = 'w-full rounded-md border border-border bg-inset px-3 py-2 text-sm';

/** A new card: a body to write and one "send a message" button. */
export function blankCard(): RichCard {
  return {
    title: '',
    body: '',
    image: { url: '', alt: '' },
    buttons: [{ label: '', style: 'primary', action: { type: 'send_message' } }],
  };
}

/** What the card would save as, and what is wrong with it. */
export function cardProblems(card: RichCard): RichCardProblem[] {
  return richCardProblems(normalizeRichCard(card), { source: 'campaign' });
}

const KNOWN_PROBLEMS = new Set([
  'title_too_long',
  'body_required',
  'body_too_long',
  'image_url',
  'image_alt_required',
  'image_alt_too_long',
  'label_required',
  'label_too_long',
  'url',
  'coupon_required',
  'coupon_too_long',
]);

export function CampaignCardEditor({
  card,
  onChange,
}: {
  card: RichCard;
  onChange: (card: RichCard) => void;
}): ReactElement {
  const t = useTranslate();
  // Fields the person has left: only those show their problem, as the rules do.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const touch = (field: string) => () => setTouched((current) => new Set(current).add(field));
  const problems = cardProblems(card);
  const problemFor = (field: string): string | null => {
    const problem = touched.has(field) ? problems.find((p) => p.field === field) : undefined;
    if (!problem) return null;
    return t(
      KNOWN_PROBLEMS.has(problem.code)
        ? `campaigns.card.problem.${problem.code}`
        : 'campaigns.card.problem.other',
    );
  };
  const image = card.image ?? { url: '', alt: '' };
  const setButton = (index: number, patch: Partial<CardButton>): void =>
    onChange({
      ...card,
      buttons: card.buttons.map((button, i) => (i === index ? { ...button, ...patch } : button)),
    });
  const preview = normalizeRichCard(card);

  return (
    <div className="flex flex-col gap-3">
      <CardField
        id="campaign-card-title"
        label={t('campaigns.card.title')}
        count={[card.title?.length ?? 0, RICH_CARD_TITLE_MAX]}
        error={problemFor('title')}
      >
        <input
          id="campaign-card-title"
          value={card.title ?? ''}
          onChange={(event) => onChange({ ...card, title: event.target.value })}
          onBlur={touch('title')}
          className={CONTROL}
        />
      </CardField>
      <CardField
        id="campaign-card-body"
        label={t('campaigns.card.body')}
        count={[card.body.length, RICH_CARD_BODY_MAX]}
        error={problemFor('body')}
      >
        <textarea
          id="campaign-card-body"
          rows={3}
          value={card.body}
          onChange={(event) => onChange({ ...card, body: event.target.value })}
          onBlur={touch('body')}
          className={CONTROL}
        />
      </CardField>
      <div className="grid grid-cols-2 gap-3">
        <CardField
          id="campaign-card-image"
          label={t('campaigns.card.imageUrl')}
          error={problemFor('image.url')}
        >
          <input
            id="campaign-card-image"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={image.url}
            onChange={(event) =>
              onChange({ ...card, image: { ...image, url: event.target.value } })
            }
            onBlur={touch('image.url')}
            className={CONTROL}
          />
        </CardField>
        <CardField
          id="campaign-card-alt"
          label={t('campaigns.card.imageAlt')}
          error={problemFor('image.alt')}
        >
          <input
            id="campaign-card-alt"
            value={image.alt}
            onChange={(event) =>
              onChange({ ...card, image: { ...image, alt: event.target.value } })
            }
            onBlur={touch('image.alt')}
            className={CONTROL}
          />
        </CardField>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('campaigns.card.buttons')}</legend>
        {card.buttons.map((button, index) => {
          const n = index + 1;
          const at = `buttons[${index}]`;
          const action = button.action;
          return (
            <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-2">
              <div className="grid grid-cols-[1fr_auto_auto] items-start gap-2">
                <CardField
                  id={`campaign-card-button-${index}`}
                  label={t('campaigns.card.button.label', { n })}
                  count={[button.label.length, CARD_BUTTON_LABEL_MAX]}
                  error={problemFor(`${at}.label`)}
                >
                  <input
                    id={`campaign-card-button-${index}`}
                    value={button.label}
                    onChange={(event) => setButton(index, { label: event.target.value })}
                    onBlur={touch(`${at}.label`)}
                    className={CONTROL}
                  />
                </CardField>
                <CardField
                  id={`campaign-card-style-${index}`}
                  label={t('campaigns.card.button.style', { n })}
                >
                  <select
                    id={`campaign-card-style-${index}`}
                    value={button.style}
                    onChange={(event) =>
                      setButton(index, { style: event.target.value as CardButton['style'] })
                    }
                    className={CONTROL}
                  >
                    {CARD_BUTTON_STYLES.map((style) => (
                      <option key={style} value={style}>
                        {t(`campaigns.card.style.${style}`)}
                      </option>
                    ))}
                  </select>
                </CardField>
                <CardField
                  id={`campaign-card-action-${index}`}
                  label={t('campaigns.card.button.action', { n })}
                >
                  <select
                    id={`campaign-card-action-${index}`}
                    value={action.type}
                    onChange={(event) =>
                      setButton(index, {
                        action: emptyCardAction(event.target.value as CardActionType),
                      })
                    }
                    className={CONTROL}
                  >
                    {CARD_ACTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`campaigns.card.action.${type}`)}
                      </option>
                    ))}
                  </select>
                </CardField>
              </div>
              {action.type === 'open_url' && (
                <CardField
                  id={`campaign-card-url-${index}`}
                  label={t('campaigns.card.button.url', { n })}
                  error={problemFor(`${at}.action.url`)}
                >
                  <input
                    id={`campaign-card-url-${index}`}
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={action.url}
                    onChange={(event) =>
                      setButton(index, { action: { type: 'open_url', url: event.target.value } })
                    }
                    onBlur={touch(`${at}.action.url`)}
                    className={CONTROL}
                  />
                </CardField>
              )}
              {action.type === 'copy_coupon' && (
                <CardField
                  id={`campaign-card-code-${index}`}
                  label={t('campaigns.card.button.code', { n })}
                  error={problemFor(`${at}.action.code`)}
                >
                  <input
                    id={`campaign-card-code-${index}`}
                    value={action.code}
                    onChange={(event) =>
                      setButton(index, {
                        action: { type: 'copy_coupon', code: event.target.value },
                      })
                    }
                    onBlur={touch(`${at}.action.code`)}
                    className={CONTROL}
                  />
                </CardField>
              )}
              <button
                type="button"
                onClick={() =>
                  onChange({ ...card, buttons: card.buttons.filter((_, i) => i !== index) })
                }
                className="self-start text-2xs font-medium text-content-secondary underline-offset-2 hover:text-content hover:underline"
              >
                {t('campaigns.card.button.remove', { n })}
              </button>
            </div>
          );
        })}
        {card.buttons.length < RICH_CARD_BUTTONS_MAX && (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...card,
                buttons: [
                  ...card.buttons,
                  { label: '', style: 'default', action: { type: 'send_message' } },
                ],
              })
            }
            className="self-start rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('campaigns.card.addButton')}
          </button>
        )}
      </fieldset>

      <section aria-label={t('campaigns.card.preview')} className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('campaigns.card.preview')}</span>
          <div className="flex gap-1" role="group" aria-label={t('campaigns.card.previewWidth')}>
            {(['desktop', 'mobile'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={width === option}
                onClick={() => setWidth(option)}
                className={`rounded-md border px-2 py-0.5 text-2xs font-medium ${
                  width === option
                    ? 'border-brand-500 text-content'
                    : 'border-border text-content-secondary'
                }`}
              >
                {t(`campaigns.card.preview.${option}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          {preview && (
            <RichCardView
              card={preview}
              className={width === 'mobile' ? 'mx-auto w-[260px]' : 'mx-auto w-[340px]'}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function CardField({
  id,
  label,
  count,
  error,
  children,
}: {
  id: string;
  label: string;
  count?: [number, number];
  error?: string | null;
  children: ReactNode;
}): ReactElement {
  const t = useTranslate();
  const over = count ? count[0] > count[1] : false;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
      <div className="mt-0.5 flex justify-between gap-2 text-2xs">
        <span role={error ? 'alert' : undefined} className="text-danger">
          {error}
        </span>
        {count && (
          <span
            className={`tabular ${over ? 'font-semibold text-danger' : 'text-content-tertiary'}`}
          >
            {t('campaigns.card.count', { count: count[0], max: count[1] })}
          </span>
        )}
      </div>
    </div>
  );
}
