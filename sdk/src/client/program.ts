import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { CommissionClient } from "./commission.js";
import { BidClient } from "./bid.js";
import { MatchingClient } from "./matching.js";
import { QueryClient } from "./query.js";
import { ReputationClient } from "./reputation.js";

// Bundled IDL — the SDK is self-contained, no repo-local file reads needed
import defaultIdl from "../idl/inter_knot.json" with { type: "json" };

export const PROGRAM_ID = new PublicKey(
  "G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh"
);

export const USDC_DECIMALS = 6;

/** Convert human-readable USDC (e.g. 0.50) to on-chain amount (500000) */
export function usdcToLamports(usdc: number): BN {
  return new BN(Math.round(usdc * 10 ** USDC_DECIMALS));
}

/** Convert on-chain amount to human-readable USDC */
export function lamportsToUsdc(lamports: BN): number {
  return lamports.toNumber() / 10 ** USDC_DECIMALS;
}

/** Parse deadline shorthand ("5m", "1h", "30s") or unix timestamp */
export function parseDeadline(deadline: string | number): BN {
  if (typeof deadline === "number") {
    return new BN(deadline);
  }
  const match = deadline.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error(
      `Invalid deadline format: "${deadline}". Use "5m", "1h", "30s", or a Unix timestamp.`
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600 };
  const nowSec = Math.floor(Date.now() / 1000);
  return new BN(nowSec + value * multipliers[unit]);
}

export interface InterKnotConfig {
  connection: Connection;
  wallet: Keypair;
  programId?: PublicKey;
  /** Optional: provide a custom IDL. Defaults to bundled IDL. */
  idl?: Idl;
}

export class InterKnot {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly wallet: Keypair;
  readonly programId: PublicKey;

  readonly commission: CommissionClient;
  readonly bid: BidClient;
  readonly matching: MatchingClient;
  readonly query: QueryClient;
  readonly reputation: ReputationClient;

  constructor(config: InterKnotConfig) {
    this.wallet = config.wallet;
    this.programId = config.programId ?? PROGRAM_ID;

    const wallet = {
      publicKey: config.wallet.publicKey,
      signTransaction: async (tx: any) => {
        tx.partialSign(config.wallet);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach((tx) => tx.partialSign(config.wallet));
        return txs;
      },
    };

    this.provider = new AnchorProvider(config.connection, wallet as any, {
      commitment: "confirmed",
    });

    // Use bundled IDL by default; override idl.address to match configured programId
    const idl: Idl = config.idl ?? (defaultIdl as unknown as Idl);
    const resolvedIdl = { ...idl, address: this.programId.toBase58() };

    this.program = new Program(resolvedIdl, this.provider);

    // Anchor's dynamic IDL loading doesn't produce typed account accessors.
    // We use `accounts` as a typed shortcut to avoid `(program.account as any)` everywhere.
    this.accounts = this.program.account as any;

    this.commission = new CommissionClient(this);
    this.bid = new BidClient(this);
    this.matching = new MatchingClient(this);
    this.query = new QueryClient(this);
    this.reputation = new ReputationClient(this);
  }

  /** Typed account accessor (shortcut for program.account cast) */
  readonly accounts: {
    platformConfig: { fetch: (address: PublicKey) => Promise<any> };
    commission: {
      fetch: (address: PublicKey) => Promise<any>;
      all: () => Promise<{ publicKey: PublicKey; account: any }[]>;
    };
    bid: {
      fetch: (address: PublicKey) => Promise<any>;
      all: () => Promise<{ publicKey: PublicKey; account: any }[]>;
    };
    taskDelivery: {
      fetch: (address: PublicKey) => Promise<any>;
      all: () => Promise<{ publicKey: PublicKey; account: any }[]>;
    };
    reputationAccount: {
      fetch: (address: PublicKey) => Promise<any>;
      all: () => Promise<{ publicKey: PublicKey; account: any }[]>;
    };
  };

  /** Derive the PlatformConfig PDA */
  get configPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("inter_knot_config")],
      this.programId
    );
    return pda;
  }

  /** Derive a Commission PDA by ID */
  commissionPda(commissionId: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("commission"),
        new BN(commissionId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return pda;
  }

  /** Derive a Bid PDA */
  bidPda(commissionId: number, executor: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        new BN(commissionId).toArrayLike(Buffer, "le", 8),
        executor.toBuffer(),
      ],
      this.programId
    );
    return pda;
  }

  /** Derive a TaskDelivery PDA */
  deliveryPda(commissionId: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("delivery"),
        new BN(commissionId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return pda;
  }

  /** Derive a ReputationAccount PDA */
  reputationPda(wallet: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), wallet.toBuffer()],
      this.programId
    );
    return pda;
  }
}
