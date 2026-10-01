import { describe, expect, it, vi } from "vitest";
import type { PluginFetchInit } from "@termix/plugin-sdk/backend";
import { createFetchAdapter } from "../../src/backend/acme.js";
import { createTxtRecord } from "../../src/backend/cloudflare.js";

describe("createFetchAdapter", () => {
  it("sends acme-client requests through ctx.fetch", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: PluginFetchInit) =>
        new Response('{"ok":true}', {
          status: 201,
          headers: { "replay-nonce": "n1", location: "https://ca/acct/1" },
        }),
    );
    const adapter = createFetchAdapter(fetch, ["ca.internal"]);
    const result = await adapter({
      url: "https://ca.internal/new-acct",
      method: "post",
      headers: { "Content-Type": "application/jose+json" },
      data: '{"payload":"x"}',
      validateStatus: null,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://ca.internal/new-acct",
      expect.objectContaining({
        method: "POST",
        body: '{"payload":"x"}',
        allowPrivateHosts: ["ca.internal"],
        headers: { "Content-Type": "application/jose+json" },
      }),
    );
    expect(result.status).toBe(201);
    expect(result.data).toBe('{"ok":true}');
    expect(result.headers["replay-nonce"]).toBe("n1");
  });

  it("rejects with the response attached when validateStatus says no", async () => {
    const adapter = createFetchAdapter(
      async () => new Response("slow down", { status: 429 }),
    );
    await expect(
      adapter({ url: "https://ca/x", validateStatus: () => false }),
    ).rejects.toMatchObject({
      code: "ERR_BAD_REQUEST",
      response: { status: 429, data: "slow down" },
    });
  });
});

describe("createTxtRecord", () => {
  it("finds the zone by parent domain, creates the record and deletes it", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetch = vi.fn(async (url: string, init?: PluginFetchInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com" }],
        });
      }
      if (url.includes("/zones?name=")) {
        return Response.json({ success: true, result: [] });
      }
      if (init?.method === "POST") {
        return Response.json({ success: true, result: { id: "rec-1" } });
      }
      return Response.json({ success: true, result: {} });
    });

    const remove = await createTxtRecord(
      fetch,
      "token",
      "_acme-challenge.termix.example.com",
      "digest",
    );
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toContain("/zones/zone-1/dns_records");
    expect(JSON.parse(post.body!)).toMatchObject({
      type: "TXT",
      name: "_acme-challenge.termix.example.com",
      content: "digest",
    });

    await remove();
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: expect.stringContaining("/zones/zone-1/dns_records/rec-1"),
    });
  });

  it("surfaces the Cloudflare error message", async () => {
    const fetch = async () =>
      Response.json(
        { success: false, errors: [{ message: "Invalid token" }] },
        { status: 403 },
      );
    await expect(
      createTxtRecord(fetch, "bad", "_acme-challenge.a.example", "d"),
    ).rejects.toThrow(/Invalid token/);
  });
});
