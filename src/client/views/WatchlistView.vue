<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWatchlistStore } from '../stores/watchlist'
import { useAuthStore } from '../stores/auth'
import { useStockStore } from '../stores/stock'
import TermTip from '../components/TermTip.vue'

const router = useRouter()
const watchlist = useWatchlistStore()
const auth = useAuthStore()
const stockStore = useStockStore()

const error = ref('')
const activeGroupId = ref<number | null>(null)
const showGroupModal = ref(false)
const editingGroup = ref<{ id?: number; name: string; color: string } | null>(null)
const newGroupName = ref('')
const newGroupColor = ref('#f59e0b')

const activeTab = ref<'watchlist' | 'alerts'>('watchlist')
const alerts = ref<any[]>([])
const alertsLoading = ref(false)
const showAddAlert = ref(false)
const newAlert = ref({ code: '', name: '', condition: 'price_gte', targetValue: '' })
const alertError = ref('')

const groupColors = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4']

const filteredItems = computed(() => {
  if (activeGroupId.value === null) return watchlist.items
  return watchlist.items.filter(i => i.groupId === activeGroupId.value)
})

onMounted(() => {
  if (auth.isLoggedIn) {
    watchlist.fetchAll()
  }
})

async function loadAlerts() {
  alertsLoading.value = true
  try {
    const res = await fetch('/api/alerts', { headers: auth.authHeaders() })
    if (res.ok) alerts.value = await res.json()
  } finally { alertsLoading.value = false }
}

async function createAlert() {
  alertError.value = ''
  const val = Number(newAlert.value.targetValue)
  if (!newAlert.value.code || !val) { alertError.value = '请填写完整信息'; return }
  try {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ code: newAlert.value.code, name: newAlert.value.name, condition: newAlert.value.condition, targetValue: val }),
    })
    if (res.ok) {
      await loadAlerts()
      showAddAlert.value = false
      newAlert.value = { code: '', name: '', condition: 'price_gte', targetValue: '' }
    } else {
      const e = await res.json()
      alertError.value = e.error || '创建失败'
    }
  } catch (e: any) { alertError.value = e.message }
}

async function deleteAlert(id: number) {
  await fetch(`/api/alerts/${id}`, { method: 'DELETE', headers: auth.authHeaders() })
  alerts.value = alerts.value.filter(a => a.id !== id)
}

function conditionLabel(c: string, v: number) {
  const labels: Record<string, string> = {
    price_gte: `价格 ≥ ${v}`,
    price_lte: `价格 ≤ ${v}`,
    change_pct_gte: `涨幅 ≥ ${v}%`,
    change_pct_lte: `跌幅 ≤ ${v}%`,
    cross_above: `MA${Math.round(v)} 上穿`,
    cross_below: `MA${Math.round(v)} 下穿`,
  }
  return labels[c] || c
}

function viewStock(code: string) {
  router.push(`/stock/${code}`)
}

async function removeItem(id: number) {
  try {
    await watchlist.remove(id)
  } catch (e: any) {
    error.value = e.message
  }
}

function openAddGroup(id?: number) {
  if (id !== undefined) {
    const g = watchlist.groups.find(g => g.id === id)
    if (g) {
      editingGroup.value = { id, name: g.name, color: g.color }
    }
  } else {
    editingGroup.value = { name: '', color: '#f59e0b' }
  }
  newGroupName.value = editingGroup.value.name
  newGroupColor.value = editingGroup.value.color
  showGroupModal.value = true
}

function closeGroupModal() {
  showGroupModal.value = false
  editingGroup.value = null
}

async function saveGroup() {
  if (!newGroupName.value.trim()) return
  try {
    if (editingGroup.value?.id) {
      await watchlist.updateGroup(editingGroup.value.id, {
        name: newGroupName.value.trim(),
        color: newGroupColor.value,
      })
    } else {
      await watchlist.createGroup(newGroupName.value.trim(), newGroupColor.value)
    }
    closeGroupModal()
  } catch (e: any) {
    error.value = e.message
  }
}

async function deleteCurrentGroup() {
  if (!editingGroup.value?.id) return
  if (!confirm('删除分组？分组内的股票将移至「全部」。')) return
  try {
    await watchlist.deleteGroup(editingGroup.value.id)
    activeGroupId.value = null
    closeGroupModal()
  } catch (e: any) {
    error.value = e.message
  }
}

async function changeGroup(itemId: number, groupId: number | null) {
  try {
    await watchlist.updateItem(itemId, { groupId })
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="watchlist-page">
    <div class="page-header">
      <h1>自选股</h1>
      <button class="btn-sm" @click="openAddGroup()">+ 新建分组</button>
    </div>

    <div v-if="!auth.isLoggedIn" class="empty-state">
      <span>请先登录以使用自选股功能</span>
      <router-link to="/login" class="btn-link">去登录</router-link>
    </div>

    <template v-else>
      <div class="tab-bar">
        <button class="tab-btn" :class="{ active: activeTab === 'watchlist' }" @click="activeTab = 'watchlist'">自选股</button>
        <button class="tab-btn" :class="{ active: activeTab === 'alerts' }" @click="activeTab = 'alerts'; loadAlerts()">价格告警</button>
      </div>

      <template v-if="activeTab === 'watchlist'">
      <div class="groups-bar">
        <button
          class="group-tab"
          :class="{ active: activeGroupId === null }"
          @click="activeGroupId = null"
        >
          全部
          <span class="count">{{ watchlist.items.length }}</span>
        </button>
        <button
          v-for="g in watchlist.groups"
          :key="g.id"
          class="group-tab"
          :class="{ active: activeGroupId === g.id }"
          @click="activeGroupId = g.id"
        >
          <span class="dot" :style="{ background: g.color }"></span>
          {{ g.name }}
          <span class="count">{{ watchlist.items.filter(i => i.groupId === g.id).length }}</span>
        </button>
        <button class="group-tab edit-tab" @click="openAddGroup()" title="管理分组">⚙</button>
      </div>

      <div v-if="watchlist.loading" class="loading-state">
        <div class="spinner" />
      </div>

      <div v-else-if="filteredItems.length === 0" class="empty-state">
        <span>自选股为空，在行情看板中点击股票即可添加</span>
      </div>

      <div v-else class="watchlist-grid">
        <div v-for="item in filteredItems" :key="item.id" class="card watchlist-card">
          <div class="card-body" @click="viewStock(item.code)">
            <div class="wl-header">
              <span class="wl-name">{{ stockStore.stockName(item.code) || item.code }}</span>
              <span class="wl-code">{{ item.code }}</span>
            </div>
            <div v-if="item.note" class="wl-note">{{ item.note }}</div>
          </div>
          <select
            class="group-select"
            :value="item.groupId ?? ''"
            @change="changeGroup(item.id, ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value))"
            @click.stop
          >
            <option value="">无分组</option>
            <option v-for="g in watchlist.groups" :key="g.id" :value="g.id">
              {{ g.name }}
            </option>
          </select>
          <button class="remove-btn" @click.stop="removeItem(item.id)" aria-label="移出自选">✕</button>
        </div>
      </div>
      </template>

      <template v-if="activeTab === 'alerts'">
        <div class="alerts-header">
          <button class="btn-sm" @click="showAddAlert = true">+ 添加告警</button>
        </div>
        <div v-if="alertsLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
        <div v-else-if="alerts.length === 0" class="empty-state">
          <div class="empty-icon">🔔</div>
          <div>暂无价格告警</div>
          <button class="btn-sm" @click="showAddAlert = true" style="margin-top:8px">+ 添加告警</button>
        </div>
        <div v-else class="alerts-list">
          <div v-for="a in alerts" :key="a.id" class="alert-item" :class="a.triggeredAt ? 'triggered' : ''">
            <div class="alert-info">
              <div class="alert-name">{{ a.name || a.code }}</div>
              <div class="alert-meta">
                <span class="alert-code">{{ a.code }}</span>
                <span>·</span>
                <span>{{ conditionLabel(a.condition, Number(a.targetValue)) }}</span>
                <span v-if="a.triggeredAt">· 已触发 {{ new Date(a.triggeredAt).toLocaleDateString('zh-CN') }}</span>
              </div>
            </div>
            <button class="btn-danger-sm" @click="deleteAlert(a.id)">删除</button>
          </div>
        </div>

        <div v-if="showAddAlert" class="modal-overlay" @click.self="showAddAlert = false">
          <div class="modal-card">
            <h3>添加价格告警</h3>
            <div class="field">
              <label>股票代码</label>
              <input v-model="newAlert.code" placeholder="如：000001" maxlength="10" />
            </div>
            <div class="field">
              <label>股票名称</label>
              <input v-model="newAlert.name" placeholder="如：平安银行" maxlength="50" />
            </div>
            <div class="field">
              <label>告警条件</label>
              <select v-model="newAlert.condition">
                <option value="price_gte">价格 ≥（上穿均线）</option>
                <option value="price_lte">价格 ≤（下穿均线）</option>
                <option value="change_pct_gte">涨幅 ≥ X%</option>
                <option value="change_pct_lte">跌幅 ≤ X%</option>
                <option value="cross_above">MA 均线上穿</option>
                <option value="cross_below">MA 均线下跌</option>
              </select>
            </div>
            <div class="field">
              <label>目标值</label>
              <input v-model="newAlert.targetValue" type="number" placeholder="如：10.5 或 20" />
              <small class="hint">均线类型输入周期数字（如 20 表示 MA20）</small>
            </div>
            <div v-if="alertError" class="error-text">{{ alertError }}</div>
            <div class="modal-actions">
              <button class="btn-ghost" @click="showAddAlert = false">取消</button>
              <button class="btn-primary" @click="createAlert">创建告警</button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="showGroupModal" class="modal-overlay" @click.self="closeGroupModal">
      <div class="modal-card">
        <h3>{{ editingGroup?.id ? '编辑分组' : '新建分组' }}</h3>
        <div class="field">
          <label>名称</label>
          <input v-model="newGroupName" placeholder="分组名称" maxlength="50" />
        </div>
        <div class="field">
          <label>颜色</label>
          <div class="color-row">
            <button
              v-for="c in groupColors"
              :key="c"
              class="color-swatch"
              :class="{ selected: newGroupColor === c }"
              :style="{ background: c }"
              @click="newGroupColor = c"
            />
          </div>
        </div>
        <div class="modal-actions">
          <button v-if="editingGroup?.id" class="btn-danger" @click="deleteCurrentGroup">删除</button>
          <div class="spacer"></div>
          <button class="btn-ghost" @click="closeGroupModal">取消</button>
          <button class="btn-primary" @click="saveGroup">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.page-header h1 { font-size: 18px; font-weight: 600; }

.groups-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  align-items: center;
}
.group-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition);
}
.group-tab:hover { border-color: var(--brand); color: var(--brand); }
.group-tab.active { background: var(--brand); border-color: var(--brand); color: #0b0d14; font-weight: 600; }
.group-tab .dot { width: 8px; height: 8px; border-radius: 50%; }
.group-tab .count { font-size: 11px; opacity: 0.7; }
.edit-tab { padding: 6px 10px; font-size: 12px; }

.watchlist-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.watchlist-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all var(--transition);
}
.watchlist-card:hover { border-color: var(--brand); }
.card-body { flex: 1; min-width: 0; }
.wl-header { display: flex; align-items: center; gap: 10px; }
.wl-code { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wl-name { font-size: 14px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-note { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
.group-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
}
.group-select:focus { outline: none; border-color: var(--brand); }
.remove-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-tertiary);
  width: 36px;
  height: 36px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 14px;
  transition: all var(--transition);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.remove-btn:hover { border-color: var(--danger); color: var(--danger); }

.empty-state, .loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 80px 20px;
  color: var(--text-tertiary);
}
.spinner {
  width: 24px; height: 24px;
  border: 3px solid var(--border);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.btn-link {
  padding: 8px 20px;
  background: var(--brand-gradient);
  color: #0b0d14;
  border-radius: var(--radius-sm);
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
  box-shadow: 0 2px 12px var(--brand-glow);
}
.btn-sm {
  padding: 6px 14px;
  background: var(--brand-gradient);
  color: #0b0d14;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.error-banner {
  padding: 12px 16px;
  background: var(--danger-dim);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  color: var(--danger);
  font-size: 13px;
  margin-top: 16px;
}

.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  width: 100%;
  max-width: 360px;
  box-sizing: border-box;
}
.modal-card h3 { font-size: 16px; margin-bottom: 20px; }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 12px; color: var(--text-tertiary); margin-bottom: 6px; }
.field input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-primary);
  border-radius: var(--radius);
  font-size: 14px;
  box-sizing: border-box;
}
.field input:focus { outline: none; border-color: var(--brand); }
.color-row { display: flex; gap: 8px; }
.color-swatch {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s;
}
.color-swatch:hover { transform: scale(1.15); }
.color-swatch.selected { border-color: var(--text-primary); }
.modal-actions {
  display: flex; gap: 10px; align-items: center;
  margin-top: 20px;
}
.spacer { flex: 1; }
.btn-primary {
  padding: 8px 18px;
  background: var(--brand-gradient);
  color: #0b0d14;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-ghost {
  padding: 8px 18px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
}
.btn-danger {
  padding: 8px 18px;
  background: var(--danger-dim);
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
}
.tab-bar { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 0; }
.tab-btn { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: var(--transition); margin-bottom: -1px; }
.tab-btn.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.alerts-header { display: flex; justify-content: flex-end; margin-bottom: 16px; }
.alerts-list { display: flex; flex-direction: column; gap: 10px; }
.alert-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.alert-item.triggered { opacity: 0.6; }
.alert-info { display: flex; flex-direction: column; gap: 2px; }
.alert-name { font-size: 14px; font-weight: 600; }
.alert-meta { display: flex; gap: 6px; font-size: 12px; color: var(--text-tertiary); }
.alert-code { font-variant-numeric: tabular-nums; }
.btn-danger-sm { padding: 4px 10px; background: var(--danger-dim); color: var(--danger); border: 1px solid var(--danger); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; min-width: 320px; max-width: min(520px, 90vw); }
.modal-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.modal-card .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.modal-card .field label { font-size: 12px; color: var(--text-tertiary); }
.modal-card .field input, .modal-card .field select { padding: 8px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius-sm); font-size: 13px; }
.modal-card .field input:focus, .modal-card .field select:focus { outline: none; border-color: var(--brand); }
.modal-card .hint { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.spacer { flex: 1; }
.error-text { color: var(--danger); font-size: 13px; margin-top: 8px; }
.color-row { display: flex; gap: 6px; flex-wrap: wrap; }
.color-swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.color-swatch.selected { border-color: var(--text-primary); }

@media (min-width: 768px) {
  .watchlist-page { padding: 24px 32px; }
}
@media (max-width: 640px) {
  .watchlist-page { padding: 12px; }
  .wl-header { flex-direction: column; gap: 8px; }
  .wl-header h1 { font-size: 18px; }
  .wl-groups { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .wl-groups::-webkit-scrollbar { display: none; }
  .wl-group-tab { white-space: nowrap; flex-shrink: 0; font-size: 12px; padding: 6px 12px; }
  .wl-card { padding: 10px; }
  .wl-card-name { font-size: 14px; }
  .wl-card-code { font-size: 11px; }
  .wl-card-price { font-size: 16px; }
  .wl-card-change { font-size: 12px; }
  .modal-card { margin: 0 16px; padding: 20px; }
}
</style>
