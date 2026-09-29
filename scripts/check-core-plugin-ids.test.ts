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
  const all = {
    "plugins/docker/manifest.json": JSON.stringify({
      id: "docker",
      contributes: { tabs: [{ id: "docker-tab" }] },
    }),
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
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

  it("fails a bare id, and a view id in the shell", () => {
    const dir = fixture({
      "src/backend/id.ts": 'if (pluginId === "docker") {}\n',
      "src/ui/view.ts": 'open("docker-tab");\n',
      "src/ui/tests/skip.ts": 'open("docker");\n',
    });
    expect(scan(dir)).toEqual({
      "src/backend/id.ts": ["docker"],
      "src/ui/view.ts": ["docker-tab"],
    });
  });
});
