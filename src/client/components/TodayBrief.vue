<script setup lang="ts">
/**
 * 今日速览：首屏先回答「今天该看哪 3 只」和「我的持仓有没有事」，
 * 再往下才是 5308 只股票的网格。
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

interface Pick {
  code: string
  name: string
  strength: number
  price: string
  strategies: string
  hits: number
  change_pct: string | null
}
interface Position {
  code: string
  name: string
  quantity: number
  entry_price: string
  price: string | null
  change_pct: string | null
  alerts_today: number
}

const date = ref('')
const picks = ref<Pick[]>([])
const positions = ref<Position[]>([])
const loaded = ref(false)
const failed = ref(false)

function fmtPct(v: string | null | undefined) {
  const n = Number(v)
  if (v == null || Number.isNaN(n)) return ''
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

function pnlOf(p: Position) {
  const price = Number(p.price)
  const entry = Number(p.entry_price)
  if (!price || !entry) return null
  return ((price - entry) / entry) * 100
}

onMounted(async () => {
  try {
    const res = await fetch('/api/digest/today', { headers: auth.authHeaders() })
    if (!res.ok) throw new Error('bad status')
    const data = await res.json()
    date.value = data.date || ''
    picks.value = data.picks || []
    positions.value = data.positions || []
  } catch {
    failed.value = true
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <section v-if="loaded && !failed" class="today-brief">
    <!-- 今天该看哪 3 只 -->
    <div class="brief-card">
      <div class="brief-head">
        <span class="brief-title">今天该看哪 3 只</span>
        <span class="brief-date" v-if="date">扫描于 {{ date }}</span>
      </div>
      <ul v-if="picks.length" class="pick-list">
        <li v-for="p in picks" :key="p.code" class="pick-row" @click="router.push(`/stock/${p.code}`)">
          <div class="pick-main">
            <span class="pick-name">{{ p.name }}</span>
            <span class="pick-code">{{ p.code }}</span>
          </div>
          <div class="pick-tags">
            <span v-if="p.hits > 1" class="pick-tag strong">{{ p.hits }} 策略共振</span>
            <span v-for="s in (p.strategies || '').split(' · ')" :key="s" class="pick-tag">{{ s }}</span>
          </div>
          <div class="pick-nums">
            <span class="pick-price">{{ p.price }}</span>
            <span class="pick-chg" :class="Number(p.change_pct) >= 0 ? 'up' : 'down'">{{ fmtPct(p.change_pct) }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="brief-empty">
        今天还没有产生信号 —— 扫描在每个交易日 18:30 自动运行，也可以去
        <router-link to="/scan">信号扫描</router-link> 手动看。
      </p>
    </div>

    <!-- 我的持仓 -->
    <div class="brief-card">
      <div class="brief-head">
        <span class="brief-title">我的持仓</span>
        <router-link to="/positions" class="brief-link">全部持仓</router-link>
      </div>
      <ul v-if="positions.length" class="pick-list">
        <li v-for="p in positions" :key="p.code" class="pick-row" @click="router.push(`/stock/${p.code}`)">
          <div class="pick-main">
            <span class="pick-name">{{ p.name }}</span>
            <span class="pick-code">{{ p.code }} · {{ p.quantity }} 股</span>
          </div>
          <div class="pick-tags">
            <span v-if="p.alerts_today > 0" class="pick-tag alert">{{ p.alerts_today }} 条资金流异动</span>
            <span v-else class="pick-tag quiet">无异动</span>
          </div>
          <div class="pick-nums">
            <span class="pick-price">{{ p.price || '—' }}</span>
            <span class="pick-chg" :class="(pnlOf(p) ?? 0) >= 0 ? 'up' : 'down'">
              {{ pnlOf(p) == null ? '' : fmtPct(String(pnlOf(p))) }}
            </span>
          </div>
        </li>
      </ul>
      <p v-else class="brief-empty">
        还没有持仓记录 —— 记一笔持仓，这里会每天告诉你它有没有事。
        <router-link to="/positions">去添加</router-link>
      </p>
    </div>
  </section>
</template>

<style scoped>
.today-brief {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 18px;
}

@media (max-width: 900px) {
  .today-brief {
    grid-template-columns: 1fr;
  }
}

.brief-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}

.brief-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}

.brief-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.brief-date {
  font-size: 11px;
  color: var(--text-tertiary);
}

.brief-link {
  font-size: 12px;
  color: var(--brand);
  text-decoration: none;
}

.pick-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.pick-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}

.pick-row:last-child {
  border-bottom: none;
}

.pick-row:hover {
  background: rgba(255, 255, 255, 0.02);
}

.pick-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pick-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.pick-code {
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.pick-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pick-tag {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  background: var(--brand-glow);
  color: var(--brand);
  white-space: nowrap;
}

.pick-tag.strong {
  background: rgba(245, 158, 11, 0.16);
  color: #f59e0b;
  font-weight: 600;
}

.pick-tag.alert {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}

.pick-tag.quiet {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-tertiary);
}

.pick-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.pick-price {
  font-size: 13px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.pick-chg {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.pick-chg.up {
  color: var(--up);
}

.pick-chg.down {
  color: var(--down);
}

.brief-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-tertiary);
}

.brief-empty a {
  color: var(--brand);
  text-decoration: none;
}
</style>
