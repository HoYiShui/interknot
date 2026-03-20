import { Command } from "commander";
import { buildClient } from "../utils/sdk-client.js";
import { formatBid, printSuccess, printError, printTx } from "../utils/display.js";

export function bidCommand(): Command {
  const cmd = new Command("bid").description("Manage bids (executor side)");

  cmd
    .command("list <commission-id>")
    .description("List bids for a commission")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const bids = await client.query.getBidsSortedByPrice(commissionId);
        if (bids.length === 0) {
          console.log("No bids found for this commission.");
          return;
        }
        bids.forEach((b, i) => formatBid(b, i));
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  cmd
    .command("submit <commission-id>")
    .description("Submit a bid on a commission")
    .requiredOption("--price <usdc>", "Bid price in USDC (e.g. 0.35)")
    .requiredOption("--endpoint <url>", "Service endpoint URL for task delivery")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const price = parseFloat(opts.price);
        const { txSignature } = await client.bid.submit(commissionId, {
          price,
          serviceEndpoint: opts.endpoint,
        });
        printSuccess("Bid submitted");
        printTx("Tx", txSignature);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  cmd
    .command("withdraw <commission-id>")
    .description("Withdraw your bid from a commission")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const { txSignature } = await client.bid.withdraw(commissionId);
        printSuccess("Bid withdrawn");
        printTx("Tx", txSignature);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
