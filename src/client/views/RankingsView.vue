<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const loading = ref(false)
const computing = ref(false)
const error = ref('')
const searchQuery = ref('')

const mode = ref<'metric' | 'strategy'>('metric')
const selectedDate = ref(new Date().toISOString().split('T')[0])
const selectedBoard = ref('all')
const selectedMetric = ref('rsi')
const selectedStrategy = ref('')

const availableDates = ref<string[]>([])
const strategies = ref<any[]>([])
const data = ref<any>(null)

const boards = [
  { key: 'all', label: '全部' },
  { key: 'hsb', label: '沪深主板' },
  { key: 'kcb', label: '科创板' },
  { key: 'cyb', label: '创业板' },
]

const metrics = [
  { key: 'rsi', label: 'RSI', desc: '相对强弱指标，<30超卖 >70超买', unit: '', sort: 'asc', icon: '📉' },
  { key: 'change_pct', label: '涨跌幅', desc: '当日收盘涨跌百分比', unit: '%', sort: 'desc', icon: '📊' },
  { key: 'vol_ratio', label: '成交量比', desc: '当日成交量 / 20日均量', unit: 'x', sort: 'desc', icon: '📈' },
  { key: 'macd_signal', label: 'MACD信号', desc: 'DIF与DEA差值，越大越强', unit: '', sort: 'desc', icon: '📐' },
  { key: 'bb_position', label: '布林位置', desc: '0=下轨 50=中轨 100=上轨', unit: '', sort: 'desc', icon: '🎯' },
  { key: 'ma_alignment', label: '均线多头', desc: 'MA5>MA20>MA60 为1否则0', unit: '', sort: 'desc', icon: '📏' },
  { key: 'volatility', label: '波动率', desc: '年化波动率，越高越活跃', unit: '%', sort: 'desc', icon: '🌊' },
  { key: 'momentum', label: '动量', desc: '10日价格变化率', unit: '%', sort: 'desc', icon: '🚀' },
]

const currentMetric = computed(() => metrics.find(m => m.key === selectedMetric.value)!)
const currentStrategy = computed(() => strategies.value.find(s => s.key === selectedStrategy.value))

const filteredRankings = computed(() => {
  const items = data.value?.rankings || []
  if (!searchQuery.value) return items
  const q = searchQuery.value.toUpperCase()
  return items.filter((r: any) =>
    r.code?.toUpperCase().includes(q) || r.name?.toUpperCase().includes(q)
  )
})

async function fetchRankings() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      date: selectedDate.value,
      board: selectedBoard.value,
      limit: '100',
    })
    if (mode.value === 'strategy') {
      params.set('strategy', selectedStrategy.value)
      const res = await fetch(`/api/rankings/strategies?${params}`, { headers: auth.authHeaders() })
      if (!res.ok) throw new Error('获取策略排行失败')
      data.value = await res.json()
    } else {
      params.set('metric', selectedMetric.value)
      const res = await fetch(`/api/rankings?${params}`, { headers: auth.authHeaders() })
      if (!res.ok) throw new Error('获取排行榜失败')
      data.value = await res.json()
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function fetchDates() {
  try {
    const res = await fetch('/api/rankings/available-dates')
    if (res.ok) {
      const d = await res.json()
      availableDates.value = d.dates || []
    }
  } catch {}
}

async function fetchStrategies() {
  try {
    const res = await fetch('/api/rankings/strategies/list')
    if (res.ok) {
      const d = await res.json()
      strategies.value = d.strategies || []
      if (d.strategies?.length && !selectedStrategy.value) {
        selectedStrategy.value = d.strategies[0].key
      }
    }
  } catch {}
}

async function triggerCompute() {
  computing.value = true
  try {
    const res = await fetch('/api/scheduler/compute-metrics', {
      method: 'POST',
      headers: auth.authHeaders(),
    })
    if (!res.ok) throw new Error('触发失败')
    await fetchDates()
    await fetchRankings()
  } catch (e: any) {
    error.value = e.message
  } finally {
    computing.value = false
  }
}

function viewStock(code: string) {
  router.push(`/stock/${code}`)
}

function switchMode(m: 'metric' | 'strategy') {
  mode.value = m
  data.value = null
  fetchRankings()
}

function formatValue(v: number | null, metricKey: string) {
  if (v == null) return '--'
  switch (metricKey) {
    case 'rsi': return v.toFixed(1)
    case 'bb_position': return v.toFixed(1)
    case 'vol_ratio': return v.toFixed(2) + 'x'
    case 'change_pct':
    case 'volatility':
    case 'momentum': return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
    case 'macd_signal': return (v >= 0 ? '+' : '') + v.toFixed(2)
    case 'ma_alignment': return v > 0 ? '✅' : '❌'
    default: return v.toFixed(4)
  }
}

function valueColor(v: number | null, metricKey: string) {
  if (v == null) return ''
  switch (metricKey) {
    case 'rsi':
      if (v < 30) return 'text-success'
      if (v > 70) return 'text-danger'
      return 'text-warning'
    case 'change_pct':
    case 'momentum':
      return v > 0 ? 'text-danger' : v < 0 ? 'text-success' : ''
    case 'vol_ratio':
      return v > 1.5 ? 'text-danger' : v < 0.5 ? 'text-success' : ''
    default: return ''
  }
}

function scoreColor(score: number) {
  if (score >= 80) return 'score-a'
  if (score >= 60) return 'score-b'
  if (score >= 40) return 'score-c'
  if (score >= 20) return 'score-d'
  return 'score-e'
}

function boardLabel(b: string) {
  return { hsb: '沪深主板', kcb: '科创板', cyb: '创业板' }[b] || b
}

function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

onMounted(async () => {
  await fetchDates()
  if (availableDates.value.length > 0) {
    selectedDate.value = availableDates.value[0]
  }
  await fetchStrategies()
  await fetchRankings()
})

watch([selectedDate, selectedBoard], fetchRankings)
watch(selectedMetric, () => { if (mode.value === 'metric') fetchRankings() })
watch(selectedStrategy, () => { if (mode.value === 'strategy') fetchRankings() })
</script>

<template>
  <div class="rankings-view">
    <div class="page-header">
      <div class="header-left">
        <h1>指标排行</h1>
        <span class="header-subtitle">
          {{ availableDates.length }} 个交易日数据
        </span>
      </div>
      <div class="header-actions">
        <input
          type="date"
          v-model="selectedDate"
          class="date-input"
          :max="new Date().toISOString().split('T')[0]"
        />
        <button
          class="btn btn-outline"
          @click="triggerCompute"
          :disabled="computing"
        >
          {{ computing ? '计算中...' : '重新计算' }}
        </button>
      </div>
    </div>

    <div class="mode-bar">
      <button
        class="mode-btn"
        :class="{ active: mode === 'metric' }"
        @click="switchMode('metric')"
      >指标排行</button>
      <button
        class="mode-btn"
        :class="{ active: mode === 'strategy' }"
        @click="switchMode('strategy')"
      >策略评分</button>
    </div>

    <div v-if="mode === 'metric'" class="metric-grid">
      <button
        v-for="m in metrics"
        :key="m.key"
        class="metric-card"
        :class="{ active: selectedMetric === m.key }"
        @click="selectedMetric = m.key"
      >
        <span class="metric-icon">{{ m.icon }}</span>
        <div class="metric-info">
          <span class="metric-label">{{ m.label }}</span>
          <span class="metric-desc">{{ m.desc }}</span>
        </div>
        <span class="metric-sort">{{ m.sort === 'asc' ? '↑' : '↓' }}</span>
      </button>
    </div>

    <div v-if="mode === 'strategy'" class="strategy-bar">
      <button
        v-for="s in strategies"
        :key="s.key"
        class="strategy-btn"
        :class="{ active: selectedStrategy === s.key }"
        @click="selectedStrategy = s.key"
        :title="s.desc"
      >{{ s.label }}</button>
    </div>

    <div class="controls-row">
      <div class="board-tabs">
        <button
          v-for="b in boards"
          :key="b.key"
          class="board-btn"
          :class="{ active: selectedBoard === b.key }"
          @click="selectedBoard = b.key"
        >{{ b.label }}</button>
      </div>
      <div class="search-box">
        <input
          v-model="searchQuery"
          placeholder="搜索代码/名称..."
          class="search-input"
        />
      </div>
    </div>

    <div v-if="mode === 'strategy' && currentStrategy" class="strategy-desc">
      {{ currentStrategy.desc }}
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="loading && !data" class="loading-state">
      <div class="spinner"></div>
      <p>加载中...</p>
    </div>

    <div v-else-if="data && !data.hasData && !loading" class="empty-state">
      <p class="empty-icon">📅</p>
      <p>{{ selectedDate }} 暂无数据</p>
      <p class="hint">每个交易日 15:30 后自动计算，或点击右上角「重新计算」</p>
    </div>

    <template v-else-if="data">
      <div class="table-header">
        <div class="total-stocks">
          共 <strong>{{ data.total }}</strong> 只股票
          <span v-if="searchQuery" class="filtered-hint">
            ，筛选后 <strong>{{ filteredRankings.length }}</strong> 只
          </span>
        </div>
      </div>

      <div class="table-wrap">
        <table class="rank-table">
          <thead>
            <tr v-if="mode === 'metric'">
              <th class="col-rank">#</th>
              <th class="col-name">股票</th>
              <th class="col-value">{{ currentMetric.label }}</th>
              <th class="col-extra">涨跌幅</th>
              <th class="col-extra">RSI</th>
              <th class="col-extra">量比</th>
              <th class="col-extra">动量</th>
            </tr>
            <tr v-if="mode === 'strategy'">
              <th class="col-rank">#</th>
              <th class="col-name">股票</th>
              <th class="col-score">评分</th>
              <th class="col-extra">涨跌幅</th>
              <th class="col-extra">RSI</th>
              <th class="col-extra">量比</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRankings"
              :key="row.code"
              class="rank-row"
              @click="viewStock(row.code)"
            >
              <td class="col-rank">
                <span v-if="row.rank <= 3" class="medal">{{ ['🥇','🥈','🥉'][row.rank - 1] }}</span>
                <span v-else class="rank-num">{{ row.rank }}</span>
              </td>
              <td class="col-name">
                <div class="stock-cell">
                  <span class="stock-name">{{ row.name }}</span>
                  <div class="stock-meta">
                    <span class="stock-code">{{ row.code }}</span>
                    <span class="stock-board" :class="'board-' + row.board">{{ boardLabel(row.board) }}</span>
                  </div>
                </div>
              </td>
              <td v-if="mode === 'metric'" class="col-value">
                <span class="metric-val" :class="valueColor(row.value, selectedMetric)">
                  {{ formatValue(row.value, selectedMetric) }}
                </span>
              </td>
              <td v-if="mode === 'strategy'" class="col-score">
                <div class="score-row">
                  <div class="score-bar-wrap">
                    <div
                      class="score-bar"
                      :class="scoreColor(row.score)"
                      :style="{ width: Math.min(row.score, 100) + '%' }"
                    ></div>
                  </div>
                  <span class="score-num" :class="scoreColor(row.score)">{{ row.score }}</span>
                </div>
              </td>
              <td class="col-extra">
                <span :class="valueColor(row.changePct, 'change_pct')">
                  {{ row.changePct != null ? (row.changePct >= 0 ? '+' : '') + row.changePct.toFixed(2) + '%' : '--' }}
                </span>
              </td>
              <td class="col-extra">
                <span :class="valueColor(row.rsi, 'rsi')">
                  {{ row.rsi != null ? row.rsi.toFixed(1) : '--' }}
                </span>
              </td>
              <td class="col-extra">
                <span>{{ row.volRatio != null ? row.volRatio.toFixed(2) + 'x' : '--' }}</span>
              </td>
              <td v-if="mode === 'metric'" class="col-extra">
                <span :class="valueColor(row.momentum, 'momentum')">
                  {{ formatValue(row.momentum, 'momentum') }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rankings-view {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}
.header-left { display: flex; align-items: baseline; gap: 8px; }
.header-left h1 { font-size: 20px; font-weight: 700; margin: 0; }
.header-subtitle { font-size: 12px; color: var(--text-tertiary, #888); }
.header-actions { display: flex; gap: 8px; align-items: center; }

.date-input {
  background: var(--bg-secondary, #1a1a2e);
  border: 1px solid var(--border-color, #2a2a3e);
  color: var(--text-primary);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-family: monospace;
}

.btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition: opacity .15s;
}
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-outline {
  background: transparent;
  border: 1px solid var(--border-color, #2a2a3e);
  color: var(--text-primary);
}
.btn-outline:hover { border-color: var(--accent, #3b82f6); }

.mode-bar {
  display: flex;
  gap: 2px;
  background: var(--bg-secondary, #1a1a2e);
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 12px;
}
.mode-btn {
  flex: 1;
  padding: 7px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary, #999);
  transition: all .15s;
}
.mode-btn.active {
  background: var(--accent, #3b82f6);
  color: #fff;
}

.metric-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.metric-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #2a2a3e);
  background: var(--bg-secondary, #1a1a2e);
  cursor: pointer;
  transition: all .15s;
  font-size: 12px;
  color: var(--text-primary);
  flex: 1 0 auto;
  max-width: 200px;
}
.metric-card:hover { border-color: var(--accent, #3b82f6); }
.metric-card.active {
  border-color: var(--accent, #3b82f6);
  background: rgba(59,130,246,.1);
}
.metric-icon { font-size: 14px; }
.metric-info { flex: 1; min-width: 0; }
.metric-label { font-weight: 600; font-size: 12px; display: block; }
.metric-desc { font-size: 10px; color: var(--text-tertiary, #888); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.metric-sort { font-size: 10px; color: var(--text-tertiary, #888); }

.strategy-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 10px;
}
.strategy-btn {
  padding: 6px 14px;
  border-radius: 16px;
  border: 1px solid var(--border-color, #2a2a3e);
  background: var(--bg-secondary, #1a1a2e);
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
  transition: all .15s;
}
.strategy-btn:hover { border-color: var(--accent, #3b82f6); }
.strategy-btn.active {
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: #fff;
  border-color: transparent;
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.board-tabs { display: flex; gap: 2px; background: var(--bg-secondary, #1a1a2e); border-radius: 6px; padding: 2px; }
.board-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary, #999);
  transition: all .15s;
}
.board-btn.active { background: var(--accent, #3b82f6); color: #fff; }

.search-box { flex: 1; min-width: 120px; }
.search-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-secondary, #1a1a2e);
  border: 1px solid var(--border-color, #2a2a3e);
  color: var(--text-primary);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-family: monospace;
}
.search-input:focus { outline: none; border-color: var(--accent, #3b82f6); }

.strategy-desc {
  font-size: 12px;
  color: var(--text-tertiary, #888);
  padding: 6px 0;
  margin-bottom: 6px;
}

.error-banner {
  background: rgba(239,68,68,.1);
  color: #ef4444;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 10px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px;
  color: var(--text-tertiary, #888);
  gap: 8px;
}
.spinner {
  width: 24px; height: 24px;
  border: 2px solid var(--border-color, #2a2a3e);
  border-top-color: var(--accent, #3b82f6);
  border-radius: 50%;
  animation: spin .6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary, #888);
}
.empty-icon { font-size: 32px; margin: 0 0 8px; }
.hint { font-size: 12px; margin-top: 4px; color: var(--text-tertiary, #666); }

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-tertiary, #888);
}
.filtered-hint { color: var(--text-secondary, #aaa); }

.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 8px;
  border: 1px solid var(--border-color, #2a2a3e);
}

.rank-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 600px;
}

.rank-table th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-tertiary, #888);
  border-bottom: 1px solid var(--border-color, #2a2a3e);
  position: sticky;
  top: 0;
  background: var(--bg-primary, #0f0f1a);
}

.rank-row {
  cursor: pointer;
  transition: background .15s;
}
.rank-row:hover { background: rgba(59,130,246,.04); }
.rank-row td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #1a1a2e);
  vertical-align: middle;
}

.col-rank { width: 40px; }
.col-name { min-width: 140px; }
.col-value { width: 100px; }
.col-score { width: 120px; }
.col-extra { width: 80px; text-align: right; }

.medal { font-size: 16px; }
.rank-num {
  font-weight: 700;
  color: var(--text-secondary, #999);
  font-family: monospace;
}

.stock-cell { display: flex; flex-direction: column; gap: 2px; }
.stock-name { font-weight: 600; font-size: 13px; line-height: 1.3; }
.stock-meta { display: flex; gap: 6px; align-items: center; font-size: 11px; }
.stock-code { font-family: monospace; color: var(--text-tertiary, #888); }
.stock-board {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-secondary, #1a1a2e);
}
.board-hsb { color: #3b82f6; }
.board-kcb { color: #8b5cf6; }
.board-cyb { color: #22c55e; }

.metric-val { font-weight: 700; font-family: monospace; }

.text-danger { color: #ef4444; }
.text-success { color: #22c55e; }
.text-warning { color: #f59e0b; }

.score-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.score-bar-wrap {
  flex: 1;
  height: 8px;
  background: var(--bg-primary, #0f0f1a);
  border-radius: 4px;
  overflow: hidden;
}
.score-bar {
  height: 100%;
  border-radius: 4px;
  transition: width .3s ease;
}
.score-a { background: linear-gradient(90deg, #22c55e, #16a34a); }
.score-b { background: linear-gradient(90deg, #3b82f6, #2563eb); }
.score-c { background: linear-gradient(90deg, #f59e0b, #d97706); }
.score-d { background: linear-gradient(90deg, #f97316, #ea580c); }
.score-e { background: linear-gradient(90deg, #ef4444, #dc2626); }

.score-num {
  font-weight: 700;
  font-family: monospace;
  min-width: 28px;
  text-align: right;
  font-size: 13px;
}

@media (min-width: 768px) {
  .rankings-view { padding: 24px 32px; }
}

@media (max-width: 640px) {
  .page-header h1 { font-size: 17px; }
  .header-actions { width: 100%; }
  .header-actions .date-input { flex: 1; }
  .metric-grid { gap: 4px; }
  .metric-card { max-width: none; flex: 1 1 calc(50% - 4px); }
  .metric-desc { display: none; }
  .controls-row { flex-direction: column; align-items: stretch; }
  .board-tabs { justify-content: center; }
  .rank-table { font-size: 12px; min-width: 500px; }
  .rank-table th, .rank-row td { padding: 8px 8px; }
  .col-extra:nth-child(n+5) { display: none; }
}
</style>
