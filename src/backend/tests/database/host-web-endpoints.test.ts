import { describe, expect, it } from "vitest";
import {
  MAX_WEB_ENDPOINTS,
  normalizeWebEndpoints,
  parseWebUiConfig,
  serializeWebUiConfig,
} from "../../database/routes/host-web-endpoints.js";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    path: "/",
    access: "direct",
    render: "external",
    ...overrides,
  };
}

describe("normalizeWebEndpoints", () => {
  it("keeps a valid endpoint", () => {
    expect(normalizeWebEndpoints([valid()])).toEqual([
      {
        id: "e1",
        label: "Proxmox",
        scheme: "https",
        port: 8006,
        path: "/",
        access: "direct",
        render: "external",
        ignoreCert: false,
      },
    ]);
  });

  it("drops an unknown or dangerous scheme", () => {
    expect(normalizeWebEndpoints([valid({ scheme: "ftp" })])).toEqual([]);
    expect(normalizeWebEndpoints([valid({ scheme: "javascript" })])).toEqual(
      [],
    );
  });

  it("drops out-of-range ports", () => {
    expect(normalizeWebEndpoints([valid({ port: 0 })])).toEqual([]);
    expect(normalizeWebEndpoints([valid({ port: 65536 })])).toEqual([]);
    expect(normalizeWebEndpoints([valid({ port: 8.5 })])).toEqual([]);
    // A numeric string is not a number; accepting it would let "8006abc"
    // through some other coercion path later.
    expect(normalizeWebEndpoints([valid({ port: "8006" })])).toEqual([]);
  });

  it("coerces a path that does not start with a slash", () => {
    expect(normalizeWebEndpoints([valid({ path: "admin" })])[0].path).toBe(
      "/admin",
    );
  });

  it("defaults a missing path to /", () => {
    expect(normalizeWebEndpoints([valid({ path: undefined })])[0].path).toBe(
      "/",
    );
  });

  it("drops a path carrying a scheme or authority", () => {
    expect(normalizeWebEndpoints([valid({ path: "//evil.example" })])).toEqual(
      [],
    );
    expect(
      normalizeWebEndpoints([valid({ path: "http://evil.example/x" })]),
    ).toEqual([]);
    expect(normalizeWebEndpoints([valid({ path: "/x" })])).toHaveLength(1);
  });

  it("drops a path whose protocol-relative prefix hides behind a control character", () => {
    // "\t//evil.example" slips a naive startsWith("//") guard: the browser
    // strips the control character and follows the authority.
    for (const prefix of ["\t", "\n", "\r"]) {
      expect(
        normalizeWebEndpoints([valid({ path: `${prefix}//evil.example` })]),
      ).toEqual([]);
    }
  });

  it("drops a path containing a control character anywhere", () => {
    expect(normalizeWebEndpoints([valid({ path: "/a\tb" })])).toEqual([]);
    expect(
      normalizeWebEndpoints([
        valid({ path: `/a${String.fromCharCode(0x7f)}b` }),
      ]),
    ).toEqual([]);
  });

  it("keeps a path containing a plain space", () => {
    expect(normalizeWebEndpoints([valid({ path: "/a b" })])[0].path).toBe(
      "/a b",
    );
  });

  it("truncates an over-long label", () => {
    expect(
      normalizeWebEndpoints([valid({ label: "x".repeat(200) })])[0].label,
    ).toHaveLength(64);
  });

  it("drops an endpoint with a blank label or id", () => {
    expect(normalizeWebEndpoints([valid({ label: "   " })])).toEqual([]);
    expect(normalizeWebEndpoints([valid({ id: "" })])).toEqual([]);
  });

  it("keeps only the first of a duplicate id", () => {
    const result = normalizeWebEndpoints([
      valid({ id: "dup", label: "first" }),
      valid({ id: "dup", label: "second" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("first");
  });

  it("caps the list length", () => {
    const many = Array.from({ length: MAX_WEB_ENDPOINTS + 5 }, (_, i) =>
      valid({ id: `e${i}` }),
    );
    expect(normalizeWebEndpoints(many)).toHaveLength(MAX_WEB_ENDPOINTS);
  });

  it("returns empty for non-array input", () => {
    expect(normalizeWebEndpoints(undefined)).toEqual([]);
    expect(normalizeWebEndpoints(null)).toEqual([]);
    expect(normalizeWebEndpoints("nope")).toEqual([]);
    expect(normalizeWebEndpoints({ endpoints: [] })).toEqual([]);
  });

  it("drops an unknown access or render value", () => {
    expect(normalizeWebEndpoints([valid({ access: "magic" })])).toEqual([]);
    expect(normalizeWebEndpoints([valid({ render: "magic" })])).toEqual([]);
  });

  it("clears ignoreCert for tunnel access and keeps it for direct", () => {
    expect(
      normalizeWebEndpoints([valid({ access: "tunnel", ignoreCert: true })])[0]
        .ignoreCert,
    ).toBe(false);
    expect(
      normalizeWebEndpoints([valid({ access: "direct", ignoreCert: true })])[0]
        .ignoreCert,
    ).toBe(true);
  });
});

describe("bindHost", () => {
  const tunnelRow = (bindHost?: unknown) => ({
    ...valid({ access: "tunnel" }),
    ...(bindHost === undefined ? {} : { bindHost }),
  });

  it("keeps a loopback bind", () => {
    expect(normalizeWebEndpoints([tunnelRow("127.0.0.1")])[0].bindHost).toBe(
      "127.0.0.1",
    );
  });

  it("keeps an all-interfaces bind, which is the exposed opt-in", () => {
    expect(normalizeWebEndpoints([tunnelRow("0.0.0.0")])[0].bindHost).toBe(
      "0.0.0.0",
    );
  });

  it("omits it entirely when blank, so the route falls back to loopback", () => {
    expect(normalizeWebEndpoints([tunnelRow("")])[0].bindHost).toBeUndefined();
    expect(normalizeWebEndpoints([tunnelRow()])[0].bindHost).toBeUndefined();
  });

  it("drops the endpoint when the bind address is not a bare host", () => {
    // It lands in a listener AND in a URL authority, so nothing carrying a
    // scheme, port, path or credentials may survive.
    for (const bad of [
      "http://evil.example",
      "127.0.0.1:8080",
      "host/path",
      "user@host",
      "has space",
      "999.1.1.1",
      "-bad.example",
      42,
    ]) {
      expect(normalizeWebEndpoints([tunnelRow(bad)])).toEqual([]);
    }
  });

  it("accepts a bracketed IPv6 literal and a hostname", () => {
    expect(normalizeWebEndpoints([tunnelRow("[::1]")])[0].bindHost).toBe(
      "[::1]",
    );
    expect(normalizeWebEndpoints([tunnelRow("nas.local")])[0].bindHost).toBe(
      "nas.local",
    );
  });

  it("ignores it on a direct endpoint, which never binds anything", () => {
    expect(
      normalizeWebEndpoints([
        valid({ access: "direct", bindHost: "0.0.0.0" }),
      ])[0].bindHost,
    ).toBeUndefined();
  });
});

describe("localPort", () => {
  const tunnelRow = (localPort?: unknown) => ({
    ...valid({ access: "tunnel" }),
    ...(localPort === undefined ? {} : { localPort }),
  });

  it("keeps a fixed port so a container can publish it", () => {
    expect(normalizeWebEndpoints([tunnelRow(38080)])[0].localPort).toBe(38080);
  });

  it("omits it when unset, leaving the kernel to pick", () => {
    expect(normalizeWebEndpoints([tunnelRow()])[0].localPort).toBeUndefined();
  });

  it("drops the endpoint for a port outside the valid range", () => {
    for (const bad of [0, -1, 65536, 8.5, "38080"]) {
      expect(normalizeWebEndpoints([tunnelRow(bad)])).toEqual([]);
    }
  });

  it("ignores it on a direct endpoint, which binds nothing", () => {
    expect(
      normalizeWebEndpoints([valid({ access: "direct", localPort: 38080 })])[0]
        .localPort,
    ).toBeUndefined();
  });
});

describe("parseWebUiConfig", () => {
  it("parses a stored JSON string", () => {
    expect(
      parseWebUiConfig(JSON.stringify({ endpoints: [valid()] })).endpoints,
    ).toHaveLength(1);
  });

  it("accepts an already-parsed object", () => {
    expect(parseWebUiConfig({ endpoints: [valid()] }).endpoints).toHaveLength(
      1,
    );
  });

  it("returns empty endpoints for malformed JSON instead of throwing", () => {
    // A half-written config must not take out the whole host listing, which
    // is what dockerConfig's bare JSON.parse does today.
    expect(parseWebUiConfig("{ not json")).toEqual({ endpoints: [] });
  });

  it("returns empty endpoints for null and undefined", () => {
    expect(parseWebUiConfig(null)).toEqual({ endpoints: [] });
    expect(parseWebUiConfig(undefined)).toEqual({ endpoints: [] });
  });
});

describe("serializeWebUiConfig", () => {
  it("round-trips through normalization", () => {
    expect(
      parseWebUiConfig(serializeWebUiConfig({ endpoints: [valid()] }))
        .endpoints[0].id,
    ).toBe("e1");
  });

  it("returns null when there are no valid endpoints", () => {
    expect(serializeWebUiConfig({ endpoints: [] })).toBeNull();
    expect(serializeWebUiConfig(null)).toBeNull();
  });
});
