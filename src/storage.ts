/**
 * Secure token storage for Electron using safeStorage API.
 * Tokens are encrypted with OS-native encryption (Keychain/DPAPI/SecretService)
 * and persisted to disk so sessions survive app restarts.
 * Must be used from the Main process only.
 */
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

export class SecureTokenStorage {
  private storePath: string
  private cache: Map<string, string> = new Map()

  constructor(storePath?: string) {
    if (storePath) {
      this.storePath = storePath
    } else {
      // Lazy resolve — app may not be ready at construction time
      this.storePath = ''
    }
  }

  private getStorePath(): string {
    if (this.storePath) return this.storePath
    // Dynamic resolve when first used (app is ready by then)
    const { app } = require('electron')
    const dir = join(app.getPath('userData'), 'onelo')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.storePath = join(dir, 'tokens.enc')
    return this.storePath
  }

  private loadFromDisk(): void {
    const path = this.getStorePath()
    if (!existsSync(path)) return
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, number[]>
      const { safeStorage } = require('electron')
      for (const [key, bufArr] of Object.entries(raw)) {
        try {
          const buf = Buffer.from(bufArr)
          const value = safeStorage.decryptString(buf)
          this.cache.set(key, value)
        } catch {
          // Skip corrupted entry
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  private saveToDisk(): void {
    const path = this.getStorePath()
    const { safeStorage } = require('electron')
    const out: Record<string, number[]> = {}
    for (const [key, value] of this.cache.entries()) {
      const encrypted = safeStorage.encryptString(value)
      out[key] = Array.from(encrypted)
    }
    writeFileSync(path, JSON.stringify(out), 'utf-8')
  }

  async set(key: string, value: string): Promise<void> {
    const { safeStorage } = await import('electron')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this system')
    }
    if (this.cache.size === 0) this.loadFromDisk()
    this.cache.set(key, value)
    this.saveToDisk()
  }

  async get(key: string): Promise<string | null> {
    if (this.cache.size === 0) this.loadFromDisk()
    return this.cache.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
    this.saveToDisk()
  }

  async clear(): Promise<void> {
    this.cache.clear()
    const path = this.getStorePath()
    if (existsSync(path)) writeFileSync(path, '{}', 'utf-8')
  }
}

