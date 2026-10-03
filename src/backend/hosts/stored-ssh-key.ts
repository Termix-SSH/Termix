import { parseSSHKey, type KeyInfo } from "../utils/ssh-key-utils.js";
import {
  isSecretReference,
  resolveSecretReference,
} from "./external-secrets.js";

/**
 * Checks a private key before it is saved. A secret reference (op://...) is
 * resolved when connecting, so it is stored as given: there is nothing to
 * parse yet, and parsing the reference itself always failed (#1394).
 */
export function parseKeyForStorage(
  key: string,
  passphrase?: string | null,
): KeyInfo & { reference: boolean } {
  if (isSecretReference(key) || isSecretReference(passphrase)) {
    return {
      success: true,
      privateKey: key.trim(),
      publicKey: "",
      keyType: "",
      reference: true,
    };
  }
  return {
    ...parseSSHKey(key, passphrase ?? undefined),
    reference: false,
  };
}

/** The real key and passphrase behind any references, for key helpers. */
export async function resolveKeyReferences(
  userId: string,
  key: string,
  passphrase?: string | null,
): Promise<{ key: string; passphrase?: string }> {
  const resolve = async (value: string) =>
    isSecretReference(value) ? resolveSecretReference(userId, value) : value;
  return {
    key: await resolve(key),
    passphrase: passphrase ? await resolve(passphrase) : undefined,
  };
}
