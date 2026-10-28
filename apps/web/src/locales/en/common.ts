import type { Messages } from '../merge.js';

/**
 * Shared text — chiefly the ADR-06 error taxonomy rendered for a human.
 *
 * `common.errors.<type>` covers every member of `ERROR_TYPES` (@siyahtus/types),
 * plus the client-only `network` and a final `unknown` for a thrown value that
 * is not an `ApiClientError` at all. `api-client.ts`'s `errorMessageKey()` is
 * the only thing that builds these keys, and `i18n-coverage.test.ts` fails if
 * the taxonomy grows a type this file has not answered for.
 *
 * The server's own `message` is English prose meant for the developer reading a
 * log line, and it is never shown: a console in Turkish that answers a failed
 * save with "Chat is not active." is not translated, it is half-translated.
 * Anything a user genuinely needs beyond the sentence here — which field was
 * rejected — travels in `error.details`, not in the message.
 */
export const common: Messages = {
  'common.errors.account_exists': 'That email address already has an account.',
  'common.errors.ai_agent_exists': 'This workspace already has an AI agent.',
  'common.errors.ai_config_revision_conflict':
    'Someone else saved these AI settings after you opened them — reload and make your change again.',
  'common.errors.ai_config_version_state':
    'This AI settings version cannot take that step in its current state.',
  'common.errors.ai_guardrail_setup_incomplete':
    'The AI agent cannot go live until its crisis text is written and approved by the owner.',
  'common.errors.ai_mode_transition_refused': 'The AI is not answering this conversation.',
  'common.errors.ai_return_blocked':
    'This conversation is flagged and has to stay with a person; it cannot go back to the AI.',
  'common.errors.ai_test_run_in_progress':
    'A test run of this AI agent is still under way — wait for it to finish.',
  'common.errors.authentication': 'Your session has expired — sign in again.',
  'common.errors.authorization': 'You do not have permission to do that.',
  'common.errors.brand_exists': 'A brand with that name already exists.',
  'common.errors.brand_not_found': 'We could not find that brand.',
  'common.errors.chat_anonymized': 'This conversation was anonymised and can no longer be opened.',
  'common.errors.chat_inactive': 'This conversation is no longer active.',
  'common.errors.challenge_required': 'Please confirm you are a person to continue.',
  'common.errors.customer_banned': 'This visitor is banned.',
  'common.errors.fallback_rule_exists':
    'This workspace already has a fallback routing rule — edit that one instead.',
  'common.errors.greeting_not_found': 'We could not find that greeting.',
  'common.errors.group_in_use':
    'This team is still in use — a routing rule points at it, or conversations are open with it.',
  'common.errors.group_expertise_missing':
    'This team requires skills that are missing — add them to the agent first.',
  'common.errors.group_not_found': 'We could not find that team.',
  'common.errors.group_offline': 'That team is offline right now.',
  'common.errors.group_protected':
    'The responsible gambling team cannot be deleted, lose its topic or go without its training skill — rename it instead.',
  'common.errors.group_topic_role_taken':
    'Another team already handles this topic — clear it there first.',
  'common.errors.group_unavailable': 'That team cannot take this conversation right now.',
  'common.errors.groups_offline': 'Every team is offline right now.',
  'common.errors.impersonation_forbidden_path':
    'A support session cannot do this on a member’s behalf.',
  'common.errors.impersonation_read_only':
    'This is a read-only support session — nothing can be changed from it.',
  'common.errors.internal': 'Something went wrong on our side — try again.',
  'common.errors.knowledge_job_in_progress':
    'This source is already being crawled — wait for it to finish or cancel it.',
  'common.errors.knowledge_source_exists':
    'This file is already in the knowledge base — open the existing source instead.',
  'common.errors.license_expired': 'Your subscription has ended — renew it to continue.',
  'common.errors.limit_reached': 'You have reached the limit for your plan.',
  'common.errors.maintenance': 'The service is down for maintenance. Please try again later.',
  'common.errors.message_rejected': 'That message was rejected.',
  'common.errors.misdirected_request': 'That request went to the wrong place — reload and retry.',
  'common.errors.network': 'Could not reach the server — check your connection.',
  'common.errors.not_allowed': 'That is not allowed here.',
  'common.errors.not_found': 'We could not find that.',
  'common.errors.pending_requests_limit_reached':
    'Too many requests are already waiting — try again shortly.',
  'common.errors.platform_account_state': 'The account is not in a state that allows this.',
  'common.errors.platform_last_superadmin':
    'This would leave the platform without an active superadmin.',
  'common.errors.platform_operation_running':
    'This operation is already running — try again once it has finished.',
  'common.errors.platform_reason_required':
    'Say why you are doing this (3 to 500 characters) — it goes into the audit log.',
  'common.errors.platform_recent_totp_required':
    'Enter a fresh authenticator code to confirm this action.',
  'common.errors.platform_totp_required': 'Finish signing in with your authenticator code first.',
  'common.errors.platform_workspace_state': 'The workspace is not in a state that allows this.',
  'common.errors.request_timeout': 'That took too long — try again.',
  'common.errors.sandbox_exists': 'This workspace already has a sandbox.',
  'common.errors.service_unavailable':
    'The service is temporarily unavailable — try again shortly.',
  'common.errors.takeover_conflict': 'Someone else took this conversation first.',
  'common.errors.template_locked':
    'This procedure was installed from a locked template — it cannot be switched off or deleted; only its texts and team can change.',
  'common.errors.ticket_exists': 'A ticket already exists for this conversation.',
  'common.errors.ticket_merged':
    'This ticket was merged into another — write on that ticket instead.',
  'common.errors.ticket_no_recipient':
    'This player left no e-mail address, so a reply cannot be sent — you can still add an internal note.',
  'common.errors.too_many_requests': 'Too many attempts — wait a moment and try again.',
  'common.errors.two_factor_already_enabled':
    'Two-factor authentication is already on — turn it off before setting it up again.',
  'common.errors.two_factor_required': 'Enter your two-factor code to continue.',
  'common.errors.unknown': 'Something went wrong — try again.',
  'common.errors.unsupported_version': 'This page is out of date — reload and try again.',
  'common.errors.users_limit_reached': 'Your plan has no seats left.',
  'common.errors.validation': 'Check the highlighted fields and try again.',
  'common.errors.website_exists': 'That website is already connected.',
  'common.errors.wrong_product_version': 'This page is out of date — reload and try again.',
  // The design-system primitives' own defaults — a caller that passes no label
  // still gets one in the agent's language (Banner.tsx, Panel.tsx).
  'common.actions.dismiss': 'Dismiss',
  // LoadError.tsx — the retry every list's failed-read alert shares (tm 259.6).
  'common.loadError.retry': 'Try again',
  // ConfirmDialog.tsx — the shared "are you sure?" (tm 259.7). Filed here, but under
  // `ui.`, not `common.`: `common.errors.*` has to equal ERROR_TYPES exactly.
  'ui.confirm.cancel': 'Cancel',
  'ui.confirm.delete': 'Delete',
  'ui.confirm.pending': 'Working…',
  'ui.writeError.delete': "“{name}” couldn't be deleted.",
  'ui.writeError.remove': "“{name}” couldn't be removed.",
  // lib/form.tsx — the default message of each validator, for a form that passes none
  // (tm 259.18). A form that words its own error keeps its own wording.
  'ui.form.required': 'This field is required.',
  'ui.form.minLength': 'Enter at least {count} characters.',
  'ui.form.maxLength': 'Enter at most {count} characters.',
  'ui.form.email': 'Enter a valid email address.',
  'ui.form.emailListEmpty': 'Enter at least one email address.',
  'ui.form.emailListInvalid': 'Not a valid address: {addresses}',
  'ui.form.domain': 'Enter a valid domain, like shop.example.',
  'ui.form.phone': 'Enter a valid phone number, e.g. +15551234567.',
  'ui.form.cardLast4': 'Enter the last 4 digits — exactly 4 numbers.',
  'ui.form.submitFailed': 'Something went wrong. Please try again.',
  // components/settings — the shared save pattern (tm 323.1 · GV-06): a form that writes on
  // Save, a toggle that writes at once, and the reasoned confirm for high-risk settings.
  'ui.save.unsaved': 'Unsaved changes',
  'ui.save.clean': 'All changes saved',
  'ui.save.save': 'Save',
  'ui.save.saving': 'Saving…',
  'ui.save.discard': 'Discard',
  'ui.save.failed': 'Your changes were not saved. They are still here — try again.',
  'ui.save.leaveMessage': 'You have unsaved changes in this section. Leave and discard them?',
  'ui.instant.hint': 'Saves instantly',
  'ui.instant.saved': 'Saved',
  'ui.instant.undo': 'Undo',
  'ui.instant.failed': "This setting couldn't be saved.",
  'ui.highRisk.title': 'Confirm this change',
  'ui.highRisk.description':
    'This setting changes who can see or do what in the workspace. Check the change below and say why you are making it — the reason is written to the audit log.',
  'ui.highRisk.changes': 'Changes',
  'ui.highRisk.before': 'Before',
  'ui.highRisk.after': 'After',
  'ui.highRisk.empty': '(empty)',
  'ui.highRisk.reason': 'Reason',
  'ui.highRisk.reasonHint': 'Required. Recorded in the audit log.',
  'ui.highRisk.reasonRequired': 'Enter a reason for this change.',
  'ui.highRisk.confirm': 'Confirm and save',
  'common.actions.collapsePanel': 'Collapse panel',
  // Tour.tsx's own chrome (FR-MOD-02.2.3) — step content is the caller's, but
  // Back/Next/Skip/Done and the counter are generic across every tour.
  'common.actions.tourNext': 'Next',
  'common.actions.tourBack': 'Back',
  'common.actions.tourSkip': 'Skip',
  'common.actions.tourDone': 'Done',
  'common.actions.tourProgress': 'Step {current} of {count}',
  // A `limit_reached` that is not the plan's (tm 257.8): the deployment's daily
  // AI allowance, chosen by `errorMessageKey` from `details.reason`.
  'common.limits.aiDailyCap': "Today's AI allowance is used up; it renews at midnight UTC.",
  // tm 257.14, the same way: today's email allowance (the SSO domain challenge
  // could not be mailed), and the hourly sign-up limit per network.
  'common.limits.mailDailyCap':
    "Today's email allowance is used up, so the message was not sent; it renews at midnight UTC.",
  'common.limits.signupRate':
    'Too many workspaces were created from this network recently. Try again in an hour.',
  // tm 257.15: the public pilot's read-only 402, chosen by `errorMessageKey` from
  // `details.reason`. Outside `common.errors.*` (whose keys are exactly the error
  // types). It carries no address — these calls take no parameters — so it points
  // at the strip that does.
  'common.pilot.licenseExpired':
    'Your pilot trial has ended — the contact address is in the bar at the top.',
  // CopyId.tsx (ID-05): the button's name carries the number's own label, so a screen
  // reader hears which number it copies; the label is the ids catalogue's.
  'common.copyId.copy': 'Copy {label}',
  'common.copyId.copied': 'Copied',
};
