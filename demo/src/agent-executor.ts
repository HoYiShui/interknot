/**
 * Agent Executor — a pi-agent instance that watches for commissions,
 * bids on them, receives tasks via Irys, executes them, and returns results.
 *
 * Usage:
 *   ENV_FILE=.agent.env \
 *   SYSTEM_PROMPT_FILE=demo/prompts/executor.md \
 *   KEYPAIR=/tmp/ik-b.json \
 *   BID_PRICE=0.003 \
 *   pnpm --dir demo exec tsx src/agent-executor.ts
 *
 * ENV_FILE            Path to a KEY=VALUE file containing ANTHROPIC_API_KEY (default: .agent.env)
 * SYSTEM_PROMPT_FILE  Path to the system prompt template (default: demo/prompts/executor.md)
 *                     Placeholders: {{KEYPAIR}}, {{BID_PRICE}}, {{TASK_TYPE}}
 * BID_PRICE           Bid price in USDC (default: 0.005)
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load env file ─────────────────────────────────────────────────
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

const ENV_FILE = process.env.ENV_FILE ?? resolve(process.cwd(), ".agent.env");
loadEnvFile(ENV_FILE);

// ── Config ────────────────────────────────────────────────────────
const KEYPAIR = process.env.KEYPAIR ?? "~/.config/solana/id.json";
const MODEL = process.env.MODEL ?? "claude-sonnet-4-20250514";
const TASK_TYPE = process.env.TASK_TYPE ?? "compute/llm-inference";
const BID_PRICE = process.env.BID_PRICE ?? "0.005";

// ── Validate required config ──────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is not set.");
  console.error(`  Looked for ENV_FILE: ${ENV_FILE}`);
  console.error("  Create .agent.env from .agent.env.example and fill in your API key.");
  process.exit(1);
}

// ── Load system prompt ────────────────────────────────────────────
const DEFAULT_PROMPT_FILE = resolve(__dirname, "../prompts/executor.md");
const SYSTEM_PROMPT_FILE = process.env.SYSTEM_PROMPT_FILE ?? DEFAULT_PROMPT_FILE;

function loadSystemPrompt(): string {
  const raw = readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
  return raw
    .replaceAll("{{KEYPAIR}}", KEYPAIR)
    .replaceAll("{{BID_PRICE}}", BID_PRICE)
    .replaceAll("{{TASK_TYPE}}", TASK_TYPE);
}

const SYSTEM_PROMPT = loadSystemPrompt();

// ── Bash tool ─────────────────────────────────────────────────────
const bashTool = {
  name: "bash",
  label: "Bash",
  description: "Execute a shell command and return the output",
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
  }),
  execute: async (
    _toolCallId: string,
    params: { command: string },
    _signal?: AbortSignal,
  ) => {
    try {
      const output = execSync(params.command, {
        encoding: "utf-8",
        timeout: 200000,
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH },
      });
      return {
        content: [{ type: "text" as const, text: output }],
        details: {},
      };
    } catch (err: any) {
      throw new Error(err.stderr || err.stdout || err.message);
    }
  },
};

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log("=== Inter-Knot Executor Agent ===");
  console.log(`  Task type: ${TASK_TYPE}`);
  console.log(`  Bid price: $${BID_PRICE} USDC`);
  console.log(`  Keypair:   ${KEYPAIR}`);
  console.log(`  Prompt:    ${SYSTEM_PROMPT_FILE}`);
  console.log();

  const model = getModel("anthropic", MODEL as any);
  if (!model) {
    throw new Error(`Unknown model "${MODEL}" for provider "anthropic". Check MODEL in .agent.env.`);
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    (model as any).baseUrl = process.env.ANTHROPIC_BASE_URL;
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: [bashTool],
      thinkingLevel: "low",
    },
  });

  agent.subscribe((event: any) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "agent_end") {
      const errMsg = event.messages?.find((m: any) => m.stopReason === "error")?.errorMessage;
      if (errMsg) {
        console.error(`\nAgent error: ${errMsg}`);
      }
    }
  });

  await agent.prompt(
    `Start watching for open commissions of type "${TASK_TYPE}" and execute the full executor workflow.`
  );

  const agentError = (agent as any)._state?.error;
  if (agentError) {
    throw new Error(`Agent failed: ${agentError}`);
  }

  console.log("\n\n=== Executor Agent Complete ===");
}

main().catch((err) => {
  console.error("Agent error:", err);
  process.exit(1);
});
