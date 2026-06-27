import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@shared/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const refreshToken = ref(localStorage.getItem('refreshToken') || '')
  const user = ref<User | null>(null)
  let _userPromise: Promise<void> | null = null

  const isLoggedIn = computed(() => !!token.value)
  const role = computed(() => user.value?.role || 'free')

  function saveSession(t: string, rt: string) {
    token.value = t
    refreshToken.value = rt
    localStorage.setItem('token', t)
    localStorage.setItem('refreshToken', rt)
  }

  async function fetchUser() {
    if (!token.value) return
    if (_userPromise) return _userPromise
    _userPromise = (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token.value}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.user) user.value = data.user
          else clearSession()
        } else if (res.status === 401 || res.status === 403) {
          clearSession()
        }
      } catch {
      } finally {
        _userPromise = null
      }
    })()
    return _userPromise
  }

  async function register(email: string, password: string, name?: string) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '注册失败')
    }
    const data = await res.json()
    saveSession(data.token, data.refreshToken)
    user.value = data.user
  }

  async function login(email: string, password: string) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || (res.status >= 500 ? '认证服务暂时不可用，请稍后重试' : '登录失败'))
      }
      const data = await res.json()
      saveSession(data.token, data.refreshToken)
      user.value = data.user
    } catch (e: any) {
      if (e.message.includes('fetch') || e.message.includes('network') || e.message.includes('ECONNREFUSED')) {
        throw new Error('认证服务暂时不可用，请稍后重试')
      }
      throw e
    }
  }

  async function refresh() {
    if (!refreshToken.value) {
      clearSession()
      return false
    }
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken.value }),
      })
      if (res.ok) {
        const data = await res.json()
        saveSession(data.token, data.refreshToken)
        user.value = data.user
        return true
      }
    } catch {}
    clearSession()
    return false
  }

  function clearSession() {
    token.value = ''
    refreshToken.value = ''
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
  }

  function logout() {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
    }).catch(() => {})
    clearSession()
  }

  function authHeaders(): Record<string, string> {
    return token.value ? { Authorization: `Bearer ${token.value}` } : {}
  }

  return {
    token, refreshToken, user, isLoggedIn, role,
    fetchUser, register, login, refresh, logout, authHeaders,
  }
})
