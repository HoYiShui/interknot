import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as crypto from "crypto";

import { InterKnot, usdcToLamports, parseDeadline } from "./program.js";
import {
  Commission,
  CommissionStatus,
  CreateCommissionParams,
  parseCommissionStatus,
} from "../types/commission.js";
import { withReconnect } from "../utils/ws-reconnect.js";

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

    const maxPrice = usdcToLamports(params.maxPrice);
    const deadline = parseDeadline(params.deadline);

    const commissionPda = this.ik.commissionPda(commissionId);

    const txSignature = await this.ik.program.methods
      .createCommission(
        params.taskType,
        taskSpecHash,
        params.taskSpecUri,
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
    onNew: (commission: Commission) => void | Promise<void>;
  }): { stop: () => void } {
    const seen = new Set<number>();

    // Emit a commission if it's open and not yet seen.
    const maybeEmit = (raw: any, address: PublicKey) => {
      try {
        if (raw.status?.open === undefined) return;
        if (params.taskType && raw.taskType !== params.taskType) return;
        const c = this.parseCommission(raw, address);
        if (!seen.has(c.commissionId)) {
          seen.add(c.commissionId);
          Promise.resolve(params.onNew(c)).catch(() => {});
        }
      } catch {
        // Not a decodable Commission; skip.
      }
    };

    // Initial scan: emit any open commissions that already exist so callers
    // don't miss commissions created before watch() was called.
    this.list({ status: "open", taskType: params.taskType })
      .then((existing) => existing.forEach((c) => {
        if (!seen.has(c.commissionId)) {
          seen.add(c.commissionId);
          Promise.resolve(params.onNew(c)).catch(() => {});
        }
      }))
      .catch(() => {});

    // WebSocket subscription: fires on every account change for the program.
    // Filtering is done in the callback (JS-side) — program account count is
    // small enough that this is not a bottleneck.
    const subscribe = () =>
      this.ik.provider.connection.onProgramAccountChange(
        this.ik.programId,
        (keyedAccountInfo: any) => {
          try {
            const raw = this.ik.program.coder.accounts.decode(
              "commission",
              keyedAccountInfo.accountInfo.data
            );
            maybeEmit(raw, keyedAccountInfo.accountId);
          } catch {
            // Different account type (bid, config, delivery); ignore.
          }
        },
        "confirmed"
      );

    return withReconnect(
      subscribe,
      (id) => this.ik.provider.connection.removeProgramAccountChangeListener(id)
    );
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
