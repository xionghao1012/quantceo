import { test, expect } from '@playwright/test'

const ADMIN_USER = { email: 'dev@test.com', password: 'DevTest@123' }

test.describe('Admin Stats Page', () => {
  test('shows three stat cards on admin overview', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.stats-cards', { timeout: 10000 })

    const cards = page.locator('.stat-card')
    await expect(cards).toHaveCount(3)

    const labels = await page.locator('.stat-card .stat-label').allTextContents()
    expect(labels).toContain('总用户数')
    expect(labels).toContain('Pro 活跃用户')
    expect(labels).toContain('待审核订单')
  })

  test('stat numbers are formatted with thousand separators', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await page.goto('/admin')
    await page.waitForSelector('.stats-cards', { timeout: 10000 })

    const values = await page.locator('.stat-card .stat-value').allTextContents()
    for (const v of values) {
      expect(v).toMatch(/^[\d,]+$/)
    }
  })

  test('admin key auth also shows stats cards', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForSelector('.key-input', { timeout: 10000 })

    const adminKey = process.env.ADMIN_KEY || 'dev_admin_key'
    await page.fill('.key-input', adminKey)
    await page.click('.key-btn')
    await page.waitForSelector('.stats-cards', { timeout: 10000 })

    const cards = page.locator('.stat-card')
    await expect(cards).toHaveCount(3)
  })
})
