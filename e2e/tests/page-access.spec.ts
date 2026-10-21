import { test, expect } from '@playwright/test'

const TEST_USER = { email: '435541900@qq.com', password: 'quant123' }

test.describe('Page Access & Permissions', () => {
  test('login page loads with form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('h2')).toHaveText('登录')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toHaveText('登录')
  })

  test('successful login redirects away from login page', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', TEST_USER.email)
    await page.fill('input[type="password"]', TEST_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    expect(page.url()).not.toContain('/login')
  })

  test('upgrade page is publicly accessible', async ({ page }) => {
    await page.goto('/upgrade')
    await page.waitForSelector('h1')
    const title = await page.locator('h1').textContent()
    expect(title).toContain('全部能力')
  })

  test('register page loads with form', async ({ page }) => {
    await page.goto('/register')
    await expect(page.locator('button[type="submit"]')).toHaveText('注册')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })
})
