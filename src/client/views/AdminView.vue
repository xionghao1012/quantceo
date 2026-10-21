<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const adminKey = ref(localStorage.getItem('admin_key') || '')
const adminAuthed = ref(false)
const authMode = ref<'checking' | 'session' | 'key'>('checking')

const pendingOrders = ref<any[]>([])
const users = ref<any[]>([])
const stats = ref<{ totalUsers: number; proActive: number; pendingOrders: number } | null>(null)
const emailSearch = ref('')
const loading = ref(false)
const msg = ref('')
const activeTab = ref<'stats' | 'oauth'>('stats')

const oauthApps = ref<any[]>([])
const oauthLoading = ref(false)
const oauthMsg = ref('')

const showCreateDialog = ref(false)
const showEditDialog = ref(false)
const showSecretDialog = ref(false)
const editingApp = ref<any>(null)
const newAppSecret = ref('')

// 模板里不能直接用 navigator（Vue 模板不暴露全局对象），复制逻辑放脚本里
async function copySecret() {
  if (!newAppSecret.value) return
  try {
    await navigator.clipboard.writeText(newAppSecret.value)
    oauthMsg.value = '已复制'
  } catch {
    oauthMsg.value = '复制失败，请手动选择'
  }
}

const createForm = ref({ name: '', redirectUris: '', scopes: '', ipWhitelist: '' })
const editForm = ref({ name: '', redirectUris: '', scopes: '', ipWhitelist: '', active: true })

const perms = computed(() => auth.user?.permissions || [])

function hasPerm(code: string) {
  return perms.value.includes(code)
}

function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

function adminHeaders(): Record<string, string> {
  if (authMode.value === 'session') {
    return { ...auth.authHeaders(), 'Content-Type': 'application/json' }
  }
  return { 'x-admin-key': adminKey.value, 'Content-Type': 'application/json' }
}

async function trySessionAuth() {
  if (!auth.isLoggedIn) {
    try { await auth.fetchUser() } catch {}
  }
  if (auth.user?.isAdmin) {
    adminAuthed.value = true
    authMode.value = 'session'
    loadAll()
  } else {
    authMode.value = 'key'
  }
}

onMounted(() => { trySessionAuth() })

function doAuth() {
  if (!adminKey.value.trim()) return
  localStorage.setItem('admin_key', adminKey.value)
  adminAuthed.value = true
  authMode.value = 'key'
  loadAll()
}

function logout() {
  localStorage.removeItem('admin_key')
  adminKey.value = ''
  adminAuthed.value = false
  authMode.value = 'key'
  pendingOrders.value = []
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadPendingOrders(), searchUsers(), loadStats()])
  loading.value = false
}

async function loadPendingOrders() {
  try {
    const res = await fetch('/api/admin/pending-orders', {
      headers: adminHeaders(),
    })
    if (res.ok) {
      const data = await res.json()
      pendingOrders.value = data.orders || []
    }
  } catch {}
}

async function searchUsers() {
  try {
    const params = emailSearch.value ? `?email=${encodeURIComponent(emailSearch.value)}` : ''
    const res = await fetch(`/api/admin/users${params}`, {
      headers: adminHeaders(),
    })
    if (res.ok) {
      const data = await res.json()
      users.value = data.users || []
    }
  } catch {}
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: adminHeaders(),
    })
    if (res.ok) {
      const data = await res.json()
      stats.value = data
    }
  } catch {}
}

function switchTab(tab: 'stats' | 'oauth') {
  activeTab.value = tab
  if (tab === 'stats' && !stats.value) {
    loadStats()
  }
  if (tab === 'oauth' && !oauthApps.value.length) {
    loadOAuthApps()
  }
}

async function verifyOrder(subscriptionId: number, action: 'approve' | 'reject') {
  msg.value = ''
  try {
    const res = await fetch('/api/admin/verify-order', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ subscriptionId, action }),
    })
    const data = await res.json()
    if (res.ok) {
      msg.value = action === 'approve' ? '已验证通过' : '已拒绝'
      loadAll()
    } else {
      msg.value = data.error || '操作失败'
    }
  } catch (e: any) {
    msg.value = e.message
  }
}

async function setPlan(userId: number, plan: string) {
  if (!confirm(`确定将用户 ID ${userId} 的套餐改为 ${plan}？`)) return
  msg.value = ''
  try {
    const res = await fetch('/api/admin/set-plan', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ userId, plan }),
    })
    const data = await res.json()
    if (res.ok) {
      msg.value = `套餐已改为 ${plan}`
      searchUsers()
      loadPendingOrders()
    } else {
      msg.value = data.error || '操作失败'
    }
  } catch (e: any) {
    msg.value = e.message
  }
}

async function loadOAuthApps() {
  oauthLoading.value = true
  oauthMsg.value = ''
  try {
    const res = await fetch('/api/sso/admin', {
      headers: adminHeaders(),
    })
    if (res.ok) {
      const data = await res.json()
      oauthApps.value = data.applications || []
    } else {
      oauthMsg.value = '加载失败'
    }
  } catch {
    oauthMsg.value = '网络错误'
    oauthLoading.value = false
  }
  oauthLoading.value = false
}

async function createOAuthApp() {
  oauthMsg.value = ''
  try {
    const body: Record<string, string | string[] | boolean> = { name: createForm.value.name }
    if (createForm.value.redirectUris) body.redirectUris = createForm.value.redirectUris.split(',').map(s => s.trim())
    if (createForm.value.scopes) body.scopes = createForm.value.scopes.split(',').map(s => s.trim())
    if (createForm.value.ipWhitelist) body.ipWhitelist = createForm.value.ipWhitelist.split(',').map(s => s.trim())
    const res = await fetch('/api/sso/admin', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (res.ok) {
      showCreateDialog.value = false
      newAppSecret.value = data.clientSecret || data.client_secret || ''
      showSecretDialog.value = true
      createForm.value = { name: '', redirectUris: '', scopes: '', ipWhitelist: '' }
      loadOAuthApps()
    } else {
      oauthMsg.value = data.error || '创建失败'
    }
  } catch (e: any) {
    oauthMsg.value = e.message
  }
}

async function updateOAuthApp() {
  if (!editingApp.value) return
  oauthMsg.value = ''
  try {
    const body: any = {
      name: editForm.value.name,
      redirectUris: editForm.value.redirectUris,
      scopes: editForm.value.scopes,
      ipWhitelist: editForm.value.ipWhitelist,
      active: editForm.value.active,
    }
    const res = await fetch(`/api/sso/admin/${editingApp.value.id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (res.ok) {
      showEditDialog.value = false
      editingApp.value = null
      oauthMsg.value = '更新成功'
      loadOAuthApps()
    } else {
      oauthMsg.value = data.error || '更新失败'
    }
  } catch (e: any) {
    oauthMsg.value = e.message
  }
}

async function toggleOAuthApp(app: any) {
  oauthMsg.value = ''
  const optimisticActive = !app.active
  const idx = oauthApps.value.findIndex(a => a.id === app.id)
  try {
    const res = await fetch(`/api/sso/admin/${app.id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ active: optimisticActive }),
    })
    const data = await res.json()
    if (res.ok) {
      oauthMsg.value = optimisticActive ? '已启用' : '已禁用'
      if (idx !== -1) oauthApps.value[idx] = { ...oauthApps.value[idx], active: optimisticActive }
    } else {
      if (idx !== -1) oauthApps.value[idx] = { ...oauthApps.value[idx], active: !optimisticActive }
      oauthMsg.value = data.error || '操作失败'
      loadOAuthApps()
    }
  } catch (e: any) {
    if (idx !== -1) oauthApps.value[idx] = { ...oauthApps.value[idx], active: !optimisticActive }
    oauthMsg.value = e.message
  }
}

async function rotateOAuthSecret(app: any) {
  if (!confirm(`确定要重置 ${app.name} 的密钥吗？`)) return
  oauthMsg.value = ''
  try {
    const res = await fetch(`/api/sso/admin/${app.id}/rotate-secret`, {
      method: 'POST',
      headers: adminHeaders(),
    })
    const data = await res.json()
    if (res.ok) {
      newAppSecret.value = data.clientSecret || data.client_secret || ''
      showSecretDialog.value = true
      loadOAuthApps()
    } else {
      oauthMsg.value = data.error || '重置失败'
    }
  } catch (e: any) {
    oauthMsg.value = e.message
  }
}

async function deleteOAuthApp(app: any) {
  if (!confirm(`确定要删除应用「${app.name}」吗？此操作不可恢复。`)) return
  oauthMsg.value = ''
  try {
    const res = await fetch(`/api/sso/admin/${app.id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    })
    const data = await res.json()
    if (res.ok) {
      oauthMsg.value = '已删除'
      loadOAuthApps()
    } else {
      oauthMsg.value = data.error || '删除失败'
    }
  } catch (e: any) {
    oauthMsg.value = e.message
  }
}

function openEditDialog(app: any) {
  editingApp.value = app
  editForm.value = {
    name: app.name || '',
    redirectUris: app.redirectUris || app.redirect_uris || '',
    scopes: app.scopes || '',
    ipWhitelist: app.ipWhitelist || app.ip_whitelist || '',
    active: app.active ?? true,
  }
  showEditDialog.value = true
}

</script>

<template>
  <div class="admin-view">
    <h1>管理控制台</h1>

    <div v-if="authMode === 'checking'" class="admin-login">
      <p>检查权限中…</p>
    </div>

    <div v-else-if="!adminAuthed" class="admin-login">
      <p v-if="auth.user">您的账户没有管理权限，请输入 Admin Key 或联系管理员。</p>
      <p v-else>请先 <a href="/login">登录</a> 后再访问管理面板，或输入 Admin Key：</p>
      <div class="key-row">
        <input v-model="adminKey" type="password" placeholder="Admin Key" class="key-input" @keyup.enter="doAuth" />
        <button class="key-btn" @click="doAuth">确认</button>
      </div>
    </div>

    <template v-else>
      <div class="admin-bar">
        <button class="logout-btn" @click="logout">退出管理</button>
        <span v-if="msg" class="admin-msg">{{ msg }}</span>
      </div>

      <div class="admin-tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'stats' }"
          @click="switchTab('stats')"
        >运营统计</button>
        <button
          v-if="hasPerm('oauth.manage') || authMode === 'key'"
          class="tab-btn"
          :class="{ active: activeTab === 'oauth' }"
          @click="switchTab('oauth')"
        >OAuth 应用</button>
      </div>

      <div v-if="activeTab === 'stats'" class="tab-content">
        <div class="stats-cards" v-if="stats">
          <div class="stat-card">
            <div class="stat-value">{{ formatNumber(stats.totalUsers) }}</div>
            <div class="stat-label">总用户数</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ formatNumber(stats.proActive) }}</div>
            <div class="stat-label">Pro 活跃用户</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ formatNumber(stats.pendingOrders) }}</div>
            <div class="stat-label">待审核订单</div>
          </div>
        </div>

        <section class="admin-section" v-if="hasPerm('order.approve') || auth.user?.isAdmin">
          <h2>待验证订单 ({{ pendingOrders.length }})</h2>
          <div v-if="loading" class="loading">加载中…</div>
          <table v-else-if="pendingOrders.length" class="admin-table">
            <thead>
              <tr>
                <th>ID</th><th>用户ID</th><th>套餐</th><th>平台</th><th>订单号</th><th>备注</th><th>提交时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in pendingOrders" :key="o.id">
                <td>{{ o.id }}</td>
                <td>{{ o.userId }}</td>
                <td>{{ o.plan }}</td>
                <td>{{ o.externalPlatform || '-' }}</td>
                <td class="order-id-cell">{{ o.externalOrderId }}</td>
                <td>{{ o.externalNote || '-' }}</td>
                <td>{{ o.externalSubmittedAt ? new Date(o.externalSubmittedAt).toLocaleString() : '-' }}</td>
                <td class="action-cell">
                  <button class="btn-approve" @click="verifyOrder(o.id, 'approve')">通过</button>
                  <button class="btn-reject" @click="verifyOrder(o.id, 'reject')">拒绝</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty">暂无待验证订单</div>
        </section>

        <section class="admin-section" v-if="hasPerm('user.upgrade') || auth.user?.isAdmin">
          <h2>用户管理</h2>
          <div class="search-row">
            <input v-model="emailSearch" type="text" placeholder="搜索邮箱…" class="search-input" @keyup.enter="searchUsers" />
            <button class="key-btn" @click="searchUsers">搜索</button>
          </div>
          <div v-if="loading" class="loading">加载中…</div>
          <table v-else-if="users.length" class="admin-table">
            <thead>
              <tr>
                <th>ID</th><th>邮箱</th><th>昵称</th><th>当前套餐</th><th>到期时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>{{ u.id }}</td>
                <td>{{ u.email }}</td>
                <td>{{ u.name || '-' }}</td>
                <td>{{ u.plan || u.role || 'free' }}</td>
                <td>{{ u.currentPeriodEnd ? new Date(u.currentPeriodEnd).toLocaleDateString() : '-' }}</td>
                <td class="action-cell">
                  <button class="btn-approve" @click="setPlan(u.id, 'pro')">设为Pro</button>
                  <button class="btn-premium" @click="setPlan(u.id, 'premium')">设为Premium</button>
                  <button class="btn-reject" @click="setPlan(u.id, 'free')">降为免费</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty">无结果</div>
        </section>
      </div>

      <div v-if="activeTab === 'oauth'" class="tab-content">
        <div class="oauth-bar">
          <span v-if="oauthMsg" class="oauth-msg">{{ oauthMsg }}</span>
          <button class="key-btn" @click="showCreateDialog = true">新建应用</button>
        </div>
        <div v-if="oauthLoading" class="loading">加载中…</div>
        <table v-else-if="oauthApps.length" class="admin-table">
          <thead>
            <tr>
              <th>名称</th><th>Client ID</th><th>Redirect URIs</th><th>Scopes</th><th>IP 白名单</th><th>状态</th><th>创建时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="app in oauthApps" :key="app.id">
              <td>{{ app.name }}</td>
              <td class="mono-cell">{{ app.clientId || app.client_id }}</td>
              <td class="uri-cell">{{ app.redirectUris || app.redirect_uris || '-' }}</td>
              <td>{{ app.scopes || '-' }}</td>
              <td>{{ app.ipWhitelist || app.ip_whitelist || '-' }}</td>
              <td>
                <span :class="['status-badge', app.active ? 'active' : 'inactive']">
                  {{ app.active ? '启用' : '禁用' }}
                </span>
              </td>
              <td>{{ app.createdAt ? new Date(app.createdAt).toLocaleString() : app.created_at ? new Date(app.created_at).toLocaleString() : '-' }}</td>
              <td class="action-cell">
                <button class="btn-edit" @click="openEditDialog(app)">编辑</button>
                <button class="btn-approve" @click="toggleOAuthApp(app)">{{ app.active ? '禁用' : '启用' }}</button>
                <button class="btn-rotate" @click="rotateOAuthSecret(app)">重置密钥</button>
                <button class="btn-reject" @click="deleteOAuthApp(app)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无 OAuth 应用</div>

        <div v-if="showCreateDialog" class="dialog-overlay" @click.self="showCreateDialog = false">
          <div class="dialog">
            <h3>新建 OAuth 应用</h3>
            <div class="form-field">
              <label>名称 *</label>
              <input v-model="createForm.name" type="text" placeholder="应用名称" @keyup.enter="createOAuthApp" />
            </div>
            <div class="form-field">
              <label>Redirect URIs</label>
              <input v-model="createForm.redirectUris" type="text" placeholder="多个用逗号分隔" />
            </div>
            <div class="form-field">
              <label>Scopes</label>
              <input v-model="createForm.scopes" type="text" placeholder="多个用逗号分隔" />
            </div>
            <div class="form-field">
              <label>IP 白名单</label>
              <input v-model="createForm.ipWhitelist" type="text" placeholder="多个用逗号分隔" />
            </div>
            <div class="dialog-actions">
              <button class="key-btn" @click="createOAuthApp">创建</button>
              <button class="logout-btn" @click="showCreateDialog = false">取消</button>
            </div>
          </div>
        </div>

        <div v-if="showEditDialog" class="dialog-overlay" @click.self="showEditDialog = false">
          <div class="dialog">
            <h3>编辑 OAuth 应用</h3>
            <div class="form-field">
              <label>名称 *</label>
              <input v-model="editForm.name" type="text" placeholder="应用名称" />
            </div>
            <div class="form-field">
              <label>Redirect URIs</label>
              <input v-model="editForm.redirectUris" type="text" placeholder="多个用逗号分隔" />
            </div>
            <div class="form-field">
              <label>Scopes</label>
              <input v-model="editForm.scopes" type="text" placeholder="多个用逗号分隔" />
            </div>
            <div class="form-field">
              <label>IP 白名单</label>
              <input v-model="editForm.ipWhitelist" type="text" placeholder="多个用逗号分隔" />
            </div>
            <div class="form-field">
              <label>状态</label>
              <select v-model="editForm.active">
                <option :value="true">启用</option>
                <option :value="false">禁用</option>
              </select>
            </div>
            <div class="dialog-actions">
              <button class="key-btn" @click="updateOAuthApp">保存</button>
              <button class="logout-btn" @click="showEditDialog = false">取消</button>
            </div>
          </div>
        </div>

        <div v-if="showSecretDialog" class="dialog-overlay" @click.self="showSecretDialog = false">
          <div class="dialog">
            <h3>Client Secret</h3>
            <p class="secret-warning">请立即保存此密钥，关闭后将无法再次查看。</p>
            <div class="secret-box">{{ newAppSecret }}</div>
            <div class="dialog-actions">
              <button class="key-btn" @click="copySecret">复制</button>
              <button class="logout-btn" @click="showSecretDialog = false">关闭</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin-view { max-width: 1100px; margin: 0 auto; padding: 24px; }
.admin-view h1 { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
.admin-login { max-width: 400px; margin: 60px auto; text-align: center; }
.admin-login p { font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; }
.key-row { display: flex; gap: 8px; }
.key-input {
  flex: 1; padding: 8px 12px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary);
  font-size: 14px;
}
.key-btn {
  padding: 8px 20px; border: none; border-radius: var(--radius-sm);
  background: var(--brand); color: #fff; font-size: 14px; cursor: pointer;
}
.admin-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.logout-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;
}
.admin-msg { font-size: 13px; color: var(--brand); }
.admin-section { margin-bottom: 32px; }
.admin-section h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.loading { color: var(--text-secondary); font-size: 14px; }
.empty { color: var(--text-muted); font-size: 14px; }
.search-row { display: flex; gap: 8px; margin-bottom: 12px; }
.search-input {
  flex: 1; max-width: 300px; padding: 6px 10px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary);
  font-size: 13px;
}
.admin-table {
  width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.6;
}
.admin-table th, .admin-table td {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border);
}
.admin-table th { font-weight: 600; color: var(--text-secondary); white-space: nowrap; background: var(--bg-secondary); }
.admin-table td { color: var(--text-primary); }
.order-id-cell { font-family: var(--font-mono); max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.action-cell { display: flex; gap: 4px; flex-wrap: nowrap; }
.btn-approve, .btn-reject, .btn-premium {
  padding: 4px 10px; border: none; border-radius: var(--radius-xs);
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.btn-approve { background: #10b981; color: #fff; }
.btn-reject { background: #ef4444; color: #fff; }
.btn-premium { background: #8b5cf6; color: #fff; }
.stats-cards { display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
.stat-card {
  flex: 1; min-width: 140px; padding: 16px 20px;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-md); text-align: center;
}
.stat-value { font-size: 26px; font-weight: 700; color: var(--brand); line-height: 1.2; }
.stat-label { font-size: 13px; color: var(--text-secondary); margin-top: 6px; }
.admin-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.tab-btn {
  padding: 8px 16px; border: none; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: none; color: var(--text-secondary); font-size: 14px; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tab-btn:hover { color: var(--text-primary); background: var(--bg-secondary); }
.tab-btn.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.tab-content { }
.oauth-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.oauth-msg { font-size: 13px; color: var(--brand); }
.mono-cell { font-family: var(--font-mono); font-size: 12px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.uri-cell { font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-badge { padding: 2px 8px; border-radius: var(--radius-xs); font-size: 12px; font-weight: 600; }
.status-badge.active { background: #10b981; color: #fff; }
.status-badge.inactive { background: #6b7280; color: #fff; }
.btn-edit { background: #3b82f6; color: #fff; }
.btn-rotate { background: #f59e0b; color: #fff; }
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.dialog { background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; width: 420px; max-width: 90vw; }
.dialog h3 { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
.form-field { margin-bottom: 12px; }
.form-field label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
.form-field input, .form-field select {
  width: 100%; padding: 7px 10px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 13px; box-sizing: border-box;
}
.dialog-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.secret-warning { font-size: 13px; color: #f59e0b; margin-bottom: 12px; }
.secret-box { font-family: var(--font-mono); font-size: 13px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; word-break: break-all; margin-bottom: 12px; }
</style>
