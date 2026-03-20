/**
 * Agent B — Executor
 *
 * 1. Starts an x402 task server on port 8080
 * 2. Watches on-chain for open commissions of type compute/llm-inference
 * 3. Estimates price and submits a bid automatically
 * 4. Serves tasks when paid (mock or Ollama depending on --real flag)
 *
 * Run: pnpm --dir demo agent-b [--real]
 */
import { Connection } from "@solana/web3.js";
import {
  InterKnot,
  startTaskServer,
  OllamaTaskHandler,
  estimateComputeCost,
} from "@inter-knot/sdk";
import {
  RPC,
  PROGRAM_ID,
  EXECUTOR_PORT,
  EXECUTOR_ENDPOINT,
  TASK_TYPE,
  loadWallets,
  sleep,
  banner,
  ok,
} from "./config.js";

const useReal = process.argv.includes("--real");

async function main() {
  banner(`Agent B — Executor (${useReal ? "Ollama/real" : "Mock"} mode)`);

  const { agentB: wallet } = loadWallets();
  const connection = new Connection(RPC, "confirmed");

  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  Mode:   ${useReal ? "Ollama (real inference)" : "Mock (simulated)"}`);
  console.log("");

  // Step 1: Start x402 task server
  const estimate = estimateComputeCost({ model: "llama-3-8b", maxTokens: 512 });
  const price = estimate.suggestedPrice.toFixed(6);
  console.log(`[1] Starting task server on port ${EXECUTOR_PORT} @ $${price} USDC...`);

  const serverOpts: Parameters<typeof startTaskServer>[0] = {
    wallet,
    port: EXECUTOR_PORT,
    price,
  };
  if (useReal) {
    serverOpts.handler = new OllamaTaskHandler();
  }
  await startTaskServer(serverOpts);
  ok(`Task server running at ${EXECUTOR_ENDPOINT}`);

  // Step 2: Watch for new commissions and auto-bid
  console.log("\n[2] Watching for open commissions...\n");

  const client = new InterKnot({ connection, wallet, programId: PROGRAM_ID });
  const seen = new Set<number>();

  const { stop } = client.commission.watch({
    taskType: TASK_TYPE,
    pollIntervalMs: 3000,
    onNew: async (commission) => {
      if (seen.has(commission.commissionId)) return;
      seen.add(commission.commissionId);

      console.log(`  → New commission #${commission.commissionId} detected`);
      console.log(`    Task type: ${commission.taskType}`);
      console.log(`    Max price: ${commission.maxPrice.toNumber() / 1_000_000} USDC`);

      // Estimate pricing and check if it's worth bidding
      const priceEst = estimateComputeCost({ model: "llama-3-8b", maxTokens: 512 });
      const bidPrice = parseFloat(price); // use the auto-priced value from serve

      if (priceEst.suggestedPrice > commission.maxPrice.toNumber() / 1_000_000) {
        console.log(`    ✗ Max price too low, skipping`);
        return;
      }

      console.log(`    Bidding $${bidPrice} USDC → ${EXECUTOR_ENDPOINT}`);
      try {
        const { txSignature } = await client.bid.submit(commission.commissionId, {
          price: bidPrice,
          serviceEndpoint: EXECUTOR_ENDPOINT,
        });
        ok(`Bid submitted — tx: ${txSignature.slice(0, 16)}...`);
      } catch (e: any) {
        console.log(`    ✗ Bid failed: ${e.message}`);
      }
    },
  });

  console.log("  Waiting for commissions... (Ctrl+C to stop)\n");

  process.on("SIGINT", () => {
    console.log("\nStopping Agent B...");
    stop();
    process.exit(0);
  });

  // Keep alive
  while (true) {
    await sleep(10_000);
  }
}

main().catch((err) => {
  console.error("✗ Agent B failed:", err.message ?? err);
  process.exit(1);
});
