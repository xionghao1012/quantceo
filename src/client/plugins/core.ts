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
    { path: '/market-state', name: 'market-state', component: () => import('../views/MarketStateView.vue'), meta: { title: '市场状态' } },
    { path: '/rankings', name: 'rankings', component: () => import('../views/RankingsView.vue'), meta: { title: '指标排行' } },
    { path: '/profile', name: 'profile', component: () => import('../views/ProfileView.vue'), meta: { title: '个人中心' } },
    { path: '/backtest-strategies', name: 'backtest-strategies', component: () => import('../views/StrategyBacktestView.vue'), meta: { title: '策略回测分析' } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue'), meta: { public: true } },
  ],
  navGroups: [
    {
      title: '行情',
      items: [
        { label: '行情看板', icon: '◈', route: 'dashboard', check: () => true },
        { label: '选股筛选', icon: '⊙', route: 'screener', check: () => true },
        { label: '市场状态', icon: '◉', route: 'market-state', check: () => true },
        { label: '指标排行', icon: '⊕', route: 'rankings', check: () => true },
      ],
    },
    {
      title: '分析',
      items: [
        { label: '个股分析', icon: '◎', route: 'detail', check: () => !!useStockStore().selectedCode, disable: true },
        { label: '信号扫描', icon: '⊖', route: 'scan', check: () => true },
      ],
    },
    {
      title: '交易',
      items: [
        { label: '自选股', icon: '⊚', route: 'watchlist', check: () => true },
      ],
    },
    {
      title: '系统',
      items: [
        { label: '个人中心', icon: '◈', route: 'profile', check: () => useAuthStore().isLoggedIn },
      ],
    },
  ],
}
