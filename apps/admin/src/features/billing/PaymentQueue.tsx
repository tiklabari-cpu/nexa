/**
 * Billing › Payment queue (tm 389.18 · FR-ADMIN-14): the crypto payment requests the team
 * answers — send the wallet address, confirm the TXID found on the chain, refuse — and the bank
 * transfers waiting to be matched to their reference.
 *
 * `billing.manage` acts (billing, superadmin); every other role reads the same lists without
 * the buttons, and the server refuses it either way. A confirmation ends where a card payment
 * does: the workspace's subscription active, the term paid.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { isValidTxid, isValidWalletAddress, type CryptoNetwork } from '@siyahtus/types';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/Banner.js';
import { ApiClientError } from '../../lib/api-client.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { PlatformPaymentRequest, PlatformSwiftPayment } from '../../lib/platform-types.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import {
  REQUEST_FILTERS,
  SWIFT_FILTERS,
  useConfirmTxid,
  useMarkSwiftPaid,
  usePaymentRequests,
  useRejectRequest,
  useSendAddress,
  useSwiftPayments,
  type RequestFilter,
  type SwiftFilter,
} from './payment-queries.js';

type Dialog =
  | { kind: 'address'; request: PlatformPaymentRequest }
  | { kind: 'txid'; request: PlatformPaymentRequest }
  | { kind: 'reject'; request: PlatformPaymentRequest }
  | { kind: 'swift'; payment: PlatformSwiftPayment }
  | null;

const money = (minor: number, currency: string) =>
  formatMoney(minor, currency.toUpperCase()) ?? String(minor);

/** The refusals worth a precise sentence; anything else falls back to its type's. */
export function describePaymentError(t: TFunction) {
  return (error: unknown): string | null => {
    if (!(error instanceof ApiClientError)) return null;
    if (error.status === 404) return t('billing.payments.error.notFound');
    const reason = error.details?.['reason'];
    const known = [
      'network_mismatch',
      'address_invalid',
      'txid_invalid',
      'txid_mismatch',
      'txid_used',
      'reference_mismatch',
      'already_settled',
      'not_awaiting_address',
      'not_awaiting_confirmation',
      'not_cancellable',
    ];
    return typeof reason === 'string' && known.includes(reason)
      ? t(`billing.payments.error.${reason}`)
      : null;
  };
}

export function PaymentQueue(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'billing.manage');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (message: string) => () => {
    setDialog(null);
    setNotice(message);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <Banner tone="success" role="status" dismissible onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      <CryptoSection canManage={canManage} onAct={setDialog} />
      <SwiftSection canManage={canManage} onAct={setDialog} />
      {dialog?.kind === 'address' && (
        <SendAddressDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onDone={done(t('billing.payments.address.done'))}
        />
      )}
      {dialog?.kind === 'txid' && (
        <ConfirmTxidDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onDone={done(t('billing.payments.txid.done'))}
        />
      )}
      {dialog?.kind === 'reject' && (
        <RejectDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onDone={done(t('billing.payments.reject.done'))}
        />
      )}
      {dialog?.kind === 'swift' && (
        <MarkPaidDialog
          payment={dialog.payment}
          onClose={() => setDialog(null)}
          onDone={done(t('billing.payments.swift.done'))}
        />
      )}
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-sm font-semibold">
        {title}
      </h2>
      <Card>{children}</Card>
    </section>
  );
}

function StateFilter<T extends string>({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  onChange: (value: T) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="border-b border-border p-4">
      <label htmlFor={id} className="text-xs text-content-secondary">
        {t('billing.payments.state')}
      </label>
      <select
        id={id}
        className={`${FIELD_CLASS} max-w-xs`}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {label(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

function MoreButton({
  query,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}): ReactElement | null {
  const t = useTranslate();
  if (!query.hasNextPage) return null;
  return (
    <div className="border-t border-border p-3">
      <button
        type="button"
        className={SECONDARY_BUTTON_CLASS}
        disabled={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        {t('billing.more')}
      </button>
    </div>
  );
}

function WorkspaceLink({ id, name }: { id: string; name: string }): ReactElement {
  return (
    <Link to={`/workspaces/${id}`} className={LINK_CLASS}>
      {name}
    </Link>
  );
}

/** A long hash or address, shortened on screen and whole in its title and to a screen reader. */
function Code({ value }: { value: string | null }): ReactElement | null {
  if (!value) return null;
  const short = value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <code className="break-all text-xs" title={value} aria-label={value}>
      {short}
    </code>
  );
}

// --- Crypto requests ------------------------------------------------------------

function CryptoSection({
  canManage,
  onAct,
}: {
  canManage: boolean;
  onAct: (dialog: Dialog) => void;
}): ReactElement {
  const t = useTranslate();
  const [state, setState] = useState<RequestFilter>('open');
  const query = usePaymentRequests(state);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Section id="billing-crypto-queue" title={t('billing.payments.crypto.title')}>
      <StateFilter
        id="billing-crypto-state"
        value={state}
        options={REQUEST_FILTERS}
        label={(option) => t(`billing.payments.requestState.${option}`)}
        onChange={setState}
      />
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.payments.crypto.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyLine>{t('billing.payments.crypto.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('billing.payments.crypto.title')}
          headers={[
            t('billing.workspace'),
            t('billing.payments.network'),
            t('billing.payments.amount'),
            t('billing.payments.crypto.billingName'),
            t('billing.payments.state'),
            t('billing.payments.crypto.address'),
            t('billing.payments.crypto.txid'),
            t('billing.payments.requested'),
            t('billing.payments.actions'),
          ]}
        >
          {rows.map((row) => {
            const open = row.status === 'requested' || row.status === 'address_sent';
            const canSend =
              row.status === 'requested' || (row.status === 'address_sent' && !row.txid);
            return (
              <tr key={row.id}>
                <Cell>
                  <WorkspaceLink id={row.license_id} name={row.organization_name} />
                </Cell>
                <Cell>{t(`billing.payments.networkName.${row.network}`)}</Cell>
                <Cell>{money(row.amount_minor, row.currency)}</Cell>
                <Cell>{row.billing_name}</Cell>
                <Cell>
                  {t(`billing.payments.requestState.${row.status}`)}
                  {row.closed_reason && (
                    <span className="block text-xs text-content-secondary">
                      {row.closed_reason}
                    </span>
                  )}
                </Cell>
                <Cell>
                  <Code value={row.wallet_address} />
                </Cell>
                <Cell>
                  <Code value={row.txid} />
                </Cell>
                <Cell>{formatDate(row.created_at)}</Cell>
                <Cell>
                  {canManage && open ? (
                    <div className="flex flex-wrap gap-2">
                      {canSend && (
                        <button
                          type="button"
                          className={SECONDARY_BUTTON_CLASS}
                          onClick={() => onAct({ kind: 'address', request: row })}
                        >
                          {t(
                            row.status === 'requested'
                              ? 'billing.payments.address.open'
                              : 'billing.payments.address.replace',
                            { workspace: row.organization_name },
                          )}
                        </button>
                      )}
                      {row.status === 'address_sent' && (
                        <button
                          type="button"
                          className={SECONDARY_BUTTON_CLASS}
                          onClick={() => onAct({ kind: 'txid', request: row })}
                        >
                          {t('billing.payments.txid.open', { workspace: row.organization_name })}
                        </button>
                      )}
                      <button
                        type="button"
                        className={SECONDARY_BUTTON_CLASS}
                        onClick={() => onAct({ kind: 'reject', request: row })}
                      >
                        {t('billing.payments.reject.open', { workspace: row.organization_name })}
                      </button>
                    </div>
                  ) : null}
                </Cell>
              </tr>
            );
          })}
        </DataTable>
      )}
      <MoreButton query={query} />
    </Section>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-content-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

function SendAddressDialog({
  request,
  onClose,
  onDone,
}: {
  request: PlatformPaymentRequest;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const send = useSendAddress();
  const [address, setAddress] = useState(request.wallet_address ?? '');
  const network = request.network as CryptoNetwork;
  const valid = isValidWalletAddress(network, address);

  return (
    <ReasonDialog
      title={t('billing.payments.address.title', { workspace: request.organization_name })}
      description={t('billing.payments.address.body', {
        amount: money(request.amount_minor, request.currency),
        network: t(`billing.payments.networkName.${request.network}`),
      })}
      confirmLabel={t('billing.payments.address.confirm')}
      confirmDisabled={!valid}
      extraDirty={address !== (request.wallet_address ?? '')}
      describeError={describePaymentError(t)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) =>
        send.mutateAsync({ id: request.id, network, address: address.trim(), reason })
      }
    >
      <Field
        id="payment-address"
        label={t('billing.payments.crypto.address')}
        hint={t(`billing.payments.address.hint.${request.network}`)}
      >
        <input
          id="payment-address"
          className={`${FIELD_CLASS} font-mono`}
          autoComplete="off"
          spellCheck={false}
          value={address}
          aria-describedby="payment-address-hint"
          onChange={(event) => setAddress(event.target.value.trim())}
        />
      </Field>
    </ReasonDialog>
  );
}

function ConfirmTxidDialog({
  request,
  onClose,
  onDone,
}: {
  request: PlatformPaymentRequest;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const confirm = useConfirmTxid();
  const [txid, setTxid] = useState(request.txid ?? '');
  const valid = isValidTxid(request.network as CryptoNetwork, txid);

  return (
    <ReasonDialog
      title={t('billing.payments.txid.title', { workspace: request.organization_name })}
      description={t(
        request.txid ? 'billing.payments.txid.bodyOwner' : 'billing.payments.txid.bodyNone',
        { amount: money(request.amount_minor, request.currency) },
      )}
      confirmLabel={t('billing.payments.txid.confirm')}
      confirmDisabled={!valid}
      extraDirty={txid !== (request.txid ?? '')}
      describeError={describePaymentError(t)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) => confirm.mutateAsync({ id: request.id, txid: txid.trim(), reason })}
    >
      <Field
        id="payment-txid"
        label={t('billing.payments.crypto.txid')}
        hint={t('billing.payments.txid.hint')}
      >
        <input
          id="payment-txid"
          className={`${FIELD_CLASS} font-mono`}
          autoComplete="off"
          spellCheck={false}
          value={txid}
          aria-describedby="payment-txid-hint"
          onChange={(event) => setTxid(event.target.value.trim())}
        />
      </Field>
    </ReasonDialog>
  );
}

function RejectDialog({
  request,
  onClose,
  onDone,
}: {
  request: PlatformPaymentRequest;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const reject = useRejectRequest();
  return (
    <ReasonDialog
      title={t('billing.payments.reject.title', { workspace: request.organization_name })}
      description={t('billing.payments.reject.body')}
      confirmLabel={t('billing.payments.reject.confirm')}
      describeError={describePaymentError(t)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) => reject.mutateAsync({ id: request.id, reason })}
    />
  );
}

// --- Bank transfers ----------------------------------------------------------------

function SwiftSection({
  canManage,
  onAct,
}: {
  canManage: boolean;
  onAct: (dialog: Dialog) => void;
}): ReactElement {
  const t = useTranslate();
  const [state, setState] = useState<SwiftFilter>('pending');
  const query = useSwiftPayments(state);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Section id="billing-swift-queue" title={t('billing.payments.swift.title')}>
      <StateFilter
        id="billing-swift-state"
        value={state}
        options={SWIFT_FILTERS}
        label={(option) => t(`billing.payments.swiftState.${option}`)}
        onChange={setState}
      />
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.payments.swift.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyLine>{t('billing.payments.swift.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('billing.payments.swift.title')}
          headers={[
            t('billing.workspace'),
            t('billing.payments.swift.reference'),
            t('billing.payments.amount'),
            t('billing.payments.state'),
            t('billing.payments.requested'),
            t('billing.payments.actions'),
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell>
                <WorkspaceLink id={row.license_id} name={row.organization_name} />
              </Cell>
              <Cell>
                <code className="text-xs">{row.reference}</code>
              </Cell>
              <Cell>{money(row.amount_minor, row.currency)}</Cell>
              <Cell>{t(`billing.payments.swiftState.${row.status}`)}</Cell>
              <Cell>{formatDate(row.created_at)}</Cell>
              <Cell>
                {canManage && row.status === 'pending' ? (
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    onClick={() => onAct({ kind: 'swift', payment: row })}
                  >
                    {t('billing.payments.swift.open', { reference: row.reference })}
                  </button>
                ) : null}
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <MoreButton query={query} />
    </Section>
  );
}

function MarkPaidDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PlatformSwiftPayment;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const mark = useMarkSwiftPaid();
  const [reference, setReference] = useState('');
  const matches = reference.trim().toUpperCase() === payment.reference;

  return (
    <ReasonDialog
      title={t('billing.payments.swift.dialogTitle', { workspace: payment.organization_name })}
      description={t('billing.payments.swift.body', {
        amount: money(payment.amount_minor, payment.currency),
        reference: payment.reference,
      })}
      confirmLabel={t('billing.payments.swift.confirm')}
      confirmDisabled={!matches}
      extraDirty={reference !== ''}
      describeError={describePaymentError(t)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) =>
        mark.mutateAsync({ id: payment.id, reference: reference.trim(), reason })
      }
    >
      <Field
        id="payment-reference"
        label={t('billing.payments.swift.reference')}
        hint={t('billing.payments.swift.hint')}
      >
        <input
          id="payment-reference"
          className={`${FIELD_CLASS} font-mono`}
          autoComplete="off"
          value={reference}
          aria-describedby="payment-reference-hint"
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
    </ReasonDialog>
  );
}
