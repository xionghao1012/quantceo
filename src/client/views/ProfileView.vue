<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import TermTip from '../components/TermTip.vue'

const router = useRouter()
const auth = useAuthStore()
const activeTab = ref<'profile' | 'push' | 'usage' | 'apikeys' | 'referral'>('profile')
const saving = ref(false)
const msg = ref('')

const name = ref(auth.user?.name || '')

const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwMsg = ref('')
const pwSaving = ref(false)
const subStats = ref<any>(null)
const subLoading = ref(false)

const referralCode = ref('')
const referralRewards = ref<any[]>([])
const referralStats = ref({ totalEarnings: 0, totalReferees: 0 })
const referralLoading = ref(false)
const applyCodeInput = ref('')
const applyMsg = ref('')
const applyLoading = ref(false)
const copyMsg = ref('')

onMounted(() => {
  name.value = auth.user?.name || ''
  loadSubStats()
})

async function loadSubStats() {
  if (!auth.isLoggedIn) return
  subLoading.value = true
  try {
    const res = await fetch('/api/subscription/me', { headers: auth.authHeaders() })
    if (res.ok) subStats.value = await res.json()
  } finally {
    subLoading.value = false
  }
}

async function saveProfile() {
  saving.value = true
  msg.value = ''
  try {
    const res = await fetch('/api/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ name: name.value }),
    })
    if (res.ok) {
      const data = await res.json()
      auth.user = data.user
      msg.value = '保存成功'
    } else {
      const err = await res.json()
      msg.value = err.error || '保存失败'
    }
  } catch {
    msg.value = '网络错误'
  }
  saving.value = false
}

async function changePassword() {
  pwMsg.value = ''
  if (!pwCurrent.value || !pwNew.value) {
    pwMsg.value = '请填写所有密码字段'
    return
  }
  if (pwNew.value !== pwConfirm.value) {
    pwMsg.value = '两次输入的新密码不一致'
    return
  }
  if (pwNew.value.length < 8) {
    pwMsg.value = '新密码至少8位'
    return
  }
  if (!/[a-zA-Z]/.test(pwNew.value)) {
    pwMsg.value = '新密码需包含字母'
    return
  }
  if (!/[0-9]/.test(pwNew.value)) {
    pwMsg.value = '新密码需包含数字'
    return
  }
  pwSaving.value = true
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ currentPassword: pwCurrent.value, newPassword: pwNew.value }),
    })
    const data = await res.json()
    if (res.ok) {
      pwMsg.value = '密码修改成功'
      pwCurrent.value = ''
      pwNew.value = ''
      pwConfirm.value = ''
    } else {
      pwMsg.value = data.error || '修改失败'
    }
  } catch {
    pwMsg.value = '网络错误'
  }
  pwSaving.value = false
}

const pushSettings = ref({
  channels: { inApp: true, wechat: false, email: false },
  triggers: { onSignal: true, dailyDigest: false, weeklyReport: false },
  filter: { minStrength: 50, onlyBuy: false, codes: [] as string[] },
  hasServerChanKey: false,
  serverChanKey: '',
})
const pushMsg = ref('')
const pushSaving = ref(false)
const showServerChanKey = ref(false)

const apiKeys = ref<any[]>([])
const apiKeysLoading = ref(false)
const creatingKey = ref(false)
const newKeyName = ref('')
const newKeyValue = ref('')

async function loadApiKeys() {
  if (!auth.isLoggedIn) return
  apiKeysLoading.value = true
  try {
    const res = await fetch('/api/api-keys', { headers: auth.authHeaders() })
    if (res.ok) apiKeys.value = await res.json()
    else if (res.status === 403) apiKeys.value = []
  } finally {
    apiKeysLoading.value = false
  }
}

async function createApiKey() {
  if (!newKeyName.value.trim()) return
  creatingKey.value = true
  try {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ name: newKeyName.value }),
    })
    if (res.ok) {
      const data = await res.json()
      newKeyValue.value = data.key
      await loadApiKeys()
      newKeyName.value = ''
    }
  } finally {
    creatingKey.value = false
  }
}

async function revokeApiKey(id: number) {
  await fetch(`/api/api-keys/${id}`, { method: 'DELETE', headers: auth.authHeaders() })
  await loadApiKeys()
}

async function loadReferral() {
  referralLoading.value = true
  try {
    const [codeRes, rewardsRes] = await Promise.all([
      fetch('/api/referral/code', { headers: auth.authHeaders() }),
      fetch('/api/referral/rewards', { headers: auth.authHeaders() }),
    ])
    if (codeRes.ok) {
      const codeData = await codeRes.json()
      referralCode.value = codeData.code
    }
    if (rewardsRes.ok) {
      const rewardsData = await rewardsRes.json()
      referralRewards.value = rewardsData.rewards || []
      referralStats.value = rewardsData.stats || { totalEarnings: 0, totalReferees: 0 }
    }
  } finally {
    referralLoading.value = false
  }
}

async function applyReferralCode() {
  if (!applyCodeInput.value.trim()) return
  applyLoading.value = true
  applyMsg.value = ''
  try {
    const res = await fetch('/api/referral/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ code: applyCodeInput.value }),
    })
    const data = await res.json()
    if (res.ok) {
      applyMsg.value = `成功获得 ${data.reward} 积分奖励！`
      applyCodeInput.value = ''
      await loadReferral()
    } else {
      applyMsg.value = data.error || '邀请码无效'
    }
  } finally {
    applyLoading.value = false
  }
}

async function loadPushSettings() {
  if (!auth.isLoggedIn) return
  const res = await fetch('/api/push/settings', { headers: auth.authHeaders() })
  if (res.ok) {
    const data = await res.json()
    pushSettings.value = {
      ...data.settings,
      serverChanKey: '',
    }
  }
}
onMounted(() => { loadPushSettings() })

async function savePushSettings() {
  pushSaving.value = true
  pushMsg.value = ''
  try {
    const body: any = {
      channels: pushSettings.value.channels,
      triggers: pushSettings.value.triggers,
      filter: pushSettings.value.filter,
    }
    if (pushSettings.value.serverChanKey) {
      body.serverChanKey = pushSettings.value.serverChanKey
    }
    const res = await fetch('/api/push/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      pushSettings.value = { ...data.settings, serverChanKey: '' }
      pushMsg.value = '保存成功'
    } else {
      const err = await res.json()
      pushMsg.value = err.error || '保存失败'
    }
  } catch {
    pushMsg.value = '网络错误'
  }
  pushSaving.value = false
}
</script>

<template>
  <div class="profile-page">
    <div class="page-header">
      <h1>个人中心</h1>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'profile' }" @click="activeTab = 'profile'">个人信息</button>
      <button class="tab" :class="{ active: activeTab === 'push' }" @click="activeTab = 'push'">推送设置</button>
      <button class="tab" :class="{ active: activeTab === 'usage' }" @click="activeTab = 'usage'; loadSubStats()">我的套餐</button>
      <button class="tab" :class="{ active: activeTab === 'apikeys' }" @click="activeTab = 'apikeys'; loadApiKeys()">API Keys</button>
      <button class="tab" :class="{ active: activeTab === 'referral' }" @click="activeTab = 'referral'; loadReferral()">推荐奖励</button>
    </div>

    <div v-if="activeTab === 'profile'" class="card profile-card">
      <div class="field">
        <label>邮箱</label>
        <input :value="auth.user?.email" disabled class="field-disabled" />
      </div>
      <div class="field">
        <label>当前套餐</label>
        <div class="plan-badge-field">
          <span class="plan-name-display">{{ subStats?.planName || auth.user?.role || 'free' }}</span>
          <button v-if="subStats?.plan === 'free'" class="upgrade-link" @click="router.push('/upgrade')">升级 →</button>
        </div>
      </div>
      <div class="field">
        <label>昵称</label>
        <input v-model="name" maxlength="50" />
      </div>
      <div v-if="msg" class="msg" :class="msg === '保存成功' ? 'success' : 'error'">{{ msg }}</div>
      <button class="btn-primary" @click="saveProfile" :disabled="saving">
        {{ saving ? '保存中...' : '保存' }}
      </button>

      <div class="section-divider" />
      <div class="section-title-sm">修改密码</div>
      <div class="field">
        <label>当前密码</label>
        <input v-model="pwCurrent" type="password" placeholder="请输入当前密码" />
      </div>
      <div class="field">
        <label>新密码</label>
        <input v-model="pwNew" type="password" placeholder="8位以上，包含字母和数字" />
      </div>
      <div class="field">
        <label>确认新密码</label>
        <input v-model="pwConfirm" type="password" placeholder="再次输入新密码" />
      </div>
      <div v-if="pwMsg" class="msg" :class="pwMsg === '密码修改成功' ? 'success' : 'error'">{{ pwMsg }}</div>
      <button class="btn-primary" @click="changePassword" :disabled="pwSaving">
        {{ pwSaving ? '修改中...' : '修改密码' }}
      </button>
    </div>

    <div v-if="activeTab === 'push'" class="card push-card">
      <div class="section-title">通知渠道</div>
      <div class="toggle-row">
        <span class="toggle-label">站内通知</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.channels.inApp" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">微信推送 (ServerChan)</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.channels.wechat" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div v-if="pushSettings.channels.wechat" class="field">
        <label>ServerChan Key</label>
        <div class="key-input-row">
          <input
            v-model="pushSettings.serverChanKey"
            :type="showServerChanKey ? 'text' : 'password'"
            placeholder="填写 ServerChan SCUxxx"
            class="key-input"
          />
          <button class="btn-ghost btn-sm" @click="showServerChanKey = !showServerChanKey">
            {{ showServerChanKey ? '隐藏' : '显示' }}
          </button>
        </div>
        <span v-if="pushSettings.hasServerChanKey" class="hint success">已配置Key</span>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">邮件推送</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.channels.email" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="section-title mt">触发条件</div>
      <div class="toggle-row">
        <span class="toggle-label">收到信号时通知</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.triggers.onSignal" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">每日行情简报</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.triggers.dailyDigest" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">每周报告</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.triggers.weeklyReport" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="section-title mt">过滤条件</div>
      <div class="filter-row">
        <span class="toggle-label">最小信号强度</span>
        <div class="strength-input">
          <input
            type="range"
            v-model.number="pushSettings.filter.minStrength"
            min="10"
            max="100"
            step="5"
          />
          <span class="strength-val">{{ pushSettings.filter.minStrength }}</span>
        </div>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">仅显示买入信号</span>
        <label class="toggle">
          <input type="checkbox" v-model="pushSettings.filter.onlyBuy" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div v-if="pushMsg" class="msg" :class="pushMsg === '保存成功' ? 'success' : 'error'">{{ pushMsg }}</div>
      <button class="btn-primary" @click="savePushSettings" :disabled="pushSaving">
        {{ pushSaving ? '保存中...' : '保存推送设置' }}
      </button>
    </div>

    <div v-if="activeTab === 'usage'" class="card usage-card">
      <div v-if="subLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <template v-else-if="subStats">
        <div class="usage-plan-header">
          <div class="plan-label">{{ subStats.planName }}</div>
          <button v-if="subStats.plan !== 'premium'" class="upgrade-btn" @click="router.push('/upgrade')">
            升级套餐 →
          </button>
        </div>

        <div class="usage-grid">
          <div class="usage-item">
            <div class="usage-item-label">今日扫描</div>
            <div class="usage-bar-wrap">
              <div class="usage-bar">
                <div class="usage-bar-fill" :style="{ width: subStats.usage?.scans?.limit !== Infinity ? (subStats.usage.scans.used / subStats.usage.scans.limit * 100) + '%' : '100%' }" />
              </div>
              <span class="usage-count">{{ subStats.usage?.scans?.used || 0 }} / {{ subStats.usage?.scans?.limit === Infinity ? '∞' : subStats.usage?.scans?.limit }}</span>
            </div>
          </div>
          <div class="usage-item">
            <div class="usage-item-label">今日回测<TermTip term="backtest" /></div>
            <div class="usage-bar-wrap">
              <div class="usage-bar">
                <div class="usage-bar-fill" :style="{ width: subStats.usage?.backtests?.limit !== Infinity ? (subStats.usage.backtests.used / subStats.usage.backtests.limit * 100) + '%' : '100%' }" />
              </div>
              <span class="usage-count">{{ subStats.usage?.backtests?.used || 0 }} / {{ subStats.usage?.backtests?.limit === Infinity ? '∞' : subStats.usage?.backtests?.limit }}</span>
            </div>
          </div>
          <div class="usage-item">
            <div class="usage-item-label">自选股</div>
            <div class="usage-bar-wrap">
              <div class="usage-bar">
                <div class="usage-bar-fill" :style="{ width: (subStats.usage?.watchlist?.used / subStats.usage?.watchlist?.limit * 100) + '%' }" />
              </div>
              <span class="usage-count">{{ subStats.usage?.watchlist?.used || 0 }} / {{ subStats.usage?.watchlist?.limit === Infinity ? '∞' : subStats.usage?.watchlist?.limit }}</span>
            </div>
          </div>
        </div>

        <div class="features-list">
          <div class="features-title">套餐功能</div>
          <div v-for="f in subStats.features" :key="f" class="feature-item">✓ {{ f }}</div>
        </div>
      </template>
    </div>

    <div v-if="activeTab === 'apikeys'" class="card apikeys-card">
      <div class="apikeys-header">
        <h3>API Keys</h3>
        <p class="apikeys-desc">使用 API Key 通过程序访问 QuantCEO 数据接口（Premium专属）</p>
      </div>
      <div v-if="apiKeysLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <template v-else>
        <div class="apikeys-list">
          <div v-for="k in apiKeys" :key="k.id" class="apikey-item">
            <div class="apikey-info">
              <div class="apikey-name">{{ k.name }}</div>
              <div class="apikey-meta">
                <span>创建于 {{ new Date(k.createdAt).toLocaleDateString('zh-CN') }}</span>
                <span v-if="k.lastUsedAt">· 最后使用 {{ new Date(k.lastUsedAt).toLocaleDateString('zh-CN') }}</span>
                <span v-if="k.expiresAt">· 过期 {{ new Date(k.expiresAt).toLocaleDateString('zh-CN') }}</span>
              </div>
            </div>
            <button class="btn-danger-sm" @click="revokeApiKey(k.id)">撤销</button>
          </div>
          <div v-if="apiKeys.length === 0" class="empty-state">暂无 API Keys</div>
        </div>

        <div v-if="newKeyValue" class="new-key-display">
          <div class="new-key-label">新 API Key（请妥善保管，仅显示一次）</div>
          <div class="new-key-value">{{ newKeyValue }}</div>
          <button class="btn-secondary" @click="newKeyValue = ''">关闭</button>
        </div>

        <div class="create-key-form">
          <input v-model="newKeyName" placeholder="Key 名称，如：我的量化脚本" maxlength="100" />
          <button class="btn-primary" @click="createApiKey" :disabled="creatingKey || !newKeyName.trim()">
            {{ creatingKey ? '创建中...' : '创建 Key' }}
          </button>
        </div>
      </template>
    </div>

    <div v-if="activeTab === 'referral'" class="card referral-card">
      <div class="referral-header">
        <h3>推荐奖励</h3>
        <p class="referral-desc">分享你的邀请码，每成功邀请一位好友，双方均可获得100积分奖励</p>
      </div>

      <div class="referral-code-section">
        <div class="referral-code-label">你的邀请码</div>
        <div class="referral-code-value">{{ referralCode || '加载中...' }}</div>
        <button class="btn-sm" @click="navigator.clipboard.writeText(referralCode).then(() => { copyMsg = '已复制！' ; setTimeout(() => copyMsg = '', 2000) })">
          复制邀请码
        </button>
      </div>

      <div class="referral-apply-section">
        <div class="referral-code-label">输入朋友的邀请码</div>
        <div class="referral-apply-form">
          <input v-model="applyCodeInput" placeholder="输入邀请码" maxlength="20" class="referral-input" />
          <button class="btn-primary" @click="applyReferralCode" :disabled="applyLoading || !applyCodeInput.trim()">
            {{ applyLoading ? '验证中...' : '激活奖励' }}
          </button>
        </div>
        <div v-if="applyMsg" class="apply-msg" :class="applyMsg.includes('成功') ? 'success' : 'error'">{{ applyMsg }}</div>
      </div>

      <div class="referral-stats">
        <div class="stat-item">
          <div class="stat-value">{{ referralStats.totalReferees }}</div>
          <div class="stat-label">已邀请好友</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ referralStats.totalEarnings }}</div>
          <div class="stat-label">累计积分奖励</div>
        </div>
      </div>

      <div v-if="referralLoading" class="loading-state"><div class="spinner" /><span>加载中...</span></div>
      <div v-else-if="referralRewards.length === 0" class="empty-state">暂无邀请记录</div>
      <div v-else class="referral-list">
        <div v-for="r in referralRewards" :key="r.id" class="referral-item">
          <div class="referral-item-info">
            <div class="referral-item-name">{{ r.refereeName }}</div>
            <div class="referral-item-meta">{{ new Date(r.createdAt).toLocaleDateString('zh-CN') }} · {{ r.status === 'earned' ? '已获得奖励' : r.status }}</div>
          </div>
          <div class="referral-item-amount">+{{ r.amount }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-header h1 { font-size: 18px; font-weight: 600; }

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0;
}
.tab {
  padding: 8px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  margin-bottom: -1px;
}
.tab:hover { color: var(--text-primary); }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); }

.profile-card, .push-card { max-width: min(720px, calc(100% - 32px)); }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.field label { font-size: 12px; color: var(--text-tertiary); }
.field input, .field-disabled {
  padding: 8px 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-primary);
  border-radius: var(--radius);
  font-size: 14px;
}
.field-disabled { opacity: 0.6; }
.btn-primary {
  padding: 8px 24px;
  background: var(--brand-gradient);
  color: #0b0d14;
  border: none;
  border-radius: var(--radius-sm);
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
  box-shadow: 0 2px 12px var(--brand-glow);
  transition: var(--transition);
  margin-top: 8px;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 20px var(--brand-glow); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.msg { font-size: 13px; margin: 10px 0; }
.success { color: var(--brand); }
.error { color: var(--danger); }
.section-divider { height: 1px; background: var(--border-light); margin: 20px 0; }
.section-title-sm { font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }

/* Push settings */
.push-card { padding: 24px; }
.section-title { font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
.mt { margin-top: 20px; }

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}
.toggle-label { font-size: 13px; color: var(--text-primary); }
.toggle {
  position: relative;
  width: 40px;
  height: 22px;
  cursor: pointer;
}
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 11px;
  transition: var(--transition);
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: var(--transition);
}
.toggle input:checked + .toggle-slider { background: var(--brand); }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}
.strength-input { display: flex; align-items: center; gap: 10px; }
.strength-input input[type=range] { width: 120px; accent-color: var(--brand); }
.strength-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand);
  min-width: 28px;
  text-align: right;
}
.key-input-row { display: flex; gap: 8px; align-items: center; }
.key-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); font-size: 13px; }
.key-input:focus { outline: none; border-color: var(--brand); }
.btn-ghost { padding: 5px 10px; background: transparent; border: 1px solid var(--border); color: var(--text-secondary); border-radius: var(--radius); cursor: pointer; font-size: 12px; }
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }
.btn-sm { font-size: 11px; padding: 4px 8px; }
.hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; display: block; }
.hint.success { color: var(--brand); }

.plan-badge-field { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius); }
.plan-name-display { font-size: 13px; font-weight: 600; }
.upgrade-link { margin-left: auto; font-size: 12px; color: var(--brand); cursor: pointer; background: none; border: none; padding: 0; }
.upgrade-link:hover { text-decoration: underline; }
.usage-card { max-width: min(720px, calc(100% - 32px)); }
.usage-plan-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.plan-label { font-size: 16px; font-weight: 700; color: var(--brand); }
.upgrade-btn { padding: 6px 14px; background: var(--brand-gradient); color: #0b0d14; border: none; border-radius: var(--radius-sm); font-weight: 600; font-size: 12px; cursor: pointer; }
.upgrade-btn:hover { transform: translateY(-1px); }
.usage-grid { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
.usage-item { display: flex; flex-direction: column; gap: 4px; }
.usage-item-label { font-size: 12px; color: var(--text-tertiary); }
.usage-bar-wrap { display: flex; align-items: center; gap: 10px; }
.usage-bar { flex: 1; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.usage-bar-fill { height: 100%; background: var(--brand-gradient); border-radius: 3px; transition: width 0.3s; }
.usage-count { font-size: 12px; font-weight: 600; min-width: 60px; text-align: right; }
.features-list { background: var(--bg); border-radius: var(--radius-sm); padding: 12px; }
.features-title { font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px; }
.feature-item { font-size: 13px; color: var(--text-secondary); padding: 3px 0; }
.loading-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px; color: var(--text-tertiary); }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.apikeys-card { max-width: min(720px, calc(100% - 32px)); }
.apikeys-header { margin-bottom: 20px; }
.apikeys-header h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.apikeys-desc { font-size: 13px; color: var(--text-tertiary); }
.apikeys-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.apikey-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg); border-radius: var(--radius-sm); border: 1px solid var(--border-light); }
.apikey-info { display: flex; flex-direction: column; gap: 2px; }
.apikey-name { font-size: 14px; font-weight: 600; }
.apikey-meta { display: flex; gap: 6px; font-size: 12px; color: var(--text-tertiary); }

.empty-state { text-align: center; padding: 30px; color: var(--text-tertiary); font-size: 14px; }
.new-key-display { background: var(--bg); border: 1px solid var(--brand); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px; }
.new-key-label { font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px; }
.new-key-value { font-family: monospace; font-size: 13px; word-break: break-all; padding: 8px; background: var(--bg-secondary); border-radius: var(--radius-sm); margin-bottom: 10px; }
.create-key-form { display: flex; gap: 8px; align-items: center; }
.create-key-form input { flex: 1; padding: 7px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); font-size: 13px; }
.create-key-form input:focus { outline: none; border-color: var(--brand); }
.create-key-form select { padding: 7px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius); font-size: 13px; }
.btn-danger-sm { padding: 5px 12px; background: #dc2626; color: #fff; border: none; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.btn-danger-sm:hover { background: #b91c1c; }
.btn-secondary { padding: 7px 14px; background: transparent; border: 1px solid var(--border); color: var(--text-secondary); border-radius: var(--radius); font-size: 13px; cursor: pointer; }
.btn-secondary:hover { border-color: var(--brand); color: var(--brand); }
.referral-card { max-width: min(720px, calc(100% - 32px)); }
.referral-header { margin-bottom: 20px; }
.referral-header h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.referral-desc { font-size: 13px; color: var(--text-tertiary); }
.referral-code-section { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--bg); border-radius: var(--radius-sm); border: 1px solid var(--border-light); margin-bottom: 16px; }
.referral-code-label { font-size: 12px; color: var(--text-tertiary); }
.referral-code-value { font-family: monospace; font-size: 18px; font-weight: 700; letter-spacing: 2px; color: var(--brand); flex: 1; }
.referral-apply-section { margin-bottom: 20px; padding: 14px; background: var(--bg); border-radius: var(--radius-sm); border: 1px solid var(--border-light); }
.referral-apply-form { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.referral-input { flex: 1; padding: 8px 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text-primary); border-radius: var(--radius-sm); font-size: 13px; text-transform: uppercase; }
.referral-input:focus { outline: none; border-color: var(--brand); }
.apply-msg { margin-top: 8px; font-size: 13px; }
.apply-msg.success { color: var(--brand); }
.apply-msg.error { color: var(--danger); }
.referral-stats { display: flex; gap: 20px; margin-bottom: 20px; }
.stat-item { flex: 1; padding: 16px; background: var(--bg); border-radius: var(--radius-sm); border: 1px solid var(--border-light); text-align: center; }
.stat-value { font-size: 24px; font-weight: 700; color: var(--brand); }
.stat-label { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
.referral-list { display: flex; flex-direction: column; gap: 8px; }
.referral-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg); border-radius: var(--radius-sm); border: 1px solid var(--border-light); }
.referral-item-info { display: flex; flex-direction: column; gap: 2px; }
.referral-item-name { font-size: 14px; font-weight: 600; }
.referral-item-meta { font-size: 12px; color: var(--text-tertiary); }
.referral-item-amount { font-size: 16px; font-weight: 700; color: var(--brand); }

@media (min-width: 768px) {
  .profile-view { padding: 32px; }
  .profile-card, .referral-card { padding: 28px; }
  .section-card { padding: 24px; }
}
@media (max-width: 640px) {
  .profile-view { padding: 12px; }
  .profile-view .page-header { flex-direction: column; gap: 8px; }
  .profile-view .page-header h1 { font-size: 18px; }
  .profile-card, .referral-card { padding: 16px; }
  .profile-header { flex-direction: column; align-items: flex-start; gap: 8px; }
  .profile-info { width: 100%; }
  .profile-name { font-size: 18px; }
  .profile-email { font-size: 12px; }
  .pw-form { flex-direction: column; }
  .pw-form .field input { font-size: 16px; }
  .btn-primary { font-size: 15px; min-height: 44px; }
  .create-key-form { flex-direction: column; align-items: stretch; }
  .create-key-form input, .create-key-form select { width: 100%; box-sizing: border-box; }
  .referral-code-section { flex-direction: column; gap: 8px; align-items: flex-start; }
  .referral-code-value { font-size: 16px; }
  .referral-apply-form { flex-direction: column; align-items: stretch; }
  .referral-stats { flex-direction: column; gap: 8px; }
  .referral-item { flex-direction: column; gap: 4px; align-items: flex-start; }
  .section-card { padding: 14px; }
}
</style>
