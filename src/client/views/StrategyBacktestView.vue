<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import TermTip from '../components/TermTip.vue'

const auth = useAuthStore()
const router = useRouter()

const loading = ref(false)
const running = ref(false)
const error = ref('')
const strategies = ref<any[]>([])
const recommendation = ref<any>(null)
const updatedAt = ref('')
const selectedKey = ref('')
const detailData = ref<any>(null)
const detailLoading = ref(false)

const STRATEGY_DEFS: Record<string, { label: string; desc: string; icon: string }> = {
  oversold_reversal: { label: '超卖反转', desc: 'RSI<30 + MACD金叉 + 跌幅大', icon: '↩' },
  volume_breakout: { label: '放量突破', desc: '量比>1.5 + 涨幅>3%', icon: '↑' },
  bottom_start: { label: '底部启动', desc: 'RSI<35 + 放量 + 小幅上涨', icon: '↗' },
  strong_pullback: { label: '强势回调', desc: 'RSI>50 + 回调>2% + 放量', icon: '↘' },
  bullish_composite: { label: '全面看多', desc: 'RSI>50 + MACD>0 + 均线多头', icon: '★' },
  extreme_oversold: { label: '极度超卖', desc: 'RSI<20 + 缩量', icon: '▼' },
}

const isRecommended = computed(() => {
  return (key: string) => recommendation.value?.strategyKey === key
})

const sortedStrategies = computed(() => {
  if (!strategies.value.length) return []
  return strategies.value.map(s => {
    const def = STRATEGY_DEFS[s.key] || { label: s.key, desc: '', icon: '◈' }
    const best = s.results?.[0]
    return {
      key: s.key,
      label: def.label,
      desc: def.desc,
      icon: def.icon,
      recommended: recommendation.value?.strategyKey === s.key,
      result: best,
    }
  }).sort((a, b) => {
    if (a.recommended && !b.recommended) return -1
    if (!a.recommended && b.recommended) return 1
    return (b.result?.annualReturn || 0) - (a.result?.annualReturn || 0)
  })
})

async function fetchResults() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/backtest/strategies/results', { headers: auth.authHeaders() })
    if (!res.ok) throw new Error('获取回测结果失败')
    const d = await res.json()
    strategies.value = d.strategies || []
    recommendation.value = d.recommendation
    updatedAt.value = d.updatedAt
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function triggerRun() {
  running.value = true
  error.value = ''
  try {
    const res = await fetch('/api/backtest/strategies/run', {
      method: 'POST',
      headers: { ...auth.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategyKey: 'all', topN: 5, initialCapital: 1000000 }),
    })
    if (!res.ok) throw new Error('回测计算失败')
    await fetchResults()
  } catch (e: any) {
    error.value = e.message
  } finally {
    running.value = false
  }
}

async function showDetail(key: string) {
  selectedKey.value = key
  detailLoading.value = true
  try {
    const res = await fetch(`/api/backtest/strategies/results/${key}`, { headers: auth.authHeaders() })
    if (res.ok) detailData.value = await res.json()
  } catch {} finally {
    detailLoading.value = false
  }
}

function goOptimize(key: string) {
  router.push({ name: 'strategy-optimize', query: { strategyKey: key } })
}

function formatPct(v: number | null | undefined) {
  if (v == null) return '--'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

function formatNum(v: number | null | undefined, decimals = 2) {
  if (v == null) return '--'
  return v.toFixed(decimals)
}

function timeAgo(ts: string | null) {
  if (!ts) return ''
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`
  return `${Math.floor(sec / 3600)}小时前`
}

function scoreBarClass(v: number) {
  if (v > 5) return 'positive'
  if (v < -2) return 'negative'
  return 'neutral'
}

onMounted(fetchResults)
</script>

<template>
  <div class="backtest-view">
    <div class="page-header">
      <div>
        <h1>📉 策略回测分析<TermTip term="strategyBacktest" /></h1>
        <p class="subtitle">对6个评分策略做全历史回测（含交易成本、持仓模拟、净值跟踪）</p>
      </div>
      <div class="header-actions">
        <span v-if="updatedAt" class="update-info">上次更新: {{ timeAgo(updatedAt) }}</span>
        <button class="compute-btn" :disabled="running" @click="triggerRun">
          {{ running ? '⏳ 计算中...' : '🔄 重新回测' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="loading && !strategies.length" class="loading-state">
      <div class="spinner"></div>
      <p>加载回测数据...</p>
    </div>

    <template v-else>
      <div v-if="recommendation" class="recommend-banner">
        <span class="rec-badge">🏆 推荐</span>
        <span class="rec-text">
          <strong>{{ STRATEGY_DEFS[recommendation.strategyKey]?.label || recommendation.strategyKey }}</strong>
          — 持有 {{ recommendation.holdingDays }} 天，综合评分 {{ recommendation.score }}
        </span>
        <button class="rec-btn" @click="showDetail(recommendation.strategyKey)">查看详情</button>
      </div>

      <div class="strategy-grid">
        <div
          v-for="s in sortedStrategies"
          :key="s.key"
          class="strategy-card"
          :class="{ recommended: s.recommended, selected: selectedKey === s.key }"
          @click="showDetail(s.key)"
        >
          <div v-if="s.recommended" class="card-rec-badge">推荐</div>

          <div class="card-header">
            <span class="card-icon">{{ s.icon }}</span>
            <div class="card-title-group">
              <span class="card-title">{{ s.label }}</span>
              <span class="card-desc">{{ s.desc }}</span>
            </div>
          </div>

          <div v-if="s.result" class="card-metrics">
            <div class="metric-row">
              <div class="metric">
                <span class="metric-label">年化<TermTip term="annualReturn" /></span>
                <span class="metric-value" :class="scoreBarClass(s.result.annualReturn)">
                  {{ formatPct(s.result.annualReturn) }}
                </span>
              </div>
              <div class="metric">
                <span class="metric-label">夏普<TermTip term="sharpe" /></span>
                <span class="metric-value">{{ formatNum(s.result.sharpe, 4) }}</span>
              </div>
            </div>
            <div class="metric-row">
              <div class="metric">
                <span class="metric-label">胜率<TermTip term="winRate" /></span>
                <span class="metric-value">{{ formatNum(s.result.winRate) }}%</span>
              </div>
              <div class="metric">
                <span class="metric-label">回撤<TermTip term="maxDrawdown" /></span>
                <span class="metric-value negative">{{ formatNum(s.result.maxDrawdown) }}%</span>
              </div>
            </div>
            <div class="metric-row meta">
              <span>交易 {{ s.result.tradeCount }} 次</span>
              <span>均持 {{ s.result.avgHoldDays }} 天</span>
            </div>
          </div>

          <div v-else class="no-data">暂无回测数据</div>
        </div>
      </div>

      <div v-if="detailData" class="detail-panel">
        <div class="detail-header">
          <h2>{{ STRATEGY_DEFS[detailData.key]?.label || detailData.key }} 详细回测</h2>
          <button class="ga-btn" @click="goOptimize(detailData.key)">🎯 一键GA优化此策略</button>
        </div>

        <div v-if="detailData.equityCurve?.length" class="equity-section">
          <h3>净值曲线<TermTip term="equityCurve" /></h3>
          <div class="equity-chart">
            <div class="chart-summary">
              <span class="chart-stat">
                起始: ¥{{ (detailData.stats.totalReturn != null ? (1000000 * (1 - detailData.stats.totalReturn / 100)) : 1000000).toFixed(0) }}
              </span>
              <span class="chart-stat">
                终值: ¥{{ (detailData.equityCurve[detailData.equityCurve.length - 1]?.value || 0).toFixed(0) }}
              </span>
            </div>
          </div>
        </div>

        <div class="holding-periods">
          <h3>持有周期收益<TermTip term="holdingPeriod" /></h3>
          <div class="period-grid">
            <div class="period-cell">
              <span class="period-label">1日</span>
              <span class="period-value" :class="scoreBarClass(detailData.stats.return1d)">{{ formatPct(detailData.stats.return1d) }}</span>
            </div>
            <div class="period-cell">
              <span class="period-label">3日</span>
              <span class="period-value" :class="scoreBarClass(detailData.stats.return3d)">{{ formatPct(detailData.stats.return3d) }}</span>
            </div>
            <div class="period-cell">
              <span class="period-label">5日</span>
              <span class="period-value" :class="scoreBarClass(detailData.stats.return5d)">{{ formatPct(detailData.stats.return5d) }}</span>
            </div>
            <div class="period-cell">
              <span class="period-label">10日</span>
              <span class="period-value" :class="scoreBarClass(detailData.stats.return10d)">{{ formatPct(detailData.stats.return10d) }}</span>
            </div>
          </div>
        </div>

        <div v-if="detailData.trades?.length" class="trades-section">
          <h3>最近交易 ({{ detailData.trades.length }} 笔)</h3>
          <div class="table-wrap">
            <table class="trade-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>股票</th>
                  <th>买入</th>
                  <th>卖出</th>
                  <th>持仓</th>
                  <th>收益</th>
                  <th>评分</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in detailData.trades.slice(-20)" :key="t.entryDate + t.code">
                  <td>{{ t.entryDate }}</td>
                  <td>
                    <span class="stock-name">{{ t.name }}</span>
                    <span class="stock-code">{{ t.code }}</span>
                  </td>
                  <td>{{ t.entryPrice.toFixed(2) }}</td>
                  <td>{{ t.exitPrice.toFixed(2) }}</td>
                  <td>{{ t.holdingDays }}天</td>
                  <td>
                    <span :class="t.returnPct >= 0 ? 'up' : 'down'">
                      {{ t.returnPct >= 0 ? '+' : '' }}{{ t.returnPct.toFixed(2) }}%
                    </span>
                  </td>
                  <td>{{ t.score }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.backtest-view { padding: 20px; max-width: 1000px; margin: 0 auto; }

.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.page-header h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.subtitle { font-size: 12px; color: var(--text-tertiary); margin: 0; }

.header-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.update-info { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }

.compute-btn {
  padding: 8px 16px;
  border: none;
  background: var(--brand-gradient);
  color: #0b0d14;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.compute-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.recommend-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, rgba(139,92,246,0.15), rgba(245,158,11,0.1));
  border: 1px solid rgba(139,92,246,0.3);
  border-radius: var(--radius-md);
  font-size: 13px;
}
.rec-badge {
  padding: 3px 10px;
  border-radius: 4px;
  background: var(--brand-gradient);
  color: #0b0d14;
  font-weight: 700;
  font-size: 12px;
}
.rec-text { flex: 1; color: var(--text-primary); }
.rec-btn {
  padding: 5px 12px;
  border: 1px solid var(--brand);
  background: transparent;
  color: var(--brand);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}
.rec-btn:hover { background: rgba(139,92,246,0.1); }

.strategy-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.strategy-card {
  position: relative;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition);
}
.strategy-card:hover { border-color: var(--brand); transform: translateY(-1px); }
.strategy-card.recommended { border-color: var(--brand); box-shadow: 0 0 12px rgba(139,92,246,0.2); }
.strategy-card.selected { border-color: var(--brand); background: rgba(139,92,246,0.05); }

.card-rec-badge {
  position: absolute;
  top: -1px;
  right: 12px;
  padding: 2px 8px;
  background: var(--brand-gradient);
  color: #0b0d14;
  font-size: 10px;
  font-weight: 700;
  border-radius: 0 0 4px 4px;
}

.card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.card-icon { font-size: 18px; }
.card-title-group { display: flex; flex-direction: column; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.card-desc { font-size: 11px; color: var(--text-tertiary); }

.card-metrics { display: flex; flex-direction: column; gap: 6px; }
.metric-row { display: flex; gap: 12px; }
.metric { display: flex; justify-content: space-between; flex: 1; }
.metric-label { font-size: 11px; color: var(--text-tertiary); }
.metric-value { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.metric-row.meta { font-size: 11px; color: var(--text-tertiary); justify-content: space-between; }

.no-data { font-size: 12px; color: var(--text-tertiary); text-align: center; padding: 20px; }
.positive { color: var(--up); }
.negative { color: var(--down); }
.neutral { color: var(--text-secondary); }

.detail-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.detail-header h2 { font-size: 16px; font-weight: 600; margin: 0; }

.ga-btn {
  padding: 7px 14px;
  border: none;
  background: linear-gradient(135deg, #f59e0b, #e87933);
  color: #0b0d14;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ga-btn:hover { opacity: 0.9; }

.equity-section { margin-bottom: 20px; }
.equity-section h3,
.holding-periods h3,
.trades-section h3 { font-size: 14px; font-weight: 600; margin: 0 0 10px; }

.equity-chart { background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; }
.chart-line { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
.chart-bar { flex: 1; background: var(--brand-gradient); border-radius: 1px 1px 0 0; min-height: 2px; }
.chart-labels { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-tertiary); margin-top: 4px; }

.holding-periods { margin-bottom: 20px; }
.period-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.period-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.period-label { font-size: 11px; color: var(--text-tertiary); }
.period-value { font-size: 15px; font-weight: 700; }

.trade-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.trade-table th,
.trade-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
.trade-table th { font-weight: 600; color: var(--text-tertiary); font-size: 11px; }
.stock-name { margin-right: 4px; }
.stock-code { color: var(--text-tertiary); font-size: 11px; }
.up { color: var(--up); }
.down { color: var(--down); }

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.6s linear infinite; }

.error-banner {
  padding: 10px 14px;
  margin-bottom: 12px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: var(--radius-sm);
  color: #ef4444;
  font-size: 13px;
}

.chart-summary {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
}
.chart-stat { color: var(--text-secondary); }

.table-wrap { overflow-x: auto; }

@media (min-width: 768px) {
  .backtest-view { padding: 24px 32px; }
}
@media (max-width: 768px) {
  .page-header { flex-direction: column; gap: 8px; }
  .strategy-grid { grid-template-columns: repeat(2, 1fr); }
  .period-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .strategy-grid { grid-template-columns: 1fr; }
  .header-actions { flex-direction: column; align-items: stretch; width: 100%; }
}
</style>
