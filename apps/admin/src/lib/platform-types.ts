/**
 * The platform contract's wire types, named once (tm 389.6). Type-only: they come from the
 * generated `packages/contract/src/generated/platform.ts` and cost the bundle nothing.
 */
import type { platformComponents } from '@siyahtus/contract';

type Schemas = platformComponents['schemas'];

export type PlatformMe = Schemas['PlatformMe'];
export type PlatformSession = Schemas['PlatformSession'];
export type PlatformSignIn = Schemas['PlatformSignIn'];
export type PlatformTotpEnrollment = Schemas['PlatformTotpEnrollment'];
export type PlatformTotpActivation = Schemas['PlatformTotpActivation'];
export type PlatformTotpVerification = Schemas['PlatformTotpVerification'];
export type PlatformSessionEnvelope = Schemas['PlatformSessionEnvelope'];
export type PlatformMeta = Schemas['PlatformMeta'];
export type PlatformLoginRequest = Schemas['PlatformLoginRequest'];
export type PlatformCodeRequest = Schemas['PlatformCodeRequest'];
export type PlatformVerifyRequest = Schemas['PlatformVerifyRequest'];
export type PlatformInviteAcceptRequest = Schemas['PlatformInviteAcceptRequest'];

export type PlatformDashboardKpis = Schemas['PlatformDashboardKpis'];
export type PlatformDashboardSignups = Schemas['PlatformDashboardSignups'];
export type PlatformDashboardHealth = Schemas['PlatformDashboardHealth'];
export type PlatformHealthSnapshot = Schemas['PlatformHealthSnapshot'];
export type PlatformComponentStatus = Schemas['PlatformComponentStatus'];

export type PlatformLicenseStatus = Schemas['PlatformLicenseStatus'];
export type PlatformPlan = Schemas['PlatformPlan'];
export type PlatformWorkspaceSummary = Schemas['PlatformWorkspaceSummary'];
export type PlatformWorkspaceList = Schemas['PlatformWorkspaceList'];
export type PlatformWorkspaceDetail = Schemas['PlatformWorkspaceDetail'];
export type PlatformWorkspace = Schemas['PlatformWorkspace'];
export type PlatformWorkspaceActionResult = Schemas['PlatformWorkspaceActionResult'];
export type PlatformWorkspaceOverrides = Schemas['PlatformWorkspaceOverrides'];
export type PlatformWorkspaceOverridesEnvelope = Schemas['PlatformWorkspaceOverridesEnvelope'];
export type PlatformWorkspacePurgeQueue = Schemas['PlatformWorkspacePurgeQueue'];
export type PlatformWorkspaceMemberList = Schemas['PlatformWorkspaceMemberList'];
export type PlatformWorkspaceBrandList = Schemas['PlatformWorkspaceBrandList'];
export type PlatformWorkspaceUsage = Schemas['PlatformWorkspaceUsage'];
export type PlatformWorkspaceSubscription = Schemas['PlatformWorkspaceSubscription'];
export type PlatformWorkspaceInvoiceList = Schemas['PlatformWorkspaceInvoiceList'];
export type PlatformWorkspaceSandbox = Schemas['PlatformWorkspaceSandbox'];
export type PlatformWorkspaceNote = Schemas['PlatformWorkspaceNote'];
export type PlatformWorkspaceNoteList = Schemas['PlatformWorkspaceNoteList'];
export type PlatformWorkspaceImpersonationList = Schemas['PlatformWorkspaceImpersonationList'];
export type PlatformWorkspaceAiSummary = Schemas['PlatformWorkspaceAiSummary'];
export type PlatformWorkspaceAuditList = Schemas['PlatformWorkspaceAuditList'];
export type PlatformSupportLookup = Schemas['PlatformSupportLookup'];

export type PlatformAccountSummary = Schemas['PlatformAccountSummary'];
export type PlatformAccountList = Schemas['PlatformAccountList'];
export type PlatformAccount = Schemas['PlatformAccount'];
export type PlatformAccountDetail = Schemas['PlatformAccountDetail'];
export type PlatformAccountActionResult = Schemas['PlatformAccountActionResult'];
export type PlatformAccountErased = Schemas['PlatformAccountErased'];
export type PlatformAccountExport = Schemas['PlatformAccountExport'];

export type PlatformBillingPlanList = Schemas['PlatformBillingPlanList'];
export type PlatformSubscriptionList = Schemas['PlatformSubscriptionList'];
export type PlatformInvoiceList = Schemas['PlatformInvoiceList'];
export type PlatformBillingPackages = Schemas['PlatformBillingPackages'];
export type PlatformRevenue = Schemas['PlatformRevenue'];
export type PlatformCredit = Schemas['PlatformCredit'];
export type PlatformCreditList = Schemas['PlatformCreditList'];
export type PlatformCreditEnvelope = Schemas['PlatformCreditEnvelope'];

export type PlatformGlobalUsage = Schemas['PlatformGlobalUsage'];
export type PlatformTopUsage = Schemas['PlatformTopUsage'];
export type PlatformUsageTopMeter = Schemas['PlatformUsageTopMeter'];
export type PlatformWorkspaceUsageDetail = Schemas['PlatformWorkspaceUsageDetail'];
export type PlatformWorkspaceAiCapsResult = Schemas['PlatformWorkspaceAiCapsResult'];
export type PlatformAiCapLayers = Schemas['PlatformAiCapLayers'];
export type PlatformPlanAiCaps = Schemas['PlatformPlanAiCaps'];
export type PlatformPlanAiCapsResult = Schemas['PlatformPlanAiCapsResult'];
