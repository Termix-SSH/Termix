import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { classifyIp, describeRequest } from "../../diagnostics/request-info.js";

function fakeRequest(
  headers: Record<string, string>,
  ip = "172.18.0.1",
): Request {
  return {
    method: "GET",
    protocol: "http",
    ip,
    headers,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe("classifyIp", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["::ffff:10.0.0.4", "private"],
    ["192.168.1.2", "private"],
    ["100.100.1.1", "private"],
    ["fd00::1", "private"],
    ["8.8.8.8", "public"],
    ["2606:4700::1", "public"],
    ["nonsense", "unknown"],
  ])("%s is %s", (ip, kind) => {
    expect(classifyIp(ip)).toBe(kind);
  });
});

describe("describeRequest", () => {
  it("reports names but never values", () => {
    const info = describeRequest(
      fakeRequest({
        host: "termix.example.com",
        cookie: "jwt=secret.jwt.value; other=abc",
        authorization: "Bearer topsecret",
        "remote-user": "alice",
        "x-forwarded-for": "203.0.113.9, 10.0.0.2",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "proxy.example.com",
        "user-agent": "Test",
      }),
    );
    const text = JSON.stringify(info);
    expect(text).not.toContain("secret.jwt.value");
    expect(text).not.toContain("topsecret");
    expect(text).not.toContain("alice");
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toContain("termix.example.com");
    expect(info.cookieNames).toEqual(["jwt", "other"]);
    expect(info.authCookie).toBe(true);
    expect(info.authHeader).toBe(true);
    expect(info.forwarded).toEqual({
      hops: 2,
      proto: "https",
      hostDiffers: true,
      port: null,
    });
    expect(info.proxySigns).toContain("forward auth (Authelia or similar)");
    expect(info.clientIp).toBe("private");
  });

  it("sees a plain request as direct", () => {
    const info = describeRequest(fakeRequest({ host: "x" }, "127.0.0.1"));
    expect(info.forwarded.hops).toBe(0);
    expect(info.proxySigns).toEqual([]);
    expect(info.authCookie).toBe(false);
    expect(info.clientIp).toBe("loopback");
  });

  it("drops odd forwarded values", () => {
    const info = describeRequest(
      fakeRequest({
        "x-forwarded-proto": "https<script>",
        "x-forwarded-port": "99999999",
      }),
    );
    expect(info.forwarded.proto).toBeNull();
    expect(info.forwarded.port).toBeNull();
  });
});
