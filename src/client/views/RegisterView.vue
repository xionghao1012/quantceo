<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref('')
const loading = ref(false)

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    await auth.register(email.value, password.value, name.value || undefined)
    router.push('/')
  } catch (e: any) {
    error.value = e.message
  }
  loading.value = false
}
</script>

<template>
  <div class="auth-page">
    <div class="card auth-card">
      <h1>注册</h1>
      <form @submit.prevent="handleRegister">
        <div class="field">
          <label>邮箱</label>
          <input type="email" v-model="email" placeholder="your@email.com" required />
        </div>
        <div class="field">
          <label>昵称（可选）</label>
          <input type="text" v-model="name" placeholder="默认为邮箱前缀" />
        </div>
        <div class="field">
          <label>密码</label>
          <input type="password" v-model="password" placeholder="至少6位" required minlength="6" />
        </div>
        <div v-if="error" class="error-text">{{ error }}</div>
        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? '注册中...' : '注册' }}
        </button>
      </form>
      <p class="switch-text">
        已有账号？<router-link to="/login">登录</router-link>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}
.auth-card {
  width: 100%;
  max-width: min(440px, 92vw);
  padding: 32px 28px;
  box-sizing: border-box;
}
@media (min-width: 768px) {
  .auth-card { padding: 40px 36px; }
}
.auth-card h2 {
  font-size: 20px;
  margin-bottom: 24px;
  text-align: center;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.field label {
  font-size: 12px;
  color: var(--text-tertiary);
}
.field input {
  padding: 10px 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-primary);
  border-radius: var(--radius);
  font-size: 14px;
}
.field input:focus {
  outline: none;
  border-color: var(--brand);
}
.error-text {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 12px;
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
  transition: var(--transition);
}
.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px var(--brand-glow);
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.switch-text {
  text-align: center;
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-tertiary);
}
.switch-text a {
  color: var(--brand);
  text-decoration: none;
}

@media (max-width: 480px) {
  .auth-container { padding: 20px 16px; }
  .auth-card { padding: 24px 20px; }
  .auth-card h2 { font-size: 18px; }
  .field input { font-size: 16px; }
  .btn-primary { font-size: 15px; min-height: 44px; }
}
</style>
