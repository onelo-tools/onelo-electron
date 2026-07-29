import { getCachedCodesignFingerprint, getCodesignOS } from './codesign'
import { getInstanceId } from './instance-id'
import { version as SDK_VERSION } from '../package.json'

/**
 * Returns common security headers to include in every SDK HTTP request.
 * - X-SDK-Version: always sent
 * - X-Bundle-Id: sent when bundleId is configured (required by backend validate_sdk_request_security)
 * - X-Codesign-Fingerprint: sent when available (macOS/Electron codesign validation)
 */
export function sdkHeaders(extra?: Record<string, string>): Record<string, string>
export function sdkHeaders(bundleId?: string, extra?: Record<string, string>): Record<string, string>
export function sdkHeaders(
  bundleIdOrExtra?: string | Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> {
  const bundleId = typeof bundleIdOrExtra === 'string' ? bundleIdOrExtra : undefined
  const extraHeaders = typeof bundleIdOrExtra === 'object' ? bundleIdOrExtra : extra
  const fp = getCachedCodesignFingerprint()
  const codesignOS = fp ? getCodesignOS() : null
  return {
    'X-SDK-Version': SDK_VERSION,
    // Platform attribution for feature discovery. Without this, rows registered
    // via POST /api/sdk/features/batch-ping stored sdk_platform=NULL (Node fetch
    // sends no SDK User-Agent, so the backend's UA fallback found nothing).
    //
    // The VALUE MUST be 'js', not 'electron': the discovery endpoint validates
    // this header against _KNOWN_SDK_PLATFORMS (= the values of _UA_LANGUAGE_MAP:
    // python/swift/js/kotlin/flutter/go) in backend/app/routes/sdk_features.py,
    // and that map deliberately collapses `onelo-electron → "js"` ("Electron and
    // React Native share js"). An unknown 'electron' is rejected → falls back to
    // UA parsing → NULL again. 'js' is exactly what onelo-js sends
    // (onelo-js/src/features/features.ts) and what the backend expects for this
    // runtime. (The SSE live-connections dashboard uses a SEPARATE vocabulary
    // — broadcaster PLATFORM_WHITELIST, which DOES have 'electron' — so
    // event-stream.ts's query param stays 'electron'; the two are unrelated.)
    'X-Onelo-Sdk-Platform': 'js',
    // Per-install id — required by the backend for test-env feature discovery
    // (TOFU binding) and sent on every request (parity with Swift).
    'X-Onelo-Instance-Id': getInstanceId(),
    ...(bundleId ? { 'X-Bundle-Id': bundleId } : {}),
    ...(fp ? { 'X-Codesign-Fingerprint': fp } : {}),
    ...(codesignOS ? { 'X-Codesign-Platform': codesignOS } : {}),
    ...extraHeaders,
  }
}
