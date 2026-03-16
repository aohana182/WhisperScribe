import { describe, it, expect, vi } from 'vitest'

async function pollHealth(fetchFn, { intervalMs = 100, timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetchFn()
      if (res.ok) {
        const data = await res.json()
        if (data.ready === true) return true
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

describe('pollHealth', () => {
  it('returns true immediately when ready on first try', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) })
    expect(await pollHealth(fakeFetch, { intervalMs: 0, timeoutMs: 500 })).toBe(true)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('retries until ready', async () => {
    let n = 0
    const fakeFetch = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ ready: ++n >= 3 }) }))
    expect(await pollHealth(fakeFetch, { intervalMs: 0, timeoutMs: 1000 })).toBe(true)
    expect(fakeFetch).toHaveBeenCalledTimes(3)
  })

  it('returns false on timeout', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: false }) })
    expect(await pollHealth(fakeFetch, { intervalMs: 0, timeoutMs: 50 })).toBe(false)
  })

  it('keeps retrying when fetch throws', async () => {
    let n = 0
    const fakeFetch = vi.fn().mockImplementation(async () => {
      if (++n < 3) throw new Error('ECONNREFUSED')
      return { ok: true, json: async () => ({ ready: true }) }
    })
    expect(await pollHealth(fakeFetch, { intervalMs: 0, timeoutMs: 1000 })).toBe(true)
  })

  it('handles non-ok response', async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true }) })
    expect(await pollHealth(fakeFetch, { intervalMs: 0, timeoutMs: 500 })).toBe(true)
  })
})
