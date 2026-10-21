<script setup lang="ts">
import { ref, onMounted } from 'vue'
import VChart from 'vue-echarts'
import '../echarts-setup.js'

const historyCompetitions = ref<any[]>([])
const selectedComp = ref<any | null>(null)
const compData = ref<any | null>(null)
const loading = ref(false)
const error = ref('')

async function fetchHistory() {
  try {
    const res = await fetch('/api/paper/competitions/history/all')
    if (res.ok) historyCompetitions.value = await res.json()
  } catch (e: any) { error.value = e.message }
}

async function selectComp(comp: any) {
  selectedComp.value = comp
  compData.value = null
  loading.value = true
  try {
    const res = await fetch(`/api/paper/competitions/history/${comp.id}`)
    if (res.ok) compData.value = await res.json()
  } catch (e: any) { error.value = e.message }
  loading.value = false
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('zh-CN')
}

function fmtMoney(v: number) {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return v.toFixed(2)
}

function fmtReturn(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

const AGENT_COLORS: Record<string, string> = {
  deepseek: '#f97316',
  gpt4o: '#38bdf8',
  qwen: '#a78bfa',
  minimax: '#34d399',
}

function chartOption(data: any) {
  if (!data?.accountHistories?.length) return {}
  const series = data.accountHistories.map((ah: any) => {
    const color = AGENT_COLORS[ah.agentId] || '#94a3b8'
    return {
      name: ah.agentName,
      type: 'line',
      data: ah.snapshots.map((s: any) => Number(s.nav)),
      smooth: true,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      symbol: 'circle', symbolSize: 3,
    }
  })

  // 收集所有日期
  const allDates = data.accountHistories[0]?.snapshots.map((s: any) => s.date) || []

  return {
    legend: { top: 5, textStyle: { color: '#9ca3af', fontSize: 11 }, itemWidth: 12 },
    tooltip: { trigger: 'axis', formatter: (params: any) => {
      let html = `<b>${params[0]?.name || ''}</b><br/>`
      params.forEach((p: any) => {
        html += `${p.seriesName}: ${p.value?.toFixed(4) || '—'}<br/>`
      })
      return html
    }},
    grid: { left: 50, right: 20, top: 35, bottom: 25 },
    xAxis: { type: 'category', data: allDates, axisLabel: { fontSize: 10, color: '#6b7280' }, boundaryGap: false },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#6b7280', formatter: (v: number) => v.toFixed(3) },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    series,
  }
}

onMounted(fetchHistory)
</script>

<template>
  <div class="history-page">
    <div class="page-header">
      <h1>历史比赛</h1>
      <p class="subtitle">回顾过往 AI 炒股大赛的精彩对决</p>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- 历史比赛列表 -->
    <div v-if="!selectedComp" class="comp-list">
      <div v-if="!historyCompetitions.length && !loading" class="empty-state">
        <p>暂无历史比赛（结束的比赛会显示在这里）</p>
      </div>
      <div
        v-for="comp in historyCompetitions"
        :key="comp.id"
        class="comp-card"
        @click="selectComp(comp)"
      >
        <div class="comp-card-header">
          <h3>{{ comp.name }}</h3>
          <span class="badge-finished">已结束</span>
        </div>
        <div class="comp-card-info">
          <div class="info-row">
            <span class="info-label">初始资金</span>
            <span class="info-value">{{ fmtMoney(Number(comp.initialCash)) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">开始时间</span>
            <span class="info-value">{{ fmtDate(comp.startedAt) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">结束时间</span>
            <span class="info-value">{{ fmtDate(comp.finishedAt) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">单票上限</span>
            <span class="info-value">{{ (Number(comp.maxPositionRatio) * 100).toFixed(0) }}%</span>
          </div>
        </div>
        <div class="comp-card-action">点击查看详情 →</div>
      </div>
    </div>

    <!-- 比赛详情 -->
    <div v-else>
      <button class="back-btn" @click="selectedComp = null; compData = null">← 返回列表</button>

      <div class="comp-detail-header">
        <div>
          <h2>{{ selectedComp.name }}</h2>
          <p class="comp-dates">{{ fmtDate(selectedComp.startedAt) }} — {{ fmtDate(selectedComp.finishedAt) }}</p>
        </div>
        <div class="comp-params">
          <span>初始资金 {{ fmtMoney(Number(selectedComp.initialCash)) }}</span>
          <span>单票上限 {{ (Number(selectedComp.maxPositionRatio) * 100).toFixed(0) }}%</span>
          <span>日内新开仓 {{ selectedComp.dailyTradeLimit }} 次</span>
        </div>
      </div>

      <div v-if="loading" class="loading">加载中...</div>
      <template v-else-if="compData">
        <!-- 净值曲线对比 -->
        <div class="card">
          <h3 class="card-title">📈 净值走势对比</h3>
          <v-chart
            v-if="chartOption(compData).series?.length"
            :option="chartOption(compData)"
            style="height: 280px"
            autoresize
          />
          <div v-else class="empty-chart">暂无净值历史数据</div>
        </div>

        <!-- 最终排名 -->
        <div class="card">
          <h3 class="card-title">🏆 最终排名</h3>
          <table class="ranking-table">
            <thead>
              <tr>
                <th>#</th><th>Agent</th>
                <th class="num">累计收益率</th>
                <th class="num">最终净值</th>
                <th class="num">最终资产</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in compData.finalRanking" :key="r.agentId" :class="{ top3: Number(i) < 3 }">
                <td>
                  <span v-if="i === 0">🥇</span>
                  <span v-else-if="i === 1">🥈</span>
                  <span v-else-if="i === 2">🥉</span>
                  <span v-else class="rank-num">{{ Number(i) + 1 }}</span>
                </td>
                <td><span class="agent-name">{{ r.agentName }}</span></td>
                <td class="num" :class="r.totalReturn >= 0 ? 'up-text' : 'down-text'">{{ fmtReturn(r.totalReturn) }}</td>
                <td class="num">{{ (r.nav || 1).toFixed(4) }}</td>
                <td class="num">{{ fmtMoney(r.totalValue) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.history-page { padding: 24px 32px; max-width: 900px; }
.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.subtitle { font-size: 13px; color: var(--text-secondary); }
.error-msg { padding: 10px 14px; background: rgba(239,68,68,0.1); border: 1px solid var(--up); border-radius: var(--radius-sm); color: var(--up); font-size: 13px; margin-bottom: 16px; }
.loading, .empty-state, .empty-chart { text-align: center; padding: 32px; color: var(--text-tertiary); font-size: 13px; }

.comp-list { display: flex; flex-direction: column; gap: 12px; }
.comp-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px; cursor: pointer; transition: all 0.15s; }
.comp-card:hover { border-color: var(--brand); }
.comp-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.comp-card-header h3 { font-size: 15px; font-weight: 700; }
.badge-finished { font-size: 10px; padding: 1px 6px; border-radius: var(--radius); font-weight: 700; background: rgba(107,114,128,0.15); color: #6b7280; }
.comp-card-info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
.info-row { display: flex; flex-direction: column; gap: 2px; }
.info-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; }
.info-value { font-size: 13px; font-weight: 600; }
.comp-card-action { font-size: 12px; color: var(--brand); }

.back-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; margin-bottom: 16px; padding: 4px 0; }
.back-btn:hover { color: var(--brand); }

.comp-detail-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.comp-detail-header h2 { font-size: 18px; font-weight: 700; }
.comp-dates { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.comp-params { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); align-items: center; }

.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 24px; margin-bottom: 16px; }
.card-title { font-size: 14px; font-weight: 700; margin-bottom: 16px; }

.ranking-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ranking-table th { padding: 8px 12px; text-align: left; color: var(--text-tertiary); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
.ranking-table th.num { text-align: right; }
.ranking-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-light); }
.ranking-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.rank-num { font-size: 13px; color: var(--text-tertiary); font-weight: 600; }
.agent-name { font-weight: 700; }
.up-text { color: var(--up, #ef4444); font-weight: 600; }
.down-text { color: var(--down, #22c55e); font-weight: 600; }
</style>
