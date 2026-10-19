/**
 * Settings › Security › Sensitive data (tm 300.2 · SiyahTuş analysis AI-26).
 *
 * A player in a panic types whatever the person on the other line asks for —
 * a password, the SMS code, a card and its CVV. The API masks those values the
 * moment a message arrives, before anything stores, logs or sends them to the
 * AI (`lib/sensitive-mask.ts`), and tells the player once per chat. Nothing
 * here can be switched off: this page says what is masked, for whom, and what
 * the team sees instead, so an owner can answer "what happens to a card number
 * typed into the chat?" without reading the code.
 *
 * Read-only and built from the policy itself (`DEFAULT_SENSITIVE_POLICY`), so
 * the table cannot drift from what the server does. It reads nothing from the
 * API.
 */
import { DEFAULT_SENSITIVE_POLICY, SENSITIVE_TYPES, type SensitiveType } from '@siyahtus/types';
import { type ReactElement } from 'react';
import { Card, Section } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';

function maskedFor(author: 'customer' | 'agent', type: SensitiveType): boolean {
  return DEFAULT_SENSITIVE_POLICY[author].includes(type);
}

export function SensitiveData(): ReactElement {
  const t = useTranslate();
  return (
    <Section
      title={t('settings.sensitiveData.title')}
      description={t('settings.sensitiveData.description')}
    >
      <Card>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('settings.sensitiveData.tableCaption')}</caption>
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-content-tertiary">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('settings.sensitiveData.col.type')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('settings.sensitiveData.col.detected')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('settings.sensitiveData.col.player')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('settings.sensitiveData.col.team')}
                </th>
              </tr>
            </thead>
            <tbody>
              {SENSITIVE_TYPES.map((type) => (
                <tr key={type} className="border-t border-border">
                  <th scope="row" className="py-1.5 pr-3 font-medium">
                    {t(`inbox.transcript.sensitiveType.${type}`)}
                  </th>
                  <td className="py-1.5 pr-3 text-content-secondary">
                    {t(`settings.sensitiveData.detected.${type}`)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {maskedFor('customer', type)
                      ? t('settings.sensitiveData.masked')
                      : t('settings.sensitiveData.shown')}
                  </td>
                  <td className="py-1.5">
                    {maskedFor('agent', type)
                      ? t('settings.sensitiveData.masked')
                      : t('settings.sensitiveData.shown')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <ul className="flex list-disc flex-col gap-1.5 py-4 pl-8 pr-4 text-sm text-content-secondary">
          <li>{t('settings.sensitiveData.note.everywhere')}</li>
          <li>{t('settings.sensitiveData.note.warning')}</li>
          <li>{t('settings.sensitiveData.note.iban')}</li>
          <li>{t('settings.sensitiveData.note.ai')}</li>
          <li>{t('settings.sensitiveData.note.attachments')}</li>
          <li>{t('settings.sensitiveData.note.badge')}</li>
        </ul>
      </Card>
    </Section>
  );
}
