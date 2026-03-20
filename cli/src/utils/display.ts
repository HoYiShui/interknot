import { Commission } from "@inter-knot/sdk";
import { Bid } from "@inter-knot/sdk";

function bnToNumber(val: { toNumber(): number } | number | bigint): number {
  if (typeof val === "object" && "toNumber" in val) return val.toNumber();
  return Number(val);
}

export function formatUsdc(amount: { toNumber(): number } | number | bigint): string {
  const n = bnToNumber(amount);
  return (n / 1_000_000).toFixed(6) + " USDC";
}

export function formatCommission(c: Commission, index?: number): void {
  const prefix = index !== undefined ? `[${index}] ` : "";
  console.log(`${prefix}Commission #${c.commissionId}`);
  console.log(`  Task Type:  ${c.taskType}`);
  console.log(`  Max Price:  ${formatUsdc(c.maxPrice)}`);
  console.log(`  Delegator:  ${c.delegator.toBase58()}`);
  const deadlineSec = bnToNumber(c.deadline);
  console.log(`  Deadline:   ${new Date(deadlineSec * 1000).toLocaleString()}`);
  console.log(`  Status:     ${c.status}`);
  console.log(`  Bids:       ${c.bidCount}`);
}

export function formatBid(b: Bid, index?: number): void {
  const prefix = index !== undefined ? `[${index}] ` : "";
  console.log(`${prefix}Executor: ${b.executor.toBase58()}`);
  console.log(`  Price:     ${formatUsdc(b.price)}`);
  console.log(`  Endpoint:  ${b.serviceEndpoint}`);
  console.log(`  Status:    ${b.status}`);
}

export function printSuccess(msg: string): void {
  console.log(`\n✓ ${msg}`);
}

export function printError(msg: string): void {
  console.error(`\n✗ Error: ${msg}`);
}

export function printTx(label: string, sig: string): void {
  console.log(`  ${label}: ${sig}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}
