/**
 * Agent Delegator — a pi-agent instance that autonomously creates commissions,
 * selects bids, sends tasks via Irys, and retrieves results.
 *
 * Usage:
 *   SYSTEM_PROMPT_FILE=demo/prompts/delegator.md \
 *   MODEL_PROVIDER=openai \
 *   MODEL=gpt-5.3-codex \
 *   KEYPAIR=/tmp/ik-a.json \
 *   TASK_PROMPT="Explain quantum computing in one sentence." \
 *   pnpm --dir demo exec tsx src/agent-delegator.ts
 *
 * ENV_FILE       Path to a KEY=VALUE env file (default: .agent.env)
 * SYSTEM_PROMPT_FILE  Path to the system prompt template (default: demo/prompts/delegator.md)
 *                     Placeholders: {{KEYPAIR}}, {{TASK_PROMPT}}
 * MODEL_PROVIDER      Model provider, e.g. anthropic or openai (default: anthropic)
 * MODEL               Model ID for the chosen provider (default depends on provider)
 * BASE_URL            Optional provider base URL override (e.g. proxy endpoint)
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
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

const DEFAULT_ENV_FILE = resolve(__dirname, "../../.agent.env");
const ENV_FILE = (() => {
  if (!process.env.ENV_FILE) return DEFAULT_ENV_FILE;
  const fromCwd = resolve(process.cwd(), process.env.ENV_FILE);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRepoRoot = resolve(__dirname, "../../", process.env.ENV_FILE);
  if (existsSync(fromRepoRoot)) return fromRepoRoot;
  return fromCwd;
})();
loadEnvFile(ENV_FILE);

// ── Config ────────────────────────────────────────────────────────
const KEYPAIR = process.env.KEYPAIR ?? "~/.config/solana/id.json";
const TASK_PROMPT = process.env.TASK_PROMPT ?? "Translate to Japanese: Hello, how are you today?";
const MODEL_PROVIDER = process.env.MODEL_PROVIDER ?? process.env.PROVIDER ?? "anthropic";
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-5.3-codex",
};
const MODEL = process.env.MODEL ?? DEFAULT_MODEL_BY_PROVIDER[MODEL_PROVIDER] ?? "claude-sonnet-4-20250514";

// ── Validate required config ──────────────────────────────────────
const REQUIRED_API_KEY_ENV_BY_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};
const requiredApiKeyEnv = REQUIRED_API_KEY_ENV_BY_PROVIDER[MODEL_PROVIDER];
if (requiredApiKeyEnv && !process.env[requiredApiKeyEnv]) {
  console.error(`Error: ${requiredApiKeyEnv} is not set for provider "${MODEL_PROVIDER}".`);
  console.error(`  Looked for ENV_FILE: ${ENV_FILE}`);
  console.error("  Create .agent.env from .agent.env.example and fill in your API key.");
  process.exit(1);
}

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
  execute: (
    _toolCallId: string,
    params: { command: string },
    _signal?: AbortSignal,
  ) => new Promise<{ content: { type: "text"; text: string }[]; details: {} }>((resolve, reject) => {
    const child = spawn("sh", ["-c", params.command], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: process.env.PATH, NODE_NO_WARNINGS: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stderr.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after 200s: ${params.command}`));
    }, 200000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Command exited with code ${code}`));
      } else {
        resolve({ content: [{ type: "text" as const, text: stdout }], details: {} });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  }),
};

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const baseUrlOverride =
    process.env.BASE_URL ||
    (MODEL_PROVIDER === "anthropic" ? process.env.ANTHROPIC_BASE_URL : undefined) ||
    (MODEL_PROVIDER === "openai" ? process.env.OPENAI_BASE_URL : undefined);

  console.log("=== Inter-Knot Delegator Agent ===");
  console.log(`Provider: ${MODEL_PROVIDER}`);
  console.log(`Model:    ${MODEL}`);
  console.log(`Task:    ${TASK_PROMPT}`);
  console.log(`Keypair: ${KEYPAIR}`);
  console.log(`Prompt:  ${SYSTEM_PROMPT_FILE}`);
  if (baseUrlOverride) {
    console.log(`Base URL: ${baseUrlOverride}`);
  }
  console.log();

  const model = getModel(MODEL_PROVIDER as any, MODEL as any);
  if (!model) {
    throw new Error(`Unknown model "${MODEL}" for provider "${MODEL_PROVIDER}". Check MODEL_PROVIDER/MODEL in .agent.env.`);
  }
  if (baseUrlOverride) {
    (model as any).baseUrl = baseUrlOverride;
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
    `Please execute the full delegator workflow for this task: "${TASK_PROMPT}"`
  );

  const agentError = (agent as any)._state?.error;
  if (agentError) {
    throw new Error(`Agent failed: ${agentError}`);
  }

  console.log("\n\n=== Delegator Agent Complete ===");
}

main().catch((err) => {
  console.error("Agent error:", err);
  process.exit(1);
});
