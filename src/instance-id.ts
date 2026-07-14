import { randomUUID } from 'node:crypto'

/**
 * Per-install instance id (X-Onelo-Instance-Id). Trust-on-first-use anchor for
 * feature-discovery authorization (the backend 403s test-env batch-ping without
 * it) and telemetry. Mirrors Swift's `OneloInstanceId` (a persisted UUID) — plain
 * (not a secret), survives restarts, lost on reinstall.
 *
 * Persisted to `<userData>/onelo/instance-id`. In a non-Electron / not-yet-ready
 * / test context it falls back to a process-ephemeral UUID (still valid) without
 * throwing.
 */
let cached: string | null = null

export function getInstanceId(): string {
  if (cached) return cached
  try {
    // Lazy require so a bundled renderer / vitest run without an Electron
    // runtime doesn't fail at import (same pattern as storage.ts).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path')
    const dir = path.join(app.getPath('userData'), 'onelo')
    const file = path.join(dir, 'instance-id')
    let id: string | null = null
    try { id = fs.readFileSync(file, 'utf8').trim() || null } catch { /* absent — create below */ }
    if (!id) {
      id = randomUUID()
      try {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(file, id)
      } catch { /* read-only fs — keep the ephemeral id for this process */ }
    }
    cached = id
    return cached
  } catch {
    // No Electron / app not ready / test — ephemeral (do NOT cache, so a later
    // call once the app is ready can still resolve+persist the durable id).
    return randomUUID()
  }
}
