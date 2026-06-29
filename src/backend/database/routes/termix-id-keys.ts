// Pure, dependency-free helpers for SSH public-key parsing/classification used
// by the Termix ID routes. Kept separate so they can be unit-tested in isolation.

// Upper bound on an accepted public-key line. Public keys are tiny (an RSA-4096
// line is ~720 chars); this caps the value the unauthenticated resolver later
// streams, preventing a multi-MB blob being stored and amplified.
export const MAX_PUBLIC_KEY_LENGTH = 8192;

// Normalized algorithm groups, used both for storage and for the `/<ALGO>`
// resolver filter (mirrors sshid.io's RSA/ED25519/ECDSA suffixes).
export const ALGO_GROUPS: Record<string, string> = {
  "ssh-rsa": "RSA",
  "rsa-sha2-256": "RSA",
  "rsa-sha2-512": "RSA",
  "ssh-dss": "DSA",
  "ssh-ed25519": "ED25519",
  "sk-ssh-ed25519@openssh.com": "ED25519-SK",
  "ecdsa-sha2-nistp256": "ECDSA",
  "ecdsa-sha2-nistp384": "ECDSA",
  "ecdsa-sha2-nistp521": "ECDSA",
  "sk-ecdsa-sha2-nistp256@openssh.com": "ECDSA-SK",
};

export function classifyAlgo(type: string): string {
  if (ALGO_GROUPS[type]) return ALGO_GROUPS[type];
  if (type.startsWith("ecdsa-")) return "ECDSA";
  if (type.includes("ed25519")) return "ED25519";
  if (type.includes("rsa")) return "RSA";
  if (type.includes("dss") || type.includes("dsa")) return "DSA";
  return type.toUpperCase();
}

export interface ParsedPublicKey {
  type: string;
  algorithm: string;
  comment: string;
  normalized: string; // "<type> <base64blob>"
}

/**
 * Parse and validate a single OpenSSH public key line. Returns null when the
 * input is not a well-formed public key.
 */
export function parsePublicKey(
  raw: string | null | undefined,
): ParsedPublicKey | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_PUBLIC_KEY_LENGTH) return null;
  const line = raw.trim().replace(/\s+/g, " ");
  if (!line) return null;

  const parts = line.split(" ");
  if (parts.length < 2) return null;

  const [type, blob, ...rest] = parts;
  if (!/^[A-Za-z0-9@.-]+$/.test(type)) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) return null;

  const decoded = Buffer.from(blob, "base64");
  // The blob is an SSH wire-format string whose first field repeats the type.
  if (decoded.length < 8) return null;
  try {
    const len = decoded.readUInt32BE(0);
    if (len <= 0 || len > 64 || 4 + len > decoded.length) return null;
    const embeddedType = decoded.toString("utf8", 4, 4 + len);
    if (embeddedType !== type) return null;
  } catch {
    return null;
  }

  return {
    type,
    algorithm: classifyAlgo(type),
    comment: rest.join(" "),
    normalized: `${type} ${blob}`,
  };
}

/**
 * Whether a key's normalized algorithm group matches a `/<ALGO>` resolver
 * filter. Exact match only — `ED25519` must NOT also return `ED25519-SK`.
 */
export function matchesAlgoFilter(
  algorithm: string,
  filter: string | null,
): boolean {
  if (!filter) return true;
  return algorithm.toUpperCase() === filter.toUpperCase();
}
