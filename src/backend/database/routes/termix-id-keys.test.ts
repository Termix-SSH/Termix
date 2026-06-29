import { describe, it, expect } from "vitest";
import {
  classifyAlgo,
  parsePublicKey,
  matchesAlgoFilter,
  MAX_PUBLIC_KEY_LENGTH,
} from "./termix-id-keys.js";

// Build a valid OpenSSH public-key line for a given type by encoding a wire
// blob whose first string field equals the type (what parsePublicKey checks).
function makeKey(type: string, comment = ""): string {
  const typeBuf = Buffer.from(type, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(typeBuf.length, 0);
  const body = Buffer.alloc(40); // arbitrary trailing key material
  const blob = Buffer.concat([header, typeBuf, body]).toString("base64");
  return `${type} ${blob}${comment ? ` ${comment}` : ""}`;
}

describe("classifyAlgo", () => {
  it("maps known types to normalized groups", () => {
    expect(classifyAlgo("ssh-rsa")).toBe("RSA");
    expect(classifyAlgo("rsa-sha2-512")).toBe("RSA");
    expect(classifyAlgo("ssh-ed25519")).toBe("ED25519");
    expect(classifyAlgo("ecdsa-sha2-nistp256")).toBe("ECDSA");
    expect(classifyAlgo("ssh-dss")).toBe("DSA");
    expect(classifyAlgo("sk-ssh-ed25519@openssh.com")).toBe("ED25519-SK");
    expect(classifyAlgo("sk-ecdsa-sha2-nistp256@openssh.com")).toBe("ECDSA-SK");
  });

  it("falls back by substring for unknown variants", () => {
    expect(classifyAlgo("ecdsa-sha2-nistp999")).toBe("ECDSA");
    expect(classifyAlgo("rsa-sha2-256-cert")).toBe("RSA");
    expect(classifyAlgo("something-weird")).toBe("SOMETHING-WEIRD");
  });
});

describe("parsePublicKey", () => {
  it("parses a valid ed25519 key and extracts the comment", () => {
    const parsed = parsePublicKey(makeKey("ssh-ed25519", "alice@laptop"));
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("ssh-ed25519");
    expect(parsed?.algorithm).toBe("ED25519");
    expect(parsed?.comment).toBe("alice@laptop");
    // Comment is stripped from the normalized (dedupe) form.
    expect(parsed?.normalized.includes("alice@laptop")).toBe(false);
  });

  it("parses SK (FIDO) key types", () => {
    expect(
      parsePublicKey(makeKey("sk-ssh-ed25519@openssh.com"))?.algorithm,
    ).toBe("ED25519-SK");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["ssh-ed25519"], // missing blob
    ["ssh-ed25519 not_base64!!"], // bad base64 charset
    ["ssh-rsa AAAAB3Nz"], // blob whose embedded type != declared type
  ])("rejects malformed input %p", (input) => {
    expect(parsePublicKey(input as string)).toBeNull();
  });

  it("rejects an over-length line (amplification guard)", () => {
    const valid = makeKey("ssh-ed25519");
    const padded = valid + " " + "A".repeat(MAX_PUBLIC_KEY_LENGTH);
    expect(padded.length).toBeGreaterThan(MAX_PUBLIC_KEY_LENGTH);
    expect(parsePublicKey(padded)).toBeNull();
  });

  it("rejects a blob whose embedded type does not match the prefix", () => {
    // Declared ssh-rsa but the wire blob says ssh-ed25519.
    const blob = makeKey("ssh-ed25519").split(" ")[1];
    expect(parsePublicKey(`ssh-rsa ${blob}`)).toBeNull();
  });
});

describe("matchesAlgoFilter", () => {
  it("returns all keys when no filter", () => {
    expect(matchesAlgoFilter("ED25519", null)).toBe(true);
  });

  it("matches exactly and is case-insensitive", () => {
    expect(matchesAlgoFilter("ED25519", "ed25519")).toBe(true);
    expect(matchesAlgoFilter("RSA", "RSA")).toBe(true);
  });

  it("does NOT let ED25519 match ED25519-SK (the over-match bug)", () => {
    expect(matchesAlgoFilter("ED25519-SK", "ED25519")).toBe(false);
    expect(matchesAlgoFilter("ECDSA-SK", "ECDSA")).toBe(false);
  });
});
