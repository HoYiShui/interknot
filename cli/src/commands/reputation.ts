import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { ReputationTier } from "@inter-knot/sdk";
import { buildClient } from "../utils/sdk-client.js";
import { printError } from "../utils/display.js";

const TIER_LABELS: Record<number, string> = {
  [ReputationTier.Guest]: "Guest",
  [ReputationTier.Trusted]: "Trusted",
  [ReputationTier.Verified]: "Verified",
  [ReputationTier.Elite]: "Elite",
};

export function reputationCommand(): Command {
  const cmd = new Command("reputation").description("View on-chain reputation");

  cmd
    .command("get <wallet>")
    .description("Show reputation score and tier for a wallet")
    .option("--keypair <path>", "Keypair file path")
    .action(async (walletStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const wallet = new PublicKey(walletStr);
        const rep = await client.reputation.getReputation(wallet);

        if (!rep) {
          console.log(`No reputation account found for ${walletStr}`);
          console.log(`  Tier: ${TIER_LABELS[ReputationTier.Guest]} (no history)`);
          return;
        }

        const score = await client.reputation.getScore(wallet);

        console.log(`Reputation: ${walletStr}`);
        console.log(`  Tier:             ${TIER_LABELS[score.tier]}`);
        console.log(`  Executor Score:   ${score.executorScore} / 1000`);
        console.log(`  Delegator Score:  ${score.delegatorScore} / 1000`);
        console.log();
        console.log("  Executor counters:");
        console.log(`    Bids:           ${rep.totalBids}`);
        console.log(`    Completed:      ${rep.totalCompleted}`);
        console.log(`    Abandoned:      ${rep.totalAbandoned}`);
        console.log();
        console.log("  Delegator counters:");
        console.log(`    Commissioned:   ${rep.totalCommissioned}`);
        console.log(`    Paid:           ${rep.totalPaid}`);
        console.log(`    Abandoned:      ${rep.totalDelegatorAbandoned}`);
        console.log();
        console.log(`  Unique counterparties: ${rep.uniqueCounterparties}`);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
