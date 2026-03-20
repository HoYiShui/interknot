#!/usr/bin/env bash
# Inter-Knot Real Demo
# One-command end-to-end demo using Ollama for real LLM inference.
#
# Prerequisites:
#   - Ollama installed and running: https://ollama.com
#   - Model pulled: ollama pull llama3.1:8b
#   - devnet USDC in Agent A's wallet (run setup first to get the address)
#   - Get USDC: https://spl-token-faucet.com/?token-name=USDC-Dev
#
# Usage: ./demo/real-demo.sh
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
pnpm build:sdk && pnpm build:cli
echo ""

# 2. Setup (generates wallets, airdrops SOL, checks USDC)
echo "[setup] Running demo setup..."
pnpm --dir demo setup
echo ""

# 3. Start Agent B with real Ollama handler
echo "[agent-b] Starting executor (Ollama/real mode)..."
pnpm --dir demo agent-b --real &
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

# 4. Run Agent A
echo "[agent-a] Running delegator flow..."
pnpm --dir demo agent-a

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ Real Demo Complete"
echo "══════════════════════════════════════════════════"
echo ""
