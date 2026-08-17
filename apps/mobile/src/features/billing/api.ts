/**
 * The four requests the Billing screen makes, kept apart the same way
 * `features/playbook/api.ts` and `features/team/api.ts` are: path literals
 * live here, not scattered across the component, so a screen — and a test of
 * one — can hand in a plain object instead of a real session and a real fetch.
 *
 * `/billing/payment-method` and `POST /billing/api-packages/purchases` are
 * never called from here — card entry and purchasing are out of scope on the
 * phone (CLAUDE.md: "kart / ödeme YOK"; 13.7-o KAPSAM). `GET
 * /billing/invoices/{period}/download` is also not called: a mobile
 * file/share flow for a CSV download is its own piece of work, not this one's.
 */
import type { SessionApiClient } from '../../api/client';
import type { Entitlements, Invoice, Subscription, Usage } from './types';

export interface BillingApi {
  getSubscription(signal?: AbortSignal): Promise<Subscription>;
  getUsage(signal?: AbortSignal): Promise<Usage>;
  listInvoices(signal?: AbortSignal): Promise<Invoice[]>;
  getEntitlements(signal?: AbortSignal): Promise<Entitlements>;
}

export function createBillingApi(client: SessionApiClient): BillingApi {
  return {
    getSubscription(signal) {
      return client.request('get', '/billing/subscription', { ...(signal ? { signal } : {}) });
    },

    getUsage(signal) {
      return client.request('get', '/billing/usage', { ...(signal ? { signal } : {}) });
    },

    listInvoices(signal) {
      return client
        .request('get', '/billing/invoices', { ...(signal ? { signal } : {}) })
        .then((page) => page.invoices);
    },

    getEntitlements(signal) {
      return client.request('get', '/billing/entitlements', { ...(signal ? { signal } : {}) });
    },
  };
}
