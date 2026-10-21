<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const isEdit = computed(() => !!route.params.id)

// 来自 QuickAlertModal 跳转时的预填数据。
// vue-router 4 没有 route.state，push 的 state 落在 history.state 顶层
const prefill = (typeof history !== 'undefined' ? history.state : null) as { code?: string; name?: string } | null
const saving = ref(false)
const error = ref('')
const searchResults = ref<any[]>([])
const searchLoading = ref(false)

const form = ref({
  code: '',
  name: '',
  scope: 'stock',
  thresholdType: 'absolute' as 'absolute' | 'relative',
  thresholdValue: '',
  direction: 'inflow',
  basicFilterEnabled: true,
  techResonanceEnabled: false,
  techResonanceMacd: false,
  techResonanceMa: false,
  smartFilterEnabled: false,
})

const THRESHOLDS = {
  absolute: [
    { label: '100万', value: 1000000 },
    { label: '500万', value: 5000000 },
    { label: '1000万', value: 10000000 },
    { label: '2000万', value: 20000000 },
    { label: '5000万', value: 50000000 },
  ],
  relative: [
    { label: '1%', value: 1 },
    { label: '2%', value: 2 },
    { label: '3%', value: 3 },
    { label: '5%', value: 5 },
    { label: '8%', value: 8 },
  ],
}

async function searchStock(q: string) {
  if (!q || q.length < 1) { searchResults.value = []; return }
  searchLoading.value = true
  try {
    const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`, { headers: auth.authHeaders() })
    if (res.ok) searchResults.value = (await res.json()).slice(0, 8)
  } catch {}
  searchLoading.value = false
}

function selectStock(stock: any) {
  form.value.code = stock.code
  form.value.name = stock.name
  form.value.scope = 'stock'
  searchResults.value = []
}

function clearStock() {
  form.value.code = ''
  form.value.name = ''
}

async function fetchConfig(id: number) {
  const res = await fetch(`/api/moneyflow/alerts/configs`, { headers: auth.authHeaders() })
  if (!res.ok) return
  const configs = await res.json()
  const cfg = configs.find((c: any) => c.id === id)
  if (!cfg) return
  form.value = {
    code: cfg.code || '',
    name: cfg.name || '',
    scope: cfg.code ? 'stock' : 'market',
    thresholdType: cfg.thresholdType,
    thresholdValue: String(cfg.thresholdValue),
    direction: cfg.direction,
    basicFilterEnabled: !!cfg.basicFilterEnabled,
    techResonanceEnabled: !!cfg.techResonanceEnabled,
    techResonanceMacd: !!cfg.techResonanceMacd,
    techResonanceMa: !!cfg.techResonanceMa,
    smartFilterEnabled: !!cfg.smartFilterEnabled,
  }
}

async function submit() {
  error.value = ''
  if (form.value.thresholdType === 'absolute' && !form.value.thresholdValue) {
    error.value = '请输入阈值数值'
    return
  }
  saving.value = true
  try {
    const payload = {
      code: form.value.scope === 'stock' ? form.value.code : null,
      name: form.value.scope === 'stock' ? form.value.name : null,
      thresholdType: form.value.thresholdType,
      thresholdValue: form.value.thresholdType === 'absolute'
        ? Number(form.value.thresholdValue)
        : Number(form.value.thresholdValue),
      direction: form.value.direction,
      basicFilterEnabled: form.value.basicFilterEnabled,
      techResonanceEnabled: form.value.techResonanceEnabled,
      techResonanceMacd: form.value.techResonanceMacd,
      techResonanceMa: form.value.techResonanceMa,
      smartFilterEnabled: form.value.smartFilterEnabled,
    }
    let res: Response
    if (isEdit.value) {
      res = await fetch(`/api/moneyflow/alerts/configs/${route.params.id}`, {
        method: 'PATCH',
        headers: { ...auth.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch('/api/moneyflow/alerts/configs', {
        method: 'POST',
        headers: { ...auth.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }
    if (!res.ok) {
      const e = await res.json()
      throw new Error(e.error || '保存失败')
    }
    router.push('/fund-flow/alerts')
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  if (isEdit.value) {
    await fetchConfig(Number(route.params.id))
  } else if (prefill?.code) {
    // 来自 QuickAlertModal 跳转，预填股票代码和名称
    form.value.code = prefill.code
    form.value.name = prefill.name || ''
    form.value.scope = 'stock'
  }
})
</script>

<template>
  <div class="alert-form-view">
    <div class="page-header">
      <h2>{{ isEdit ? '编辑告警配置' : '新建告警配置' }}</h2>
      <button class="btn-ghost" @click="router.push('/fund-flow/alerts')">← 返回</button>
    </div>

    <form class="form-card" @submit.prevent="submit">
      <!-- 监控范围 -->
      <div class="form-section">
        <h3 class="section-title">监控范围</h3>
        <div class="radio-group">
          <label class="radio-item" :class="{ active: form.scope === 'stock' }">
            <input type="radio" v-model="form.scope" value="stock" />
            <span>个股</span>
          </label>
          <label class="radio-item" :class="{ active: form.scope === 'market' }">
            <input type="radio" v-model="form.scope" value="market" />
            <span>全市场</span>
          </label>
        </div>

        <!-- 个股搜索 -->
        <div v-if="form.scope === 'stock'" class="stock-search">
          <input
            v-if="!form.code"
            v-model="form.name"
            type="text"
            placeholder="输入股票代码或名称搜索..."
            class="search-input"
            @input="searchStock(form.name)"
          />
          <div v-if="searchResults.length" class="search-dropdown">
            <div
              v-for="s in searchResults" :key="s.code"
              class="search-item" @click="selectStock(s)"
            >
              <span class="stock-code">{{ s.code }}</span>
              <span class="stock-name">{{ s.name }}</span>
            </div>
          </div>
          <div v-if="form.code" class="selected-stock">
            <span class="stock-badge">{{ form.code }} {{ form.name }}</span>
            <button type="button" class="clear-btn" @click="clearStock">×</button>
          </div>
        </div>
      </div>

      <!-- 告警条件 -->
      <div class="form-section">
        <h3 class="section-title">告警条件</h3>

        <div class="form-row">
          <div class="form-field">
            <label>方向</label>
            <div class="radio-group horizontal">
              <label class="radio-item small" :class="{ active: form.direction === 'inflow' }">
                <input type="radio" v-model="form.direction" value="inflow" />
                <span>↑ 流入</span>
              </label>
              <label class="radio-item small" :class="{ active: form.direction === 'outflow' }">
                <input type="radio" v-model="form.direction" value="outflow" />
                <span>↓ 流出</span>
              </label>
            </div>
          </div>

          <div class="form-field">
            <label>阈值类型</label>
            <select v-model="form.thresholdType" class="select">
              <option value="absolute">绝对值（元）</option>
              <option value="relative">相对值（%）</option>
            </select>
          </div>
        </div>

        <div class="form-field">
          <label>阈值</label>
          <input v-model="form.thresholdValue" type="number" class="input" placeholder="输入数值" min="0" step="0.01" />
          <div class="threshold-presets">
            <span class="presets-label">快速设置：</span>
            <button
              v-for="p in THRESHOLDS[form.thresholdType]"
              :key="p.value"
              type="button"
              class="preset-btn"
              :class="{ active: form.thresholdValue === String(p.value) }"
              @click="form.thresholdValue = String(p.value)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 过滤条件 -->
      <div class="form-section">
        <h3 class="section-title">过滤条件</h3>
        <p class="section-hint">开启后可减少虚假信号告警</p>

        <label class="toggle-row">
          <span class="toggle-label">
            <span class="toggle-title">基础过滤</span>
            <span class="toggle-desc">自动过滤 ST 股和涨停股</span>
          </span>
          <label class="toggle-switch">
            <input type="checkbox" v-model="form.basicFilterEnabled" />
            <span class="toggle-slider"></span>
          </label>
        </label>

        <label class="toggle-row">
          <span class="toggle-label">
            <span class="toggle-title">技术共振</span>
            <span class="toggle-desc">资金信号与短期技术信号同时出现时触发</span>
          </span>
          <label class="toggle-switch">
            <input type="checkbox" v-model="form.techResonanceEnabled" />
            <span class="toggle-slider"></span>
          </label>
        </label>

        <div v-if="form.techResonanceEnabled" class="sub-toggles">
          <label class="toggle-row sub">
            <span class="toggle-title">MACD 金叉</span>
            <label class="toggle-switch small">
              <input type="checkbox" v-model="form.techResonanceMacd" />
              <span class="toggle-slider"></span>
            </label>
          </label>
          <label class="toggle-row sub">
            <span class="toggle-title">MA 金叉（MA5 上穿 MA20）</span>
            <label class="toggle-switch small">
              <input type="checkbox" v-model="form.techResonanceMa" />
              <span class="toggle-slider"></span>
            </label>
          </label>
        </div>

        <label class="toggle-row">
          <span class="toggle-label">
            <span class="toggle-title">智能过滤</span>
            <span class="toggle-desc">过滤对倒、利好出货、筹码异常、量能异常等虚假信号</span>
          </span>
          <label class="toggle-switch">
            <input type="checkbox" v-model="form.smartFilterEnabled" />
            <span class="toggle-slider"></span>
          </label>
        </label>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="form-actions">
        <button type="button" class="btn-ghost" @click="router.push('/fund-flow/alerts')">取消</button>
        <button type="submit" class="btn-brand" :disabled="saving">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.alert-form-view { padding: 24px 32px; max-width: 640px; }

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-header h2 { font-size: 18px; font-weight: 700; }

.form-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.form-section { display: flex; flex-direction: column; gap: 14px; }
.section-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.section-hint { font-size: 12px; color: var(--text-tertiary); margin-top: -8px; }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

/* Radio group */
.radio-group { display: flex; gap: 8px; flex-wrap: wrap; }
.radio-group.horizontal { flex-direction: row; }
.radio-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  transition: all 0.15s;
  user-select: none;
}
.radio-item.small { padding: 7px 12px; font-size: 12px; }
.radio-item input { display: none; }
.radio-item.active {
  background: var(--brand-glow);
  border-color: var(--brand);
  color: var(--brand);
}

/* Stock search */
.stock-search { position: relative; }
.search-input {
  width: 100%;
  padding: 9px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-deep);
  color: var(--text-primary);
  font-size: 13px;
}
.search-input:focus { outline: none; border-color: var(--brand); }

.search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}
.search-item {
  display: flex;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.1s;
}
.search-item:hover { background: var(--brand-glow); }
.stock-code { font-weight: 700; color: var(--brand); }
.stock-name { color: var(--text-primary); }

.selected-stock {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.stock-badge {
  display: inline-flex;
  padding: 5px 12px;
  background: var(--brand-glow);
  border: 1px solid var(--brand);
  border-radius: var(--radius-lg);
  font-size: 13px;
  font-weight: 700;
  color: var(--brand);
}
.clear-btn {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
}
.clear-btn:hover { color: var(--up); }

/* Inputs */
.select, .input {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-deep);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}
.select:focus, .input:focus { outline: none; border-color: var(--brand); }

.threshold-presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.presets-label { font-size: 12px; color: var(--text-tertiary); }
.preset-btn {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.preset-btn.active { background: var(--brand-glow); border-color: var(--brand); color: var(--brand); }
.preset-btn:hover { border-color: var(--brand); color: var(--brand); }

/* Toggle rows */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
}
.toggle-row:last-child { border-bottom: none; }
.toggle-row.sub { padding-left: 16px; }
.toggle-label { flex: 1; }
.toggle-title { font-size: 13px; font-weight: 600; color: var(--text-primary); display: block; }
.toggle-desc { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; display: block; }

/* Toggle switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}
.toggle-switch.small { width: 36px; height: 20px; }
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
.toggle-switch.small .toggle-slider::before { height: 14px; width: 14px; }
.toggle-switch.small .toggle-slider::before { transform: translateX(16px); }
.toggle-switch input:checked + .toggle-slider { background: var(--brand); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(18px); }

.sub-toggles { padding-left: 8px; border-left: 2px solid var(--brand-glow); }

/* Error */
.error-msg {
  padding: 10px 14px;
  background: rgba(239,68,68,0.1);
  border: 1px solid var(--up);
  border-radius: var(--radius-sm);
  color: var(--up);
  font-size: 13px;
}

/* Actions */
.form-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; }
.btn-brand {
  padding: 9px 24px;
  background: var(--brand-gradient);
  border: none;
  border-radius: var(--radius-sm);
  color: #0b0d14;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-brand:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-brand:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost {
  padding: 9px 18px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }
</style>
