<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import TermTip from '../components/TermTip.vue'

const auth = useAuthStore()
const router = useRouter()

const loading = ref(false)
const error = ref('')
const data = ref<any>(null)
const selectedIndex = ref('000300')

const indexOptions = [
  { code: '000300', name: '沪深300' },
  { code: '000001', name: '上证指数' },
]

const stateConfig: Record<string, { label: string; color: string; bg: string; icon: string; desc: string }> = {
  trending_up: { label: '上涨趋势', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: '📈', desc: '市场处于上升趋势，均线多头排列，适合顺势做多' },
  oversold: { label: '超卖反弹', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', icon: '🔔', desc: '市场短期超卖，可能存在反弹机会，关注逆向买入信号' },
  range_bound: { label: '区间震荡', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '↔️', desc: '市场缺乏方向，震荡整理，高抛低吸为主' },
  breakout: { label: '突破上行', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: '🚀', desc: '价格突破关键阻力，趋势强劲，短线顺势追入' },
  bearish: { label: '下跌趋势', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: '📉', desc: '市场处于下降趋势，均线空头排列，建议观望或做空' },
}

const directionColor: Record<string, string> = {
  BUY: '#22c55e',
  SELL: '#ef4444',
}

async function fetchState() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/market/state?index=${selectedIndex.value}`, { headers: auth.authHeaders() })
    if (!res.ok) {
      const e = await res.json()
      throw new Error(e.error || '获取失败')
    }
    data.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function stateInfo(state: string) {
  return stateConfig[state] || stateConfig.range_bound
}

function goStrategy() {
  router.push('/scan')
}

onMounted(() => {
  fetchState()
})
</script>

<template>
  <div class="market-state-view">
    <div class="page-header">
      <div>
        <h1>🌡️ 市场状态</h1>
        <p class="subtitle">基于指数技术指标判断当前市场状态，匹配适合的策略</p>
      </div>
      <select v-model="selectedIndex" class="index-select" @change="fetchState">
        <option v-for="idx in indexOptions" :key="idx.code" :value="idx.code">
          {{ idx.name }}
        </option>
      </select>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="loading && !data" class="loading-state">
      <div class="spinner"></div>
      <p>正在分析市场状态...</p>
    </div>

    <template v-else-if="data">
      <div class="state-hero" :style="{ background: stateInfo(data.state).bg, borderColor: stateInfo(data.state).color }">
        <div class="state-icon">{{ stateInfo(data.state).icon }}</div>
        <div class="state-main">
          <div class="state-name" :style="{ color: stateInfo(data.state).color }">
            {{ stateInfo(data.state).label }}
          </div>
          <div class="state-desc">{{ stateInfo(data.state).desc }}</div>
        </div>
        <div class="index-info">
          <div class="index-price">{{ data.indexName }} {{ data.indexPrice }}</div>
          <div class="index-change" :class="data.indexChange >= 0 ? 'up' : 'down'">
            {{ data.indexChange >= 0 ? '+' : '' }}{{ data.indexChange.toFixed(2) }}%
          </div>
        </div>
      </div>

      <div class="indicators-grid">
        <div class="ind-card">
          <span class="ind-label">RSI(14)<TermTip term="rsi" /></span>
          <span class="ind-value" :class="data.indicators.rsi > 70 ? 'overbought' : data.indicators.rsi < 30 ? 'oversold' : ''">
            {{ data.indicators.rsi }}
          </span>
          <span class="ind-hint">{{ data.indicators.rsi < 30 ? '超卖' : data.indicators.rsi > 70 ? '超买' : '正常' }}</span>
        </div>
        <div class="ind-card">
          <span class="ind-label">MACD信号<TermTip term="macd" /></span>
          <span class="ind-value" :class="data.indicators.macdSignal === 'bullish' ? 'up' : 'down'">
            {{ data.indicators.macdSignal === 'bullish' ? '金叉' : '死叉' }}
          </span>
          <span class="ind-hint">{{ data.indicators.macdHistogram > 0 ? '正向' : '负向' }} {{ data.indicators.macdHistogram }}</span>
        </div>
        <div class="ind-card">
          <span class="ind-label">MA趋势<TermTip term="ma" /></span>
          <span class="ind-value" :class="data.indicators.trend === 'up' ? 'up' : data.indicators.trend === 'down' ? 'down' : ''">
            {{ data.indicators.trend === 'up' ? '多头' : data.indicators.trend === 'down' ? '空头' : '中性' }}
          </span>
          <span class="ind-hint">MA5 {{ data.indicators.ma5 }} / MA20 {{ data.indicators.ma20 }}<TermTip term="ma" /></span>
        </div>
        <div class="ind-card">
          <span class="ind-label">MA60<TermTip term="ma" /></span>
          <span class="ind-value">{{ data.indicators.ma60 }}</span>
          <span class="ind-hint">中长期均线</span>
        </div>
      </div>

      <div class="strategies-section">
        <div class="section-header">
          <h3>适合当前状态的策略</h3>
          <button class="scan-btn" @click="goStrategy">去扫描 →</button>
        </div>
        <div class="strategies-list">
          <div
            v-for="s in data.recommendedStrategies"
            :key="`${s.id}-${s.direction}`"
            class="strategy-card"
          >
            <div class="str-header">
              <span class="str-name">{{ s.name }}</span>
              <span class="str-dir" :style="{ color: directionColor[s.direction], background: directionColor[s.direction] + '20' }">
                {{ s.direction === 'BUY' ? '买入' : '卖出' }}
              </span>
            </div>
            <div class="str-desc">{{ s.description }}</div>
          </div>
        </div>
      </div>

      <div class="updated-at">
        更新时间：{{ new Date(data.updatedAt).toLocaleTimeString('zh-CN') }}
        <button class="refresh-btn" @click="fetchState" :disabled="loading">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.market-state-view {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-header h1 {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 4px;
}

.subtitle {
  font-size: 13px;
  color: var(--text-tertiary, #888);
  margin: 0;
}

.index-select {
  padding: 8px 12px;
  background: var(--bg, #0d0d0d);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  color: var(--text-primary, #fff);
  font-size: 14px;
  cursor: pointer;
}

.error-banner {
  padding: 10px 16px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: 8px;
  color: #ef4444;
  font-size: 13px;
  margin-bottom: 16px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-tertiary, #888);
}

.spinner {
  width: 28px; height: 28px;
  border: 2px solid var(--border, #333);
  border-top-color: #f59e0b;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.state-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid;
  border-radius: 14px;
  margin-bottom: 16px;
}

.state-icon { font-size: 40px; }

.state-main { flex: 1; }

.state-name { font-size: 22px; font-weight: 700; margin-bottom: 4px; }

.state-desc { font-size: 13px; color: var(--text-secondary, #aaa); line-height: 1.4; }

.index-info { text-align: right; }
.index-price { font-size: 14px; font-weight: 600; }
.index-change { font-size: 18px; font-weight: 700; }
.up { color: #ef4444; }
.down { color: #22c55e; }

.indicators-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

@media (min-width: 768px) {
  .market-state-view { padding: 24px 32px; }
}
@media (max-width: 600px) {
  .indicators-grid { grid-template-columns: repeat(2, 1fr); }
}

.ind-card {
  background: var(--bg, #0d0d0d);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.ind-label { font-size: 11px; color: var(--text-tertiary, #888); }
.ind-value { font-size: 20px; font-weight: 700; }
.ind-value.up { color: #ef4444; }
.ind-value.down { color: #22c55e; }
.ind-value.overbought { color: #f59e0b; }
.ind-value.oversold { color: #22c55e; }
.ind-hint { font-size: 10px; color: var(--text-tertiary, #888); }

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-header h3 { margin: 0; font-size: 15px; font-weight: 600; }

.scan-btn {
  padding: 6px 12px;
  background: rgba(245,158,11,0.15);
  border: 1px solid rgba(245,158,11,0.3);
  border-radius: 6px;
  color: #f59e0b;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.scan-btn:hover { background: rgba(245,158,11,0.25); }

.strategies-list { display: flex; flex-direction: column; gap: 8px; }

.strategy-card {
  background: var(--bg, #0d0d0d);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 12px 14px;
}

.str-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.str-name { font-size: 14px; font-weight: 600; }

.str-dir {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.str-desc { font-size: 12px; color: var(--text-secondary, #aaa); }

.updated-at {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
  font-size: 11px;
  color: var(--text-tertiary, #666);
}

.refresh-btn {
  padding: 4px 10px;
  background: var(--brand, #f59e0b);
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #000;
  cursor: pointer;
}
.refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
