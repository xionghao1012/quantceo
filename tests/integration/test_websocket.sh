#!/usr/bin/env bash
# WebSocket Integration Test for QuantCEO
# Tests the /ws endpoint of quant-trading
# Requires: wscat (npm install -g wscat) or timeout + curl

set -euo pipefail

BASE="${1:-ws://localhost:4001}"
WS_URL="$BASE/ws"
PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1 — $2"; FAIL=$((FAIL + 1)); }

echo "========================================"
echo " QuantCEO WebSocket Integration Test"
echo " $(date)"
echo " URL: $WS_URL"
echo "========================================"
echo ""

# Check for node + ws
if ! command -v node &>/dev/null; then
  echo "  ${RED}✗ node not found — skipping${NC}"
  exit 1
fi

# Use node to test WebSocket connection
echo "--- Connection & Subscribe ---"

node -e "
const { WebSocket } = require('ws');
const ws = new WebSocket('$WS_URL');
let errors = 0;

ws.on('open', () => {
  console.log('  ✓ WebSocket connected');
  ws.send(JSON.stringify({ type: 'subscribe', codes: ['000001', '600000'] }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'connected') {
    console.log('  ✓ Received: connected message');
  } else if (msg.type === 'subscribed') {
    console.log('  ✓ Received: subscribed confirmation, codes:', JSON.stringify(msg.codes));
    if (msg.codes.length === 2 && msg.codes.includes('000001')) {
      console.log('  ✓ Subscription codes match');
    } else {
      console.log('  ✗ Subscription codes mismatch');
      errors++;
    }
    // Unsubscribe and close
    ws.send(JSON.stringify({ type: 'unsubscribe', codes: ['600000'] }));
  } else if (msg.type === 'unsubscribed') {
    console.log('  ✓ Received: unsubscribed confirmation');
    ws.close();
  }
});

ws.on('error', (err) => {
  console.log('  ✗ WebSocket error:', err.message);
  errors++;
});

ws.on('close', () => {
  if (errors === 0) {
    console.log('  ✓ All WebSocket tests passed');
    process.exit(0);
  } else {
    process.exit(1);
  }
});

setTimeout(() => {
  console.log('  ✗ Timeout waiting for messages');
  process.exit(1);
}, 5000);
" 2>&1 && pass "WebSocket subscribe/unsubscribe cycle" || fail "WebSocket" "connection or message mismatch"

echo ""
echo "========================================"
echo " Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "========================================"

exit $FAIL
