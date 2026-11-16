/**
 * The hostile suite checking itself: a broken harness must fail, never pass
 * quietly, and every attack the fixtures run must have an expected outcome.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { evaluate, summarize } from "./lib/evaluate.mjs";
import { ALL, BACKEND, FRAME, IN_PROCESS, LEAKS } from "./lib/expect.mjs";
import { makeTmxplug } from "./lib/supply.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, "../..");
const read = (file: string) => fs.readFileSync(path.join(here, file), "utf8");

describe("evaluate", () => {
  const expectations = {
    "a.refused": { expect: "refused", why: "x" },
    "a.control": { expect: "works", why: "x" },
    "a.limit": { expect: "limit", why: "x" },
    "a.fork": { expect: "refused", why: "x", na: ["stdio"] },
  };

  it("fails an attack that worked and a control that did not", () => {
    const rows = evaluate(
      {
        "a.refused": { worked: true },
        "a.control": { worked: false },
        "a.limit": { worked: true },
        "a.fork": { worked: false },
      },
      expectations,
      { channel: "fork" },
    );
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status).toEqual({
      "a.control": "fail",
      "a.fork": "pass",
      "a.limit": "limit",
      "a.refused": "fail",
    });
    expect(summarize(rows)).toMatchObject({ fail: 2, pass: 1, limit: 1 });
  });

  it("fails what could not run, has no expectation or gave no result", () => {
    const rows = evaluate(
      {
        "a.refused": { worked: false, error: true, detail: "route 500" },
        "a.unknown": { worked: false },
        "a.fork": { worked: false, detail: "n/a: no fork channel" },
      },
      expectations,
      { channel: "fork" },
    );
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status["a.refused"]).toBe("fail");
    expect(status["a.unknown"]).toBe("fail");
    // n/a only counts on a channel the expectation names.
    expect(status["a.fork"]).toBe("fail");
    expect(status["a.control"]).toBe("fail");
  });

  it("skips an attack that can't run on this channel", () => {
    const rows = evaluate(
      { "a.fork": { worked: false, detail: "n/a: no fork channel" } },
      expectations,
      { channel: "stdio", required: ["a.fork"] },
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: "a.fork", status: "skip" }),
    ]);
  });
});

describe("expectations", () => {
  it("cover every attack the backend fixture runs", () => {
    const source =
      read("plugins/hostile-backend/src/backend/index.mjs") +
      read("plugins/hostile-backend/src/backend/process-attacks.mjs");
    const ids = [...source.matchAll(/^ {4,6}"([a-z]+\.[a-z0-9-]+)": /gm)].map(
      (m) => m[1],
    );
    expect(ids.length).toBeGreaterThan(80);
    // Run by the runner itself, with their own result ids.
    const runnerOnly = new Set([
      "lock.set",
      "flood.calls",
      "flood.big",
      "flood.big-raw",
    ]);
    for (const id of ids) {
      if (runnerOnly.has(id)) continue;
      expect(BACKEND, id).toHaveProperty([id]);
    }
  });

  it("cover every attack the frame fixture runs", () => {
    const source = read("plugins/hostile-frame/src/frontend/index.mjs");
    const ids = [
      ...source.matchAll(/r\["([a-z]+\.[a-z0-9-]+)"\]/g),
      ...source.matchAll(/^ {4}"((?:core|leak)\.[a-z0-9-]+)": /gm),
    ].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) {
      expect({ ...FRAME, ...LEAKS }, id).toHaveProperty([id]);
    }
  });

  it("give every attack a reason", () => {
    for (const [id, entry] of Object.entries(ALL)) {
      expect(["refused", "works", "limit"], id).toContain(entry.expect);
      expect(entry.why, id).toBeTruthy();
    }
  });

  it("point at in-process tests that still exist", () => {
    for (const [id, entry] of Object.entries(IN_PROCESS)) {
      const text = fs.readFileSync(path.join(core, entry.file), "utf8");
      expect(text, id).toContain(`it("${entry.test}"`);
    }
  });
});

describe("makeTmxplug", () => {
  it("writes a gzipped tar with the names it was given, escapes included", () => {
    const buffer = makeTmxplug([
      { name: "manifest.json", body: "{}" },
      { name: "../../escape.txt", body: "x" },
      { name: "dist/link", type: "2", linkname: "../../" },
    ]);
    const tar = zlib.gunzipSync(buffer);
    const names: string[] = [];
    for (let offset = 0; offset + 512 <= tar.length;) {
      const name = tar
        .toString("utf8", offset, offset + 100)
        .replace(/\0.*$/, "");
      if (!name) break;
      names.push(name);
      const size = parseInt(
        tar.toString("ascii", offset + 124, offset + 135),
        8,
      );
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    expect(names).toEqual(["manifest.json", "../../escape.txt", "dist/link"]);
  });
});
