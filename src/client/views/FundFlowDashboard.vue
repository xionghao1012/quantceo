<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import QuickAlertModal from '../components/QuickAlertModal.vue'

const router = useRouter()
const auth = useAuthStore()

const range = ref<'1d' | '5d' | '10d' | '20d'>('1d')
const order = ref<'inflow' | 'outflow'>('inflow')
const sortBy = ref<'inflow' | 'inflowRate'>('inflow')
const loading = ref(false)
const error = ref('')
const data = ref<any[]>([])
const lastUpdate = ref('')
const showExportModal = ref(false)
const exportType = ref<'csv' | 'excel'>('csv')
const exportLoading = ref(false)
const exportTasks = ref<any[]>([])
const quickAlertStock = ref<{ code: string; name: string } | null>(null)

async function fetchTop20() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      window: range.value,
      order: order.value,
      sortBy: sortBy.value,
    })
    const res = await fetch(`/api/moneyflow/top20?${params}`)
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || '获取失败') }
    const result = await res.json()
    data.value = result.data || []
    lastUpdate.value = range.value === '1d' && data.value[0]?.updateTime
      ? new Date(data.value[0].updateTime).toLocaleTimeString('zh-CN')
      : new Date().toLocaleTimeString('zh-CN')
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function fetchExportTasks() {
  const res = await fetch('/api/export/tasks')
  if (res.ok) exportTasks.value = await res.json()
}

async function createExport() {
  exportLoading.value = true
  try {
    const res = await fetch('/api/export/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: exportType.value,
        params: { scope: 'market' }
      }),
    })
    const task = await res.json()
    showExportModal.value = false
    if (task.downloadUrl) {
      window.open(task.downloadUrl, '_blank')
    }
    await fetchExportTasks()
  } finally {
    exportLoading.value = false
  }
}

function viewStock(code: string) {
  router.push({ name: 'stock-detail', params: { code } })
}

function openQuickAlert(stock: { code: string; name: string }) {
  quickAlertStock.value = stock
}

function fmtInflow(v: number) {
  if (v == null) return '--'
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return String(v)
}

function fmtPct(v: number) {
  if (v == null) return '--'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

let refreshTimer: ReturnType<typeof setInterval>

onMounted(() => {
  fetchTop20()
  fetchExportTasks()
  if (range.value === '1d') {
    refreshTimer = setInterval(fetchTop20, 5000)
  }
})

onUnmounted(() => {
  clearInterval(refreshTimer)
})

watch(range, (w) => {
  clearInterval(refreshTimer)
  fetchTop20()
  if (w === '1d') {
    refreshTimer = setInterval(fetchTop20, 5000)
  }
})
</script>

<template>
  <div class="fund-flow-dashboard">
    <div class="page-header">
      <h1>主力资金 TOP 20</h1>
      <div class="header-actions">
        <span v-if="lastUpdate" class="update-time">更新: {{ lastUpdate }}</span>
        <button v-if="auth.isLoggedIn" class="manage-btn" @click="router.push('/fund-flow/alerts')">管理告警</button>
        <button class="export-btn" @click="showExportModal = true">导出</button>
        <button class="refresh-btn" @click="fetchTop20" :disabled="loading">
          ↻ {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="tab-bar">
      <button :class="{ active: range === '1d' }" @click="range = '1d'">1日</button>
      <button :class="{ active: range === '5d' }" @click="range = '5d'">5日</button>
      <button :class="{ active: range === '10d' }" @click="range = '10d'">10日</button>
      <button :class="{ active: range === '20d' }" @click="range = '20d'">20日</button>
      <span class="tab-divider"></span>
      <button :class="{ active: order === 'inflow' }" @click="order = 'inflow'; fetchTop20()">
        净流入
      </button>
      <button :class="{ active: order === 'outflow' }" @click="order = 'outflow'; fetchTop20()">
        净流出
      </button>
      <span class="tab-divider"></span>
      <button :class="{ active: sortBy === 'inflow' }" @click="sortBy = 'inflow'; fetchTop20()">
        按净流入额
      </button>
      <button :class="{ active: sortBy === 'inflowRate' }" @click="sortBy = 'inflowRate'; fetchTop20()">
        按净流入率
      </button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <div v-if="loading && !data.length" class="loading">
      <span class="spinner"></span>加载中...
    </div>

    <div v-else-if="!data.length && !error" class="empty-state">
      <p>该周期暂无资金流数据</p>
      <p class="empty-hint">数据源未同步时会显示此状态，可稍后刷新重试</p>
    </div>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>股票名称</th>
          <th>股票代码</th>
          <th>累计净流入</th>
          <th>均净流入率</th>
          <th v-if="range === '1d'">最新价</th>
          <th v-if="range !== '1d'">今日净流入</th>
          <th>走势</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in data" :key="r.code" class="clickable-row" @click="viewStock(r.code)">
          <td class="rank-cell" :class="{ top3: i < 3 }">{{ r.rank || i + 1 }}</td>
          <td class="name-cell">{{ r.name }}</td>
          <td class="code-cell">{{ r.code }}</td>
          <td class="amount-cell" :class="r.netInflowMain >= 0 ? 'up-text' : 'down-text'">
            {{ fmtInflow(r.netInflowMain) }}
          </td>
          <td class="pct-cell" :class="r.netInflowMainPct >= 0 ? 'up-text' : 'down-text'">
            {{ fmtPct(r.netInflowMainPct) }}
          </td>
          <td v-if="range === '1d'" class="price-cell">
            {{ r.closePrice > 0 ? r.closePrice.toFixed(2) : '--' }}
          </td>
          <td v-if="range !== '1d'" class="price-cell">
            {{ fmtInflow(r.todayNetInflow || 0) }}
          </td>
          <td class="trend-cell">
            <span class="trend-icon" :class="r.trend">
              {{ r.trend === 'up3' ? '↑' : r.trend === 'down3' ? '↓' : '—' }}
            </span>
          </td>
          <td class="action-cell" @click.stop>
            <button
              v-if="auth.isLoggedIn"
              class="alert-btn"
              title="设置告警"
              @click="openQuickAlert({ code: r.code, name: r.name })"
            >⚡</button>
          </td>
        </tr>
      </tbody>
    </table>

    <QuickAlertModal
      v-if="quickAlertStock"
      :stock="quickAlertStock"
      @close="quickAlertStock = null"
    />

    <div v-if="exportTasks.length" class="export-tasks">
      <h3>导出任务</h3>
      <div v-for="task in exportTasks.slice(0, 5)" :key="task.id" class="task-item">
        <span>{{ task.type === 'csv' ? 'CSV' : 'Excel' }}</span>
        <span :class="task.status">{{ task.status === 'completed' ? '✓ 完成' : task.status === 'failed' ? '✗ 失败' : task.status === 'pending' ? '等待中' : '进行中 ' + task.progress + '%' }}</span>
        <a v-if="task.status === 'completed'" :href="task.filePath" target="_blank">下载</a>
      </div>
    </div>

    <div v-if="showExportModal" class="modal-overlay" @click.self="showExportModal = false">
      <div class="modal">
        <h3>导出资金数据</h3>
        <div class="form-group">
          <label>导出格式</label>
          <div class="radio-group">
            <label><input type="radio" value="csv" v-model="exportType" /> CSV</label>
            <label><input type="radio" value="excel" v-model="exportType" /> Excel（含多Sheet）</label>
          </div>
        </div>
        <div class="modal-actions">
          <button @click="showExportModal = false">取消</button>
          <button class="primary" @click="createExport" :disabled="exportLoading">
            {{ exportLoading ? '导出中...' : '导出' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fund-flow-dashboard {
  padding: 24px 32px;
  max-width: 900px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.page-header h1 {
  font-size: 18px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-time {
  font-size: 12px;
  color: var(--text-tertiary);
}

.refresh-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  transition: var(--transition);
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.tab-bar button {
  padding: 8px 20px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  transition: var(--transition);
}

.tab-bar button:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.tab-bar button.active {
  background: var(--brand-gradient);
  color: #0b0d14;
  border-color: var(--brand);
  font-weight: 600;
}

.tab-divider {
  width: 1px;
  background: var(--border);
  margin: 0 4px;
  align-self: stretch;
}

.error-msg {
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 16px;
}

.loading, .empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin-right: 8px;
  vertical-align: -3px;
  border: 2px solid var(--border);
  border-top-color: var(--brand);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

.empty-hint {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.75;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 2.4s; }
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th {
  text-align: left;
  padding: 10px 12px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  color: var(--text-tertiary);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.data-table td {
  padding: 12px 12px;
  border-bottom: 1px solid var(--border);
}

.clickable-row {
  cursor: pointer;
  transition: background 0.1s;
}

.clickable-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.rank-cell {
  width: 40px;
  font-weight: 700;
  color: var(--text-tertiary);
}

.rank-cell.top3 {
  color: var(--brand);
}

.name-cell {
  font-weight: 600;
}

.code-cell {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.amount-cell, .pct-cell, .price-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.up-text { color: var(--up, #ef4444); }
.down-text { color: var(--down, #22c55e); }

.trend-cell { text-align: center; }
.trend-icon { font-size: 14px; font-weight: 700; }
.trend-icon.up3 { color: var(--up, #ef4444); }
.trend-icon.down3 { color: var(--down, #22c55e); }
.trend-icon.\u2014 { color: var(--text-tertiary); }

.action-cell { text-align: center; }

.alert-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--brand);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  transition: all 0.15s;
}
.alert-btn:hover { background: var(--brand-glow); border-color: var(--brand); }

.manage-btn {
  padding: 6px 14px;
  border: 1px solid var(--brand);
  background: var(--brand-glow);
  color: var(--brand);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
}
.manage-btn:hover { background: var(--brand); color: #0b0d14; }

@media (max-width: 640px) {
  .fund-flow-dashboard { padding: 16px; }
  .page-header { flex-direction: column; align-items: flex-start; gap: 8px; }
  .data-table { font-size: 12px; }
  .data-table td, .data-table th { padding: 8px; }
}

.export-btn {
  padding: 6px 14px;
  border: 1px solid var(--brand);
  background: var(--brand-gradient);
  color: #0b0d14;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: var(--transition);
}

.export-btn:hover { opacity: 0.9; }

.export-tasks {
  margin-top: 24px;
  padding: 16px;
  background: var(--bg-card);
  border-radius: var(--radius);
}

.export-tasks h3 {
  font-size: 14px;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.task-item .completed { color: var(--up, #22c55e); }
.task-item .failed { color: var(--down, #ef4444); }
.task-item .pending, .task-item .running { color: var(--text-tertiary); }
.task-item a { color: var(--brand); }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 24px;
  width: 360px;
  max-width: 90vw;
}

.modal h3 { margin-bottom: 16px; font-size: 16px; }

.form-group { margin-bottom: 16px; }
.form-group label { display: block; margin-bottom: 8px; font-size: 13px; color: var(--text-secondary); }

.radio-group { display: flex; flex-direction: column; gap: 8px; }
.radio-group label { display: flex; align-items: center; gap: 8px; cursor: pointer; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

.modal-actions button {
  padding: 8px 16px;
  border: 1px solid var(--border);
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
}

.modal-actions button.primary {
  background: var(--brand-gradient);
  color: #0b0d14;
  border-color: var(--brand);
  font-weight: 600;
}

.modal-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
