/**
 * CLI Smoke Test
 * Verifies CLI command loading, config defaults, and pricing estimate output.
 * Does not require network access or a real keypair.
 */
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../cli/dist/index.js");

function run(args: string): string {
  return execSync(`node ${CLI} ${args}`, { encoding: "utf-8" });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  CLI Smoke Test");
  console.log("═══════════════════════════════════════════\n");

  // [1] Top-level help
  console.log("[1/4] CLI top-level help...");
  const help = run("--help");
  assert(help.includes("commission"), "commission command present");
  assert(help.includes("bid"), "bid command present");
  assert(help.includes("serve"), "serve command present");
  assert(help.includes("pricing"), "pricing command present");
  assert(help.includes("deliver"), "deliver command present");
  console.log("  ✓ All expected commands present\n");

  // [2] Config show (defaults, no file required)
  console.log("[2/4] Config defaults...");
  const cfg = JSON.parse(run("config show"));
  assert(cfg.network === "devnet", "default network is devnet");
  assert(cfg.rpc === "https://api.devnet.solana.com", "default RPC is devnet");
  assert(
    cfg.programId === "G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh",
    "default programId matches deployed program",
  );
  console.log("  ✓ Config defaults correct\n");

  // [3] Pricing estimate — 8b model
  console.log("[3/4] Pricing estimate (llama-3-8b vs llama-3-70b differentiation)...");
  const out8b = run("pricing estimate --model llama-3-8b --max-tokens 4096");
  const out70b = run("pricing estimate --model llama-3-70b --max-tokens 4096");

  const price8b = parseFloat(out8b.match(/Suggested Price:\s+\$([0-9.]+)/)?.[1] ?? "0");
  const price70b = parseFloat(out70b.match(/Suggested Price:\s+\$([0-9.]+)/)?.[1] ?? "0");

  assert(price8b > 0, "8b model has positive price");
  assert(price70b > price8b, `70b (${price70b}) should cost more than 8b (${price8b})`);
  console.log(`  ✓ llama-3-8b: $${price8b.toFixed(6)} USDC`);
  console.log(`  ✓ llama-3-70b: $${price70b.toFixed(6)} USDC (more expensive)\n`);

  // [4] commission --help (SDK-wrapping command)
  console.log("[4/4] Commission subcommand help...");
  const commHelp = run("commission --help");
  assert(commHelp.includes("create"), "create subcommand present");
  assert(commHelp.includes("list"), "list subcommand present");
  assert(commHelp.includes("cancel"), "cancel subcommand present");
  assert(commHelp.includes("complete"), "complete subcommand present");
  console.log("  ✓ Commission subcommands present\n");

  console.log("═══════════════════════════════════════════");
  console.log("  ✓ CLI SMOKE TEST COMPLETED");
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n✗ CLI SMOKE TEST FAILED:", err.message);
  process.exit(1);
});
