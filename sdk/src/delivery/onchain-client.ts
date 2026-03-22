import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { InterKnot } from "../client/program.js";
import { withReconnect } from "../utils/ws-reconnect.js";

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

  /** Subscribe to delivery status changes via WebSocket (replaces polling). */
  watchDelivery(
    commissionId: number,
    opts: {
      onUpdate: (delivery: TaskDelivery) => void;
    }
  ): { stop: () => void } {
    const deliveryPda = this.ik.deliveryPda(commissionId);
    let lastStatus: DeliveryStatus | null = null;

    // Emit current state immediately if the account already exists.
    this.getDelivery(commissionId)
      .then((current) => {
        if (current && current.status !== lastStatus) {
          lastStatus = current.status;
          opts.onUpdate(current);
        }
      })
      .catch(() => {});

    const subscribe = () =>
      this.ik.provider.connection.onAccountChange(
        deliveryPda,
        (accountInfo: any) => {
          try {
            const raw = this.ik.program.coder.accounts.decode(
              "taskDelivery",
              accountInfo.data
            );
            const delivery = toTaskDelivery(raw);
            if (delivery.status !== lastStatus) {
              lastStatus = delivery.status;
              opts.onUpdate(delivery);
            }
          } catch { /* ignore */ }
        },
        "confirmed"
      );

    return withReconnect(
      subscribe,
      (id) => this.ik.provider.connection.removeAccountChangeListener(id)
    );
  }
}
