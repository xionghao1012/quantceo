<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const auth = useAuthStore()

const configs = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const toggling = ref<Set<number>>(new Set())

async function fetchConfigs() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/moneyflow/alerts/configs', { headers: auth.authHeaders() })
    if (!res.ok) {
      if (res.status === 401) { router.push('/login'); return }
      throw new Error('获取告警配置失败')
    }
    configs.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function toggleEnabled(id: number, current: boolean) {
  toggling.value.add(id)
  try {
    await fetch(`/api/moneyflow/alerts/configs/${id}`, {
      method: 'PATCH',
      headers: { ...auth.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !current }),
    })
    const cfg = configs.value.find(c => c.id === id)
    if (cfg) cfg.enabled = !current
  } finally {
    toggling.value.delete(id)
  }
}

async function deleteConfig(id: number) {
  if (!confirm('确定删除该告警配置？')) return
  try {
    const res = await fetch(`/api/moneyflow/alerts/configs/${id}`, {
      method: 'DELETE',
      headers: auth.authHeaders(),
    })
    if (res.ok) configs.value = configs.value.filter(c => c.id !== id)
  } catch {}
}

function fmtThreshold(cfg: any) {
  if (cfg.thresholdType === 'absolute') {
    const v = Number(cfg.thresholdValue)
    if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
    return v.toLocaleString()
  }
  return Number(cfg.thresholdValue).toFixed(2) + '%'
}

function scopeLabel(cfg: any) {
  return cfg.code ? `${cfg.code} ${cfg.name || ''}` : '全市场'
}

onMounted(fetchConfigs)
</script>

<template>
  <div class="alerts-view">
    <div class="page-header">
      <h1>主力资金告警配置</h1>
      <button class="btn-brand" @click="router.push('/fund-flow/alerts/create')">
        + 新建告警
      </button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading && !configs.length" class="loading">加载中...</div>

    <EmptyState
      v-else-if="!configs.length && !error"
      variant="alert"
      text="还没有设置告警条件"
      hint="告警是按条件触发的：设好「主力净流入超过多少」或「涨幅超过多少」，命中时通过微信/邮件推给你，不设条件就不会有提醒。"
    >
      <button class="btn-brand" @click="router.push('/fund-flow/alerts/create')">创建第一个告警</button>
    </EmptyState>

    <div v-else class="config-list">
      <div v-for="cfg in configs" :key="cfg.id" class="config-card">
        <div class="config-main">
          <div class="config-scope">
            <span class="scope-tag" :class="{ market: !cfg.code }">
              {{ scopeLabel(cfg) }}
            </span>
            <span class="direction-tag" :class="cfg.direction">
              {{ cfg.direction === 'inflow' ? '流入' : '流出' }}
            </span>
          </div>
          <div class="config-meta">
            <span class="threshold">
              阈值：<strong>{{ fmtThreshold(cfg) }}</strong>
              <em>({{ cfg.thresholdType === 'absolute' ? '绝对值' : '相对值' }})</em>
            </span>
            <span class="filters">
              <span v-if="cfg.basicFilterEnabled" class="filter-chip">基础过滤</span>
              <span v-if="cfg.techResonanceEnabled" class="filter-chip">
                技术共振
                <span v-if="cfg.techResonanceMacd">MACD</span>
                <span v-if="cfg.techResonanceMa">MA</span>
              </span>
              <span v-if="cfg.smartFilterEnabled" class="filter-chip">智能过滤</span>
            </span>
          </div>
        </div>
        <div class="config-actions">
          <label class="toggle-switch" :class="{ disabled: toggling.has(cfg.id) }">
            <input type="checkbox" :checked="cfg.enabled" :disabled="toggling.has(cfg.id)"
              @change="toggleEnabled(cfg.id, cfg.enabled)" />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-ghost btn-sm" @click="router.push(`/fund-flow/alerts/edit/${cfg.id}`)">编辑</button>
          <button class="btn-danger btn-sm" @click="deleteConfig(cfg.id)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.alerts-view { padding: 24px 32px; max-width: 860px; }

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-header h1 { font-size: 18px; font-weight: 700; }

.error-msg {
  padding: 12px 16px;
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

.empty-state p { margin-bottom: 16px; }

.config-list { display: flex; flex-direction: column; gap: 12px; }

.config-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: border-color 0.15s;
}
.config-card:hover { border-color: var(--brand); }

.config-scope { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }

.scope-tag {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}
.scope-tag.market { color: var(--brand); }

.direction-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius);
}
.direction-tag.inflow { background: var(--down-bg); color: var(--down); }
.direction-tag.outflow { background: var(--up-bg); color: var(--up); }

.config-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}
.config-meta strong { color: var(--text-primary); font-weight: 700; }
.config-meta em { font-style: normal; color: var(--text-tertiary); margin-left: 2px; }

.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius);
  background: var(--brand-glow);
  color: var(--brand);
  font-weight: 600;
}

.config-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}
.toggle-switch.disabled { opacity: 0.5; pointer-events: none; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: var(--radius-lg);
  transition: 0.2s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: var(--radius-full);
  transition: 0.2s;
}
.toggle-switch input:checked + .toggle-slider { background: var(--brand); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(18px); }

.btn-sm { padding: 5px 12px; font-size: 12px; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; transition: all 0.15s; }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-secondary); }
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }
.btn-danger { background: transparent; border: 1px solid var(--up); color: var(--up); }
.btn-danger:hover { background: var(--up-bg); }
</style>
