import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
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

    const delegatorReputation = this.ik.reputationPda(this.ik.wallet.publicKey);
    const minExecutorTier = params.minExecutorTier != null ? params.minExecutorTier : null;

    const txSignature = await this.ik.program.methods
      .createCommission(
        params.taskType,
        taskSpecHash,
        params.taskSpecUri,
        maxPrice,
        deadline,
        minExecutorTier
      )
      .accounts({
        delegator: this.ik.wallet.publicKey,
        config: this.ik.configPda,
        commission: commissionPda,
        delegatorReputation,
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
    const commission = await this.get(commissionId);

    // For matched commissions, use actual executor; for open, use a dummy
    const executor = commission.selectedExecutor ?? Keypair.generate().publicKey;
    const executorReputation = this.ik.reputationPda(executor);
    const delegatorReputation = this.ik.reputationPda(this.ik.wallet.publicKey);

    const txSignature = await this.ik.program.methods
      .cancelCommission(new BN(commissionId))
      .accounts({
        delegator: this.ik.wallet.publicKey,
        commission: commissionPda,
        executor,
        executorReputation,
        delegatorReputation,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { txSignature };
  }

  async complete(commissionId: number): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);

    // Fetch commission to derive executor and both reputation PDAs
    const commission = await this.get(commissionId);
    if (!commission.selectedExecutor) {
      throw new Error(`Commission #${commissionId} has no selected executor`);
    }
    const executor = commission.selectedExecutor;
    const executorReputation = this.ik.reputationPda(executor);
    const delegatorReputation = this.ik.reputationPda(this.ik.wallet.publicKey);

    const txSignature = await this.ik.program.methods
      .completeCommission(new BN(commissionId))
      .accounts({
        delegator: this.ik.wallet.publicKey,
        commission: commissionPda,
        executor,
        executorReputation,
        delegatorReputation,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { txSignature };
  }

  async pay(commissionId: number): Promise<{
    txSignature: string;
    amount: BN;
    executor: PublicKey;
  }> {
    const commission = await this.get(commissionId);

    if (commission.status !== "matched") {
      throw new Error(
        `Commission #${commissionId} cannot be paid: status is "${commission.status}", expected "matched"`
      );
    }

    if (!commission.selectedExecutor) {
      throw new Error(`Commission #${commissionId} has no selected executor`);
    }
    if (!commission.selectedBidPrice) {
      throw new Error(`Commission #${commissionId} has no selected bid price`);
    }

    // Read USDC mint from on-chain config
    const config = await this.ik.accounts.platformConfig.fetch(this.ik.configPda);
    const usdcMint = (config as any).usdcMint as PublicKey;

    const delegator = this.ik.wallet;
    const executor = commission.selectedExecutor;
    const amount = commission.selectedBidPrice;

    // Get or create delegator's ATA (must already exist and be funded)
    const delegatorAta = await getAssociatedTokenAddress(usdcMint, delegator.publicKey);

    // Get or create executor's ATA (delegator pays rent if new)
    const executorAtaAccount = await getOrCreateAssociatedTokenAccount(
      this.ik.provider.connection,
      delegator,
      usdcMint,
      executor
    );

    const transferIx = createTransferInstruction(
      delegatorAta,
      executorAtaAccount.address,
      delegator.publicKey,
      BigInt(amount.toString())
    );

    const tx = new Transaction().add(transferIx);
    const txSignature = await this.ik.provider.connection.sendTransaction(tx, [delegator]);
    await this.ik.provider.connection.confirmTransaction(txSignature, "confirmed");

    return { txSignature, amount, executor };
  }

  watch(params: {
    taskType?: string;
    onNew: (commission: Commission) => void | Promise<void>;
  }): { stop: () => void } {
    const seen = new Set<number>();

    // Emit a commission if it's open, not expired, and not yet seen.
    const maybeEmit = (raw: any, address: PublicKey) => {
      try {
        if (raw.status?.open === undefined) return;
        if (params.taskType && raw.taskType !== params.taskType) return;
        const nowSec = Math.floor(Date.now() / 1000);
        if (raw.deadline.toNumber() <= nowSec) return; // skip expired
        const c = this.parseCommission(raw, address);
        if (!seen.has(c.commissionId)) {
          seen.add(c.commissionId);
          Promise.resolve(params.onNew(c)).catch(() => {});
        }
      } catch {
        // Not a decodable Commission; skip.
      }
    };

    // Initial scan: emit open, non-expired commissions created before watch() was called.
    this.list({ status: "open", taskType: params.taskType })
      .then((existing) => {
        const nowSec = Math.floor(Date.now() / 1000);
        existing
          .filter((c) => c.deadline.toNumber() > nowSec)
          .forEach((c) => {
            if (!seen.has(c.commissionId)) {
              seen.add(c.commissionId);
              Promise.resolve(params.onNew(c)).catch(() => {});
            }
          });
      })
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
      minExecutorTier: raw.minExecutorTier ?? null,
      bump: raw.bump,
      address,
    };
  }
}
