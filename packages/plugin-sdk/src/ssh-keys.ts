/**
 * SSH key helpers for plugins that make, check or deploy keys: generate a key
 * pair, tell what a key is, derive a public key and check a pair belongs
 * together. Pure functions over ssh2, which the host supplies. Core keeps its
 * own copy for the connect pipeline.
 */

import ssh2 from "ssh2";

export type SshKeyKind = "ssh-ed25519" | "ssh-rsa" | "ecdsa-sha2-nistp256";

export interface GeneratedSshKeyPair {
  privateKey: string;
  publicKey: string;
  keyType: SshKeyKind;
}

export interface GenerateSshKeyPairOptions {
  /** RSA only. 2048 to 8192, default 4096. */
  bits?: number;
  passphrase?: string;
  comment?: string;
}

/** Makes a new key pair; the public half is one authorized_keys line. */
export function generateSshKeyPair(
  type: SshKeyKind,
  options: GenerateSshKeyPairOptions = {},
): GeneratedSshKeyPair {
  const algorithm =
    type === "ssh-rsa" ? "rsa" : type === "ssh-ed25519" ? "ed25519" : "ecdsa";
  if (
    type !== "ssh-rsa" &&
    type !== "ssh-ed25519" &&
    type !== "ecdsa-sha2-nistp256"
  ) {
    throw new Error(`Unsupported key type: ${String(type)}`);
  }
  const generateOptions: Record<string, unknown> = {
    comment: options.comment ?? "",
  };
  if (options.passphrase) {
    generateOptions.passphrase = options.passphrase;
    generateOptions.cipher = "aes256-ctr";
  }
  if (type === "ssh-rsa") {
    const bits = options.bits ?? 4096;
    if (!Number.isInteger(bits) || bits < 2048 || bits > 8192) {
      throw new Error("RSA keys need 2048 to 8192 bits");
    }
    generateOptions.bits = bits;
  }
  if (type === "ecdsa-sha2-nistp256") generateOptions.bits = 256;

  const pair = ssh2.utils.generateKeyPairSync(
    algorithm as "rsa",
    generateOptions as never,
  );
  return {
    privateKey: pair.private,
    publicKey: pair.public.trim(),
    keyType: type,
  };
}

function parse(key: string, passphrase?: string) {
  const parsed = ssh2.utils.parseKey(key.trim(), passphrase || undefined);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first || first instanceof Error) {
    throw first instanceof Error ? first : new Error("Not a readable SSH key");
  }
  return first;
}

/** The key's algorithm, like "ssh-ed25519", or null when it cannot be read. */
export function detectSshKeyType(
  key: string,
  passphrase?: string,
): string | null {
  try {
    return parse(key, passphrase).type;
  } catch {
    return null;
  }
}

/** The authorized_keys line for a private key, or null. */
export function publicKeyFromPrivate(
  privateKey: string,
  passphrase?: string,
): string | null {
  try {
    const parsed = parse(privateKey, passphrase);
    return `${parsed.type} ${parsed.getPublicSSH().toString("base64")}`;
  } catch {
    return null;
  }
}

/** Whether a public key line belongs to the private key. */
export function validateSshKeyPair(
  privateKey: string,
  publicKey: string,
  passphrase?: string,
): { isValid: boolean; error?: string } {
  try {
    const priv = parse(privateKey, passphrase);
    const pub = parse(publicKey);
    const same = priv.getPublicSSH().equals(pub.getPublicSSH());
    return same
      ? { isValid: true }
      : {
          isValid: false,
          error: "The public key does not match the private key",
        };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
