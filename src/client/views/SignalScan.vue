<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import VChart from 'vue-echarts'
import '../echarts-setup.js'
import { useStockStore } from '../stores/stock'
import TermTip from '../components/TermTip.vue'

const router = useRouter()
const store = useStockStore()

const activeTab = ref<'today' | 'history' | 'realtime'>('today')
const todaySignals = ref<any[]>([])
const todayLoading = ref(false)
const todayEmpty = ref(false)

const historyDate = ref(new Date().toISOString().split('T')[0])
const historyCode = ref('')
const historySignals = ref<any[]>([])
const historyLoading = ref(false)

const statsData = ref<any[]>([])
const statsLoading = ref(false)

const realtimeResults = ref<any[]>([])
const realtimeLoading = ref(false)
const realtimeScanned = ref(false)
const scanInfo = ref({ total: 0, count: 0, page: 1, totalPages: 1 })
const scanProgress = ref({ done: 0, total: 0, latestCode: '', page: 1, totalPages: 1 })
const scanPage = ref(1)
const scanPageSize = ref(100)

onMounted(() => {
  loadToday()
  loadStats()
})

async function loadToday() {
  todayLoading.value = true
  todayEmpty.value = false
  todaySignals.value = []
  try {
    const res = await fetch('/api/signals/today')
    if (res.ok) {
      const data = await res.json()
      todaySignals.value = data
      todayEmpty.value = data.length === 0
    } else {
      todayEmpty.value = true
    }
  } catch {
    todayEmpty.value = true
  } finally {
    todayLoading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  historySignals.value = []
  try {
    const params = new URLSearchParams()
    if (historyDate.value) params.set('date', historyDate.value)
    if (historyCode.value) params.set('code', historyCode.value)
    params.set('limit', '200')
    const res = await fetch(`/api/signals?${params}`)
    if (res.ok) historySignals.value = await res.json()
  } finally {
    historyLoading.value = false
  }
}

async function loadStats() {
  statsLoading.value = true
  try {
    const res = await fetch('/api/signals/stats?days=30')
    if (res.ok) statsData.value = await res.json()
  } finally {
    statsLoading.value = false
  }
}

async function realtimeScan() {
  realtimeLoading.value = true
  realtimeResults.value = []
  realtimeScanned.value = false
  scanInfo.value = { total: 0, count: 0, page: scanPage.value, totalPages: 1 }
  scanProgress.value = { done: 0, total: 0, latestCode: '', page: scanPage.value, totalPages: 1 }
  try {
    const res = await fetch('/api/scan/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: scanPage.value, limit: scanPageSize.value }),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim() || !line.includes(':')) continue
        const colonIdx = line.indexOf(':')
        const event = line.slice(0, colonIdx).trim()
        const dataStr = line.slice(colonIdx + 1).trim()
        if (event === 'meta') {
          const d = JSON.parse(dataStr)
          scanInfo.value = { total: d.total, count: 0, page: d.page, totalPages: d.totalPages }
          scanProgress.value = { ...scanProgress.value, total: 0, page: d.page, totalPages: d.totalPages }
        } else if (event === 'progress') {
          const d = JSON.parse(dataStr)
          scanProgress.value = { done: d.done, total: d.total, latestCode: d.latest?.code || '', page: d.page, totalPages: d.totalPages }
        } else if (event === 'result') {
          const d = JSON.parse(dataStr)
          realtimeResults.value = d.results
          scanInfo.value = { total: d.total, count: d.count, page: d.page, totalPages: d.totalPages }
        }
      }
    }
  } catch (e: any) {
    console.warn('realtime scan', e)
  }
  realtimeScanned.value = true
  realtimeLoading.value = false
}

const statsOption = computed(() => ({
  animation: false,
  tooltip: { trigger: 'axis', backgroundColor: 'rgba(11,17,25,0.95)', borderColor: '#1e2d3d', textStyle: { color: '#e0e6ed' } },
  legend: { data: ['买入信号', '卖出信号'], top: 0, textStyle: { color: '#5a6a7a', fontSize: 11 } },
  grid: { left: 40, right: 12, top: 36, bottom: 24 },
  xAxis: { type: 'category', data: statsData.value.map((d: any) => d.scanDate), axisLabel: { color: '#5a6a7a', fontSize: 10, rotate: 30 } },
  yAxis: { type: 'value', axisLabel: { color: '#5a6a7a', fontSize: 10 }, splitLine: { lineStyle: { color: '#1e2d3d' } } },
  series: [
    { name: '买入信号', type: 'bar', data: statsData.value.filter((d: any) => d.direction === 'BUY').map((d: any) => d.count), itemStyle: { color: '#f0b429' } },
    { name: '卖出信号', type: 'bar', data: statsData.value.filter((d: any) => d.direction === 'SELL').map((d: any) => d.count), itemStyle: { color: '#22c55e' } },
  ],
}))

function viewStock(code: string) {
  store.selectStock(code)
  router.push(`/stock/${code}`)
}

function fmtPrice(v: number | string) {
  return Number(v).toFixed(2)
}
</script>

<template>
  <div class="signals-view">
    <div class="page-header">
      <h1>信号扫描</h1>
      <div class="tab-nav">
        <button class="tab-btn" :class="{ active: activeTab === 'today' }" @click="activeTab = 'today'; loadToday()">今日信号</button>
        <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">历史查询</button>
        <button class="tab-btn" :class="{ active: activeTab === 'realtime' }" @click="activeTab = 'realtime'">实时扫描</button>
      </div>
    </div>

    <template v-if="activeTab === 'today'">
      <div class="card chart-card" v-if="statsData.length">
        <div class="card-title">近30日信号统计</div>
        <VChart :option="statsOption" style="height: 180px" autoresize />
      </div>

      <div v-if="todayLoading" class="loading-state">
        <div class="spinner" />
        <span>加载今日信号...</span>
      </div>
      <div v-else-if="todayEmpty" class="empty-state">
        <span>暂无今日信号（扫描于每个交易日 18:30 自动运行）</span>
        <button class="scan-btn" @click="loadToday" style="margin-top: 8px">刷新</button>
      </div>
      <div v-else class="signal-list">
        <div class="scan-count">今日共 {{ todaySignals.length }} 只股票产生信号</div>
        <div v-for="s in todaySignals" :key="s.code" class="card signal-card" @click="viewStock(s.code)">
          <div class="signal-header">
            <div>
              <span class="signal-name">{{ s.name }}</span>
              <span class="signal-code">{{ s.code }}</span>
            </div>
            <span class="signal-price">{{ fmtPrice(s.price) }}</span>
          </div>
          <div class="signal-badges">
            <span v-for="sig in s.signals" :key="sig.strategyId"
              class="badge" :class="sig.direction === 'BUY' ? 'badge-buy' : 'badge-sell'">
              {{ sig.strategyName }}
            </span>
          </div>
          <div class="signal-footer">
            <span class="strength-label">综合强度</span>
            <span class="strength-value" :class="s.totalStrength > 0 ? 'up-text' : 'down-text'">
              {{ s.totalStrength > 0 ? '+' : '' }}{{ s.totalStrength }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <template v-if="activeTab === 'history'">
      <div class="card control-card">
        <div class="control-row">
          <label>
            <span class="label-text">日期</span>
            <input type="date" v-model="historyDate" />
          </label>
          <label>
            <span class="label-text">股票代码</span>
            <input type="text" v-model="historyCode" placeholder="如 600519" />
          </label>
          <button class="run-btn" @click="loadHistory" :disabled="historyLoading">
            {{ historyLoading ? '查询中...' : '查询' }}
          </button>
        </div>
      </div>

      <div v-if="historyLoading" class="loading-state">
        <div class="spinner" />
      </div>
      <div v-else-if="historySignals.length" class="signal-list">
        <div class="scan-count">共 {{ historySignals.length }} 条信号记录</div>
        <div v-for="s in historySignals" :key="s.id" class="card signal-card" @click="viewStock(s.code)">
          <div class="signal-header">
            <div>
              <span class="signal-name">{{ s.name || s.code }}</span>
              <span class="signal-code">{{ s.code }}</span>
            </div>
            <div class="signal-meta">
              <span class="signal-price">{{ fmtPrice(s.price) }}</span>
              <span class="signal-date">{{ s.scanDate }}</span>
            </div>
          </div>
          <div class="signal-badges">
            <span class="badge" :class="s.direction === 'BUY' ? 'badge-buy' : 'badge-sell'">
              {{ s.strategyName }} {{ s.direction }}
            </span>
            <span class="badge badge-strength">强度 {{ s.strength }}</span>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <span>选择日期查询历史信号</span>
      </div>
    </template>

    <template v-if="activeTab === 'realtime'">
      <div class="card control-card">
        <div class="control-row">
          <button class="run-btn" @click="realtimeScan" :disabled="realtimeLoading">
            {{ realtimeLoading ? '扫描中...' : '开始实时扫描' }}
          </button>
          <div class="scan-pagination">
            <span class="page-label">每页</span>
            <select v-model="scanPageSize" class="page-select" :disabled="realtimeLoading">
              <option :value="10">10条</option>
              <option :value="50">50条</option>
              <option :value="100">100条</option>
            </select>
            <button class="page-btn" @click="scanPage > 1 && scanPage--" :disabled="realtimeLoading || scanPage <= 1">‹</button>
            <span class="page-info">{{ scanPage }} / {{ scanInfo.totalPages || 1 }}</span>
            <button class="page-btn" @click="scanPage < (scanInfo.totalPages || 1) && scanPage++" :disabled="realtimeLoading || scanPage >= (scanInfo.totalPages || 1)">›</button>
          </div>
        </div>
      </div>

      <div v-if="realtimeLoading" class="loading-state">
        <div class="scan-progress-bar">
          <div class="scan-progress-fill" :style="{ width: scanProgress.total > 0 ? (scanProgress.done / scanProgress.total * 100) + '%' : '0%' }" />
        </div>
        <span>正在扫描第 {{ scanProgress.page }}/{{ scanProgress.totalPages }} 页 ({{ scanProgress.total }}只) {{ scanProgress.done }}/{{ scanProgress.total }}{{ scanProgress.latestCode ? ' · ' + scanProgress.latestCode : '' }}</span>
      </div>

      <div v-if="realtimeScanned && realtimeResults.length === 0" class="empty-state">
        <span>已扫描 {{ scanInfo.total }} 只股票，当前无信号</span>
      </div>

      <div v-if="realtimeScanned" class="scan-count">
        第 {{ scanInfo.page }}/{{ scanInfo.totalPages }} 页，共 {{ scanInfo.total }} 只股票，{{ realtimeResults.length }} 只产生信号
      </div>

      <div v-if="realtimeResults.length" class="signal-list">
        <div v-for="r in realtimeResults" :key="r.code" class="card signal-card" @click="viewStock(r.code)">
          <div class="signal-header">
            <div>
              <span class="signal-name">{{ r.name }}</span>
              <span class="signal-code">{{ r.code }}</span>
            </div>
            <span class="signal-price">{{ fmtPrice(r.price) }}</span>
          </div>
          <div class="signal-badges">
            <span v-for="s in r.signals" :key="s.strategyName"
              class="badge" :class="s.direction === 'BUY' ? 'badge-buy' : 'badge-sell'">
              {{ s.strategyName }}
            </span>
          </div>
          <div class="signal-footer">
            <span class="strength-label">强度</span>
            <span class="strength-value" :class="r.totalStrength > 0 ? 'up-text' : 'down-text'">
              {{ r.totalStrength > 0 ? '+' : '' }}{{ r.totalStrength }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.signals-view { padding: 20px; max-width: min(960px, calc(100% - 32px)); margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.page-header h1 { font-size: 18px; font-weight: 600; }
.tab-nav { display: flex; gap: 4px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px; }
.tab-btn { padding: 5px 16px; border: none; background: transparent; color: var(--text-secondary); border-radius: 4px; cursor: pointer; font-size: 13px; transition: var(--transition); }
.tab-btn.active { background: var(--brand-glow); color: var(--brand); font-weight: 600; }

.control-card { margin-bottom: 16px; padding: 14px 16px; }
.control-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.control-row label { display: flex; flex-direction: column; gap: 4px; }
.label-text { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.control-row input { padding: 8px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); font-size: 13px; min-width: 120px; }
.run-btn { display: flex; align-items: center; gap: 6px; padding: 8px 20px; background: var(--brand-gradient); color: #0b0d14; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; font-size: 13px; height: 36px; box-shadow: 0 2px 12px var(--brand-glow); transition: var(--transition); }
.run-btn:hover:not(:disabled) { transform: translateY(-1px); }
.run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.scan-btn { display: flex; align-items: center; gap: 6px; padding: 8px 20px; background: var(--brand-gradient); color: #0b0d14; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; font-size: 13px; height: 36px; box-shadow: 0 2px 12px var(--brand-glow); }
.scan-hint { font-size: 12px; color: var(--text-tertiary); align-self: center; }
.scan-pagination { display: flex; align-items: center; gap: 6px; margin-left: 12px; }
.page-label { font-size: 12px; color: var(--text-tertiary); }
.page-select { padding: 5px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); font-size: 12px; min-width: 60px; }
.page-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); cursor: pointer; font-size: 14px; padding: 0; }
.page-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-info { font-size: 12px; color: var(--text-secondary); min-width: 40px; text-align: center; }

.loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 80px 20px; color: var(--text-tertiary); }
.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.scan-progress-bar { width: 300px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.scan-progress-fill { height: 100%; background: var(--brand-gradient); border-radius: 3px; transition: width 0.3s ease; }

.scan-count { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }

.signal-list { display: flex; flex-direction: column; gap: 8px; }
.signal-card { cursor: pointer; transition: all var(--transition); }
.signal-card:hover { border-color: var(--brand); transform: translateY(-1px); }
.signal-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.signal-name { font-size: 14px; font-weight: 600; }
.signal-code { font-size: 11px; color: var(--text-tertiary); margin-left: 6px; }
.signal-price { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.signal-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.signal-date { font-size: 11px; color: var(--text-tertiary); }
.signal-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
.badge-buy { background: var(--brand-glow); color: var(--brand); }
.badge-sell { background: var(--down-bg); color: var(--down); }
.badge-strength { background: var(--bg); color: var(--text-tertiary); border: 1px solid var(--border); }
.signal-footer { display: flex; align-items: center; gap: 6px; }
.strength-label { font-size: 11px; color: var(--text-tertiary); }
.strength-value { font-size: 14px; font-weight: 700; }

.chart-card { margin-bottom: 16px; padding: 14px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; }

@media (min-width: 768px) {
  .signals-view { padding: 24px 32px; }
}
@media (max-width: 640px) {
  .signals-view { padding: 12px; }
  .signals-view .page-header { flex-direction: column; gap: 8px; }
  .signals-view .page-header h1 { font-size: 18px; }
  .control-row { flex-direction: column; gap: 8px; }
  .control-row select, .control-row input { width: 100%; box-sizing: border-box; }
  .signal-card { padding: 10px; }
  .signal-header { flex-direction: column; gap: 4px; }
  .signal-name { font-size: 14px; }
  .signal-code { font-size: 11px; }
  .signal-meta { flex-wrap: wrap; gap: 6px; }
  .signal-meta span { font-size: 11px; }
  .signal-footer { flex-direction: column; gap: 6px; align-items: flex-start; }
  .scan-progress-bar { width: 100%; max-width: none; }
  .badge { font-size: 10px; padding: 2px 6px; }
}
</style>
