<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useStockStore } from '../stores/stock'


const router = useRouter()
const store = useStockStore()
const loading = ref(true)
const loadingProgress = ref(0)
const loadingPhase = ref('正在加载股票列表...')
const loaded = ref(false)
const fetchError = ref('')
const page = ref(1)
const PAGE_SIZE = 200
const indices = ref<any[]>([])
const indicesLoading = ref(true)
const hotSectors = ref<any[]>([])
const marketDate = ref('')

const filteredStocks = computed(() => {
  const q = store.searchQuery.trim().toLowerCase()
  if (!q) return store.stockList
  return store.stockList.filter(s =>
    s.name.toLowerCase().includes(q) || s.code.includes(q)
  )
})

const paginatedStocks = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredStocks.value.slice(start, start + PAGE_SIZE)
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredStocks.value.length / PAGE_SIZE)))

let refreshTimer: ReturnType<typeof setInterval>

watch(() => store.searchQuery, () => { page.value = 1 })
watch(page, () => {
  if (loaded.value) {
    store.fetchQuotesForPage(paginatedStocks.value.map(s => s.code))
  }
})

async function loadAll() {
  loading.value = true
  loadingProgress.value = 0
  loadingPhase.value = '正在加载股票列表...'
  fetchError.value = ''
  try {
    await Promise.all([
      store.fetchStockList((n) => { loadingProgress.value = Math.min(n, 100) }),
      store.fetchQuotes()
    ])
  } catch (e: any) {
    fetchError.value = e.message || '获取数据失败'
  } finally {
    loadingProgress.value = 100
    loadingPhase.value = '正在加载行情数据...'
    setTimeout(() => {
      loaded.value = true
      loading.value = false
    }, 200)
  }
}

function viewStock(code: string) {
  store.selectStock(code)
  router.push(`/stock/${code}`)
}

function retry() {
  loadAll()
}

async function fetchIndices() {
  try {
    const [idxRes, sectorRes] = await Promise.all([
      fetch('/api/market/indices'),
      fetch('/api/market/hot-sectors'),
    ])
    if (idxRes.ok) {
      const data = await idxRes.json()
      indices.value = data.indices || []
      marketDate.value = data.marketDate || ''
    }
    if (sectorRes.ok) {
      const data = await sectorRes.json()
      hotSectors.value = data.sectors || []
    }
  } catch {} finally {
    indicesLoading.value = false
  }
}

onMounted(() => {
  loadAll()
  fetchIndices()
  refreshTimer = setInterval(() => {
    if (loaded.value) store.fetchQuotesForPage(paginatedStocks.value.map(s => s.code))
  }, 30000)
})

onUnmounted(() => {
  clearInterval(refreshTimer)
})

function fmtPrice(v: number) { return v != null ? v.toFixed(2) : '--' }
function fmtChange(v: number) {
  if (v == null) return '--'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtVol(v: number) {
  if (v == null) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return String(v)
}

function stockQuote(code: string) {
  return store.quotes[code] || null
}
</script>

<template>
  <div class="stock-list">
    <!-- Loading Bar -->
    <div v-if="loading" class="loading-bar-wrap">
      <div class="loading-bar" :style="{ width: loadingProgress + '%' }"></div>
      <span class="loading-phase">{{ loadingPhase }} {{ store.stockList.length > 0 ? store.stockList.length + '只' : '' }}</span>
    </div>

    <!-- Market Indices -->
    <div class="market-hero-wrap" v-if="!store.searchQuery && loaded">
      <div class="market-hero-header">
        <span class="market-hero-title">大盘指数</span>
        <span class="market-hero-date" v-if="marketDate">{{ marketDate }}</span>
      </div>
      <div class="market-hero">
        <div
          v-for="idx in indices"
          :key="idx.code"
          class="hero-card index-card"
        >
          <div class="hero-top">
            <span class="hero-label">{{ idx.shortName }}</span>
            <span class="hero-code">{{ idx.name }}</span>
          </div>
          <div class="hero-body">
            <div class="hero-price" :class="idx.change >= 0 ? 'up-text' : 'down-text'">
              {{ idx.price.toFixed(2) }}
            </div>
            <div class="hero-change" :class="idx.change >= 0 ? 'up-text' : 'down-text'">
              {{ (idx.change >= 0 ? '+' : '') + idx.changePct.toFixed(2) + '%' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sector Performance -->
    <div v-if="!store.searchQuery && loaded && hotSectors.length" class="sector-bar">
      <span class="sector-bar-label">热门板块</span>
      <div class="sector-tags">
        <div
          v-for="s in hotSectors"
          :key="s.name"
          class="sector-tag"
          :class="s.changePct >= 0 ? 'up' : 'down'"
        >
          <span class="sector-name">{{ s.name }}</span>
          <span class="sector-change">{{ (s.changePct >= 0 ? '+' : '') + s.changePct.toFixed(2) + '%' }}</span>
        </div>
      </div>
    </div>

    <!-- Quick Stats -->
    <div v-if="!store.searchQuery && loaded" class="quick-stats">
      <div class="stat-card">
        <span class="stat-label">总股票数</span>
        <span class="stat-value">{{ store.stockList.length }}</span>
      </div>
      <div v-if="indices.length" class="stat-card">
        <span class="stat-label">上涨家数</span>
        <span class="stat-value up-text">{{ indices.reduce((a, i) => a + Math.max(0, i.rise || 0), 0).toLocaleString() }}</span>
      </div>
      <div v-if="indices.length" class="stat-card">
        <span class="stat-label">下跌家数</span>
        <span class="stat-value down-text">{{ indices.reduce((a, i) => a + Math.max(0, i.fall || 0), 0).toLocaleString() }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">当前筛选</span>
        <span class="stat-value">{{ filteredStocks.length }} 只</span>
      </div>
    </div>



    <!-- Error Banner -->
    <div v-if="fetchError && !loaded" class="error-banner">
      <span>⚠ {{ fetchError }}</span>
      <button class="retry-btn" @click="retry">重试</button>
    </div>

    <!-- Section Header -->
    <div class="section-header">
      <h1>
        <span class="accent"></span>
        全部股票
        <span class="stock-count">
          {{ filteredStocks.length }} 只
          <span v-if="marketDate" class="section-date">| {{ marketDate }}</span>
        </span>
      </h1>
      <div class="header-right">
        <button class="refresh-btn" @click="store.fetchQuotes()" :disabled="loading">
          ↻ {{ loading ? '刷新中...' : '刷新数据' }}
        </button>
      </div>
    </div>

    <!-- Error inside grid -->
    <div v-if="fetchError && loaded" class="error-inline">
      ⚠ {{ fetchError }} — <button class="link-btn" @click="retry">点击重试</button>
    </div>

    <!-- Stock Grid -->
    <div class="stock-grid">
      <div
        v-for="s in paginatedStocks"
        :key="s.code"
        class="stock-card"
        @click="viewStock(s.code)"
      >
        <div class="stock-card-header">
          <div class="stock-name-row">
            <span class="stock-name">{{ s.name }}</span>
            <span class="stock-code">{{ s.code }}</span>
          </div>
        </div>
        <div class="stock-card-body">
          <template v-if="stockQuote(s.code)">
            <div class="stock-price" :class="stockQuote(s.code)!.change >= 0 ? 'up-text' : 'down-text'">
              {{ fmtPrice(stockQuote(s.code)!.price) }}
            </div>
            <div class="stock-meta">
              <span
                class="pct-badge"
                :class="stockQuote(s.code)!.change >= 0 ? 'up' : 'down'"
              >
                {{ fmtChange(stockQuote(s.code)!.change) }}
              </span>
              <span class="vol-label">量 {{ fmtVol(stockQuote(s.code)!.volume) }}</span>
            </div>
          </template>
          <template v-else>
            <div class="skeleton-text price-skel"></div>
            <div class="skeleton-text meta-skel"></div>
          </template>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="pagination">
      <button class="page-btn page-nav" :disabled="page === 1" @click="page = 1">«</button>
      <button class="page-btn page-nav" :disabled="page === 1" @click="page--">‹</button>
      <div class="page-info">
        <span class="page-num">{{ page }}</span>
        <span class="page-sep">/</span>
        <span class="page-total">{{ totalPages }}</span>
      </div>
      <button class="page-btn page-nav" :disabled="page === totalPages" @click="page++">›</button>
      <button class="page-btn page-nav" :disabled="page === totalPages" @click="page = totalPages">»</button>
      <span class="page-count">{{ filteredStocks.length }} 只</span>
    </div>
  </div>
</template>

<style scoped>
.market-hero-wrap {
  margin-bottom: 20px;
}

.market-hero-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.market-hero-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.market-hero-date {
  font-size: 11px;
  color: var(--text-tertiary);
  background: rgba(139,92,246,0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.market-hero {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.sector-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.sector-bar-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.sector-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sector-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
}

.sector-tag.up {
  background: rgba(239,68,68,0.1);
  color: var(--up, #ef4444);
}

.sector-tag.down {
  background: rgba(34,197,94,0.1);
  color: var(--down, #22c55e);
}

.quick-stats {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-label {
  font-size: 11px;
  color: var(--text-tertiary);
}
.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.sector-name {
  font-weight: 500;
}

.sector-change {
  font-weight: 600;
}

.hero-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  position: relative;
  overflow: hidden;
  transition: var(--transition);
}

.hero-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--brand-gradient);
  opacity: 0.5;
}

.hero-card:hover {
  border-color: var(--brand);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.hero-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.hero-code {
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.hero-body {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.hero-price {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.hero-change {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Section Header */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-header h1 {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stock-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-left: 4px;
}

.section-date {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
}

.section-header .accent {
  width: 3px;
  height: 14px;
  background: var(--brand-gradient);
  border-radius: 2px;
}

/* Error Banner */
.error-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--up-bg);
  border: 1px solid var(--up);
  border-radius: var(--radius);
  color: var(--up);
  font-size: 13px;
  margin-bottom: 14px;
}

.error-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--brand);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  text-decoration: underline;
}

.retry-btn {
  padding: 4px 12px;
  background: var(--up);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

/* Refresh Button */
.refresh-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: var(--transition);
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Stock Grid */
.stock-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.stock-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  cursor: pointer;
  transition: var(--transition);
}

.stock-card:hover {
  border-color: var(--brand);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  background: var(--bg-card-hover);
}

.stock-card-header {
  margin-bottom: 10px;
}

.stock-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stock-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stock-code {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  padding: 1px 5px;
  background: var(--bg);
  border-radius: 3px;
}

.stock-card-body {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.stock-price {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.stock-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.pct-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}

.pct-badge.up {
  background: var(--up-bg);
  color: var(--up);
}

.pct-badge.down {
  background: var(--down-bg);
  color: var(--down);
}

.vol-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Skeleton Loading */
.skeleton-text {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.price-skel {
  width: 80px;
  height: 26px;
  background: linear-gradient(90deg, var(--border) 25%, var(--border-light) 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  font-size: 22px;
  font-weight: 700;
}

.meta-skel {
  width: 50px;
  height: 16px;
  background: linear-gradient(90deg, var(--border) 25%, var(--border-light) 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.header-right { display: flex; gap: 8px; align-items: center; }

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0 12px;
}
.page-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  transition: var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
}
.page-btn:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-glow);
}
.page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.page-nav { width: 32px; height: 32px; padding: 0; font-size: 15px; }
.page-info { display: flex; align-items: center; gap: 4px; padding: 0 8px; }
.page-num { font-size: 15px; font-weight: 600; color: var(--brand); }
.page-sep { font-size: 13px; color: var(--text-tertiary); }
.page-total { font-size: 13px; color: var(--text-tertiary); }
.page-count { font-size: 12px; color: var(--text-tertiary); padding-left: 8px; }

.loading-bar-wrap {
  position: relative;
  height: 3px;
  background: var(--border);
  margin-bottom: 16px;
  overflow: hidden;
}
.loading-bar {
  height: 100%;
  background: var(--brand-gradient);
  transition: width 0.3s ease;
}
.loading-phase {
  position: absolute;
  top: 8px;
  left: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}

@media (min-width: 768px) {
  .stock-list { padding: 24px 32px; }
}
@media (max-width: 768px) {
  .market-hero { grid-template-columns: 1fr; }
  .stock-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
