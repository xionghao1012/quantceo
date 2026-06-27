<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useStockStore } from '../stores/stock'
import TermTip from '../components/TermTip.vue'

const router = useRouter()
const store = useStockStore()

interface Field { field: string; label: string; type: string; operators: string[] }
interface Condition { field: string; operator: string; value: number | string | [number, number] }

const fields = ref<Field[]>([])
const conditions = ref<Condition[]>([{ field: 'change', operator: '>', value: 5 }])
const sortField = ref('change')
const sortOrder = ref<'asc' | 'desc'>('desc')
const page = ref(1)
const PAGE_SIZE = 50

const loading = ref(false)
const error = ref('')
const result = ref<{ total: number; page: number; limit: number; stocks: any[] } | null>(null)

const operators = ['>', '<', '==', 'between', 'cross_above', 'cross_below']
const opLabels: Record<string, string> = {
  '>': '大于', '<': '小于', '==': '等于',
  'between': '区间', 'cross_above': '上穿', 'cross_below': '下穿',
}

const totalPages = computed(() => result.value ? Math.ceil(result.value.total / PAGE_SIZE) : 1)

onMounted(async () => {
  try {
    const res = await fetch('/api/screener/fields')
    if (res.ok) {
      const data = await res.json()
      fields.value = data.fields
    }
  } catch {}
})

function addCondition() {
  conditions.value.push({ field: 'change', operator: '>', value: 0 })
}

function removeCondition(i: number) {
  conditions.value.splice(i, 1)
}

function fieldFor(f: string) {
  return fields.value.find(x => x.field === f)
}

async function runScreener() {
  loading.value = true
  error.value = ''
  result.value = null
  page.value = 1
  try {
    const res = await fetch('/api/screener', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conditions: conditions.value,
        sort: { field: sortField.value, order: sortOrder.value },
        page: 1,
        limit: PAGE_SIZE,
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || `请求失败 (${res.status})`)
    }
    result.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/screener', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conditions: conditions.value,
        sort: { field: sortField.value, order: sortOrder.value },
        page: p,
        limit: PAGE_SIZE,
      }),
    })
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    result.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function viewStock(code: string) {
  store.selectStock(code)
  router.push(`/stock/${code}`)
}

function fmtPrice(v: number) { return v != null ? v.toFixed(2) : '--' }
function fmtChange(v: number) {
  if (v == null) return '--'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtVol(v: number) {
  if (v == null) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return String(v)
}
</script>

<template>
  <div class="screener-view">
    <div class="page-header">
      <h1>选股筛选</h1>
    </div>

    <div class="card control-card">
      <div class="conditions-list">
        <div class="cond-row" v-for="(cond, i) in conditions" :key="i">
          <select v-model="cond.field" class="cond-select">
            <option v-for="f in fields" :key="f.field" :value="f.field">{{ f.label }}</option>
          </select>
          <select v-model="cond.operator" class="cond-select op-select">
            <option v-for="op in (fieldFor(cond.field)?.operators || operators)" :key="op" :value="op">{{ opLabels[op] || op }}</option>
          </select>
          <template v-if="cond.operator === 'between'">
            <input type="number" v-model.number="(cond.value as [number,number])[0]" class="cond-input" placeholder="最小值" />
            <span class="cond-sep">~</span>
            <input type="number" v-model.number="(cond.value as [number,number])[1]" class="cond-input" placeholder="最大值" />
          </template>
          <template v-else-if="cond.operator === 'cross_above' || cond.operator === 'cross_below'">
            <select v-model="cond.value" class="cond-select">
              <option v-for="f in fields" :key="f.field" :value="f.field">{{ f.label }}</option>
            </select>
          </template>
          <template v-else>
            <input type="number" v-model.number="cond.value" class="cond-input" placeholder="数值" />
          </template>
          <button v-if="conditions.length > 1" class="cond-remove" @click="removeCondition(i)" aria-label="移除条件">✕</button>
        </div>
      </div>

      <div class="cond-actions">
        <button class="add-btn" @click="addCondition">+ 添加条件</button>
      </div>

      <div class="control-row" style="margin-top: 16px">
        <label>
          <span class="label-text">排序</span>
          <select v-model="sortField" class="sort-select">
            <option v-for="f in fields" :key="f.field" :value="f.field">{{ f.label }}</option>
          </select>
        </label>
        <label>
          <span class="label-text">方向</span>
          <select v-model="sortOrder" class="order-select">
            <option value="desc">降序 ↓</option>
            <option value="asc">升序 ↑</option>
          </select>
        </label>
        <button class="run-btn" @click="runScreener" :disabled="loading">
          <span v-if="loading" class="btn-spinner" />
          {{ loading ? '筛选中...' : '运行筛选' }}
        </button>
      </div>
      <div v-if="error" class="val-error">{{ error }}</div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner" />
      <span>正在筛选 {{ result ? result.total + ' 只股票...' : '...' }}</span>
    </div>

    <template v-if="result && !loading">
      <div class="section-header">
        <h2>
          <span class="accent"></span>
          筛选结果
          <span class="stock-count">{{ result.total }} 只</span>
        </h2>
        <span class="page-info">第 {{ result.page }} / {{ totalPages }} 页</span>
      </div>

      <div v-if="result.stocks.length === 0" class="empty-state">
        <span>没有符合条件的股票</span>
      </div>

      <div v-if="result.stocks.length > 0" class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th style="text-align:right">最新价</th>
                <th style="text-align:right">涨跌幅</th>
                <th style="text-align:right">成交量<TermTip term="volume" /></th>
                <th style="text-align:right">MA5<TermTip term="ma" /></th>
                <th style="text-align:right">MA20<TermTip term="ma" /></th>
                <th style="text-align:right">MACD<TermTip term="macd" /></th>
                <th style="text-align:right">RSI<TermTip term="rsi" /></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in result.stocks" :key="s.code" class="stock-row">
                <td class="code">{{ s.code }}</td>
                <td>{{ s.name }}</td>
                <td class="num" :class="s.change >= 0 ? 'up-text' : 'down-text'">{{ fmtPrice(s.price) }}</td>
                <td class="num" :class="s.change >= 0 ? 'up-text' : 'down-text'">{{ fmtChange(s.change) }}</td>
                <td class="num">{{ fmtVol(s.volume) }}</td>
                <td class="num" :class="(s.indicators?.ma5 ?? 0) >= s.price ? 'up-text' : 'down-text'">{{ fmtPrice(s.indicators?.ma5) }}</td>
                <td class="num" :class="(s.indicators?.ma20 ?? 0) >= s.price ? 'up-text' : 'down-text'">{{ fmtPrice(s.indicators?.ma20) }}</td>
                <td class="num">{{ s.indicators?.macd?.toFixed(3) ?? '--' }}</td>
                <td class="num">{{ s.indicators?.rsi?.toFixed(1) ?? '--' }}</td>
                <td><button class="analyze-btn" @click="viewStock(s.code)">分析</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="totalPages > 1" class="pagination">
        <button class="page-btn page-nav" :disabled="page === 1" @click="goPage(1)">«</button>
        <button class="page-btn page-nav" :disabled="page === 1" @click="goPage(page - 1)">‹</button>
        <div class="page-info">
          <span class="page-num">{{ page }}</span>
          <span class="page-sep">/</span>
          <span class="page-total">{{ totalPages }}</span>
        </div>
        <button class="page-btn page-nav" :disabled="page === totalPages" @click="goPage(page + 1)">›</button>
        <button class="page-btn page-nav" :disabled="page === totalPages" @click="goPage(totalPages)">»</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.page-header h1 { font-size: 18px; font-weight: 600; }

.control-card { margin-bottom: 20px; padding: 16px 20px; }
.conditions-list { display: flex; flex-direction: column; gap: 8px; }
.cond-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cond-select { padding: 6px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius-sm); font-size: 13px; min-width: 90px; }
.op-select { min-width: 80px; }
.cond-input { padding: 6px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius-sm); font-size: 13px; width: 100px; }
.cond-sep { color: var(--text-tertiary); font-size: 13px; }
.cond-remove { width: 36px; height: 36px; border: 1px solid var(--border); background: transparent; color: var(--text-tertiary); border-radius: 4px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.cond-remove:hover { border-color: var(--danger); color: var(--danger); }
.cond-actions { margin-top: 8px; }
.add-btn { padding: 5px 14px; border: 1px dashed var(--border); background: transparent; color: var(--text-tertiary); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; }
.add-btn:hover { border-color: var(--brand); color: var(--brand); }

.control-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.control-row label { display: flex; flex-direction: column; gap: 4px; }
.label-text { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.sort-select, .order-select { padding: 8px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); font-size: 13px; min-width: 120px; cursor: pointer; }

.run-btn { display: flex; align-items: center; gap: 6px; padding: 8px 20px; background: var(--brand-gradient); color: #0b0d14; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; font-size: 13px; height: 36px; box-shadow: 0 2px 12px var(--brand-glow); transition: var(--transition); white-space: nowrap; }
.run-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 20px var(--brand-glow); }
.run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-spinner { width: 14px; height: 14px; border: 2px solid rgba(0,0,0,0.2); border-top-color: #0b1119; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.val-error { margin-top: 8px; font-size: 12px; color: var(--danger); }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-tertiary); }
.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.8s linear infinite; }

.empty-state { text-align: center; padding: 40px; color: var(--text-tertiary); font-size: 14px; }

.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.section-header h2 { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.stock-count { font-size: 12px; font-weight: 400; color: var(--text-tertiary); margin-left: 4px; }
.section-header .accent { width: 3px; height: 14px; background: var(--brand-gradient); border-radius: 2px; }
.page-info { font-size: 12px; color: var(--text-tertiary); }

.card { margin-bottom: 20px; padding: 16px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; padding: 8px 12px; color: var(--text-tertiary); border-bottom: 1px solid var(--border); font-weight: 500; white-space: nowrap; }
td { padding: 8px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
td.num { font-variant-numeric: tabular-nums; text-align: right; }
td.code { color: var(--text-tertiary); font-size: 11px; }
.stock-row { cursor: pointer; }
.stock-row:hover td { background: var(--bg-card-hover); }
.analyze-btn { padding: 3px 10px; border: 1px solid var(--border); background: transparent; color: var(--brand); border-radius: var(--radius-sm); cursor: pointer; font-size: 11px; }
.analyze-btn:hover { background: var(--brand-glow); }

.pagination { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 0; }
.page-btn { border: 1px solid var(--border); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; transition: var(--transition); display: flex; align-items: center; justify-content: center; }
.page-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); background: var(--brand-glow); }
.page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.page-nav { width: 32px; height: 32px; padding: 0; font-size: 15px; }
.page-info { display: flex; align-items: center; gap: 4px; padding: 0 8px; }
.page-num { font-size: 15px; font-weight: 600; color: var(--brand); }
.page-sep { font-size: 13px; color: var(--text-tertiary); }
.page-total { font-size: 13px; color: var(--text-tertiary); }
@media (min-width: 768px) {
  .screener-view { padding: 24px 32px; }
}
@media (max-width: 640px) {
  .screener-view { padding: 12px; }
  .page-header { flex-direction: column; gap: 8px; align-items: flex-start; }
  .control-card { padding: 12px; margin-bottom: 12px; }
  .cond-row { flex-direction: column; align-items: stretch; gap: 6px; }
  .cond-select, .cond-input { width: 100%; box-sizing: border-box; }
  .control-row { flex-direction: column; gap: 8px; }
  .control-row select, .control-row input { width: 100%; box-sizing: border-box; }
  .card { padding: 12px; margin-bottom: 12px; }
  table { font-size: 11px; }
  th, td { padding: 6px 6px; }
}
</style>
