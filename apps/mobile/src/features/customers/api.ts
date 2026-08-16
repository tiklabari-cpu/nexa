/**
 * The two requests the Customers screens make, kept apart the same way
 * `features/inbox/api.ts` is: path literals and query parameter names live
 * here, not scattered across components, so a screen — and a test of one —
 * can hand in a plain object instead of a real session and a real fetch.
 */
import type { SessionApiClient } from '../../api/client';
import type { CustomerDetail, CustomerSegment, CustomerSummary } from './types';

/** One screenful, and the step "load more" advances the list by. */
export const PAGE_SIZE = 30;

export interface CustomersPage {
  items: CustomerSummary[];
  total: number;
  /** Feed back as `pageId`; absent means this was the last page. */
  next_page_id?: string;
}

export interface CustomersApi {
  listCustomers(options: {
    segment: CustomerSegment;
    query?: string;
    pageId?: string;
    signal?: AbortSignal;
  }): Promise<CustomersPage>;
  getCustomer(customerId: string, signal?: AbortSignal): Promise<CustomerDetail>;
}

export function createCustomersApi(client: SessionApiClient): CustomersApi {
  return {
    listCustomers({ segment, query, pageId, signal }) {
      return client.request('get', '/customers', {
        query: {
          segment,
          limit: PAGE_SIZE,
          ...(query ? { query } : {}),
          ...(pageId ? { page_id: pageId } : {}),
        },
        ...(signal ? { signal } : {}),
      });
    },

    getCustomer(customerId, signal) {
      return client.request('get', '/customers/{customerId}', {
        params: { customerId },
        ...(signal ? { signal } : {}),
      });
    },
  };
}
