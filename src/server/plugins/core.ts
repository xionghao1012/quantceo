import type { QuantPlugin } from '../plugin.js'
import authRoutes from '../routes/auth.js'
import stocksRoutes from '../routes/stocks.js'
import backtestRoutes from '../routes/backtest.js'
import screenerRoutes from '../routes/screener.js'
import scanRoutes from '../routes/scan.js'
import signalsRoutes from '../routes/signals.js'
import watchlistRoutes from '../routes/watchlist.js'
import marketStateRoutes from '../routes/marketState.js'
import rankingsRoutes from '../routes/rankings.js'
import internalRoutes from '../routes/internal.js'
import adminRoutes from '../routes/admin.js'
import subscriptionRoutes from '../routes/subscription.js'
import limitUpRoutes from '../routes/limitUp.js'
import moneyFlowRoutes from '../routes/moneyFlow.js'
import exportRoutes from '../routes/export.js'
import paperTradingRoutes from '../routes/paperTrading.js'

export const corePlugin: QuantPlugin = {
  name: 'core',
  routes: [
    { prefix: '/api/auth', router: authRoutes },
    { prefix: '/api/stocks', router: stocksRoutes },
    { prefix: '/api/backtest', router: backtestRoutes },
    { prefix: '/api/screener', router: screenerRoutes },
    { prefix: '/api/scan', router: scanRoutes },
    { prefix: '/api/signals', router: signalsRoutes },
    { prefix: '/api/watchlist', router: watchlistRoutes },
    { prefix: '/api/market', router: marketStateRoutes },
    { prefix: '/api/rankings', router: rankingsRoutes },
    { prefix: '/api/internal', router: internalRoutes },
    { prefix: '/api/admin', router: adminRoutes },
    { prefix: '/api/subscription', router: subscriptionRoutes },
    { prefix: '/api/limit-up', router: limitUpRoutes },
    { prefix: '/api/moneyflow', router: moneyFlowRoutes },
    { prefix: '/api/paper', router: paperTradingRoutes },
    { prefix: '/api/export', router: exportRoutes },
  ],
}
