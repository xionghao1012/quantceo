<script setup lang="ts">
/**
 * 数据可信度标记：把「数据截至哪天、覆盖多少只」摆到明面上。
 * 16M 行 K 线是我们真正的壁垒，但用户看不见就等于没有。
 */
import { ref, onMounted } from 'vue'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const info = ref<{ date: string; metricsDate?: string; stocks: number; indicators: number; lastUpdate: string } | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    const res = await fetch('/api/data/freshness')
    if (!res.ok) throw new Error('bad status')
    info.value = await res.json()
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <span v-if="info" class="freshness" :class="{ compact: props.compact }">
    <span class="dot" aria-hidden="true"></span>
    行情截至 <b>{{ info.date || '—' }}</b>
    <template v-if="info.stocks"> · 覆盖 <b>{{ info.stocks.toLocaleString() }}</b> 只 A 股</template>
    <template v-if="info.metricsDate && info.metricsDate !== info.date"> · 指标截至 <b>{{ info.metricsDate }}</b></template>
    <template v-else-if="!props.compact && info.indicators"> · <b>{{ (info.indicators / 10000).toFixed(1) }}</b> 万条日指标</template>
  </span>
  <span v-else-if="failed" class="freshness stale">数据状态未知</span>
</template>

<style scoped>
.freshness {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.freshness.compact {
  font-size: 11px;
}

.freshness b {
  color: var(--text-secondary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand);
  flex: none;
}

.stale {
  color: var(--text-tertiary);
  opacity: 0.7;
}
</style>
