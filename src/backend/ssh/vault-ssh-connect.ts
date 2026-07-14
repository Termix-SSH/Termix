import type { Client, ConnectConfig } from "ssh2";

type VaultAuthHost = {
  id: number;
  username: string;
  userId?: string | null;
  vaultProfile?: { id?: number | null } | null;
};

export async function setupVaultSshSignerAuth(
  config: ConnectConfig,
  client: Client,
  host: VaultAuthHost,
): Promise<void> {
  if (!host.userId) {
    throw new Error("Vault SSH signer authentication requires a user session");
  }

  const vaultProfileId = host.vaultProfile?.id;
  if (!vaultProfileId) {
    throw new Error("Host has no Vault signer profile configured");
  }

  const { getVaultCert } = await import("./vault-signer-auth.js");
  const cert = await getVaultCert(host.userId, vaultProfileId);
  if (!cert) {
    throw new Error(
      "Vault SSH signer authentication required. Please open a Terminal connection first.",
    );
  }

  const { setupOPKSSHCertAuth } = await import("./opkssh-cert-auth.js");
  await setupOPKSSHCertAuth(
    config,
    client,
    { privateKey: cert.privateKey, sshCert: cert.sshCert },
    host.username,
  );
}
