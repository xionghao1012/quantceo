<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

const hasError = ref(false)
const errorMsg = ref('')

onErrorCaptured((err: any) => {
  hasError.value = true
  errorMsg.value = err?.message || '页面加载失败'
  console.error('[ErrorBoundary]', err)
  return false
})

function reload() {
  hasError.value = false
  window.location.reload()
}
</script>

<template>
  <div v-if="hasError" class="error-boundary">
    <div class="error-content">
      <div class="error-icon">⚠️</div>
      <h2>页面加载失败</h2>
      <p>{{ errorMsg }}</p>
      <button class="reload-btn" @click="reload">重新加载</button>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 40px 20px;
}

.error-content {
  text-align: center;
  max-width: 400px;
}

.error-icon { font-size: 48px; margin-bottom: 16px; }

h2 {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 8px;
}

p {
  font-size: 14px;
  color: var(--text-secondary, #aaa);
  margin: 0 0 20px;
  font-family: monospace;
  padding: 8px 12px;
  background: rgba(239,68,68,0.1);
  border-radius: 8px;
}

.reload-btn {
  padding: 10px 24px;
  background: var(--brand, #f59e0b);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #000;
  cursor: pointer;
}
</style>
