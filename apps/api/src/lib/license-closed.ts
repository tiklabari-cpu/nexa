/**
 * The refusal a closed workspace answers with (tm 389.2).
 *
 * Two closed states (`isLicenseClosed` in `@siyahtus/types`), two answers,
 * one place that says which:
 *
 *   - `canceled` — the workspace was wound down: `license_expired` (402), the
 *     answer it has always had.
 *   - `suspended` — the platform locked it: `not_allowed` (403) with
 *     `details.reason: 'workspace_suspended'`. Not `license_expired`, because
 *     nothing the workspace can buy lifts it, and not `authentication`: the
 *     credential is genuine, and a 401 would send the panel into a sign-in
 *     loop instead of the "temporarily out of service" screen.
 *
 * The operator's reason (`licenses.suspended_reason`) is never part of it.
 */
import { WORKSPACE_SUSPENDED_REASON, type LicenseClosedStatus } from '@siyahtus/types';
import { ApiError } from './api-error.js';

export function workspaceSuspended(): ApiError {
  return new ApiError('not_allowed', 'This workspace is temporarily suspended.', {
    details: { reason: WORKSPACE_SUSPENDED_REASON },
  });
}

export function licenseClosedError(status: LicenseClosedStatus): ApiError {
  if (status === 'suspended') return workspaceSuspended();
  return new ApiError('license_expired', 'This workspace is no longer active.');
}
