import { execSync } from 'child_process'

/**
 * Computes the SHA-256 fingerprint of the app's codesign certificate.
 *
 * macOS: uses `codesign -dv --verbose=4` and parses the SHA-256 line.
 * Windows: uses PowerShell `Get-AuthenticodeSignature` to extract the cert thumbprint.
 * Linux: returns null (codesign not applicable).
 *
 * Returns the fingerprint as a lowercase hex string, or null on any error.
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
  try {
    const output = execSync(
      `codesign -dv --verbose=4 "${process.execPath}" 2>&1`,
      { encoding: 'utf8', timeout: 5000 }
    )
    const match = output.match(/SHA-256=([0-9A-Fa-f]+)/)
    if (!match) return null
    return match[1].toLowerCase()
  } catch {
    return null
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
