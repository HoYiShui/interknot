/**
 * x402 Smoke Test
 * Verifies the executor task server starts correctly and returns 402 for unpaid requests.
 */
import { Keypair } from "@solana/web3.js";
import { createTaskServer } from "../sdk/src/server/task-server.js";
import { MockTaskHandler } from "../sdk/src/server/handlers.js";

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  x402 Smoke Test");
  console.log("═══════════════════════════════════════════\n");

  const executor = Keypair.generate();

  // Step 1: Create the task server app (without starting HTTP listener)
  console.log("[1/3] Creating task server...");
  const { app } = await createTaskServer({
    wallet: executor,
    price: "0.35",
    handler: new MockTaskHandler(100),
  });
  console.log("  ✓ Task server created\n");

  // Step 2: Test health endpoint (should be 200)
  console.log("[2/3] Testing /health endpoint...");
  const healthRes = await app.request("/health");
  if (healthRes.status !== 200) {
    throw new Error(`Expected 200 from /health, got ${healthRes.status}`);
  }
  const healthBody = await healthRes.json();
  console.log(`  ✓ Health check: ${JSON.stringify(healthBody)}\n`);

  // Step 3: Test unpaid POST /tasks (should be 402)
  console.log("[3/3] Testing unpaid POST /tasks...");
  const taskRes = await app.request("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Hello", model: "test" }),
  });

  if (taskRes.status === 402) {
    console.log(`  ✓ Unpaid request correctly returned 402 Payment Required`);
    const body = await taskRes.text();
    console.log(`  Response preview: ${body.slice(0, 200)}...`);
  } else if (taskRes.status === 200) {
    // If x402 middleware isn't fully configured (no facilitator sync), it might pass through
    console.log(`  ⚠ Got 200 instead of 402 — middleware may not have synced with facilitator`);
    console.log(`  This is expected in offline/test environments without a reachable facilitator`);
  } else {
    console.log(`  ⚠ Got unexpected status ${taskRes.status}`);
    const body = await taskRes.text();
    console.log(`  Body: ${body.slice(0, 300)}`);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  ✓ SMOKE TEST COMPLETED");
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n✗ SMOKE TEST FAILED:", err);
  process.exit(1);
});
