import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { InterKnot } from "../client/program.js";

export interface TaskDelivery {
  commissionId: number;
  delegator: PublicKey;
  executor: PublicKey;
  inputCid: string;
  outputCid: string;
  status: DeliveryStatus;
  createdAt: number;
  updatedAt: number;
}

export type DeliveryStatus = "pending" | "inputReady" | "outputReady";

function parseDeliveryStatus(raw: any): DeliveryStatus {
  if (raw.pending !== undefined) return "pending";
  if (raw.inputReady !== undefined) return "inputReady";
  if (raw.outputReady !== undefined) return "outputReady";
  throw new Error(`Unknown delivery status: ${JSON.stringify(raw)}`);
}

function toTaskDelivery(raw: any): TaskDelivery {
  return {
    commissionId: raw.commissionId.toNumber(),
    delegator: raw.delegator,
    executor: raw.executor,
    inputCid: raw.inputCid,
    outputCid: raw.outputCid,
    status: parseDeliveryStatus(raw.status),
    createdAt: raw.createdAt.toNumber(),
    updatedAt: raw.updatedAt.toNumber(),
  };
}

export class OnChainDeliveryClient {
  constructor(private readonly ik: InterKnot) {}

  /** Create a TaskDelivery account for a matched commission */
  async createDelivery(
    commissionId: number
  ): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);
    const deliveryPda = this.ik.deliveryPda(commissionId);

    const txSignature = await this.ik.program.methods
      .createDelivery(new BN(commissionId))
      .accounts({
        delegator: this.ik.wallet.publicKey,
        commission: commissionPda,
        delivery: deliveryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.ik.wallet])
      .rpc();

    return { txSignature };
  }

  /** Submit an input CID (delegator only) */
  async submitInput(
    commissionId: number,
    inputCid: string
  ): Promise<{ txSignature: string }> {
    const deliveryPda = this.ik.deliveryPda(commissionId);

    const txSignature = await this.ik.program.methods
      .submitInput(new BN(commissionId), inputCid)
      .accounts({
        delegator: this.ik.wallet.publicKey,
        delivery: deliveryPda,
      })
      .signers([this.ik.wallet])
      .rpc();

    return { txSignature };
  }

  /** Submit an output CID (executor only) */
  async submitOutput(
    commissionId: number,
    outputCid: string
  ): Promise<{ txSignature: string }> {
    const deliveryPda = this.ik.deliveryPda(commissionId);

    const txSignature = await this.ik.program.methods
      .submitOutput(new BN(commissionId), outputCid)
      .accounts({
        executor: this.ik.wallet.publicKey,
        delivery: deliveryPda,
      })
      .signers([this.ik.wallet])
      .rpc();

    return { txSignature };
  }

  /** Fetch a TaskDelivery account */
  async getDelivery(commissionId: number): Promise<TaskDelivery | null> {
    const deliveryPda = this.ik.deliveryPda(commissionId);
    try {
      const raw = await this.ik.accounts.taskDelivery.fetch(deliveryPda);
      return toTaskDelivery(raw);
    } catch {
      return null;
    }
  }

  /** Poll for delivery status changes */
  async watchDelivery(
    commissionId: number,
    opts: {
      onUpdate: (delivery: TaskDelivery) => void;
      intervalMs?: number;
    }
  ): Promise<{ stop: () => void }> {
    const intervalMs = opts.intervalMs ?? 3000;
    let lastStatus: DeliveryStatus | null = null;
    let stopped = false;

    const poll = async () => {
      while (!stopped) {
        const delivery = await this.getDelivery(commissionId);
        if (delivery && delivery.status !== lastStatus) {
          lastStatus = delivery.status;
          opts.onUpdate(delivery);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    };

    poll().catch(() => {}); // fire and forget

    return {
      stop: () => {
        stopped = true;
      },
    };
  }
}
