import type { Client } from "ssh2";
import {
  JumpChainPool,
  jumpChainPool,
  type JumpHop,
} from "../../hosts/jump-chain-pool.js";
import { tcpPingThroughJumpHostResult } from "./tcp-ping.js";

type OpenChain = (
  jumpHosts: JumpHop[],
  userId: string,
) => Promise<Client | null>;

/**
 * Status probes for hosts behind jump hosts share one chain per hop list.
 * Opening a chain logs in to every hop, so doing it for every host on every
 * interval made an import of jump-hosted hosts open dozens of SSH sessions
 * each minute. A chain closes after it sits idle.
 */
export class JumpProbePool {
  private readonly pool: JumpChainPool;

  constructor(openOrPool: OpenChain | JumpChainPool, idleMs = 120_000) {
    if (openOrPool instanceof JumpChainPool) {
      this.pool = openOrPool;
    } else {
      this.pool = new JumpChainPool(
        (jumpHosts, userId) => openOrPool(jumpHosts, userId).catch(() => null),
        { idleTtlMs: idleMs },
      );
    }
  }

  async ping(
    jumpHosts: JumpHop[],
    userId: string,
    host: string,
    port: number,
    timeoutMs = 5000,
  ): Promise<boolean> {
    let lease;
    try {
      lease = await this.pool.acquire(jumpHosts, userId);
    } catch {
      return false;
    }
    if (!lease) return false;

    try {
      const result = await tcpPingThroughJumpHostResult(
        lease.client,
        host,
        port,
        timeoutMs,
        true,
      );
      if (result === "timeout") {
        // The hop never answered, so the next ping opens a fresh chain.
        lease.invalidate();
      }
      return result === "ok";
    } finally {
      lease.release();
    }
  }

  closeAll(): void {
    this.pool.clear();
  }
}

/** One pool for core's checks and for plugins probing through ctx. */
export const sharedJumpProbes = new JumpProbePool(jumpChainPool);
