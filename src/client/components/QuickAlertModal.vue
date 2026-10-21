<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const props = defineProps<{ stock: { code: string; name: string } }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const router = useRouter()
const auth = useAuthStore()

const existingConfig = ref<any | null>(null)
const loading = ref(true)

async function checkExisting() {
  try {
    const res = await fetch(`/api/moneyflow/alerts/configs?code=${props.stock.code}`, {
      headers: auth.authHeaders(),
    })
    if (res.ok) {
      const configs = await res.json()
      existingConfig.value = configs.find((c: any) => c.code === props.stock.code) || null
    }
  } catch {}
  loading.value = false
}

function viewConfig() {
  if (!existingConfig.value) return
  router.push(`/fund-flow/alerts/edit/${existingConfig.value.id}`)
  emit('close')
}

function createNew() {
  router.push({
    name: 'fund-flow-alerts-create',
    state: { code: props.stock.code, name: props.stock.name },
  })
  emit('close')
}

onMounted(checkExisting)
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-icon">⚡</span>
          <span class="modal-title">设置告警</span>
          <button class="close-btn" @click="emit('close')">×</button>
        </div>

        <div class="modal-body">
          <div v-if="loading" class="loading">检查已有配置...</div>
          <template v-else>
            <div class="stock-info">
              <span class="stock-name">{{ stock.name }}</span>
              <span class="stock-code">{{ stock.code }}</span>
            </div>

            <div v-if="existingConfig" class="existing-config">
              <div class="existing-badge">已有告警配置</div>
              <div class="existing-detail">
                <span>{{ existingConfig.direction === 'inflow' ? '流入' : '流出' }}</span>
                <span>{{ existingConfig.thresholdValue }}万</span>
              </div>
              <div class="existing-actions">
                <button class="btn-primary" @click="viewConfig">查看配置</button>
                <button class="btn-secondary" @click="createNew">新建配置</button>
              </div>
            </div>

            <div v-else class="no-config">
              <p>尚未为该股票设置告警</p>
              <button class="btn-primary full" @click="createNew">
                为 {{ stock.name }} 创建告警
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}

.modal {
  width: 360px;
  background: var(--bg-elevated, #1a1d2e);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  background: linear-gradient(135deg, rgba(79,195,247,0.1), rgba(79,195,247,0.05));
  border-bottom: 1px solid var(--border);
}

.modal-icon { font-size: 16px; }
.modal-title { flex: 1; font-size: 15px; font-weight: 700; color: var(--brand); }

.close-btn {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
}
.close-btn:hover { color: var(--text-primary); }

.modal-body { padding: 20px; }

.loading { text-align: center; color: var(--text-tertiary); padding: 20px; font-size: 13px; }

.stock-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 16px;
}
.stock-name { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.stock-code { font-size: 13px; color: var(--text-tertiary); }

.existing-config { display: flex; flex-direction: column; gap: 12px; }

.existing-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--brand);
  background: var(--brand-glow);
  padding: 3px 10px;
  border-radius: var(--radius-lg);
  display: inline-block;
  width: fit-content;
}

.existing-detail {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.existing-actions { display: flex; gap: 8px; }

.no-config p { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }

.btn-primary, .btn-secondary {
  flex: 1;
  padding: 9px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-primary {
  background: var(--brand-gradient);
  border: none;
  color: #0b0d14;
}
.btn-primary:hover { opacity: 0.9; }
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}
.btn-secondary:hover { border-color: var(--brand); color: var(--brand); }
.btn-primary.full { width: 100%; }
</style>
