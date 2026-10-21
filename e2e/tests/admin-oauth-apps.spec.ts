import { test, expect } from '@playwright/test'

const ADMIN_USER = { email: 'dev@test.com', password: 'DevTest@123' }
const TEST_APP = {
  name: `Test OAuth App ${Date.now()}`,
  redirectUris: 'https://example.com/callback,https://example.com/callback2',
  scopes: 'read,write',
  ipWhitelist: '1.2.3.4,5.6.7.8',
}

test.describe('OAuth Apps CRUD (XIO-121)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_USER.email)
    await page.fill('input[type="password"]', ADMIN_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes('/login'))
    await page.goto('/admin')
    await page.waitForSelector('.admin-tabs', { timeout: 10000 })
    const oauthTab = page.locator('.tab-btn').filter({ hasText: 'OAuth 应用' })
    if (await oauthTab.count() === 0) {
      test.skip()
    }
    await oauthTab.click()
    await page.waitForSelector('.oauth-bar', { timeout: 10000 })
  })

  test('loads OAuth apps table', async ({ page }) => {
    await expect(page.locator('.admin-table')).toBeVisible()
    await expect(page.locator('.admin-table th').filter({ hasText: '名称' })).toBeVisible()
    await expect(page.locator('.admin-table th').filter({ hasText: 'Client ID' })).toBeVisible()
    await expect(page.locator('.admin-table th').filter({ hasText: '状态' })).toBeVisible()
    await expect(page.locator('.admin-table th').filter({ hasText: '操作' })).toBeVisible()
  })

  test('opens create dialog and creates an app', async ({ page }) => {
    await page.click('.oauth-bar .key-btn')
    await expect(page.locator('.dialog')).toBeVisible()
    await expect(page.locator('.dialog h3')).toHaveText('新建 OAuth 应用')

    await page.fill('.dialog input[placeholder="应用名称"]', TEST_APP.name)
    await page.fill('.dialog input[placeholder="多个用逗号分隔"]').first().fill(TEST_APP.redirectUris)
    await page.locator('.dialog .form-field input').nth(1).fill(TEST_APP.scopes)
    await page.locator('.dialog .form-field input').nth(2).fill(TEST_APP.ipWhitelist)

    await page.click('.dialog .key-btn')

    await expect(page.locator('.dialog h3')).toHaveText('Client Secret')
    const secretBox = page.locator('.secret-box')
    await expect(secretBox).not.toBeEmpty()
    const secret = await secretBox.textContent()
    expect(secret).toMatch(/^cs_/)

    await page.click('.dialog .logout-btn')
    await expect(page.locator('.dialog')).not.toBeVisible()

    await expect(page.locator('.admin-table')).toBeVisible()
    const row = page.locator('.admin-table tbody tr').filter({ hasText: TEST_APP.name })
    await expect(row).toBeVisible()
  })

  test('edits an existing app', async ({ page }) => {
    const row = page.locator('.admin-table tbody tr').filter({ hasText: TEST_APP.name })
    if (await row.count() === 0) {
      test.skip()
    }

    await row.locator('button').filter({ hasText: '编辑' }).click()
    await expect(page.locator('.dialog h3')).toHaveText('编辑 OAuth 应用')

    const nameInput = page.locator('.dialog input[placeholder="应用名称"]')
    await nameInput.clear()
    await nameInput.fill(TEST_APP.name + ' (edited)')

    await page.click('.dialog .key-btn')
    await expect(page.locator('.oauth-msg')).toHaveText('更新成功')

    await expect(page.locator('.admin-table tbody tr').filter({ hasText: TEST_APP.name + ' (edited)' })).toBeVisible()
  })

  test('toggles app active state', async ({ page }) => {
    const row = page.locator('.admin-table tbody tr').filter({ hasText: TEST_APP.name })
    if (await row.count() === 0) {
      test.skip()
    }

    const statusBadge = row.locator('.status-badge')
    const initialActive = (await statusBadge.textContent()) === '启用'

    await row.locator('button').filter({ hasText: initialActive ? '禁用' : '启用' }).click()
    await expect(page.locator('.oauth-msg')).toHaveText(initialActive ? '已禁用' : '已启用')
    await expect(statusBadge).toHaveText(initialActive ? '禁用' : '启用')
  })

  test('rotates app secret', async ({ page }) => {
    const row = page.locator('.admin-table tbody tr').filter({ hasText: TEST_APP.name })
    if (await row.count() === 0) {
      test.skip()
    }

    page.on('dialog', dialog => dialog.accept())
    await row.locator('button').filter({ hasText: '重置密钥' }).click()

    await expect(page.locator('.dialog h3')).toHaveText('Client Secret')
    const secretBox = page.locator('.secret-box')
    await expect(secretBox).not.toBeEmpty()
    const newSecret = await secretBox.textContent()
    expect(newSecret).toMatch(/^cs_/)

    await page.click('.dialog .logout-btn')
  })

  test('deletes an app', async ({ page }) => {
    const row = page.locator('.admin-table tbody tr').filter({ hasText: TEST_APP.name })
    if (await row.count() === 0) {
      test.skip()
    }

    page.on('dialog', dialog => dialog.accept())
    await row.locator('button').filter({ hasText: '删除' }).click()

    await expect(page.locator('.oauth-msg')).toHaveText('已删除')
    await expect(row).not.toBeVisible()
  })

  test('shows empty state when no apps exist', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept())
    const rows = page.locator('.admin-table tbody tr')
    const count = await rows.count()

    for (let i = 0; i < count; i++) {
      const row = rows.first()
      await row.locator('button').filter({ hasText: '删除' }).click()
      await page.waitForTimeout(300)
    }

    await expect(page.locator('.empty')).toHaveText('暂无 OAuth 应用')
  })
})
