import { test, expect } from '@playwright/test'

test.describe('API Health', () => {
  test('GET /api/health returns ok with all dependencies', async ({ request }) => {
    const resp = await request.get('/api/health')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('quant-trading')
    expect(body.dependencies.postgres).toBe(true)
    expect(body.dependencies.redis).toBe(true)
  })

  test('GET / returns 200 and serves HTML', async ({ request }) => {
    const resp = await request.get('/')
    expect(resp.status()).toBe(200)
    const html = await resp.text()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('QuantCEO')
  })
})
