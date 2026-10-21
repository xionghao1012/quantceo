#!/usr/bin/env bash
# End-to-End Integration Test Suite for QuantCEO
# Usage: bash tests/integration/test_services.sh [base_url]
# Default base_url: http://localhost (nginx), or individual ports

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1 — $2"; FAIL=$((FAIL + 1)); }

health_check() {
  local name="$1"
  local url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    pass "$name ($url)"
  else
    fail "$name ($url)" "HTTP $code"
  fi
}

api_test() {
  local name="$1"
  local method="$2"
  local url="$3"
  local expect="${4:-200}"
  local body="${5:-}"
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/qt_test_resp.json -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$body" --connect-timeout 10 "$url" 2>/dev/null || echo "000")
  else
    code=$(curl -s -o /tmp/qt_test_resp.json -w "%{http_code}" -X "$method" --connect-timeout 10 "$url" 2>/dev/null || echo "000")
  fi
  if [ "$code" = "$expect" ]; then
    pass "$name" 
  else
    local resp
    resp=$(head -c 200 /tmp/qt_test_resp.json 2>/dev/null)
    fail "$name" "Expected $expect, got $code. Response: $resp"
  fi
}

echo "========================================"
echo " QuantCEO Integration Test Suite"
echo " $(date)"
echo "========================================"
echo ""

# ---- Health Checks ----
echo "--- Service Health Checks ---"

health_check "quant-trading"    "http://localhost:4001/api/health"
health_check "quant-ai"        "http://localhost:4002/health"
health_check "market-data"     "http://localhost:4003/health"
health_check "scan-engine"     "http://localhost:4004/health"
health_check "indicator-service" "http://localhost:4005/health"
health_check "backtest-engine" "http://localhost:4006/health"
health_check "quant-sso"       "http://localhost:3002/health"

echo ""

# ---- Market Data API ----
echo "--- Market Data API ---"

api_test "GET stock list"          "GET"  "http://localhost:4003/api/data/stocks"
api_test "GET single kline"        "GET"  "http://localhost:4003/api/data/klines/000001?days=5"
api_test "POST klines bulk"        "POST" "http://localhost:4003/api/data/klines/bulk" 200 '{"codes":["000001","600000"],"days":5}'
api_test "POST kline refresh"      "POST" "http://localhost:4003/api/data/klines/000001/refresh"
api_test "POST refresh-all"        "POST" "http://localhost:4003/api/data/klines/refresh-all" 200 '{"limit":5}'

echo ""

# ---- Scan Engine API ----
echo "--- Scan Engine API ---"

api_test "POST single scan"        "POST" "http://localhost:4004/api/scan/stock" 200 '{"code":"000001","name":"平安银行"}'
api_test "POST bulk scan"          "POST" "http://localhost:4004/api/scan/bulk" 200 '{"stocks":[{"code":"000001","name":"平安银行"}]}'
api_test "POST market scan"        "POST" "http://localhost:4004/api/scan/market" 200 '{"limit":5}'

echo ""

# ---- Quant Trading API ----
echo "--- Quant Trading API ---"

api_test "GET health"              "GET"  "http://localhost:4001/api/health"
api_test "GET stocks"              "GET"  "http://localhost:4001/api/stocks"
api_test "POST screener"           "POST"  "http://localhost:4001/api/screener" 200 '{"conditions":[{"field":"rsi","operator":"<","value":30}],"limit":5}'
api_test "GET watchlist (no auth)" "GET"  "http://localhost:4001/api/watchlist" 401
api_test "GET rankings"            "GET"  "http://localhost:4001/api/rankings"
api_test "GET backtest history"    "GET"  "http://localhost:4001/api/backtest/history"
api_test "POST compute-metrics"    "POST" "http://localhost:4001/api/internal/compute-metrics"

echo ""

# ---- Backtest Engine API ----
echo "--- Backtest Engine API ---"

api_test "GET health"              "GET"  "http://localhost:4006/health"
api_test "POST signal backtest"    "POST" "http://localhost:4006/api/backtest" 200 '{"klines":[{"date":"2025-01-01","close":10,"open":9.8,"high":10.2,"low":9.7,"volume":10000}],"rules":[],"initialCapital":100000}'
api_test "POST strategy backtest"  "POST" "http://localhost:4006/api/backtest/strategy" 200 '{"strategyKey":"all","topN":5}'
api_test "GET strategy results"    "GET"  "http://localhost:4006/api/backtest/strategy/results"

echo ""

# ---- AI Service API (Pro only) ----
echo "--- Quant AI API ---"

api_test "GET today predictions"   "GET"  "http://localhost:4002/api/ai/predictions/today"
api_test "GET preds history"       "GET"  "http://localhost:4002/api/ai/predictions/history"
api_test "GET preds stats"         "GET"  "http://localhost:4002/api/ai/predictions/stats"

echo ""

# ---- SSO Service API (Pro only) ----
echo "--- Quant SSO API ---"

api_test "GET health"              "GET"  "http://localhost:3002/health"

echo ""
echo "========================================"
echo " Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
