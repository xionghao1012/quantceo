import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

let token = ''
let testCode = '600519'
let watchlistId = 0

test.describe('Full Business Flow', () => {
  test('1. Health: API is alive with dependencies', async ({ request }) => {
    const resp = await request.get('/api/health')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('quant-trading')
    expect(body.dependencies.postgres).toBe(true)
  })

  test('2. Register: create new user', async ({ request }) => {
    const email = `flow_${Date.now()}@test.com`
    const resp = await request.post('/api/auth/register', {
      data: { email, password: 'FlowPass@123', name: 'FlowTester' },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.token).toBeTruthy()
    expect(body.user.email).toBe(email)
    expect(body.user.passwordHash).toBeUndefined()
    token = body.token
  })

  test('3. Me: get authenticated user profile', async ({ request }) => {
    expect(token).toBeTruthy()
    const resp = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.user.email).toBeTruthy()
    expect(body.user.role).toBeDefined()
  })

  test('4. Stocks: list available stocks', async ({ request }) => {
    const resp = await request.get('/api/stocks?limit=5')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
    if (body.length > 0) {
      testCode = body[0].code
      expect(body[0]).toHaveProperty('code')
      expect(body[0]).toHaveProperty('name')
    }
  })

  test('5. Stock Detail: get single stock info', async ({ request }) => {
    expect(testCode).toBeTruthy()
    const resp = await request.get(`/api/stocks/${testCode}`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.code).toBe(testCode)
    expect(body).toHaveProperty('name')
    expect(body).toHaveProperty('exchange')
  })

  test('6. Klines: fetch market data', async ({ request }) => {
    const resp = await request.get(`/api/stocks/${testCode}/klines`)
    expect([200, 404]).toContain(resp.status())
    if (resp.status() === 200) {
      const body = await resp.json()
      expect(body).toHaveProperty('klines')
      expect(body.klines.length).toBeGreaterThan(0)
      expect(body.klines[0]).toHaveProperty('close')
    }
  })

  test('7. Indicators: get technical analysis', async ({ request }) => {
    const resp = await request.get(`/api/stocks/${testCode}/indicators`)
    expect([200, 404]).toContain(resp.status())
    if (resp.status() === 200) {
      const body = await resp.json()
      expect(body).toHaveProperty('ma')
      expect(body).toHaveProperty('macd')
      expect(body).toHaveProperty('rsi')
    }
  })

  test('8. Rankings: get stock rankings', async ({ request }) => {
    const resp = await request.get('/api/rankings?metric=rsi&limit=5')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body).toHaveProperty('rankings')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('hasData')
    expect(body).toHaveProperty('date')
    expect(body.metric).toBe('rsi')
  })

  test('9. Strategy Rankings: get strategy-based rankings', async ({ request }) => {
    const resp = await request.get('/api/rankings/strategies?strategy=oversold_reversal&limit=5')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body).toHaveProperty('rankings')
    expect(body.strategy).toBe('oversold_reversal')
  })

  test('10. Screener: screen stocks by condition', async ({ request }) => {
    const resp = await request.post('/api/screener', {
      data: {
        conditions: [{ field: 'price', operator: '>', value: 0 }],
        sort: { field: 'change', order: 'desc' },
        limit: 5,
      },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body).toHaveProperty('stocks')
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.stocks)).toBe(true)
  })

  test('11. Signals: get scan signals', async ({ request }) => {
    const resp = await request.get('/api/signals?limit=5')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('12. Signals Stats: get signal statistics', async ({ request }) => {
    const resp = await request.get('/api/signals/stats?days=30')
    expect(resp.ok()).toBeTruthy()
    expect(Array.isArray(await resp.json())).toBe(true)
  })

  test('13. Watchlist: add stock to watchlist', async ({ request }) => {
    expect(token).toBeTruthy()
    const resp = await request.post('/api/watchlist', {
      headers: { Authorization: `Bearer ${token}` },
      data: { code: testCode },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.code).toBe(testCode)
    watchlistId = body.id
  })

  test('14. Watchlist: list user watchlist', async ({ request }) => {
    const resp = await request.get('/api/watchlist', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  test('15. Watchlist: remove stock from watchlist', async ({ request }) => {
    expect(watchlistId).toBeGreaterThan(0)
    const resp = await request.delete(`/api/watchlist/${watchlistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.ok()).toBeTruthy()
  })

  test('16. Backtest: history list', async ({ request }) => {
    const resp = await request.get('/api/backtest/history?limit=5')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('17. Backtest: leaderboard', async ({ request }) => {
    const resp = await request.get('/api/backtest/leaderboard?limit=5')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('18. Backtest: strategy results', async ({ request }) => {
    const resp = await request.get('/api/backtest/strategies/results')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body).toHaveProperty('strategies')
    expect(body).toHaveProperty('recommendation')
  })

  test('19. Available Dates: rankings dates', async ({ request }) => {
    const resp = await request.get('/api/rankings/available-dates')
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body).toHaveProperty('dates')
    expect(Array.isArray(body.dates)).toBe(true)
  })

  test('20. Logout: end session', async ({ request }) => {
    expect(token).toBeTruthy()
    const resp = await request.post('/api/auth/logout', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.success).toBe(true)
  })
})
