import { Command } from "commander";
import { DeliveryClient } from "@inter-knot/sdk";
import { loadKeypair, loadConfig, networkToX402 } from "../utils/config.js";
import { printSuccess, printError } from "../utils/display.js";

export function deliverCommand(): Command {
  const cmd = new Command("deliver")
    .description("Deliver a task to an executor via x402 payment")
    .argument("<endpoint>", "Executor service endpoint URL")
    .requiredOption("--input <json>", "Task input JSON")
    .option("--keypair <path>", "Keypair file path")
    .action(async (endpoint, opts) => {
      try {
        const wallet = loadKeypair(opts.keypair);
        const cfg = loadConfig();
        const network = networkToX402(cfg.network);
        const taskInput = JSON.parse(opts.input);

        const deliveryClient = new DeliveryClient({ wallet, network });
        console.log(`Delivering task to ${endpoint}...`);

        const { result, paymentTxHash, settlementRaw } =
          await deliveryClient.requestWithPayment(endpoint, taskInput);

        printSuccess("Task delivered");
        if (paymentTxHash) {
          console.log(`  Settlement Tx: ${paymentTxHash}`);
        }
        console.log("\nResult:");
        console.log(JSON.stringify(result, null, 2));
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
