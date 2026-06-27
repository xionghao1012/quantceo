import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { KLine } from '@shared/types'

interface StockInfo { code: string; name: string; exchange: string }
type QuoteMap = Record<string, { price: number; change: number; volume: number }>

export const useStockStore = defineStore('stock', () => {
  const view = ref<'list' | 'detail' | 'backtest' | 'scan'>('list')
  const selectedCode = ref('')
  const klines = ref<KLine[]>([])
  const indicators = ref<any>(null)
  const loading = ref(false)
  const error = ref('')
  const searchQuery = ref('')

  const stockByCode = shallowRef<Record<string, StockInfo>>({})
  const quotes = ref<QuoteMap>({})

  async function fetchStockList(onProgress?: (n: number) => void) {
    const PAGE = 500
    const TOTAL_STOCKS = 5300
    const totalBatches = Math.ceil(TOTAL_STOCKS / PAGE)
    let offset = 0
    let batchIndex = 0
    const map: Record<string, StockInfo> = {}
    while (true) {
      const res = await fetch(`/api/stocks?limit=${PAGE}&offset=${offset}`)
      if (!res.ok) break
      const data = await res.json()
      if (!data.length) break
      for (const s of data) map[s.code] = s
      batchIndex++
      if (onProgress) onProgress(Math.round(batchIndex / totalBatches * 100))
      if (data.length < PAGE) break
      offset += PAGE
    }
    stockByCode.value = map
  }

  async function fetchQuotesForPage(codes: string[]) {
    if (!codes.length) return
    const res = await fetch('/api/stocks/quotes/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    })
    if (res.ok) {
      const batch = await res.json()
      quotes.value = { ...quotes.value, ...batch }
    }
  }

  async function fetchQuotes() {
    const res = await fetch('/api/stocks/quotes')
    if (res.ok) quotes.value = await res.json()
  }

  const stockList = computed(() => Object.values(stockByCode.value))

  const currentKLine = computed(() =>
    klines.value.length > 0 ? klines.value[klines.value.length - 1] : null
  )

  const priceChange = computed(() => {
    if (klines.value.length < 2) return 0
    const last = klines.value[klines.value.length - 1].close
    const prev = klines.value[klines.value.length - 2].close
    return ((last - prev) / prev * 100)
  })

  function stockName(code: string) {
    return stockByCode.value[code]?.name || code
  }

  async function selectStock(code: string) {
    selectedCode.value = code
    view.value = 'detail'
    loading.value = true
    error.value = ''
    try {
      const isUS = /^[A-Za-z.]+$/.test(code) && !code.startsWith('hk')
      const isHK = code.startsWith('hk') || code.startsWith('HK')
      let klineUrl = `/api/stocks/${code}/klines`
      let indUrl = `/api/stocks/${code}/indicators`

      if (isUS) {
        klineUrl = `/api/stocks/intl/US/${code}/klines`
        indUrl = `/api/stocks/intl/US/${code}/indicators`
      } else if (isHK) {
        klineUrl = `/api/stocks/intl/HK/${code}/klines`
        indUrl = `/api/stocks/intl/HK/${code}/indicators`
      }

      const res = await fetch(klineUrl)
      if (!res.ok) throw new Error('获取K线数据失败')
      const json = await res.json()
      klines.value = json.klines

      const indRes = await fetch(indUrl)
      if (indRes.ok) indicators.value = await indRes.json()
      else indicators.value = null
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return {
    view, selectedCode, klines, indicators, loading, error, searchQuery,
    stockByCode, quotes, stockList,
    fetchStockList, fetchQuotes, fetchQuotesForPage, stockName,
    currentKLine, priceChange, selectStock,
  }
})
