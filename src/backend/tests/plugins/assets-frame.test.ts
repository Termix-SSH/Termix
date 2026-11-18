import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPluginAssetsRouter,
  resolveFrameAsset,
} from "../../plugins/assets.js";
import { pluginFrameCsp } from "../../http/security-headers.js";

let root = "";
let frameDir = "";
let server: Server;
let baseUrl = "";

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function plugin(id: string, api: string, capabilities: string[] = []) {
  const dir = path.join(root, id);
  write(path.join(dir, "dist/frontend.js"), "export function activate() {}");
  return {
    id,
    dir,
    source: "bundled",
    state: "active" as const,
    manifest: {
      id,
      version: "1.0.0",
      engine: { termix: ">=26.11.2-0", api },
      capabilities,
    } as never,
  };
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-frame-assets-"));
  const ui = path.join(root, "ui");
  frameDir = path.join(ui, "frame");
  write(path.join(frameDir, "frame.html"), "<!doctype html>frame");
  write(path.join(frameDir, "assets/frame-abc.js"), "export {}");
  write(path.join(frameDir, "shared/react.js"), "export {}");
  write(path.join(ui, "fonts/Mono-Regular.ttf"), "font");
  write(path.join(ui, "index.html"), "<!doctype html>shell");
  write(path.join(root, "secret.js"), "nope");

  const plugins = {
    framed: plugin("framed", "^2.0.0"),
    legacy: plugin("legacy", "^1.15.0"),
    look: plugin("look", "^2.0.0", ["ui:layout"]),
  };
  const app = express();
  app.use(
    "/plugin-assets",
    createPluginAssetsRouter(
      (id) => plugins[id as keyof typeof plugins] as never,
      {
        frameDir: () => frameDir,
        framePage: () => ({
          html: '<!doctype html><script src="../../_runtime/0123456789abcdef/assets/frame-abc.js"></script>',
          version: "0123456789abcdef",
        }),
        frameCsp: (_req, pluginId) =>
          pluginFrameCsp({
            baseUrl: "https://termix.example",
            pluginId,
            hash: null,
          }),
      },
    ),
  );
  server = await new Promise<Server>((resolve) => {
    const created = app.listen(0, "127.0.0.1", () => resolve(created));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("frame pages under /plugin-assets/<id>/_frame/", () => {
  it("serves the frame page with a CSP scoped to the plugin", async () => {
    const res = await fetch(
      `${baseUrl}/plugin-assets/framed/_frame/frame.html`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      "script-src https://termix.example/plugin-assets/framed/",
    );
    expect(csp).toContain("frame-ancestors https://termix.example");
    expect(csp).not.toContain("plugin-assets/legacy");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("../../_runtime/0123456789abcdef/");
  });

  it("serves the shared runtime once for every plugin, cached for good", async () => {
    for (const file of ["assets/frame-abc.js", "shared/react.js"]) {
      const res = await fetch(
        `${baseUrl}/plugin-assets/_runtime/0123456789abcdef/${file}`,
      );
      expect(res.status, file).toBe(200);
      expect(res.headers.get("cache-control"), file).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    const font = await fetch(
      `${baseUrl}/plugin-assets/_runtime/0123456789abcdef/fonts/Mono-Regular.ttf`,
    );
    expect(await font.text()).toBe("font");
  });

  it("serves no other runtime version, no page and nothing outside it", async () => {
    for (const target of [
      "_runtime/fedcba9876543210/assets/frame-abc.js",
      "_runtime/0123456789abcdef/frame.html",
      "_runtime/0123456789abcdef/../../index.html",
      "_runtime/0123456789abcdef/%2e%2e/secret.js",
      "_runtime/0123456789abcdef/fonts/../../secret.js",
      "_runtime/nothex/assets/frame-abc.js",
    ]) {
      const res = await fetch(`${baseUrl}/plugin-assets/${target}`);
      expect(res.status, target).toBe(404);
    }
  });

  it("serves the runtime's files and caches hashed ones", async () => {
    const asset = await fetch(
      `${baseUrl}/plugin-assets/framed/_frame/assets/frame-abc.js`,
    );
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("access-control-allow-origin")).toBe("*");
    const shim = await fetch(
      `${baseUrl}/plugin-assets/framed/_frame/shared/react.js`,
    );
    expect(shim.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves the UI build's fonts as the frame's own", async () => {
    const res = await fetch(
      `${baseUrl}/plugin-assets/framed/_frame/fonts/Mono-Regular.ttf`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("font");
  });

  it("has no frame page for plugins that run in the page", async () => {
    for (const id of ["legacy", "look", "nobody"]) {
      const res = await fetch(
        `${baseUrl}/plugin-assets/${id}/_frame/frame.html`,
      );
      expect(res.status, id).toBe(404);
    }
  });

  it("never reaches outside the runtime folder", async () => {
    for (const target of [
      "_frame/../../index.html",
      "_frame/%2e%2e/index.html",
      "_frame/fonts/../index.html",
      "_frame/fonts/../../secret.js",
      "_frame/frame.txt",
    ]) {
      const res = await fetch(`${baseUrl}/plugin-assets/framed/${target}`);
      expect(res.status, target).toBe(404);
    }
    expect(resolveFrameAsset(frameDir, "_frame/../index.html")).toBeNull();
    expect(
      resolveFrameAsset(frameDir, "_frame/fonts/../../index.html"),
    ).toBeNull();
  });
});

describe("frame fonts", () => {
  it("come from the UI build, or from public/ when a dev runner has none", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "termix-fonts-"));
    try {
      const dir = path.join(base, "dist", "frame");
      fs.mkdirSync(dir, { recursive: true });
      expect(resolveFrameAsset(dir, "_frame/fonts/a.ttf")).toBeNull();

      const source = path.join(base, "public", "fonts", "a.ttf");
      write(source, "source");
      expect(resolveFrameAsset(dir, "_frame/fonts/a.ttf")).toBe(source);

      const built = path.join(base, "dist", "fonts", "a.ttf");
      write(built, "built");
      expect(resolveFrameAsset(dir, "_frame/fonts/a.ttf")).toBe(built);

      write(path.join(base, "public", "secret.ttf"), "no");
      expect(resolveFrameAsset(dir, "_frame/fonts/../secret.ttf")).toBeNull();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("pluginFrameCsp", () => {
  const csp = pluginFrameCsp({
    baseUrl: "https://termix.example/base/",
    pluginId: "docker",
    hash: "'sha256-abc'",
    ancestors: ["app://termix"],
  });

  it("loads code and styles only from the plugin's own folder and core's runtime", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(
      "script-src https://termix.example/base/plugin-assets/docker/ https://termix.example/base/plugin-assets/_runtime/ 'wasm-unsafe-eval' 'sha256-abc'",
    );
    expect(csp).toContain(
      "style-src https://termix.example/base/plugin-assets/docker/ https://termix.example/base/plugin-assets/_runtime/ 'unsafe-inline'",
    );
    expect(csp).toContain(
      "font-src https://termix.example/base/plugin-assets/docker/ https://termix.example/base/plugin-assets/_runtime/ data:",
    );
    // Never another plugin's folder.
    expect(csp).not.toMatch(/plugin-assets\/(?!docker\/|_runtime\/)/);
    expect(csp).not.toMatch(/script-src[^;]*'self'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("talks only to the plugin's own routes and sockets", () => {
    expect(csp).toContain(
      "connect-src https://termix.example/base/plugin-assets/docker/ https://termix.example/base/plugin-api/docker/ wss://termix.example/base/plugin-ws/docker/",
    );
  });

  it("loads no picture, media or page from another site", () => {
    expect(csp).toContain(
      "img-src https://termix.example/base/plugin-assets/docker/ https://termix.example/base/plugin-assets/_runtime/ data: blob:;",
    );
    expect(csp).toContain(
      "media-src https://termix.example/base/plugin-assets/docker/ data: blob:;",
    );
    expect(csp).toContain(
      "frame-src https://termix.example/base/plugin-assets/docker/ https://termix.example/base/plugin-api/docker/;",
    );
    for (const directive of csp.split(";")) {
      expect(directive).not.toMatch(/(^|\s)(https?:|\*)(\s|$)/);
    }
  });

  it("can only be framed by the server and the desktop app", () => {
    expect(csp).toContain(
      "frame-ancestors https://termix.example app://termix",
    );
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
