import { describe, expect, it } from "vitest";
import { REDACTED, redact, redactString } from "../../ai/redaction.js";

describe("redact", () => {
  it("drops secret-named fields at any depth", () => {
    const input = {
      name: "web-1",
      password: "hunter2",
      nested: { privateKey: "abc", apiKey: "def", port: 22 },
      list: [{ keyPassword: "xyz", label: "ok" }],
    };

    const output = redact(input) as any;

    expect(output.name).toBe("web-1");
    expect(output.password).toBe(REDACTED);
    expect(output.nested.privateKey).toBe(REDACTED);
    expect(output.nested.apiKey).toBe(REDACTED);
    expect(output.nested.port).toBe(22);
    expect(output.list[0].keyPassword).toBe(REDACTED);
    expect(output.list[0].label).toBe("ok");
  });

  it("keeps a null secret null so absence stays distinguishable", () => {
    const output = redact({ password: null }) as any;
    expect(output.password).toBeNull();
  });

  it("leaves ordinary values untouched", () => {
    const input = { id: 4, enabled: true, tags: ["a", "b"], note: null };
    expect(redact(input)).toEqual(input);
  });

  it("does not recurse forever on a cyclic object", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });
});

describe("redactString", () => {
  it("masks private key blocks", () => {
    const text =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactString(text)).toBe("[redacted private key]");
  });

  it("masks provider api keys", () => {
    expect(redactString("key is sk-abcdefghijklmnopqrst here")).toContain(
      "[redacted api key]",
    );
    expect(redactString("key is sk-ant-abcdefghijklmnopqrst here")).toContain(
      "[redacted api key]",
    );
  });

  it("masks bearer tokens and jwts", () => {
    expect(
      redactString("Authorization: Bearer abcdefghijklmnopqrst"),
    ).toContain("Bearer [redacted]");
    expect(
      redactString("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh"),
    ).toContain("[redacted token]");
  });

  it("masks Termix api keys", () => {
    expect(redactString("tmx_abcdefghijklmnopqrstuvwx")).toContain(
      "[redacted token]",
    );
  });

  it("leaves ordinary prose alone", () => {
    const text = "The disk on web-1 is 82 percent full.";
    expect(redactString(text)).toBe(text);
  });
});
