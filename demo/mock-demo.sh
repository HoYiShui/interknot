#!/usr/bin/env bash
# Inter-Knot Mock Demo
# One-command end-to-end demo using the mock task handler (no GPU required).
#
# Usage: ./demo/mock-demo.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "══════════════════════════════════════════════════"
echo "  Inter-Knot Mock Demo"
echo "  Full on-chain + x402 flow, no GPU required"
echo "══════════════════════════════════════════════════"
echo ""

# 1. Build
echo "[build] Building SDK and CLI..."
pnpm build
echo ""

# 2. Setup
echo "[setup] Running demo setup (wallets + SOL airdrop)..."
pnpm --dir demo setup
echo ""

# 3. Start Agent B in background
echo "[agent-b] Starting executor (mock mode) in background..."
pnpm --dir demo agent-b &
AGENT_B_PID=$!
echo "  Agent B PID: $AGENT_B_PID"
echo "  Waiting 5s for server to start..."
sleep 5
echo ""

# 4. Run Agent A (full delegator flow)
echo "[agent-a] Running delegator flow..."
pnpm --dir demo agent-a

# 5. Cleanup
echo ""
echo "[cleanup] Stopping Agent B..."
kill $AGENT_B_PID 2>/dev/null || true

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ Mock Demo Complete"
echo "══════════════════════════════════════════════════"
echo ""
