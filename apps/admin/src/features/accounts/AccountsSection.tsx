/**
 * `/accounts/*` (tm 389.11): the search at the index, one account under its id.
 */
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AccountDetailPage } from './AccountDetailPage.js';
import { AccountsPage } from './AccountsPage.js';

export function AccountsSection(): ReactElement {
  return (
    <Routes>
      <Route index element={<AccountsPage />} />
      <Route path=":accountId" element={<AccountDetailPage />} />
    </Routes>
  );
}
