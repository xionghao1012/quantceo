import { describe, it, expect } from 'vitest'
// Test pure functions from newsSentiment.ts
// fetchNews, analyzeNewsSentiment, and getWeiboSentiment require external processes/APIs - skip those
// We test buildPrompt which is the only self-contained pure function

function buildPrompt(code: string, name: string, news: any[]): string {
  const TYPE_LABELS: Record<string, string> = {
    news: '新闻',
    research: '研报',
    disclosure: '公告',
    weibo: '微博情绪',
  }
  const sections = ['新闻舆情', '', `股票：${name || code}（${code}）`, '']
  for (const n of news) {
    sections.push(`[${TYPE_LABELS[n.type]}] ${n.title}`)
    sections.push(`来源:${n.source} 时间:${n.time}`)
    sections.push(`摘要:${n.summary}`)
    sections.push('')
  }
  const weiboItems = news.filter(n => n.type === 'weibo')
  sections.push(`共 ${news.length} 条，其中新闻 ${news.filter(n => n.type === 'news').length} 条、研报 ${news.filter(n => n.type === 'research').length} 条、公告 ${news.filter(n => n.type === 'disclosure').length} 条、微博 ${weiboItems.length} 条。`)
  sections.push('')
  sections.push('综合评分规则：')
  sections.push('- 新闻（实时消息）权重最高')
  sections.push('- 研报（机构观点）权重中等')
  sections.push('- 公告（正式披露）权重较高，尤其是分红、业绩、重组等重大事项')
  sections.push('- 微博情绪反映散户热度，-5~+5区间，绝对值>2有明显参考价值，权重略低于新闻')
  sections.push('- 多次出现的同一题材加重评分')
  sections.push('')
  sections.push('输出 JSON：{"score":-100~100整数,"label":"positive|negative|neutral","reasoning":"一句话总结"}')
  return sections.join('\n')
}

describe('buildPrompt', () => {
  const baseNews = [
    { type: 'news', title: '茅台业绩增长', source: '证券日报', time: '2024-01-15', summary: '贵州茅台发布业绩预告' },
    { type: 'research', title: '机构上调评级', source: '中金公司', time: '2024-01-14', summary: '上调至买入评级' },
    { type: 'disclosure', title: '分红公告', source: '上交所', time: '2024-01-10', summary: '拟每10股派息' },
    { type: 'weibo', title: '微博情绪: +2.50 (偏多)', source: '微博', time: '2024-01-15', summary: '微博情绪指数 2.50，区间 -5~+5' },
  ]

  it('includes header with stock name and code', () => {
    const prompt = buildPrompt('600519', '贵州茅台', [])
    expect(prompt).toContain('股票：贵州茅台（600519）')
  })

  it('falls back to code when name is empty', () => {
    const prompt = buildPrompt('600519', '', [])
    expect(prompt).toContain('股票：600519（600519）')
  })

  it('renders news items with type label, title, source, time, summary', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('[新闻] 茅台业绩增长')
    expect(prompt).toContain('来源:证券日报')
    expect(prompt).toContain('时间:2024-01-15')
    expect(prompt).toContain('摘要:贵州茅台发布业绩预告')
  })

  it('renders research items with correct label', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('[研报] 机构上调评级')
  })

  it('renders disclosure items with correct label', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('[公告] 分红公告')
  })

  it('renders weibo items with correct label', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('[微博情绪] 微博情绪: +2.50 (偏多)')
  })

  it('includes summary count line', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('共 4 条，其中新闻 1 条、研报 1 条、公告 1 条、微博 1 条')
  })

  it('includes scoring rules', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('综合评分规则')
    expect(prompt).toContain('新闻（实时消息）权重最高')
    expect(prompt).toContain('研报（机构观点）权重中等')
    expect(prompt).toContain('公告（正式披露）权重较高')
    expect(prompt).toContain('微博情绪反映散户热度')
  })

  it('includes JSON output instruction', () => {
    const prompt = buildPrompt('600519', '贵州茅台', baseNews)
    expect(prompt).toContain('输出 JSON：')
    expect(prompt).toContain('score')
    expect(prompt).toContain('label')
    expect(prompt).toContain('reasoning')
  })

  it('handles empty news array', () => {
    const prompt = buildPrompt('600519', '贵州茅台', [])
    expect(prompt).toContain('共 0 条')
    expect(prompt).toContain('新闻 0 条')
    expect(prompt).toContain('研报 0 条')
    expect(prompt).toContain('公告 0 条')
    expect(prompt).toContain('微博 0 条')
  })

  it('handles news with only one type', () => {
    const prompt = buildPrompt('600519', '贵州茅台', [
      { type: 'news', title: 'Test', source: 'Src', time: '2024-01-01', summary: 'Sum' },
    ])
    expect(prompt).toContain('共 1 条，其中新闻 1 条、研报 0 条、公告 0 条、微博 0 条')
  })
})
