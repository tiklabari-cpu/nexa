/**
 * `/usage/*` (tm 389.12): the deployment's usage at the index, one workspace's allowance under
 * its licence number.
 */
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { UsagePage } from './UsagePage.js';
import { UsageWorkspacePage } from './UsageWorkspacePage.js';

export function UsageSection(): ReactElement {
  return (
    <Routes>
      <Route index element={<UsagePage />} />
      <Route path=":licenseId" element={<UsageWorkspacePage />} />
    </Routes>
  );
}
