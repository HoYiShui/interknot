/**
 * Agent Executor — a pi-agent instance that watches for commissions,
 * bids on them, receives tasks via Irys, executes them, and returns results.
 *
 * Usage: ANTHROPIC_API_KEY=... KEYPAIR=<path> tsx src/agent-executor.ts
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";

const KEYPAIR = process.env.KEYPAIR ?? "~/.config/solana/id.json";
const MODEL = process.env.MODEL ?? "claude-sonnet-4-20250514";
const TASK_TYPE = process.env.TASK_TYPE ?? "compute/llm-inference";

const SYSTEM_PROMPT = `You are an Inter-Knot executor agent. Your job is to watch for computation tasks on the Inter-Knot protocol, bid on them, execute the task when selected, and return the result.

You have a bash tool to execute inter-knot CLI commands. Your keypair is at: ${KEYPAIR}

Available commands:
  inter-knot commission list --task-type <type> --wait --timeout 180 --keypair ${KEYPAIR}
  inter-knot bid submit <commission-id> --price <usdc> --delivery-method irys --keypair ${KEYPAIR}
  inter-knot msg inbox --keypair ${KEYPAIR}
  inter-knot msg get <commission-id> --wait --timeout 180 --keypair ${KEYPAIR}
  inter-knot msg send <commission-id> --file <path> --keypair ${KEYPAIR}

Your workflow:
1. Run "commission list --task-type ${TASK_TYPE} --wait --timeout 180" — it blocks until an open commission appears (no polling needed)
2. Submit a competitive bid (price: 0.005 USDC, delivery method: irys)
3. Run "msg get <commission-id> --wait --timeout 180" — it blocks until the input arrives (no polling needed)
4. Execute the task: for LLM inference tasks, generate a thoughtful response to the prompt
5. Write the response to a temp file (/tmp/result-<commission-id>.txt)
6. Send the result back via "msg send <commission-id> --file <path>"
7. Print a summary showing: commission ID, task received, result sent

Important rules:
- Always include --keypair ${KEYPAIR} in every command
- Use the bash tool for all operations
- The --wait flag blocks until the event arrives; do NOT manually poll or sleep
- When the task is an LLM prompt, YOU are the LLM — generate the response yourself
- Be concise and professional in your responses`;

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
  console.log("=== Inter-Knot Executor Agent ===");
  console.log(`Watching for: ${TASK_TYPE}`);
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
    `Start watching for open commissions of type "${TASK_TYPE}" and execute the full executor workflow.`
  );

  console.log("\n\n=== Executor Agent Complete ===");
}

main().catch((err) => {
  console.error("Agent error:", err);
  process.exit(1);
});
