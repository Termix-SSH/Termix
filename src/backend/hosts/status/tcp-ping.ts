import net from "net";
import type { Client } from "ssh2";

/**
 * Opens a TCP connection and closes it again. SSH probes exchange banners,
 * but still close before authentication and may trigger aggressive Fail2Ban rules.
 */
export function tcpPing(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const cleanup = () => {
      try {
        socket.destroy();
      } catch {
        // expected
      }
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      const dataTimeout = setTimeout(() => {
        cleanup();
        finish(true);
      }, 2000);

      socket.once("data", (data) => {
        clearTimeout(dataTimeout);
        if (data.toString("utf8").startsWith("SSH-")) {
          try {
            socket.end("SSH-2.0-TermixHealthCheck\r\n");
          } catch {
            // expected
          }
          setTimeout(cleanup, 200);
        } else {
          cleanup();
        }
        finish(true);
      });
    });

    socket.once("timeout", () => {
      cleanup();
      finish(false);
    });
    socket.once("error", () => {
      cleanup();
      finish(false);
    });
    socket.connect(port, host);
  });
}

/**
 * "refused" means the last hop answered that the target is down. "timeout"
 * means the hop never answered, so the chain itself may be dead.
 */
export type JumpPingResult = "ok" | "refused" | "timeout";

export function tcpPingThroughJumpHostResult(
  jumpClient: Pick<Client, "forwardOut" | "end">,
  host: string,
  port: number,
  timeoutMs = 5000,
  keepOpen = false,
): Promise<JumpPingResult> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: JumpPingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!keepOpen) jumpClient.end();
      resolve(result);
    };

    const timeout = setTimeout(() => finish("timeout"), timeoutMs);

    jumpClient.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
      stream?.destroy();
      finish(!error && !!stream ? "ok" : "refused");
    });
  });
}

/** The same check from the far end of a jump host chain. Ends the chain. */
export async function tcpPingThroughJumpHost(
  jumpClient: Pick<Client, "forwardOut" | "end">,
  host: string,
  port: number,
  timeoutMs = 5000,
  keepOpen = false,
): Promise<boolean> {
  return (
    (await tcpPingThroughJumpHostResult(
      jumpClient,
      host,
      port,
      timeoutMs,
      keepOpen,
    )) === "ok"
  );
}
