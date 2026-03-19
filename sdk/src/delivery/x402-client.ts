import { Keypair } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm";

import { TaskInput, TaskOutput } from "../server/handlers.js";

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export interface DeliveryClientConfig {
  /** Delegator's Solana keypair (pays for tasks) */
  wallet: Keypair;
  /** Solana network in CAIP-2 format */
  network?: string;
}

export interface DeliveryResult {
  result: TaskOutput;
  /** Settlement transaction hash (if available from x402 response) */
  paymentTxHash: string | null;
  /** Raw settlement response header */
  settlementRaw: string | null;
}

/**
 * Creates an x402-enabled fetch function for the delegator.
 * Automatically handles the 402 → pay → retry flow.
 */
export async function createPaidFetch(config: DeliveryClientConfig) {
  const network = config.network ?? DEVNET_NETWORK;

  // Convert web3.js Keypair to @solana/kit KeyPairSigner
  const signer = await createKeyPairSignerFromBytes(
    Uint8Array.from(config.wallet.secretKey)
  );

  const svmScheme = new ExactSvmScheme(signer);
  const client = new x402Client().register(network as `${string}:${string}`, svmScheme);

  return wrapFetchWithPayment(fetch, client);
}

export class DeliveryClient {
  private paidFetchPromise: Promise<typeof fetch> | null = null;

  constructor(private readonly config: DeliveryClientConfig) {}

  private async getPaidFetch(): Promise<typeof fetch> {
    if (!this.paidFetchPromise) {
      this.paidFetchPromise = createPaidFetch(this.config);
    }
    return this.paidFetchPromise;
  }

  /**
   * Send a task to the executor's endpoint with automatic x402 payment.
   * Returns both the task result and settlement metadata.
   */
  async requestWithPayment(
    serviceEndpoint: string,
    taskInput: TaskInput,
  ): Promise<DeliveryResult> {
    const paidFetch = await this.getPaidFetch();

    const response = await paidFetch(serviceEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskInput),
    });

    if (!response.ok) {
      throw new Error(
        `Task delivery failed: ${response.status} ${await response.text()}`
      );
    }

    // Extract settlement metadata from x402 response headers
    const settlementRaw =
      response.headers.get("x-payment-response") ??
      response.headers.get("payment-response");

    let paymentTxHash: string | null = null;
    if (settlementRaw) {
      try {
        // x402 PAYMENT-RESPONSE header is base64-encoded, not raw JSON
        const decoded = decodePaymentResponseHeader(settlementRaw);
        paymentTxHash = (decoded as any).txHash
          ?? (decoded as any).transactionHash
          ?? (decoded as any).signature
          ?? null;
      } catch {
        paymentTxHash = null;
      }
    }

    const result = (await response.json()) as TaskOutput;

    return { result, paymentTxHash, settlementRaw };
  }
}
