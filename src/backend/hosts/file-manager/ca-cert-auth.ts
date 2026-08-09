import type { Client as SSHClient, ConnectConfig } from "ssh2";
import { fileLogger } from "../../utils/logger.js";

/**
 * Attaches a user-managed CA-signed certificate to an SFTP connection, if the
 * host carries one.
 *
 * The terminal has always done this. The file manager never did: it imports
 * and calls `setupOPKSSHCertAuth`, but `setupCACertAuth` — the sibling helper
 * for user-managed `-cert.pub` files — had no call site here at all. A host
 * whose key is paired with a CA-signed certificate therefore authenticated in
 * a terminal and failed in the file manager, while OPKSSH certificates worked
 * in both. That asymmetry is the whole bug.
 *
 * `cert_public_key` is a column on `ssh_data` but is not part of the shared
 * `Host` type, so callers pass whichever record they hold and it is read off
 * structurally — the same way the terminal reads it.
 *
 * A certificate that cannot be applied is logged and skipped rather than
 * failing the connection: the private key alone may still be accepted, which
 * is exactly what happened before any of this was wired up.
 */
export async function applyCACertIfPresent(
  config: Record<string, unknown>,
  client: SSHClient,
  privateKey: Buffer | string,
  source: { certPublicKey?: string | null },
  username: string,
  passphrase?: string,
): Promise<void> {
  const certPublicKey = source.certPublicKey;
  if (!certPublicKey || !certPublicKey.trim()) return;

  try {
    const { setupCACertAuth } = await import("../opkssh-cert-auth.js");
    await setupCACertAuth(
      config as ConnectConfig,
      client,
      privateKey,
      certPublicKey,
      username,
      passphrase,
    );
  } catch (certError) {
    fileLogger.warn("CA certificate setup failed, continuing with key only", {
      operation: "sftp_ca_cert_auth_failed",
      error: certError instanceof Error ? certError.message : "Unknown error",
    });
  }
}
