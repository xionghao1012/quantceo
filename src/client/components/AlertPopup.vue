<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAlertWebSocket, useAlertPopupQueue } from '../stores/alerts'

const router = useRouter()
const { connect } = useAlertWebSocket()
const { queue, consume } = useAlertPopupQueue()

const visible = ref(false)
const current = ref<any>(null)
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

const AUTO_CLOSE_MS = 8000

function showNext() {
  const msg = consume()
  if (!msg) return
  current.value = msg
  visible.value = true
  autoCloseTimer = setTimeout(dismiss, AUTO_CLOSE_MS)
}

function dismiss() {
  visible.value = false
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
  autoCloseTimer = null
  // 立即显示下一条（如果队列有）
  if (queue.value.length > 0) {
    setTimeout(showNext, 300)
  }
}

function viewDetail() {
  dismiss()
  router.push({ name: 'fund-flow-alerts' })
}

watch(queue, (q) => {
  if (q.length > 0 && !visible.value) {
    showNext()
  }
})

onMounted(() => connect())
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible && current" class="alert-popup-overlay" @click.self="dismiss">
        <div class="alert-popup">
          <div class="popup-header">
            <span class="popup-icon">💰</span>
            <span class="popup-title">主力资金告警</span>
            <button class="popup-close" @click="dismiss">×</button>
          </div>
          <div class="popup-body">
            <div class="stock-info">
              <span class="stock-name">{{ current.name }}</span>
              <span class="stock-code">{{ current.code }}</span>
            </div>
            <div class="alert-message">{{ current.message }}</div>
            <div class="alert-meta">
              <span v-if="current.price">最新价：¥{{ current.price.toFixed(2) }}</span>
              <span v-if="current.timestamp">{{ new Date(current.timestamp).toLocaleTimeString('zh-CN') }}</span>
            </div>
          </div>
          <div class="popup-footer">
            <button class="btn-detail" @click="viewDetail">查看详情</button>
            <button class="btn-dismiss" @click="dismiss">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.alert-popup-overlay {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}

.alert-popup {
  width: 340px;
  background: var(--bg-elevated, #1a1d2e);
  border: 1px solid var(--brand, #4fc3f7);
  border-radius: var(--radius);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(79,195,247,0.15);
  overflow: hidden;
  font-family: var(--font, inherit);
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(79,195,247,0.15), rgba(79,195,247,0.05));
  border-bottom: 1px solid rgba(79,195,247,0.2);
}

.popup-icon { font-size: 16px; }

.popup-title {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: var(--brand, #4fc3f7);
  letter-spacing: 0.5px;
}

.popup-close {
  background: none;
  border: none;
  color: var(--text-tertiary, #6b7280);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.popup-close:hover { color: var(--text-primary, #f9fafb); }

.popup-body { padding: 14px 16px; }

.stock-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.stock-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #f9fafb);
}

.stock-code {
  font-size: 12px;
  color: var(--text-tertiary, #6b7280);
  font-variant-numeric: tabular-nums;
}

.alert-message {
  font-size: 13px;
  color: var(--text-secondary, #d1d5db);
  margin-bottom: 8px;
  line-height: 1.5;
}

.alert-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-tertiary, #6b7280);
  font-variant-numeric: tabular-nums;
}

.popup-footer {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--border, rgba(255,255,255,0.08));
}

.btn-detail, .btn-dismiss {
  flex: 1;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-detail {
  background: var(--brand-gradient, linear-gradient(135deg, #4fc3f7, #29b6f6));
  border: none;
  color: #0b0d14;
}
.btn-detail:hover { opacity: 0.9; }

.btn-dismiss {
  background: transparent;
  border: 1px solid var(--border, rgba(255,255,255,0.12));
  color: var(--text-secondary, #d1d5db);
}
.btn-dismiss:hover {
  border-color: var(--text-tertiary, #6b7280);
  color: var(--text-primary, #f9fafb);
}

/* Transition */
.popup-enter-active { animation: slideIn 0.25s ease-out; }
.popup-leave-active { animation: slideOut 0.2s ease-in; }

@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px) scale(0.95); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes slideOut {
  from { opacity: 1; transform: translateX(0) scale(1); }
  to   { opacity: 0; transform: translateX(20px) scale(0.95); }
}
</style>
