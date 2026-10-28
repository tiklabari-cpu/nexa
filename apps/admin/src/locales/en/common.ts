import type { Messages } from '../merge.js';

/**
 * Shared text — the ADR-06 error taxonomy rendered for a human, and the design-system
 * primitives' own words (tm 389.6). `common.errors.<type>` covers every member of
 * `ERROR_TYPES` plus the client-only `network` and `unknown`; `i18n-coverage.test.ts`
 * fails if the taxonomy grows a type this file has not answered for.
 */
export const common: Messages = {
  'common.actions.collapsePanel': 'Collapse panel',
  'common.actions.dismiss': 'Dismiss',
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
  'common.errors.challenge_required': 'Please confirm you are a person to continue.',
  'common.errors.chat_anonymized': 'This conversation was anonymised and can no longer be opened.',
  'common.errors.chat_inactive': 'This conversation is no longer active.',
  'common.errors.customer_banned': 'This visitor is banned.',
  'common.errors.fallback_rule_exists':
    'This workspace already has a fallback routing rule — edit that one instead.',
  'common.errors.greeting_not_found': 'We could not find that greeting.',
  'common.errors.group_expertise_missing':
    'This team requires skills that are missing — add them to the agent first.',
  'common.errors.group_in_use':
    'This team is still in use — a routing rule points at it, or conversations are open with it.',
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
  'common.loadError.retry': 'Try again',
  'ui.confirm.cancel': 'Cancel',
  'ui.confirm.delete': 'Delete',
  'ui.confirm.pending': 'Working…',
  'ui.form.cardLast4': 'Enter the last 4 digits — exactly 4 numbers.',
  'ui.form.domain': 'Enter a valid domain, like shop.example.',
  'ui.form.email': 'Enter a valid email address.',
  'ui.form.emailListEmpty': 'Enter at least one email address.',
  'ui.form.emailListInvalid': 'Not a valid address: {addresses}',
  'ui.form.maxLength': 'Enter at most {count} characters.',
  'ui.form.minLength': 'Enter at least {count} characters.',
  'ui.form.phone': 'Enter a valid phone number, e.g. +15551234567.',
  'ui.form.required': 'This field is required.',
  'ui.form.submitFailed': 'Something went wrong. Please try again.',
  'ui.save.clean': 'All changes saved',
  'ui.save.discard': 'Discard',
  'ui.save.failed': 'Your changes were not saved. They are still here — try again.',
  'ui.save.leaveMessage': 'You have unsaved changes in this section. Leave and discard them?',
  'ui.save.save': 'Save',
  'ui.save.saving': 'Saving…',
  'ui.save.unsaved': 'Unsaved changes',
  'ui.highRisk.after': 'After',
  'ui.highRisk.before': 'Before',
  'ui.highRisk.changes': 'Changes',
  'ui.highRisk.confirm': 'Confirm and save',
  'ui.highRisk.description':
    'This setting affects the whole platform. Check the change below and say why you are making it — the reason is written to the platform audit log.',
  'ui.highRisk.empty': '(empty)',
  'ui.highRisk.reason': 'Reason',
  'ui.highRisk.reasonHint': 'Required. Recorded in the audit log.',
  'ui.highRisk.reasonRequired': 'Enter a reason for this change.',
  'ui.highRisk.title': 'Confirm this change',
};
