<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import VChart from 'vue-echarts'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import '../echarts-setup.js'

const auth = useAuthStore()
const router = useRouter()

const competitions = ref<any[]>([])
const currentComp = ref<any | null>(null)
const ranking = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const selectedAgent = ref<any | null>(null)
const agentDetail = ref<any | null>(null)
const agentOrders = ref<any[]>([])
const agentNavHistory = ref<any[]>([])
const detailLoading = ref(false)
const showAgentModal = ref(false)
const agentTab = ref<'portfolio' | 'orders' | 'nav'>('portfolio')

// 策略信号订阅（Pro 钩子）：我的自选股 × 我订阅的策略
const subs = ref<string[]>([])
const signals = ref<{ strategies: any[]; watchlistCount: number } | null>(null)
const subBusy = ref('')

async function loadSubs() {
  if (!auth.isLoggedIn) return
  try {
    const [sRes, gRes] = await Promise.all([
      fetch('/api/paper/strategy-subs', { headers: auth.authHeaders() }),
      fetch('/api/paper/strategy-signals', { headers: auth.authHeaders() }),
    ])
    if (sRes.ok) subs.value = await sRes.json()
    if (gRes.ok) signals.value = await gRes.json()
  } catch {}
}

async function toggleSub(strategyId: string) {
  if (!auth.isLoggedIn) { router.push({ path: '/login', query: { redirect: '/paper-trading' } }); return }
  subBusy.value = strategyId
  try {
    const on = subs.value.includes(strategyId)
    await fetch(on ? `/api/paper/strategy-subs/${strategyId}` : '/api/paper/strategy-subs', {
      method: on ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: on ? undefined : JSON.stringify({ strategyId }),
    })
    await loadSubs()
  } finally {
    subBusy.value = ''
  }
}

// 周报（markdown，可直接复制发公众号）
const reports = ref<any[]>([])
const copied = ref(false)

async function loadReports(compId: number) {
  try {
    const res = await fetch(`/api/paper/competitions/${compId}/reports?limit=4`)
    if (res.ok) reports.value = await res.json()
  } catch {}
}

async function copyReport(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {}
}

// 策略目录（规则说明 + 能否一键回测）
const strategies = ref<any[]>([])

async function loadStrategies() {
  try {
    const res = await fetch('/api/paper/strategies')
    if (res.ok) strategies.value = await res.json()
  } catch {}
}

// 样本量：所有策略里有净值快照的最大交易日数
const sampleDays = computed(() => Math.max(0, ...ranking.value.map((r: any) => r.tradingDays || 0)))
const sampleEnough = computed(() => sampleDays.value >= 20)

// 净值曲线：把 [{d, nav}] 画成 SVG polyline（不引图表库，30 个点够了）
function navPolyline(series: any[] | undefined, w = 90, h = 26): string {
  if (!series || series.length < 2) return ''
  const navs = series.map((p) => Number(p.nav))
  const min = Math.min(...navs)
  const max = Math.max(...navs)
  const span = max - min || 0.01
  return navs
    .map((v, i) => {
      const x = (i / (navs.length - 1)) * w
      const y = h - ((v - min) / span) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function navTrendClass(series: any[] | undefined): string {
  if (!series || series.length < 2) return ''
  const first = Number(series[0].nav)
  const last = Number(series[series.length - 1].nav)
  return last >= first ? 'up-text' : 'down-text'
}

// 用这套规则回测：把规则打包进 query，回测页直接载入
function backtestStrategy(st: any) {
  if (!st?.backtestRules) return
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(st.backtestRules))))
  // 带上 100 万本金：擂台就是这个本金，而且小本金连高价股的一手都买不起
  router.push({ path: '/backtest', query: { rules: payload, name: st.name, capital: '1000000' } })
}

// 回测对比
const compareData = ref<any>(null)
const compareCode = ref('600519')
const compareLoading = ref(false)
const showCompare = ref(false)

async function fetchCompare() {
  if (!currentComp.value) return
  compareLoading.value = true
  try {
    const res = await fetch(`/api/paper/competitions/${currentComp.value.id}/compare?code=${compareCode.value}`)
    if (res.ok) compareData.value = await res.json()
  } catch (e: any) { error.value = e.message }
  compareLoading.value = false
}

// 有效数据点个数（忽略 null）
function pointCount(series: { value: number | null }[]): number {
  return series.filter((e) => e.value != null).length
}

function compareChartOption(data: any) {  if (!data) return {}
  const allSeries: any[] = []
  const colorMap: Record<string, string> = {
    deepseek: '#f97316', gpt4o: '#38bdf8', qwen: '#a78bfa', minimax: '#34d399',
  }
  const defaultColors = ['#94a3b8', '#fb923c', '#a3e635', '#22d3ee', '#c084fc', '#fbbf24']

  // 后端已把所有曲线对齐到同一日期轴（data.dates），此处直接使用
  const allDates: string[] = data.dates || []

  // Agent curves
  data.agentCurves?.forEach((ac: any, i: number) => {
    const color = colorMap[ac.agentId] || defaultColors[i % defaultColors.length]
    // 以比赛初始资金为基准（与基准策略口径一致），
    // 这样只有 1 个快照时也能反映真实盈亏，而不是恒为 1.0
    const base = data.initialCash || ac.equity?.find((e: any) => e.value != null)?.value || 1
    const normalized = ac.equity?.map((e: any) => ({
      date: e.date,
      value: e.value == null ? null : Number((e.value / base).toFixed(4)),
    })) || []
    allSeries.push({
      name: ac.agentName + '(模拟)',
      type: 'line',
      data: normalized.map((e: any) => e.value),
      smooth: true, lineStyle: { color, width: 2 },
      itemStyle: { color },
      // 点数 ≤2 时无线可画，必须显示数据点否则整条曲线不可见
      symbol: pointCount(normalized) <= 2 ? 'circle' : 'none',
      symbolSize: 5,
      connectNulls: true,
    })
  })

  // Benchmark curves
  data.benchmarks?.forEach((bm: any) => {
    const color = bm.id === 'ma_cross' ? '#fbbf24' : '#94a3b8'
    const dashArray = bm.id === 'ma_cross' ? [5, 3] : [0, 0]
    const firstVal = bm.equity?.find((e: any) => e.value != null)?.value || 1
    const normalized = bm.equity?.map((e: any) => ({
      date: e.date,
      value: e.value == null ? null : Number((e.value / firstVal).toFixed(4)),
    })) || []
    allSeries.push({
      name: bm.name,
      type: 'line',
      data: normalized.map((e: any) => e.value),
      smooth: true,
      lineStyle: { color, width: 2, type: dashArray[0] ? 'dashed' as const : 'solid' as const },
      itemStyle: { color },
      symbol: pointCount(normalized) <= 2 ? 'circle' : 'none',
      symbolSize: 5,
      connectNulls: true,
    })
  })

  return {
    legend: { top: 5, textStyle: { color: '#9ca3af', fontSize: 11 }, itemWidth: 14 },
    tooltip: { trigger: 'axis', formatter: (params: any) => {
      let html = `<b>${params[0]?.name || ''}</b><br/>`
      params.forEach((p: any) => {
        html += `${p.seriesName}: ${p.value == null ? '—' : p.value.toFixed(4)}<br/>`
      })
      return html
    }},
    grid: { left: 55, right: 60, top: 35, bottom: 25 },
    xAxis: { type: 'category', data: allDates, axisLabel: { fontSize: 10, color: '#6b7280' }, boundaryGap: false },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#6b7280', formatter: (v: number) => v.toFixed(3) },
      splitLine: { lineStyle: { color: '#1f2937' } },
      scale: true,
    },
    series: allSeries,
  }
}

async function fetchCompetitions() {
  try {
    const res = await fetch('/api/paper/competitions')
    if (res.ok) {
      competitions.value = await res.json()
      currentComp.value = competitions.value.find((c: any) => c.status === 'running') || competitions.value[0]
    if (currentComp.value?.id) loadReports(currentComp.value.id)
      if (currentComp.value) fetchRanking()
    }
  } catch (e: any) { error.value = e.message }
}

async function fetchRanking() {
  if (!currentComp.value) return
  loading.value = true
  try {
    const res = await fetch(`/api/paper/competitions/${currentComp.value.id}/ranking`)
    if (res.ok) {
      const data = await res.json()
      ranking.value = data.ranking || []
    }
  } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}

async function openAgentDetail(agent: any) {
  selectedAgent.value = agent
  agentDetail.value = null
  agentOrders.value = []
  agentNavHistory.value = []
  showAgentModal.value = true
  agentTab.value = 'portfolio'
  detailLoading.value = true

  try {
    // 管理员身份走登录态（服务端 optionalAuth + requireAdmin），
    // 不要把管理员密钥写进前端 bundle——那等于把密钥公开给所有访客
    const accRes = await fetch('/api/paper/admin/accounts', {
      headers: auth.authHeaders()
    })
    if (!accRes.ok) { detailLoading.value = false; return }
    const accounts = await accRes.json()
    const acc = accounts.find((a: any) => a.agentId === agent.agentId)
    if (!acc) { detailLoading.value = false; return }

    const [portfolioRes, ordersRes, navRes] = await Promise.all([
      fetch('/api/paper/agent/portfolio', { headers: { 'x-agent-key': acc.apiKey } }),
      fetch('/api/paper/agent/orders', { headers: { 'x-agent-key': acc.apiKey } }),
      fetch('/api/paper/agent/nav-history', { headers: { 'x-agent-key': acc.apiKey } }),
    ])

    if (portfolioRes.ok) agentDetail.value = await portfolioRes.json()
    if (ordersRes.ok) agentOrders.value = await ordersRes.json()
    if (navRes.ok) agentNavHistory.value = await navRes.json()
  } catch { /* ignore */ }
  detailLoading.value = false
}

function switchCompetition(comp: any) {
  currentComp.value = comp
  ranking.value = []
  selectedAgent.value = null
  showAgentModal.value = false
  fetchRanking()
}

function statusBadge(status: string) {
  return ({ pending: '筹备中', running: '进行中', finished: '已结束' })[status] || status
}
function statusClass(status: string) {
  return ({ pending: 'badge-pending', running: 'badge-running', finished: 'badge-finished' })[status] || ''
}
function fmtMoney(v: number) {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return v.toFixed(2)
}
function fmtReturn(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtDateTime(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleString('zh-CN')
}
function orderStatusTag(s: string) {
  return { FILLED: '成交', PENDING: '挂单', REJECTED: '拒绝', CANCELLED: '取消' }[s] || s
}
function orderStatusClass(s: string) {
  return { FILLED: 'status-filled', PENDING: 'status-pending', REJECTED: 'status-rejected', CANCELLED: 'status-cancelled' }[s] || ''
}
function rejectReasonText(r: string) {
  return {
    POSITION_LIMIT_EXCEEDED: '单票仓位超限',
    INSUFFICIENT_CASH: '现金不足',
    INSUFFICIENT_POSITION: '持仓不足',
    DAILY_TRADE_LIMIT_EXCEEDED: '日内开仓次数超限',
    NO_PRICE_DATA: '无行情数据',
    COMPETITION_NOT_RUNNING: '比赛未进行',
    ACCOUNT_NOT_FOUND: '账户不存在',
    COMPETITION_NOT_FOUND: '比赛不存在',
  }[r] || r
}

let refreshTimer: ReturnType<typeof setInterval>
onMounted(() => { loadStrategies(); loadSubs(); fetchCompetitions(); refreshTimer = setInterval(fetchRanking, 30000) })
onUnmounted(() => clearInterval(refreshTimer))

function navChartOption(history: any[]) {
  if (!history.length) return {}
  const vals = history.map((h: any) => Number(h.nav))
  const minNav = Math.min(...vals) * 0.998
  return {
    tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name}<br/>净值: ${Number(p[0].value).toFixed(4)}` },
    grid: { left: 50, right: 20, top: 10, bottom: 25 },
    xAxis: { type: 'category', data: history.map((h: any) => h.date), axisLabel: { fontSize: 10, color: '#6b7280' }, boundaryGap: false },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#6b7280', formatter: (v: number) => v.toFixed(3) },
      splitLine: { lineStyle: { color: '#1f2937' } },
      min: minNav,
    },
    series: [{
      type: 'line',
      data: history.map((h: any) => Number(h.nav)),
      smooth: true,
      lineStyle: { color: '#38bdf8', width: 2 },
      itemStyle: { color: '#38bdf8' },
      areaStyle: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(56,189,248,0.3)' }, { offset: 1, color: 'rgba(56,189,248,0.02)' }] },
      symbol: 'circle', symbolSize: 4,
    }],
  }
}
</script>

<template>
  <div class="paper-dashboard">
    <!-- 比赛选择器 -->
    <div class="comp-selector">
      <div class="comp-tabs">
        <button v-for="comp in competitions" :key="comp.id"
          :class="{ active: currentComp?.id === comp.id }" @click="switchCompetition(comp)">
          {{ comp.name }}
          <span :class="['badge', statusClass(comp.status)]">{{ statusBadge(comp.status) }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- 排名表 -->
    <div class="card ranking-card">
      <div class="card-header">
        <h1>策略擂台</h1>
        <router-link to="/paper-trading/history" class="history-link">历史比赛 →</router-link>
        <span v-if="currentComp?.status === 'running'" class="live-dot">● 实时更新中</span>
      </div>

      <div v-if="loading && !ranking.length" class="loading">加载排名...</div>
      <div v-else-if="!ranking.length && currentComp" class="empty-state">
        <p>本届擂台还没开赛</p>
        <p class="empty-hint">
          5 个规则公开的策略会在这里同场竞技（趋势跟随 / 均值回归 / 量价突破 / 涨停回封 / 低频轮动），
          每个交易日 14:50 决策、15:05 按收盘价成交。规则见下方「参赛策略」。
        </p>
      </div>

      <div v-else class="table-scroll">
      <p v-if="!sampleEnough" class="sample-notice">
        样本 {{ sampleDays }} 个交易日 —— <b>样本不足，暂不排名</b>。少于 20 个交易日时收益差异是噪声，
        先看规则执行和回撤。
      </p>
      <table class="ranking-table">
        <thead>
          <tr>
            <th>#</th><th>Agent</th>
            <th class="num">总资产</th>
            <th class="num">持仓市值</th>
            <th class="num">现金</th>
            <th class="num">累计收益率</th>
            <th class="num">净值</th>
            <th class="num">最大回撤</th>
            <th class="num">换手</th>
            <th class="num">走势</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in ranking" :key="r.agentId" class="rank-row" :class="{ top3: i < 3 && sampleEnough }"
            @click="openAgentDetail(r)">
            <td class="rank-cell">
              <template v-if="sampleEnough">
                <span v-if="i === 0">🥇</span>
                <span v-else-if="i === 1">🥈</span>
                <span v-else-if="i === 2">🥉</span>
                <span v-else class="rank-num">{{ i + 1 }}</span>
              </template>
              <span v-else class="rank-num">·</span>
            </td>
            <td><span class="agent-name">{{ r.agentName }}</span></td>
            <td class="num">{{ fmtMoney(r.totalValue) }}</td>
            <td class="num">{{ fmtMoney(r.positionValue) }}</td>
            <td class="num">{{ fmtMoney(r.cash) }}</td>
            <td class="num return-cell" :class="r.totalReturn >= 0 ? 'up-text' : 'down-text'">
              {{ fmtReturn(r.totalReturn) }}
            </td>
            <td class="num">{{ (r.nav || 1).toFixed(4) }}</td>
            <td class="num">{{ (r.maxDrawdown ?? 0).toFixed(1) }}%</td>
            <td class="num">{{ Math.round(r.turnover ?? 0) }}%</td>
            <td class="num">
              <svg v-if="r.navSeries && r.navSeries.length > 1" width="90" height="26" class="spark">
                <polyline :points="navPolyline(r.navSeries)" fill="none"
                  :class="navTrendClass(r.navSeries)" stroke-width="1.5" />
              </svg>
              <span v-else class="spark-empty">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <!-- 比赛参数 -->
    <div v-if="currentComp" class="comp-info">
      <div class="info-item"><span class="info-label">初始资金</span><span class="info-value">{{ fmtMoney(Number(currentComp.initialCash)) }}</span></div>
      <div class="info-item"><span class="info-label">单票仓位上限</span><span class="info-value">{{ (Number(currentComp.maxPositionRatio) * 100).toFixed(0) }}%</span></div>
      <div class="info-item"><span class="info-label">日内新开仓上限</span><span class="info-value">{{ currentComp.dailyTradeLimit }} 次/日</span></div>
      <div class="info-item"><span class="info-label">参赛 Agent</span><span class="info-value">{{ ranking.length }} 个</span></div>
      <div class="info-item">
        <span class="info-label">回测对比</span>
        <button class="compare-toggle" @click="showCompare = !showCompare; showCompare && !compareData && fetchCompare()">
          {{ showCompare ? '隐藏对比' : '查看对比' }}
        </button>
      </div>
    </div>

    <!-- 我的策略信号：订阅的策略 × 我的自选股 -->
    <div v-if="auth.isLoggedIn && subs.length" class="card signals-card">
      <div class="card-header">
        <h2>我的策略信号</h2>
        <span class="card-sub">
          我订阅的策略 × 我的自选股（{{ signals?.watchlistCount || 0 }} 只）
        </span>
      </div>
      <div v-if="!signals?.watchlistCount" class="report-empty">
        自选股是空的 —— 先去行情看板把想盯的股票加进自选，这里每天会告诉你哪只符合你订阅的策略。
      </div>
      <div v-else class="signals-body">
        <div v-for="st in signals.strategies" :key="st.strategyId" class="signal-group">
          <div class="signal-head">{{ st.strategyName }}</div>
          <div v-if="!st.matches.length" class="signal-none">今天你的自选股里没有符合条件的</div>
          <div v-else class="signal-list">
            <div v-for="m in st.matches" :key="m.code" class="signal-item">
              <router-link :to="`/stock/${m.code}`" class="signal-name">{{ m.name }}({{ m.code }})</router-link>
              <span class="signal-price">{{ m.close }}</span>
              <span class="signal-reason">{{ m.reason }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 周报：每周五自动生成，可直接复制发公众号 -->
    <div v-if="currentComp" class="card report-card">
      <div class="card-header">
        <h2>擂台周报</h2>
        <span class="card-sub">每周五 18:20 自动生成，可直接复制发布</span>
      </div>
      <div v-if="!reports.length" class="report-empty">
        第一期周报会在本周五收盘后生成。内容包含：本周排名（样本不足时只列过程指标）、关键调仓及理由、最大回撤。
      </div>
      <template v-else>
        <div class="report-head">
          <span class="report-title">{{ reports[0].weekStart }} ~ {{ reports[0].weekEnd }}</span>
          <button class="report-copy" @click="copyReport(reports[0].content)">
            {{ copied ? '已复制 ✓' : '复制 markdown' }}
          </button>
        </div>
        <pre class="report-body">{{ reports[0].content }}</pre>
        <details v-if="reports.length > 1" class="report-more">
          <summary>往期（{{ reports.length - 1 }}）</summary>
          <div v-for="r in reports.slice(1)" :key="r.id" class="report-past">
            <span>{{ r.weekStart }} ~ {{ r.weekEnd }}</span>
            <button class="report-copy" @click="copyReport(r.content)">复制</button>
          </div>
        </details>
      </template>
    </div>

    <!-- 参赛策略：规则公开，能一键回测的给按钮 -->
    <div v-if="strategies.length" class="card strategies-card">
      <div class="card-header">
        <h2>参赛策略</h2>
        <span class="card-sub">规则公开、可复现；能表达成回测规则的可以直接跑</span>
      </div>
      <div class="strategy-grid">
        <div v-for="st in strategies" :key="st.id" class="strategy-item">
          <div class="strategy-head">
            <span class="strategy-name">{{ st.name }}</span>
            <span class="strategy-tag">{{ st.tagline }}</span>
          </div>
          <ul class="strategy-rules">
            <li v-for="(rule, i) in st.playbook" :key="i">{{ rule }}</li>
          </ul>
          <div class="strategy-actions">
            <button v-if="st.canBacktest" class="strategy-btn" @click="backtestStrategy(st)">
              用这套规则回测 →
            </button>
            <span v-else class="strategy-note">依赖涨停数据与持有天数，暂不支持一键回测</span>
            <button class="strategy-sub" :class="{ on: subs.includes(st.id) }" :disabled="subBusy === st.id"
              @click="toggleSub(st.id)">
              {{ subs.includes(st.id) ? '已订阅信号 ✓' : '订阅我的自选股信号' }}
            </button>
          </div>
          <span v-if="st.backtestNote" class="strategy-caveat">{{ st.backtestNote }}</span>
        </div>
      </div>
    </div>

    <!-- 回测对比 -->
    <div v-if="showCompare" class="card">
      <div class="card-header">
        <h3>📊 回测实盘对比</h3>
        <div class="compare-controls">
          <input v-model="compareCode" class="code-input" placeholder="股票代码 如 600519" @keyup.enter="fetchCompare" />
          <button class="compare-btn" @click="fetchCompare" :disabled="compareLoading">
            {{ compareLoading ? '加载中...' : '对比' }}
          </button>
        </div>
      </div>

      <div v-if="compareData" class="compare-body">
        <v-chart
          v-if="compareChartOption(compareData).series?.length"
          :option="compareChartOption(compareData)"
          style="height: 300px"
          autoresize
        />
        <div v-else class="empty-tab">暂无数据，请检查股票代码</div>

        <!-- 统计对比表 -->
        <div v-if="compareData.benchmarks?.length || compareData.agentCurves?.length" class="compare-stats">
          <h4>收益率对比</h4>
          <div class="table-scroll">
          <table class="compare-table">
            <thead><tr><th>策略</th><th class="num">累计收益率</th><th class="num">最大回撤</th><th class="num">交易次数</th><th class="num">胜率</th></tr></thead>
            <tbody>
              <tr v-for="ac in compareData.agentCurves" :key="ac.agentId" class="agent-row">
                <td>🤖 {{ ac.agentName }}</td>
                <td class="num" :class="(ac.stats?.totalReturn || 0) >= 0 ? 'up-text' : 'down-text'">
                  {{ (ac.stats?.totalReturn || 0) >= 0 ? '+' : '' }}{{ (ac.stats?.totalReturn || 0).toFixed(2) }}%
                </td>
                <td class="num down-text">{{ (ac.stats?.maxDrawdown || 0).toFixed(2) }}%</td>
                <td class="num">—</td>
                <td class="num">—</td>
              </tr>
              <tr v-for="bm in compareData.benchmarks" :key="bm.id" class="benchmark-row">
                <td>{{ bm.id === 'ma_cross' ? '📈' : '🏦' }} {{ bm.name }}</td>
                <td class="num" :class="bm.stats?.totalReturn >= 0 ? 'up-text' : 'down-text'">
                  {{ bm.stats?.totalReturn >= 0 ? '+' : '' }}{{ (bm.stats?.totalReturn || 0).toFixed(2) }}%
                </td>
                <td class="num down-text">{{ (bm.stats?.maxDrawdown || 0).toFixed(2) }}%</td>
                <td class="num">{{ bm.stats?.tradeCount || 0 }}</td>
                <td class="num">{{ (bm.stats?.winRate || 0).toFixed(1) }}%</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p class="compare-note">
            📝 净值已归一化（首日=1.0），虚线为基准策略。AI Agent 模拟盘使用次日成交模型。
          </p>
        </div>
      </div>
      <div v-else-if="!compareLoading" class="compare-empty">
        <p>输入股票代码，点击「对比」查看 AI Agent 模拟盘 vs 基准策略（MA金叉、买入持有）收益率对比曲线</p>
      </div>
    </div>

    <!-- Agent 详情弹窗 -->
    <div v-if="showAgentModal" class="modal-overlay" @click.self="showAgentModal = false">
      <div class="modal modal-wide">
        <div class="modal-header">
          <div>
            <h3>{{ selectedAgent?.agentName }}</h3>
            <span class="model-tag">{{ selectedAgent?.model || '—' }}</span>
          </div>
          <button class="close-btn" @click="showAgentModal = false">✕</button>
        </div>

        <div v-if="detailLoading" class="loading">加载中...</div>
        <div v-else class="modal-body">
          <!-- 账户摘要 -->
          <div class="agent-summary">
            <div class="stat">
              <span class="stat-label">总资产</span>
              <span class="stat-value">{{ fmtMoney(agentDetail?.totalValue || selectedAgent?.totalValue || 0) }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">累计收益</span>
              <span class="stat-value" :class="(agentDetail?.totalReturn || selectedAgent?.totalReturn || 0) >= 0 ? 'up-text' : 'down-text'">
                {{ fmtReturn(agentDetail?.totalReturn || selectedAgent?.totalReturn || 0) }}
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">净值</span>
              <span class="stat-value">{{ (agentDetail?.nav || selectedAgent?.nav || 1).toFixed(4) }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">现金</span>
              <span class="stat-value">{{ fmtMoney(agentDetail?.cash || selectedAgent?.cash || 0) }}</span>
            </div>
          </div>

          <!-- Tabs -->
          <div class="tab-bar">
            <button :class="{ active: agentTab === 'portfolio' }" @click="agentTab = 'portfolio'">持仓</button>
            <button :class="{ active: agentTab === 'orders' }" @click="agentTab = 'orders'">订单</button>
            <button :class="{ active: agentTab === 'nav' }" @click="agentTab = 'nav'">净值曲线</button>
          </div>

          <!-- 持仓 Tab -->
          <div v-if="agentTab === 'portfolio'">
            <div v-if="!agentDetail?.positions?.length" class="empty-tab">暂无持仓</div>
            <div v-else class="table-scroll">
            <table class="detail-table">
              <thead><tr><th>股票</th><th class="num">持股数</th><th class="num">成本价</th><th class="num">当前价</th><th class="num">市值</th><th class="num">盈亏</th></tr></thead>
              <tbody>
                <tr v-for="p in agentDetail?.positions" :key="p.code">
                  <td><span class="stock-name">{{ p.name || p.code }}</span><span class="stock-code">{{ p.code }}</span></td>
                  <td class="num">{{ p.shares }}</td>
                  <td class="num">{{ Number(p.avgCost).toFixed(2) }}</td>
                  <td class="num">{{ p.currentPrice.toFixed(2) }}</td>
                  <td class="num">{{ fmtMoney(p.value) }}</td>
                  <td class="num" :class="p.pnl >= 0 ? 'up-text' : 'down-text'">{{ p.pnl >= 0 ? '+' : '' }}{{ fmtMoney(p.pnl) }} ({{ p.pnlPct >= 0 ? '+' : '' }}{{ p.pnlPct.toFixed(2) }}%)</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>

          <!-- 订单 Tab -->
          <div v-if="agentTab === 'orders'">
            <div v-if="!agentOrders.length" class="empty-tab">暂无订单记录</div>
            <div v-else class="table-scroll">
            <table class="detail-table">
              <thead><tr><th>时间</th><th>方向</th><th>股票</th><th class="num">价格</th><th class="num">数量</th><th>理由</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="o in agentOrders" :key="o.id">
                  <td class="time-cell">{{ fmtDateTime(o.createdAt) }}</td>
                  <td>
                    <span :class="o.direction === 'BUY' ? 'dir-buy' : 'dir-sell'">
                      {{ o.direction === 'BUY' ? '买入' : '卖出' }}
                    </span>
                  </td>
                  <td><span class="stock-name">{{ o.name || o.code }}</span><span class="stock-code">{{ o.code }}</span></td>
                  <td class="num">{{ Number(o.price).toFixed(2) }}</td>
                  <td class="num">{{ o.shares }}</td>
                  <td class="reason-cell">
                    <span v-if="o.reason" class="order-reason">{{ o.reason }}</span>
                    <span v-if="o.ruleHit" class="order-rule">（{{ o.ruleHit }}）</span>
                    <span v-if="!o.reason && !o.ruleHit" class="muted">—</span>
                  </td>
                  <td>
                    <span :class="['status-badge', orderStatusClass(o.status)]">
                      {{ orderStatusTag(o.status) }}
                    </span>
                    <span v-if="o.filledPrice" class="filled-price"> 成交价 {{ Number(o.filledPrice).toFixed(2) }}</span>
                    <span v-if="o.rejectReason" class="reject-reason">{{ rejectReasonText(o.rejectReason) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>

          <!-- 净值曲线 Tab -->
          <div v-if="agentTab === 'nav'">
            <div v-if="!agentNavHistory.length" class="empty-tab">
              暂无净值历史（每日 15:05 结算后生成）
            </div>
            <v-chart v-else :option="navChartOption(agentNavHistory)" style="height: 220px" autoresize />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paper-dashboard { padding: 24px 32px; max-width: 1000px; }
.comp-selector { margin-bottom: 20px; }
.comp-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.comp-tabs button { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); border-radius: var(--radius); cursor: pointer; font-size: 13px; transition: all 0.15s; }
.comp-tabs button:hover { border-color: var(--brand); color: var(--brand); }
.comp-tabs button.active { background: var(--brand-glow); border-color: var(--brand); color: var(--brand); font-weight: 600; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: var(--radius); font-weight: 700; }
.badge-pending { background: rgba(234,179,8,0.15); color: #f59e0b; }
.badge-running { background: rgba(34,197,94,0.15); color: #22c55e; }
.badge-finished { background: rgba(107,114,128,0.15); color: #6b7280; }
.error-msg { padding: 10px 14px; background: rgba(239,68,68,0.1); border: 1px solid var(--up); border-radius: var(--radius-sm); color: var(--up); font-size: 13px; margin-bottom: 16px; }
.loading, .empty-state, .empty-tab { text-align: center; padding: 32px; color: var(--text-tertiary); font-size: 13px; }
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 24px; margin-bottom: 16px; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.card-header h2 { font-size: 16px; font-weight: 700; }
.card-header h1 { font-size: 16px; font-weight: 700; margin: 0; }
.live-dot { font-size: 12px; color: #22c55e; display: flex; align-items: center; gap: 6px; }
.ranking-table { width: 100%; border-collapse: collapse; font-size: 13px; }
/* 移动端表格横向滚动，避免列被截断 */
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.table-scroll > .ranking-table { min-width: 620px; }
.table-scroll > .compare-table { min-width: 520px; }
.table-scroll > .detail-table { min-width: 480px; }
.ranking-table th { padding: 8px 12px; text-align: left; color: var(--text-tertiary); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
.ranking-table th.num { text-align: right; }
.ranking-table td { padding: 12px; border-bottom: 1px solid var(--border-light); }
.ranking-table td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.rank-row:hover { background: rgba(255,255,255,0.02); cursor: pointer; }
.rank-row.top3 td { background: rgba(79,195,247,0.04); }
.rank-cell { width: 50px; }
.agent-name { font-weight: 700; font-size: 14px; }
.return-cell { font-size: 14px; font-weight: 700; }
.up-text { color: var(--up, #ef4444); }
.down-text { color: var(--down, #22c55e); }
.strategy-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.strategy-sub { padding: 5px 10px; font-size: 12px; cursor: pointer; background: transparent; color: var(--text-secondary); border: 1px solid var(--border); border-radius: var(--radius-xs); }
.strategy-sub.on { color: var(--brand); border-color: var(--brand); background: var(--brand-glow); }
.strategy-caveat { font-size: 11px; color: #f59e0b; }
.signals-body { padding: 8px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
.signal-group { display: flex; flex-direction: column; gap: 6px; }
.signal-head { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.signal-none { font-size: 12px; color: var(--text-tertiary); }
.signal-list { display: flex; flex-direction: column; gap: 4px; }
.signal-item { display: flex; align-items: baseline; gap: 10px; font-size: 12px; }
.signal-name { color: var(--brand); text-decoration: none; min-width: 140px; }
.signal-price { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.signal-reason { color: var(--text-tertiary); }
.report-empty { padding: 16px; font-size: 12px; line-height: 1.8; color: var(--text-tertiary); }
.report-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; }
.report-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.report-copy { font-size: 12px; padding: 4px 10px; cursor: pointer; background: var(--brand-glow); color: var(--brand); border: 1px solid var(--brand); border-radius: var(--radius-xs); }
.report-body { margin: 0 16px 16px; padding: 12px; max-height: 380px; overflow: auto; font-size: 12px; line-height: 1.7; white-space: pre-wrap; color: var(--text-secondary); background: var(--bg-muted); border-radius: var(--radius-sm); }
.report-more { padding: 0 16px 14px; font-size: 12px; color: var(--text-tertiary); }
.report-past { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
.sample-notice { margin: 0; padding: 8px 16px; font-size: 12px; line-height: 1.7; color: #f59e0b; background: rgba(245,158,11,0.08); border-bottom: 1px solid var(--border); }
.reason-cell { max-width: 260px; font-size: 12px; line-height: 1.5; }
.order-reason { color: var(--text-secondary); }
.order-rule { color: var(--text-tertiary); font-size: 11px; }
.muted { color: var(--text-tertiary); }
.spark polyline.up-text { stroke: #ef4444; }
.spark polyline.down-text { stroke: #10b981; }
.spark-empty { color: var(--text-tertiary); font-size: 12px; }
.history-link { margin-left: 12px; font-size: 12px; color: var(--brand); text-decoration: none; }
.card-sub { font-size: 11px; color: var(--text-tertiary); }
.strategy-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; padding: 12px 16px 16px; }
.strategy-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.strategy-head { display: flex; flex-direction: column; gap: 2px; }
.strategy-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.strategy-tag { font-size: 11px; color: var(--text-tertiary); }
.strategy-rules { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
.strategy-rules li { font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.strategy-btn { align-self: flex-start; margin-top: auto; padding: 5px 10px; font-size: 12px; cursor: pointer; background: var(--brand-glow); color: var(--brand); border: 1px solid var(--brand); border-radius: var(--radius-xs); }
.strategy-note { font-size: 11px; color: var(--text-tertiary); margin-top: auto; }
.empty-hint { max-width: 52ch; margin: 6px auto 0; font-size: 12px; line-height: 1.7; color: var(--text-tertiary); }
.comp-info { display: flex; gap: 24px; flex-wrap: wrap; }
.info-item { display: flex; flex-direction: column; gap: 4px; }
.info-label { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.info-value { font-size: 15px; font-weight: 700; }

/* 回测对比 */
.compare-controls { display: flex; gap: 8px; align-items: center; }
.code-input { padding: 6px 12px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text); border-radius: var(--radius); font-size: 13px; width: 120px; }
.compare-btn { padding: 6px 16px; background: var(--brand); color: #fff; border: none; border-radius: var(--radius); font-size: 13px; cursor: pointer; }
.compare-btn:disabled { opacity: 0.6; }
.compare-body { margin-top: 16px; }
.compare-stats { margin-top: 16px; }
.compare-stats h4 { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.compare-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.compare-table th { padding: 6px 10px; text-align: left; color: var(--text-tertiary); font-size: 10px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
.compare-table th.num { text-align: right; }
.compare-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-light); }
.compare-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.compare-table tr.agent-row { background: rgba(56,189,248,0.04); }
.compare-table tr.benchmark-row { }
.compare-note { font-size: 11px; color: var(--text-tertiary); margin-top: 10px; }
.compare-empty { text-align: center; padding: 32px; color: var(--text-tertiary); font-size: 13px; }
.compare-toggle { padding: 4px 12px; border: 1px solid var(--brand); background: transparent; color: var(--brand); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; transition: all 0.15s; }
.compare-toggle:hover { background: var(--brand-glow); }

/* 弹窗 */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 560px; max-width: 95vw; max-height: 85vh; overflow-y: auto; }
.modal-wide { width: 720px; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-header h3 { font-size: 15px; font-weight: 700; }
.model-tag { font-size: 11px; background: var(--bg-secondary); padding: 2px 8px; border-radius: var(--radius); color: var(--text-tertiary); margin-left: 8px; }
.close-btn { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 16px; padding: 4px 8px; }
.modal-body { padding: 20px; }
.agent-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.stat { display: flex; flex-direction: column; gap: 4px; background: var(--bg-secondary); border-radius: var(--radius); padding: 12px; }
.stat-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; }
.stat-value { font-size: 16px; font-weight: 700; }

.tab-bar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.tab-bar button { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: all 0.15s; }
.tab-bar button:hover { color: var(--brand); }
.tab-bar button.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }

.detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.detail-table th { padding: 6px 10px; text-align: left; color: var(--text-tertiary); font-size: 10px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
.detail-table th.num { text-align: right; }
.detail-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-light); }
.detail-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.stock-name { font-weight: 600; margin-right: 6px; }
.stock-code { font-size: 10px; color: var(--text-tertiary); }
.time-cell { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.dir-buy { color: #ef4444; font-weight: 700; }
.dir-sell { color: #22c55e; font-weight: 700; }
.status-badge { font-size: 10px; padding: 1px 6px; border-radius: var(--radius-md); font-weight: 700; }
.status-filled { background: rgba(34,197,94,0.15); color: #22c55e; }
.status-pending { background: rgba(234,179,8,0.15); color: #f59e0b; }
.status-rejected { background: rgba(239,68,68,0.15); color: #ef4444; }
.status-cancelled { background: rgba(107,114,128,0.15); color: #6b7280; }
.filled-price { font-size: 11px; color: var(--text-tertiary); margin-left: 4px; }
.reject-reason { font-size: 10px; color: #ef4444; margin-left: 4px; }
@media (max-width: 640px) {
  /* 窄屏隐藏次要列，保留 Agent / 总资产 / 累计收益率 */
  .ranking-table th:nth-child(4),
  .ranking-table td:nth-child(4),
  .ranking-table th:nth-child(5),
  .ranking-table td:nth-child(5),
  .ranking-table th:nth-child(7),
  .ranking-table td:nth-child(7) { display: none; }
  .table-scroll > .ranking-table { min-width: 0; }

  .compare-table th:nth-child(4),
  .compare-table td:nth-child(4),
  .compare-table th:nth-child(5),
  .compare-table td:nth-child(5) { display: none; }
  .table-scroll > .compare-table { min-width: 0; }
}
</style>
