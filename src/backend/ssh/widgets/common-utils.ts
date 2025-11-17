import type { Client } from "ssh2";

export function execCommand(
  client: Client,
  command: string,
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolve, reject) => {
    client.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      stream
        .on("close", (code: number | undefined) => {
          exitCode = typeof code === "number" ? code : null;
          resolve({ stdout, stderr, code: exitCode });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });
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
