/**
 * Agent Delegator — a pi-agent instance that autonomously creates commissions,
 * selects bids, sends tasks via Irys, and retrieves results.
 *
 * Usage:
 *   ENV_FILE=.agent.env \
 *   SYSTEM_PROMPT_FILE=demo/prompts/delegator.md \
 *   KEYPAIR=/tmp/ik-a.json \
 *   TASK_PROMPT="Explain quantum computing in one sentence." \
 *   pnpm --dir demo exec tsx src/agent-delegator.ts
 *
 * ENV_FILE       Path to a KEY=VALUE file containing ANTHROPIC_API_KEY (default: .agent.env)
 * SYSTEM_PROMPT_FILE  Path to the system prompt template (default: demo/prompts/delegator.md)
 *                     Placeholders: {{KEYPAIR}}, {{TASK_PROMPT}}
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
const TASK_PROMPT = process.env.TASK_PROMPT ?? "Translate to Japanese: Hello, how are you today?";
const MODEL = process.env.MODEL ?? "claude-sonnet-4-20250514";

// ── Load system prompt ────────────────────────────────────────────
const DEFAULT_PROMPT_FILE = resolve(__dirname, "../prompts/delegator.md");
const SYSTEM_PROMPT_FILE = process.env.SYSTEM_PROMPT_FILE ?? DEFAULT_PROMPT_FILE;

function loadSystemPrompt(): string {
  const raw = readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
  return raw
    .replaceAll("{{KEYPAIR}}", KEYPAIR)
    .replaceAll("{{TASK_PROMPT}}", TASK_PROMPT);
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
  console.log("=== Inter-Knot Delegator Agent ===");
  console.log(`Task:    ${TASK_PROMPT}`);
  console.log(`Keypair: ${KEYPAIR}`);
  console.log(`Prompt:  ${SYSTEM_PROMPT_FILE}`);
  console.log();

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: getModel("anthropic", MODEL as any),
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
  });

  await agent.prompt(
    `Please execute the full delegator workflow for this task: "${TASK_PROMPT}"`
  );

  console.log("\n\n=== Delegator Agent Complete ===");
}

main().catch((err) => {
  console.error("Agent error:", err);
  process.exit(1);
});
