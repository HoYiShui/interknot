#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────
# Inter-Knot Agent Demo
# Two autonomous AI agents trading tasks on Solana
# ──────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$SCRIPT_DIR"
WALLETS_FILE="$DEMO_DIR/.demo-wallets.json"

if [ ! -f "$WALLETS_FILE" ]; then
  echo "Error: $WALLETS_FILE not found. Run 'pnpm --dir demo setup' first."
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Error: ANTHROPIC_API_KEY is not set."
  echo "  export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

# Extract keypair paths from wallet file
AGENT_A_KP=$(node -e "const w=JSON.parse(require('fs').readFileSync('$WALLETS_FILE','utf8')); process.stdout.write('/tmp/agent-a-kp.json')")
AGENT_B_KP=$(node -e "const w=JSON.parse(require('fs').readFileSync('$WALLETS_FILE','utf8')); process.stdout.write('/tmp/agent-b-kp.json')")

# Write keypair files (demo wallets are stored as number[] arrays directly)
node -e "
const w = JSON.parse(require('fs').readFileSync('$WALLETS_FILE','utf8'));
require('fs').writeFileSync('/tmp/agent-a-kp.json', JSON.stringify(w.agentA));
require('fs').writeFileSync('/tmp/agent-b-kp.json', JSON.stringify(w.agentB));
"

TASK_PROMPT="${TASK_PROMPT:-Translate to Japanese: Hello, how are you today?}"

echo "══════════════════════════════════════════════════"
echo "  Inter-Knot Agent Demo"
echo "  Two AI agents autonomously trading tasks"
echo "══════════════════════════════════════════════════"
echo ""
echo "Agent A (Delegator): will create a commission and send a task"
echo "Agent B (Executor):  will bid, receive, execute, and return result"
echo "Task: $TASK_PROMPT"
echo ""

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up..."
  [ -n "${EXECUTOR_PID:-}" ] && kill "$EXECUTOR_PID" 2>/dev/null || true
  rm -f /tmp/agent-a-kp.json /tmp/agent-b-kp.json
}
trap cleanup EXIT INT TERM

# 1. Start executor agent in background
echo "[1] Starting executor agent (Agent B)..."
KEYPAIR="$AGENT_B_KP" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pnpm --dir "$DEMO_DIR" exec tsx src/agent-executor.ts \
  > /tmp/executor-agent.log 2>&1 &
EXECUTOR_PID=$!
echo "  PID: $EXECUTOR_PID (log: /tmp/executor-agent.log)"

# Give executor a head start to begin watching
sleep 3

# 2. Start delegator agent in foreground
echo "[2] Starting delegator agent (Agent A)..."
echo ""
KEYPAIR="$AGENT_A_KP" \
  TASK_PROMPT="$TASK_PROMPT" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pnpm --dir "$DEMO_DIR" exec tsx src/agent-delegator.ts

echo ""
echo "══════════════════════════════════════════════════"
echo "  Agent Demo Complete"
echo "══════════════════════════════════════════════════"
echo ""
echo "Executor log: /tmp/executor-agent.log"
echo ""
echo "To view executor output:"
echo "  cat /tmp/executor-agent.log"
