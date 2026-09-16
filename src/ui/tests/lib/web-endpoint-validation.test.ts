import { describe, expect, it } from "vitest";
import {
  findInvalidWebEndpoint,
  isWebEndpointPathValid,
  isWebEndpointPortValid,
  webEndpointErrorKey,
  webEndpointRowError,
} from "@/lib/web-endpoint-validation";
import { normalizeWebEndpoints } from "../../../backend/database/routes/host-web-endpoints.js";
import type { WebEndpoint } from "@/types/index";

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
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

describe("isWebEndpointPortValid", () => {
  it("accepts the whole legal range and nothing else", () => {
    expect(isWebEndpointPortValid(1)).toBe(true);
    expect(isWebEndpointPortValid(65535)).toBe(true);
    for (const bad of [0, -1, 65536, 8.5, "8006", null, undefined, NaN]) {
      expect(isWebEndpointPortValid(bad)).toBe(false);
    }
  });
});

describe("webEndpointRowError", () => {
  it("returns null for a row the normalizer would keep", () => {
    expect(webEndpointRowError(endpoint())).toBeNull();
  });

  it("reports a blank label before anything else", () => {
    // Both label and port are wrong; the label is the likelier oversight.
    expect(webEndpointRowError(endpoint({ label: "  ", port: 0 }))).toBe(
      "label",
    );
  });

  it("reports a bad port and a bad path", () => {
    expect(webEndpointRowError(endpoint({ port: 0 }))).toBe("port");
    expect(webEndpointRowError(endpoint({ path: "//evil.example" }))).toBe(
      "path",
    );
  });
});

describe("findInvalidWebEndpoint", () => {
  it("returns null when every row would survive", () => {
    expect(
      findInvalidWebEndpoint([
        endpoint(),
        endpoint({ id: "e2", label: "NAS" }),
      ]),
    ).toBeNull();
  });

  it("names the offending row by index", () => {
    expect(
      findInvalidWebEndpoint([endpoint(), endpoint({ id: "e2", label: "" })]),
    ).toEqual({ index: 1, error: "label" });
  });

  it("reports duplicate labels, which the picker cannot tell apart", () => {
    expect(
      findInvalidWebEndpoint([
        endpoint(),
        endpoint({ id: "e2", label: "proxmox" }),
      ]),
    ).toEqual({ index: 1, error: "duplicateLabel" });
  });

  it("tolerates a missing list", () => {
    expect(findInvalidWebEndpoint(undefined)).toBeNull();
    expect(findInvalidWebEndpoint(null)).toBeNull();
  });
});

describe("webEndpointErrorKey", () => {
  it("maps every error to a distinct i18n key", () => {
    const keys = (["label", "duplicateLabel", "port", "path"] as const).map(
      webEndpointErrorKey,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^hosts\./);
  });
});

/**
 * The editor validator and the backend normalizer are two implementations of
 * overlapping rules, in two layers that cannot share code (the renderer does
 * not import backend route modules). Nothing but this describe block stops
 * them drifting -- and drift here is invisible in the worst way: the editor
 * accepts a row, the normalizer silently drops it, and the user's endpoint
 * disappears on reload with no error anywhere.
 */
describe("the editor agrees with the normalizer", () => {
  const PATHS = [
    "/",
    "",
    "/admin",
    "admin",
    "/admin?tab=1",
    "/a b",
    "//evil.example",
    "http://evil.example/x",
    "/x:y",
    "\t//evil.example",
    "\n//evil.example",
    "/a\tb",
    `/a${String.fromCharCode(0x7f)}b`,
    "/back\\slash",
  ];

  it.each(PATHS)("agrees on path %j", (path) => {
    const editorAccepts = isWebEndpointPathValid(path);
    const normalizerKeeps =
      normalizeWebEndpoints([{ ...endpoint(), path }]).length === 1;
    expect(editorAccepts).toBe(normalizerKeeps);
  });

  const PORTS = [1, 80, 8006, 65535, 0, -1, 65536, 8.5];

  it.each(PORTS)("agrees on port %j", (port) => {
    const editorAccepts = isWebEndpointPortValid(port);
    const normalizerKeeps =
      normalizeWebEndpoints([{ ...endpoint(), port }]).length === 1;
    expect(editorAccepts).toBe(normalizerKeeps);
  });
});
