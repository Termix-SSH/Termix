import { describe, expect, it } from "vitest";
import { hostKeyFingerprint } from "@/lib/host-key-fingerprint";

describe("hostKeyFingerprint", () => {
  it("matches ssh-keygen -lf for an ed25519 key", () => {
    const hex =
      "0000000b7373682d656432353531390000002068baf48c33774769fc29e545d108119da4c6186dffb0b00fe887316935630379";
    expect(hostKeyFingerprint(hex)).toBe(
      "SHA256:4AQQyjAyA8CDb9y/vb1q02wyz6f8tagQ4qK41tmJ/d8",
    );
  });

  it("leaves values that are not hex alone", () => {
    expect(hostKeyFingerprint("")).toBe("");
    expect(hostKeyFingerprint("SHA256:abc")).toBe("SHA256:abc");
  });
});
