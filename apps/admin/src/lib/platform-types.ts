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
