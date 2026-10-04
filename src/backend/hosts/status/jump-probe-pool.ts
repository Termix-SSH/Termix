import type { Client } from "ssh2";
import { tcpPingThroughJumpHostResult } from "./tcp-ping.js";

type OpenChain = (
  jumpHosts: Array<{ hostId: number }>,
  userId: string,
) => Promise<Client | null>;

interface Entry {
  client: Promise<Client | null>;
  idle?: NodeJS.Timeout;
}

/**
 * Status probes for hosts behind jump hosts share one chain per hop list.
 * Opening a chain logs in to every hop, so doing it for every host on every
 * interval made an import of jump-hosted hosts open dozens of SSH sessions
 * each minute. A chain closes after it sits idle.
 */
export class JumpProbePool {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly open: OpenChain,
    private readonly idleMs = 120_000,
  ) {}

  async ping(
    jumpHosts: Array<{ hostId: number }>,
    userId: string,
    host: string,
    port: number,
    timeoutMs = 5000,
  ): Promise<boolean> {
    const key = `${userId}:${jumpHosts.map((hop) => hop.hostId).join(">")}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { client: this.connect(key, jumpHosts, userId) };
      this.entries.set(key, entry);
    }
    const client = await entry.client;
    if (!client) {
      this.drop(key, entry);
      return false;
    }
    this.touch(key, entry, client);
    const result = await tcpPingThroughJumpHostResult(
      client,
      host,
      port,
      timeoutMs,
      true,
    );
    if (result === "timeout") {
      // The hop never answered, so the next ping opens a fresh chain.
      this.drop(key, entry);
      client.end();
    }
    return result === "ok";
  }

  closeAll(): void {
    for (const [key, entry] of [...this.entries]) {
      this.drop(key, entry);
      void entry.client.then((client) => client?.end()).catch(() => {});
    }
  }

  private async connect(
    key: string,
    jumpHosts: Array<{ hostId: number }>,
    userId: string,
  ): Promise<Client | null> {
    const client = await this.open(jumpHosts, userId).catch(() => null);
    if (client) {
      const forget = () => {
        const current = this.entries.get(key);
        if (current) this.drop(key, current);
      };
      client.once("close", forget);
      client.once("error", forget);
    }
    return client;
  }

  private touch(key: string, entry: Entry, client: Client): void {
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      this.drop(key, entry);
      client.end();
    }, this.idleMs);
    entry.idle.unref?.();
  }

  private drop(key: string, entry: Entry): void {
    if (entry.idle) clearTimeout(entry.idle);
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
}
