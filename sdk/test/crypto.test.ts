import { Keypair } from "@solana/web3.js";
import { deriveSharedSecret, encrypt, decrypt } from "../src/crypto/ecdh";

// Test: ECDH shared secret derivation + AES-256-GCM round-trip
async function main() {
  const alice = Keypair.generate();
  const bob = Keypair.generate();

  // Both sides should derive the same shared secret
  const secretA = deriveSharedSecret(alice, bob.publicKey);
  const secretB = deriveSharedSecret(bob, alice.publicKey);

  if (Buffer.from(secretA).toString("hex") !== Buffer.from(secretB).toString("hex")) {
    console.error("FAIL: shared secrets don't match!");
    process.exit(1);
  }
  console.log("OK: shared secrets match");

  // Encrypt with Alice's secret, decrypt with Bob's secret
  const plaintext = new TextEncoder().encode("Hello from Inter-Knot!");
  const ciphertext = encrypt(plaintext, secretA);
  const decrypted = decrypt(ciphertext, secretB);

  const decryptedText = new TextDecoder().decode(decrypted);
  if (decryptedText !== "Hello from Inter-Knot!") {
    console.error(`FAIL: decrypted text mismatch: "${decryptedText}"`);
    process.exit(1);
  }
  console.log("OK: encrypt/decrypt round-trip works");

  // Verify ciphertext structure: 12-byte nonce + payload + 16-byte tag
  if (ciphertext.length !== 12 + plaintext.length + 16) {
    console.error(`FAIL: unexpected ciphertext length: ${ciphertext.length}`);
    process.exit(1);
  }
  console.log(`OK: ciphertext length correct (${ciphertext.length} bytes)`);

  // Verify wrong key fails
  const charlie = Keypair.generate();
  const wrongSecret = deriveSharedSecret(charlie, bob.publicKey);
  try {
    decrypt(ciphertext, wrongSecret);
    console.error("FAIL: decryption should have failed with wrong key");
    process.exit(1);
  } catch {
    console.log("OK: wrong key correctly rejected");
  }

  // Test with larger data
  const largeData = new Uint8Array(10000);
  for (let i = 0; i < largeData.length; i++) largeData[i] = i % 256;
  const largeCt = encrypt(largeData, secretA);
  const largePt = decrypt(largeCt, secretB);
  if (largePt.length !== largeData.length) {
    console.error("FAIL: large data round-trip length mismatch");
    process.exit(1);
  }
  console.log("OK: large data (10KB) round-trip works");

  console.log("\nAll crypto tests passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
