import { Command } from "commander";
import { Bid, withReconnect, ReputationTier } from "@inter-knot/sdk";
import { buildClient } from "../utils/sdk-client.js";
import { formatBid, printSuccess, printError, printTx } from "../utils/display.js";

const TIER_LABELS: Record<number, string> = {
  [ReputationTier.Guest]: "Guest",
  [ReputationTier.Trusted]: "Trusted",
  [ReputationTier.Verified]: "Verified",
  [ReputationTier.Elite]: "Elite",
};

export function bidCommand(): Command {
  const cmd = new Command("bid").description("Manage bids (executor side)");

  cmd
    .command("list <commission-id>")
    .description("List bids for a commission (use --wait to block until one appears)")
    .option("--wait", "Block until at least one bid appears")
    .option("--timeout <seconds>", "Timeout in seconds for --wait (default: 120)", "120")
    .option("--with-reputation", "Show executor reputation tier and score alongside each bid")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);

        // Shared renderer: format bids with optional reputation enrichment
        const renderBids = async (bids: Bid[]) => {
          if (opts.withReputation) {
            const wallets = bids.map((b: Bid) => b.executor);
            const scores = await client.reputation.getScores(wallets);
            bids.forEach((b: Bid, i: number) => {
              formatBid(b, i);
              const s = scores.get(b.executor.toBase58());
              if (s) {
                console.log(`  Reputation:  ${TIER_LABELS[s.tier]} (executor: ${s.executorScore}/1000)`);
              }
            });
          } else {
            bids.forEach((b: Bid, i: number) => formatBid(b, i));
          }
        };

        if (opts.wait) {
          const timeoutMs = parseInt(opts.timeout) * 1000;
          console.log(`Waiting for bids on commission #${commissionId} (timeout: ${opts.timeout}s)...`);

          // Initial check — emit immediately if bids already exist
          const existing = await client.query.getBidsSortedByPrice(commissionId);
          if (existing.length > 0) {
            await renderBids(existing);
            return;
          }

          // Watch the commission account for bidCount > 0 via reconnect-hardened WebSocket
          const commissionPda = client.commissionPda(commissionId);
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              watcher.stop();
              reject(new Error(`Timeout after ${opts.timeout}s: no bids found`));
            }, timeoutMs);

            const watcher = withReconnect(
              () => client.provider.connection.onAccountChange(
                commissionPda,
                async (accountInfo) => {
                  try {
                    const raw = client.program.coder.accounts.decode(
                      "commission",
                      accountInfo.data
                    );
                    if (raw.bidCount.toNumber() > 0) {
                      clearTimeout(timer);
                      watcher.stop();
                      const bids = await client.query.getBidsSortedByPrice(commissionId);
                      await renderBids(bids);
                      resolve();
                    }
                  } catch { /* not a commission account or not ready */ }
                },
                "confirmed"
              ),
              (id) => client.provider.connection.removeAccountChangeListener(id)
            );
          });
        } else {
          const bids = await client.query.getBidsSortedByPrice(commissionId);
          if (bids.length === 0) {
            console.log("No bids found for this commission.");
            return;
          }
          await renderBids(bids);
        }
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  cmd
    .command("submit <commission-id>")
    .description("Submit a bid on a commission")
    .requiredOption("--price <usdc>", "Bid price in USDC (e.g. 0.35)")
    .option("--endpoint <url>", "Service endpoint URL (required for http delivery)")
    .option("--delivery-method <method>", "Delivery method: irys or http (default: irys)", "irys")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);
        const price = parseFloat(opts.price);
        const method: string = opts.deliveryMethod;
        const endpoint = method === "irys"
          ? (opts.endpoint ?? "irys://delivery")
          : opts.endpoint;
        if (!endpoint) {
          throw new Error("--endpoint is required when --delivery-method is http");
        }
        const { txSignature } = await client.bid.submit(commissionId, {
          price,
          serviceEndpoint: endpoint,
        });
        printSuccess(`Bid submitted (delivery: ${method})`);
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
