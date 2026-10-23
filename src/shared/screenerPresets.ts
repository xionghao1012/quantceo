/**
 * 筛选页的预置示例（客户端与测试共用一份）。
 *
 * 约束：字段必须存在于服务端白名单（`SCREENER_FIELDS` in routes/screener.ts），
 * 否则点击示例会得到 400 —— 有一个测试专门盯这条。
 */

export interface ScreenerPresetCondition {
  field: string
  operator: '>' | '<' | '==' | 'between'
  value: number
}

export interface ScreenerPreset {
  key: string
  label: string
  hint: string
  conditions: ScreenerPresetCondition[]
}

export const SCREENER_PRESETS: ScreenerPreset[] = [
  {
    key: 'surge',
    label: '强势异动',
    hint: '涨幅 > 2% 且振幅 > 4%',
    conditions: [
      { field: 'change', operator: '>', value: 2 },
      { field: 'amplitude', operator: '>', value: 4 },
    ],
  },
  {
    key: 'oversold',
    label: 'RSI 超跌',
    hint: 'RSI < 40（越跌越靠前）',
    conditions: [{ field: 'rsi', operator: '<', value: 40 }],
  },
  {
    key: 'macd',
    label: 'MACD 转强',
    hint: 'MACD 柱 > 0',
    conditions: [{ field: 'macdHistogram', operator: '>', value: 0 }],
  },
]
