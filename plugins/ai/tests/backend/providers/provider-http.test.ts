import { describe, expect, it, vi } from "vitest";
import {
  createProviderFetch,
  describeProviderError,
} from "../../../src/backend/providers/http.js";
import { AiProviderError } from "../../../src/backend/providers/types.js";
import { PRIVATE_DESTINATION_MESSAGE } from "../../../src/backend/egress.js";

describe("createProviderFetch", () => {
  it("sends provider requests through ctx.fetch with the admin allowlist", async () => {
    const response = new Response("{}");
    const fetch = vi.fn(async () => response);
    const controller = new AbortController();
    const providerFetch = createProviderFetch(fetch, ["192.168.1.50"]);

    await expect(
      providerFetch("http://192.168.1.50:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      }),
    ).resolves.toBe(response);

    expect(fetch).toHaveBeenCalledWith(
      "http://192.168.1.50:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: controller.signal,
        allowPrivateHosts: ["192.168.1.50"],
      }),
    );
  });

  it("refuses a private address the admin has not allowed, before any request", async () => {
    const fetch = vi.fn();
    const providerFetch = createProviderFetch(fetch, ["localhost"]);

    await expect(
      providerFetch("http://10.0.0.9:11434/api/tags", { method: "GET" }),
    ).rejects.toThrow(PRIVATE_DESTINATION_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains a hostname that resolved to a private address", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("Private destinations are not allowed");
    });
    const providerFetch = createProviderFetch(fetch, []);

    await expect(
      providerFetch("https://ollama.example.com/api/tags", { method: "GET" }),
    ).rejects.toThrow(PRIVATE_DESTINATION_MESSAGE);
  });

  it("passes other failures through unchanged", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const providerFetch = createProviderFetch(fetch, []);

    await expect(
      providerFetch("https://api.openai.com/v1/models", { method: "GET" }),
    ).rejects.toThrow("socket hang up");
  });
});

describe("describeProviderError", () => {
  const undiciError = (message: string, cause?: unknown) =>
    Object.assign(new TypeError(message), { cause });

  it("explains a body that went quiet instead of a bare terminated", () => {
    const error = undiciError(
      "terminated",
      Object.assign(new Error("Body Timeout Error"), {
        code: "UND_ERR_BODY_TIMEOUT",
      }),
    );
    expect(describeProviderError(error, "fallback")).toMatch(
      /stopped sending data/,
    );
  });

  it("explains a refused connection", () => {
    const error = undiciError(
      "fetch failed",
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    );
    expect(describeProviderError(error, "fallback")).toMatch(/refused/);
  });

  it("maps a private address refused after DNS to the allowlist hint", () => {
    const error = undiciError(
      "fetch failed",
      new Error("Private destinations are not allowed"),
    );
    expect(describeProviderError(error, "fallback")).toBe(
      PRIVATE_DESTINATION_MESSAGE,
    );
  });

  it("names the cause of an unfamiliar fetch failure", () => {
    const error = undiciError("fetch failed", new Error("something odd"));
    expect(describeProviderError(error, "fallback")).toBe(
      "The provider request failed: something odd",
    );
  });

  it("keeps a provider error's own message", () => {
    expect(
      describeProviderError(new AiProviderError("bad key", 401), "fallback"),
    ).toBe("bad key");
  });
});
