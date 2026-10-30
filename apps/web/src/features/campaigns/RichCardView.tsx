/**
 * A rich card, read only (EN-02 · tm 353): the campaign builder's preview and
 * the Inbox's view of a `rich_message` or of the card a player pressed a
 * button on. Nothing here is clickable — an agent reading a transcript must
 * not open the player's link or send their message — so each button says what
 * it would do instead. React escapes every string; no markup is ever built
 * from what the author wrote.
 */
import type { ReactElement } from 'react';
import type { RichCard } from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';

export function RichCardView({
  card,
  pressed,
  className = '',
}: {
  card: RichCard;
  /** The button the player pressed, marked on the card. */
  pressed?: number;
  className?: string;
}): ReactElement {
  const t = useTranslate();
  // An upload needs the member's session to fetch; the preview shows its
  // description instead of a broken image.
  const image = card.image;
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-content ${className}`}
    >
      {image &&
        (image.url.startsWith('https://') ? (
          <img
            src={image.url}
            alt={image.alt}
            className="max-h-40 w-full rounded-md object-cover"
          />
        ) : (
          <p className="rounded-md bg-surface-2 px-2 py-6 text-center text-2xs text-content-tertiary">
            {image.alt}
          </p>
        ))}
      {card.title && <p className="font-semibold">{card.title}</p>}
      <p className="whitespace-pre-wrap break-words">{card.body}</p>
      {card.buttons.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {card.buttons.map((button, index) => {
            const action = button.action;
            const isPressed = pressed === index;
            return (
              <li
                key={index}
                {...(isPressed ? { 'data-pressed': 'true' } : {})}
                className={`rounded-md border px-2 py-1.5 text-center ${
                  button.style === 'primary'
                    ? 'border-brand-500 bg-brand-500 font-semibold text-white'
                    : 'border-border font-medium'
                } ${isPressed ? 'ring-2 ring-brand-500 ring-offset-1' : ''}`}
              >
                <span className="block">{button.label}</span>
                <span
                  className={`block break-all text-2xs ${
                    button.style === 'primary' ? 'text-white/80' : 'text-content-tertiary'
                  }`}
                >
                  {action.type === 'open_url'
                    ? t('campaigns.card.view.link', { url: action.url })
                    : action.type === 'copy_coupon'
                      ? t('campaigns.card.view.coupon', { code: action.code })
                      : t('campaigns.card.view.message')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
