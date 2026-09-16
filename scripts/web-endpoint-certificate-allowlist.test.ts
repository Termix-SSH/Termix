import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * main.cjs is CommonJS Electron main-process code that cannot be imported into
 * the test environment, so these assert on its source. Coarse by necessity --
 * but each one pins a property that was a deliberate decision, and would
 * otherwise be undone by a well-meaning simplification with nothing to object.
 */
const source = readFileSync(path.resolve("electron/main.cjs"), "utf8");

describe("web endpoint certificate allowlist", () => {
  it("is kept out of isInvalidCertificateAllowedForUrl", () => {
    // That function ALSO feeds getTlsVerificationOptions, which governs main's
    // own outbound TLS. Widening it would grant far more privilege than
    // suppressing a certificate error inside one iframe needs.
    const fn = source.slice(
      source.indexOf("function isInvalidCertificateAllowedForUrl"),
    );
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).not.toContain("webEndpointCertificateAllowlist");
    expect(body).not.toContain("isWebEndpointCertificateAllowed");
  });

  it("is consulted from the certificate-error handler", () => {
    const handler = source.slice(
      source.indexOf('app.on(\n  "certificate-error"'),
    );
    expect(handler.slice(0, 1200)).toContain("isWebEndpointCertificateAllowed");
  });

  it("accepts https only, in both the check and the handler", () => {
    // A non-TLS origin in a TLS-error allowlist is meaningless, and file:/ftp:
    // must never be storable.
    const check = source.slice(
      source.indexOf("function isWebEndpointCertificateAllowed"),
    );
    expect(check.slice(0, 700)).toContain('parsed.protocol !== "https:"');

    const handler = source.slice(
      source.indexOf('ipcMain.handle("allow-invalid-certificate-for-origin"'),
    );
    expect(handler.slice(0, 800)).toContain('parsed.protocol !== "https:"');
  });

  it("expires entries rather than holding them until restart", () => {
    // Main cannot verify the renderer's claim that an origin is a configured
    // endpoint, so the residual risk must be a momentary window, not an
    // indefinite one.
    expect(source).toContain("WEB_ENDPOINT_CERTIFICATE_ALLOWLIST_TTL_MS");
    const check = source.slice(
      source.indexOf("function isWebEndpointCertificateAllowed"),
    );
    expect(check.slice(0, 700)).toContain("Date.now() >= expiresAt");
  });

  it("stores the parsed origin, never the caller's string", () => {
    // Otherwise a path or a wildcard in the supplied value could widen the
    // allowance beyond one exact origin.
    const handler = source.slice(
      source.indexOf('ipcMain.handle("allow-invalid-certificate-for-origin"'),
    );
    const body = handler.slice(0, 800);
    expect(body).toContain(
      "webEndpointCertificateAllowlist.set(\n      parsed.origin,",
    );
  });

  it("is reachable from the renderer through the preload allowlist", () => {
    const preload = readFileSync(path.resolve("electron/preload.js"), "utf8");
    const allowlist = preload.slice(
      preload.indexOf("const ALLOWED_INVOKE_CHANNELS"),
    );
    expect(allowlist.slice(0, allowlist.indexOf("]"))).toContain(
      "allow-invalid-certificate-for-origin",
    );
  });
});
