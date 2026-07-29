import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Computes the SHA-256 fingerprint of the app's code-signing CERTIFICATE
 * (the signing identity), stable across rebuilds while that identity is unchanged.
 *
 * macOS: extracts the leaf signing cert via `codesign --extract-certificates`
 *   and SHA-256s its DER — NOT the `codesign -dv` CDHash, which is a hash of the
 *   binary's code pages and changes on every rebuild (would break TOFU per release).
 * Windows: PowerShell `Get-AuthenticodeSignature` → signer-cert thumbprint.
 * Linux: returns null (no standard code signing).
 *
 * Both platforms return a lowercase 64-char hex string via the SAME algorithm
 * (SHA-256 of the signing cert's DER), or null on any error. The certs
 * themselves differ per OS (macOS Developer ID vs Windows Authenticode), which
 * is why each OS registers its own fingerprint.
 */
export function getCodesignFingerprint(): string | null {
  try {
    if (process.platform === 'darwin') {
      return getMacOSFingerprint()
    } else if (process.platform === 'win32') {
      return getWindowsFingerprint()
    }
    return null
  } catch {
    return null
  }
}

function getMacOSFingerprint(): string | null {
  // codesign writes the cert chain to <prefix>0 (leaf), <prefix>1, … in DER.
  const prefix = join(tmpdir(), `onelo-cs-${process.pid}-${Date.now()}-`)
  try {
    execSync(
      `codesign -d --extract-certificates="${prefix}" "${process.execPath}" 2>/dev/null`,
      { timeout: 5000 }
    )
    const der = readFileSync(`${prefix}0`) // leaf signing certificate
    return createHash('sha256').update(der).digest('hex').toLowerCase()
  } catch {
    return null
  } finally {
    // Best-effort cleanup of the extracted cert-chain files.
    for (let i = 0; i < 8; i++) {
      try {
        unlinkSync(`${prefix}${i}`)
      } catch {
        /* file not present — stop */
      }
    }
  }
}

function getWindowsFingerprint(): string | null {
  try {
    const script = [
      `$sig = Get-AuthenticodeSignature -FilePath '${process.execPath}'`,
      `if ($sig.Status -eq 'Valid') { $sig.SignerCertificate.GetCertHashString('SHA256') }`,
    ].join('; ')
    const output = execSync(
      `powershell -NoProfile -Command "${script}"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim()
    if (!output || output.length !== 64) return null
    return output.toLowerCase()
  } catch {
    return null
  }
}

let _cachedFingerprint: string | null | undefined = undefined

/**
 * Returns the cached codesign fingerprint, computing it on first call.
 */
export function getCachedCodesignFingerprint(): string | null {
  if (_cachedFingerprint === undefined) {
    _cachedFingerprint = getCodesignFingerprint()
  }
  return _cachedFingerprint
}

/**
 * The runtime OS this build is signed for, in the backend's vocabulary
 * ('macos' | 'windows'), or null on Linux/other. Sent as `X-Codesign-Platform`
 * so an auto-registered fingerprint is tagged with the OS it came from — the
 * dashboard shows this per fingerprint instead of a generic label.
 */
export function getCodesignOS(): 'macos' | 'windows' | null {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return null
}
