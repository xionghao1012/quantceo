/**
 * Test helpers — reusable utilities for route/integration tests.
 * Replaces per-file mock spaghetti with shared, typed helpers.
 */
import { vi } from 'vitest'
import request from 'supertest'
import type { TestSeed } from '../../db/test-seed.js'

// ── Mock factories ───────────────────────────────────────────────

/** Mock a Drizzle-like query chain for routes that use raw SQL via `db.execute(sql`...)` */
export function createMockDbExecute(overrides: Record<string, unknown[]> = {}): any {
  const fn = vi.fn().mockImplementation((_sql: unknown) => ({
    rows: overrides[_sql as string] ?? [],
  }))
  return {
    execute: fn,
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => Promise.resolve([])),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    as: vi.fn().mockReturnThis(),
    sql: fn,
  }
}

/** Mock `redis.get` / `redis.set` / `redis.del` */
export function createMockRedis(data: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(data))
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, val: string) => { store.set(key, val) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    keys: vi.fn(async (pattern: string) =>
      [...store.keys()].filter(k => pattern.replace('*', '') === k.slice(0, pattern.length - 1))
    ),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  }
}

/** Mock `fetch` global for external API calls */
export function createMockFetch(response: unknown, ok = true): any {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  })
}

/** Stub all methods of a service so it never calls real infrastructure */
export function stubService<T extends Record<string, unknown>>(methods: (keyof T)[]): T {
  const stub: Record<string, unknown> = {}
  for (const m of methods) {
    stub[m as string] = vi.fn()
  }
  return stub as T
}

// ── Request helpers ──────────────────────────────────────────────

/**
 * Create a supertest agent with an authenticated token.
 * Usage: const agent = createAuthAgent(app, token)
 */
export function createAuthAgent(app: ReturnType<typeof request>, token: string) {
  return request.agent(app as any).set('Authorization', `Bearer ${token}`)
}

/**
 * Attach a test seed's auth token to a supertest agent.
 */
export function withAuth(app: ReturnType<typeof request>, seed: TestSeed, type: 'test' | 'pro' | 'admin' = 'test') {
  const token = seed[`${type}User`].token
  return request.agent(app as any).set('Authorization', `Bearer ${token}`)
}

// ── KLine fixture helpers ─────────────────────────────────────────

export function makeKlines(n = 30, basePrice = 100, trend = 0) {
  const result: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = []
  const now = new Date()
  let price = basePrice
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
    price += (Math.sin(i / 3) * 2 + trend * 0.3)
    const open = Math.round((price - 0.5) * 100) / 100
    const close = Math.round((price + 0.3) * 100) / 100
    result.push({
      date: d.toISOString().split('T')[0],
      open,
      high: Math.round((price + 1) * 100) / 100,
      low: Math.round((price - 1) * 100) / 100,
      close,
      volume: Math.floor(1_000_000 + Math.random() * 2_000_000),
    })
  }
  return result
}

// ── Mock vi.mock shortcuts for common modules ─────────────────────

export function mockDb(): any {
  return createMockDbExecute()
}

export function mockRedis(data?: Record<string, string>) {
  return createMockRedis(data)
}

export function mockFetch(response?: unknown, ok?: boolean): any {
  return createMockFetch(response, ok)
}
