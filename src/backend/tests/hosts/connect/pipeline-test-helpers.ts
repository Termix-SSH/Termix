import { EventEmitter } from "node:events";
import { vi } from "vitest";

/** Stands in for ssh2's Client: records connect() and lets a test drive events. */
export class FakeSshClient extends EventEmitter {
  connectConfig: Record<string, unknown> | null = null;
  ended = false;
  forwardOut = vi.fn(
    (
      _srcIp: string,
      _srcPort: number,
      _dstIp: string,
      _dstPort: number,
      cb: (err: Error | undefined, stream: unknown) => void,
    ) => cb(undefined, { fakeStream: true }),
  );

  constructor() {
    super();
    FakeSshClient.instances.push(this);
  }

  connect(config: Record<string, unknown>) {
    this.connectConfig = config;
    const behaviour = FakeSshClient.nextBehaviour.shift() ?? "ready";
    queueMicrotask(() => {
      if (behaviour === "ready") this.emit("ready");
      else if (behaviour === "auth-fail")
        this.emit(
          "error",
          new Error("All configured authentication methods failed"),
        );
      else if (behaviour === "hang") return;
    });
    return this;
  }

  end() {
    this.ended = true;
  }

  static nextBehaviour: Array<"ready" | "auth-fail" | "hang"> = [];
  static instances: FakeSshClient[] = [];
}
