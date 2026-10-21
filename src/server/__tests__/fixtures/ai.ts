/**
 * Realistic AI/LLM service response fixtures.
 * Used to mock `aiFetch` calls to the local AI service (port 4002).
 */

export const mockAIPredictionResponse = {
  prediction: {
    direction: 'up',
    confidence: 75,
    targetPrice: 1700,
    stopLoss: 1600,
    holdingDays: 5,
  },
  reasoning: 'Based on technical analysis: RSI oversold, MA5/20 golden cross forming, volume increasing.',
  model: 'mock-llm',
  latencyMs: 120,
}

export const mockAIAnalyzeNewsResponse = {
  sentiment: 'positive',
  score: 0.72,
  summary: 'Recent coverage shows strong quarterly results ahead of expectations.',
  keyTopics: ['earnings', 'revenue growth', 'market share'],
}

export const mockAIMarketBatchResponse = {
  predictions: [
    { code: '600519', direction: 'up', confidence: 78, targetPrice: 1700 },
    { code: '000001', direction: 'down', confidence: 62, targetPrice: 12.0 },
    { code: '300750', direction: 'up', confidence: 71, targetPrice: 230 },
  ],
  runId: 'batch-20240115-001',
  completedAt: '2024-01-15T10:30:00Z',
}

export const mockAIJobResponse = {
  id: 'job-123',
  status: 'completed',
  result: mockAIMarketBatchResponse,
}
