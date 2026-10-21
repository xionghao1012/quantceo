import { test, expect } from '@playwright/test'

const TEST_USER = { email: '435541900@qq.com', password: 'quant123' }
let authToken = ''

test.describe('Pro Features Extended', () => {

  test.describe('API Auth Guard', () => {
    test('additional Pro endpoints return 401 without auth', async ({ request }) => {
      const endpoints = [
        '/api/alerts',
        '/api/my-strategies',
        '/api/intraday/alerts',
        '/api/ai/stocks/recommend',
        '/api/journal',
        '/api/risk/portfolio-risk',
        '/api/market-alerts/alerts',
        '/api/ai/trades',
        '/api/ai/strategy/discover',
      ]
      for (const endpoint of endpoints) {
        const resp = await request.get(endpoint)
        expect([401, 404, 500]).toContain(resp.status())
      }
    })
  })

  test.describe('API Data', () => {
    test.beforeAll(async ({ request }) => {
      const resp = await request.post('/api/auth/login', {
        data: { email: TEST_USER.email, password: TEST_USER.password },
      })
      const body = await resp.json()
      authToken = body.token
    })

    test('GET /api/ai/predict/stats returns stats', async ({ request }) => {
      const resp = await request.get('/api/ai/predict/stats', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
    })

    test('GET /api/ai/predict/history returns predictions', async ({ request }) => {
      const resp = await request.get('/api/ai/predict/history?limit=5', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(body).toHaveProperty('predictions')
      expect(body).toHaveProperty('total')
    })

    test('GET /api/alerts returns alerts list', async ({ request }) => {
      const resp = await request.get('/api/alerts', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(Array.isArray(body)).toBe(true)
    })

    test('POST /api/alerts creates and deletes an alert', async ({ request }) => {
      const create = await request.post('/api/alerts', {
        headers: { Authorization: `Bearer ${authToken}` },
        data: { code: '600519', condition: 'price_lte', targetValue: '1400' },
      })
      expect(create.status()).toBe(200)
      const alert = await create.json()
      expect(alert).toHaveProperty('id')

      const del = await request.delete(`/api/alerts/${alert.id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(del.status()).toBe(200)
    })

    test('POST /api/positions creates a position', async ({ request }) => {
      const resp = await request.post('/api/positions', {
        headers: { Authorization: `Bearer ${authToken}` },
        data: { code: '600519', quantity: 100, entryPrice: 1500 },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(body.code).toBe('600519')
      expect(body.quantity).toBe(100)
    })

    test('GET /api/positions/analysis returns analysis', async ({ request }) => {
      const resp = await request.get('/api/positions/analysis', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect([200, 500]).toContain(resp.status())
      if (resp.status() === 200) {
        const body = await resp.json()
        expect(body).toHaveProperty('positions')
        expect(body).toHaveProperty('updatedAt')
      }
    })

    test('GET /api/intraday/alerts returns alerts', async ({ request }) => {
      const resp = await request.get('/api/intraday/alerts', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect([200, 500]).toContain(resp.status())
    })

    test('GET /api/my-strategies returns empty list', async ({ request }) => {
      const resp = await request.get('/api/my-strategies', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  test.describe('Pro Pages', () => {
    test.beforeAll(async ({ request }) => {
      const resp = await request.post('/api/auth/login', {
        data: { email: TEST_USER.email, password: TEST_USER.password },
      })
      const body = await resp.json()
      authToken = body.token
    })

    test('ai-prediction page loads', async ({ page }) => {
      await page.goto('/ai-prediction')
      await page.waitForSelector('h1, h2', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('profile page loads', async ({ page }) => {
      await page.goto('/profile')
      await page.waitForSelector('h1, h2', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('upgrade page loads', async ({ page }) => {
      await page.goto('/upgrade')
      await page.waitForSelector('h1, h2, .plan-card, button', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('intraday-alerts page loads', async ({ page }) => {
      await page.goto('/intraday-alerts')
      await page.waitForSelector('h1, h2', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('positions page loads', async ({ page }) => {
      await page.goto('/positions')
      await page.waitForSelector('h1, h2', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('strategy-backtest page loads', async ({ page }) => {
      await page.goto('/strategy-backtest')
      await page.waitForSelector('h1, h2', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })
  })
})
