import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { buildClient } from "../utils/sdk-client.js";
import { printSuccess, printError, printTx } from "../utils/display.js";

export function matchCommand(): Command {
  const cmd = new Command("match").description("Matching operations");

  cmd
    .command("select <commission-id>")
    .description("Select a winning bid for a commission")
    .requiredOption("--executor <pubkey>", "Executor's public key")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const executor = new PublicKey(opts.executor);
        const { txSignature } = await client.matching.selectBid(commissionId, executor);
        printSuccess("Bid selected");
        printTx("Tx", txSignature);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
