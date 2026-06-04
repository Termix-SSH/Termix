import type { Client as SSHClient } from "ssh2";

// Serializes SSH channel open requests so only one channel negotiation is
// in-flight at a time per session. Once the channel is established the slot
// is released immediately so the next open can proceed; the channels
// themselves remain open concurrently.
export class ChannelOpenSerializer {
  private tail: Promise<void> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(
      () => action(),
      () => action(),
    );
    this.tail = next.then(
      () => {},
      () => {},
    );
    return next;
  }
}

export interface SSHSession {
  client: SSHClient;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  sudoPassword?: string;
  sftp?: import("ssh2").SFTPWrapper;
  sftpPending?: Promise<import("ssh2").SFTPWrapper>;
  channelOpener: ChannelOpenSerializer;
  poolKey?: string;
  userId?: string;
  hostId?: number;
  ip?: string;
  port?: number;
  username?: string;
  transferDedicated?: boolean;
  transferId?: string;
  browseSessionId?: string;
}

export interface PendingTOTPSession {
  client: SSHClient;
  finish: (responses: string[]) => void;
  config: import("ssh2").ConnectConfig;
  createdAt: number;
  sessionId: string;
  hostId?: number;
  ip?: string;
  port?: number;
  username?: string;
  userId?: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
  totpPromptIndex?: number;
  resolvedPassword?: string;
  totpAttempts: number;
  isWarpgate?: boolean;
}

export function execWithSudo(
  session: SSHSession,
  command: string,
  sudoPassword: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return execWithSudoBuffer(session, command, sudoPassword).then((result) => ({
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr,
    code: result.code,
  }));
}

export function execWithSudoBuffer(
  session: SSHSession,
  command: string,
  sudoPassword: string,
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const escapedPassword = sudoPassword.replace(/'/g, "'\"'\"'");
    const sudoCommand = `echo '${escapedPassword}' | sudo -S ${command} 2>&1`;

    execChannel(session, sudoCommand, (err, stream) => {
      if (err) {
        resolve({ stdout: Buffer.alloc(0), stderr: err.message, code: 1 });
        return;
      }

      const stdoutChunks: Buffer[] = [];
      let stderr = "";

      stream.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      stream.on("close", (code: number) => {
        let stdout = Buffer.concat(stdoutChunks);
        const sudoPromptMatch = stdout
          .toString("utf8", 0, Math.min(stdout.length, 256))
          .match(/^\[sudo\] password for .+?:\s*/);
        if (sudoPromptMatch) {
          stdout = stdout.subarray(Buffer.byteLength(sudoPromptMatch[0]));
        }
        resolve({ stdout, stderr, code: code || 0 });
      });

      stream.on("error", (streamErr: Error) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: streamErr.message,
          code: 1,
        });
      });
    });
  });
}

export function getSessionSftp(
  session: SSHSession,
): Promise<import("ssh2").SFTPWrapper> {
  if (session.sftp) {
    return Promise.resolve(session.sftp);
  }

  if (session.sftpPending) {
    return session.sftpPending;
  }

  const openOnce = (): Promise<import("ssh2").SFTPWrapper> =>
    session.channelOpener.run(
      () =>
        new Promise<import("ssh2").SFTPWrapper>((resolve, reject) => {
          session.client.sftp((err, sftp) => {
            if (err) return reject(err);
            session.sftp = sftp;
            sftp.on("error", () => {
              session.sftp = undefined;
            });
            sftp.on("close", () => {
              session.sftp = undefined;
            });
            resolve(sftp);
          });
        }),
    );

  session.sftpPending = openOnce()
    .catch((err: Error) => {
      const isChannelFailure =
        err.message.toLowerCase().includes("channel open failure") ||
        err.message.toLowerCase().includes("open failed");
      if (isChannelFailure) {
        return new Promise<import("ssh2").SFTPWrapper>((resolve, reject) =>
          setTimeout(() => openOnce().then(resolve, reject), 500),
        );
      }
      return Promise.reject(err);
    })
    .finally(() => {
      session.sftpPending = undefined;
    });

  return session.sftpPending;
}

export function execChannel(
  session: SSHSession,
  command: string,
  callback: (
    err: Error | undefined,
    stream: import("ssh2").ClientChannel,
  ) => void,
): void {
  session.channelOpener
    .run(
      () =>
        new Promise<import("ssh2").ClientChannel>((resolve, reject) => {
          session.client.exec(command, (err, stream) => {
            if (err) return reject(err);
            resolve(stream);
          });
        }),
    )
    .then(
      (stream) => callback(undefined, stream),
      (err: Error) => callback(err, undefined as never),
    );
}
