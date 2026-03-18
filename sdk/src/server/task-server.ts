import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddlewareFromConfig } from "@x402/hono";
import { Keypair } from "@solana/web3.js";

import { TaskHandler, TaskInput, MockTaskHandler } from "./handlers.js";

export interface TaskServerConfig {
  /** Executor's Solana keypair (receives payments) */
  wallet: Keypair;
  /** Port to listen on */
  port?: number;
  /** Price in USDC for task execution (e.g. "0.35") */
  price: string;
  /** Solana network in CAIP-2 format */
  network?: string;
  /** Task handler implementation */
  handler?: TaskHandler;
}

const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/**
 * Creates a Hono app for the executor's task server with x402 payment protection.
 */
export async function createTaskServer(config: TaskServerConfig) {
  const app = new Hono();
  const handler = config.handler ?? new MockTaskHandler();
  const network = config.network ?? DEVNET_NETWORK;
  const payTo = config.wallet.publicKey.toBase58();

  // Health check (not paywalled)
  app.get("/health", (c) =>
    c.json({ status: "ok", executor: payTo, price: config.price })
  );

  // x402-protected task execution endpoint
  const routes = {
    "POST /tasks": {
      accepts: {
        scheme: "exact",
        payTo,
        price: config.price,
        network: network as `${string}:${string}`,
      },
    },
  };

  app.use("/tasks", paymentMiddlewareFromConfig(routes));

  app.post("/tasks", async (c) => {
    const input = (await c.req.json()) as TaskInput;
    const result = await handler.execute(input);
    return c.json(result);
  });

  return { app, handler };
}

/**
 * Start the task server and listen on a port.
 */
export async function startTaskServer(config: TaskServerConfig): Promise<{
  close: () => void;
}> {
  const { app } = await createTaskServer(config);
  const port = config.port ?? 8080;

  const server = serve({ fetch: app.fetch, port });
  console.log(`Inter-Knot executor server running on http://localhost:${port}`);
  console.log(`  Pay-to: ${config.wallet.publicKey.toBase58()}`);
  console.log(`  Price: ${config.price} USDC`);
  console.log(`  Endpoint: POST http://localhost:${port}/tasks`);

  return {
    close: () => {
      (server as any).close?.();
    },
  };
}
