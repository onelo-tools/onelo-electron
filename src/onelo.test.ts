import { describe, it, expect } from 'vitest'
import { OneloFeatures } from './features'

describe('session change callback mechanism', () => {
  it('calls the callback with userId when session is saved', () => {
    const received: (string | null)[] = []
    const cb = (userId: string | null) => received.push(userId)

    let _onSessionChange: ((userId: string | null) => void) | undefined
    const onSessionChange = (fn: (userId: string | null) => void) => { _onSessionChange = fn }
    const saveSessionHook = (userId: string) => { _onSessionChange?.(userId) }
    const signOutHook = () => { _onSessionChange?.(null) }

    onSessionChange(cb)
    saveSessionHook('user-abc')
    signOutHook()
    saveSessionHook('user-xyz')

    expect(received).toEqual(['user-abc', null, 'user-xyz'])
  })
})

describe('OneloFeatures.getActiveFeatures()', () => {
  it('returns names of enabled features', () => {
    const f = new OneloFeatures('pk_test', 'https://api.onelo.tools')
    // cache holds FeatureRecord ({ status, upgradeCta, … }) since 0.24.0.
    type Rec = { status: string; upgradeCta: boolean }
    const cache = (f as unknown as { cache: Map<string, Rec> }).cache
    cache.set('checkout', { status: 'enabled', upgradeCta: false })
    cache.set('ai-chat', { status: 'beta', upgradeCta: false })
    cache.set('dark-mode', { status: 'disabled', upgradeCta: false })
    expect(f.getActiveFeatures()).toEqual(['checkout', 'ai-chat'])
  })

  it('returns empty array when cache is empty', () => {
    const f = new OneloFeatures('pk_test', 'https://api.onelo.tools')
    expect(f.getActiveFeatures()).toEqual([])
  })

  it('excludes hidden and greyed features', () => {
    const f = new OneloFeatures('pk_test', 'https://api.onelo.tools')
    // cache holds FeatureRecord ({ status, upgradeCta, … }) since 0.24.0.
    type Rec = { status: string; upgradeCta: boolean }
    const cache = (f as unknown as { cache: Map<string, Rec> }).cache
    cache.set('hidden-flag', { status: 'hidden', upgradeCta: false })
    cache.set('greyed-flag', { status: 'greyed', upgradeCta: false })
    cache.set('active', { status: 'new', upgradeCta: false })
    expect(f.getActiveFeatures()).toEqual(['active'])
  })
})
