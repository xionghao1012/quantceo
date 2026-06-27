<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStockStore } from '../stores/stock'
import { useAuthStore } from '../stores/auth'
import { useWatchlistStore } from '../stores/watchlist'
import VChart from 'vue-echarts'
import '../echarts-setup.js'
import TermTip from '../components/TermTip.vue'

const props = defineProps<{ code: string }>()
const route = useRoute()
const router = useRouter()
const store = useStockStore()
const auth = useAuthStore()
const watchlist = useWatchlistStore()
const range = ref<'1M' | '3M' | '6M' | '1Y' | 'ALL'>('1Y')
const watchlistError = ref('')
const fundamental = ref<any>(null)
const fundamentalLoading = ref(false)
const freq = ref<'day' | 'm5' | 'm15' | 'm30' | 'm60'>('day')
const minuteKlines = ref<any[]>([])
const minuteIndicators = ref<any>(null)
const minuteLoading = ref(false)

const showNews = ref(false)
const newsSentiment = ref<any>(null)
const newsLoading = ref(false)
const newsError = ref('')

const stockCode = computed(() => props.code || route.params.code as string)

const rangeDays: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 9999 }

type BarLike = { date?: string; datetime?: string; open: number; high: number; low: number; close: number; volume: number; amount: number }

const activeKlines = computed(() => {
  if (freq.value === 'day') return store.klines as BarLike[]
  return minuteKlines.value as BarLike[]
})

const activeIndicators = computed(() => {
  if (freq.value === 'day') return store.indicators
  return minuteIndicators.value
})

const activeLoading = computed(() => {
  if (freq.value === 'day') return store.loading
  return minuteLoading.value
})

const filteredKlines = computed(() => {
  const k = activeKlines.value
  if (!k.length) return []
  const days = rangeDays[range.value]
  if (days >= 9999) return k
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return k.filter(d => new Date(d.date || d.datetime || '').getTime() >= cutoff.getTime())
})

const currentBar = computed(() => {
  const k = activeKlines.value
  return k.length > 0 ? k[k.length - 1] : null
})

const priceChangePct = computed(() => {
  const k = activeKlines.value
  if (k.length < 2) return 0
  return ((k[k.length - 1].close - k[k.length - 2].close) / k[k.length - 2].close * 100)
})

const volMax = computed(() => {
  const vols = filteredKlines.value.map(d => d.volume)
  return vols.length ? Math.max(...vols) * 2 : 0
})

const chartColors = computed(() => ({
  up: cv('--up'),
  down: cv('--down'),
  upDim: cv('--up-dim'),
  downDim: cv('--down-dim'),
  volUp: cv('--vol-up'),
  volDown: cv('--vol-down'),
  macdUp: cv('--macd-up'),
  macdDown: cv('--macd-down'),
  macdDif: cv('--macd-dif'),
  macdDea: cv('--macd-dea'),
  ma5: cv('--ma5'),
  ma20: cv('--ma20'),
  ma60: cv('--ma60'),
  rsi: cv('--rsi'),
  rsiArea: cv('--rsi-area'),
  border: cv('--border'),
  textTertiary: cv('--text-tertiary'),
  brand: cv('--brand'),
  bg: cv('--bg'),
  tooltipBg: cv('--tooltip-bg'),
  datazoomFiller: cv('--datazoom-filler'),
  textPrimary: cv('--text-primary'),
}))

const dateInterval = computed(() => {
  const len = filteredKlines.value.length
  return Math.max(Math.floor(len / 8), 1)
})

onMounted(async () => {
  const code = props.code || route.params.code as string
  store.selectStock(code)
  fetchFundamental(code)
  if (auth.isLoggedIn) watchlist.fetchAll()
  if (auth.isLoggedIn) fetchNewsSentiment()
  if (code.match(/^\d{6}$/) && store.stockName(code) === code) {
    try {
      const res = await fetch(`/api/stocks?q=${code}&limit=1`)
      if (res.ok) {
        const list = await res.json()
        if (list.length > 0) store.stockByCode = { ...store.stockByCode, [code]: list[0] }
      }
    } catch {}
  }
})

watch(() => props.code || route.params.code, (newCode) => {
  if (newCode) {
    store.selectStock(newCode as string)
    fetchFundamental(newCode as string)
    if (auth.isLoggedIn) fetchNewsSentiment()
  }
})

watch(freq, () => {
  const code = props.code || route.params.code as string
  if (code && freq.value !== 'day') {
    fetchMinuteData(code, freq.value)
  }
})

async function fetchMinuteData(code: string, period: string) {
  minuteLoading.value = true
  try {
    const [kRes, iRes] = await Promise.all([
      fetch(`/api/stocks/${code}/klines?period=${period}`),
      fetch(`/api/stocks/${code}/indicators?period=${period}`),
    ])
    if (kRes.ok) {
      const data = await kRes.json()
      minuteKlines.value = data.klines || []
    }
    if (iRes.ok) minuteIndicators.value = await iRes.json()
    else minuteIndicators.value = null
  } catch {} finally {
    minuteLoading.value = false
  }
}

async function fetchFundamental(code: string) {
  fundamentalLoading.value = true
  fundamental.value = null
  try {
    const res = await fetch(`/api/stocks/${code}/fundamental`)
    if (res.ok) fundamental.value = await res.json()
  } catch {}
  finally { fundamentalLoading.value = false }
}

async function addToWatchlist() {
  watchlistError.value = ''
  try {
    await watchlist.add(stockCode.value)
  } catch (e: any) {
    watchlistError.value = e.message
  }
}

async function fetchNewsSentiment() {
  newsLoading.value = true
  newsError.value = ''
  try {
    const res = await fetch(`/api/ai/news/sentiment/${stockCode.value}`, { headers: auth.authHeaders() })
    if (!res.ok) throw new Error((await res.json()).error || '获取失败')
    newsSentiment.value = await res.json()
  } catch (e: any) {
    newsError.value = e.message
  } finally {
    newsLoading.value = false
  }
}

function openUrl(url: string) {
  window.open(url, '_blank')
}

const typeLabels: Record<string, string> = { news: '新闻', research: '研报', disclosure: '公告', weibo: '微博' }
function typeLabel(t: string) { return typeLabels[t] || t }

function fmtMarketCap(v?: number) {
  if (v == null) return '--'
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return String(v)
}

function fmtPe(v?: number) {
  if (v == null) return '--'
  if (v <= 0) return '亏损'
  return v.toFixed(2)
}

function cv(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
}

const option = computed(() => {
  const k = filteredKlines.value
  if (!k.length) return {}

  const dates = k.map(d => d.date || d.datetime || '')
  const ind = activeIndicators.value
  const ma = ind?.ma ?? {}
  const macd = ind?.macd ?? {}
  const rsiVals = ind?.rsi ?? []
  const macdData = macd.macd ?? []
  const signalData = macd.signal ?? []
  const histData = macd.histogram ?? []

  const c = chartColors.value
  const mc = histData.map((v: number) => v >= 0 ? c.macdUp : c.macdDown)

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: c.tooltipBg,
      borderColor: c.border,
      textStyle: { color: c.textPrimary, fontSize: 12 },
    },
    legend: {
      data: ['K线', 'MA5', 'MA20', 'MA60'],
      top: 0,
      textStyle: { color: c.textTertiary, fontSize: 11 },
      selectedMode: 'multiple',
    },
    grid: [
      { left: 56, right: 16, top: 36, height: '45%' },
      { left: 56, right: 16, top: '52%', height: '12%' },
      { left: 56, right: 16, top: '67%', height: '14%' },
      { left: 56, right: 16, top: '84%', height: '12%' },
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false } },
      { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false } },
      { type: 'category', data: dates, gridIndex: 2, axisLabel: { show: false } },
      { type: 'category', data: dates, gridIndex: 3, axisLabel: { color: c.textTertiary, fontSize: 10, interval: dateInterval.value } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.textTertiary, fontSize: 10 } },
      { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false }, max: volMax.value },
      { type: 'value', gridIndex: 2, splitLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.textTertiary, fontSize: 10 } },
      { type: 'value', gridIndex: 3, splitLine: { show: false }, axisLabel: { color: c.textTertiary, fontSize: 10 }, min: 0, max: 100 },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: 0, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1, 2, 3], bottom: 4, height: 16, borderColor: c.border, backgroundColor: c.bg, fillerColor: c.datazoomFiller, handleStyle: { color: c.brand }, textStyle: { color: c.textTertiary, fontSize: 10 } },
    ],
    series: [
      {
        name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0,
        data: k.map(d => [d.open, d.close, d.low, d.high]),
        itemStyle: { color: c.up, color0: c.down, borderColor: c.up, borderColor0: c.down },
      },
      {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: k.map((d, i) => ({
          value: d.volume,
          itemStyle: { color: i > 0 && d.close >= k[i - 1].close ? c.volUp : c.volDown }
        })),
      },
      ...(ma.MA5 ? [{ name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma.MA5, smooth: true, symbol: 'none', lineStyle: { width: 1, color: c.ma5 } }] : []),
      ...(ma.MA20 ? [{ name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma.MA20, smooth: true, symbol: 'none', lineStyle: { width: 1, color: c.ma20 } }] : []),
      ...(ma.MA60 ? [{ name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma.MA60, smooth: true, symbol: 'none', lineStyle: { width: 1, color: c.ma60 } }] : []),
      {
        name: 'MACD', type: 'bar', xAxisIndex: 2, yAxisIndex: 2,
        data: histData.map((v: number, i: number) => ({ value: v, itemStyle: { color: mc[i] } })),
      },
      { name: 'DIF', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: macdData, smooth: true, symbol: 'none', lineStyle: { width: 1, color: c.macdDif } },
      { name: 'DEA', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: signalData, smooth: true, symbol: 'none', lineStyle: { width: 1, color: c.macdDea } },
      {
        name: 'RSI', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: rsiVals,
        smooth: true, symbol: 'none', lineStyle: { width: 1, color: c.rsi },
        areaStyle: { color: c.rsiArea },
        markLine: {
          silent: true,
          data: [
            { yAxis: 70, lineStyle: { color: c.upDim, type: 'dashed' }, label: { formatter: '70', color: c.textTertiary, fontSize: 10 } },
            { yAxis: 30, lineStyle: { color: c.downDim, type: 'dashed' }, label: { formatter: '30', color: c.textTertiary, fontSize: 10 } },
          ],
        },
      },
    ].filter(Boolean),
  }
})
</script>

<template>
  <div class="stock-detail">
    <div class="detail-header">
      <button class="back-btn" @click="router.push({ name: 'dashboard' })">← 返回看板</button>
      <button v-if="auth.isLoggedIn && stockCode && !watchlist.isInWatchlist(stockCode)"
        class="add-wl-btn" @click="addToWatchlist">
        + 自选
      </button>
    </div>

    <div v-if="activeLoading && !activeKlines.length" class="loading-state">
      <div class="spinner" />
      <span>加载数据中...</span>
    </div>

    <div v-else-if="store.error && freq === 'day'" class="error-state">
      <span>⚠ {{ store.error }}</span>
      <button @click="store.selectStock(stockCode)">重试</button>
    </div>

    <template v-else-if="activeKlines.length">
      <div class="stock-info-bar">
        <div class="info-left">
          <h1 class="info-name">{{ fundamental?.name || store.stockName(stockCode) || stockCode }}</h1>
          <span class="info-code">{{ stockCode }}</span>
          <span class="info-date">{{ (currentBar?.date || currentBar?.datetime || '').slice(0, 10) }}</span>
        </div>
        <div class="info-right" v-if="currentBar">
          <span class="info-price" :class="priceChangePct >= 0 ? 'up-text' : 'down-text'">
            {{ currentBar.close.toFixed(2) }}
          </span>
          <span class="info-change" :class="priceChangePct >= 0 ? 'up-text' : 'down-text'">
            {{ priceChangePct >= 0 ? '+' : '' }}{{ priceChangePct.toFixed(2) }}%
          </span>
        </div>
      </div>

      <div v-if="watchlistError" class="error-banner">{{ watchlistError }}</div>

      <div v-if="fundamentalLoading" class="fundamental-loading">
        <span class="spinner" /> 加载基本面数据...
      </div>

      <div v-if="fundamental" class="fundamental-bar">
        <div class="funda-item">
          <span class="funda-label">市盈率<TermTip term="pe" /></span>
          <span class="funda-value" :class="Number(fundamental.pe) <= 0 ? 'down-text' : ''">{{ fmtPe(fundamental.pe) }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">市净率<TermTip term="pb" /></span>
          <span class="funda-value">{{ fundamental.pb != null ? fundamental.pb.toFixed(2) : '--' }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">ROE<TermTip term="roe" /></span>
          <span class="funda-value">{{ fundamental.roe != null ? fundamental.roe.toFixed(2) + '%' : '--' }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">总市值</span>
          <span class="funda-value">{{ fmtMarketCap(fundamental.marketCap) }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">流通市值</span>
          <span class="funda-value">{{ fmtMarketCap(fundamental.floatMarketCap) }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">股息率</span>
          <span class="funda-value">{{ fundamental.dividendYield != null ? fundamental.dividendYield.toFixed(2) + '%' : '--' }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">总股本</span>
          <span class="funda-value">{{ fundamental.shares != null ? (fundamental.shares / 10000).toFixed(2) + '亿' : '--' }}</span>
        </div>
        <div class="funda-item">
          <span class="funda-label">流通股本</span>
          <span class="funda-value">{{ fundamental.floatShares != null ? (fundamental.floatShares / 10000).toFixed(2) + '亿' : '--' }}</span>
        </div>
      </div>

      <div class="freq-selector">
        <button v-for="f in (['day', 'm5', 'm15', 'm30', 'm60'] as const)" :key="f"
          :class="{ active: freq === f }" @click="freq = f">
          {{ { day: '日线', m5: '5分', m15: '15分', m30: '30分', m60: '60分' }[f] }}
        </button>
      </div>

      <div class="range-selector">
        <button v-for="r in ['1M', '3M', '6M', '1Y', 'ALL']" :key="r"
          :class="{ active: range === r }" @click="range = r as any">
          {{ r }}
        </button>
      </div>

      <div class="card chart-card">
        <VChart :option="option" style="height: 580px" autoresize />
      </div>

      <div class="card news-section" v-if="stockCode">
        <div class="news-header" @click="showNews = !showNews">
          <span class="news-title">📰 AI 新闻情绪</span>
          <span v-if="newsSentiment" class="news-score" :class="'score-' + newsSentiment.label">
            {{ newsSentiment.label === 'positive' ? '利好' : newsSentiment.label === 'negative' ? '利空' : '中性' }}
            {{ newsSentiment.score > 0 ? '+' : '' }}{{ newsSentiment.score }}
          </span>
          <span class="news-toggle">{{ showNews ? '收起' : '展开' }}</span>
        </div>
        <div v-if="showNews" class="news-body">
          <div v-if="newsLoading" class="news-loading">AI 分析中...</div>
          <div v-else-if="newsError" class="news-error">{{ newsError }}</div>
          <div v-else-if="newsSentiment" class="news-result">
            <div class="news-reasoning">{{ newsSentiment.reasoning }}</div>
            <div class="news-items">
              <div v-for="(item, i) in newsSentiment.items" :key="i" class="news-item" @click="openUrl(item.url)">
                <div class="news-item-header">
                  <span class="news-type" :class="'type-' + item.type">{{ typeLabel(item.type) }}</span>
                  <span class="news-source">{{ item.source }}</span>
                  <span class="news-time">{{ item.time }}</span>
                </div>
                <div class="news-item-title">{{ item.title }}</div>
              </div>
            </div>
          </div>
          <div v-else-if="!newsLoading" class="news-hint">点击"AI 分析"查看新闻情绪</div>
        </div>
      </div>
    </template>

    <div v-else class="empty-state">
      <span>请在行情看板中选择一只股票</span>
    </div>
  </div>
</template>

<style scoped>
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.back-btn, .add-wl-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  transition: all var(--transition);
}
.back-btn:hover { border-color: var(--brand); color: var(--brand); }
.add-wl-btn:hover { border-color: var(--brand); color: var(--brand); }

.stock-info-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.info-left { display: flex; align-items: baseline; gap: 12px; }
.info-name { font-size: 22px; font-weight: 700; }
.info-code { font-size: 13px; color: var(--text-tertiary); }
.info-date { font-size: 12px; color: var(--text-tertiary); }
.info-right { display: flex; align-items: baseline; gap: 12px; }
.info-price { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.info-change { font-size: 16px; font-weight: 600; }

.freq-selector {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.freq-selector button {
  padding: 5px 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 11px;
  transition: all var(--transition);
}
.freq-selector button:hover { border-color: var(--brand); color: var(--brand); }
.freq-selector button.active {
  background: var(--brand-gradient);
  color: #0b0d14;
  border-color: var(--brand);
  font-weight: 600;
  box-shadow: 0 2px 8px var(--brand-glow);
}

.range-selector {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}
.range-selector button {
  padding: 5px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  transition: all var(--transition);
}
.range-selector button:hover { border-color: var(--brand); color: var(--brand); }
.range-selector button.active {
  background: var(--brand-gradient);
  color: #0b0d14;
  border-color: var(--brand);
  font-weight: 600;
  box-shadow: 0 2px 8px var(--brand-glow);
}

.chart-card { padding: 12px; }

.loading-state, .error-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 20px;
  color: var(--text-tertiary);
}
.spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.error-state button {
  padding: 6px 16px;
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  border-radius: var(--radius);
  cursor: pointer;
}
.error-banner {
  padding: 8px 12px;
  background: var(--danger-dim);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  color: var(--danger);
  font-size: 12px;
  margin-bottom: 12px;
}

.fundamental-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  color: var(--text-tertiary);
  font-size: 12px;
  margin-bottom: 12px;
}

.fundamental-bar {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-card);
}
.funda-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  gap: 3px;
  border-right: 1px solid var(--border);
}
.funda-item:last-child { border-right: none; }
.funda-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.4px; }
.funda-value { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); }

@media (min-width: 768px) {
  .stock-detail { padding: 24px 32px; }
}
@media (max-width: 640px) {
  .stock-detail { padding: 12px; }
  .detail-header { flex-wrap: wrap; gap: 8px; }
  .stock-info-bar { flex-direction: column; align-items: flex-start; gap: 8px; }
  .info-left { flex-wrap: wrap; gap: 6px; }
  .info-name { font-size: 18px; }
  .info-price { font-size: 22px; }
  .info-change { font-size: 14px; }
  .info-right { gap: 8px; }
  .range-selector { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 4px; }
  .range-selector::-webkit-scrollbar { display: none; }
  .range-selector button { flex-shrink: 0; font-size: 11px; padding: 4px 10px; }
  .freq-selector { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 4px; }
  .freq-selector::-webkit-scrollbar { display: none; }
  .freq-selector button { flex-shrink: 0; font-size: 10px; padding: 4px 8px; }
  .fundamental-bar { flex-wrap: wrap; gap: 0; }
  .funda-item { flex: 0 0 25%; box-sizing: border-box; padding: 8px 4px; border-bottom: 1px solid var(--border); }
  .funda-item:nth-child(4) { border-right: none; }
  .funda-item:nth-child(n+5) { border-bottom: none; }
  .funda-label { font-size: 9px; }
  .funda-value { font-size: 11px; }
  .chart-card { padding: 8px; }
  .chart-card > :deep(*) { height: 380px !important; }
}

.news-section { padding: 14px 16px; }
.news-header {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.news-title { font-size: 14px; font-weight: 600; flex: 1; }
.news-score {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
}
.score-positive { background: rgba(34,197,94,0.15); color: #22c55e; }
.score-negative { background: rgba(239,68,68,0.15); color: #ef4444; }
.score-neutral { background: rgba(245,158,11,0.15); color: #f59e0b; }
.news-toggle { font-size: 12px; color: var(--text-tertiary, #888); }
.news-body { margin-top: 12px; }
.btn-news {
  padding: 6px 14px;
  border: 1px solid var(--brand, #f59e0b);
  border-radius: 6px;
  background: rgba(245,158,11,0.1);
  color: var(--brand, #f59e0b);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 10px;
}
.btn-news:hover:not(:disabled) { background: var(--brand, #f59e0b); color: #000; }
.btn-news:disabled { opacity: 0.4; cursor: not-allowed; }
.news-error { color: #ef4444; font-size: 12px; margin-bottom: 8px; }
.news-hint { color: var(--text-tertiary, #888); font-size: 13px; padding: 12px 0; }
.news-result { }
.news-reasoning {
  font-size: 13px;
  color: var(--text-secondary, #aaa);
  padding: 10px 12px;
  background: var(--bg, #0d0d0d);
  border-radius: 8px;
  margin-bottom: 12px;
  line-height: 1.5;
}
.news-items { display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto; }
.news-item {
  padding: 8px 10px;
  background: var(--bg, #0d0d0d);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}
.news-item:hover { background: rgba(255,255,255,0.05); }
.news-item-header { display: flex; gap: 8px; font-size: 10px; color: var(--text-tertiary, #888); margin-bottom: 3px; align-items: center; }
.news-type {
  font-size: 9px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 3px;
  line-height: 16px;
}
.type-news { background: rgba(59,130,246,0.15); color: #3b82f6; }
.type-research { background: rgba(139,92,246,0.15); color: #8b5cf6; }
.type-disclosure { background: rgba(245,158,11,0.15); color: #f59e0b; }
.type-weibo { background: rgba(236,72,153,0.15); color: #ec4899; }
.news-source { font-weight: 600; }
.news-item-title { font-size: 12px; color: var(--text-primary, #fff); line-height: 1.4; }
</style>
