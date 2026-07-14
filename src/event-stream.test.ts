import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloEventStream } from './event-stream'

/**
 * A fake fetch Response whose body streams the given string chunks, then holds
 * the connection open (a never-resolving read) so the stream stays "connected"
 * and never schedules a reconnect that could race the assertion. `destroy()`
 * aborts it.
 */
function streamResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  let i = 0
  return {
    status: 200,
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) }
          return new Promise(() => {}) // keep the connection open — no `done`, no reconnect
        },
      }),
    },
  } as unknown as Response
}

describe('OneloEventStream (Electron SSE parser)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('parses a named frame and dispatches JSON data to handlers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([
      ': keepalive\n\n',
      'event: session.revoked\ndata: {"app_user_id":"u1"}\n\n',
    ]))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    const received: Record<string, unknown>[] = []
    stream.on('session.revoked', (d) => received.push(d))
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(received.length).toBe(1) })
      expect(received[0]).toEqual({ app_user_id: 'u1' })
    } finally { stream.destroy() }
  })

  it('ignores :keepalive comments (no dispatch)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([': keepalive\n\n', ': keepalive\n\n']))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    const received: unknown[] = []
    stream.on('features_updated', (d) => received.push(d))
    stream.start(null)
    await new Promise((r) => setTimeout(r, 20))
    expect(received.length).toBe(0)
    stream.destroy()
  })

  it('reassembles a frame split across two read() chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([
      'event: session.revoked\ndata: {"app_u',
      'ser_id":"u1"}\n\n',
    ]))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    const received: Record<string, unknown>[] = []
    stream.on('session.revoked', (d) => received.push(d))
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(received.length).toBe(1) })
      expect(received[0]).toEqual({ app_user_id: 'u1' })
    } finally { stream.destroy() }
  })

  it('parses a frame with CRLF line endings (proxy rewrite)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([
      'event: session.revoked\r\ndata: {"app_user_id":"u1"}\r\n\r\n',
    ]))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    const received: Record<string, unknown>[] = []
    stream.on('session.revoked', (d) => received.push(d))
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(received.length).toBe(1) })
      expect(received[0]).toEqual({ app_user_id: 'u1' })
    } finally { stream.destroy() }
  })

  it('reassembles a CRLF frame whose \\r and \\n split across chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([
      'event: session.revoked\r\ndata: {"app_user_id":"u1"}\r',
      '\n\r\n',
    ]))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    const received: Record<string, unknown>[] = []
    stream.on('session.revoked', (d) => received.push(d))
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(received.length).toBe(1) })
      expect(received[0]).toEqual({ app_user_id: 'u1' })
    } finally { stream.destroy() }
  })

  it('does not connect after destroy()', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([]))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    stream.destroy()
    stream.start('u1')
    await new Promise((r) => setTimeout(r, 10))
    expect(f).not.toHaveBeenCalled()
  })

  it('stops (no reconnect) on a 429 connection-cap response', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 429, ok: false, body: null } as unknown as Response)
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test')
    stream.start('u1')
    await new Promise((r) => setTimeout(r, 30))
    expect(f).toHaveBeenCalledTimes(1) // stopped — did not loop
    stream.destroy()
  })

  it('sends X-Bundle-Id on the SSE connect when a bundleId is configured (backend security gate)', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([]))
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test', '1.0.0', 'com.example.app')
    stream.start('u1')
    await vi.waitFor(() => { expect(f).toHaveBeenCalled() })
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Bundle-Id']).toBe('com.example.app')
    expect(headers['Accept']).toBe('text/event-stream')
    stream.destroy()
  })
})
