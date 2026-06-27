<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)
const token = ref('')
const tokenInvalid = ref(false)

onMounted(() => {
  token.value = route.query.token as string
  if (!token.value) {
    tokenInvalid.value = true
  }
})

async function handleSubmit() {
  error.value = ''
  if (password.value.length < 6) {
    error.value = '密码至少 6 位'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  try {
    const res = await fetch('http://localhost:3002/api/auth/password-reset/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value, password: password.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '重置失败')
    success.value = true
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="card auth-card">
      <h1>设置新密码</h1>

      <div v-if="tokenInvalid" class="error-box">
        <p>❌ 重置链接无效或已过期</p>
        <button class="btn-primary" @click="router.push('/forgot-password')">重新申请</button>
      </div>

      <div v-else-if="success" class="success-box">
        <p>✅ 密码重置成功！</p>
        <p class="hint">请使用新密码登录。</p>
        <button class="btn-primary" @click="router.push('/login')">去登录</button>
      </div>

      <form v-else @submit.prevent="handleSubmit">
        <div class="field">
          <label>新密码</label>
          <input
            v-model="password"
            type="password"
            placeholder="至少 6 位"
            required
            minlength="6"
          />
        </div>
        <div class="field">
          <label>确认新密码</label>
          <input
            v-model="confirmPassword"
            type="password"
            placeholder="再次输入新密码"
            required
          />
        </div>
        <div v-if="error" class="error-text">{{ error }}</div>
        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? '设置中...' : '确认重置' }}
        </button>
      </form>

      <p class="switch-text">
        <router-link to="/login">返回登录</router-link>
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
  color: var(--danger, #ef4444);
  font-size: 13px;
  margin-bottom: 12px;
}
.error-box {
  text-align: center;
  padding: 16px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius);
  margin-bottom: 16px;
}
.error-box p { margin: 0 0 8px; font-size: 14px; color: #ef4444; }
.success-box {
  text-align: center;
  padding: 16px;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: var(--radius);
  margin-bottom: 16px;
}
.success-box p { margin: 0 0 8px; font-size: 14px; color: #22c55e; }
.success-box .hint { font-size: 12px; color: var(--text-secondary, #aaa); margin-bottom: 8px; }
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
  transition: var(--transition);
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.switch-text {
  text-align: center;
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-tertiary);
}
.switch-text a { color: var(--brand); text-decoration: none; }

@media (max-width: 480px) {
  .auth-container { padding: 20px 16px; }
  .auth-card { padding: 24px 20px; }
  .auth-card h2 { font-size: 18px; }
  .field input { font-size: 16px; }
  .btn-primary { font-size: 15px; min-height: 44px; }
}
</style>
