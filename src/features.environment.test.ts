/**
 * Tests for the explicit feature environment selector (feature-environment-explicit.md).
 * OneloFeatures forwards `environment` on /resolve, /batch-ping (POST body) and the
 * /poll URL query when `featureEnvironment` is set, and omits it otherwise so the
 * backend falls back to the key prefix.
 *
 * The electron client uses native https.request, so we capture every outgoing
 * request: its path (for query params) and its written body (for POST fields).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

interface CapturedRequest {
  path: string
  body: string
}

const captured: CapturedRequest[] = []

vi.mock('https', () => {
  const request = (
    opts: { path: string },
    cb: (res: EventEmitter & { statusCode: number }) => void,
  ) => {
    const rec: CapturedRequest = { path: opts.path, body: '' }
    captured.push(rec)
    const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as EventEmitter & { statusCode: number }
    // Deliver an empty-features response asynchronously so the helper resolves.
    queueMicrotask(() => {
      cb(res)
      res.emit('data', Buffer.from(JSON.stringify({ features: {}, config_version: 1 })))
      res.emit('end')
    })
    return {
      on: () => {},
      write: (chunk: string) => { rec.body += chunk },
      end: () => {},
    }
  }
  return { default: { request }, request }
})

vi.mock('http', () => {
  const request = () => ({ on: () => {}, write: () => {}, end: () => {} })
  return { default: { request }, request }
})

import { OneloFeatures } from './features'

function bodyForPath(path: string): Record<string, unknown> | undefined {
  const call = captured.find((c) => c.path.includes(path) && c.body.length > 0)
  if (!call) return undefined
  return JSON.parse(call.body) as Record<string, unknown>
}

describe('OneloFeatures featureEnvironment', () => {
  beforeEach(() => {
    captured.length = 0
  })

  it('forwards environment on /resolve when set', async () => {
    const f = new OneloFeatures('pk_live', 'https://api', null, undefined, { featureEnvironment: 'test' })
    await f._load('u1')
    f.stopPolling()
    expect(bodyForPath('/api/sdk/features/resolve')?.['environment']).toBe('test')
  })

  it('omits environment on /resolve when unset', async () => {
    const f = new OneloFeatures('pk_live', 'https://api', null, undefined)
    await f._load('u1')
    f.stopPolling()
    expect(bodyForPath('/api/sdk/features/resolve')).toBeDefined()
    expect(bodyForPath('/api/sdk/features/resolve')?.['environment']).toBeUndefined()
  })

  it('forwards environment on batch-ping when set', async () => {
    const f = new OneloFeatures('pk_live', 'https://api', null, undefined, { featureEnvironment: 'test' })
    f.declare(['foo'])
    // _load issues an immediate batch-ping with the declared feature.
    await f._load('u1')
    f.stopPolling()
    expect(bodyForPath('/api/sdk/features/batch-ping')?.['environment']).toBe('test')
  })

  it('forwards environment on /poll query when set', async () => {
    const f = new OneloFeatures('pk_live', 'https://api', null, undefined, { featureEnvironment: 'test' })
    // _poll is private; invoke directly to assert the query param.
    await (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll('u1')
    const pollCall = captured.find((c) => c.path.includes('/api/sdk/features/poll'))
    expect(pollCall?.path).toContain('environment=test')
  })

  it('omits environment on /poll query when unset', async () => {
    const f = new OneloFeatures('pk_live', 'https://api', null, undefined)
    await (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll('u1')
    const pollCall = captured.find((c) => c.path.includes('/api/sdk/features/poll'))
    expect(pollCall?.path).not.toContain('environment=')
  })
})
