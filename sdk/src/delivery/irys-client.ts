import { Keypair, PublicKey } from "@solana/web3.js";
import { deriveSharedSecret, encrypt, decrypt } from "../crypto/ecdh.js";

const IRYS_GATEWAY = "https://gateway.irys.xyz";
const DEVNET_RPC = "https://api.devnet.solana.com";

export interface IrysDeliveryConfig {
  wallet: Keypair;
  network?: "devnet" | "mainnet";
  rpcUrl?: string;
}

export class IrysDeliveryClient {
  private readonly wallet: Keypair;
  private readonly network: "devnet" | "mainnet";
  private readonly rpcUrl: string;
  private irysInstance: any | null = null;

  constructor(config: IrysDeliveryConfig) {
    this.wallet = config.wallet;
    this.network = config.network ?? "devnet";
    this.rpcUrl = config.rpcUrl ?? (this.network === "devnet" ? DEVNET_RPC : "https://api.mainnet-beta.solana.com");
  }

  /** Lazily initialize the Irys uploader */
  private async getIrys(): Promise<any> {
    if (this.irysInstance) return this.irysInstance;

    // Dynamic import to keep @irys/upload as an optional dependency
    const uploadMod = await import("@irys/upload");
    const solanaMod = await import("@irys/upload-solana");

    const Builder = uploadMod.default ?? uploadMod.Uploader;
    const Solana = solanaMod.default ?? solanaMod.Solana;

    // Pass secretKey as raw Uint8Array — the Irys Solana adapter
    // accepts non-string wallets and internally converts via bs58
    const builder = (Builder as any)(Solana)
      .withWallet(this.wallet.secretKey)
      .withRpc(this.rpcUrl);

    if (this.network === "devnet") {
      builder.devnet();
    }

    this.irysInstance = await builder.build();
    return this.irysInstance;
  }

  /**
   * Encrypt data with ECDH shared secret and upload to Irys.
   * Returns the Irys transaction ID (used as CID on-chain).
   */
  async upload(
    data: Buffer | Uint8Array,
    recipientPubkey: PublicKey
  ): Promise<string> {
    const sharedSecret = deriveSharedSecret(this.wallet, recipientPubkey);
    const encrypted = encrypt(
      data instanceof Buffer ? new Uint8Array(data) : data,
      sharedSecret
    );

    const irys = await this.getIrys();
    const receipt = await irys.upload(Buffer.from(encrypted));
    return receipt.id;
  }

  /**
   * Download from Irys and decrypt with ECDH shared secret.
   */
  async download(
    cid: string,
    senderPubkey: PublicKey
  ): Promise<Buffer> {
    const sharedSecret = deriveSharedSecret(this.wallet, senderPubkey);

    const url = `${IRYS_GATEWAY}/${cid}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from Irys: ${response.status} ${response.statusText}`);
    }

    const encrypted = new Uint8Array(await response.arrayBuffer());
    const decrypted = decrypt(encrypted, sharedSecret);
    return Buffer.from(decrypted);
  }

  /**
   * Upload raw data (unencrypted) to Irys.
   */
  async uploadRaw(data: Buffer | Uint8Array): Promise<string> {
    const irys = await this.getIrys();
    const receipt = await irys.upload(
      data instanceof Buffer ? data : Buffer.from(data)
    );
    return receipt.id;
  }

  /**
   * Download raw data (unencrypted) from Irys.
   */
  async downloadRaw(cid: string): Promise<Buffer> {
    const url = `${IRYS_GATEWAY}/${cid}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from Irys: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
