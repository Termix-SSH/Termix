import { execChannel, getSessionSftp, type SSHSession } from "./session.js";

/** The SFTP login directory also respects custom homes and chroot roots. */
export async function resolveHomeDirectory(
  session: SSHSession,
): Promise<string> {
  try {
    const sftp = await getSessionSftp(session);
    return await new Promise<string>((resolve, reject) => {
      sftp.realpath(".", (error, path) => {
        if (error) reject(error);
        else if (!path) reject(new Error("Empty SFTP login directory"));
        else resolve(path);
      });
    });
  } catch {
    // Keep the existing shell-only file browser usable without SFTP.
    return new Promise<string>((resolve, reject) => {
      execChannel(session, "pwd -P", (error, stream) => {
        if (error) return reject(error);
        let output = "";
        stream.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        stream.on("error", reject);
        stream.on("close", (code: number) => {
          const path = output.replace(/[\r\n]+$/, "");
          if (code !== 0 || !path.startsWith("/")) {
            reject(new Error("Could not resolve the remote login directory"));
          } else resolve(path);
        });
      });
    });
  }
}
