/**
 * `/workspaces/*` (tm 389.9): the list at the index, one workspace under its licence number.
 */
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { WorkspaceDetailPage } from './WorkspaceDetailPage.js';
import { WorkspacesPage } from './WorkspacesPage.js';

export function WorkspacesSection(): ReactElement {
  return (
    <Routes>
      <Route index element={<WorkspacesPage />} />
      <Route path=":licenseId/*" element={<WorkspaceDetailPage />} />
    </Routes>
  );
}
