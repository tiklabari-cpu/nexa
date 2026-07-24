/**
 * All channels — FR-MOD-08.5.1.
 *
 * A grid of every place a customer can reach the workspace: an icon, name,
 * status and one call-to-action each. The statuses are not decoration and are
 * not made up — the Website card reads its status from the live `/websites`
 * data (FR-MOD-08.5.2), so writing a fixed "Connected" here would be a lie a
 * test is written to catch. Channels that do not exist yet say "Coming soon"
 * and offer to notify, rather than pretending to be one click away.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';

/** Origin serving the widget and its hosted Chat page. */
const WIDGET_URL = (import.meta.env['VITE_WIDGET_URL'] as string | undefined) ?? 'http://localhost:5174';

/**
 * Domain a workspace forwards its support mail to (FR-MOD-08.5.3). The address
 * shown on the Email card is `<organization_id>@<domain>`; it must match the
 * API's `INBOUND_EMAIL_DOMAIN`, which reads the local part back to route mail.
 */
const INBOUND_EMAIL_DOMAIN =
  (import.meta.env['VITE_INBOUND_EMAIL_DOMAIN'] as string | undefined) ?? 'inbound.nexa.localhost';

interface WebsiteStatusRow {
  status: string;
}

export type ChannelStatus = 'connected' | 'ready' | 'not_connected' | 'coming_soon';

export interface Channel {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: ChannelStatus;
  cta: string;
  /** Present for channels managed elsewhere on the page. */
  href?: string;
}

const STATUS_META: Record<ChannelStatus, { tone: StatusTone; label: string }> = {
  connected: { tone: 'success', label: 'Connected' },
  ready: { tone: 'info', label: 'Ready' },
  not_connected: { tone: 'warning', label: 'Not connected' },
  coming_soon: { tone: 'neutral', label: 'Coming soon' },
};

/**
 * Build the grid from the live website data.
 *
 * Only the Website card moves with data: no sites → Not connected (Connect),
 * sites installed but none handshaked → Ready (Manage), any connected →
 * Connected (Manage). The Chat page (08.5.9) and Email (08.5.3) are Ready: each
 * hands out a ready-to-use address rather than needing a connection step. What
 * remains is a fixed "Coming soon" until its own slice lands.
 */
export function channelsFor(websites: WebsiteStatusRow[]): Channel[] {
  const connected = websites.filter((w) => w.status === 'connected').length;
  const websiteStatus: ChannelStatus =
    connected > 0 ? 'connected' : websites.length > 0 ? 'ready' : 'not_connected';

  return [
    {
      id: 'website',
      name: 'Website widget',
      icon: '🌐',
      description: 'The chat bubble on your own site.',
      status: websiteStatus,
      cta: websiteStatus === 'not_connected' ? 'Connect' : 'Manage',
      href: '#section-website-widgets',
    },
    {
      id: 'chat-page',
      name: 'Chat page',
      icon: '💬',
      description: 'A hosted link customers chat from — no install needed.',
      status: 'ready',
      cta: 'Get link',
    },
    {
      id: 'email',
      name: 'Email',
      icon: '✉️',
      description: 'Forward your support inbox here and each email becomes a ticket.',
      status: 'ready',
      cta: 'Get address',
    },
    comingSoon('messenger', 'Facebook Messenger', '📨', 'Answer Messenger conversations.'),
    comingSoon('whatsapp', 'WhatsApp', '📱', 'Answer WhatsApp messages.'),
    comingSoon('sms', 'SMS', '💬', 'Reply to text messages over Twilio.'),
    comingSoon('instagram', 'Instagram', '📷', 'Answer Instagram direct messages.'),
    comingSoon('telegram', 'Telegram', '✈️', 'Answer Telegram chats.'),
  ];
}

function comingSoon(id: string, name: string, icon: string, description: string): Channel {
  return { id, name, icon, description, status: 'coming_soon', cta: 'Get notified' };
}

/**
 * The Chat page's shareable link (FR-MOD-08.5.9): our own hosted page, scoped to
 * this workspace by its organization id. Copies to the clipboard and shows the
 * URL so it can be read or shared either way.
 */
function ChatPageLink({ label }: { label: string }): ReactElement {
  const orgId = useAuth((s) => s.agent?.organization_id ?? null);
  const [copied, setCopied] = useState(false);
  const url = orgId ? `${WIDGET_URL}/chat.html?organization_id=${orgId}` : '';

  const copy = (): void => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={copy}
        disabled={!url}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {copied ? 'Copied' : label}
      </button>
      {url && (
        <code data-testid="chat-page-url" className="truncate text-2xs text-content-tertiary">
          {url}
        </code>
      )}
    </div>
  );
}

/**
 * The workspace's forwarding address (FR-MOD-08.5.3): `<organization_id>@<domain>`.
 * Whatever a customer sends here lands in the inbox as a ticket. Like the Chat
 * page link it copies to the clipboard and shows the value, so it can be pasted
 * into a mail provider's forwarding rule either way.
 */
function EmailForwardingAddress({ label }: { label: string }): ReactElement {
  const orgId = useAuth((s) => s.agent?.organization_id ?? null);
  const [copied, setCopied] = useState(false);
  const address = orgId ? `${orgId}@${INBOUND_EMAIL_DOMAIN}` : '';

  const copy = (): void => {
    if (!address) return;
    void navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={copy}
        disabled={!address}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {copied ? 'Copied' : label}
      </button>
      {address && (
        <code data-testid="email-forwarding-address" className="truncate text-2xs text-content-tertiary">
          {address}
        </code>
      )}
    </div>
  );
}

export function ChannelsGrid(): ReactElement {
  const api = useApiClient();
  const websites = useQuery({
    queryKey: ['settings', 'websites'],
    queryFn: () => api.get<{ items: WebsiteStatusRow[] }>('/websites'),
  });

  const channels = channelsFor(websites.data?.items ?? []);

  return (
    <Section
      title="Channels"
      description="Everywhere your customers can reach you. Connect the ones you use; we will let you know as the rest arrive."
    >
      {websites.error ? (
        <ErrorNotice message="Could not load channel statuses." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {channels.map((channel) => (
            <ChannelCardView key={channel.id} channel={channel} loading={websites.isPending} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ChannelCardView({
  channel,
  loading,
}: {
  channel: Channel;
  loading: boolean;
}): ReactElement {
  const [notified, setNotified] = useState(false);
  const meta = STATUS_META[channel.status];
  // The Website status is unknown until its query resolves; do not flash a
  // wrong badge in the meantime.
  const showStatus = !(loading && channel.id === 'website');

  return (
    <Card>
      <div data-testid={`channel-${channel.id}`} className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {channel.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{channel.name}</span>
          {showStatus && <StatusDot tone={meta.tone} label={meta.label} />}
        </div>

        <p className="flex-1 text-2xs text-content-secondary">{channel.description}</p>

        {channel.status === 'coming_soon' ? (
          notified ? (
            <span className="text-2xs text-content-tertiary">We&rsquo;ll let you know.</span>
          ) : (
            <button
              type="button"
              onClick={() => setNotified(true)}
              className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
            >
              {channel.cta}
            </button>
          )
        ) : channel.id === 'chat-page' ? (
          <ChatPageLink label={channel.cta} />
        ) : channel.id === 'email' ? (
          <EmailForwardingAddress label={channel.cta} />
        ) : (
          <a
            href={channel.href}
            className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {channel.cta}
          </a>
        )}
      </div>
    </Card>
  );
}
