<script setup lang="ts">
import { ref, onMounted } from 'vue'
import EmptyState from '../components/EmptyState.vue'


const alerts = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const timeRange = ref<'today' | '7d' | '30d'>('7d')

async function fetchHistory() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/moneyflow/alerts')
    if (!res.ok) throw new Error('获取历史告警失败')
    const all = await res.json()
    const now = new Date()
    const cutoffs: Record<string, number> = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
      '7d': Date.now() - 7 * 86400_000,
      '30d': Date.now() - 30 * 86400_000,
    }
    alerts.value = all.filter((a: any) => new Date(a.createdAt).getTime() >= cutoffs[timeRange.value])
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function formatTime(ts: string) {
  const d = new Date(ts)
  return `${d.getMonth()+1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

function getDetail(detail: any) {
  return detail?.reason || detail?.message || ''
}

onMounted(fetchHistory)
</script>

<template>
  <div class="history-view">
    <div class="page-header">
      <h1>告警历史</h1>
      <div class="time-filter">
        <button
          v-for="opt in ['today', '7d', '30d'] as const"
          :key="opt"
          :class="{ active: timeRange === opt }"
          @click="timeRange = opt; fetchHistory()"
        >
          {{ { today: '今天', '7d': '近7天', '30d': '近30天' }[opt] }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading && !alerts.length" class="loading">加载中...</div>
    <EmptyState v-else-if="!alerts.length" variant="list" text="暂无告警记录" />

    <div v-else class="alert-table-wrap">
      <table class="alert-table">
        <thead>
          <tr>
            <th>触发时间</th>
            <th>股票</th>
            <th>触发原因</th>
            <th>推送状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in alerts" :key="a.id" class="alert-row">
            <td class="alert-time">{{ formatTime(a.createdAt) }}</td>
            <td class="alert-stock">
              <span class="stock-name">{{ a.name }}</span>
              <span class="stock-code">{{ a.code }}</span>
            </td>
            <td class="alert-reason">{{ getDetail(a.detail) }}</td>
            <td class="alert-status">
              <span class="status-dot" :class="a.notified ? 'notified' : 'pending'"></span>
              {{ a.notified ? '已推送' : '未推送' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.history-view { padding: 24px 32px; max-width: 900px; }

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.page-header h1 { font-size: 18px; font-weight: 700; }

.time-filter { display: flex; gap: 4px; }
.time-filter button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.time-filter button.active { background: var(--brand-glow); border-color: var(--brand); color: var(--brand); font-weight: 600; }
.time-filter button:hover:not(.active) { border-color: var(--brand); color: var(--brand); }

.error-msg {
  padding: 10px 14px;
  background: rgba(239,68,68,0.1);
  border: 1px solid var(--up);
  border-radius: var(--radius);
  color: var(--up);
  font-size: 13px;
  margin-bottom: 16px;
}

.loading, .empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.alert-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.alert-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.alert-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 10px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.alert-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.alert-row:last-child td { border-bottom: none; }
.alert-row:hover { background: rgba(255, 255, 255, 0.02); }

.alert-time { color: var(--text-tertiary); font-size: 12px; white-space: nowrap; }

.alert-stock { display: flex; flex-direction: column; gap: 2px; }
.stock-name { font-weight: 700; color: var(--text-primary); }
.stock-code { font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }

.alert-reason { color: var(--text-secondary); }

.alert-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
}
.status-dot.notified { background: var(--down); }
.status-dot.pending { background: var(--text-tertiary); }
</style>
