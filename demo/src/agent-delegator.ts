/**
 * Agent Delegator — a pi-agent instance that autonomously creates commissions,
 * selects bids, sends tasks via Irys, and retrieves results.
 *
 * Usage: ANTHROPIC_API_KEY=... KEYPAIR=<path> TASK_PROMPT="<prompt>" tsx src/agent-delegator.ts
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const KEYPAIR = process.env.KEYPAIR ?? "~/.config/solana/id.json";
const TASK_PROMPT = process.env.TASK_PROMPT ?? "Translate to Japanese: Hello, how are you today?";
const MODEL = process.env.MODEL ?? "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are an Inter-Knot delegator agent. Your job is to publish computation tasks on the Inter-Knot protocol, find the best executor, send them the task, and retrieve the result.

You have a bash tool to execute inter-knot CLI commands. Your keypair is at: ${KEYPAIR}

Available commands:
  inter-knot commission create --task-type <type> --spec '<json>' --max-price <usdc> --deadline <duration> --keypair ${KEYPAIR}
  inter-knot bid list <commission-id> --wait --timeout 120 --keypair ${KEYPAIR}
  inter-knot match select <commission-id> <executor-pubkey> --keypair ${KEYPAIR}
  inter-knot msg send <commission-id> --file <path> --keypair ${KEYPAIR}
  inter-knot msg get <commission-id> --wait --timeout 120 --keypair ${KEYPAIR}
  inter-knot commission complete <commission-id> --keypair ${KEYPAIR}

Your workflow:
1. Create a commission for task type "compute/llm-inference" with spec '{"model":"llama-3-8b","maxTokens":512}', max price 0.10 USDC and deadline 10m
2. Run "bid list <commission-id> --wait --timeout 120" — it blocks until at least 1 bid appears (no polling needed)
3. Select the lowest-priced bid
4. Write the task prompt to a temp file, then send it via "msg send"
5. Run "msg get <commission-id> --wait --timeout 120" — it blocks until the output is available (no polling needed)
6. Print the result and mark the commission as completed

Important rules:
- Always include --keypair ${KEYPAIR} in every command
- Use the bash tool for all operations
- When writing the task prompt to a file, use /tmp/
- The --wait flag blocks until the event arrives; do NOT manually poll or sleep
- Print a clear summary at the end showing: commission ID, executor, price, and result`;

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

async function main() {
  console.log("=== Inter-Knot Delegator Agent ===");
  console.log(`Task: ${TASK_PROMPT}`);
  console.log(`Keypair: ${KEYPAIR}`);
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
