import { test, expect } from '@playwright/test'

const ADMIN_USER = { email: 'dev@test.com', password: 'DevTest@123' }

test.describe('AdminView Tab Infrastructure (XIO-122)', () => {
  test('shows tab UI with Stats and OAuth Apps tabs after login', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })

    const tabs = page.locator('.admin-tabs .tab-btn')
    await expect(tabs).toHaveCount(2)
  })

  test('Stats tab is active by default', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })

    const statsTab = page.locator('.tab-btn').filter({ hasText: '运营统计' })
    await expect(statsTab).toHaveClass(/active/)

    const oauthTab = page.locator('.tab-btn').filter({ hasText: 'OAuth 应用' })
    await expect(oauthTab).not.toHaveClass(/active/)
  })

  test('stats cards render inside Stats tab', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })

    const cards = page.locator('.stat-card')
    await expect(cards).toHaveCount(3)
  })

  test('OAuth Apps tab is hidden when user lacks oauth.manage permission', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })

    const oauthTab = page.locator('.tab-btn').filter({ hasText: 'OAuth 应用' })
    await expect(oauthTab).toHaveCount(0)
  })

  test('admin bar and logout remain outside tabs', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })

    await expect(page.locator('.admin-bar')).toBeVisible()
    await expect(page.locator('.logout-btn')).toBeVisible()
  })
})
