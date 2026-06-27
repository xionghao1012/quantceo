<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useStockStore } from './stores/stock'
import { useHotkeys, hotkeyDescriptions } from './composables/useHotkeys'
import ErrorBoundary from './components/ErrorBoundary.vue'
import { pluginManager, type NavItem } from './plugin'

const router = useRouter()
const auth = useAuthStore()
const store = useStockStore()
const theme = ref<'amber' | 'indigo'>('amber')
const mode = ref<'dark' | 'light'>('dark')
const headerSearch = ref('')
const searchIndex = ref(0)
const showSearchDropdown = ref(false)
const showMobileSearch = ref(false)

const searchResults = computed(() => {
  const q = headerSearch.value.trim().toLowerCase()
  if (!q) return []
  return store.stockList
    .filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    .slice(0, 8)
})

watch(searchResults, () => { searchIndex.value = 0 })

function onSearchFocus() { showSearchDropdown.value = true }
function closeSearchDropdown() { showSearchDropdown.value = false }
function selectSearchStock(code: string) {
  headerSearch.value = ''
  showSearchDropdown.value = false
  showMobileSearch.value = false
  router.push(`/stock/${code}`)
}

function openMobileSearch() {
  showMobileSearch.value = true
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.mobile-search-input')?.focus()
  })
}

function closeMobileSearch() {
  showMobileSearch.value = false
  headerSearch.value = ''
}

const unreadCount = ref(0)
const showNotifications = ref(false)
const showShortcuts = ref(false)
const notifications = ref<any[]>([])
const mobileMenuOpen = ref(false)
let notifInterval: ReturnType<typeof setInterval>

async function fetchUnreadCount() {
  if (!auth.isLoggedIn) return
  try {
    const res = await fetch('/api/push/unread-count', { headers: auth.authHeaders() })
    if (res.ok) {
      const data = await res.json()
      unreadCount.value = data.count
    }
  } catch {}
}

async function fetchNotifications() {
  if (!auth.isLoggedIn) return
  try {
    const res = await fetch('/api/push/notifications?limit=20', { headers: auth.authHeaders() })
    if (res.ok) {
      const data = await res.json()
      notifications.value = data.notifications || []
    }
  } catch {}
}

async function markRead(id: number) {
  await fetch(`/api/push/notifications/${id}/read`, {
    method: 'PUT',
    headers: auth.authHeaders(),
  })
  notifications.value = notifications.value.map(n =>
    n.id === id ? { ...n, status: 'read', readAt: new Date().toISOString() } : n
  )
  unreadCount.value = notifications.value.filter(n => n.status !== 'read' && !n.readAt).length
}

function openNotifications() {
  showNotifications.value = !showNotifications.value
  if (showNotifications.value) fetchNotifications()
}

function closeNotifications(e: MouseEvent) {
  const panel = document.querySelector('.notif-panel')
  const bell = document.querySelector('.notif-bell-btn')
  if (panel && !panel.contains(e.target as Node) && !bell?.contains(e.target as Node)) {
    showNotifications.value = false
  }
}

watch(() => auth.isLoggedIn, (loggedIn) => {
  if (loggedIn) {
    fetchUnreadCount()
    notifInterval = setInterval(fetchUnreadCount, 30000)
  } else {
    unreadCount.value = 0
    if (notifInterval) clearInterval(notifInterval)
  }
})

watch(headerSearch, (val) => {
  store.searchQuery = val
})

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const ssoToken = params.get('sso_token')
  const ssoRefresh = params.get('sso_refresh')
  const ssoUser = params.get('sso_user')
  if (ssoToken && ssoRefresh) {
    auth.saveSession(ssoToken, ssoRefresh)
    if (ssoUser) {
      try { auth.user.value = JSON.parse(decodeURIComponent(ssoUser)) } catch {}
    }
    window.history.replaceState({}, '', window.location.pathname)
    router.push('/')
    return
  }
  auth.fetchUser()
  const savedTheme = localStorage.getItem('theme') as 'amber' | 'indigo' | null
  const savedMode = localStorage.getItem('theme-mode') as 'dark' | 'light' | null
  if (savedTheme) theme.value = savedTheme
  if (savedMode) mode.value = savedMode
  applyTheme(savedTheme || 'amber')
  applyMode(savedMode || 'dark')
  if (auth.isLoggedIn) {
    fetchUnreadCount()
    notifInterval = setInterval(fetchUnreadCount, 30000)
  }
  document.addEventListener('click', closeNotifications)
  document.addEventListener('click', closeMobileMenu)
})

onUnmounted(() => {
  if (notifInterval) clearInterval(notifInterval)
  document.removeEventListener('click', closeNotifications)
  document.removeEventListener('click', closeMobileMenu)
})

function applyTheme(t: 'amber' | 'indigo') {
  document.documentElement.setAttribute('data-theme', t)
}

function switchTheme(t: 'amber' | 'indigo') {
  theme.value = t
  applyTheme(t)
  localStorage.setItem('theme', t)
}

function applyMode(m: 'dark' | 'light') {
  document.documentElement.setAttribute('data-mode', m)
}

function toggleMode() {
  const next = mode.value === 'dark' ? 'light' : 'dark'
  mode.value = next
  applyMode(next)
  localStorage.setItem('theme-mode', next)
}

function goDashboard() {
  store.selectedCode = ''
  router.push({ name: 'dashboard' })
}

function goDetail() {
  if (store.selectedCode) router.push(`/stock/${store.selectedCode}`)
}

useHotkeys([
  { key: 'g', handler: () => router.push('/'), label: '首页/看板' },
  { key: 's', handler: () => router.push('/screener'), label: '选股筛选' },
  { key: 'b', handler: () => router.push('/backtest'), label: '策略回测' },
  { key: 'l', handler: () => router.push('/leaderboard'), label: '收益排行' },
  { key: 'w', handler: () => router.push('/watchlist'), label: '自选股' },
  { key: '/', handler: () => { (document.querySelector('.search-input') as HTMLInputElement)?.focus() }, label: '聚焦搜索' },
  { key: 'n', handler: openNotifications, label: '打开通知', when: () => auth.isLoggedIn },
  { key: 'Escape', handler: () => { showNotifications.value = false; showShortcuts.value = false }, label: '关闭弹窗' },
  { key: '?', handler: () => { showShortcuts.value = !showShortcuts.value }, label: '快捷键帮助' },
])

const navGroups = computed(() => pluginManager.navGroups)

function isActive(item: NavItem) {
  const path = router.currentRoute.value.path
  if (item.route === 'dashboard') return path === '/' || path === '/dashboard'
  if (item.route === 'detail') return path.startsWith('/stock')
  if (item.route === 'rankings') return path === '/rankings' || path === '/leaderboard'
  return path === `/${item.route}`
}

function navigate(item: NavItem) {
  if (item.disable && !item.check()) return
  mobileMenuOpen.value = false
  if (item.route === 'detail') {
    goDetail()
  } else if (item.route === 'dashboard') {
    goDashboard()
  } else {
    router.push({ name: item.route })
  }
}

function closeMobileMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.sidebar') && !target.closest('.mobile-menu-btn')) {
    mobileMenuOpen.value = false
  }
}
</script>

<template>
  <div class="app">
    <div v-if="mobileMenuOpen" class="mobile-overlay" @click="closeMobileMenu"></div>
    <aside class="sidebar" :class="{ open: mobileMenuOpen }">
      <div class="sidebar-logo">
        <div class="logo-mark">Q</div>
        <span class="logo-text">Quant<span class="brand-name">CEO</span></span>
      </div>

      <nav class="sidebar-nav">
        <div v-for="group in navGroups" :key="group.title" class="nav-section">
          <div class="nav-section-title">{{ group.title }}</div>
          <button
            v-for="item in group.items"
            :key="item.route"
            class="nav-item"
            :class="{ active: isActive(item), disabled: item.disable && !item.check() }"
            @click="navigate(item)"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
          </button>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div v-if="auth.isLoggedIn" class="user-info">
          <div class="user-email">{{ auth.user?.email }}</div>
          <div class="user-links">
            <router-link to="/profile" class="user-link">个人中心</router-link>
            <button class="logout-btn" @click="auth.logout()">退出</button>
          </div>
        </div>
        <template v-else>
          <router-link to="/login" class="auth-link">登录</router-link>
          <router-link to="/register" class="auth-link accent">注册</router-link>
        </template>
        <div class="version">v0.1.0-beta</div>
      </div>
    </aside>

    <div class="main">
      <header class="header">
        <button class="mobile-menu-btn mobile-only" @click="mobileMenuOpen = !mobileMenuOpen" aria-label="菜单">
          <span class="hamburger" :class="{ open: mobileMenuOpen }">
            <span></span><span></span><span></span>
          </span>
        </button>
        <div class="header-search desktop-only">
          <span class="search-icon">⌕</span>
          <input
            :value="headerSearch"
            @input="e => headerSearch = (e.target as HTMLInputElement).value"
            @focus="onSearchFocus"
            @blur="closeSearchDropdown"
            @keydown.down.prevent="searchIndex = Math.min(searchIndex + 1, searchResults.length - 1)"
            @keydown.up.prevent="searchIndex = Math.max(searchIndex - 1, 0)"
            @keydown.enter.prevent="searchResults[searchIndex] && selectSearchStock(searchResults[searchIndex].code)"
            type="search"
            class="search-input"
            placeholder="搜索股票代码或名称..."
            aria-label="搜索股票"
            inputmode="search"
            enterkeyhint="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <div v-if="showSearchDropdown && searchResults.length > 0" class="search-dropdown" role="listbox">
            <div
              v-for="(stock, idx) in searchResults"
              :key="stock.code"
              class="search-item"
              :class="{ highlighted: idx === searchIndex }"
              role="option"
              @mousedown.prevent="selectSearchStock(stock.code)"
              @mouseenter="searchIndex = idx"
            >
              <span class="stock-code">{{ stock.code }}</span>
              <span class="stock-name">{{ stock.name }}</span>
              <span class="stock-exchange">{{ stock.exchange }}</span>
            </div>
          </div>
        </div>
        <button class="mobile-search-btn mobile-only" @click="openMobileSearch" title="搜索股票">
          <span>⌕</span>
        </button>
          <div class="header-actions">
          <button class="mode-toggle" @click="toggleMode" :title="mode === 'dark' ? '切换亮色模式' : '切换暗色模式'">
            <span v-if="mode === 'dark'">☀️</span>
            <span v-else>🌙</span>
          </button>
          <div class="theme-switcher">
            <button
              class="theme-opt"
              :class="{ active: theme === 'amber' }"
              @click="switchTheme('amber')"
              title="琥珀·财富"
            >
              <span class="dot amber"></span>
              <span>琥珀</span>
            </button>
            <button
              class="theme-opt"
              :class="{ active: theme === 'indigo' }"
              @click="switchTheme('indigo')"
              title="晶紫·数据"
            >
              <span class="dot indigo"></span>
              <span>紫晶</span>
            </button>
          </div>
          <div v-if="auth.isLoggedIn" class="notif-bell-btn" @click.stop="openNotifications" role="button" aria-label="通知" tabindex="0" @keydown.enter.prevent="openNotifications">
            <span class="bell-icon">🔔</span>
            <span v-if="unreadCount > 0" class="notif-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
          </div>
          <button class="help-btn" @click="showShortcuts = !showShortcuts" title="键盘快捷键">?</button>
          <div v-if="showShortcuts" class="shortcuts-panel">
            <div class="shortcuts-header">
              <span class="shortcuts-title">快捷键</span>
              <button class="shortcuts-close" @click="showShortcuts = false" aria-label="关闭">✕</button>
            </div>
            <div class="shortcuts-list">
              <div v-for="s in hotkeyDescriptions" :key="s.key" class="shortcut-row">
                <kbd class="shortcut-key">{{ s.key }}</kbd>
                <span class="shortcut-label">{{ s.label }}</span>
              </div>
            </div>
          </div>
          <div v-if="showNotifications" class="notif-panel">
            <div class="notif-header">
              <span class="notif-title">通知</span>
              <button class="notif-close" @click.stop="showNotifications = false" aria-label="关闭">✕</button>
            </div>
            <div v-if="notifications.length === 0" class="notif-empty">暂无通知</div>
            <div v-else class="notif-list">
              <div
                v-for="n in notifications"
                :key="n.id"
                class="notif-item"
                :class="{ unread: n.status !== 'read' && !n.readAt }"
                @click="markRead(n.id)"
              >
                <div class="notif-item-body">
                  <div class="notif-item-title">{{ n.title }}</div>
                  <div class="notif-item-body-text">{{ n.body }}</div>
                  <div class="notif-item-time">{{ new Date(n.createdAt).toLocaleString('zh-CN') }}</div>
                </div>
                <div v-if="n.status !== 'read' && !n.readAt" class="notif-dot"></div>
              </div>
            </div>
          </div>
          <div v-if="auth.isLoggedIn" class="user-badge" aria-label="用户菜单">
            <div class="avatar">{{ auth.user?.email?.[0]?.toUpperCase() }}</div>
          </div>
        </div>
      </header>

      <Teleport to="body">
        <div v-if="showMobileSearch" class="mobile-search-overlay" @click.self="closeMobileSearch">
          <div class="mobile-search-modal">
            <div class="mobile-search-header">
              <div class="mobile-search-input-wrap">
                <span class="search-icon">⌕</span>
                <input
                  :value="headerSearch"
                  @input="e => headerSearch = (e.target as HTMLInputElement).value"
                  @keydown.down.prevent="searchIndex = Math.min(searchIndex + 1, searchResults.length - 1)"
                  @keydown.up.prevent="searchIndex = Math.max(searchIndex - 1, 0)"
                  @keydown.enter.prevent="searchResults[searchIndex] && selectSearchStock(searchResults[searchIndex].code)"
                  type="search"
                  class="mobile-search-input"
                  placeholder="搜索股票代码或名称..."
                  aria-label="搜索股票"
                  inputmode="search"
                  enterkeyhint="search"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </div>
              <button class="mobile-search-cancel" @click="closeMobileSearch">取消</button>
            </div>
            <div class="mobile-search-results" role="listbox">
              <div
                v-for="(stock, idx) in searchResults"
                :key="stock.code"
                class="search-item"
                :class="{ highlighted: idx === searchIndex }"
                role="option"
                @click="selectSearchStock(stock.code)"
                @mouseenter="searchIndex = idx"
              >
                <span class="stock-code">{{ stock.code }}</span>
                <span class="stock-name">{{ stock.name }}</span>
                <span class="stock-exchange">{{ stock.exchange }}</span>
              </div>
              <div v-if="headerSearch.trim() && searchResults.length === 0" class="mobile-search-empty">
                未找到匹配的股票
              </div>
              <div v-if="!headerSearch.trim()" class="mobile-search-hint">
                输入股票代码或名称搜索
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <main id="main-content" class="content">
        <ErrorBoundary>
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </ErrorBoundary>
      </main>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700;900&display=swap');

/* ===== Theme: Amber / Gold ===== */
[data-theme="amber"] {
  --brand: hsl(42, 86%, 55%);
  --brand-light: hsl(42, 86%, 72%);
  --brand-dark: hsl(42, 86%, 42%);
  --brand-glow: hsla(42, 86%, 55%, 0.12);
  --brand-subtle: linear-gradient(135deg, hsla(42, 86%, 55%, 0.08), transparent);
  --brand-gradient: linear-gradient(135deg, hsl(42, 86%, 55%), hsl(42, 86%, 48%), hsl(42, 86%, 38%));
  --brand-name: '琥珀·财富';
}

/* ===== Theme: Indigo / Purple ===== */
[data-theme="indigo"] {
  --brand: hsl(245, 75%, 65%);
  --brand-light: hsl(245, 75%, 78%);
  --brand-dark: hsl(245, 75%, 50%);
  --brand-glow: hsla(245, 75%, 65%, 0.12);
  --brand-subtle: linear-gradient(135deg, hsla(245, 75%, 65%, 0.08), transparent);
  --brand-gradient: linear-gradient(135deg, hsl(245, 75%, 65%), hsl(235, 75%, 58%), hsl(225, 75%, 48%));
  --brand-name: '晶紫·数据';
}

/* ===== Base ===== */
:root {
  --bg-deep: #0b0d14;
  --bg: #10121c;
  --bg-card: #161a28;
  --bg-card-hover: #1c2034;
  --bg-sidebar: #0e101a;
  --bg-header: rgba(14, 16, 26, 0.88);
  --bg-elevated: #1e2338;

  --up: #ef4444;
  --up-bg: rgba(239, 68, 68, 0.12);
  --up-dim: rgba(239, 68, 68, 0.35);
  --down: #22c55e;
  --down-bg: rgba(34, 197, 94, 0.12);
  --down-dim: rgba(34, 197, 94, 0.35);

  --tooltip-bg: rgba(14, 16, 26, 0.96);
  --datazoom-filler: rgba(240, 180, 41, 0.1);
  --vol-up: rgba(239, 68, 68, 0.4);
  --vol-down: rgba(34, 197, 94, 0.4);
  --macd-up: rgba(239, 68, 68, 0.7);
  --macd-down: rgba(34, 197, 94, 0.7);
  --macd-dif: #60a5fa;
  --macd-dea: #fb923c;
  --ma5: #fde047;
  --ma20: #c084fc;
  --ma60: #38bdf8;
  --rsi: #a78bfa;
  --rsi-area: rgba(167, 139, 250, 0.1);

  --text-primary: #e8eaed;
  --text-secondary: #7c8099;
  --text-tertiary: #8a8fa8;

  --border: #23263a;
  --border-light: #1a1e30;

  --shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.4);

  --radius: 10px;
  --radius-sm: 6px;
  --radius-lg: 14px;

  --sidebar-width: 220px;
  --header-height: 60px;

  --transition: 0.35s cubic-bezier(0.4, 0, 0.2, 1);

  --font: 'Inter', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ===== Light Mode ===== */
[data-mode="light"] {
  --bg-deep: #f5f6fa;
  --bg: #ffffff;
  --bg-card: #ffffff;
  --bg-card-hover: #f0f1f5;
  --bg-sidebar: #e8e9f0;
  --bg-header: rgba(255, 255, 255, 0.90);
  --bg-elevated: #ffffff;

  --text-primary: #1a1c23;
  --text-secondary: #5c6070;
  --text-tertiary: #6b7080;

  --border: #d8dae3;
  --border-light: #e8eaf0;

  --tooltip-bg: rgba(255, 255, 255, 0.96);
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.12);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }
body {
  font-family: var(--font);
  background: var(--bg-deep);
  color: var(--text-primary);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  height: 100vh;
}
input, button, select { font-family: inherit; font-size: inherit; }
a { text-decoration: none; color: inherit; }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::selection { background: var(--brand); color: var(--bg-deep); }

/* ===== App Layout ===== */
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ===== Sidebar ===== */
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  right: -1px;
  width: 2px;
  height: 100%;
  background: var(--brand-gradient);
  opacity: 0.5;
}

.sidebar-logo {
  padding: 0 16px;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.logo-mark {
  width: 30px;
  height: 30px;
  background: var(--brand-gradient);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0b0d14;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 0 20px var(--brand-glow);
  flex-shrink: 0;
}

.logo-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.brand-name {
  color: var(--brand);
}

.sidebar-nav {
  flex: 1;
  padding: 14px 10px;
  overflow-y: auto;
}

.nav-section {
  margin-bottom: 4px;
}
.nav-section + .nav-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.nav-section-title {
  padding: 4px 12px 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  width: 100%;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
  transition: var(--transition);
  position: relative;
  margin-bottom: 2px;
}

.nav-icon {
  font-size: 15px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.nav-label {
  flex: 1;
}

.nav-item:hover:not(.disabled) {
  background: var(--brand-glow);
  color: var(--brand-light);
}

.nav-item.active {
  background: var(--brand-glow);
  color: var(--brand);
  font-weight: 600;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  background: var(--brand-gradient);
  border-radius: 0 2px 2px 0;
}

.nav-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ===== Sidebar Footer ===== */
.sidebar-footer {
  padding: 14px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.user-email {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-links {
  display: flex;
  gap: 8px;
  align-items: center;
}

.user-link, .logout-btn, .auth-link {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  transition: var(--transition);
}

.user-link:hover, .logout-btn:hover, .auth-link:hover {
  color: var(--brand);
}

.auth-link.accent {
  color: var(--brand);
  font-weight: 600;
}

.version {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 8px;
}

/* ===== Main ===== */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ===== Header ===== */
.header {
  height: var(--header-height);
  overflow: visible;
  z-index: 100;
  position: relative;
  background: var(--bg-header);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 16px;
  flex-shrink: 0;
}

.header-search {
  flex: 1;
  max-width: 320px;
  position: relative;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  font-size: 14px;
  z-index: 1;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-primary);
  outline: none;
  font-size: 13px;
  transition: var(--transition);
}

.search-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-glow);
}
.search-input::-webkit-search-cancel-button { display: none; }
.search-input::-webkit-search-decoration { display: none; }

.search-input::placeholder {
  color: var(--text-tertiary);
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  z-index: 1000;
  overflow: hidden;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.search-item:hover {
  background: var(--brand-glow);
}

.search-item.highlighted {
  background: var(--brand-glow);
}

.search-item:active {
  background: var(--border);
}

.stock-code {
  font-family: monospace;
  font-size: 13px;
  color: var(--brand);
  font-weight: 600;
}

.stock-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
}

.stock-exchange {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg);
  padding: 2px 6px;
  border-radius: 4px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  position: relative;
}

/* ===== Notification Bell ===== */
.notif-bell-btn {
  position: relative;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius);
  transition: background var(--transition);
  user-select: none;
}
.notif-bell-btn:hover { background: var(--bg); }
.bell-icon { font-size: 16px; opacity: 0.8; }
.notif-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ===== Notification Panel ===== */
.notif-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 340px;
  max-height: 480px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.notif-title { font-size: 14px; font-weight: 600; }
.notif-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--radius);
}
.notif-close:hover { background: var(--bg); color: var(--text-primary); }
.notif-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}
.notif-list {
  overflow-y: auto;
  flex: 1;
}
.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: background var(--transition);
  position: relative;
}
.notif-item:last-child { border-bottom: none; }
.notif-item:hover { background: var(--bg); }
.notif-item.unread { background: rgba(245, 158, 11, 0.04); }
.notif-item-body { flex: 1; min-width: 0; }
.notif-item-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notif-item-body-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.notif-item-time {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
}
.notif-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  flex-shrink: 0;
  margin-top: 4px;
}

/* ===== Help Button ===== */
.help-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
}
.help-btn:hover { border-color: var(--brand); color: var(--brand); background: var(--bg); }

/* ===== Shortcuts Panel ===== */
.shortcuts-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 80px;
  width: 280px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  z-index: 1000;
  overflow: hidden;
}
.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.shortcuts-title { font-size: 14px; font-weight: 600; }
.shortcuts-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--radius);
}
.shortcuts-close:hover { background: var(--bg); color: var(--text-primary); }
.shortcuts-list { padding: 8px 0; }
.shortcut-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
}
.shortcut-row:hover { background: var(--bg); }
.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 22px;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: monospace;
  color: var(--text-primary);
  box-shadow: 0 1px 0 var(--border);
}
.shortcut-label { font-size: 12px; color: var(--text-secondary); }

/* ===== Theme Switcher ===== */
.mode-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  transition: var(--transition);
}
.mode-toggle:hover { border-color: var(--brand); color: var(--brand); background: var(--bg); }

.theme-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.theme-opt {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 16px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: var(--transition);
  font-family: inherit;
}

.theme-opt:hover {
  color: var(--text-primary);
}

.theme-opt.active {
  background: var(--brand-glow);
  color: var(--brand);
}

.theme-opt .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.theme-opt .dot.amber {
  background: linear-gradient(135deg, #f0b429, #d97706);
}

.theme-opt .dot.indigo {
  background: linear-gradient(135deg, #818cf8, #6366f1);
}

/* ===== User Badge ===== */
.user-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px 3px 3px;
  border-radius: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: var(--transition);
}

.user-badge:hover {
  border-color: var(--brand);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--brand-gradient);
  color: #0b0d14;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  transition: var(--transition);
}

/* ===== Content ===== */
.content {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
}

/* ===== Transitions ===== */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ===== Global Utilities ===== */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow);
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.up-text { color: var(--up); }
.down-text { color: var(--down); }
.neutral-text { color: var(--text-secondary); }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  font-family: inherit;
  white-space: nowrap;
}

.btn-brand {
  background: var(--brand-gradient);
  color: #0b0d14;
  box-shadow: 0 2px 12px var(--brand-glow);
}

.btn-brand:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px var(--brand-glow);
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--brand-glow);
  border-color: var(--brand);
  color: var(--brand);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-header h2 {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-header .accent {
  width: 3px;
  height: 14px;
  background: var(--brand-gradient);
  border-radius: 2px;
}

/* ===== Responsive ===== */
@media (max-width: 768px) {
  .app { flex-direction: column; }
  .sidebar {
    position: fixed;
    top: 0;
    left: -280px;
    width: 260px;
    height: 100vh;
    z-index: 10001;
    flex-direction: column;
    padding: 0;
    border-right: 1px solid var(--border);
    border-bottom: none;
    overflow-y: auto;
    transition: left 0.25s ease;
    box-shadow: 4px 0 24px rgba(0,0,0,0.3);
  }
  .sidebar.open {
    left: 0;
  }
  .sidebar-logo {
    display: flex;
    padding: 0 16px;
    height: 52px;
    border-bottom: 1px solid var(--border);
  }
  .logo-text { font-size: 14px; }
  .nav-section { margin-bottom: 2px; }
  .nav-section-title { display: block; font-size: 10px; padding: 8px 16px 4px; }
  .nav-section + .nav-section { margin-top: 4px; padding-top: 4px; }
  .sidebar-nav { display: flex; flex-direction: column; padding: 4px 0; gap: 0; }
  .nav-item { padding: 10px 16px; font-size: 13px; white-space: nowrap; margin-bottom: 1px; border-radius: 0; }
  .nav-label { display: inline; }
  .nav-icon { width: 22px; }
  .nav-item.active::before { display: none; }
  .sidebar-footer { display: flex; margin-top: auto; padding: 12px 16px; border-top: 1px solid var(--border); }
  .header { padding: 0 12px; }
  .header-search { max-width: none; min-width: 0; flex: 1; }
  .header-actions { flex-shrink: 0; }
  .search-input { font-size: 16px; -webkit-text-size-adjust: 100%; width: 100%; min-height: 36px; }
  .content { padding: 12px; }
}

/* ===== Mobile-only elements ===== */
.desktop-only { display: block; }
.mobile-only { display: none; }

.mobile-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 9999;
}
@media (max-width: 768px) {
  .mobile-overlay { display: block; }
  .desktop-only { display: none !important; }
  .mobile-only { display: flex; }
}

.mobile-menu-btn {
  background: none;
  border: none;
  padding: 8px;
  cursor: pointer;
  margin-right: 8px;
  align-items: center;
}
.hamburger {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 20px;
}
.hamburger span {
  display: block;
  height: 2px;
  background: var(--text-primary);
  border-radius: 1px;
  transition: transform 0.2s, opacity 0.2s;
}
.hamburger.open span:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}
.hamburger.open span:nth-child(2) {
  opacity: 0;
}
.hamburger.open span:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}

.mobile-search-btn {
  display: none;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 16px;
}

.mobile-search-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 9999;
  justify-content: flex-start;
  align-items: flex-start;
}

.mobile-search-modal {
  width: 100%;
  max-width: 100%;
  background: var(--bg-secondary);
  border-radius: 0 0 16px 16px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mobile-search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.mobile-search-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.mobile-search-input-wrap .search-icon {
  position: absolute;
  left: 12px;
  color: var(--text-tertiary);
  font-size: 16px;
}

.mobile-search-input {
  width: 100%;
  padding: 12px 12px 12px 38px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-primary);
  font-size: 16px;
  outline: none;
  -webkit-appearance: none;
}

.mobile-search-input:focus {
  border-color: var(--brand);
}

.mobile-search-cancel {
  background: none;
  border: none;
  color: var(--brand);
  font-size: 15px;
  cursor: pointer;
  padding: 8px;
  white-space: nowrap;
}

.mobile-search-results {
  overflow-y: auto;
  flex: 1;
}

.mobile-search-empty,
.mobile-search-hint {
  padding: 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
}

@media (max-width: 768px) {
  .desktop-only { display: none !important; }
  .mobile-only { display: flex !important; }

  .mobile-search-overlay {
    display: flex;
    flex-direction: column;
  }
}
</style>
