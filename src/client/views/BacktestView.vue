<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import VChart from 'vue-echarts'
import '../echarts-setup.js'
import type { BacktestResult } from '@shared/types'
import { useStockStore } from '../stores/stock'
import TermTip from '../components/TermTip.vue'

const router = useRouter()
const route = useRoute()
const store = useStockStore()

const activeTab = ref<'single' | 'portfolio' | 'optimize' | 'wf' | 'history'>('single')

const code = ref('000001')
const strategyId = ref(1)
const customStrategyId = ref<number | null>(null)
const useCustomStrategy = ref(false)
const strategies = ref<{ id: number; name: string }[]>([])
const startDate = ref('2025-01-01')
const endDate = ref('2026-01-01')
const capital = ref(100000)
const result = ref<BacktestResult | null>(null)
const loading = ref(false)
const error = ref('')
const valError = ref('')

const portfolioLoading = ref(false)
const portfolioProgress = ref({ done: 0, total: 0 })
const portfolioResult = ref<any>(null)
const portfolioError = ref('')
const portfolioMode = ref<'basic' | 'enhanced'>('enhanced')
const maxPositions = ref(50)
const rebalanceDays = ref(0)
const allocationMode = ref<'equal' | 'sharpe' | 'return'>('equal')

const optimizeLoading = ref(false)
const optimizeProgress = ref({ done: 0, total: 0, status: '' })
const optimizeResult = ref<any>(null)
const optimizeError = ref('')
const sortBy = ref<'sharpe' | 'totalReturn' | 'winRate' | 'maxDrawdown'>('sharpe')

const optimizeTemplate = ref<'ma_cross' | 'rsi'>('ma_cross')
const maShortPeriods = ref<number[]>([5, 10, 20])
const maLongPeriods = ref<number[]>([20, 60])
const rsiPeriods = ref<number[]>([14])

const wfLoading = ref(false)
const wfProgress = ref({ done: 0, total: 3, status: '' })
const wfResult = ref<any>(null)
const wfError = ref('')

const historyLoading = ref(false)
const historyList = ref<any[]>([])
const historyError = ref('')
const compareIds = ref<number[]>([])
const compareResult = ref<any[]>([])
const compareLoading = ref(false)

async function applyOptimizedParams(r: any) {
  if (!validate()) return
  loading.value = true
  error.value = ''
  result.value = null
  activeTab.value = 'single'
  try {
    let rules: any[] = []
    const p = r.params
    if (optimizeTemplate.value === 'ma_cross') {
      const shortPeriod = r.params.ma_short || r.params.ma_short_period
      const longPeriod = r.params.ma_long || r.params.ma_long_period
      const shortInd = `ma${shortPeriod}`
      const longInd = `ma${longPeriod}`
      rules = [
        { type: 'cross', action: 'BUY', conditions: [{ indicator: shortInd, operator: 'cross_above', value: longInd }] },
        { type: 'cross', action: 'SELL', conditions: [{ indicator: shortInd, operator: 'cross_below', value: longInd }] },
      ]
    } else if (optimizeTemplate.value === 'rsi') {
      const period = r.params.rsi || r.params.rsi_period
      rules = [
        { type: 'threshold', action: 'BUY', conditions: [{ indicator: 'rsi', operator: '<', value: 30 }] },
        { type: 'threshold', action: 'SELL', conditions: [{ indicator: 'rsi', operator: '>', value: 70 }] },
      ]
    }
    const templateName = optimizeTemplate.value === 'ma_cross'
      ? `MA${p.ma_short || p.ma_short_period}/${p.ma_long || p.ma_long_period} 金叉死叉`
      : `RSI${p.rsi || p.rsi_period} 超买超卖`
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.value, startDate: startDate.value, endDate: endDate.value,
        initialCapital: capital.value, rules, strategyName: templateName,
      }),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    result.value = await res.json()
    result.value.strategyName = templateName
  } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}

onMounted(async () => {
  try {
    const res = await fetch('/api/stocks/strategies')
    if (res.ok) strategies.value = await res.json()
  } catch {}

  if (route.query.custom === '1' && route.query.strategyId) {
    useCustomStrategy.value = true
    customStrategyId.value = Number(route.query.strategyId)
    strategyId.value = 1
  }
})

watch(activeTab, (tab) => {
  if (tab === 'history' && !historyLoading.value && historyList.value.length === 0) {
    loadHistory()
  }
})

function validate() {
  if (startDate.value >= endDate.value) { valError.value = '开始日期必须早于结束日期'; return false }
  if (capital.value < 10000) { valError.value = '初始本金至少 10,000'; return false }
  valError.value = ''
  return true
}

async function run() {
  if (!validate()) return
  loading.value = true
  error.value = ''
  result.value = null
  try {
    const body: any = {
      code: code.value,
      startDate: startDate.value,
      endDate: endDate.value,
      initialCapital: capital.value,
    }
    if (useCustomStrategy.value && customStrategyId.value) {
      body.custom = true
      body.userStrategyId = customStrategyId.value
    } else {
      body.strategyId = strategyId.value
    }
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    result.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function downloadCSV() {
  if (!result.value) return
  const trades = result.value.trades
  const header = ['#', '买入日期', '卖出日期', '买入价', '卖出价', '股数', '盈亏', '收益率(%)']
  const rows = trades.map((t, i) => [
    i + 1, t.entryDate, t.exitDate,
    t.entryPrice.toFixed(2), t.exitPrice.toFixed(2),
    t.shares, t.pnl.toFixed(0), t.returnPct.toFixed(2)
  ])
  const summary = [
    ['=== 策略回测报告 ==='],
    ['股票代码', code.value],
    ['策略', strategies.value.find(s => s.id === strategyId.value)?.name || strategyId.value],
    ['回测区间', `${startDate.value} ~ ${endDate.value}`],
    ['初始资金', capital.value],
    [],
    ['=== 绩效指标 ==='],
    ['总收益率(%)', result.value.totalReturn.toFixed(2)],
    ['年化收益(%)', result.value.annualReturn.toFixed(2)],
    ['夏普比率', result.value.sharpe.toFixed(2)],
    ['最大回撤(%)', result.value.maxDrawdown.toFixed(2)],
    ['胜率(%)', result.value.winRate.toFixed(1)],
    ['交易次数', result.value.tradeCount],
    [],
    ['=== 交易记录 ==='],
    header,
    ...rows
  ]
  const csv = '\uFEFF' + rows2CSV(summary)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `backtest_${code.value}_${startDate.value}_${endDate.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadPDF() {
  if (!result.value) return
  try {
    const res = await fetch('/api/backtest/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result: result.value,
        code: code.value,
        strategyName: result.value.strategyName || strategies.value.find(s => s.id === strategyId.value)?.name || '策略',
        startDate: startDate.value,
        endDate: endDate.value,
      }),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest_${code.value}_${startDate.value}_${endDate.value}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    error.value = e.message
  }
}

function rows2CSV(rows: (string | number)[][]): string {
  return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

async function runPortfolio() {
  if (!validate()) return
  portfolioLoading.value = true
  portfolioError.value = ''
  portfolioResult.value = null
  portfolioProgress.value = { done: 0, total: 0 }
  try {
    const endpoint = portfolioMode.value === 'enhanced' ? '/api/backtest/portfolio-enhanced' : '/api/backtest/portfolio'
    const body: any = { strategyId: strategyId.value, startDate: startDate.value, endDate: endDate.value, initialCapital: capital.value }
    if (portfolioMode.value === 'enhanced') {
      body.maxPositions = maxPositions.value
      body.rebalanceDays = rebalanceDays.value
      body.allocation = allocationMode.value
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event: ')) continue
        if (!line.startsWith('data: ')) continue
        const data = JSON.parse(line.slice(6))
        if (data.error) { portfolioError.value = data.error; portfolioLoading.value = false; return }
        if (data.done !== undefined) portfolioProgress.value = { done: data.done, total: data.total }
        if (data.summary) portfolioResult.value = data
      }
    }
  } catch (e: any) {
    portfolioError.value = e.message
  } finally {
    portfolioLoading.value = false
  }
}

async function runOptimize() {
  if (!validate()) return
  if (optimizeTemplate.value === 'ma_cross') {
    if (maShortPeriods.value.length === 0) { optimizeError.value = '请至少选择一个短期MA周期'; return }
    if (maLongPeriods.value.length === 0) { optimizeError.value = '请至少选择一个长期MA周期'; return }
  }
  optimizeLoading.value = true
  optimizeError.value = ''
  optimizeResult.value = null
  optimizeProgress.value = { done: 0, total: 1, status: '开始优化...' }
  try {
    const slots = optimizeTemplate.value === 'ma_cross'
      ? [
          { name: 'ma_short', indicator: 'MA', type: 'cross', shortName: 'ma_short', longName: 'ma_long', periods: maShortPeriods.value },
          { name: 'ma_long', indicator: 'MA', type: 'cross', periods: maLongPeriods.value },
        ]
      : [
          { name: 'rsi', indicator: 'RSI', type: 'threshold', thresholdLow: 30, thresholdHigh: 70, periods: rsiPeriods.value },
        ]

    const res = await fetch('/api/backtest/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategyId: strategyId.value, startDate: startDate.value, endDate: endDate.value,
        initialCapital: capital.value, paramSlots: slots, sortBy: sortBy.value, topN: 20,
      }),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event: ')) continue
        if (!line.startsWith('data: ')) continue
        const data = JSON.parse(line.slice(6))
        if (data.error) { optimizeError.value = data.error; optimizeLoading.value = false; return }
        if (data.totalCombos) optimizeProgress.value = { done: data.done, total: data.total, status: `已测试 ${data.done}/${data.totalCombos} 参数组合` }
        if (data.topResults) optimizeResult.value = data
      }
    }
  } catch (e: any) {
    optimizeError.value = e.message
  } finally {
    optimizeLoading.value = false
  }
}

function paramRangesText() {
  if (optimizeTemplate.value === 'ma_cross') {
    return `MA(${maShortPeriods.value.join(',')}) × MA(${maLongPeriods.value.join(',')}) = ${maShortPeriods.value.length * maLongPeriods.value.length} 组合`
  }
  return `RSI(${rsiPeriods.value.join(',')}) = ${rsiPeriods.value.length} 组合`
}

async function runWalkForward() {
  if (!validate()) return
  if (optimizeTemplate.value === 'ma_cross') {
    if (maShortPeriods.value.length === 0) { wfError.value = '请至少选择一个短期MA周期'; return }
    if (maLongPeriods.value.length === 0) { wfError.value = '请至少选择一个长期MA周期'; return }
  }
  wfLoading.value = true
  wfError.value = ''
  wfResult.value = null
  wfProgress.value = { done: 0, total: 3, status: '开始 Walk-Forward 验证...' }
  try {
    const slots = optimizeTemplate.value === 'ma_cross'
      ? [
          { name: 'ma_short', indicator: 'MA', type: 'cross', periods: maShortPeriods.value },
          { name: 'ma_long', indicator: 'MA', type: 'cross', periods: maLongPeriods.value },
        ]
      : [
          { name: 'rsi', indicator: 'RSI', type: 'threshold', thresholdLow: 30, thresholdHigh: 70, periods: rsiPeriods.value },
        ]
    const res = await fetch('/api/backtest/walkforward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategyId: strategyId.value, startDate: startDate.value, endDate: endDate.value,
        paramSlots: slots, trainYears: 2, stepMonths: 3,
      }),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event: ')) continue
        if (!line.startsWith('data: ')) continue
        const data = JSON.parse(line.slice(6))
        if (data.error) { wfError.value = data.error; wfLoading.value = false; return }
        if (data.done !== undefined) wfProgress.value = { done: data.done, total: 3, status: `已完成 ${data.done}/3 个窗口` }
        if (data.windows) wfResult.value = data
      }
    }
  } catch (e: any) {
    wfError.value = e.message
  } finally {
    wfLoading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  historyError.value = ''
  historyList.value = []
  compareIds.value = []
  compareResult.value = []
  try {
    const res = await fetch('/api/backtest/history')
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    historyList.value = await res.json()
  } catch (e: any) {
    historyError.value = e.message
  } finally {
    historyLoading.value = false
  }
}

function toggleHistorySelect(id: number) {
  const idx = compareIds.value.indexOf(id)
  if (idx >= 0) compareIds.value.splice(idx, 1)
  else compareIds.value.push(id)
}

async function compareSelected() {
  if (compareIds.value.length < 2) return
  compareLoading.value = true
  try {
    const res = await fetch(`/api/backtest/compare?ids=${compareIds.value.join(',')}`)
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    compareResult.value = await res.json()
  } catch (e: any) {
    historyError.value = e.message
  } finally {
    compareLoading.value = false
  }
}

function fmtDate(d: string) {
  return d ? d.slice(0, 10) : ''
}

function initHistory() {
  if (activeTab.value === 'history' && !historyLoading.value && historyList.value.length === 0) {
    loadHistory()
  }
}

const equityOption = computed(() => {
  if (!result.value) return {}
  return {
    animation: false,
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(11,17,25,0.95)', borderColor: '#1e2d3d', textStyle: { color: '#e0e6ed' } },
    grid: { left: 56, right: 16, top: 16, bottom: 16 },
    xAxis: { type: 'category', data: result.value.equity.map(e => e.date), axisLabel: { color: '#5a6a7a', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#5a6a7a', fontSize: 10, formatter: (v: number) => (v / 10000).toFixed(0) + 'w' }, splitLine: { lineStyle: { color: '#1e2d3d' } } },
    series: [{ type: 'line', data: result.value.equity.map(e => e.value), smooth: true, symbol: 'none', lineStyle: { color: '#f0b429', width: 1.5 }, areaStyle: { color: 'rgba(240,180,41,0.08)' } }],
  }
})

const portfolioEquityOption = computed(() => {
  if (!portfolioResult.value?.equity) return {}
  const eq = portfolioResult.value.equity
  return {
    animation: false,
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(11,17,25,0.95)', borderColor: '#1e2d3d', textStyle: { color: '#e0e6ed' }, formatter: (p: any) => `${p[0].name}<br/><span style="color:#f0b429">净值</span>: ${(p[0].value / 100000).toFixed(3)}` },
    grid: { left: 56, right: 16, top: 16, bottom: 16 },
    xAxis: { type: 'category', data: eq.map((e: any) => e.date), axisLabel: { color: '#5a6a7a', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#5a6a7a', fontSize: 10, formatter: (v: number) => (v / 100000).toFixed(2) }, splitLine: { lineStyle: { color: '#1e2d3d' } } },
    series: [{ type: 'line', data: eq.map((e: any) => e.portfolioValue), smooth: true, symbol: 'none', lineStyle: { color: '#f0b429', width: 1.5 }, areaStyle: { color: 'rgba(240,180,41,0.08)' } }],
  }
})

const compareEquityOption = computed(() => {
  if (!compareResult.value.length) return {}
  const colors = ['#f0b429', '#3b9eff', '#52c778', '#ff7c43', '#9b59b6', '#e74c3c']
  const series = compareResult.value.map((r: any, i: number) => {
    const equity = r.result?.equity || []
    return {
      type: 'line' as const,
      data: equity.map((e: any) => e.value),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: colors[i % colors.length], width: 1.5 },
      areaStyle: undefined,
      xAxisIndex: 0,
      yAxisIndex: 0,
      name: `${r.code} / ${r.strategyId}`,
    }
  })
  const allDates = compareResult.value.flatMap((r: any) => (r.result?.equity || []).map((e: any) => e.date))
  return {
    animation: false,
    legend: { top: 4, right: 16, textStyle: { color: '#5a6a7a', fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(11,17,25,0.95)', borderColor: '#1e2d3d', textStyle: { color: '#e0e6ed' } },
    grid: { left: 56, right: 16, top: 28, bottom: 16 },
    xAxis: { type: 'category', data: allDates, axisLabel: { color: '#5a6a7a', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#5a6a7a', fontSize: 10, formatter: (v: number) => (v / 10000).toFixed(0) + 'w' }, splitLine: { lineStyle: { color: '#1e2d3d' } } },
    series,
  }
})

function viewStock(code: string) {
  store.selectStock(code)
  router.push(`/stock/${code}`)
}
</script>

<template>
  <div class="backtest-view">
    <div class="page-header">
      <h1>策略回测<TermTip term="backtest" /></h1>
      <div class="tab-nav">
        <button class="tab-btn" :class="{ active: activeTab === 'single' }" @click="activeTab = 'single'">单股回测<TermTip term="backtest" /></button>
        <button class="tab-btn" :class="{ active: activeTab === 'portfolio' }" @click="activeTab = 'portfolio'">组合回测<TermTip term="backtest" /></button>
        <button class="tab-btn" :class="{ active: activeTab === 'optimize' }" @click="activeTab = 'optimize'">参数优化<TermTip term="parameterOptimize" /></button>
        <button class="tab-btn" :class="{ active: activeTab === 'wf' }" @click="activeTab = 'wf'">Walk-Forward</button>
        <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">回测历史<TermTip term="backtest" /></button>
      </div>
    </div>

    <div class="card control-card">
      <div class="control-row">
        <label>
          <span class="label-text">策略</span>
          <select v-model="strategyId" :disabled="useCustomStrategy">
            <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <div v-if="useCustomStrategy" class="custom-strategy-badge">
          <span>自定义策略 #{{ customStrategyId }}</span>
          <button class="clear-custom" @click="useCustomStrategy = false; customStrategyId = null" aria-label="清除">✕</button>
        </div>
        <label v-if="activeTab === 'single'">
          <span class="label-text">股票</span>
          <select v-model="code">
            <option v-for="s in store.stockList" :key="s.code" :value="s.code">{{ s.name }} ({{ s.code }})</option>
          </select>
        </label>
        <label>
          <span class="label-text">开始日期</span>
          <input type="date" v-model="startDate" />
        </label>
        <label>
          <span class="label-text">结束日期</span>
          <input type="date" v-model="endDate" />
        </label>
        <label>
          <span class="label-text">初始本金<TermTip term="initialCapital" /></span>
          <input type="number" v-model.number="capital" :min="10000" :step="10000" />
        </label>
        <button v-if="activeTab !== 'optimize'" class="run-btn" @click="activeTab === 'single' ? run() : runPortfolio()" :disabled="(activeTab === 'single' ? loading : portfolioLoading) || !strategies.length">
          <span v-if="activeTab === 'single' ? loading : portfolioLoading" class="btn-spinner" />
          {{ activeTab === 'single' ? (loading ? '运行中...' : '运行回测') : (portfolioLoading ? `${portfolioProgress.done}/${portfolioProgress.total}` : '运行组合回测') }}
        </button>
      </div>
      <div v-if="valError" class="val-error">{{ valError }}</div>
    </div>

    <div v-if="error" class="error-banner">⚠ {{ error }}</div>
    <div v-if="portfolioError" class="error-banner">⚠ {{ portfolioError }}</div>

    <template v-if="activeTab === 'single'">
      <div v-if="loading" class="loading-state"><div class="spinner" /><span>正在获取数据并计算...</span></div>
      <template v-if="result">
        <div class="metrics-grid">
          <div class="card metric-card" :class="result.totalReturn >= 0 ? 'positive' : 'negative'">          <span class="metric-label">总收益率<TermTip term="totalReturn" /></span><span class="metric-value">{{ result.totalReturn.toFixed(2) }}%</span></div>
          <div class="card metric-card" :class="result.annualReturn >= 0 ? 'positive' : 'negative'">          <span class="metric-label">年化收益<TermTip term="annualReturn" /></span><span class="metric-value">{{ result.annualReturn.toFixed(2) }}%</span></div>
          <div class="card metric-card">          <span class="metric-label">夏普比率<TermTip term="sharpe" /></span><span class="metric-value">{{ result.sharpe.toFixed(2) }}</span></div>
          <div class="card metric-card negative">          <span class="metric-label">最大回撤<TermTip term="maxDrawdown" /></span><span class="metric-value">{{ result.maxDrawdown.toFixed(2) }}%</span></div>
          <div class="card metric-card">          <span class="metric-label">胜率<TermTip term="winRate" /></span><span class="metric-value">{{ result.winRate.toFixed(1) }}%</span></div>
          <div class="card metric-card">          <span class="metric-label">交易次数<TermTip term="tradeCount" /></span><span class="metric-value">{{ result.tradeCount }}</span></div>
        </div>
        <div class="actions-row">
          <button class="btn-outline" @click="downloadCSV">
            <span class="icon">↓</span> 导出CSV
          </button>
          <button class="btn-outline" @click="downloadPDF">
            <span class="icon">↓</span> 下载PDF
          </button>
        </div>
        <div class="card chart-card"><div class="card-title">权益曲线</div><VChart :option="equityOption" style="height: 320px" autoresize /></div>
        <div v-if="result.trades.length" class="card trades-card">
          <div class="card-title">交易记录 ({{ result.trades.length }})</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>买入日期</th><th>卖出日期</th><th>买入价</th><th>卖出价</th><th>股数</th><th>盈亏</th><th>收益率<TermTip term="totalReturn" /></th></tr></thead>
              <tbody>
                <tr v-for="(t, i) in result.trades" :key="i">
                  <td>{{ i + 1 }}</td><td>{{ t.entryDate }}</td><td>{{ t.exitDate }}</td>
                  <td class="num">{{ t.entryPrice.toFixed(2) }}</td><td class="num">{{ t.exitPrice.toFixed(2) }}</td>
                  <td class="num">{{ t.shares }}</td>
                  <td class="num" :class="t.pnl >= 0 ? 'up-text' : 'down-text'">{{ t.pnl >= 0 ? '+' : '' }}{{ t.pnl.toFixed(0) }}</td>
                  <td class="num" :class="t.returnPct >= 0 ? 'up-text' : 'down-text'">{{ t.returnPct >= 0 ? '+' : '' }}{{ t.returnPct.toFixed(2) }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>

    <template v-if="activeTab === 'portfolio'">
      <div class="portfolio-controls">
        <div class="mode-toggle-row">
          <button class="mode-btn" :class="{ active: portfolioMode === 'basic' }" @click="portfolioMode = 'basic'">基础组合</button>
          <button class="mode-btn" :class="{ active: portfolioMode === 'enhanced' }" @click="portfolioMode = 'enhanced'">增强组合</button>
        </div>
        <template v-if="portfolioMode === 'enhanced'">
          <div class="control-row">
            <div class="control-group">
              <label>最大持仓<TermTip term="position" /></label>
              <select v-model="maxPositions">
                <option :value="10">10 只</option>
                <option :value="20">20 只</option>
                <option :value="50">50 只</option>
                <option :value="100">100 只</option>
              </select>
            </div>
            <div class="control-group">
              <label>再平衡周期<TermTip term="rebalance" /></label>
              <select v-model="rebalanceDays">
                <option :value="0">不调仓<TermTip term="rebalance" /></option>
                <option :value="5">每 5 天</option>
                <option :value="20">每月</option>
                <option :value="60">每季</option>
              </select>
            </div>
            <div class="control-group">
              <label>分配方式</label>
              <select v-model="allocationMode">
                <option value="equal">等权分配</option>
                <option value="sharpe">按夏普<TermTip term="sharpe" />加权</option>
                <option value="return">按收益<TermTip term="totalReturn" />加权</option>
              </select>
            </div>
          </div>
        </template>
      </div>
      <div v-if="portfolioLoading" class="loading-state"><div class="spinner" /><span>正在对全A股进行组合回测<TermTip term="backtest" />...</span></div>
      <template v-if="portfolioResult">
        <div class="metrics-grid">
          <div class="card metric-card" :class="portfolioResult.summary.portfolioReturn >= 0 ? 'positive' : 'negative'">          <span class="metric-label">组合收益率<TermTip term="totalReturn" /></span><span class="metric-value">{{ portfolioResult.summary.portfolioReturn.toFixed(2) }}%</span></div>
          <div class="card metric-card positive"><span class="metric-label">盈利股票</span><span class="metric-value">{{ portfolioResult.summary.profitableStocks }} / {{ portfolioResult.summary.totalStocks }}</span></div>
          <div class="card metric-card">          <span class="metric-label">总交易次数<TermTip term="tradeCount" /></span><span class="metric-value">{{ portfolioResult.summary.totalTrades }}</span></div>
          <template v-if="portfolioMode === 'enhanced'">
            <div class="card metric-card">            <span class="metric-label">组合夏普<TermTip term="sharpe" /></span><span class="metric-value">{{ portfolioResult.summary.portfolioSharpe?.toFixed(2) || '—' }}</span></div>
            <div class="card metric-card" :class="(portfolioResult.summary.portfolioMaxDrawdown || 0) >= 0 ? '' : ''">            <span class="metric-label">组合最大回撤<TermTip term="maxDrawdown" /></span><span class="metric-value down-text">{{ portfolioResult.summary.portfolioMaxDrawdown?.toFixed(2) || '—' }}%</span></div>
            <div class="card metric-card">            <span class="metric-label">组合胜率<TermTip term="winRate" /></span><span class="metric-value">{{ portfolioResult.summary.portfolioWinRate?.toFixed(1) || '—' }}%</span></div>
            <div class="card metric-card"><span class="metric-label">单笔仓位</span><span class="metric-value">{{ portfolioResult.summary.capitalPerPosition?.toLocaleString() || '—' }}</span></div>
          </template>
          <template v-else>
            <div class="card metric-card">            <span class="metric-label">平均胜率<TermTip term="winRate" /></span><span class="metric-value">{{ (portfolioResult.summary.avgWinRate || 0).toFixed(1) }}%</span></div>
          </template>
        </div>
        <div class="card chart-card"><div class="card-title">组合权益曲线{{ portfolioMode === 'enhanced' ? `（${allocationMode === 'equal' ? '等权' : allocationMode === 'sharpe' ? '夏普加权' : '收益加权'}${rebalanceDays > 0 ? ' · 定期再平衡' : ''}）` : '（等权平均）' }}<TermTip term="sharpe" /><TermTip term="totalReturn" /><TermTip term="rebalance" /></div><VChart :option="portfolioEquityOption" style="height: 320px" autoresize /></div>
        <div class="card stock-table-card">
          <div class="card-title">个股回测明细<TermTip term="backtest" /></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>股票</th><th>代码</th><th>权重</th><th>总收益<TermTip term="totalReturn" /></th><th>年化收益<TermTip term="annualReturn" /></th><th>夏普<TermTip term="sharpe" /></th><th>最大回撤<TermTip term="maxDrawdown" /></th><th>胜率<TermTip term="winRate" /></th><th>交易次数<TermTip term="tradeCount" /></th></tr></thead>
              <tbody>
                <tr v-for="s in portfolioResult.perStock" :key="s.code" class="stock-row" @click="viewStock(s.code)">
                  <td>{{ s.name }}</td><td class="code">{{ s.code }}</td>
                  <td v-if="portfolioMode === 'enhanced'" class="num">{{ s.weight }}%</td>
                  <td class="num" :class="s.totalReturn >= 0 ? 'up-text' : 'down-text'">{{ s.totalReturn >= 0 ? '+' : '' }}{{ s.totalReturn.toFixed(2) }}%</td>
                  <td class="num" :class="s.annualReturn >= 0 ? 'up-text' : 'down-text'">{{ (s.annualReturn || 0) >= 0 ? '+' : '' }}{{ (s.annualReturn || 0).toFixed(2) }}%</td>
                  <td class="num">{{ (s.sharpe || 0).toFixed(2) }}</td>
                  <td class="num down-text">{{ (s.maxDrawdown || 0).toFixed(2) }}%</td>
                  <td class="num">{{ (s.winRate || 0).toFixed(1) }}%</td>
                  <td class="num">{{ s.tradeCount || 0 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>

    <template v-if="activeTab === 'optimize'">
      <div class="card control-card" style="margin-bottom: 12px">
        <div class="param-section-title">策略模板</div>
        <div class="template-selector">
          <button class="template-btn" :class="{ active: optimizeTemplate === 'ma_cross' }" @click="optimizeTemplate = 'ma_cross'">MA 金叉<TermTip term="goldenCross" />死叉<TermTip term="deathCross" /></button>
          <button class="template-btn" :class="{ active: optimizeTemplate === 'rsi' }" @click="optimizeTemplate = 'rsi'">RSI<TermTip term="rsi" /> 超买<TermTip term="overbought" />超卖<TermTip term="oversold" /></button>
        </div>

        <template v-if="optimizeTemplate === 'ma_cross'">
          <div class="param-section-title" style="margin-top: 16px">短期 MA<TermTip term="ma" /> 周期</div>
          <div class="period-checkboxes">
            <label v-for="p in [5, 10, 20, 30, 60]" :key="p" class="period-check">
              <input type="checkbox" :value="p" v-model="maShortPeriods" /> MA<TermTip term="ma" />{{ p }}
            </label>
          </div>
          <div class="param-section-title" style="margin-top: 12px">长期 MA<TermTip term="ma" /> 周期</div>
          <div class="period-checkboxes">
            <label v-for="p in [20, 60, 120, 250]" :key="p" class="period-check">
              <input type="checkbox" :value="p" v-model="maLongPeriods" /> MA<TermTip term="ma" />{{ p }}
            </label>
          </div>
          <div class="param-count">{{ paramRangesText() }}</div>
        </template>

        <template v-if="optimizeTemplate === 'rsi'">
          <div class="param-section-title" style="margin-top: 16px">RSI<TermTip term="rsi" /> 周期</div>
          <div class="period-checkboxes">
            <label v-for="p in [7, 14, 21, 28]" :key="p" class="period-check">
              <input type="checkbox" :value="p" v-model="rsiPeriods" /> RSI<TermTip term="rsi" />{{ p }}
            </label>
          </div>
          <div class="param-count">共 {{ rsiPeriods.length }} 个参数组合</div>
        </template>

        <div class="control-row" style="margin-top: 16px">
          <label>
            <span class="label-text">排序指标<TermTip term="parameterOptimize" /></span>
            <select v-model="sortBy" class="sort-select">
              <option value="sharpe">夏普比率<TermTip term="sharpe" /></option>
              <option value="totalReturn">总收益率<TermTip term="totalReturn" /></option>
              <option value="winRate">胜率<TermTip term="winRate" /></option>
              <option value="maxDrawdown">最大回撤<TermTip term="maxDrawdown" /> (越小越好)</option>
            </select>
          </label>
          <button class="run-btn" @click="runOptimize" :disabled="optimizeLoading">
            <span v-if="optimizeLoading" class="btn-spinner" />
            {{ optimizeLoading ? optimizeProgress.status || '优化中...' : '开始参数优化' }}
          </button>
        </div>
        <div v-if="optimizeError" class="val-error">{{ optimizeError }}</div>
      </div>

      <div v-if="optimizeLoading" class="loading-state"><div class="spinner" /><span>{{ optimizeProgress.status }}</span></div>

      <template v-if="optimizeResult">
        <div class="card section-card">
          <div class="card-title">Top 20 最优参数组合</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th>
                <th v-if="optimizeTemplate === 'ma_cross'">短期 MA<TermTip term="ma" /></th>
                <th v-if="optimizeTemplate === 'ma_cross'">长期 MA<TermTip term="ma" /></th>
                <th v-if="optimizeTemplate === 'rsi'">RSI<TermTip term="rsi" /> 周期</th>
                <th>总收益<TermTip term="totalReturn" /></th><th>夏普<TermTip term="sharpe" /></th><th>胜率<TermTip term="winRate" /></th><th>最大回撤<TermTip term="maxDrawdown" /></th><th>交易次数<TermTip term="tradeCount" /></th><th>盈利股票</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in optimizeResult.topResults" :key="r.rank" class="result-row" :class="r.rank === 1 ? 'top-result' : ''">
                  <td><span v-if="r.rank === 1" class="top-badge">★</span>{{ r.rank }}</td>
                  <td v-if="optimizeTemplate === 'ma_cross'" class="num">{{ r.params.ma_short || r.params.ma_short_period }}</td>
                  <td v-if="optimizeTemplate === 'ma_cross'" class="num">{{ r.params.ma_long || r.params.ma_long_period }}</td>
                  <td v-if="optimizeTemplate === 'rsi'" class="num">{{ r.params.rsi || r.params.rsi_period }}</td>
                  <td class="num" :class="r.totalReturn >= 0 ? 'up-text' : 'down-text'">{{ r.totalReturn >= 0 ? '+' : '' }}{{ r.totalReturn.toFixed(2) }}%</td>
                  <td class="num">{{ r.sharpe.toFixed(2) }}</td>
                  <td class="num">{{ r.winRate.toFixed(1) }}%</td>
                  <td class="num down-text">{{ r.maxDrawdown.toFixed(2) }}%</td>
                  <td class="num">{{ r.tradeCount }}</td>
                  <td class="num">{{ r.profitable }}/{{ r.totalStocks }}</td>
                  <td><button class="apply-btn" @click="applyOptimizedParams(r)">应用</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="optimize-hint">★ Top 1 为当前最优参数组合，建议用于后续组合回测<TermTip term="backtest" />验证</div>
      </template>
    </template>

    <template v-if="activeTab === 'wf'">
      <div class="card control-card" style="margin-bottom: 12px">
        <div class="param-section-title">策略模板</div>
        <div class="template-selector">
          <button class="template-btn" :class="{ active: optimizeTemplate === 'ma_cross' }" @click="optimizeTemplate = 'ma_cross'">MA 金叉<TermTip term="goldenCross" />死叉<TermTip term="deathCross" /></button>
          <button class="template-btn" :class="{ active: optimizeTemplate === 'rsi' }" @click="optimizeTemplate = 'rsi'">RSI<TermTip term="rsi" /> 超买<TermTip term="overbought" />超卖<TermTip term="oversold" /></button>
        </div>
        <template v-if="optimizeTemplate === 'ma_cross'">
          <div class="param-section-title" style="margin-top: 16px">短期 MA<TermTip term="ma" /> 周期</div>
          <div class="period-checkboxes">
            <label v-for="p in [5, 10, 20, 30, 60]" :key="p" class="period-check">
              <input type="checkbox" :value="p" v-model="maShortPeriods" /> MA<TermTip term="ma" />{{ p }}
            </label>
          </div>
          <div class="param-section-title" style="margin-top: 12px">长期 MA<TermTip term="ma" /> 周期</div>
          <div class="period-checkboxes">
            <label v-for="p in [20, 60, 120, 250]" :key="p" class="period-check">
              <input type="checkbox" :value="p" v-model="maLongPeriods" /> MA<TermTip term="ma" />{{ p }}
            </label>
          </div>
        </template>
        <template v-if="optimizeTemplate === 'rsi'">
          <div class="param-section-title" style="margin-top: 16px">RSI<TermTip term="rsi" /> 周期</div>
          <div class="period-checkboxes">
            <label v-for="p in [7, 14, 21, 28]" :key="p" class="period-check">
              <input type="checkbox" :value="p" v-model="rsiPeriods" /> RSI<TermTip term="rsi" />{{ p }}
            </label>
          </div>
        </template>
        <div class="control-row" style="margin-top: 16px">
          <button class="run-btn" @click="runWalkForward" :disabled="wfLoading">
            <span v-if="wfLoading" class="btn-spinner" />
            {{ wfLoading ? wfProgress.status || '验证中...' : '开始 Walk-Forward 验证' }}
          </button>
        </div>
        <div v-if="wfError" class="val-error">{{ wfError }}</div>
      </div>

      <div v-if="wfLoading" class="loading-state"><div class="spinner" /><span>{{ wfProgress.status }}</span></div>

      <template v-if="wfResult">
        <div class="metrics-grid">
          <div class="card metric-card" :class="wfResult.stabilityScore >= 0.6 ? 'positive' : 'negative'">
            <span class="metric-label">参数稳定性</span>
            <span class="metric-value">{{ (wfResult.stabilityScore * 100).toFixed(0) }}%</span>
          </div>
          <div class="card metric-card">
            <span class="metric-label">最优参数</span>
            <span class="metric-value" style="font-size: 14px">{{ wfResult.stableParams ? JSON.stringify(wfResult.stableParams) : '—' }}</span>
          </div>
          <div class="card metric-card">
            <span class="metric-label">窗口数</span>
            <span class="metric-value">{{ wfResult.windows?.length || 0 }}</span>
          </div>
        </div>
        <div class="card section-card">
          <div class="card-title">滚动窗口明细</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>训练期</th><th>测试期</th><th>最优参数</th><th>测试收益<TermTip term="totalReturn" /></th></tr></thead>
              <tbody>
                <tr v-for="w in wfResult.windows" :key="w.step">
                  <td>{{ w.step }}</td>
                  <td>{{ w.trainStart?.slice(0,10) }} → {{ w.trainEnd?.slice(0,10) }}</td>
                  <td>{{ w.testStart?.slice(0,10) }} → {{ w.testEnd?.slice(0,10) }}</td>
                  <td class="num" style="font-size: 11px">{{ w.topParams ? JSON.stringify(w.topParams) : '—' }}</td>
                  <td class="num" :class="w.testReturn >= 0 ? 'up-text' : 'down-text'">{{ w.testReturn >= 0 ? '+' : '' }}{{ w.testReturn?.toFixed(2) || 0 }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="optimize-hint">
          <span v-if="wfResult.stabilityScore >= 0.67">★ 参数在 {{ wfResult.windows?.length }} 个窗口中表现稳定，具有参考价值</span>
          <span v-else-if="wfResult.stabilityScore >= 0.33">⚠ 参数稳定性中等，建议结合更多窗口验证</span>
          <span v-else>✕ 参数稳定性不足，建议调整策略或参数范围</span>
        </div>
      </template>
    </template>

    <template v-if="activeTab === 'history'">
      <div v-if="!historyList.length && !historyLoading" class="loading-state"><div class="spinner" /><button class="run-btn" style="margin-top:12px" @click="loadHistory">加载回测历史<TermTip term="backtest" /></button></div>
      <div v-if="historyLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>

      <template v-if="historyList.length">
        <div class="card section-card">
          <div class="card-title">回测历史<TermTip term="backtest" /> ({{ historyList.length }} 条)</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th></th><th>ID</th><th>代码</th><th>策略</th><th>日期范围</th><th>本金<TermTip term="initialCapital" /></th><th>创建时间</th></tr></thead>
              <tbody>
                <tr v-for="h in historyList" :key="h.id" class="stock-row" @click="toggleHistorySelect(h.id)">
                  <td><input type="checkbox" :checked="compareIds.includes(h.id)" @click.stop @change="toggleHistorySelect(h.id)" /></td>
                  <td class="num">{{ h.id }}</td>
                  <td class="code">{{ h.code }}</td>
                  <td>{{ h.strategyId }}</td>
                  <td>{{ fmtDate(h.startDate) }} → {{ fmtDate(h.endDate) }}</td>
                  <td class="num">{{ Number(h.initialCapital).toLocaleString() }}</td>
                  <td class="code">{{ h.createdAt ? new Date(h.createdAt).toLocaleString() : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="control-row" style="margin-top: 12px">
            <button class="run-btn" @click="compareSelected" :disabled="compareIds.length < 2 || compareLoading">
              <span v-if="compareLoading" class="btn-spinner" />
              对比所选 ({{ compareIds.length }})
            </button>
          </div>
        </div>
      </template>

      <template v-if="compareResult.length">
        <div class="card section-card">
          <div class="card-title">权益曲线对比</div>
          <VChart :option="compareEquityOption" style="height: 280px" autoresize />
        </div>
        <div class="card section-card">
          <div class="card-title">对比结果</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>代码</th><th>总收益<TermTip term="totalReturn" /></th><th>年化收益<TermTip term="annualReturn" /></th><th>夏普<TermTip term="sharpe" /></th><th>最大回撤<TermTip term="maxDrawdown" /></th><th>胜率<TermTip term="winRate" /></th><th>交易次数<TermTip term="tradeCount" /></th></tr></thead>
              <tbody>
                <tr v-for="r in compareResult" :key="r.id">
                  <td class="num">{{ r.id }}</td>
                  <td class="code">{{ r.code }}</td>
                  <td class="num" :class="(r.result?.totalReturn || 0) >= 0 ? 'up-text' : 'down-text'">{{ (r.result?.totalReturn || 0) >= 0 ? '+' : '' }}{{ (r.result?.totalReturn || 0).toFixed(2) }}%</td>
                  <td class="num">{{ (r.result?.annualReturn || 0).toFixed(2) }}%</td>
                  <td class="num">{{ (r.result?.sharpe || 0).toFixed(2) }}</td>
                  <td class="num down-text">{{ (r.result?.maxDrawdown || 0).toFixed(2) }}%</td>
                  <td class="num">{{ (r.result?.winRate || 0).toFixed(1) }}%</td>
                  <td class="num">{{ r.result?.tradeCount || 0 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.backtest-view { padding: 20px; max-width: 1200px; margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.page-header h1 { font-size: 18px; font-weight: 600; }

@media (min-width: 768px) {
  .backtest-view { padding: 24px 32px; }
}
@media (max-width: 640px) {
  .backtest-view .page-header h1 { font-size: 18px; }

  /* Tab nav - make horizontally scrollable */
  .tab-nav { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 0; }
  .tab-nav::-webkit-scrollbar { display: none; }
  .tab-btn { white-space: nowrap; font-size: 12px; padding: 8px 12px; flex-shrink: 0; }

  /* Controls - stack vertically */
  .control-row { flex-direction: column; gap: 8px; }
  .control-row select, .control-row input { min-width: 0; width: 100%; box-sizing: border-box; }

  /* Metrics grid - 2 columns instead of 4 */
  .metrics-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .metric-card { padding: 8px; }
  .metric-label { font-size: 10px; }
  .metric-value { font-size: 14px; }

  /* Tables - scroll horizontally */
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Parameters section */
  .param-grid { grid-template-columns: 1fr 1fr; }
  .param-group { min-width: 0; }

  /* Strategy cards / result items */
  .strategy-card { padding: 10px; }
  .strategy-header { flex-direction: column; gap: 4px; }

  /* Hide less important columns in trades table */
  .trades-card table th:nth-child(5),
  .trades-card table td:nth-child(5),
  .trades-card table th:nth-child(6),
  .trades-card table td:nth-child(6) { display: none; }

  /* Backtest history table: hide date range, backtest time */
  .section-card table th:nth-child(4),
  .section-card table td:nth-child(4),
  .section-card table th:nth-child(5),
  .section-card table td:nth-child(5) { display: none; }

  /* Buttons */
  .btn { font-size: 12px; padding: 6px 10px; }
}
</style>
