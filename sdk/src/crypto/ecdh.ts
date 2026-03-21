import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { Keypair, PublicKey } from "@solana/web3.js";

const HKDF_INFO = new TextEncoder().encode("inter-knot-v1");

/**
 * Derive a shared secret between two Solana keypairs using ECDH.
 * Converts Ed25519 keys to X25519 (Montgomery form) then performs key exchange.
 */
export function deriveSharedSecret(
  myKeypair: Keypair,
  theirPubkey: PublicKey
): Uint8Array {
  // Solana secretKey is 64 bytes: [32-byte seed | 32-byte pubkey]
  const myPriv = ed25519.utils.toMontgomerySecret(myKeypair.secretKey.slice(0, 32));
  const theirPub = ed25519.utils.toMontgomery(theirPubkey.toBytes());
  const raw = x25519.getSharedSecret(myPriv, theirPub);

  // Derive a proper AES key via HKDF
  return hkdf(sha256, raw, /*salt=*/ undefined, HKDF_INFO, 32);
}

/**
 * Encrypt plaintext using AES-256-GCM with a shared secret.
 * Returns: 12-byte nonce || ciphertext || 16-byte tag
 */
export function encrypt(
  plaintext: Uint8Array,
  sharedSecret: Uint8Array
): Uint8Array {
  const nonce = randomBytes(12);
  const aes = gcm(sharedSecret, nonce);
  const sealed = aes.encrypt(plaintext);
  // Prepend nonce: nonce (12) + ciphertext+tag
  const result = new Uint8Array(12 + sealed.length);
  result.set(nonce, 0);
  result.set(sealed, 12);
  return result;
}

/**
 * Decrypt ciphertext produced by encrypt().
 * Expects: 12-byte nonce || ciphertext || 16-byte tag
 */
export function decrypt(
  ciphertext: Uint8Array,
  sharedSecret: Uint8Array
): Uint8Array {
  const nonce = ciphertext.slice(0, 12);
  const sealed = ciphertext.slice(12);
  const aes = gcm(sharedSecret, nonce);
  return aes.decrypt(sealed);
}
