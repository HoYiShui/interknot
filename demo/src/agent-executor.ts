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
const BID_PRICE = process.env.BID_PRICE ?? "0.005";

const SYSTEM_PROMPT = `You are an Inter-Knot executor agent. Your job is to watch for computation tasks on the Inter-Knot protocol, bid on them, execute the task when selected, and return the result.

You have a bash tool to execute inter-knot CLI commands. Your keypair is at: ${KEYPAIR}

Available commands:
  inter-knot commission list --task-type <type> --wait --timeout 180 --keypair ${KEYPAIR}
  inter-knot bid submit <commission-id> --price <usdc> --delivery-method irys --keypair ${KEYPAIR}
  inter-knot msg get <commission-id> --wait --timeout 120 --keypair ${KEYPAIR}
  inter-knot msg send <commission-id> --file <path> --keypair ${KEYPAIR}

Your workflow:
1. Run "commission list --task-type ${TASK_TYPE} --wait --timeout 180" — it blocks until an open commission appears. Note the commission ID.
2. Submit a bid: "bid submit <commission-id> --price ${BID_PRICE} --delivery-method irys"
3. Wait 90 seconds for the delegator to select a bid (use bash: sleep 90).
4. Try "msg get <commission-id> --wait --timeout 120":
   - If it SUCCEEDS and returns decrypted content: you were selected! Proceed to step 5.
   - If it FAILS with an error containing "not the selected executor" or "not the delegator": you were not selected. Print "Not selected for commission <id>. Exiting cleanly." and stop.
   - If it FAILS with any other error: print the error and stop.
5. Execute the task: for LLM inference tasks, generate a thoughtful response to the prompt content received.
6. Write the response to /tmp/result-<commission-id>.txt using bash.
7. Send the result: "msg send <commission-id> --file /tmp/result-<commission-id>.txt"
8. Print a summary: commission ID, bid price, whether selected, result sent.

Important rules:
- Always include --keypair ${KEYPAIR} in every command
- Use the bash tool for all operations
- When not selected, exit cleanly with a clear message — do NOT retry or bid again
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
  console.log(`  Bid price: $${BID_PRICE} USDC`);
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
