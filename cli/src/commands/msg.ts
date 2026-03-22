import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { PublicKey, Connection } from "@solana/web3.js";
import {
  InterKnot,
  OnChainDeliveryClient,
  IrysDeliveryClient,
  deriveSharedSecret,
  encrypt,
  decrypt,
} from "@inter-knot/sdk";
import { buildClient } from "../utils/sdk-client.js";
import { loadKeypair, loadConfig } from "../utils/config.js";
import { printSuccess, printError, printTx } from "../utils/display.js";

export function msgCommand(): Command {
  const cmd = new Command("msg").description(
    "Encrypted messaging via Irys (decentralized delivery)"
  );

  // ── msg send ──────────────────────────────────────────
  cmd
    .command("send")
    .description("Encrypt and send data to a matched counterpart via Irys")
    .argument("<commission-id>", "Commission ID")
    .requiredOption("--file <path>", "File to send (will be encrypted)")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client, wallet, cfg } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);

        // 1. Get commission and delivery status
        const commissionPda = client.commissionPda(commissionId);
        const commission = await client.accounts.commission.fetch(commissionPda);
        const deliveryClient = new OnChainDeliveryClient(client);

        // Determine if we are delegator or executor
        const myKey = wallet.publicKey.toBase58();
        const isDelegator = commission.delegator.toBase58() === myKey;
        const isExecutor =
          commission.selectedExecutor?.toBase58() === myKey;

        if (!isDelegator && !isExecutor) {
          throw new Error(
            "You are neither the delegator nor the selected executor for this commission."
          );
        }

        // Require commission to be in Matched state before accessing selectedExecutor
        const statusKey = Object.keys(commission.status)[0];
        if (statusKey !== "matched") {
          throw new Error(
            `Commission is not in Matched state (current: ${statusKey}). Wait for bid selection before sending a message.`
          );
        }

        // 2. Determine counterpart pubkey
        const counterpartPubkey = isDelegator
          ? commission.selectedExecutor!
          : commission.delegator;

        // 3. Read and encrypt file
        const plaintext = readFileSync(opts.file);
        const sharedSecret = deriveSharedSecret(wallet, counterpartPubkey);
        const encrypted = encrypt(new Uint8Array(plaintext), sharedSecret);

        // 4. Upload to Irys
        console.log("Uploading encrypted data to Irys...");
        const irys = new IrysDeliveryClient({
          wallet,
          network: cfg.network,
          rpcUrl: cfg.rpc,
        });
        const cid = await irys.uploadRaw(encrypted);
        console.log(`  CID: ${cid}`);

        // 5. Ensure delivery PDA exists (delegator creates it)
        let delivery = await deliveryClient.getDelivery(commissionId);
        if (!delivery && isDelegator) {
          console.log("Creating delivery account...");
          const { txSignature } =
            await deliveryClient.createDelivery(commissionId);
          printTx("Create delivery", txSignature);
        }

        // 6. Submit CID on-chain
        if (isDelegator) {
          const { txSignature } = await deliveryClient.submitInput(
            commissionId,
            cid
          );
          printSuccess("Input sent");
          printTx("Tx", txSignature);
        } else {
          const { txSignature } = await deliveryClient.submitOutput(
            commissionId,
            cid
          );
          printSuccess("Output sent");
          printTx("Tx", txSignature);
        }
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  // ── msg get ───────────────────────────────────────────
  cmd
    .command("get")
    .description("Fetch and decrypt a message from a commission delivery")
    .argument("<commission-id>", "Commission ID")
    .option("--output <path>", "Write decrypted data to file (default: stdout)")
    .option("--keypair <path>", "Keypair file path")
    .action(async (commissionIdStr, opts) => {
      try {
        const { client, wallet, cfg } = buildClient(opts.keypair);
        const commissionId = parseInt(commissionIdStr);

        const deliveryClient = new OnChainDeliveryClient(client);
        const delivery = await deliveryClient.getDelivery(commissionId);

        if (!delivery) {
          throw new Error("No delivery found for this commission.");
        }

        // Determine role and which CID to fetch
        const myKey = wallet.publicKey.toBase58();
        const isDelegator = delivery.delegator.toBase58() === myKey;
        const isExecutor = delivery.executor.toBase58() === myKey;

        if (!isDelegator && !isExecutor) {
          throw new Error(
            "You are neither the delegator nor the executor for this delivery."
          );
        }

        // Delegator reads output, executor reads input
        const cid = isDelegator ? delivery.outputCid : delivery.inputCid;
        const counterpartPubkey = isDelegator
          ? delivery.executor
          : delivery.delegator;

        if (!cid) {
          console.log(
            isDelegator
              ? "No output available yet. Status: " + delivery.status
              : "No input available yet. Status: " + delivery.status
          );
          return;
        }

        // Fetch from Irys
        console.log(`Fetching from Irys: ${cid}`);
        const irys = new IrysDeliveryClient({
          wallet,
          network: cfg.network,
          rpcUrl: cfg.rpc,
        });
        const encrypted = await irys.downloadRaw(cid);

        // Decrypt
        const sharedSecret = deriveSharedSecret(wallet, counterpartPubkey);
        const decrypted = decrypt(new Uint8Array(encrypted), sharedSecret);

        if (opts.output) {
          writeFileSync(opts.output, Buffer.from(decrypted));
          printSuccess(`Decrypted data written to ${opts.output}`);
        } else {
          process.stdout.write(Buffer.from(decrypted));
          console.log(); // trailing newline
        }
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  // ── msg inbox ─────────────────────────────────────────
  cmd
    .command("inbox")
    .description("Watch for incoming deliveries")
    .option("--watch", "Keep polling for new deliveries")
    .option("--keypair <path>", "Keypair file path")
    .action(async (opts) => {
      try {
        const { client, wallet } = buildClient(opts.keypair);
        const myKey = wallet.publicKey.toBase58();

        // Fetch all TaskDelivery accounts
        const allDeliveries = await client.accounts.taskDelivery.all();

        const relevant = allDeliveries.filter((d: any) => {
          const acct = d.account;
          return (
            acct.executor.toBase58() === myKey ||
            acct.delegator.toBase58() === myKey
          );
        });

        if (relevant.length === 0) {
          console.log("No deliveries found for your wallet.");
          if (!opts.watch) return;
        }

        for (const d of relevant) {
          const acct = d.account;
          const role =
            acct.executor.toBase58() === myKey ? "executor" : "delegator";
          const statusKey = Object.keys(acct.status)[0];
          console.log(
            `Commission #${acct.commissionId} | role: ${role} | status: ${statusKey}`
          );
          if (acct.inputCid) console.log(`  input:  ${acct.inputCid}`);
          if (acct.outputCid) console.log(`  output: ${acct.outputCid}`);
        }

        if (opts.watch) {
          console.log("\nWatching for updates (Ctrl+C to stop)...\n");
          const seen = new Set(
            relevant.map((d: any) =>
              `${d.account.commissionId}-${Object.keys(d.account.status)[0]}`
            )
          );

          const poll = async () => {
            while (true) {
              await new Promise((r) => setTimeout(r, 3000));
              const fresh = await client.accounts.taskDelivery.all();
              for (const d of fresh) {
                const acct = d.account;
                if (
                  acct.executor.toBase58() !== myKey &&
                  acct.delegator.toBase58() !== myKey
                )
                  continue;
                const statusKey = Object.keys(acct.status)[0];
                const key = `${acct.commissionId}-${statusKey}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  const role =
                    acct.executor.toBase58() === myKey
                      ? "executor"
                      : "delegator";
                  console.log(
                    `[NEW] Commission #${acct.commissionId} | role: ${role} | status: ${statusKey}`
                  );
                  if (acct.inputCid)
                    console.log(`  input:  ${acct.inputCid}`);
                  if (acct.outputCid)
                    console.log(`  output: ${acct.outputCid}`);
                }
              }
            }
          };
          await poll();
        }
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
