import { sha256 } from "@noble/hashes/sha2.js";

/**
 * The backend sends the raw host key as hex. This turns it into the
 * SHA256:... form ssh-keygen -lf prints, so users can compare the two.
 */
export function hostKeyFingerprint(hex: string): string {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (const byte of sha256(bytes)) binary += String.fromCharCode(byte);
  return `SHA256:${btoa(binary).replace(/=+$/, "")}`;
}
