import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as crypto from "crypto";

import { InterKnot, usdcToLamports, parseDeadline } from "./program";
import {
  Commission,
  CommissionStatus,
  CreateCommissionParams,
  parseCommissionStatus,
} from "../types/commission";

export class CommissionClient {
  constructor(private readonly ik: InterKnot) {}

  async create(params: CreateCommissionParams): Promise<{
    commissionId: number;
    txSignature: string;
  }> {
    const config = await this.ik.accounts.platformConfig.fetch(
      this.ik.configPda
    );
    const commissionId = (config as any).commissionCount.toNumber();

    const taskSpecJson = JSON.stringify(params.taskSpec);
    const taskSpecHash = Array.from(
      crypto.createHash("sha256").update(taskSpecJson).digest()
    );
    // For MVP, store task spec at a placeholder URI
    const taskSpecUri = `data:application/json;base64,${Buffer.from(taskSpecJson).toString("base64")}`;

    const maxPrice = usdcToLamports(params.maxPrice);
    const deadline = parseDeadline(params.deadline);

    const commissionPda = this.ik.commissionPda(commissionId);

    const txSignature = await this.ik.program.methods
      .createCommission(
        params.taskType,
        taskSpecHash,
        taskSpecUri,
        maxPrice,
        deadline
      )
      .accounts({
        delegator: this.ik.wallet.publicKey,
        config: this.ik.configPda,
        commission: commissionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { commissionId, txSignature };
  }

  async get(commissionId: number): Promise<Commission> {
    const pda = this.ik.commissionPda(commissionId);
    const raw = await this.ik.accounts.commission.fetch(pda);
    return this.parseCommission(raw, pda);
  }

  async list(filters?: {
    status?: CommissionStatus;
    taskType?: string;
    delegator?: PublicKey;
  }): Promise<Commission[]> {
    const accounts = await this.ik.accounts.commission.all();
    let results = accounts.map((a: any) =>
      this.parseCommission(a.account, a.publicKey)
    );

    if (filters?.status) {
      results = results.filter((c: Commission) => c.status === filters.status);
    }
    if (filters?.taskType) {
      results = results.filter((c: Commission) => c.taskType === filters.taskType);
    }
    if (filters?.delegator) {
      results = results.filter(
        (c: Commission) => c.delegator.toBase58() === filters.delegator!.toBase58()
      );
    }

    return results;
  }

  async cancel(commissionId: number): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);
    const txSignature = await this.ik.program.methods
      .cancelCommission(new BN(commissionId))
      .accounts({
        delegator: this.ik.wallet.publicKey,
        commission: commissionPda,
      })
      .rpc();
    return { txSignature };
  }

  async complete(commissionId: number): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);
    const txSignature = await this.ik.program.methods
      .completeCommission(new BN(commissionId))
      .accounts({
        delegator: this.ik.wallet.publicKey,
        commission: commissionPda,
      })
      .rpc();
    return { txSignature };
  }

  watch(params: {
    taskType?: string;
    pollIntervalMs?: number;
    onNew: (commission: Commission) => void | Promise<void>;
  }): { stop: () => void } {
    const interval = params.pollIntervalMs ?? 2000;
    const seen = new Set<number>();
    let running = true;

    const poll = async () => {
      while (running) {
        try {
          const commissions = await this.list({
            status: "open",
            taskType: params.taskType,
          });
          for (const c of commissions) {
            if (!seen.has(c.commissionId)) {
              seen.add(c.commissionId);
              await params.onNew(c);
            }
          }
        } catch {
          // Silently retry on transient errors
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    };

    poll();
    return {
      stop: () => {
        running = false;
      },
    };
  }

  private parseCommission(raw: any, address: PublicKey): Commission {
    return {
      commissionId: raw.commissionId.toNumber(),
      delegator: raw.delegator,
      taskType: raw.taskType,
      taskSpecHash: raw.taskSpecHash,
      taskSpecUri: raw.taskSpecUri,
      maxPrice: raw.maxPrice,
      deadline: raw.deadline,
      status: parseCommissionStatus(raw.status),
      selectedExecutor: raw.selectedExecutor ?? null,
      selectedBidPrice: raw.selectedBidPrice ?? null,
      bidCount: raw.bidCount,
      createdAt: raw.createdAt,
      matchedAt: raw.matchedAt ?? null,
      completedAt: raw.completedAt ?? null,
      bump: raw.bump,
      address,
    };
  }
}
