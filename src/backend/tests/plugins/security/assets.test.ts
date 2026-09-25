/**
 * /plugin-assets serves only a running plugin's browser files: never a path
 * outside its folder (however it is encoded, or through a symlink), never its
 * backend or migrations, and always with a fixed content type and nosniff.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPluginAssetsRouter,
  resolvePluginAsset,
} from "../../../plugins/assets.js";

let root = "";
let server: Server;
let baseUrl = "";
const plugins = new Map<string, Record<string, unknown>>();

function write(relative: string, content: string) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Creates a link, or returns false where the OS will not let us. */
function link(target: string, at: string, type: "file" | "junction"): boolean {
  try {
    fs.symlinkSync(target, at, type);
    return true;
  } catch {
    return false;
  }
}

let fileLinks = false;
let dirLinks = false;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-assets-sec-"));
  write("gizmo/dist/frontend.js", "export function activate() {}");
  write("gizmo/dist/backend.js", "secret()");
  write("gizmo/dist/migrations/snapshot.json", "{}");
  write("gizmo/locales/en.json", "{}");
  write("secret.js", "outside()");
  write("secrets/keys.json", "{}");

  // A plugin whose manifest puts its frontend at the plugin root, so the
  // backend and migrations sit in the served folder.
  write("flat/frontend.js", "export function activate() {}");
  write("flat/server/main.js", "secret()");
  write(
    "flat/migrations/sqlite/0001_init.sql",
    "CREATE TABLE p_flat_x (id int);",
  );

  fileLinks = link(
    path.join(root, "secret.js"),
    path.join(root, "gizmo/dist/escape.js"),
    "file",
  );
  dirLinks = link(
    path.join(root, "secrets"),
    path.join(root, "gizmo/dist/linked"),
    "junction",
  );

  plugins.set("gizmo", {
    id: "gizmo",
    dir: path.join(root, "gizmo"),
    manifest: { id: "gizmo", version: "1.0.0" },
    state: "active",
  });
  plugins.set("flat", {
    id: "flat",
    dir: path.join(root, "flat"),
    manifest: {
      id: "flat",
      version: "1.0.0",
      frontend: "frontend.js",
      backend: "server/main.js",
    },
    state: "active",
  });
  plugins.set("stopped", {
    id: "stopped",
    dir: path.join(root, "gizmo"),
    manifest: { id: "stopped", version: "1.0.0" },
    state: "disabled",
  });

  const app = express();
  app.use(
    "/plugin-assets",
    createPluginAssetsRouter((id) => plugins.get(id) as never),
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

const get = (url: string) => fetch(`${baseUrl}/plugin-assets/${url}`);

describe("path traversal", () => {
  it.each([
    "gizmo/../secret.js",
    "gizmo/..%2fsecret.js",
    "gizmo/%2e%2e/secret.js",
    "gizmo/%2e%2e%2f%2e%2e%2fsecret.js",
    "gizmo/..%5csecret.js",
    "gizmo/%2e%2e%5c%2e%2e%5csecret.js",
    "gizmo/frontend.js%00.js",
    "gizmo/locales/..%2f..%2fsecret.js",
    "gizmo/%2fetc%2fpasswd.js",
  ])("refuses %s", async (url) => {
    const response = await get(url);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("outside()");
  });

  it("refuses a symlinked file that points outside the plugin", () => {
    if (!fileLinks) return;
    expect(
      resolvePluginAsset(plugins.get("gizmo") as never, "escape.js"),
    ).toBeNull();
  });

  it("refuses a file inside a symlinked folder that points outside", () => {
    if (!dirLinks) return;
    expect(
      resolvePluginAsset(plugins.get("gizmo") as never, "linked/keys.json"),
    ).toBeNull();
  });
});

describe("server-only files", () => {
  it("never serves the backend entry, wherever the manifest put it", async () => {
    expect((await get("gizmo/backend.js")).status).toBe(404);
    expect((await get("flat/server/main.js")).status).toBe(404);
  });

  it("never serves anything under migrations", async () => {
    expect((await get("gizmo/migrations/snapshot.json")).status).toBe(404);
  });
});

describe("a stopped plugin", () => {
  it("serves nothing, so its bundle cannot be loaded around the shell", async () => {
    expect((await get("stopped/frontend.js")).status).toBe(404);
    expect((await get("gizmo/frontend.js")).status).toBe(200);
  });
});

describe("headers", () => {
  it("sends a fixed content type and nosniff", async () => {
    const script = await get("gizmo/frontend.js");
    expect(script.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(script.headers.get("x-content-type-options")).toBe("nosniff");

    const json = await get("gizmo/locales/en.json");
    expect(json.headers.get("content-type")).toMatch(/^application\/json/);
    expect(json.headers.get("x-content-type-options")).toBe("nosniff");

    const missing = await get("gizmo/nothing.js");
    expect(missing.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
