<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.push('/')
  } catch (e: any) {
    error.value = e.message
  }
  loading.value = false
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-container">
      <div class="brand-header">
        <div class="brand-logo">Q</div>
        <h1 class="brand-title">QuantCEO</h1>
        <p class="brand-subtitle">A股量化交易辅助决策系统</p>
      </div>
      <div class="auth-card">
        <h2 class="card-title">登录</h2>
        <form @submit.prevent="handleLogin">
          <div class="field">
            <label>邮箱</label>
            <input type="email" v-model="email" placeholder="your@email.com" required autocomplete="email" />
          </div>
          <div class="field">
            <label>密码</label>
            <input type="password" v-model="password" placeholder="&#xb7;&#xb7;&#xb7;&#xb7;&#xb7;&#xb7;" required minlength="6" autocomplete="current-password" />
          </div>
          <div v-if="error" class="error-text">{{ error }}</div>
          <button type="submit" class="btn-primary" :disabled="loading">
            <span v-if="loading" class="btn-spinner"></span>
            <span>{{ loading ? '登录中...' : '登录' }}</span>
          </button>
        </form>
        <div class="bottom-links">
          <router-link to="/forgot-password" class="forgot-link">忘记密码？</router-link>
          <span class="sep">·</span>
          <router-link to="/register">注册账号</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 60%),
              radial-gradient(ellipse at 80% 100%, rgba(139,92,246,0.04) 0%, transparent 50%);
  padding: 20px;
  box-sizing: border-box;
}
.auth-container {
  width: 100%;
  max-width: min(420px, 92vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
}
@media (min-width: 768px) {
  .auth-container { gap: 32px; padding: 20px 0; }
}
.brand-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.brand-logo {
  width: 52px;
  height: 52px;
  background: var(--brand-gradient);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0b0d14;
  font-size: 22px;
  font-weight: 800;
  box-shadow: 0 0 24px var(--brand-glow);
}
.brand-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.brand-subtitle {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}
.auth-card {
  width: 100%;
  padding: 28px 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-sizing: border-box;
  box-shadow: 0 4px 24px rgba(0,0,0,0.15);
}
@media (min-width: 768px) {
  .auth-card { padding: 36px 32px; }
}
.card-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 20px;
  text-align: center;
  color: var(--text-primary);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 14px;
}
.field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.field input {
  padding: 10px 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-primary);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.15s;
}
.field input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-glow);
}
.field input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.5;
}
.error-text {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: rgba(239,68,68,0.08);
  border-radius: var(--radius-sm);
  border: 1px solid rgba(239,68,68,0.15);
}
.btn-primary {
  width: 100%;
  padding: 10px;
  background: var(--brand-gradient);
  color: #0b0d14;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 12px var(--brand-glow);
  transition: transform 0.15s, box-shadow 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px var(--brand-glow);
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(11,13,20,0.3);
  border-top-color: #0b0d14;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.bottom-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
  font-size: 13px;
}
.forgot-link {
  color: var(--text-secondary);
  text-decoration: none;
}
.forgot-link:hover {
  color: var(--brand);
  text-decoration: underline;
}
.sep {
  color: var(--border);
}
.bottom-links a:last-child {
  color: var(--brand);
  text-decoration: none;
  font-weight: 500;
}
.bottom-links a:last-child:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .auth-page { padding: 16px; min-height: 90vh; }
  .auth-card { padding: 24px 20px; }
  .brand-logo { width: 44px; height: 44px; font-size: 18px; }
  .brand-title { font-size: 20px; }
  .field input { font-size: 16px; }
  .btn-primary { font-size: 15px; min-height: 44px; }
}
</style>
