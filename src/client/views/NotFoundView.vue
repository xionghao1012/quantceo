<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="not-found">
    <h1>404</h1>
    <p>页面不存在</p>
    <button class="back-btn" @click="router.push('/dashboard')">返回看板</button>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
  gap: 12px;
}
.not-found h1 { font-size: 64px; color: var(--text-tertiary); }
.not-found p { font-size: 16px; color: var(--text-secondary); }
.back-btn {
  padding: 8px 20px;
  background: var(--brand-gradient);
  color: #0b0d14;
  border: none;
  border-radius: var(--radius-sm);
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 12px var(--brand-glow);
  transition: var(--transition);
}
.back-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px var(--brand-glow);
}
</style>
