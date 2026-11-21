import { describe, expect, it } from "vitest";
import { findProblems } from "@/diagnostics/rules";
import type { ProbeResult } from "@/diagnostics/probes";

function probe(patch: Partial<ProbeResult>): ProbeResult {
  return {
    name: "x",
    url: "/x",
    cookies: true,
    expect: "js",
    status: 200,
    ok: true,
    redirected: false,
    contentType: "text/javascript",
    server: null,
    via: null,
    ms: 1,
    gotHtml: false,
    ...patch,
  };
}

describe("findProblems", () => {
  it("names a login proxy when only cookie-less requests fail", () => {
    const findings = findProblems({
      probes: [
        probe({ name: "ai bundle" }),
        probe({
          name: "ai frame page",
          cookies: false,
          redirected: true,
          status: null,
        }),
      ],
    });
    expect(findings[0].level).toBe("problem");
    expect(findings[0].text).toContain("login proxy");
  });

  it("flags HTML where a script was expected", () => {
    const findings = findProblems({
      probes: [probe({ name: "ai bundle", gotHtml: true, ok: false })],
    });
    expect(findings[0].text).toContain("HTML");
  });

  it("finds failed plugins, extensions and clock skew", () => {
    const findings = findProblems({
      request: {
        version: "1",
        serverTime: new Date(Date.now() - 10 * 60_000).toISOString(),
        safeMode: true,
        request: {
          method: "GET",
          protocol: "http",
          headerNames: [],
          cookieNames: [],
          authCookie: true,
          authHeader: false,
          forwarded: {
            hops: 2,
            proto: "https",
            hostDiffers: false,
            port: null,
          },
          clientIp: "private",
          proxySigns: ["Authentik"],
          userAgent: null,
        },
      },
      frontends: [
        { id: "ai", frontend: "failed", error: "Unexpected token <" },
      ],
      capture: {
        startedAt: "",
        console: [],
        errors: [
          {
            at: "",
            kind: "csp",
            source: "page",
            message: "Blocked",
            blocked: "chrome-extension://abc/x.js",
          },
        ],
        network: [],
        sockets: [],
        dropped: { console: 0, errors: 0, network: 0, sockets: 0 },
      },
    });
    const text = findings.map((f) => f.text).join("\n");
    expect(text).toContain("safe mode");
    expect(text).toContain("Authentik");
    expect(text).toContain("2 proxies");
    expect(text).toContain("clock");
    expect(text).toContain("Plugin ai did not start");
    expect(text).toContain("browser extension");
  });

  it("says when nothing was found", () => {
    expect(findProblems({})).toEqual([
      { level: "info", text: "No problems found by the automatic checks." },
    ]);
  });
});
