import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { scan, regexLiterals } = require("./check-core-plugin-ids.cjs") as {
  scan: (root: string) => Record<string, string[]>;
  regexLiterals: (source: string) => string[];
};

let root: string | null = null;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

function fixture(files: Record<string, string>): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "core-plugin-ids-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("regexLiterals", () => {
  it("reads patterns with their slashes unescaped, not divisions or comments", () => {
    const source = [
      "if (/^\\/plugin-api\\/snippets/.test(p)) return x / 2;",
      "const r = a.match(/[a/b]c/g); // not /here/",
      "return /docker/;",
    ].join("\n");
    expect(regexLiterals(source)).toEqual([
      "^/plugin-api/snippets",
      "[a/b]c",
      "docker",
    ]);
  });
});

describe("scan", () => {
  it("passes core code that names no plugin", () => {
    const dir = fixture({
      "src/backend/ok.ts": 'const route = "/plugin-api/" + id;\n',
    });
    expect(scan(dir)).toEqual({});
  });

  it("fails a plugin route in a string or a regex literal", () => {
    const dir = fixture({
      "src/backend/string.ts": 'const a = "/plugin-api/docker/list";\n',
      "src/backend/regex.ts":
        "const b = /^\\/plugin-api\\/docker(\\/|$)/.test(url);\n",
    });
    expect(scan(dir)).toEqual({
      "src/backend/regex.ts": ["/^/plugin-api/docker(/|$)/"],
      "src/backend/string.ts": ["/plugin-api/docker"],
    });
  });

  it("fails a bare id and an id-prefixed action, but not in tests", () => {
    const dir = fixture({
      "src/backend/id.ts": 'if (pluginId === "docker") {}\n',
      "src/ui/action.ts": 'run("docker.open");\n',
      "src/ui/tests/skip.ts": 'open("docker");\n',
    });
    expect(scan(dir)).toEqual({
      "src/backend/id.ts": ["docker"],
      "src/ui/action.ts": ["docker.open"],
    });
  });
});

describe("scan beyond src", () => {
  it("knows ids from bundled-plugins.json", () => {
    const dir = fixture({
      "docker/bundled-plugins.json": JSON.stringify({
        plugins: [{ id: "extra-thing", source: "tmxplug" }],
      }),
      "src/ui/x.ts": 'const route = "/plugin-ws/extra-thing/c2s";\n',
    });
    expect(scan(dir)["src/ui/x.ts"]).toContain("/plugin-ws/extra-thing");
  });

  it("reads electron", () => {
    const dir = fixture({
      "electron/main.cjs": 'invoke("/plugin-api/tunnels/list");\n',
    });
    expect(scan(dir)["electron/main.cjs"]).toEqual(["/plugin-api/tunnels"]);
  });

  it("skips a line marked plugin-id-ok with a reason", () => {
    const dir = fixture({
      "src/types/a.ts": 'const legacy = "docker"; // plugin-id-ok: 2.8 key\n',
    });
    expect(scan(dir)).toEqual({});
  });
});
