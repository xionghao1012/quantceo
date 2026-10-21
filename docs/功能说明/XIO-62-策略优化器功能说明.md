# 策略优化器功能说明

## 一、功能概述

策略优化器使用遗传算法（GA）自动寻找最优策略参数组合，帮助用户在不同时段、不同股票上找到最佳参数配置。

**页面路径**: `/optimizer`
**访问权限**: Pro 用户专用

---

## 二、支持策略类型

| 策略类型 | 标识 | 可优化参数 |
|---------|------|---------|
| RSI 区间策略 | `rsi` | rsiPeriod, oversold, overbought |
| MACD 策略 | `macd` | fastPeriod, slowPeriod, signalPeriod |
| 均线交叉策略 | `ma_cross` | maFast, maSlow |
| 布林带策略 | `bollinger` | bbPeriod, bbStdDev |
| 自定义策略 | `custom` | 用户自定义参数范围 |

---

## 三、遗传算法参数说明

### 3.1 GA 超参数

| 参数 | 默认值 | 取值范围 | 说明 |
|------|-------|---------|------|
| populationSize | 50 | 10~200 | 种群规模 |
| generations | 30 | 5~100 | 迭代次数 |
| eliteSize | 5 | 1~20 | 精英保留数量 |
| mutationRate | 0.15 | 0.05~0.5 | 变异概率 |
| crossoverRate | 0.7 | 0.5~1.0 | 交叉概率 |

### 3.2 参数空间搜索范围（内置策略默认值）

**RSI 策略**:
```
rsiPeriod:  min=5,   max=30,  step=1,  default=14
oversold:   min=10,  max=40,  step=1,  default=30
overbought: min=60,  max=90,  step=1,  default=70
```

**MACD 策略**:
```
fastPeriod:   min=5,  max=20,  step=1,  default=12
slowPeriod:   min=15, max=40,  step=1,  default=26
signalPeriod: min=5,  max=15,  step=1,  default=9
```

**均线交叉策略**:
```
maFast: min=3,  max=20,  step=1, default=5
maSlow: min=10, max=60,  step=1, default=20
```

**布林带策略**:
```
bbPeriod: min=10, max=30,  step=1,   default=20
bbStdDev: min=1.5, max=3.0, step=0.1, default=2.0
```

---

## 四、适应度函数（Fitness Function）

适应度函数综合多个回测指标计算个体得分：

```
fitness = sharpeRatio × 2.0
        + totalReturn × 1.5
        - maxDrawdown × 3.0
        + winRate × 0.5
```

**权重说明**:
- 夏普比权重最高（2.0），反映风险调整后收益
- 最大回撤惩罚系数最大（3.0），控制下行风险
- 总收益权重适中（1.5）
- 胜率权重最低（0.5），辅助参考

**无效回测处理**: 当 sharpe = -999（数据不足或计算异常）时，适应度直接返回 -999。

---

## 五、遗传操作详解

### 5.1 选择（Selection）— 锦标赛选择法

```typescript
function tournamentSelection(population, tournamentSize = 3) {
  let best = null
  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * population.length)
    const individual = population[idx]
    if (!best || individual.fitness > best.fitness) {
      best = individual
    }
  }
  return best.genes
}
```

每次从种群中随机抽取 3 个个体，选取适应度最高者作为父本。

### 5.2 交叉（Crossover）— 均匀交叉

```typescript
function crossover(parent1, parent2) {
  const child = {}
  for (const key of Object.keys(parent1)) {
    child[key] = Math.random() < 0.5 ? parent1[key] : parent2[key]
  }
  return child
}
```

每个基因位有 50% 概率继承自父1，50% 概率继承自父2。

### 5.3 变异（Mutation）

```typescript
function mutate(genes, ranges) {
  const mutated = { ...genes }
  for (const range of ranges) {
    if (Math.random() < MUTATION_RATE) {  // 0.15
      const delta = (range.max - range.min) * 0.2
      const change = randomInRange(-delta, delta)
      const newValue = roundToStep(mutated[range.name] + change, range.step)
      mutated[range.name] = clamp(newValue, range.min, range.max)
    }
  }
  return mutated
}
```

变异幅度为参数范围的 ±20%，并对 step 取整。

### 5.4 精英保留（Elitism）

每代保留适应度最高的 5 个个体直接进入下一代，不经过选择/交叉/变异。

---

## 六、收敛条件

### 6.1 默认收敛条件

- 达到指定代数（`generations`，默认 30 代）后停止
- 无早停机制，每代完整运行

### 6.2 迭代进度追踪

`optimizerPool.ts` 实时更新数据库进度：

```typescript
// 每代完成后发送进度消息
parentPort.postMessage({
  type: 'progress',
  generation: gen + 1,
  totalGenerations: TOTAL_GENERATIONS,
  bestFitness: best.fitness,
  bestParams: best.genes,
  metrics: bestMetrics,
})

// 全部完成后发送最终结果
parentPort.postMessage({
  type: 'complete',
  bestParams: best.genes,
  bestFitness: best.fitness,
  metrics: finalMetrics,
  history: [...],  // 每代最优解历史
})
```

---

## 七、并行计算优化

### 7.1 Worker 线程池架构

`optimizerPool.ts` 使用 Node.js `worker_threads` 实现独立进程优化：

```
主线程                    Worker 线程
   |                           |
   |--- postMessage(klines) -->|
   |      strategyType         |
   |      paramRanges           |
   |      populationSize        |
   |      generations           |
   |                           |
   |<-- message(progress) ------|  每代进度回调
   |<-- message(complete) ------|  最终结果
```

- 每次优化任务启动一个独立 Worker 进程
- Worker 内完整运行 GA，不阻塞主线程
- 进度实时写入 `strategyOptimizations` 表
- 支持通过 `cancelOptimization(symbol, taskId)` 中途终止

### 7.2 多任务并发

`optimizerPool` 内部维护 `activeTasks` Map，支持同时运行多个优化任务：

```typescript
const activeTasks = new Map<string, { worker: Worker; resolve; reject }>()
```

### 7.3 数据要求

- 最低 K 线数量：60 根（不足 60 根直接返回 sharpe=-999）
- 数据来源：`getOrFetchKlines(symbol)` → 按 date 过滤 startDate~endDate

---

## 八、回测指标计算

### 8.1 初始资金与持仓

```typescript
const equity: number[] = [10000]  // 初始权益 10000 元
let capital = 10000
let position = 0  // 0=空仓, 1=持仓
let shares = 0
```

### 8.2 交易逻辑（以 RSI 策略为例）

```typescript
for (let i = 1; i < closes.length; i++) {
  // RSI < oversold 且空仓 → 买入
  if (rsi[i] < oversold && position === 0) {
    shares = Math.floor(capital / closes[i])
    position = 1
    capital -= shares * closes[i]  // 扣除买入成本
  }
  // RSI > overbought 且持仓 → 卖出
  else if (rsi[i] > overbought && position === 1) {
    capital += shares * closes[i]  // 收回资金
    trades.push({ entry, exit: closes[i], pnl: capital - 10000 })
    shares = 0
    position = 0
  }
  // 持仓期间权益变化（股价波动）
  capital += shares * (closes[i] - closes[i - 1])
  equity.push(capital)
}
```

**注意**：此回测不含交易成本（佣金/印花税/滑点），仅用于参数优化选择。

### 8.3 指标计算

**总收益率**:
```
totalReturn = (finalCapital - 10000) / 10000
```

**夏普比**:
```
日收益率 = (equity[i] - equity[i-1]) / equity[i-1]
夏普比 = (日均收益率 / 日收益率标准差) × √252
       = (avgReturn / stdReturn) × 15.87
```

**最大回撤**:
```
peak = max(equity历史)
maxDrawdown = max((peak - equity) / peak)
```

**胜率**:
```
winRate = 盈利交易数 / 总交易数
```

---

## 九、网格搜索（Grid Search）

除 GA 外，策略优化器还支持网格搜索 `/grid-search`：

```typescript
// 参数网格示例
{
  rsiPeriod: [5, 10, 14, 20, 30],
  oversold: [20, 25, 30, 35, 40]
}
// 共 5 × 5 = 25 种组合
```

- 生成所有参数组合（笛卡尔积）
- 最多采样 200 个组合进行评估
- 按夏普比排序返回 Top 20

---

## 十、Walk-Forward 验证

`/walk-forward` 接口提供 walk-forward 分析，验证参数稳健性：

```
训练窗口: windowSize 根 K 线（如 60 根）
测试窗口: stepSize 根 K 线（如 20 根）
步进: 每 20 根滑动一次
```

输出每窗口的训练/测试夏普比，并计算一致性指标：

```
consistency = avgSharpe / (avgSharpe + sharpeStd)
robustness:  高（>0.6） | 中（0.4~0.6） | 低（<0.4）
```

---

## 十一、策略对比（Compare Strategies）

`/compare-strategies` 对比多条策略在同一股票/时段的表现：

```typescript
// 输出字段
{
  name:        // 策略名称
  totalReturn: // 总收益率 (%)
  sharpe:      // 夏普比
  alpha:       // 相对基准超额收益
  score:       // 综合评分 = totalReturn×0.3 + sharpe×25
}
```

基准使用同期买入持有（BH）策略计算。

---

## 十二、API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/optimizer` | 获取当前用户所有优化任务 |
| GET | `/api/optimizer/:id` | 获取指定任务详情 |
| POST | `/api/optimizer` | 创建新的 GA 优化任务 |
| DELETE | `/api/optimizer/:id` | 删除优化任务 |
| POST | `/api/optimizer/grid-search` | 网格搜索 |
| POST | `/api/optimizer/walk-forward` | Walk-forward 分析 |
| POST | `/api/optimizer/compare-strategies` | 多策略对比 |
| GET | `/api/optimizer/parameter-ranges` | 获取内置策略参数范围 |

---

## 十三、数据库表

`strategyOptimizations` 表关键字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| userId | int | 用户 ID |
| strategyKey | varchar | 策略标识 |
| symbol | varchar | 股票代码 |
| startDate | date | 回测开始日期 |
| endDate | date | 回测结束日期 |
| paramRanges | jsonb | 参数范围定义 |
| status | varchar | pending/running/completed/failed |
| progress | int | 进度百分比 |
| generation | int | 当前代数 |
| totalGenerations | int | 总代数 |
| bestParams | jsonb | 最优参数 |
| bestFitness | varchar | 最优适应度 |
| metrics | jsonb | 最优回测指标 |
| history | jsonb | 每代最优解历史 |
| createdAt | timestamp | 创建时间 |
| completedAt | timestamp | 完成时间 |

---

## 十四、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/engine/optimizer.ts` | GA 核心算法（主线程版本） |
| `src/server/workers/optimizer.worker.cjs` | Worker 进程 GA 实现 |
| `src/server/workers/optimizerPool.ts` | Worker 线程池管理 |
| `src/server/routes/strategyOptimizer.ts` | API 路由定义 |
| `src/server/db/schema.ts` | strategyOptimizations 表定义 |
