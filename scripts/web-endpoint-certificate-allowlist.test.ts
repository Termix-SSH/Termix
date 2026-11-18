import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * main.cjs and preload.js can't be imported into the test environment, so
 * these read their source. The page used to tell main which origins could
 * show a bad certificate. Now only a web view grant from a plugin's backend
 * carries that rule (embedded-view.cjs), so the renderer path must stay gone.
 */
const main = readFileSync(path.resolve("electron/main.cjs"), "utf8");
const preload = readFileSync(path.resolve("electron/preload.js"), "utf8");
const ipcArgs = readFileSync(path.resolve("electron/ipc-args.cjs"), "utf8");

describe("certificate trust for web views", () => {
  it("has no renderer channel to trust an origin", () => {
    expect(main).not.toContain("allow-invalid-certificate-for-origin");
    expect(preload).not.toContain("allow-invalid-certificate-for-origin");
    expect(ipcArgs).not.toContain("allow-invalid-certificate-for-origin");
  });

  it("keeps the certificate-error handler to grants and configured servers", () => {
    const handler = main.slice(main.indexOf('"certificate-error"'));
    const body = handler.slice(0, 1200);
    expect(body).toContain("embeddedViews.handleCertificateError");
    expect(body).not.toContain("WebEndpointCertificate");
  });

  it("takes web view grants only from the backend", () => {
    expect(main).toContain(
      '"web-view-grant": (payload) => embeddedViews.addGrant(payload)',
    );
    expect(preload).not.toContain("web-view-grant");
  });
});
