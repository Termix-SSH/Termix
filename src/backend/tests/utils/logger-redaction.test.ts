import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger, redactError, redactText } from "../../utils/logger.js";

const SECRETS = {
  apiKey: "tmx_133e04763421c80f9fc939cd3acb8de2",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1In0.c2lnbmF0dXJlLXZhbHVl",
  pem: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----",
  sealed: "sysenc:v1:aXY=:dGFn:Y2lwaGVy",
  password: "hunter2-pass",
};

function captured(): string {
  return [
    ...vi.mocked(console.log).mock.calls,
    ...vi.mocked(console.error).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
  ]
    .flat()
    .map(String)
    .join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("log redaction", () => {
  it("masks secrets inside free text", () => {
    const text = redactText(
      `key ${SECRETS.apiKey} auth Bearer ${SECRETS.jwt} url https://bob:${SECRETS.password}@db/x?token=abc&page=2 ${SECRETS.sealed}`,
    );
    for (const secret of [
      SECRETS.apiKey,
      SECRETS.jwt,
      SECRETS.password,
      SECRETS.sealed,
      "token=abc",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("page=2");
  });

  it("masks a private key in an error message and its stack", () => {
    const out = redactError(new Error(`bad key ${SECRETS.pem}`));
    expect(out).not.toContain("b3BlbnNzaC1rZXk=");
    expect(out).toContain("[PRIVATE KEY]");
  });

  it("never prints secrets passed to a logger", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new Logger("TEST", "t", "#ffffff");

    logger.info(`login with ${SECRETS.apiKey}`, {
      operation: "op",
      error: `upstream said Bearer ${SECRETS.jwt}`,
    });
    logger.error(
      "connect failed",
      new Error(`auth failed for ${SECRETS.password}@ ${SECRETS.pem}`),
      { operation: "op", nested: { clientSecret: SECRETS.password } },
    );
    logger.warn("plain object", {
      operation: "op",
      Authorization: `Bearer ${SECRETS.jwt}`,
    });

    const out = captured();
    expect(out).not.toContain(SECRETS.apiKey);
    expect(out).not.toContain(SECRETS.jwt);
    expect(out).not.toContain("b3BlbnNzaC1rZXk=");
  });

  it("masks sensitive keys at any depth, whatever their case", () => {
    const out = redactError({
      config: { Password: SECRETS.password, headers: { Cookie: "jwt=x" } },
      list: [{ accessToken: "abc" }],
    });
    expect(out).not.toContain(SECRETS.password);
    expect(out).not.toContain("jwt=x");
    expect(out).not.toContain("'abc'");
  });
});
