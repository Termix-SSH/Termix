import type { Client } from "ssh2";

export function execCommand(
  client: Client,
  command: string,
  timeoutMs = 30000,
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream: any = null;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Command timeout after ${timeoutMs}ms: ${command}`));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (stream) {
        try {
          stream.removeAllListeners();
          if (stream.stderr) {
            stream.stderr.removeAllListeners();
          }
          stream.destroy();
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    };

    client.exec(command, { pty: false }, (err, _stream) => {
      if (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
        return;
      }

      stream = _stream;
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;

      stream
        .on("close", (code: number | undefined) => {
          if (!settled) {
            settled = true;
            exitCode = typeof code === "number" ? code : null;
            cleanup();
            resolve({ stdout, stderr, code: exitCode });
          }
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        })
        .on("error", (streamErr: Error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(streamErr);
          }
        });

      if (stream.stderr) {
        stream.stderr
          .on("data", (data: Buffer) => {
            stderr += data.toString("utf8");
          })
          .on("error", (stderrErr: Error) => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(stderrErr);
            }
          });
      }
    });
  });
}

export function toFixedNum(
  n: number | null | undefined,
  digits = 2,
): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

export function kibToGiB(kib: number): number {
  return kib / (1024 * 1024);
}
