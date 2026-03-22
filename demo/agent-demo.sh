#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Inter-Knot 3-Agent Competitive Demo
#
# Three autonomous AI agents on devnet:
#   Agent A (Delegator)  — creates commission, selects lowest bid,
#                          sends task via Irys, retrieves result
#   Agent B (Executor)   — bids 0.003 USDC, executes if selected
#   Agent C (Executor)   — bids 0.007 USDC, exits cleanly if not selected
#
# Expected outcome:
#   B wins (lower price), C exits gracefully after selection check.
#
# Artifacts written to /tmp/ik-demo-*/
#
# Prerequisites:
#   pnpm --dir demo demo:setup   (fund wallets, deploy program)
#   export ANTHROPIC_API_KEY=sk-ant-...
#
# Usage:
#   TASK_PROMPT="Explain quantum computing in one sentence." \
#     ./demo/agent-demo.sh
# ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$SCRIPT_DIR"
WALLETS_FILE="$DEMO_DIR/.demo-wallets.json"

# ── Pre-flight checks ─────────────────────────────────────────────
if [ ! -f "$WALLETS_FILE" ]; then
  echo "Error: $WALLETS_FILE not found."
  echo "  Run: pnpm --dir demo demo:setup"
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Error: ANTHROPIC_API_KEY is not set."
  echo "  export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

TASK_PROMPT="${TASK_PROMPT:-Explain what a blockchain is in two sentences.}"

# ── Log directory ─────────────────────────────────────────────────
LOG_DIR="/tmp/ik-demo-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

AGENT_A_LOG="$LOG_DIR/agent-a-delegator.log"
AGENT_B_LOG="$LOG_DIR/agent-b-executor.log"
AGENT_C_LOG="$LOG_DIR/agent-c-executor.log"

echo "══════════════════════════════════════════════════════════"
echo "  Inter-Knot 3-Agent Competitive Demo"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  Task:    $TASK_PROMPT"
echo "  Logs:    $LOG_DIR"
echo ""
echo "  Agent A  (Delegator)  — selects lowest bid"
echo "  Agent B  (Executor)   — bids \$0.003 USDC  <- expected winner"
echo "  Agent C  (Executor)   — bids \$0.007 USDC"
echo ""

# ── Write keypairs to tmp files ───────────────────────────────────
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const walletsFile = process.env.WALLETS_FILE;
const w = JSON.parse(readFileSync(walletsFile, "utf-8"));
writeFileSync("/tmp/ik-agent-a-kp.json", JSON.stringify(w.agentA));
writeFileSync("/tmp/ik-agent-b-kp.json", JSON.stringify(w.agentB));
writeFileSync("/tmp/ik-agent-c-kp.json", JSON.stringify(w.agentC));
console.log("  Keypairs written to /tmp/ik-agent-{a,b,c}-kp.json");
EOF

# ── Cleanup ───────────────────────────────────────────────────────
EXECUTOR_B_PID=""
EXECUTOR_C_PID=""

cleanup() {
  echo ""
  echo "[cleanup] Stopping background agents..."
  [ -n "$EXECUTOR_B_PID" ] && kill "$EXECUTOR_B_PID" 2>/dev/null || true
  [ -n "$EXECUTOR_C_PID" ] && kill "$EXECUTOR_C_PID" 2>/dev/null || true
  rm -f /tmp/ik-agent-a-kp.json /tmp/ik-agent-b-kp.json /tmp/ik-agent-c-kp.json
  echo ""
  echo "══════════════════════════════════════════════════════════"
  echo "  Demo finished. Artifacts:"
  echo "    Delegator log:  $AGENT_A_LOG"
  echo "    Executor B log: $AGENT_B_LOG"
  echo "    Executor C log: $AGENT_C_LOG"
  echo ""
  echo "  To review executor logs:"
  echo "    cat $AGENT_B_LOG"
  echo "    cat $AGENT_C_LOG"
  echo "══════════════════════════════════════════════════════════"
}
trap cleanup EXIT INT TERM

# ── Start Agent C (higher bid, background) ────────────────────────
echo "[1/3] Starting Agent C (Executor, \$0.007 USDC) in background..."
WALLETS_FILE="$WALLETS_FILE" \
  KEYPAIR="/tmp/ik-agent-c-kp.json" \
  BID_PRICE="0.007" \
  TASK_TYPE="compute/llm-inference" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pnpm --dir "$DEMO_DIR" exec tsx src/agent-executor.ts \
  > "$AGENT_C_LOG" 2>&1 &
EXECUTOR_C_PID=$!
echo "  PID $EXECUTOR_C_PID -> $AGENT_C_LOG"

# ── Start Agent B (lower bid, background) ────────────────────────
echo "[2/3] Starting Agent B (Executor, \$0.003 USDC) in background..."
WALLETS_FILE="$WALLETS_FILE" \
  KEYPAIR="/tmp/ik-agent-b-kp.json" \
  BID_PRICE="0.003" \
  TASK_TYPE="compute/llm-inference" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pnpm --dir "$DEMO_DIR" exec tsx src/agent-executor.ts \
  > "$AGENT_B_LOG" 2>&1 &
EXECUTOR_B_PID=$!
echo "  PID $EXECUTOR_B_PID -> $AGENT_B_LOG"

# Give executors a 5s head start so they're watching before commission is created
echo ""
echo "  Giving executors 5s head start..."
sleep 5

# ── Start Agent A (delegator, foreground) ────────────────────────
echo ""
echo "[3/3] Starting Agent A (Delegator) — running in foreground..."
echo "──────────────────────────────────────────────────────────"
echo ""

WALLETS_FILE="$WALLETS_FILE" \
  KEYPAIR="/tmp/ik-agent-a-kp.json" \
  TASK_PROMPT="$TASK_PROMPT" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pnpm --dir "$DEMO_DIR" exec tsx src/agent-delegator.ts \
  2>&1 | tee "$AGENT_A_LOG"

echo ""
echo "──────────────────────────────────────────────────────────"
echo "  Agent A complete. Waiting 10s for executors to finish..."
sleep 10
