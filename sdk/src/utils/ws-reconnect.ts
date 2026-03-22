/**
 * WebSocket reconnect wrapper for Solana subscriptions.
 *
 * Devnet public WebSocket nodes silently drop idle connections after ~90 s.
 * @solana/web3.js v1 does attempt internal reconnection, but subscription
 * callbacks stop firing until the reconnect completes — which can take
 * tens of seconds and is not always reliable on public nodes.
 *
 * This wrapper solves the problem by proactively refreshing the subscription
 * every `keepaliveMs` milliseconds (default 60 s), well before the server
 * closes the connection.
 */

/**
 * Wrap a subscribe/unsubscribe pair so it auto-refreshes on a timer.
 *
 * @param subscribe   Creates a new subscription; returns a numeric subscription ID.
 * @param unsubscribe Removes a subscription by ID; returns a Promise.
 * @param keepaliveMs Refresh interval in milliseconds (default: 60 000).
 * @returns           { stop } — call to permanently cancel the subscription.
 */
export function withReconnect(
  subscribe: () => number,
  unsubscribe: (id: number) => Promise<void>,
  keepaliveMs = 60_000
): { stop: () => void } {
  let currentId = subscribe();
  let stopped = false;

  const refresh = () => {
    if (stopped) return;
    const oldId = currentId;
    // Subscribe before unsubscribing to guarantee no gap in coverage.
    currentId = subscribe();
    unsubscribe(oldId).catch(() => {});
  };

  const timer = setInterval(refresh, keepaliveMs);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      unsubscribe(currentId).catch(() => {});
    },
  };
}
