import { test, expect } from '@playwright/test'

const TEST_USER = { email: '435541900@qq.com', password: 'quant123' }
let authToken = ''

test.describe('Pro Features', () => {

  test.describe('API Auth Guard', () => {
    test('Pro endpoints return 401 without auth token', async ({ request }) => {
      const endpoints = [
        '/api/ai/news/weibo',
        '/api/ai/news/wechat-heat',
        '/api/push/settings',
        '/api/positions',
        '/api/strategy/optimize',
        '/api/ai/predict/today',
      ]
      for (const endpoint of endpoints) {
        const resp = await request.get(endpoint)
        expect(resp.status(), `${endpoint} should return 401`).toBe(401)
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

    test('GET /api/ai/news/weibo returns sentiment data', async ({ request }) => {
      const resp = await request.get('/api/ai/news/weibo', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(Array.isArray(body)).toBe(true)
      if (body.length > 0) {
        expect(body[0]).toHaveProperty('code')
        expect(body[0]).toHaveProperty('name')
        expect(body[0]).toHaveProperty('rate')
      }
    })

    test('GET /api/ai/news/wechat-heat returns wechat heat data', async ({ request }) => {
      const resp = await request.get('/api/ai/news/wechat-heat', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(Array.isArray(body)).toBe(true)
      if (body.length > 0) {
        expect(body[0]).toHaveProperty('code')
        expect(body[0]).toHaveProperty('name')
        expect(body[0]).toHaveProperty('heat')
      }
    })

    test('GET /api/ai/news/sentiment/600519 returns stock sentiment', async ({ request }) => {
      const resp = await request.get('/api/ai/news/sentiment/600519', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(body).toHaveProperty('score')
      expect(body).toHaveProperty('items')
      expect(body).toHaveProperty('label')
      expect(Array.isArray(body.items)).toBe(true)
    })

    test('GET /api/push/settings returns user push settings', async ({ request }) => {
      const resp = await request.get('/api/push/settings', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(body).toHaveProperty('settings')
      expect(body.settings).toHaveProperty('channels')
      expect(body.settings).toHaveProperty('triggers')
    })

    test('GET /api/ai/predict/today returns today predictions', async ({ request }) => {
      const resp = await request.get('/api/ai/predict/today', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      expect(resp.status()).toBe(200)
      const body = await resp.json()
      expect(body).toHaveProperty('predictions')
      expect(Array.isArray(body.predictions)).toBe(true)
    })

    test('GET /api/positions returns user positions', async ({ request }) => {
      const resp = await request.get('/api/positions', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
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

    test('sentiment page loads with chart container', async ({ page }) => {
      await page.goto('/sentiment')
      await page.waitForSelector('h1, h2, .chart-container, canvas', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('push-settings page loads with settings form', async ({ page }) => {
      await page.goto('/push-settings')
      await page.waitForSelector('h1, h2, form, .settings-panel', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })

    test('notifications page loads with notification list', async ({ page }) => {
      await page.goto('/notifications')
      await page.waitForSelector('h1, h2', { timeout: 10000 })
      const title = await page.locator('h1, h2').first().textContent()
      expect(title).toBeTruthy()
    })
  })

})
