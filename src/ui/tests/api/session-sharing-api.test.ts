import { describe, expect, it, vi, beforeEach } from "vitest";

const axiosGetMock = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: (err: unknown): err is { response?: { status?: number } } =>
      typeof err === "object" && err !== null && "response" in err,
  },
}));

vi.mock("@/lib/base-path", () => ({
  getBasePath: () => "",
}));

vi.mock("@/lib/electron", () => ({
  isElectron: () => false,
}));

vi.mock("@/main-axios", () => ({
  getServerConfig: vi.fn(async () => null),
}));

import {
  resolveShareLink,
  ShareLinkError,
} from "../../api/session-sharing-api";

beforeEach(() => {
  axiosGetMock.mockReset();
});

describe("resolveShareLink", () => {
  it("returns the resolved share data on success", async () => {
    axiosGetMock.mockResolvedValueOnce({
      data: {
        protocol: "ssh",
        permissionLevel: "read-write",
        wsPath: "/terminal/ws?shareToken=abc123",
      },
    });

    const result = await resolveShareLink("abc123");

    expect(result).toEqual({
      protocol: "ssh",
      permissionLevel: "read-write",
      wsPath: "/terminal/ws?shareToken=abc123",
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining("/session-sharing/resolve/abc123"),
    );
  });

  it("throws a not-found ShareLinkError on 404", async () => {
    axiosGetMock.mockRejectedValueOnce({ response: { status: 404 } });

    await expect(resolveShareLink("bad-token")).rejects.toMatchObject({
      kind: "not-found",
    });
    await expect(resolveShareLink("bad-token")).rejects.toBeInstanceOf(
      ShareLinkError,
    );
  });

  it("throws a rate-limited ShareLinkError on 429", async () => {
    axiosGetMock.mockRejectedValueOnce({ response: { status: 429 } });

    await expect(resolveShareLink("token")).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });

  it("throws a generic ShareLinkError on unexpected failures", async () => {
    axiosGetMock.mockRejectedValueOnce(new Error("network down"));

    await expect(resolveShareLink("token")).rejects.toMatchObject({
      kind: "unknown",
    });
  });

  it("URL-encodes the link token", async () => {
    axiosGetMock.mockResolvedValueOnce({
      data: { protocol: "ssh", permissionLevel: "read-only", wsPath: "" },
    });

    await resolveShareLink("a/b c");

    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("a/b c")),
    );
  });
});
