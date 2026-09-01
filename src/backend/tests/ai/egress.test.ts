import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIVATE_ALLOWLIST,
  evaluateEgress,
  isPrivateDestination,
  parseAllowlist,
} from "../../ai/egress.js";

/**
 * The rule that lets a self-hosted Ollama work without turning the backend
 * into an authenticated probe of its own network: private destinations are
 * refused unless an admin named the host.
 */
describe("isPrivateDestination", () => {
  it("recognises loopback and private ranges", () => {
    for (const url of [
      "http://localhost:11434",
      "http://127.0.0.1:11434",
      "http://10.0.0.5:11434",
      "http://192.168.1.10:11434",
      "http://172.16.4.4:11434",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]:11434",
    ]) {
      expect(isPrivateDestination(url), url).toBe(true);
    }
  });

  it("treats public hosts as public", () => {
    for (const url of [
      "https://api.openai.com/v1",
      "https://api.anthropic.com",
      "https://generativelanguage.googleapis.com",
      "http://8.8.8.8",
    ]) {
      expect(isPrivateDestination(url), url).toBe(false);
    }
  });
});

describe("evaluateEgress", () => {
  it("allows public destinations without an allowlist entry", () => {
    const decision = evaluateEgress("https://api.openai.com/v1", []);
    expect(decision.allowed).toBe(true);
    expect(decision.isPrivate).toBe(false);
  });

  it("refuses a private destination that is not allowlisted", () => {
    const decision = evaluateEgress("http://192.168.1.50:11434", ["localhost"]);
    expect(decision.allowed).toBe(false);
    expect(decision.isPrivate).toBe(true);
    expect(decision.reason).toContain("allowlist");
  });

  it("allows a private destination once its host is allowlisted", () => {
    const decision = evaluateEgress("http://localhost:11434", [
      "localhost",
      "127.0.0.1",
    ]);
    expect(decision.allowed).toBe(true);
    expect(decision.isPrivate).toBe(true);
  });

  it("matches the allowlist case-insensitively", () => {
    expect(
      evaluateEgress("http://LOCALHOST:11434", ["localhost"]).allowed,
    ).toBe(true);
  });

  it("does not let one allowlisted host authorise another", () => {
    // A cloud metadata endpoint is the classic target, so an allowlist for
    // localhost must not open 169.254.169.254.
    const decision = evaluateEgress("http://169.254.169.254/latest/meta-data", [
      "localhost",
      "127.0.0.1",
    ]);
    expect(decision.allowed).toBe(false);
  });

  it("refuses non-http protocols and embedded credentials", () => {
    expect(evaluateEgress("file:///etc/passwd", []).allowed).toBe(false);
    expect(evaluateEgress("ftp://example.com", []).allowed).toBe(false);
    expect(evaluateEgress("https://user:pass@api.openai.com", []).allowed).toBe(
      false,
    );
  });

  it("refuses a malformed url", () => {
    expect(evaluateEgress("not a url", []).allowed).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("falls back to the defaults when unset or malformed", () => {
    expect(parseAllowlist(null)).toEqual(DEFAULT_PRIVATE_ALLOWLIST);
    expect(parseAllowlist("not json")).toEqual(DEFAULT_PRIVATE_ALLOWLIST);
    expect(parseAllowlist('{"a":1}')).toEqual(DEFAULT_PRIVATE_ALLOWLIST);
  });

  it("normalises stored entries", () => {
    expect(parseAllowlist('[" LocalHost ", "", "10.0.0.5"]')).toEqual([
      "localhost",
      "10.0.0.5",
    ]);
  });

  it("honours a deliberately empty allowlist", () => {
    // An admin clearing the list must actually block everything private,
    // not silently get the defaults back.
    expect(parseAllowlist("[]")).toEqual([]);
  });
});
