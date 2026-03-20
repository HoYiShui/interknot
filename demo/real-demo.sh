#!/usr/bin/env bash
# Inter-Knot Real Demo
# One-command end-to-end demo using Ollama for real LLM inference.
#
# Prerequisites:
#   - Ollama installed and running: https://ollama.com
#   - Model pulled: ollama pull llama3.1:8b
#   - devnet USDC in Agent A's wallet (from faucet or transfer)
#
# Usage: ./demo/real-demo.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "══════════════════════════════════════════════════"
echo "  Inter-Knot Real Demo (Ollama)"
echo "  Full on-chain + x402 + real LLM inference"
echo "══════════════════════════════════════════════════"
echo ""

# Check Ollama is reachable
echo "[check] Verifying Ollama is running..."
if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "  ✗ Ollama not reachable at http://localhost:11434"
  echo "    Install: https://ollama.com"
  echo "    Start:   ollama serve"
  exit 1
fi
echo "  ✓ Ollama is running"
echo ""

# 1. Build
echo "[build] Building SDK and CLI..."
pnpm build
echo ""

# 2. Setup
echo "[setup] Running demo setup (wallets + SOL airdrop)..."
pnpm --dir demo setup
echo ""

# 3. Start Agent B with real Ollama handler
echo "[agent-b] Starting executor (Ollama/real mode) in background..."
pnpm --dir demo agent-b --real &
AGENT_B_PID=$!
echo "  Agent B PID: $AGENT_B_PID"
echo "  Waiting 5s for server to start..."
sleep 5
echo ""

# 4. Run Agent A
echo "[agent-a] Running delegator flow..."
pnpm --dir demo agent-a

# 5. Cleanup
echo ""
echo "[cleanup] Stopping Agent B..."
kill $AGENT_B_PID 2>/dev/null || true

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ Real Demo Complete"
echo "══════════════════════════════════════════════════"
echo ""
