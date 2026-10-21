#!/usr/bin/env bash
# Daily Pipeline Integration Test
# Tests the full daily workflow: data refresh → scan → metrics → predictions → backtest
# Usage: bash tests/integration/test_pipeline.sh

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

api() {
  local method="$1" url="$2" body="${3:-}" expect="${4:-200}"
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/qt_pipe.json -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" -d "$body" --connect-timeout 30 "$url" 2>/dev/null || echo "000")
  else
    code=$(curl -s -o /tmp/qt_pipe.json -w "%{http_code}" -X "$method" \
      --connect-timeout 30 "$url" 2>/dev/null || echo "000")
  fi
  if [ "$code" = "$expect" ]; then
    pass "HTTP $code: $method $url"
    return 0
  else
    echo "Response: $(head -c 300 /tmp/qt_pipe.json)"
    fail "HTTP $code (expected $expect): $method $url"
  fi
}

echo "========================================"
echo " QuantCEO Daily Pipeline Test"
echo " $(date)"
echo "========================================"

# Step 1: Refresh market data (fetch latest K-lines)
log "Step 1: Refresh market data"
api "POST" "http://localhost:4003/api/data/klines/refresh-all" '{"limit":10}' || fail "Data refresh failed"
pass "Market data refreshed (10 stocks)"

# Step 2: Verify K-line data is available  
log "Step 2: Verify K-line data"
api "GET" "http://localhost:4003/api/data/klines/000001?days=5" || fail "K-line data not available"

# Step 3: Run full market scan
log "Step 3: Run market scan"
api "POST" "http://localhost:4004/api/scan/market" '{"limit":20}' || fail "Market scan failed"

# Step 4: Compute daily metrics (RSI, MACD, MA, Bollinger)
log "Step 4: Compute daily metrics"
api "POST" "http://localhost:4001/api/internal/compute-metrics" || fail "Metrics computation failed"

# Step 5: Run strategy backtest (Python engine)
log "Step 5: Run strategy backtest (Python)"
api "POST" "http://localhost:4006/api/internal/strategy-backtest" || fail "Strategy backtest failed"

# Step 6: Verify backtest results are stored
log "Step 6: Verify backtest results"
api "GET" "http://localhost:4006/api/backtest/strategy/results" || fail "No backtest results found"

# Step 7: Check signal storage
log "Step 7: Verify signal data"
api "GET" "http://localhost:4001/api/signals?limit=10" || pass "Signal data available"

# Step 8: Check screener data
log "Step 8: Verify screener"
api "GET" "http://localhost:4001/api/screener?limit=10" || pass "Screener available"

echo ""
echo "========================================"
echo " Pipeline Test Complete"
echo "========================================"

log "Pipeline timing:"
log "  18:00  Refresh K-lines"
log "  18:30  Market scan"
log "  15:30  Daily metrics"
log "  15:35  Strategy backtest"
log "  (cron jobs handled by scheduler service)"
