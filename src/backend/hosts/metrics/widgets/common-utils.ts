import type { Client, ClientChannel } from "ssh2";

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
    let stream: ClientChannel | null = null;

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
        } catch {
          // expected - cleanup errors ignored
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

export type HostPlatform = "darwin" | "linux" | "windows" | "other";

// Windows OpenSSH's default shell is usually cmd.exe (occasionally
// PowerShell), so scripts are sent base64-encoded via -EncodedCommand -
// that avoids every cmd.exe quoting/escaping pitfall entirely, since the
// argument ends up being plain alphanumeric text with no shell metacharacters.
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function execPowerShell(
  client: Client,
  script: string,
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const encoded = encodePowerShellCommand(script);
  return execCommand(
    client,
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    timeoutMs,
  );
}

export async function detectPlatform(client: Client): Promise<HostPlatform> {
  try {
    const { stdout, code } = await execCommand(client, "uname -s", 10000);
    const kernel = stdout.trim().toLowerCase();
    if (kernel === "darwin") return "darwin";
    if (kernel === "linux") return "linux";
    if (code === 0 && kernel) return "other";
  } catch {
    // expected on hosts with no POSIX shell (e.g. Windows via cmd.exe)
  }

  try {
    const { stdout } = await execPowerShell(client, "'WIN_OK'", 10000);
    if (stdout.includes("WIN_OK")) return "windows";
  } catch {
    // expected on hosts with no PowerShell available
  }

  return "other";
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
