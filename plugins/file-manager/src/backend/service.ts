import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  promisifySftpMkdir,
  promisifySftpReaddir,
  promisifySftpStat,
  promisifySftpUnlink,
  promisifySftpRmdir,
} from "./sftp-promisify.js";

const DEFAULT_DIR_MODE = 0o755;
import type { SSHSession } from "./session.js";

/** What other plugins get from ctx.services.get("files.sftp", {userId}). */
export interface FilesService {
  list: (
    hostId: number,
    path: string,
  ) => Promise<
    Array<{ name: string; type: "file" | "directory" | "link"; size?: number }>
  >;
  read: (hostId: number, path: string) => Promise<string>;
  write: (hostId: number, path: string, content: string) => Promise<void>;
  stat: (
    hostId: number,
    path: string,
  ) => Promise<{ size: number; isDirectory: boolean; mtime: number }>;
  delete: (hostId: number, path: string) => Promise<void>;
  mkdir: (hostId: number, path: string) => Promise<void>;
}

/**
 * A short-lived SFTP connection for a service call, outside the browse
 * session map: a caller reaches this from any request the acting user makes,
 * not necessarily one that has an open file-manager tab.
 */
async function withServiceSftp<T>(
  ctx: PluginContext,
  hostId: number,
  fn: (sftp: import("ssh2").SFTPWrapper) => Promise<T>,
): Promise<T> {
  return ctx.ssh.withConnection<T, import("ssh2").Client>(
    hostId,
    {
      pool: "file-manager-service",
      purpose: "file-manager",
      profile: "session",
    },
    (client) =>
      new Promise<T>((resolve, reject) => {
        client.sftp(async (err, sftp) => {
          if (err) return reject(err);
          try {
            resolve(await fn(sftp));
          } catch (error) {
            reject(error);
          }
        });
      }),
  );
}

export function createFilesService(
  ctx: PluginContext,
  deps: {
    sshSessions: Record<string, SSHSession>;
    verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
  },
): FilesService {
  void deps;
  return {
    async list(hostId, path) {
      return withServiceSftp(ctx, hostId, async (sftp) => {
        const entries = await promisifySftpReaddir(sftp, path);
        return entries
          .filter((e) => e.filename !== "." && e.filename !== "..")
          .map((e) => ({
            name: e.filename,
            type: e.attrs.isDirectory()
              ? ("directory" as const)
              : e.attrs.isSymbolicLink()
                ? ("link" as const)
                : ("file" as const),
            size: e.attrs.isDirectory() ? undefined : e.attrs.size,
          }));
      });
    },

    async read(hostId, path) {
      return withServiceSftp(
        ctx,
        hostId,
        (sftp) =>
          new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            const stream = sftp.createReadStream(path);
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () =>
              resolve(Buffer.concat(chunks).toString("utf8")),
            );
            stream.on("error", reject);
          }),
      );
    },

    async write(hostId, path, content) {
      await withServiceSftp(
        ctx,
        hostId,
        (sftp) =>
          new Promise<void>((resolve, reject) => {
            const stream = sftp.createWriteStream(path, { flags: "w" });
            stream.on("close", () => resolve());
            stream.on("error", reject);
            stream.end(content, "utf8");
          }),
      );
    },

    async stat(hostId, path) {
      return withServiceSftp(ctx, hostId, async (sftp) => {
        const stats = await promisifySftpStat(sftp, path);
        return {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          mtime: stats.mtime,
        };
      });
    },

    async delete(hostId, path) {
      await withServiceSftp(ctx, hostId, async (sftp) => {
        const stats = await promisifySftpStat(sftp, path);
        if (stats.isDirectory()) {
          await promisifySftpRmdir(sftp, path);
        } else {
          await promisifySftpUnlink(sftp, path);
        }
      });
    },

    async mkdir(hostId, path) {
      await withServiceSftp(ctx, hostId, (sftp) =>
        promisifySftpMkdir(sftp, path, DEFAULT_DIR_MODE),
      );
    },
  };
}
