type Key = string

class SimpleRateLimiter {
  private hits: Map<Key, { count: number; ts: number }>
  private max: number
  private windowMs: number
  constructor(max: number, windowMs: number) {
    this.hits = new Map()
    this.max = max
    this.windowMs = windowMs
  }
  check(key: Key) {
    const now = Date.now()
    const prev = this.hits.get(key)
    if (!prev || now - prev.ts > this.windowMs) {
      this.hits.set(key, { count: 1, ts: now })
      return true
    }
    if (prev.count < this.max) {
      prev.count += 1
      return true
    }
    return false
  }
}

export const rateLimiter = new SimpleRateLimiter(60, 60_000)

export function getClientKey(req: Request) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  return ip.split(',')[0].trim() || 'unknown'
}

