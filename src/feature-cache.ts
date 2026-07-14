/**
 * On-disk persistence of the resolved feature snapshot so flags survive a cold
 * start before the network resolves (parity with Swift UserDefaults / JS
 * localStorage). Plain JSON — flags aren't secret (Swift deliberately uses
 * UserDefaults, not the Keychain). Keyed by (publishableKey, userId) so multiple
 * users / anon coexist. Best-effort: any I/O failure is swallowed.
 */

export interface PersistedSnapshot {
  configVersion: number
  /** FeatureRecord map (kept as `unknown` values to avoid a features.ts cycle). */
  features: Record<string, unknown>
}

function cacheFile(): string | null {
  try {
    // Lazy require — a bundled renderer / vitest run has no Electron runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path')
    return path.join(app.getPath('userData'), 'onelo', 'features.json')
  } catch {
    return null
  }
}

function keyFor(publishableKey: string, userId: string | null): string {
  return `${publishableKey}_${userId ?? 'anon'}`
}

export function readFeatureCache(publishableKey: string, userId: string | null): PersistedSnapshot | null {
  const file = cacheFile()
  if (!file) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs')
    const all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, PersistedSnapshot>
    return all[keyFor(publishableKey, userId)] ?? null
  } catch {
    return null
  }
}

export function writeFeatureCache(
  publishableKey: string,
  userId: string | null,
  snapshot: PersistedSnapshot,
): void {
  const file = cacheFile()
  if (!file) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path')
    let all: Record<string, PersistedSnapshot> = {}
    try { all = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* fresh file */ }
    all[keyFor(publishableKey, userId)] = snapshot
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(all))
  } catch {
    /* read-only fs / not ready — flags will just re-resolve from network next start */
  }
}
