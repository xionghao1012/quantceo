<template>
  <div class="pricing-view">
    <div class="pricing-hero">
      <h1>QuantCEO 定价</h1>
      <p class="hero-desc">选择适合你的套餐，让 AI 驱动的量化分析助你在 A 股市场脱颖而出</p>
      <div class="hero-notice">
        <strong>⚠️ 重要提示：</strong>QuantCEO 不构成投资建议。所有数据、指标、AI 预测、信号仅供研究参考。投资有风险，决策需谨慎。详见 <router-link to="/terms">服务条款</router-link>。
      </div>
    </div>

    <!-- Reason Banner -->
    <div v-if="reason || route.query.feature" class="reason-banner">
      <div class="reason-icon">⚡</div>
      <div class="reason-content">
        <div class="reason-title">{{ featureName }}需要 Pro 套餐</div>
        <div class="reason-text">
          {{ reason || `"${featureName}" 是 Pro 会员专属功能，升级即可解锁全部高级量化工具。` }}
        </div>
      </div>
    </div>

    <!-- Hero -->
    <div class="hero">
      <h1>解锁 QuantCEO 全部能力</h1>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <span>加载套餐信息...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-banner">
      {{ error }}
      <button @click="reloadPage" class="retry-link">重试</button>
    </div>
    <div v-if="msg" class="success-banner">{{ msg }}</div>

    <!-- Plans -->
    <template v-else>
      <!-- Plan Cards -->
      <div class="plans-grid">
        <div
          v-for="plan in enrichedPlans"
          :key="plan.id"
          class="plan-card"
          :class="{
            'plan-current': plan.id === currentPlan,
            'plan-pro': plan.id === 'pro',
            'plan-premium': plan.id === 'premium',
          }"
        >
          <div v-if="plan.bestValue" class="plan-badge">最受欢迎</div>
          <div v-else-if="plan.id === 'premium'" class="plan-badge premium-badge">企业版</div>

          <div class="plan-header">
            <div class="plan-name">{{ plan.name }}</div>
            <div class="plan-desc">{{ plan.desc }}</div>
          </div>

          <div class="plan-price-section">
            <div class="plan-price">
              <template v-if="plan.price === 0">
                <span class="price-free">免费</span>
              </template>
              <template v-else>
                <span class="price-currency">¥</span>
                <span class="price-number">{{ (plan.price / 100).toLocaleString() }}</span>
                <span class="price-unit">/年</span>
              </template>
            </div>
            <div v-if="plan.price > 0" class="plan-monthly">
              平均每月 ¥{{ plan.monthlyPrice.toLocaleString() }}，年付一次
            </div>
          </div>

          <div class="plan-features">
            <div v-for="f in plan.featureItems" :key="f.label" class="feature-row">
              <span class="feature-check" :class="{ included: f.included }">
                {{ f.included ? '✓' : '✕' }}
              </span>
              <span class="feature-label">{{ f.label }}</span>
              <TermTip v-if="f.tip" :term="f.tip" />
            </div>
          </div>

          <button
            class="plan-btn"
            :class="{
              'current': plan.id === currentPlan,
              'pro-btn': plan.id === 'pro',
              'premium-btn': plan.id === 'premium',
            }"
            :disabled="plan.id === currentPlan || upgrading !== null"
            @click="selectPlan(plan.id)"
          >
            <span v-if="upgrading === plan.id" class="btn-loading">
              <span class="spinner-sm"></span> 处理中
            </span>
            <span v-else-if="plan.id === currentPlan">当前套餐</span>
            <span v-else-if="plan.price === 0">开始使用</span>
            <span v-else>立即升级</span>
          </button>
        </div>
      </div>

      <!-- Feature Comparison Table -->
      <div class="comparison-section">
        <div class="section-header">
          <h2><span class="accent"></span>功能对比</h2>
        </div>
        <div class="compare-table-wrap">
          <table class="compare-table">
            <thead>
              <tr>
                <th class="feature-col">功能</th>
                <th class="plan-col free-col">Free</th>
                <th class="plan-col pro-col">Pro</th>
                <th class="plan-col premium-col">Premium</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in comparisonRows" :key="row.label">
                <td class="feature-col">
                  {{ row.label }}
                  <TermTip v-if="row.tip" :term="row.tip" />
                </td>
                <td class="plan-col free-col">
                  <span v-if="row.free === true" class="check-yes">✓</span>
                  <span v-else class="check-no">—</span>
                  <span v-if="typeof row.free === 'string'" class="value">{{ row.free }}</span>
                </td>
                <td class="plan-col pro-col">
                  <span v-if="row.pro === true" class="check-yes">✓</span>
                  <span v-else class="check-no">—</span>
                  <span v-if="typeof row.pro === 'string'" class="value">{{ row.pro }}</span>
                </td>
                <td class="plan-col premium-col">
                  <span v-if="row.premium === true" class="check-yes">✓</span>
                  <span v-else class="check-no">—</span>
                  <span v-if="typeof row.premium === 'string'" class="value">{{ row.premium }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Why Upgrade -->
      <div class="why-section">
        <div class="section-header">
          <h2><span class="accent"></span>为什么选择 Pro？</h2>
        </div>
        <div class="why-grid">
          <div class="why-card">
            <div class="why-icon">🎯</div>
            <div class="why-title">AI 策略发现</div>
            <div class="why-text">基于深度学习自动发现市场规律，提供高胜率交易信号，无需手动编写策略</div>
          </div>
          <div class="why-card">
            <div class="why-icon">🛡️</div>
            <div class="why-title">风险控制</div>
            <div class="why-text">组合 VaR 分析、止损优化、仓位计算器 — 专业风控工具确保资金安全</div>
          </div>
          <div class="why-card">
            <div class="why-icon">📊</div>
            <div class="why-title">高级选股</div>
            <div class="why-text">SQL 自定义公式、因子回测、行业对比、财务筛选 — 精准定位优质标的</div>
          </div>
          <div class="why-card">
            <div class="why-icon">⚡</div>
            <div class="why-title">实时监控</div>
            <div class="why-text">WebSocket 实时异动推送、盘中急涨急跌监控、放量突破预警 — 永不漏单</div>
          </div>
        </div>
      </div>

      <!-- QR 收款码弹窗 -->
      <div v-if="qrPlan" class="modal-overlay" @click.self="closeQrModal">
        <div class="qr-modal">
          <button class="qr-close" @click="closeQrModal">&times;</button>
          <h3>升级套餐 · {{ qrPlan === 'pro' ? 'Pro 年付' : 'Premium 年付' }}</h3>
          <p class="qr-hint">请联系邮箱发送付款截图和交易单号，我们验证后为您开通。</p>

          <div class="qr-contact-box">
            <p class="qr-contact-label">客服邮箱</p>
            <p class="qr-contact-value">{{ qrContactEmail }}</p>
          </div>

          <div class="qr-form">
            <label>套餐价格</label>
            <div class="qr-amount">{{ qrPlan === 'pro' ? '¥299' : '¥23,992' }}</div>
            <label for="qr-order-id">交易单号 <span class="qr-required">*</span></label>
            <input
              id="qr-order-id"
              v-model="qrOrderId"
              type="text"
              placeholder="付款后的交易单号"
              class="qr-input"
            />
            <label for="qr-note">备注（可选）</label>
            <input
              id="qr-note"
              v-model="qrNote"
              type="text"
              placeholder="如有需要，可备注 QQ 号或邮箱"
              class="qr-input"
            />
          </div>

          <button
            class="qr-submit-btn"
            :disabled="submitting || !qrOrderId.trim()"
            @click="submitQrOrder"
          >
            {{ submitting ? '提交中…' : '提交订单号，等待验证' }}
          </button>

          <p v-if="error" class="qr-error">{{ error }}</p>
          <p v-if="submitting" class="qr-submitting">已提交，管理员验证后自动激活套餐</p>

          <div class="qr-footer">
            <p>转账后请将交易单号提交至上方表单，或直接发送邮件至
              <a :href="'mailto:' + qrContactEmail">{{ qrContactEmail }}</a>
            </p>
          </div>
        </div>
      </div>

      <!-- FAQ -->
      <div class="faq-section">
        <div class="section-header">
          <h2><span class="accent"></span>常见问题</h2>
        </div>
        <div class="faq-grid">
          <div class="faq-item">
            <div class="faq-q">如何升级套餐？</div>
            <div class="faq-a">点击"立即升级"按钮 → 查看价格和客服邮箱 → 转账后提交交易单号 → 管理员验证后自动激活。</div>
          </div>
          <div class="faq-item">
            <div class="faq-q">可以按月付费吗？</div>
            <div class="faq-a">目前仅支持年付套餐，年付可享受更优惠的价格。我们正在规划月付选项。</div>
          </div>
          <div class="faq-item">
            <div class="faq-q">升级后功能多久生效？</div>
            <div class="faq-a">提交交易单号后，管理员会在 24 小时内验证并激活。激活后 Pro 功能立即解锁，无需刷新页面。</div>
          </div>
          <div class="faq-item">
            <div class="faq-q">支持退款吗？</div>
            <div class="faq-a">首次购买 Pro 后 7 天内可全额退款。联系客服并出示支付凭证即可处理。</div>
          </div>
          <div class="faq-item">
            <div class="faq-q">Pro 价格会变吗？</div>
            <div class="faq-a">我们保留调整价格的权利。价格变更将在新订阅周期生效，<strong>不追溯已订阅用户</strong>。</div>
          </div>
          <div class="faq-item">
            <div class="faq-q">Premium 版和 Pro 版有什么区别？</div>
            <div class="faq-a">Premium 版（CN¥23,992/年）在 Pro 版基础上额外提供：<strong>API 接入（程序化交易）、500 只自选股、无限回测、优先新功能、定制数据接入</strong>。</div>
          </div>
        </div>
      </div>

      <!-- Pricing transparency -->
      <div class="pricing-notes">
        <div class="price-note">
          <h3>价格与税费</h3>
          <p>Pro 版价格为 <strong>CN¥299 / 年</strong>，Premium 版价格为 <strong>CN¥23,992 / 年</strong>（人民币，含税）。可能需要缴纳税费，税费将在结账时计算。</p>
        </div>
        <div class="price-note">
          <h3>续费说明</h3>
          <p>订阅为年付订阅，<strong>不开启自动续费</strong>。到期后自动降级为 Free 版，需手动续订。</p>
        </div>
        <div class="price-note">
          <h3>试用与折扣</h3>
          <p>当前不提供免费试用。如有折扣活动会在首页公告，折扣结束后按原价续订。</p>
        </div>
        <div class="price-note">
          <h3>运营方信息</h3>
          <p>QuantCEO 由 <strong>XIONG HAO</strong> 运营 · 支付由 <strong>Paddle</strong> (paddle.com) 处理 · 联系 <a href="mailto:435541900@qq.com">435541900@qq.com</a></p>
        </div>
      </div>

      <!-- Cancel -->
      <div v-if="currentPlan !== 'free'" class="cancel-section">
        <button class="cancel-btn" @click="cancelSubscription" :disabled="loading">
          {{ loading ? '处理中...' : '取消订阅' }}
        </button>
        <p class="cancel-hint">取消后当前计费周期结束前仍可使用 Pro 功能</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import TermTip from '../components/TermTip.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const loading = ref(true)
const upgrading = ref<string | null>(null)
const qrPlan = ref<string | null>(null)  // 'pro' | 'premium' | null
const qrContactEmail = ref<string>('')
const qrOrderId = ref<string>('')  // 用户填写订单号
const qrNote = ref<string>('')
const error = ref('')
const msg = ref('')

const plans = ref<any[]>([])
const currentPlan = ref('free')

const FEATURE_NAME_MAP: Record<string, string> = {
  'ai-discover': 'AI 策略发现',
  'ai-predict': 'AI 预测',
  'strategy-optimize': '策略优化',
  'risk-management': '风险管理',
  'trade-journal': '交易日志',
  'screener-pro': '高级选股',
  'market-alerts': '实时异动监控',
  'positions': '持仓管理',
  'rebalance': '智能调仓',
  'picks-history': '每日精选历史',
  'intraday-alerts': '盘中异动',
  'notifications': '通知中心',
  'sentiment': '情绪指标',
  'push-settings': '推送设置',
  'position-analysis': '持仓分析',
  'my-strategies': '我的策略',
}

const featureName = computed(() => {
  const f = route.query.feature as string
  return FEATURE_NAME_MAP[f] || f || ''
})

const reason = ref('')
const REASON_MAP: Record<string, string> = {
  plan_required: '当前为免费套餐，以下功能需要升级到 Pro 套餐后才能使用。',
}

const enrichedPlans = computed(() => {
  const defaultPlans = [
    {
      id: 'free',
      name: 'Free',
      desc: '入门量化，体验核心功能',
      price: 0,
      monthlyPrice: 0,
      savingsPercent: 0,
      bestValue: false,
      featureItems: [
        { label: '行情看板', included: true },
        { label: '基础选股筛选', included: true },
        { label: '自选股 20 只', included: true },
        { label: '信号扫描（日 3 次）', included: true },
        { label: '策略回测（日 3 次）', included: true },
        { label: '指标排行', included: true },
        { label: '社区支持', included: true },
        { label: 'AI 策略发现', included: false },
        { label: '风险控制工具', included: false },
        { label: '高级选股 Pro', included: false },
        { label: '实时异动监控', included: false },
        { label: '盘中异动', included: false },
      ],
    },
    {
      id: 'pro',
      name: 'Pro',
      desc: '专业量化，解锁全部功能',
      price: 29900,
      monthlyPrice: 24.9,
      savingsPercent: 17,
      bestValue: true,
      featureItems: [
        { label: '自定义公式选股（1618 万行真实 K 线）', included: true },
        { label: '全部选股功能', included: true },
        { label: '自选股 100 只', included: true },
        { label: '信号扫描（无限）', included: true },
        { label: '策略回测（日 50 次）', included: true },
        { label: '指标排行', included: true },
        { label: '主力资金异动监控', included: true },
        { label: 'AI 策略发现', included: true, tip: 'ai-discover' },
        { label: '风险控制工具', included: true, tip: 'var' },
        { label: '高级选股 Pro', included: true },
        { label: '实时异动监控', included: true },
        { label: '盘中异动 + 推送', included: true },
      ],
    },
    {
      id: 'premium',
      name: 'Premium',
      desc: '企业级旗舰，含 API 接入',
      price: 2399200,
      monthlyPrice: 1999,
      savingsPercent: 0,
      bestValue: false,
      featureItems: [
        { label: '包含 Pro 版全部功能', included: true },
        { label: '无限回测 & 扫描', included: true },
        { label: '自选股 500 只', included: true },
        { label: 'API 接入', included: true, tip: 'api' },
        { label: '实时推送（微信）', included: true },
        { label: 'AI 策略发现', included: true },
        { label: '因子回测与行业对比', included: true },
        { label: '优先体验新功能', included: true },
      ],
    },
  ]

  if (plans.value.length) {
    return plans.value
      .filter((p: any) => p.id === 'free' || p.id === 'pro' || p.id === 'premium')
      .map((p: any) => {
        const def = defaultPlans.find((d) => d.id === p.id)
        // 服务端下发了 features 就用它，避免页面上的卖点和真实套餐对不上
        const featureItems = Array.isArray(p.features) && p.features.length
          ? p.features.map((label: string) => ({ label, included: true }))
          : def?.featureItems || []
        return { ...def, ...p, featureItems }
      })
  }
  return defaultPlans
})

const comparisonRows = [
  { label: '行情看板', free: true, pro: true, premium: true },
  { label: '选股筛选', free: true, pro: true, premium: true },
  { label: '指标排行', free: true, pro: true, premium: true },
  { label: '策略回测', free: '3次/日', pro: '50次/日', premium: '无限', tip: 'backtest' },
  { label: '信号扫描', free: '3次/日', pro: '无限', premium: '无限' },
  { label: '自选股上限', free: '20只', pro: '100只', premium: '500只' },
  { label: '高级选股 Pro', free: false, pro: true, premium: true },
  { label: '因子回测', free: false, pro: true, premium: true, tip: 'factor' },
  { label: 'AI 策略发现', free: false, pro: true, premium: true, tip: 'ai-discover' },
  { label: 'AI 预测', free: false, pro: true, premium: true, tip: 'ai-predict' },
  { label: '策略优化', free: false, pro: true, premium: true },
  { label: '风险管理', free: false, pro: true, premium: true, tip: 'var' },
  { label: '仓位计算', free: false, pro: true, premium: true },
  { label: '止损优化', free: false, pro: true, premium: true },
  { label: '交易日志', free: false, pro: true, premium: true },
  { label: '持仓管理', free: false, pro: true, premium: true },
  { label: '智能调仓', free: false, pro: true, premium: true },
  { label: '每日精选', free: false, pro: true, premium: true },
  { label: '情绪指标', free: false, pro: true, premium: true },
  { label: '盘中异动', free: false, pro: true, premium: true },
  { label: '实时异动监控', free: false, pro: true, premium: true },
  { label: '推送通知', free: false, pro: true, premium: true },
  { label: 'API 接入', free: false, pro: false, premium: true },
  { label: '优先新功能', free: false, pro: false, premium: true },
  { label: '因子回测与行业对比', free: false, pro: true, premium: true },
  { label: '客服支持', free: '社区', pro: '优先', premium: '优先' },
]

onMounted(async () => {
  reason.value = REASON_MAP[route.query.reason as string] || ''
  try {
    const res = await fetch('/api/subscription/me', { headers: auth.authHeaders() })
    if (res.ok) {
      const data = await res.json()
      currentPlan.value = data.plan
      plans.value = data.plans
    }
  } catch {
    error.value = '无法获取套餐信息，已显示默认方案'
  } finally {
    loading.value = false
  }
})

async function selectPlan(planId: string) {
  if (planId === currentPlan.value) return
  if (planId === 'free') return
  upgrading.value = planId
  error.value = ''

  if (!auth.isLoggedIn) {
    auth.fetchUser().catch(() => {})
    await new Promise(r => setTimeout(r, 300))
    if (!auth.isLoggedIn) {
      router.push({ name: 'login', query: { redirect: '/pricing' } })
      upgrading.value = null
      return
    }
  }

  await openQrModal(planId)
}

function reloadPage() {
  window.location.reload()
}

function closeQrModal() {
  qrPlan.value = null
  qrOrderId.value = ''
  qrNote.value = ''
  error.value = ''
}

async function openQrModal(planId: string) {
  try {
    const res = await fetch('/api/subscription/payment-methods')
    const methods = await res.json()
    qrContactEmail.value = methods.contactEmail || '435541900@qq.com'
    qrPlan.value = planId
    qrOrderId.value = ''
    qrNote.value = ''
    error.value = ''
  } catch (e: any) {
    error.value = '加载支付方式失败：' + e.message
    upgrading.value = null
  }
}

async function submitQrOrder() {
  if (!qrPlan.value) return
  if (!qrOrderId.value.trim()) {
    error.value = '请填写订单号（微信/支付宝交易单号）'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const res = await fetch('/api/subscription/submit-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({
        plan: qrPlan.value,
        platform: 'wechat',
        orderId: qrOrderId.value.trim(),
        note: qrNote.value.trim() || undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      error.value = data.error || '提交失败'
      return
    }
    msg.value = data.message || '订单已提交，管理员验证后将自动激活'
    qrPlan.value = null
  } catch (e: any) {
    error.value = e.message || '提交失败'
  } finally {
    submitting.value = false
    upgrading.value = null
  }
}

const submitting = ref(false)

async function cancelSubscription() {
  if (!confirm('确定取消订阅？取消后将降级为免费版')) return
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/subscription/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
    })
    if (res.ok) {
      currentPlan.value = 'free'
      window.location.reload()
    } else {
      const data = await res.json()
      error.value = data.error || '取消失败'
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.pricing-view { padding: 24px 32px; max-width: 1100px; margin: 0 auto; }

/* Hero */
.pricing-hero { text-align: center; margin-bottom: 28px; }
.pricing-hero h1 { font-size: 28px; font-weight: 800; color: var(--text-primary); margin: 0 0 8px; }
.hero-desc { font-size: 14px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
.hero-notice {
  margin-top: 14px; padding: 10px 16px;
  background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2);
  border-radius: var(--radius); font-size: 12px; color: var(--text-secondary);
  text-align: left; max-width: 650px; margin-left: auto; margin-right: auto;
}
.hero-notice a { color: var(--brand); }

/* Reason banner */
.reason-banner {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 16px 20px; margin-bottom: 28px;
  background: var(--brand-glow); border: 1px solid var(--brand);
  border-radius: var(--radius-lg);
}
.reason-icon { font-size: 24px; flex-shrink: 0; }
.reason-content { flex: 1; }
.reason-title { font-size: 14px; font-weight: 700; color: var(--brand); margin-bottom: 4px; }
.reason-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

/* Hero */
.hero { text-align: center; margin-bottom: 36px; }
.hero h1 { font-size: 28px; font-weight: 800; color: var(--text-primary); margin: 0 0 10px; background: var(--brand-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.hero-sub { font-size: 14px; color: var(--text-tertiary); margin: 0; max-width: 480px; margin: 0 auto; line-height: 1.5; }

/* Plans grid */
.plans-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 1100px; margin: 0 auto 48px; }

.plan-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 28px 24px;
  position: relative; transition: var(--transition);
  display: flex; flex-direction: column;
}
.plan-card:hover { border-color: var(--brand); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.plan-current { border-color: var(--brand); }
.plan-pro { border-color: rgba(245,158,11,0.3); }
.plan-premium { border-color: rgba(139,92,246,0.3); }
.plan-premium:hover { border-color: #8b5cf6; transform: translateY(-2px); box-shadow: 0 4px 20px rgba(139,92,246,0.15); }
.plan-premium .plan-name { color: #a78bfa; }

.plan-badge {
  position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
  background: var(--brand-gradient); color: #0b0d14;
  font-size: 11px; font-weight: 700; padding: 4px 16px; border-radius: var(--radius-lg);
  white-space: nowrap; box-shadow: 0 2px 12px var(--brand-glow);
}
.premium-badge { background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff; }

.plan-header { margin-bottom: 16px; }
.plan-name { font-size: 20px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
.plan-desc { font-size: 12px; color: var(--text-tertiary); }

.plan-price-section { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.plan-price { display: flex; align-items: baseline; gap: 2px; }
.price-free { font-size: 36px; font-weight: 800; color: var(--text-primary); }
.price-currency { font-size: 18px; font-weight: 600; color: var(--text-secondary); }
.price-number { font-size: 40px; font-weight: 800; color: var(--text-primary); line-height: 1; }
.price-unit { font-size: 14px; color: var(--text-tertiary); }
.plan-monthly { font-size: 12px; color: var(--down); margin-top: 6px; font-weight: 500; }

/* Features */
.plan-features { flex: 1; }
.feature-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
.feature-check { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-full); font-size: 10px; font-weight: 700; flex-shrink: 0; }
.feature-check.included { background: var(--down-bg); color: var(--down); }
.feature-check:not(.included) { background: rgba(107,114,128,0.12); color: var(--text-tertiary); }
.feature-label { color: var(--text-secondary); }

/* Buttons */
.plan-btn {
  width: 100%; padding: 11px; margin-top: 20px;
  border-radius: var(--radius); font-weight: 700; font-size: 14px;
  cursor: pointer; border: none; transition: var(--transition);
  font-family: var(--font);
}
.plan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.plan-btn.current { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-tertiary); }
.plan-btn.pro-btn { background: var(--brand-gradient); color: #0b0d14; }
.plan-btn.pro-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 20px var(--brand-glow); }
.plan-btn.premium-btn { background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff; }
.plan-btn.premium-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(139,92,246,0.35); }

/* Comparison table */
.comparison-section { margin-bottom: 48px; }
.compare-table-wrap { overflow-x: auto; border-radius: var(--radius); border: 1px solid var(--border); }
.compare-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.compare-table th, .compare-table td { padding: 10px 16px; text-align: center; border-bottom: 1px solid var(--border); }
.compare-table th { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.compare-table thead th { background: var(--bg-deep); padding: 12px 16px; }
.compare-table tbody tr:last-child td { border-bottom: none; }
.compare-table tbody tr:hover { background: var(--bg-card-hover); }
.feature-col { text-align: left !important; color: var(--text-secondary); font-weight: 500; min-width: 140px; }
.plan-col { min-width: 100px; }
.free-col { color: var(--text-secondary); }
.pro-col { background: rgba(245,158,11,0.03); }
.premium-col { background: rgba(139,92,246,0.03); }
.free-col .value, .pro-col .value, .premium-col .value { font-size: 12px; }
.check-yes { color: var(--down); font-weight: 700; }
.check-no { color: var(--text-tertiary); }

.compare-table thead .pro-col { color: var(--brand); }
.compare-table thead .premium-col { color: #8b5cf6; }

/* Why section */
.why-section { margin-bottom: 48px; }
.why-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.why-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; text-align: center;
  transition: var(--transition);
}
.why-card:hover { border-color: var(--brand); transform: translateY(-1px); box-shadow: var(--shadow); }
.why-icon { font-size: 28px; margin-bottom: 10px; }
.why-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }
.why-text { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }

/* FAQ */
.faq-section { margin-bottom: 40px; }
.faq-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.faq-item {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 18px;
  transition: var(--transition);
}
.faq-item:hover { border-color: var(--brand); }
.faq-q { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.faq-a { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }

/* Pricing notes */
.pricing-notes { max-width: 750px; margin: 0 auto 32px; }
.price-note {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 20px; margin-bottom: 10px;
}
.price-note h3 { font-size: 13px; font-weight: 600; color: var(--brand); margin: 0 0 6px; }
.price-note p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
.price-note a { color: var(--accent); }


/* Cancel */
.cancel-section { text-align: center; padding: 20px 0; }
.cancel-btn { background: transparent; border: 1px solid var(--border); color: var(--text-tertiary); padding: 8px 24px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-family: var(--font); transition: var(--transition); }
.cancel-btn:hover { border-color: var(--up); color: var(--up); }
.cancel-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 8px; }

/* States */
.loading-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px 20px; color: var(--text-tertiary); }
.spinner { width: 28px; height: 28px; border: 2.5px solid var(--border); border-top-color: var(--brand); border-radius: var(--radius-full); animation: spin 0.8s linear infinite; }
.spinner-sm { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(11,13,20,0.2); border-top-color: #0b0d14; border-radius: var(--radius-full); animation: spin 0.6s linear infinite; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
.btn-loading { display: inline-flex; align-items: center; gap: 6px; }

.error-banner {
  padding: 14px 20px; background: var(--up-bg); border: 1px solid var(--up);
  border-radius: var(--radius); color: var(--up); font-size: 13px; margin-bottom: 24px;
}
.success-banner {
  padding: 14px 20px; background: var(--down-bg); border: 1px solid var(--down);
  border-radius: var(--radius); color: var(--down); font-size: 13px; margin-bottom: 24px;
}
.retry-link { background: none; border: none; color: var(--up); cursor: pointer; text-decoration: underline; font-size: 13px; margin-left: 8px; font-family: var(--font); }

/* Responsive */
@media (max-width: 900px) {
  .plans-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .pricing-view { padding: 16px; }
  .hero h1 { font-size: 22px; }
  .plans-grid { grid-template-columns: 1fr; max-width: 400px; }
  .why-grid { grid-template-columns: 1fr; }
  .faq-grid { grid-template-columns: 1fr; }
  .compare-table-wrap { margin: 0 -12px; }
}
@media (max-width: 640px) {
  .pricing-view { padding: 12px; }
  .plan-card { padding: 20px 16px; }
  .price-number { font-size: 32px; }
}

/* QR 支付弹窗 */
.modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.5); display: flex;
  align-items: center; justify-content: center;
  padding: 16px;
}
.qr-modal {
  background: var(--bg-card); border-radius: var(--radius);
  max-width: 420px; width: 100%; padding: 28px 24px 20px;
  position: relative; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  text-align: center;
}
.qr-close {
  position: absolute; top: 8px; right: 12px;
  background: none; border: none; font-size: 24px;
  color: var(--text-secondary); cursor: pointer;
}
.qr-modal h3 { margin: 0 0 4px; font-size: 18px; color: var(--text-primary); }
.qr-hint { font-size: 13px; color: var(--text-secondary); margin: 0 0 16px; }
.qr-contact-box { text-align: center; margin-bottom: 20px; padding: 16px; background: var(--bg-muted); border-radius: var(--radius-md); }
.qr-contact-label { font-size: 13px; color: var(--text-muted); margin-bottom: 4px; }
.qr-contact-value { font-size: 18px; font-weight: 600; color: var(--accent); }
.qr-tabs { display: flex; gap: 0; margin-bottom: 16px; justify-content: center; }
.qr-tabs button {
  padding: 6px 20px; border: 1px solid var(--border);
  background: var(--bg-secondary); color: var(--text-secondary);
  cursor: pointer; font-size: 14px;
}
.qr-tabs button:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.qr-tabs button:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.qr-tabs button.active {
  background: var(--brand); color: #fff; border-color: var(--brand);
}
.qr-image-wrapper {
  margin: 0 auto 16px; width: 220px; height: 220px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: #fff;
}
.qr-image { max-width: 100%; max-height: 100%; }
.qr-image-placeholder {
  margin: 0 auto 16px; width: 220px; height: 220px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border: 2px dashed var(--border); border-radius: var(--radius-md); color: var(--text-secondary);
  font-size: 13px;
}
.qr-contact-text { margin-top: 4px; font-size: 12px; color: var(--text-muted); }
.qr-form { text-align: left; margin-bottom: 16px; }
.qr-form label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; margin-top: 10px; }
.qr-form label:first-child { margin-top: 0; }
.qr-required { color: var(--danger); }
.qr-amount { font-size: 24px; font-weight: 700; color: var(--brand); margin-bottom: 8px; }
.qr-input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary);
  font-size: 14px; box-sizing: border-box;
}
.qr-input:focus { outline: none; border-color: var(--brand); }
.qr-submit-btn {
  width: 100%; padding: 10px; border: none; border-radius: var(--radius-sm);
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600;
  cursor: pointer;
}
.qr-submit-btn:disabled { opacity: 0.5; cursor: default; }
.qr-error { color: var(--danger); font-size: 13px; margin-top: 8px; }
.qr-submitting { color: var(--brand); font-size: 13px; margin-top: 8px; }
.qr-footer { margin-top: 12px; font-size: 12px; color: var(--text-muted); }
.qr-footer a { color: var(--brand); text-decoration: underline; }
</style>
