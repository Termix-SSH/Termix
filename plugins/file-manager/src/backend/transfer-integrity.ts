import { createHash } from "node:crypto";

type SFTPWrapper = import("ssh2").SFTPWrapper;

export interface TransferIntegrityResult {
  algorithm: "sha256";
  digest: string;
}

export async function hashSftpFile(
  sftp: SFTPWrapper,
  path: string,
  shouldAbort: () => boolean = () => false,
  createAbortError: () => Error = () => new Error("Transfer cancelled"),
): Promise<string> {
  const stream = sftp.createReadStream(path);
  const hash = createHash("sha256");

  try {
    for await (const chunk of stream) {
      if (shouldAbort()) {
        const error = createAbortError();
        stream.destroy(error);
        throw error;
      }
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }

  if (shouldAbort()) throw createAbortError();
  return hash.digest("hex");
}

export async function verifySftpFileIntegrity(
  sourceSftp: SFTPWrapper,
  destSftp: SFTPWrapper,
  sourcePath: string,
  destPath: string,
  shouldAbort: () => boolean = () => false,
  createAbortError: () => Error = () => new Error("Transfer cancelled"),
): Promise<TransferIntegrityResult> {
  const [sourceDigest, destDigest] = await Promise.all([
    hashSftpFile(sourceSftp, sourcePath, shouldAbort, createAbortError),
    hashSftpFile(destSftp, destPath, shouldAbort, createAbortError),
  ]);

  if (sourceDigest !== destDigest) {
    throw new Error(`SHA-256 verification failed for ${sourcePath}`);
  }

  return { algorithm: "sha256", digest: sourceDigest };
}
