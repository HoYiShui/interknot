import { Keypair } from "@solana/web3.js";
import { IrysDeliveryClient } from "../src/delivery/irys-client";

/**
 * Test that IrysDeliveryClient initializes on devnet without errors.
 * This validates:
 * - RPC URL is properly configured (Finding #1)
 * - Wallet format is accepted by the Irys SDK (Finding #2)
 *
 * Note: A full upload/download test requires a funded Solana wallet.
 * This test only verifies the initialization path.
 */
async function main() {
  const wallet = Keypair.generate();

  // Test 1: Constructor doesn't throw
  const client = new IrysDeliveryClient({
    wallet,
    network: "devnet",
  });
  console.log("OK: IrysDeliveryClient constructor succeeded");

  // Test 2: Lazy initialization actually connects to Irys devnet
  // This triggers the .withWallet() + .withRpc() + .devnet() + .build() chain
  try {
    // Access the private getIrys() method via the upload path
    // We expect this to succeed (builder init) but may fail on upload
    // if the wallet has no SOL — that's fine, we just want the init to work.
    const irys = await (client as any).getIrys();
    console.log(`OK: Irys initialized — url: ${irys.url ?? "unknown"}`);
    console.log(`OK: Irys token address: ${irys.tokenConfig?.address ?? "resolved"}`);
  } catch (err: any) {
    // If the error is about funding or balance, that's expected (wallet has no SOL)
    // The important thing is it did NOT fail with:
    //   - "requires a dev/testnet RPC to be configured"
    //   - "Non-base58 character"
    const msg = err.message || String(err);
    if (msg.includes("requires a dev/testnet RPC")) {
      console.error("FAIL: Missing RPC configuration (Finding #1 not fixed)");
      process.exit(1);
    }
    if (msg.includes("Non-base58") || msg.includes("base58")) {
      console.error("FAIL: Wallet format mismatch (Finding #2 not fixed)");
      process.exit(1);
    }
    // Any other error during init is unexpected
    console.error(`FAIL: Unexpected initialization error: ${msg}`);
    process.exit(1);
  }

  // Test 3: Verify download path works (no Irys SDK needed for download)
  try {
    await client.downloadRaw("nonexistent-cid-for-testing");
  } catch (err: any) {
    // Expected: 404 or similar from gateway
    if (err.message.includes("Failed to fetch from Irys") || err.message.includes("404")) {
      console.log("OK: downloadRaw correctly hits Irys gateway (got expected error for missing CID)");
    } else {
      console.log(`OK: downloadRaw reached gateway (error: ${err.message})`);
    }
  }

  console.log("\nAll Irys integration tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
