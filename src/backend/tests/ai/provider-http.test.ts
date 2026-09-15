import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProxy = vi.fn();
const getFetchDispatcher = vi.fn();
const safeOutboundFetch = vi.fn();
const readPrivateAllowlist = vi.fn();
const evaluateEgress = vi.fn();
const globalFetch = vi.fn();

vi.mock("../../utils/proxy-agent.js", () => ({
  fetchWithProxy,
  getFetchDispatcher,
}));
vi.mock("../../utils/safe-outbound-fetch.js", () => ({ safeOutboundFetch }));
vi.mock("../../ai/egress.js", () => ({
  readPrivateAllowlist,
  evaluateEgress,
}));

const { providerFetch } = await import("../../ai/providers/http.js");

describe("providerFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", globalFetch);
    readPrivateAllowlist.mockResolvedValue(["192.168.1.50"]);
  });

  it("uses the matching Undici fetch implementation for private providers", async () => {
    const response = { ok: true, status: 200 } as Response;
    const init = { method: "GET" };
    evaluateEgress.mockReturnValue({ allowed: true, isPrivate: true });
    fetchWithProxy.mockResolvedValue(response);

    await expect(
      providerFetch("http://192.168.1.50:11434/api/tags", init),
    ).resolves.toBe(response);

    expect(fetchWithProxy).toHaveBeenCalledWith(
      "http://192.168.1.50:11434/api/tags",
      init,
    );
    expect(globalFetch).not.toHaveBeenCalled();
    expect(safeOutboundFetch).not.toHaveBeenCalled();
  });
});
