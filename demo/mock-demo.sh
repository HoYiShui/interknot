#!/usr/bin/env bash
# Inter-Knot Mock Demo
# One-command end-to-end demo using the mock task handler (no GPU required).
#
# Prerequisites:
#   - devnet USDC in Agent A's wallet (run setup first to get the address)
#   - Get USDC: https://spl-token-faucet.com/?token-name=USDC-Dev
#
# Usage: ./demo/mock-demo.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

AGENT_B_PID=""

cleanup() {
  if [ -n "$AGENT_B_PID" ]; then
    echo ""
    echo "[cleanup] Stopping Agent B (PID $AGENT_B_PID)..."
    kill "$AGENT_B_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo ""
echo "══════════════════════════════════════════════════"
echo "  Inter-Knot Mock Demo"
echo "  Full on-chain + x402 flow, no GPU required"
echo "══════════════════════════════════════════════════"
echo ""

# 1. Build
echo "[build] Building SDK and CLI..."
pnpm build:sdk && pnpm build:cli
echo ""

# 2. Setup (generates wallets, airdrops SOL, checks USDC)
echo "[setup] Running demo setup..."
pnpm --dir demo setup
echo ""

# 3. Start Agent B in background
echo "[agent-b] Starting executor (mock mode)..."
pnpm --dir demo agent-b &
AGENT_B_PID=$!

# Poll /health instead of sleeping blindly (timeout 30s)
echo "  Waiting for task server to be ready..."
READY=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo "  ✓ Task server ready (${i}s)"
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -eq 0 ]; then
  echo "  ✗ Task server did not start within 30s. Check Agent B logs."
  exit 1
fi
echo ""

# 4. Run Agent A (full delegator flow)
echo "[agent-a] Running delegator flow..."
pnpm --dir demo agent-a

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ Mock Demo Complete"
echo "══════════════════════════════════════════════════"
echo ""
