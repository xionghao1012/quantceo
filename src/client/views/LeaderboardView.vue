<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useStockStore } from '../stores/stock'
import TermTip from '../components/TermTip.vue'

const router = useRouter()
const store = useStockStore()

const loading = ref(true)
const list = ref<any[]>([])
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/backtest/leaderboard?limit=100')
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    list.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

function viewStock(code: string) {
  store.selectStock(code)
  router.push(`/stock/${code}`)
}

function fmtDate(d: string) {
  return d ? d.slice(0, 10) : ''
}

function fmtCreatedAt(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function rankBadge(rank: number) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return ''
}

function totalReturnBracket(r: number) {
  if (r >= 30) return 'elite'
  if (r >= 10) return 'strong'
  if (r >= 0) return 'positive'
  if (r >= -10) return 'slight-negative'
  return 'negative'
}

function downloadCSV() {
  const header = ['排名', '代码', '开始日期', '结束日期', '总收益(%)', '年化收益(%)', '夏普', '最大回撤(%)', '胜率(%)', '交易次数', '回测时间']
  const rows = list.value.map((item, i) => [
    i + 1, item.code, fmtDate(item.startDate), fmtDate(item.endDate),
    item.totalReturn.toFixed(2), item.annualReturn.toFixed(2), item.sharpe.toFixed(2),
    item.maxDrawdown.toFixed(2), item.winRate.toFixed(1), item.tradeCount,
    item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
  ])
  const csv = '\uFEFF' + [header, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `leaderboard_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="leaderboard-view">
    <div class="page-header">
      <div class="header-left">
        <h1>收益排行榜</h1>
        <span class="stock-count">{{ list.length }} 条记录</span>
      </div>
      <button v-if="list.length" class="btn-outline" @click="downloadCSV">
        <span class="icon">↓</span> 导出CSV
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner" />
      <span>加载排行榜...</span>
    </div>

    <div v-if="error" class="error-banner">⚠ {{ error }}</div>

    <template v-if="!loading && list.length">
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-rank">#</th>
                <th class="col-code">代码</th>
                <th class="col-date">回测区间</th>
                <th class="col-num">总收益<TermTip term="totalReturn" /></th>
                <th class="col-num">年化<TermTip term="annualReturn" /></th>
                <th class="col-num">夏普<TermTip term="sharpe" /></th>
                <th class="col-num">最大回撤<TermTip term="maxDrawdown" /></th>
                <th class="col-num">胜率<TermTip term="winRate" /></th>
                <th class="col-num">交易<TermTip term="tradeCount" /></th>
                <th class="col-time">回测时间</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, i) in list"
                :key="item.id"
                class="stock-row"
                :class="[`top-${i < 3 ? i + 1 : ''}`, totalReturnBracket(item.totalReturn)]"
                @click="viewStock(item.code)"
              >
                <td class="col-rank">
                  <span v-if="i < 3" class="rank-badge">{{ rankBadge(i + 1) }}</span>
                  <span v-else class="rank-num">{{ i + 1 }}</span>
                </td>
                <td class="col-code">
                  <span class="stock-code">{{ item.code }}</span>
                </td>
                <td class="col-date">
                  <span class="date-range">{{ fmtDate(item.startDate) }} → {{ fmtDate(item.endDate) }}</span>
                </td>
                <td class="col-num" :class="item.totalReturn >= 0 ? 'up' : 'down'">
                  <span class="metric-bar" :class="totalReturnBracket(item.totalReturn)">
                    {{ item.totalReturn >= 0 ? '+' : '' }}{{ item.totalReturn.toFixed(1) }}%
                  </span>
                </td>
                <td class="col-num" :class="item.annualReturn >= 0 ? 'up' : 'down'">{{ item.annualReturn >= 0 ? '+' : '' }}{{ item.annualReturn.toFixed(1) }}%</td>
                <td class="col-num">{{ item.sharpe.toFixed(2) }}</td>
                <td class="col-num down">{{ item.maxDrawdown.toFixed(1) }}%</td>
                <td class="col-num">{{ item.winRate.toFixed(0) }}%</td>
                <td class="col-num">{{ item.tradeCount }}</td>
                <td class="col-time">{{ fmtCreatedAt(item.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-if="!loading && !list.length && !error" class="loading-state">
      <span>暂无回测数据，请先运行组合回测</span>
    </div>
  </div>
</template>

<style scoped>
.leaderboard-view {
  padding: 24px 32px;
  max-width: 1280px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.page-header h1 {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}
.stock-count {
  font-size: 13px;
  color: var(--text-tertiary, #888);
}

.card {
  background: var(--bg-secondary, #1a1a2e);
  border: 1px solid var(--border-color, #2a2a3e);
  border-radius: 12px;
  overflow: hidden;
}
.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  white-space: nowrap;
}

thead {
  position: sticky;
  top: 0;
  z-index: 2;
}
th {
  background: var(--bg-secondary, #1a1a2e);
  padding: 12px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, #888);
  border-bottom: 1px solid var(--border-color, #2a2a3e);
  text-align: left;
  user-select: none;
}
th:first-child { padding-left: 20px; }
th:last-child { padding-right: 20px; }

td {
  padding: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  transition: background 0.12s;
  cursor: pointer;
}
td:first-child { padding-left: 20px; }
td:last-child { padding-right: 20px; }

.stock-row:hover td {
  background: rgba(139, 92, 246, 0.06);
}

.stock-row.top-1 td { background: rgba(240, 180, 41, 0.04); }
.stock-row.top-1:hover td { background: rgba(240, 180, 41, 0.10); }
.stock-row.top-2 td { background: rgba(192, 192, 192, 0.03); }
.stock-row.top-2:hover td { background: rgba(192, 192, 192, 0.08); }
.stock-row.top-3 td { background: rgba(205, 127, 50, 0.03); }
.stock-row.top-3:hover td { background: rgba(205, 127, 50, 0.08); }

.col-rank { width: 48px; }
.col-code { width: 80px; }
.col-date { min-width: 160px; }
.col-num { width: 76px; text-align: right; }
.col-time { width: 80px; text-align: right; color: var(--text-tertiary, #888); font-size: 11px; }

.rank-num { font-size: 12px; color: var(--text-tertiary, #888); font-weight: 500; }
.rank-badge { font-size: 16px; }

.stock-code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.date-range {
  font-size: 12px;
  color: var(--text-secondary, #aaa);
}

.up { color: #22c55e; font-weight: 600; }
.down { color: #ef4444; font-weight: 600; }

.metric-bar {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 700;
}
.metric-bar.elite { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.metric-bar.strong { background: rgba(34, 197, 94, 0.10); color: #22c55e; }
.metric-bar.positive { background: rgba(34, 197, 94, 0.06); color: #4ade80; }
.metric-bar.slight-negative { background: rgba(239, 68, 68, 0.06); color: #f87171; }
.metric-bar.negative { background: rgba(239, 68, 68, 0.10); color: #ef4444; }

.btn-outline {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border-color, #2a2a3e);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #ccc);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-outline:hover {
  border-color: var(--accent, #8b5cf6);
  color: var(--accent, #8b5cf6);
}
.icon { font-size: 14px; }

.error-banner {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--text-tertiary, #888);
  font-size: 14px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border-color, #333);
  border-top-color: #8b5cf6;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .leaderboard-view { padding: 16px; }
  .col-time, th.col-time { display: none; }
  .col-date { min-width: 120px; }
  .col-num { width: 64px; }
}

@media (max-width: 640px) {
  .leaderboard-view { padding: 12px; }
  .page-header h1 { font-size: 18px; }
  table { font-size: 11px; }
  th, td { padding: 7px 6px; }
  th:first-child, td:first-child { padding-left: 10px; }
  th:last-child, td:last-child { padding-right: 10px; }
  .col-date { min-width: 100px; }
  .stock-code { font-size: 11px; }
  .col-num { width: 54px; }
  .date-range { font-size: 10px; }
  .col-time, th.col-time { display: none; }
}
</style>
