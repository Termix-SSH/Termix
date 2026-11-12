import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ap = require("../../../../electron/app-protocol.cjs");

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "termix-app-"));
  root = path.join(base, "dist");
  outside = path.join(base, "secret.txt");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(root, "assets", "app.js"), "1");
  fs.writeFileSync(outside, "secret");
  try {
    fs.symlinkSync(outside, path.join(root, "link.txt"));
  } catch {
    // Windows without symlink rights; that case is then skipped.
  }
});

afterAll(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));

const real = (p: string) => fs.realpathSync(p);

describe("resolveAppFile", () => {
  it("serves files inside dist", () => {
    expect(ap.resolveAppFile(root, "app://termix/assets/app.js")).toBe(
      real(path.join(root, "assets", "app.js")),
    );
  });

  it("serves index.html for page routes", () => {
    expect(ap.resolveAppFile(root, "app://termix/hosts/12")).toBe(
      path.join(real(root), "index.html"),
    );
  });

  it.each([
    "app://termix/../secret.txt",
    "app://termix/%2e%2e/secret.txt",
    "app://termix/..%2fsecret.txt",
    "app://termix/assets/..%5c..%5csecret.txt",
    "app://termix/missing.js",
    "app://other/index.html",
    "app://termix:1/index.html",
    "app://user:pw@termix/index.html",
    "file:///etc/passwd",
    "app://termix/%00.js",
    "app://termix/%E0%A4%A",
  ])("refuses %s", (url) => {
    expect(ap.resolveAppFile(root, url)).toBeNull();
  });

  it("refuses a link that points out of dist", () => {
    if (!fs.existsSync(path.join(root, "link.txt"))) return;
    expect(ap.resolveAppFile(root, "app://termix/link.txt")).toBeNull();
  });
});

describe("app handler", () => {
  it("answers with type, nosniff and a CSP on html", async () => {
    const handler = ap.createAppHandler(root);
    const html = await handler({
      method: "GET",
      url: "app://termix/index.html",
    });
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-security-policy")).toBe(ap.HTML_CSP);
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    const js = await handler({
      method: "GET",
      url: "app://termix/assets/app.js",
    });
    expect(js.headers.get("content-type")).toContain("text/javascript");
  });

  it("refuses writes and unknown files", async () => {
    const handler = ap.createAppHandler(root);
    expect(
      (await handler({ method: "POST", url: "app://termix/index.html" }))
        .status,
    ).toBe(405);
    expect(
      (await handler({ method: "GET", url: "app://termix/../secret.txt" }))
        .status,
    ).toBe(404);
  });

  it("serves the empty page used to move storage", async () => {
    const handler = ap.createAppHandler(root);
    const res = await handler({ method: "GET", url: ap.APP_BLANK_URL });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
  });

  it("registers the scheme as a secure standard scheme", () => {
    const protocol = { registerSchemesAsPrivileged: vi.fn() };
    ap.registerAppScheme(protocol);
    const [[schemes]] = protocol.registerSchemesAsPrivileged.mock.calls;
    expect(schemes[0]).toMatchObject({
      scheme: "app",
      privileges: { standard: true, secure: true },
    });
  });

  it("knows its own origin", () => {
    expect(ap.isAppUrl("app://termix/index.html")).toBe(true);
    expect(ap.isAppUrl("app://termix.evil/index.html")).toBe(false);
    expect(ap.isAppUrl("app://termix:99/index.html")).toBe(false);
    expect(ap.isAppUrl("app://x@termix/index.html")).toBe(false);
    expect(ap.isAppUrl("APP://TERMIX/index.html")).toBe(true);
    expect(ap.isAppUrl("file:///index.html")).toBe(false);
    expect(ap.isAppUrl("not a url")).toBe(false);
  });
});
