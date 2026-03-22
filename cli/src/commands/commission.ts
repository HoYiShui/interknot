import { Command } from "commander";
import { Commission } from "@inter-knot/sdk";
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
    .description("List open commissions (use --wait to block until one appears)")
    .option("--task-type <type>", "Filter by task type")
    .option("--wait", "Block until at least one matching commission appears")
    .option("--timeout <seconds>", "Timeout in seconds for --wait (default: 180)", "180")
    .option("--keypair <path>", "Keypair file path")
    .action(async (opts) => {
      try {
        const { client } = buildClient(opts.keypair);

        if (opts.wait) {
          const timeoutMs = parseInt(opts.timeout) * 1000;
          console.log(`Waiting for open commission${opts.taskType ? ` of type "${opts.taskType}"` : ""} (timeout: ${opts.timeout}s)...`);

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              watcher.stop();
              reject(new Error(`Timeout after ${opts.timeout}s: no matching commission found`));
            }, timeoutMs);

            const watcher = client.commission.watch({
              taskType: opts.taskType,
              onNew: (c: Commission) => {
                clearTimeout(timer);
                watcher.stop();
                formatCommission(c, 0);
                resolve();
              },
            });
          });
        } else {
          const commissions = await client.query.getOpenCommissions(
            opts.taskType ? { taskType: opts.taskType } : undefined,
          );
          if (commissions.length === 0) {
            console.log("No open commissions found.");
            return;
          }
          commissions.forEach((c: Commission, i: number) => formatCommission(c, i));
        }
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
