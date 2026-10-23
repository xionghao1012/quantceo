/**
 * 一键建赛：1 场比赛 + 5 个策略账户（幂等，重复跑只补缺的）。
 *
 * 用法（dev）：
 *   npm run paper:start
 *
 * 生产不要跑这个脚本，直接调管理接口（同样幂等）：
 *   curl -X POST https://quant.rpaui.com/api/paper/admin/bootstrap \
 *        -H "x-admin-key: $ADMIN_UPGRADE_KEY"
 */
import { bootstrapCompetition } from '../src/server/services/paperTradingEngine.js'

const result = await bootstrapCompetition()
console.log(JSON.stringify(result, null, 2))
if (result.accountsAdded.length) {
  console.log(`已补齐策略账户：${result.accountsAdded.join(', ')}`)
} else {
  console.log('5 个策略账户都已就位')
}
process.exit(0)
