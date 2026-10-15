import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OneloWaitlist } from './waitlist'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response)
}

describe('OneloWaitlist', () => {
  const waitlist = new OneloWaitlist('https://api.onelo.tools', 'onelo_pk_test')

  beforeEach(() => mockFetch.mockReset())

  // Bodies mirror backend/app/routes/sdk_waitlist.py join_waitlist: `ok`, never `success`.
  it('returns success and position on a new join', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true, position: 5 }))
    const result = await waitlist.join('beta', 'ada@example.com')
    expect(result.success).toBe(true)
    expect(result.position).toBe(5)
  })

  it('sends publishableKey, email, slug in body', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true, position: 1 }))
    await waitlist.join('beta', 'ada@example.com')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.publishableKey).toBe('onelo_pk_test')
    expect(body.email).toBe('ada@example.com')
    expect(body.slug).toBe('beta')
  })

  it('returns alreadyJoined: true when server signals duplicate', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true, alreadyJoined: true, position: 2 }))
    const result = await waitlist.join('beta', 'ada@example.com')
    expect(result.success).toBe(true)
    expect(result.alreadyJoined).toBe(true)
    expect(result.position).toBe(2)
  })

  it('reports failure for a non-2xx response', async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { detail: 'Waitlist is closed' }))
    const result = await waitlist.join('beta', 'ada@example.com')
    expect(result.success).toBe(false)
    expect(result.alreadyJoined).toBe(false)
  })

  it('reports failure when a 2xx body does not carry ok: true', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: false }))
    const result = await waitlist.join('beta', 'ada@example.com')
    expect(result.success).toBe(false)
  })

  it('omits slug from body when slug is undefined', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true, position: 1 }))
    await waitlist.join(undefined, 'ada@example.com')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect('slug' in body).toBe(false)
  })
})

describe('OneloWaitlist — consent flags (#818)', () => {
  const waitlist = new OneloWaitlist('https://api.onelo.tools', 'onelo_pk_test')
  beforeEach(() => mockFetch.mockReset())

  it('sends the checkboxes the form showed, and nothing when none were given', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true, position: 1 }))
    await waitlist.join('beta', 'ada@example.com', { consent: { marketing: true } })
    await waitlist.join('beta', 'ada@example.com')
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).consent).toEqual({ marketing: true })
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).not.toHaveProperty('consent')
  })
})
