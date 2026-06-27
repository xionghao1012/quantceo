export type MinutePeriod = 'm5' | 'm15' | 'm30' | 'm60'

export interface KLine {
  code: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface StockQuote {
  code: string
  name: string
  price: number
  change: number
  changePct: number
  volume: number
  amount: number
  high: number
  low: number
  open: number
  prevClose: number
}
