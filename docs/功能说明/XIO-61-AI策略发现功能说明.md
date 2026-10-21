# AI 策略发现功能说明

## 一、功能概述

AI 策略发现模块利用大语言模型分析股票历史K线数据，自动发掘潜在有效的交易策略。用户选择股票、时间范围和偏好设置后，AI 分析历史模式并生成对应买卖规则，随后通过回测验证有效性。

**页面路径**: `/ai/discover`
**访问权限**: Pro 用户专享

---

## 二、发现算法逻辑

### 2.1 整体流程

```
用户配置 → K线数据压缩 → Prompt 构建 → LLM 策略生成 → JSON 解析 → 回测验证 → 结果存储
```

**代码实现** (`ai/strategyDiscovery.ts:158`):
```typescript
export async function discoverStrategies(symbol: string, klines: any[], preferences: any) {
    const prompt = buildPrompt(symbol, klines, preferences);
    const output = await callOpencode(prompt) as string;
    return parseAIResponse(output);
}
```

### 2.2 K线数据压缩

为控制Token开销，历史K线数据按200点压缩：

```typescript
function compressKlines(klines: any[], maxPoints = 200) {
    // 高点取max，低点取min，开收取首尾，量累加
    // 返回 [{date, open, high, low, close, volume}]
}
```

### 2.3 Prompt 工程

Prompt 包含三部分：

| 部分 | 内容 |
|------|------|
| 数据 | 压缩后的K线（日期/开/高/低/收/量） |
| 偏好 | 风险等级 + 持仓周期 + 目标数量 |
| 约束 | 可用指标列表 + 策略规则格式 + 输出JSON模板 |

**Prompt 关键约束** (`ai/strategyDiscovery.ts:38-66`):
- 指标名必须使用小写：`ma5`, `ma10`, `ma20`, `ma60`, `macd`, `macdSignal`, `rsi`, `bbUpper`, `bbMiddle`, `bbLower`, `close`
- 禁止生成依赖未来数据的策略
- 每个策略必须同时包含买入和卖出规则

---

## 三、策略评估指标

AI 生成的策略通过回测引擎验证，评估指标与策略回测模块一致：

| 指标 | 说明 |
|------|------|
| 夏普比 (Sharpe) | 风险调整后收益，越高越好 |
| 最大回撤 (MaxDrawdown) | 历史最大亏损幅度，越低越好 |
| 胜率 (WinRate) | 盈利交易占比，越高越好 |
| 总收益率 (TotalReturn) | 策略总体收益，越高越好 |
| 交易次数 (TradeCount) | 样本量，过少不具统计意义 |

**回测验证代码** (`routes/aiStrategy.ts:68-76`):
```typescript
const btResult = runBacktest(klines, { code: symbol, strategyId: 'ai', ... }, rules);
metrics = {
    sharpe: btResult.sharpe,
    maxDrawdown: btResult.maxDrawdown,
    winRate: btResult.winRate,
    totalReturn: btResult.totalReturn,
    tradeCount: btResult.tradeCount,
};
```

---

## 四、策略有效性判定标准

### 4.1 AI 置信度

LLM 输出策略时附带 `confidence`（0.0-1.0），基于历史数据模式观察程度。

### 4.2 回测验证

每个策略必须通过回测验证，未通过回测的策略仍会保存（标注失败原因），通过验证的策略状态为 `completed`。

### 4.3 有效性阈值参考

| 指标 | 推荐阈值 |
|------|---------|
| 夏普比 | > 0.5 |
| 最大回撤 | < 20% |
| 胜率 | > 40% |
| 交易次数 | ≥ 5 笔 |

---

## 五、策略搜索空间

### 5.1 可用指标

| 指标名 | 说明 |
|--------|------|
| ma5 / ma10 / ma20 / ma60 | 简单移动平均线 |
| macd / macdSignal / macdHistogram | MACD 及其信号线/柱 |
| rsi | 相对强弱指数 |
| bbUpper / bbMiddle / bbLower | 布林带上/中/下轨 |
| close | 收盘价 |

### 5.2 策略类型

| 类型 | 说明 | 示例 |
|------|------|------|
| cross（交叉型） | 两指标交叉 | `{indicator:"ma5", operator:"cross_above", value:"ma20"}` |
| threshold（阈值型） | 指标与固定值比较 | `{indicator:"rsi", operator:">", value:70}` |

### 5.3 操作符

- 交叉型：`cross_above`（上穿）、`cross_below`（下穿）
- 阈值型：`>`、`>=`、`<`、`<=`

---

## 六、策略验证流程

### 6.1 完整流程图

```
1. 用户提交发现请求
       ↓
2. 创建占位记录（status: processing）
       ↓
3. 获取K线数据（至少60条）
       ↓
4. 调用 opencode LLM 生成策略
       ↓
5. 解析 JSON 响应
       ↓
6. 对每个策略执行回测验证
       ↓
7. 保存结果（completed / error）
       ↓
8. 前端轮询更新状态
```

### 6.2 异步处理

策略发现为异步任务，前端通过轮询检测状态变化：

```typescript
// 前端轮询逻辑 (AiDiscoveryView.vue:79-90)
pollTimer = setInterval(async () => {
    await loadHistory()
    const hasProcessing = history.value.some(h => h.status === 'processing')
    if (!hasProcessing) {
        clearInterval(pollTimer)
        pollTimer = null
        clearJob()
    }
}, 3000)
```

---

## 七、用户配置参数

| 参数 | 选项 | 说明 |
|------|------|------|
| 风险偏好 | 稳健型 / 平衡型 / 激进型 | 影响策略选择倾向 |
| 持仓周期 | 短线(1-3天) / 中线(1-4周) / 长线(1-6月) | 影响策略时间框架 |
| 生成数量 | 1-10 个 | 最多生成策略数 |

---

## 八、策略输出格式

```typescript
interface DiscoveredStrategy {
    name: string           // 策略名称
    description: string    // 策略描述（10-20字）
    rules: Rule[]          // 买卖规则数组
    confidence: number     // AI置信度（0.0-1.0）
    rationale: string      // 策略逻辑说明（20-50字）
}

interface Rule {
    type: 'cross' | 'threshold'
    action: 'BUY' | 'SELL'
    conditions: {
        indicator: string  // 指标名（小写）
        operator: string   // 操作符
        value: string | number  // 阈值或目标指标
    }[]
}

interface DiscoveryResult {
    strategies: DiscoveredStrategy[]
    analysis: {
        dataPoints: number       // 使用的数据点数量
        patternsFound: string[]  // 发现的市场模式
        marketContext: string    // 市场背景描述
    }
}
```

---

## 九、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/ai/strategyDiscovery.ts` | 策略发现核心逻辑（Prompt构建/LLM调用） |
| `src/server/routes/aiStrategy.ts` | API路由与异步任务处理 |
| `src/server/backtest/index.ts` | 回测验证引擎 |
| `src/client/views/AiDiscoveryView.vue` | 前端发现页面 |
| `src/server/db/schema.ts` | `aiGeneratedStrategies` 表定义 |
