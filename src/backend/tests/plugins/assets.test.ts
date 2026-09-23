import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPluginAssetsRouter,
  describePluginFrontend,
  resolvePluginAsset,
} from "../../plugins/assets.js";

let root = "";
let plugin: { id: string; dir: string; manifest: never };
let server: Server;
let baseUrl = "";

function write(relative: string, content: string) {
  const file = path.join(root, "gizmo", relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-assets-"));
  write("dist/frontend.js", "export function activate() {}");
  write("dist/frontend.css", ".gizmo{}");
  write("dist/backend.js", "secret()");
  write("dist/notes.txt", "text");
  write("locales/en.json", "{}");
  write("locales/translated/de_DE.json", "{}");
  write("manifest.json", "{}");
  fs.writeFileSync(path.join(root, "outside.js"), "nope");
  plugin = {
    id: "gizmo",
    dir: path.join(root, "gizmo"),
    manifest: { id: "gizmo", version: "1.0.0" } as never,
  };

  const app = express();
  app.use(
    "/plugin-assets",
    createPluginAssetsRouter((id) => (id === "gizmo" ? plugin : undefined)),
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

describe("describePluginFrontend", () => {
  it("reports the bundle, stylesheet, version and locales", () => {
    const info = describePluginFrontend(plugin);
    expect(info.frontend).toBe(true);
    expect(info.css).toBe(true);
    expect(info.assetVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(info.locales).toEqual(["de_DE", "en"]);
  });

  it("reports nothing for an unknown plugin", () => {
    expect(describePluginFrontend(undefined)).toEqual({
      frontend: false,
      css: false,
      assetVersion: null,
      locales: [],
    });
  });
});

describe("resolvePluginAsset", () => {
  it("serves the bundle and locale files", () => {
    expect(resolvePluginAsset(plugin, "frontend.js")).toBe(
      path.join(root, "gizmo", "dist", "frontend.js"),
    );
    expect(resolvePluginAsset(plugin, "locales/translated/de_DE.json")).toBe(
      path.join(root, "gizmo", "locales", "translated", "de_DE.json"),
    );
  });

  it("never serves the backend bundle", () => {
    expect(resolvePluginAsset(plugin, "backend.js")).toBeNull();
  });

  it("refuses paths that escape the plugin's directories", () => {
    expect(resolvePluginAsset(plugin, "../manifest.json")).toBeNull();
    expect(resolvePluginAsset(plugin, "../../outside.js")).toBeNull();
    expect(resolvePluginAsset(plugin, "locales/../dist/backend.js")).toBeNull();
    expect(resolvePluginAsset(plugin, "..\\manifest.json")).toBeNull();
  });

  it("refuses file types it does not serve", () => {
    expect(resolvePluginAsset(plugin, "notes.txt")).toBeNull();
  });
});

describe("GET /plugin-assets", () => {
  it("serves a bundle as a module any origin can load", async () => {
    const res = await fetch(`${baseUrl}/plugin-assets/gizmo/frontend.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("activate");
  });

  it("caches a versioned request for good", async () => {
    const res = await fetch(`${baseUrl}/plugin-assets/gizmo/frontend.js?v=abc`);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("404s an unknown plugin", async () => {
    const res = await fetch(`${baseUrl}/plugin-assets/nobody/frontend.js`);
    expect(res.status).toBe(404);
  });

  it("404s the backend bundle and traversal attempts", async () => {
    for (const target of [
      "gizmo/backend.js",
      "gizmo/%2e%2e/manifest.json",
      "gizmo/..%2f..%2foutside.js",
    ]) {
      const res = await fetch(`${baseUrl}/plugin-assets/${target}`);
      expect(res.status, target).toBe(404);
    }
  });
});
