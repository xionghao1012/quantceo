import { test, expect } from '@playwright/test'

const TEST_USER = { email: '435541900@qq.com', password: 'quant123' }

test.describe('Authentication', () => {
  test('login with valid credentials returns token and user', async ({ request }) => {
    const resp = await request.post('/api/auth/login', {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.token).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.user).toBeTruthy()
    expect(body.user.email).toBe(TEST_USER.email)
  })

  test('login with invalid password returns 401', async ({ request }) => {
    const resp = await request.post('/api/auth/login', {
      data: { email: TEST_USER.email, password: 'wrong-password' },
    })
    expect(resp.status()).toBe(401)
  })

  test('login with empty fields returns 400', async ({ request }) => {
    const resp = await request.post('/api/auth/login', {
      data: { email: '', password: '' },
    })
    expect(resp.status()).toBe(400)
  })

  test('/me endpoint returns user when authenticated', async ({ request }) => {
    const loginResp = await request.post('/api/auth/login', {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    })
    const { token } = await loginResp.json()

    const meResp = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(meResp.ok()).toBeTruthy()
    const me = await meResp.json()
    expect(me.user.email).toBe(TEST_USER.email)
  })

  test('/me endpoint returns 401 without token', async ({ request }) => {
    const resp = await request.get('/api/auth/me')
    expect(resp.status()).toBe(401)
  })

  test('register a new user then login', async ({ request }) => {
    const email = `e2e-test-${Date.now()}@test.com`
    const password = 'Test123456!'

    const regResp = await request.post('/api/auth/register', {
      data: { email, password, name: 'E2E Test' },
    })
    expect(regResp.ok()).toBeTruthy()
    const regBody = await regResp.json()
    expect(regBody.user.email).toBe(email)

    const loginResp = await request.post('/api/auth/login', {
      data: { email, password },
    })
    expect(loginResp.ok()).toBeTruthy()
  })
})
