import type { FrontendPlugin } from '../plugin'
import { useAuthStore } from '../stores/auth'
import { useStockStore } from '../stores/stock'

export const corePlugin: FrontendPlugin = {
  name: 'core',
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: () => import('../views/StockList.vue'), meta: { public: true } },
    { path: '/stock/:code', name: 'stock-detail', component: () => import('../views/StockDetail.vue'), props: true },
    { path: '/backtest', name: 'backtest', component: () => import('../views/BacktestView.vue'), meta: { public: true } },
    { path: '/scan', name: 'scan', component: () => import('../views/SignalScan.vue'), meta: { public: true } },
    { path: '/screener', name: 'screener', component: () => import('../views/ScreenerView.vue'), meta: { public: true } },
    { path: '/leaderboard', name: 'leaderboard', component: () => import('../views/LeaderboardView.vue'), meta: { public: true } },
    { path: '/watchlist', name: 'watchlist', component: () => import('../views/WatchlistView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true, layout: 'blank' } },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { public: true, layout: 'blank' } },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('../views/ForgotPasswordView.vue'), meta: { public: true, layout: 'blank' } },
    { path: '/reset-password', name: 'reset-password', component: () => import('../views/ResetPasswordView.vue'), meta: { public: true, layout: 'blank' } },
    { path: '/terms', name: 'terms', component: () => import('../views/TermsView.vue'), meta: { public: true, title: '服务条款' } },
    { path: '/privacy', name: 'privacy', component: () => import('../views/PrivacyView.vue'), meta: { public: true, title: '隐私政策' } },
    { path: '/refund-policy', name: 'refund', component: () => import('../views/RefundView.vue'), meta: { public: true, title: '退款政策' } },
    { path: '/admin', name: 'admin', component: () => import('../views/AdminView.vue'), meta: { title: '管理', public: true } },
    { path: '/market-state', name: 'market-state', component: () => import('../views/MarketStateView.vue'), meta: { title: '市场状态' } },
    { path: '/rankings', name: 'rankings', component: () => import('../views/RankingsView.vue'), meta: { title: '指标排行' } },
    { path: '/profile', name: 'profile', component: () => import('../views/ProfileView.vue'), meta: { title: '个人中心' } },
    { path: '/backtest-strategies', name: 'backtest-strategies', component: () => import('../views/StrategyBacktestView.vue'), meta: { title: '策略回测分析' } },
    { path: '/limit-up', name: 'limit-up', component: () => import('../views/LimitUpView.vue'), meta: { title: '涨停板汇总' } },
    { path: '/fund-flow', name: 'fund-flow', component: () => import('../views/FundFlowDashboard.vue'), meta: { title: '主力资金', public: true } },
    { path: '/fund-flow/alerts', name: 'fund-flow-alerts', component: () => import('../views/FundFlowAlertsView.vue'), meta: { title: '告警配置' } },
    { path: '/fund-flow/alerts/create', name: 'fund-flow-alerts-create', component: () => import('../views/FundFlowAlertForm.vue'), meta: { title: '新建告警' } },
    { path: '/fund-flow/alerts/edit/:id', name: 'fund-flow-alerts-edit', component: () => import('../views/FundFlowAlertForm.vue'), meta: { title: '编辑告警' } },
    { path: '/fund-flow/alerts/history', name: 'fund-flow-alerts-history', component: () => import('../views/FundFlowAlertHistory.vue'), meta: { title: '告警历史' } },
    { path: '/paper-trading', name: 'paper-trading', component: () => import('../views/PaperTradingDashboard.vue'), meta: { title: 'AI炒股大赛', public: true } },
    { path: '/paper-trading/history', name: 'paper-trading-history', component: () => import('../views/PaperTradingHistory.vue'), meta: { title: '历史比赛', public: true } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue'), meta: { public: true } },
  ],
  navGroups: [
    // 按「我要做的事」分组，不按数据库/功能分组：
    // 散户一进来要回答的是「今天看什么 → 怎么挑 → 我的钱怎么样」，
    // 不是「情绪指标 / 策略优化 / 选股筛选 Pro 我该点哪个」。
    // Pro 能力由 App.vue 折叠到每个分组的二级（有 Pro 的人自动展开成平铺）。
    {
      title: '今天看什么',
      items: [
        { label: '今日决策台', icon: '◈', route: 'dashboard', check: () => true },
        { label: '信号扫描', icon: '⊖', route: 'scan', check: () => true },
        { label: '涨停板汇总', icon: '▲', route: 'limit-up', check: () => true },
        { label: '主力资金', icon: '◍', route: 'fund-flow', check: () => true },
        { label: '市场状态', icon: '◉', route: 'market-state', check: () => true },
        { label: '个股分析', icon: '◎', route: 'detail', check: () => !!useStockStore().selectedCode, disable: true },
      ],
    },
    {
      title: '我要筛',
      items: [
        { label: '选股筛选', icon: '⊙', route: 'screener', check: () => true },
        { label: '指标排行', icon: '⊕', route: 'rankings', check: () => true },
        // 回测是全站第二大真实用量（463 次），之前根本不在侧栏里
        { label: '回测', icon: '⊞', route: 'backtest', check: () => true },
        { label: '策略回测分析', icon: '⊟', route: 'backtest-strategies', check: () => true },
        { label: '推荐跟踪', icon: '⊘', route: 'rec-tracking', check: () => useAuthStore().isLoggedIn },
      ],
    },
    {
      title: '我的持仓与钱',
      items: [
        { label: '我的持仓', icon: '⊛', route: 'positions', check: () => useAuthStore().isLoggedIn },
        { label: '自选股', icon: '⊚', route: 'watchlist', check: () => true },
        { label: '持仓分析', icon: '◫', route: 'position-analysis', check: () => useAuthStore().isLoggedIn },
        { label: '智能调仓', icon: '⊜', route: 'rebalance', check: () => useAuthStore().isLoggedIn },
        { label: '告警配置', icon: '🔔', route: 'fund-flow-alerts', check: () => useAuthStore().isLoggedIn },
        { label: '告警历史', icon: '📋', route: 'fund-flow-alerts-history', check: () => useAuthStore().isLoggedIn },
        { label: '盘中异动', icon: '△', route: 'intraday-alerts', check: () => useAuthStore().isLoggedIn },
        { label: '推送设置', icon: '☰', route: 'push-settings', check: () => useAuthStore().isLoggedIn },
      ],
    },
    {
      title: 'AI 与设置',
      items: [
        { label: 'AI炒股大赛', icon: '🏆', route: 'paper-trading', check: () => true },
        { label: '历史比赛', icon: '📊', route: 'paper-trading-history', check: () => true },
        { label: '个人中心', icon: '◈', route: 'profile', check: () => useAuthStore().isLoggedIn },
      ],
    },
  ],
}
