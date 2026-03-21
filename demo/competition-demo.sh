#!/usr/bin/env bash
# Inter-Knot Competition Demo
# Three-agent demo: Agent B ($0.001433) and Agent C ($0.05) compete;
# Agent A selects the lowest-priced bid.
#
# Prerequisites:
#   - devnet USDC in Agent A's wallet (run setup first)
#   - Get USDC: https://faucet.circle.com (select Solana → Devnet)
#
# Usage: ./demo/competition-demo.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

AGENT_B_PID=""
AGENT_C_PID=""

cleanup() {
  if [ -n "$AGENT_B_PID" ]; then
    echo ""
    echo "[cleanup] Stopping Agent B (PID $AGENT_B_PID)..."
    kill "$AGENT_B_PID" 2>/dev/null || true
  fi
  if [ -n "$AGENT_C_PID" ]; then
    echo "[cleanup] Stopping Agent C (PID $AGENT_C_PID)..."
    kill "$AGENT_C_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo ""
echo "══════════════════════════════════════════════════"
echo "  Inter-Knot Competition Demo"
echo "  Agent B (\$0.001433) vs Agent C (\$0.05)"
echo "══════════════════════════════════════════════════"
echo ""

# 1. Build
echo "[build] Building SDK and CLI..."
pnpm build:sdk && pnpm build:cli
echo ""

# 2. Setup
echo "[setup] Running demo setup..."
pnpm --dir demo demo:setup
echo ""

# 3. Start Agent B (lower price)
echo "[agent-b] Starting executor B @ \$0.001433 USDC (port 8080)..."
pnpm --dir demo agent-b &
AGENT_B_PID=$!

echo "  Waiting for Agent B server..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo "  ✓ Agent B ready (${i}s)"
    break
  fi
  sleep 1
done
echo ""

# 4. Start Agent C (higher price)
echo "[agent-c] Starting executor C @ \$0.05 USDC (port 8081)..."
pnpm --dir demo agent-c &
AGENT_C_PID=$!

echo "  Waiting for Agent C server..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8081/health > /dev/null 2>&1; then
    echo "  ✓ Agent C ready (${i}s)"
    break
  fi
  sleep 1
done
echo ""

# 5. Run Agent A (should see 2 bids, pick the cheaper one)
echo "[agent-a] Running delegator flow (expecting 2+ bids)..."
MIN_BIDS=2 pnpm --dir demo agent-a

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ Competition Demo Complete"
echo "══════════════════════════════════════════════════"
echo ""
