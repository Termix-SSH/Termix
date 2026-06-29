import { describe, expect, it } from "vitest";
import {
  isValidServiceLinkUrl,
  normalizeServiceLinkUrl,
} from "./service-link-url.js";

describe("service link URL handling", () => {
  it("keeps explicit http and https URLs", () => {
    expect(normalizeServiceLinkUrl("https://example.com")).toBe(
      "https://example.com",
    );
    expect(normalizeServiceLinkUrl("http://192.168.1.10:8080")).toBe(
      "http://192.168.1.10:8080",
    );
  });

  it("adds http to bare service addresses", () => {
    expect(normalizeServiceLinkUrl("192.168.1.10:8080")).toBe(
      "http://192.168.1.10:8080",
    );
    expect(normalizeServiceLinkUrl("termix.local")).toBe("http://termix.local");
  });

  it("rejects unsupported schemes", () => {
    expect(isValidServiceLinkUrl("ssh://example.com")).toBe(false);
    expect(isValidServiceLinkUrl("javascript:alert(1)")).toBe(false);
  });
});
