import { Command } from "commander";
import { buildClient } from "../utils/sdk-client.js";
import { formatCommission, printSuccess, printError, printTx } from "../utils/display.js";

export function commissionCommand(): Command {
  const cmd = new Command("commission").description("Manage commissions (delegator side)");

  cmd
    .command("create")
    .description("Create a new commission")
    .requiredOption("--task-type <type>", "Task type (e.g. compute/llm-inference)")
    .requiredOption("--spec <json>", "Task spec JSON string")
    .requiredOption("--max-price <usdc>", "Maximum price in USDC (e.g. 0.50)")
    .requiredOption("--deadline <duration>", "Deadline (e.g. 5m, 1h, 30s)")
    .option("--spec-uri <uri>", "Task spec URI (auto-encoded data: URI if omitted)")
    .option("--keypair <path>", "Keypair file path")
    .action(async (opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const taskSpec = JSON.parse(opts.spec);
        const maxPrice = parseFloat(opts.maxPrice);

        // Encode spec as data URI if no external URI provided
        const taskSpecUri =
          opts.specUri ??
          `data:application/json;base64,${Buffer.from(JSON.stringify(taskSpec)).toString("base64")}`;

        if (taskSpecUri.length > 128) {
          printError("taskSpecUri exceeds 128 characters. Provide a shorter --spec-uri (e.g. IPFS URL).");
          process.exit(1);
        }

        const { commissionId, txSignature } = await client.commission.create({
          taskType: opts.taskType,
          taskSpec,
          taskSpecUri,
          maxPrice,
          deadline: opts.deadline,
        });

        printSuccess("Commission created");
        printTx("Tx", txSignature);
        console.log(`  Commission ID: ${commissionId}`);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List open commissions")
    .option("--task-type <type>", "Filter by task type")
    .option("--keypair <path>", "Keypair file path")
    .action(async (opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissions = await client.query.getOpenCommissions();
        if (commissions.length === 0) {
          console.log("No open commissions found.");
          return;
        }
        commissions.forEach((c, i) => formatCommission(c, i));
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  cmd
    .command("cancel <commission-id>")
    .description("Cancel a commission")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const { txSignature } = await client.commission.cancel(commissionId);
        printSuccess("Commission cancelled");
        printTx("Tx", txSignature);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  cmd
    .command("complete <commission-id>")
    .description("Mark a commission as completed")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const { txSignature } = await client.commission.complete(commissionId);
        printSuccess("Commission completed");
        printTx("Tx", txSignature);
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
