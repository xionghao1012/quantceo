/**
 * 用户自定义 SQL 的白名单校验
 *
 * /api/screener-pro 的 formula 会被拼进 SQL 文本（sql.raw），
 * 直接放开等于给登录用户一个任意 SQL 执行口（可读 users 表、可拖库）。
 *
 * 这里把 formula 限制成「已知列 + 运算符 + 数字」的只读布尔表达式：
 *  - 禁止注释、引号、分号、反斜杠 → 没法闭合外层 SQL、没法注入第二条语句
 *  - 标识符必须命中列名/别名/函数白名单 → 没法引用别的表或系统函数
 *  - 长度与 token 数设上限 → 没法用超长表达式拖垮数据库
 */

/** daily_metrics + klines 允许被引用的列 */
export const ALLOWED_COLUMNS = new Set([
  // daily_metrics
  'id', 'metric_date', 'code', 'name', 'exchange', 'board',
  'rsi', 'change_pct', 'vol_ratio', 'macd_signal', 'bb_position',
  'ma_alignment', 'volatility', 'momentum', 'computed_at',
  // klines
  'date', 'open', 'high', 'low', 'close', 'volume', 'amount',
])

/** 允许的表别名 */
const ALLOWED_ALIASES = new Set(['dm', 'k'])

/** 允许的函数 */
const ALLOWED_FUNCTIONS = new Set([
  'abs', 'coalesce', 'nullif', 'greatest', 'least',
  'round', 'floor', 'ceil', 'sqrt', 'log', 'ln', 'exp', 'power',
])

/** 允许的关键字 */
const ALLOWED_KEYWORDS = new Set([
  'and', 'or', 'not', 'true', 'false', 'null',
  'case', 'when', 'then', 'else', 'end',
  'between', 'is', 'in', 'like', 'asc', 'desc',
])

/** 允许的 :: 类型转换 */
const ALLOWED_CASTS = new Set(['numeric', 'int', 'integer', 'float', 'double', 'text', 'bool', 'boolean'])

const MAX_LENGTH = 500
const MAX_TOKENS = 200

export interface FormulaCheck {
  ok: boolean
  error?: string
}

export function validateMetricFormula(formula: unknown): FormulaCheck {
  if (typeof formula !== 'string' || !formula.trim()) {
    return { ok: false, error: '筛选公式不能为空' }
  }
  if (formula.length > MAX_LENGTH) {
    return { ok: false, error: `筛选公式过长（上限 ${MAX_LENGTH} 字符）` }
  }
  // 注释、引号、分号、反斜杠：闭合外层 SQL 或注入第二条语句的必要条件
  for (const bad of [';', "'", '"', '\\', '--', '/*', '*/']) {
    if (formula.includes(bad)) {
      return { ok: false, error: `筛选公式包含不允许的字符：${bad}` }
    }
  }

  const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|::|[<>=+\-*/%(),.\s]/g) || []
  // 逐字符扫描，确保没有匹配不上的杂字符
  const stripped = tokens.join('')
  if (stripped.replace(/\s+/g, '') !== formula.replace(/\s+/g, '')) {
    return { ok: false, error: '筛选公式包含非法字符' }
  }
  if (tokens.length > MAX_TOKENS) {
    return { ok: false, error: `筛选公式过于复杂（上限 ${MAX_TOKENS} 个片段）` }
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!/^[A-Za-z_]/.test(tok)) continue // 数字 / 运算符
    const lower = tok.toLowerCase()

    // 别名.列
    if (tokens[i + 1] === '.') {
      if (!ALLOWED_ALIASES.has(lower)) {
        return { ok: false, error: `不允许的表别名：${tok}` }
      }
      const col = tokens[i + 2]
      if (!col || !ALLOWED_COLUMNS.has(col.toLowerCase())) {
        return { ok: false, error: `不允许的列名：${col ?? ''}` }
      }
      i += 2
      continue
    }

    // 类型转换 :: numeric
    if (tokens[i - 1] === '::') {
      if (!ALLOWED_CASTS.has(lower)) {
        return { ok: false, error: `不允许的类型转换：${tok}` }
      }
      continue
    }

    // 函数调用
    if (tokens[i + 1] === '(') {
      if (!ALLOWED_FUNCTIONS.has(lower)) {
        return { ok: false, error: `不允许的函数：${tok}` }
      }
      continue
    }

    if (ALLOWED_COLUMNS.has(lower)) continue
    if (ALLOWED_KEYWORDS.has(lower)) continue
    return { ok: false, error: `不允许的标识符：${tok}` }
  }

  return { ok: true }
}

/** 排序字段白名单：key → SQL 片段 */
export const SORT_FIELDS: Record<string, string> = {
  rsi: 'dm.rsi::numeric',
  change_pct: 'dm.change_pct::numeric',
  vol_ratio: 'dm.vol_ratio::numeric',
  macd_signal: 'dm.macd_signal::numeric',
  bb_position: 'dm.bb_position::numeric',
  volatility: 'dm.volatility::numeric',
  momentum: 'dm.momentum::numeric',
}

/** 比较运算符白名单 */
export const COMPARISON_OPS: Record<string, string> = {
  '>': '>', '<': '<', '>=': '>=', '<=': '<=', '=': '=', '==': '=',
}
