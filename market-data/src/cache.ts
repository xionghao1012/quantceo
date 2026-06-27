import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 3) return null
    return Math.min(times * 100, 1000)
  },
})

redis.on('error', (err: any) => {
  if (err.code !== 'ECONNREFUSED') console.error('[Redis]', err.message)
})

const KLINE_TTL = 60 * 60 * 2   // 2 hours
const KLINE_PREFIX = 'kline:'
const MKLINE_TTL = 60 * 60       // 1 hour
const MKLINE_PREFIX = 'mkline:'
const QUOTES_KEY = 'quotes:latest'
const QUOTES_TTL = 30            // 30 seconds

export async function cacheGetKlines(code: string): Promise<string | null> {
  try { return await redis.get(`${KLINE_PREFIX}${code}`) } catch { return null }
}

export async function cacheSetKlines(code: string, data: string): Promise<void> {
  try { await redis.setex(`${KLINE_PREFIX}${code}`, KLINE_TTL, data) } catch {}
}

export async function cacheGetKlinesBulk(codes: string[]): Promise<Record<string, string | null>> {
  if (!codes.length) return {}
  try {
    const keys = codes.map(c => `${KLINE_PREFIX}${c}`)
    const values = await redis.mget(...keys)
    const result: Record<string, string | null> = {}
    codes.forEach((code, i) => { result[code] = values[i] })
    return result
  } catch { return {} }
}

export async function cacheSetKlinesBulk(map: Record<string, string>): Promise<void> {
  if (!Object.keys(map).length) return
  try {
    const pipeline = redis.pipeline()
    for (const [code, data] of Object.entries(map)) {
      pipeline.setex(`${KLINE_PREFIX}${code}`, KLINE_TTL, data)
    }
    await pipeline.exec()
  } catch {}
}

export async function cacheGetQuotes(): Promise<string | null> {
  try { return await redis.get(QUOTES_KEY) } catch { return null }
}

export async function cacheSetQuotes(data: string): Promise<void> {
  try { await redis.setex(QUOTES_KEY, QUOTES_TTL, data) } catch {}
}

export async function cacheGetMinuteKlines(code: string, period: string): Promise<string | null> {
  const key = `${MKLINE_PREFIX}${period}:${code}`
  try { return await redis.get(key) } catch { return null }
}

export async function cacheSetMinuteKlines(code: string, period: string, data: string): Promise<void> {
  const key = `${MKLINE_PREFIX}${period}:${code}`
  try { await redis.setex(key, MKLINE_TTL, data) } catch {}
}
