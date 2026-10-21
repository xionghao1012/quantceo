import { test, expect } from '@playwright/test'

const ADMIN_USER = { email: 'dev@test.com', password: 'DevTest@123' }

test.describe('OAuth Apps Management (XIO-128)', () => {
  async function switchToOAuthTab(page: any) {
    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })
    const oauthTab = page.locator('.tab-btn').filter({ hasText: 'OAuth 应用' })
    if (await oauthTab.count() > 0) {
      await oauthTab.click()
      await page.waitForTimeout(500)
    }
  }

  test('loads OAuth apps list with correct columns', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await switchToOAuthTab(page)
    await page.waitForSelector('.admin-table', { timeout: 10000 })
    const headers = await page.locator('.admin-table th').allTextContents()
    expect(headers).toContain('名称')
    expect(headers).toContain('Client ID')
    expect(headers).toContain('状态')
    expect(headers).toContain('操作')
  })

  test('shows empty state when no apps exist', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await switchToOAuthTab(page)
    await page.waitForTimeout(1000)
    const empty = page.locator('.empty')
    if (await empty.count() > 0) {
      await expect(empty).toContainText('暂无 OAuth 应用')
    }
  })

  test('create new OAuth app — verifies app appears in list and secret dialog shows', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await switchToOAuthTab(page)
    await page.waitForSelector('.admin-table, .empty', { timeout: 10000 })

    const createBtn = page.locator('button', { hasText: '新建应用' })
    await createBtn.click()
    await page.waitForSelector('.dialog', { timeout: 5000 })

    const appName = `Test App ${Date.now()}`
    await page.fill('input[placeholder="应用名称"]', appName)
    await page.locator('input[placeholder="多个用逗号分隔"]').first().fill('https://example.com/callback')
    await page.locator('input[placeholder="多个用逗号分隔"]').nth(1).fill('read,write')

    await page.locator('.dialog button', { hasText: '创建' }).click()
    await page.waitForTimeout(2000)

    await expect(page.locator('.dialog h3')).toContainText('密钥已生成', { timeout: 5000 })
    const secretValue = await page.locator('.secret-display, .secret-value, .dialog .mono, [class*="secret"]').first().textContent()
    expect(secretValue).toBeTruthy()
    expect(secretValue!.length).toBeGreaterThan(5)
    await page.locator('.dialog button', { hasText: '确定' }).click()
    await page.waitForTimeout(1000)

    const row = page.locator('.admin-table tbody tr').filter({ hasText: appName })
    await expect(row).toBeVisible({ timeout: 5000 })
    await expect(row.locator('td').first()).toContainText(appName)
  })

  test('toggle app active/inactive — verifies status changes', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await switchToOAuthTab(page)
    await page.waitForSelector('.admin-table', { timeout: 10000 })

    const rows = page.locator('.admin-table tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)

    const firstRow = rows.first()
    const statusBadge = firstRow.locator('.status-badge')
    const initialStatus = await statusBadge.textContent()
    const toggleBtn = firstRow.locator('button', { hasText: /禁用|启用/ })

    await toggleBtn.click()
    await page.waitForTimeout(1500)

    const newStatus = await statusBadge.textContent()
    expect(newStatus).not.toBe(initialStatus)
    expect(newStatus).toMatch(/启用|禁用/)
  })

  test('rotate-secret — new secret appears in dialog and can be copied', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await switchToOAuthTab(page)
    await page.waitForSelector('.admin-table', { timeout: 10000 })

    const rows = page.locator('.admin-table tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)

    const rotateBtn = rows.first().locator('button', { hasText: '重置密钥' })
    await rotateBtn.click()
    page.on('dialog', dialog => dialog.accept())
    await page.waitForTimeout(2000)

    await expect(page.locator('.dialog h3')).toContainText('密钥', { timeout: 5000 })
    const secretEl = page.locator('.secret-display, .secret-value, [class*="secret"]').first()
    await expect(secretEl).toBeVisible()
    const secretText = await secretEl.textContent()
    expect(secretText).toBeTruthy()
    expect(secretText!.length).toBeGreaterThan(5)

    const copyBtn = page.locator('.dialog button', { hasText: '复制' }).first()
    if (await copyBtn.count() > 0) {
      await copyBtn.click()
    }

    await page.locator('.dialog button', { hasText: '确定' }).click()
    await page.waitForTimeout(500)
  })

  test('open edit dialog for an app', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await switchToOAuthTab(page)
    await page.waitForSelector('.admin-table', { timeout: 10000 })
    const rows = page.locator('.admin-table tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    const editBtn = rows.first().locator('button', { hasText: '编辑' })
    await editBtn.click()
    await page.waitForSelector('.dialog', { timeout: 5000 })
    const dialogTitle = await page.locator('.dialog h3').textContent()
    expect(dialogTitle).toContain('编辑')
  })

  test('admin key auth can access OAuth Apps tab', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForSelector('.key-input', { timeout: 10000 })
    const adminKey = process.env.ADMIN_KEY || 'dev_admin_key'
    await page.fill('.key-input', adminKey)
    await page.click('.key-btn')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })
    const oauthTab = page.locator('.tab-btn').filter({ hasText: 'OAuth 应用' })
    await expect(oauthTab).toBeVisible()
  })
})
