export { Onelo } from './onelo'
export { OneloFeedback } from './feedback'
export { OneloMonitor } from './monitor'
export type { MonitorEventOptions } from './monitor'
export { OneloElectronAuth } from './auth'
export { OneloFeatures, FeatureState, OneloFeaturesError } from './features'
export type { FeatureStatus, FeatureReason, UpgradeHint, FeatureSnapshot, OneloFeaturesErrorCode } from './features'
export type { MonitorContext } from './monitor'
export { SecureTokenStorage } from './storage'
export { OneloForms } from './forms'
export { OneloWaitlist } from './waitlist'
export { OneloElectronCustomerPortal } from './customer-portal'
export { OneloConsent } from './consent'
export type { OneloConsentRequirement, OneloConsentEnforcement } from './consent'
export { OneloStore } from './store'
export { IPC_CHANNELS, OneloError } from './types'
// Cancel/refund reason-code constants + human labels, for developer-built
// cancel-survey UIs on paid plans (parity with Swift OneloResponseReasonCode /
// JS @onelo/core). Re-exported from @onelo/core (already a dependency).
// NOTE: a programmatic `paywall.cancelSubscription()` is intentionally NOT
// shipped yet — the only working cancel path is the hosted `customerPortal`,
// and the backend's canonical programmatic-cancel contract (/portal-cancel
// needs token+access_id) is not yet exposed as a clean SDK call. These enums
// let devs render a reason survey around the hosted portal in the meantime.
export { RESPONSE_REASON_CODES, REASON_LABELS } from '@onelo/core'
export type { ResponseReasonCode } from '@onelo/core'
export type {
  OneloElectronConfig,
  OneloElectronSession,
  OneloElectronUser,
  ResolvedSDKConfig,
  UserRole,
} from './types'
