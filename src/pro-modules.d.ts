// Type declarations for Pro modules — not available in OSS build
// This prevents TypeScript from resolving these imports during compilation

declare module './plugins/pro' { export const proPlugin: any }
declare module './plugins/pro.js' { export const proPlugin: any }
declare module './ai/predict.js' { export const evaluatePredictions: any }
declare module '../ai/intradayAlert.js' { export const checkIntradayAnomalies: any }
declare module '../ai/positionAlert.js' { export const analyzeAllPositions: any }
declare module './push/dispatcher.js' { export const dispatchPush: any }
declare module '../ai/predict.js' { export const selectDailyPicks: any; export const getHoldings: any; export const loadKlines: any; export const predictOne: any; export const savePrediction: any; export const evaluatePredictions: any }
