/**
 * 给开发库灌一份样例数据。
 *
 * 之前只有测试库（quant_ceo_test）有完整的样例数据，开发库（quant_ceo_dev）几乎
 * 是空的，导致主力资金 / 涨停板 / 盘中异动 / 每日精选 / AI 预测 等页面在开发
 * 环境恒为空态，既没法调试也没法做视觉验收。
 *
 * 用法：npm run db:seed:dev
 */
import { createTestSeed } from './test-seed.js'

const target = process.env.PG_DB || 'quant_ceo_dev'
process.env.PG_DB = target

async function main() {
  console.log(`[seed-dev] seeding ${target} ...`)
  const seed = await createTestSeed()
  console.log('[seed-dev] done:')
  console.log(`  用户: ${seed.testUser.email} / ${seed.proUser.email} / ${seed.adminUser.email}`)
  console.log(`  股票: ${seed.stocks.length} 只`)
  console.log(`  策略: ${seed.userStrategies.length} 个`)
  console.log(`  日度指标: ${seed.dailyMetrics.length} 条`)
  console.log('  已灌: klines / daily_metrics / money_flow_daily / money_flow_realtime /')
  console.log('        limit_up_records / intraday_alerts / daily_picks / signals /')
  console.log('        ai_predictions / positions / strategies / backtests / watchlist')
  await seed.cleanup()
}

main().catch((e) => {
  console.error('[seed-dev] failed:', e)
  process.exit(1)
})
