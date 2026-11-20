import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeSpecs, servedSpec } from "../openapi-served.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-served-"));
  dirs.push(dir);
  return dir;
}

describe("served OpenAPI spec", () => {
  it("merges plugin paths only under their own prefix and sets servers", () => {
    const spec = mergeSpecs(
      {
        openapi: "3.0.3",
        paths: { "/users/me": {} },
        tags: [{ name: "Users" }],
      },
      [
        {
          id: "backups",
          spec: {
            paths: {
              "/plugin-api/backups/jobs": {},
              "/users/me": { hijack: true },
              "/plugin-api/other/x": {},
            },
            tags: [{ name: "Backups" }, { name: "Users" }],
            components: { schemas: { Job: { type: "object" } } },
          },
        },
      ],
      "https://termix.example",
      "26.11.3",
    );
    expect(Object.keys(spec.paths!).sort()).toEqual([
      "/plugin-api/backups/jobs",
      "/users/me",
    ]);
    expect(spec.paths!["/users/me"]).toEqual({});
    expect(spec.servers).toEqual([
      { url: "https://termix.example", description: "This Termix server" },
    ]);
    expect(spec.tags!.map((t) => t.name)).toEqual(["Users", "Backups"]);
    expect(spec.components!.schemas!.Job).toBeTruthy();
    expect(spec.info!.version).toBe("26.11.3");
  });

  it("reads core and active plugins from disk and skips the rest", () => {
    const core = path.join(tmp(), "openapi.json");
    fs.writeFileSync(core, JSON.stringify({ paths: { "/version": {} } }));
    const make = (id: string, withSpec: boolean) => {
      const dir = tmp();
      if (withSpec) {
        fs.mkdirSync(path.join(dir, "dist"));
        fs.writeFileSync(
          path.join(dir, "dist", "openapi.json"),
          JSON.stringify({ paths: { [`/plugin-api/${id}/a`]: {} } }),
        );
      }
      return dir;
    };
    const spec = servedSpec(
      [
        { id: "on", dir: make("on", true), state: "active" },
        { id: "off", dir: make("off", true), state: "disabled" },
        { id: "old", dir: make("old", false), state: "active" },
      ],
      "/",
      "1",
      core,
    );
    expect(Object.keys(spec.paths!).sort()).toEqual([
      "/plugin-api/on/a",
      "/version",
    ]);
  });
});
