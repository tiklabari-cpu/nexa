/**
 * All channels — FR-MOD-08.5.1.
 *
 * A grid of every place a customer can reach the workspace: an icon, name,
 * status and one call-to-action each. The statuses are not decoration and are
 * not made up — the Website card reads its status from the live `/websites`
 * data (FR-MOD-08.5.2), so writing a fixed "Connected" here would be a lie a
 * test is written to catch.
 *
 * Every card is live now. The grid used to carry a fourth, unbuilt-channel
 * status whose button offered to notify an admin when the channel arrived,
 * remembered in `localStorage`. WhatsApp (08.5.6-b) was the last card off that
 * list, which left the status unreachable and the button unrenderable — dead
 * code claiming a state no channel can be in. It was removed in 08.5-c; if a
 * channel is ever announced before it is built, the status and its button come
 * back with it (K08.5.1).
 *
 * `channelsFor()` and its `Channel` records stay in English on purpose
 * (I18N-i, tm 133.9): `channels.test.ts` pins their `name`/`description`/`cta`
 * as plain data (it is a pure function, called with no locale), and it is not
 * this task's file to rewrite. The render layer below translates by looking
 * the channel's `id`/`status`/`cta` up in `CHANNEL_COPY`/`STATUS_META`/
 * `CTA_KEYS` instead — the same id-to-key mapping 133.3/133.4 used for ticket
 * status and priority.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth, useBrand } from '../../lib/auth-store.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { FieldError, compose, phoneNumber, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { useConnectedChannels, type ConnectedChannel } from '../inbox/useInbox.js';
import { canReadChannels } from '../inbox/views.js';

/** Origin serving the widget and its hosted Chat page. */
const WIDGET_URL =
  (import.meta.env['VITE_WIDGET_URL'] as string | undefined) ?? 'http://localhost:5174';

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

export type ChannelStatus = 'connected' | 'ready' | 'not_connected';

export interface Channel {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: ChannelStatus;
  cta: string;
  /** Present for channels managed elsewhere on the page. */
  href?: string;
  /** The connected channel address (e.g. an Instagram user id), shown once connected. */
  address?: string | null;
}

const STATUS_META: Record<ChannelStatus, { tone: StatusTone; labelKey: string }> = {
  connected: { tone: 'success', labelKey: 'settings.channels.status.connected' },
  ready: { tone: 'info', labelKey: 'settings.channels.status.ready' },
  not_connected: { tone: 'warning', labelKey: 'settings.channels.status.not_connected' },
};

/** `channel.id` → the catalogue keys for its translated name/description. */
const CHANNEL_COPY: Record<string, { nameKey: string; descriptionKey: string }> = {
  website: {
    nameKey: 'settings.channels.website.name',
    descriptionKey: 'settings.channels.website.description',
  },
  'chat-page': {
    nameKey: 'settings.channels.chatPage.name',
    descriptionKey: 'settings.channels.chatPage.description',
  },
  email: {
    nameKey: 'settings.channels.email.name',
    descriptionKey: 'settings.channels.email.description',
  },
  messenger: {
    nameKey: 'settings.channels.messenger.name',
    descriptionKey: 'settings.channels.messenger.description',
  },
  whatsapp: {
    nameKey: 'settings.channels.whatsapp.name',
    descriptionKey: 'settings.channels.whatsapp.description',
  },
  sms: {
    nameKey: 'settings.channels.sms.name',
    descriptionKey: 'settings.channels.sms.description',
  },
  instagram: {
    nameKey: 'settings.channels.instagram.name',
    descriptionKey: 'settings.channels.instagram.description',
  },
  telegram: {
    nameKey: 'settings.channels.telegram.name',
    descriptionKey: 'settings.channels.telegram.description',
  },
};

/** `channel.cta`'s fixed English verb → the catalogue key it translates to. */
const CTA_KEYS: Record<string, string> = {
  Connect: 'settings.channels.cta.connect',
  Manage: 'settings.channels.cta.manage',
  'Get link': 'settings.channels.cta.getLink',
  'Get address': 'settings.channels.cta.getAddress',
  Disconnect: 'settings.channels.cta.disconnect',
  'Connect with Facebook (mock)': 'settings.channels.messenger.connectCta',
};

function ctaText(t: TFunction, cta: string): string {
  const key = CTA_KEYS[cta];
  return key ? t(key) : cta;
}

/**
 * Build the grid from the live website data.
 *
 * The Website card moves with `/websites`: no sites → Not connected (Connect),
 * sites installed but none handshaked → Ready (Manage), any connected →
 * Connected (Manage). The Chat page (08.5.9) and Email (08.5.3) are Ready: each
 * hands out a ready-to-use address rather than needing a connection step. The
 * five adapter channels below derive theirs from `/channels` the same way —
 * nothing in this grid is a fixed label any more.
 */
export function channelsFor(
  websites: WebsiteStatusRow[],
  connectedChannels: ConnectedChannel[] = [],
): Channel[] {
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
    messengerChannel(connectedChannels),
    whatsappChannel(connectedChannels),
    smsChannel(connectedChannels),
    instagramChannel(connectedChannels),
    telegramChannel(connectedChannels),
  ];
}

/**
 * Messenger connect/disconnect (FR-MOD-08.5.4). Same derivation as
 * `instagramChannel`/`telegramChannel`: status/address come from the live
 * `/channels` list, not a fixed label. Its not-connected CTA names the
 * provider ("Connect with Facebook (mock)") because — unlike Instagram's
 * plain "Connect" — the button itself is what runs the mock OAuth exchange;
 * no code field is ever shown to fill in.
 */
function messengerChannel(connectedChannels: ConnectedChannel[]): Channel {
  const row = connectedChannels.find((c) => c.type === 'messenger');
  const isConnected = row?.connected === true;
  return {
    id: 'messenger',
    name: 'Facebook Messenger',
    icon: '📨',
    description: 'Answer Messenger conversations.',
    status: isConnected ? 'connected' : 'not_connected',
    cta: isConnected ? 'Disconnect' : 'Connect with Facebook (mock)',
    address: isConnected ? (row?.address ?? null) : undefined,
  };
}

/**
 * WhatsApp connect/disconnect (FR-MOD-08.5.6), same derivation as
 * `messengerChannel`/`smsChannel`: status/address come from the live
 * `/channels` list, not a fixed label. There is no mock OAuth
 * exchange or secret credential here (unlike Messenger/Twilio) — just the
 * WhatsApp Business Account id and the business phone number, which becomes
 * the channel address.
 */
function whatsappChannel(connectedChannels: ConnectedChannel[]): Channel {
  const row = connectedChannels.find((c) => c.type === 'whatsapp');
  const isConnected = row?.connected === true;
  return {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '📱',
    description: 'Answer WhatsApp messages.',
    status: isConnected ? 'connected' : 'not_connected',
    cta: isConnected ? 'Disconnect' : 'Connect',
    address: isConnected ? (row?.address ?? null) : undefined,
  };
}

/**
 * SMS connect/disconnect (FR-MOD-08.5.5), same derivation as `messengerChannel`.
 * The card's own id (`sms`) differs from the adapter/registry type it looks up
 * (`twilio`, the provider name) and connects through — the card names what the
 * channel does, the type names who runs it.
 */
function smsChannel(connectedChannels: ConnectedChannel[]): Channel {
  const row = connectedChannels.find((c) => c.type === 'twilio');
  const isConnected = row?.connected === true;
  return {
    id: 'sms',
    name: 'SMS',
    icon: '💬',
    description: 'Reply to text messages over Twilio.',
    status: isConnected ? 'connected' : 'not_connected',
    cta: isConnected ? 'Disconnect' : 'Connect',
    address: isConnected ? (row?.address ?? null) : undefined,
  };
}

/**
 * The Instagram card's status is derived the same way the Website card's is:
 * from the live `/channels` list, not a fixed label. `connected` (not the
 * `status` string) is the source of truth, matching the Inbox Views group's
 * `connectedChannelViews` — a channel row can exist without currently flowing.
 */
function instagramChannel(connectedChannels: ConnectedChannel[]): Channel {
  const row = connectedChannels.find((c) => c.type === 'instagram');
  const isConnected = row?.connected === true;
  return {
    id: 'instagram',
    name: 'Instagram',
    icon: '📷',
    description: 'Answer Instagram direct messages.',
    status: isConnected ? 'connected' : 'not_connected',
    cta: isConnected ? 'Disconnect' : 'Connect',
    address: isConnected ? (row?.address ?? null) : undefined,
  };
}

/**
 * Same derivation as `instagramChannel`, for the same reason (FR-MOD-08.5.8):
 * the card's status comes from the live `/channels` list, not a fixed label.
 */
function telegramChannel(connectedChannels: ConnectedChannel[]): Channel {
  const row = connectedChannels.find((c) => c.type === 'telegram');
  const isConnected = row?.connected === true;
  return {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    description: 'Answer Telegram chats.',
    status: isConnected ? 'connected' : 'not_connected',
    cta: isConnected ? 'Disconnect' : 'Connect',
    address: isConnected ? (row?.address ?? null) : undefined,
  };
}

/**
 * The Chat page's shareable link (FR-MOD-08.5.9): our own hosted page, scoped to
 * this workspace by its organization id. Copies to the clipboard and shows the
 * URL so it can be read or shared either way.
 */
function ChatPageLink({ label }: { label: string }): ReactElement {
  const t = useTranslate();
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
        {copied ? t('settings.copied') : label}
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
  const t = useTranslate();
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
        {copied ? t('settings.copied') : label}
      </button>
      {address && (
        <code
          data-testid="email-forwarding-address"
          className="truncate text-2xs text-content-tertiary"
        >
          {address}
        </code>
      )}
    </div>
  );
}

export function ChannelsGrid(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const { brandId } = useBrand();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  // Only owner/admin hold the channels--all scope; for anyone else the
  // request never fires (it would only come back 403) — canReadChannels()
  // is the same gate the Inbox Views group uses for the same query.
  const canChannels = canReadChannels(scopes);

  const websites = useQuery({
    queryKey: ['settings', 'websites', brandId],
    queryFn: () => api.get<{ items: WebsiteStatusRow[] }>('/websites'),
  });
  const connectedChannels = useConnectedChannels(canChannels);

  // For the section title only — whose channels are shown.
  const brands = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>('/brands'),
    enabled: brandId !== null,
    staleTime: 60_000,
  });
  const brandName = brandId ? brands.data?.items.find((b) => b.id === brandId)?.name : undefined;

  const channels = channelsFor(websites.data?.items ?? [], connectedChannels.data?.items ?? []);

  return (
    <Section
      id="section-channels"
      title={
        brandName
          ? t('settings.channels.titleWithBrand', { brand: brandName })
          : t('settings.channels.title')
      }
      description={t('settings.channels.description')}
    >
      {websites.error || connectedChannels.error ? (
        <ErrorNotice message={t('settings.channels.loadError')} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {channels.map((channel) => (
            <ChannelCardView
              key={channel.id}
              channel={channel}
              websitesLoading={websites.isPending}
              channelsLoading={connectedChannels.isLoading}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function ChannelCardView({
  channel,
  websitesLoading,
  channelsLoading,
}: {
  channel: Channel;
  websitesLoading: boolean;
  channelsLoading: boolean;
}): ReactElement {
  const t = useTranslate();
  const meta = STATUS_META[channel.status];
  const copy = CHANNEL_COPY[channel.id];
  // The Website/Messenger/SMS/Instagram/Telegram status is unknown until its
  // query resolves; do not flash a wrong badge in the meantime.
  // `channelsLoading` is false while the /channels request is gated off
  // (canReadChannels), so it never hides the badge forever for an agent
  // without the scope.
  const showStatus =
    !(websitesLoading && channel.id === 'website') &&
    !(
      channelsLoading &&
      (channel.id === 'messenger' ||
        channel.id === 'whatsapp' ||
        channel.id === 'sms' ||
        channel.id === 'instagram' ||
        channel.id === 'telegram')
    );

  const cta = ctaText(t, channel.cta);

  return (
    <Card>
      <div data-testid={`channel-${channel.id}`} className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {channel.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {copy ? t(copy.nameKey) : channel.name}
          </span>
          {showStatus && <StatusDot tone={meta.tone} label={t(meta.labelKey)} />}
        </div>

        <p className="flex-1 text-2xs text-content-secondary">
          {copy ? t(copy.descriptionKey) : channel.description}
        </p>

        {channel.id === 'chat-page' ? (
          <ChatPageLink label={cta} />
        ) : channel.id === 'email' ? (
          <EmailForwardingAddress label={cta} />
        ) : channel.id === 'messenger' ? (
          <MessengerChannelAction channel={channel} cta={cta} />
        ) : channel.id === 'whatsapp' ? (
          <WhatsappChannelAction channel={channel} cta={cta} />
        ) : channel.id === 'sms' ? (
          <SmsChannelAction channel={channel} cta={cta} />
        ) : channel.id === 'instagram' ? (
          <InstagramChannelAction channel={channel} cta={cta} />
        ) : channel.id === 'telegram' ? (
          <TelegramChannelAction channel={channel} cta={cta} />
        ) : (
          <a
            href={channel.href}
            className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {cta}
          </a>
        )}
      </div>
    </Card>
  );
}

/**
 * Instagram connect/disconnect (FR-MOD-08.5.7). Connect runs the mock OAuth
 * handshake — any code and Instagram user id complete it, behind the shared
 * `useForm` primitive so an empty field cannot be submitted (FR-EK-A.1).
 * Disconnect asks first: it stops inbound DMs at once and is not undoable
 * from this button.
 */
function InstagramChannelAction({ channel, cta }: { channel: Channel; cta: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  const connect = useMutation({
    mutationFn: (body: { code: string; ig_user_id: string }) =>
      api.post('/channels/instagram/connect', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post('/channels/instagram/disconnect'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const form = useForm({
    initial: { code: '', ig_user_id: '' },
    validators: {
      code: required(t('settings.channels.instagram.codeError')),
      ig_user_id: required(t('settings.channels.instagram.userIdError')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await connect.mutateAsync(values);
        setOpen(false);
      } catch (failure) {
        // A 4xx (e.g. that address already belongs to another workspace) is
        // shown as a form-level notice; the query cache is untouched, so the
        // card cannot flip to Connected on a failed attempt.
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('settings.channels.discardConnectionConfirm'),
    onClose: () => {
      setOpen(false);
      form.reset();
      connect.reset();
    },
  });

  if (channel.status === 'connected') {
    return (
      <div className="flex flex-col gap-1">
        {channel.address && (
          <code className="truncate text-2xs text-content-tertiary">{channel.address}</code>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('settings.channels.instagram.disconnectConfirm'))) {
              disconnect.mutate();
            }
          }}
          disabled={disconnect.isPending}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {disconnect.isPending ? t('settings.channels.disconnecting') : cta}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
      >
        {cta}
      </button>
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('settings.channels.instagram.connectTitle')}
      description={t('settings.channels.instagram.connectDescription')}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        {form.submitError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <label htmlFor="instagram-code" className="mb-1.5 block text-sm font-medium">
          {t('settings.channels.instagram.codeLabel')}
        </label>
        <input
          id="instagram-code"
          value={form.values.code}
          autoFocus
          onChange={(event) => form.setValue('code', event.target.value)}
          onBlur={() => form.blur('code')}
          aria-invalid={form.errorFor('code') ? true : undefined}
          aria-describedby={form.errorFor('code') ? 'instagram-code-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="instagram-code-error" message={form.errorFor('code')} />

        <label htmlFor="instagram-ig-user-id" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('settings.channels.instagram.userIdLabel')}
        </label>
        <input
          id="instagram-ig-user-id"
          value={form.values.ig_user_id}
          onChange={(event) => form.setValue('ig_user_id', event.target.value)}
          onBlur={() => form.blur('ig_user_id')}
          aria-invalid={form.errorFor('ig_user_id') ? true : undefined}
          aria-describedby={form.errorFor('ig_user_id') ? 'instagram-ig-user-id-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="instagram-ig-user-id-error" message={form.errorFor('ig_user_id')} />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {form.isSubmitting
              ? t('settings.channels.connecting')
              : t('settings.channels.cta.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Telegram connect/disconnect (FR-MOD-08.5.8), same shape as
 * `InstagramChannelAction`. Connect stands in for registering a bot: the
 * admin supplies the bot's token (minted by @BotFather, out of band) and its
 * `@username` — exactly what the API's mock `TelegramAdapter.parseConnect`
 * expects. Unlike Instagram's mock OAuth exchange, the token is a
 * real-shaped credential the caller provides; the server verifies and
 * discards it (never echoed back), so nothing here shows it again once
 * connected. Disconnect asks first, same as Instagram: it stops inbound
 * messages at once and is not undoable from this button.
 */
function TelegramChannelAction({ channel, cta }: { channel: Channel; cta: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  const connect = useMutation({
    mutationFn: (body: { bot_token: string; bot_username: string }) =>
      api.post('/channels/telegram/connect', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post('/channels/telegram/disconnect'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const form = useForm({
    initial: { bot_token: '', bot_username: '' },
    validators: {
      bot_token: required(t('settings.channels.telegram.tokenError')),
      bot_username: required(t('settings.channels.telegram.usernameError')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await connect.mutateAsync(values);
        setOpen(false);
      } catch (failure) {
        // A 4xx (e.g. that address already belongs to another workspace) is
        // shown as a form-level notice; the query cache is untouched, so the
        // card cannot flip to Connected on a failed attempt.
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('settings.channels.discardConnectionConfirm'),
    onClose: () => {
      setOpen(false);
      form.reset();
      connect.reset();
    },
  });

  if (channel.status === 'connected') {
    return (
      <div className="flex flex-col gap-1">
        {channel.address && (
          <code className="truncate text-2xs text-content-tertiary">{channel.address}</code>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('settings.channels.telegram.disconnectConfirm'))) {
              disconnect.mutate();
            }
          }}
          disabled={disconnect.isPending}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {disconnect.isPending ? t('settings.channels.disconnecting') : cta}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
      >
        {cta}
      </button>
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('settings.channels.telegram.connectTitle')}
      description={t('settings.channels.telegram.connectDescription')}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        {form.submitError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <label htmlFor="telegram-bot-token" className="mb-1.5 block text-sm font-medium">
          {t('settings.channels.telegram.tokenLabel')}
        </label>
        <input
          id="telegram-bot-token"
          value={form.values.bot_token}
          autoFocus
          onChange={(event) => form.setValue('bot_token', event.target.value)}
          onBlur={() => form.blur('bot_token')}
          aria-invalid={form.errorFor('bot_token') ? true : undefined}
          aria-describedby={form.errorFor('bot_token') ? 'telegram-bot-token-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="telegram-bot-token-error" message={form.errorFor('bot_token')} />

        <label htmlFor="telegram-bot-username" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('settings.channels.telegram.usernameLabel')}
        </label>
        <input
          id="telegram-bot-username"
          value={form.values.bot_username}
          onChange={(event) => form.setValue('bot_username', event.target.value)}
          onBlur={() => form.blur('bot_username')}
          aria-invalid={form.errorFor('bot_username') ? true : undefined}
          aria-describedby={
            form.errorFor('bot_username') ? 'telegram-bot-username-error' : undefined
          }
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="telegram-bot-username-error" message={form.errorFor('bot_username')} />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {form.isSubmitting
              ? t('settings.channels.connecting')
              : t('settings.channels.cta.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The mock Facebook OAuth authorization code — minted here, never typed. */
const MOCK_FACEBOOK_AUTH_CODE = 'mock-facebook-auth-code';

/**
 * Messenger connect/disconnect (FR-MOD-08.5.4). Clicking "Connect with
 * Facebook (mock)" is what stands in for the Facebook redirect — the
 * authorization code is minted right here rather than typed, so the form
 * that follows only asks for the Facebook Page being connected (its name is
 * optional). Disconnect asks first, same as Instagram/Telegram: it stops
 * inbound messages at once and is not undoable from this button.
 */
function MessengerChannelAction({ channel, cta }: { channel: Channel; cta: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  const connect = useMutation({
    mutationFn: (body: { page_id: string; page_name: string }) =>
      api.post('/channels/messenger/connect', {
        code: MOCK_FACEBOOK_AUTH_CODE,
        page_id: body.page_id,
        ...(body.page_name ? { page_name: body.page_name } : {}),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post('/channels/messenger/disconnect'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const form = useForm({
    initial: { page_id: '', page_name: '' },
    validators: {
      page_id: required(t('settings.channels.messenger.pageIdError')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await connect.mutateAsync(values);
        setOpen(false);
      } catch (failure) {
        // A 4xx (e.g. that page already belongs to another workspace) is
        // shown as a form-level notice; the query cache is untouched, so the
        // card cannot flip to Connected on a failed attempt.
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('settings.channels.discardConnectionConfirm'),
    onClose: () => {
      setOpen(false);
      form.reset();
      connect.reset();
    },
  });

  if (channel.status === 'connected') {
    return (
      <div className="flex flex-col gap-1">
        {channel.address && (
          <code className="truncate text-2xs text-content-tertiary">{channel.address}</code>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('settings.channels.messenger.disconnectConfirm'))) {
              disconnect.mutate();
            }
          }}
          disabled={disconnect.isPending}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {disconnect.isPending ? t('settings.channels.disconnecting') : cta}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
      >
        {cta}
      </button>
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('settings.channels.messenger.connectTitle')}
      description={t('settings.channels.messenger.connectDescription')}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        {form.submitError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <label htmlFor="messenger-page-id" className="mb-1.5 block text-sm font-medium">
          {t('settings.channels.messenger.pageIdLabel')}
        </label>
        <input
          id="messenger-page-id"
          value={form.values.page_id}
          autoFocus
          onChange={(event) => form.setValue('page_id', event.target.value)}
          onBlur={() => form.blur('page_id')}
          aria-invalid={form.errorFor('page_id') ? true : undefined}
          aria-describedby={form.errorFor('page_id') ? 'messenger-page-id-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="messenger-page-id-error" message={form.errorFor('page_id')} />

        <label htmlFor="messenger-page-name" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('settings.channels.messenger.pageNameLabel')}
        </label>
        <input
          id="messenger-page-name"
          value={form.values.page_name}
          onChange={(event) => form.setValue('page_name', event.target.value)}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {form.isSubmitting
              ? t('settings.channels.connecting')
              : t('settings.channels.cta.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * WhatsApp connect/disconnect (FR-MOD-08.5.6), same shape as
 * `TelegramChannelAction`: the admin supplies real-shaped identifiers rather
 * than running a mock OAuth handshake — the WhatsApp Business Account id and
 * the business phone number that becomes the channel address. Unlike
 * Twilio's `auth_token`, neither field is a secret, so there is no password
 * input here. `phone_number` is validated against the same E.164-ish shape
 * `SmsChannelAction`'s phone number is (the API's `WhatsAppAdapter` requires
 * it too). Disconnect asks first, same as the other live cards.
 */
function WhatsappChannelAction({ channel, cta }: { channel: Channel; cta: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  const connect = useMutation({
    mutationFn: (body: { waba_id: string; phone_number: string }) =>
      api.post('/channels/whatsapp/connect', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post('/channels/whatsapp/disconnect'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const form = useForm({
    initial: { waba_id: '', phone_number: '' },
    validators: {
      waba_id: required(t('settings.channels.whatsapp.wabaIdError')),
      phone_number: compose(
        required(t('settings.channels.whatsapp.phoneNumberError')),
        phoneNumber(t('settings.channels.whatsapp.phoneNumberError')),
      ),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await connect.mutateAsync(values);
        setOpen(false);
      } catch (failure) {
        // A 4xx (e.g. that number already belongs to another workspace) is
        // shown as a form-level notice; the query cache is untouched, so the
        // card cannot flip to Connected on a failed attempt.
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('settings.channels.discardConnectionConfirm'),
    onClose: () => {
      setOpen(false);
      form.reset();
      connect.reset();
    },
  });

  if (channel.status === 'connected') {
    return (
      <div className="flex flex-col gap-1">
        {channel.address && (
          <code className="truncate text-2xs text-content-tertiary">{channel.address}</code>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('settings.channels.whatsapp.disconnectConfirm'))) {
              disconnect.mutate();
            }
          }}
          disabled={disconnect.isPending}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {disconnect.isPending ? t('settings.channels.disconnecting') : cta}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
      >
        {cta}
      </button>
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('settings.channels.whatsapp.connectTitle')}
      description={t('settings.channels.whatsapp.connectDescription')}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        {form.submitError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <label htmlFor="whatsapp-waba-id" className="mb-1.5 block text-sm font-medium">
          {t('settings.channels.whatsapp.wabaIdLabel')}
        </label>
        <input
          id="whatsapp-waba-id"
          value={form.values.waba_id}
          autoFocus
          onChange={(event) => form.setValue('waba_id', event.target.value)}
          onBlur={() => form.blur('waba_id')}
          aria-invalid={form.errorFor('waba_id') ? true : undefined}
          aria-describedby={form.errorFor('waba_id') ? 'whatsapp-waba-id-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="whatsapp-waba-id-error" message={form.errorFor('waba_id')} />

        <label htmlFor="whatsapp-phone-number" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('settings.channels.whatsapp.phoneNumberLabel')}
        </label>
        <input
          id="whatsapp-phone-number"
          value={form.values.phone_number}
          onChange={(event) => form.setValue('phone_number', event.target.value)}
          onBlur={() => form.blur('phone_number')}
          aria-invalid={form.errorFor('phone_number') ? true : undefined}
          aria-describedby={
            form.errorFor('phone_number') ? 'whatsapp-phone-number-error' : undefined
          }
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="whatsapp-phone-number-error" message={form.errorFor('phone_number')} />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {form.isSubmitting
              ? t('settings.channels.connecting')
              : t('settings.channels.cta.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * SMS (Twilio) connect/disconnect (FR-MOD-08.5.5), same shape as
 * `TelegramChannelAction`: the admin supplies real-shaped credentials rather
 * than running a mock OAuth handshake. `auth_token` is a secret — the field is
 * `type="password"` with autocomplete off, and (like Telegram's bot token) the
 * server verifies it at connect and never stores or echoes it back, so nothing
 * here shows it again once connected. `phone_number` is validated against the
 * same E.164-ish shape the API's `TwilioAdapter` requires, so a malformed
 * number is caught here rather than round-tripping to the server first.
 * Disconnect asks first, same as the other live cards.
 */
function SmsChannelAction({ channel, cta }: { channel: Channel; cta: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  const connect = useMutation({
    mutationFn: (body: { account_sid: string; auth_token: string; phone_number: string }) =>
      api.post('/channels/twilio/connect', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post('/channels/twilio/disconnect'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const form = useForm({
    initial: { account_sid: '', auth_token: '', phone_number: '' },
    validators: {
      account_sid: required(t('settings.channels.sms.accountSidError')),
      auth_token: required(t('settings.channels.sms.authTokenError')),
      phone_number: compose(
        required(t('settings.channels.sms.phoneNumberError')),
        phoneNumber(t('settings.channels.sms.phoneNumberError')),
      ),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await connect.mutateAsync(values);
        setOpen(false);
      } catch (failure) {
        // A 4xx (e.g. that number already belongs to another workspace) is
        // shown as a form-level notice; the query cache is untouched, so the
        // card cannot flip to Connected on a failed attempt.
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('settings.channels.discardConnectionConfirm'),
    onClose: () => {
      setOpen(false);
      form.reset();
      connect.reset();
    },
  });

  if (channel.status === 'connected') {
    return (
      <div className="flex flex-col gap-1">
        {channel.address && (
          <code className="truncate text-2xs text-content-tertiary">{channel.address}</code>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('settings.channels.sms.disconnectConfirm'))) {
              disconnect.mutate();
            }
          }}
          disabled={disconnect.isPending}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {disconnect.isPending ? t('settings.channels.disconnecting') : cta}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
      >
        {cta}
      </button>
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('settings.channels.sms.connectTitle')}
      description={t('settings.channels.sms.connectDescription')}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        {form.submitError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <label htmlFor="sms-account-sid" className="mb-1.5 block text-sm font-medium">
          {t('settings.channels.sms.accountSidLabel')}
        </label>
        <input
          id="sms-account-sid"
          value={form.values.account_sid}
          autoFocus
          onChange={(event) => form.setValue('account_sid', event.target.value)}
          onBlur={() => form.blur('account_sid')}
          aria-invalid={form.errorFor('account_sid') ? true : undefined}
          aria-describedby={form.errorFor('account_sid') ? 'sms-account-sid-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="sms-account-sid-error" message={form.errorFor('account_sid')} />

        <label htmlFor="sms-auth-token" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('settings.channels.sms.authTokenLabel')}
        </label>
        <input
          id="sms-auth-token"
          type="password"
          autoComplete="off"
          value={form.values.auth_token}
          onChange={(event) => form.setValue('auth_token', event.target.value)}
          onBlur={() => form.blur('auth_token')}
          aria-invalid={form.errorFor('auth_token') ? true : undefined}
          aria-describedby={form.errorFor('auth_token') ? 'sms-auth-token-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="sms-auth-token-error" message={form.errorFor('auth_token')} />

        <label htmlFor="sms-phone-number" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('settings.channels.sms.phoneNumberLabel')}
        </label>
        <input
          id="sms-phone-number"
          value={form.values.phone_number}
          onChange={(event) => form.setValue('phone_number', event.target.value)}
          onBlur={() => form.blur('phone_number')}
          aria-invalid={form.errorFor('phone_number') ? true : undefined}
          aria-describedby={form.errorFor('phone_number') ? 'sms-phone-number-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="sms-phone-number-error" message={form.errorFor('phone_number')} />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {form.isSubmitting
              ? t('settings.channels.connecting')
              : t('settings.channels.cta.connect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
