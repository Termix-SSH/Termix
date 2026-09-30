import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { collect } = require("./check-plugin-uses.cjs") as {
  collect: (dir: string) => { problems: string[]; owner: Map<string, string> };
};

let root: string | null = null;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

function plugins(
  specs: Record<string, { source: string; uses?: string[] }>,
): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-uses-"));
  for (const [id, spec] of Object.entries(specs)) {
    const dir = path.join(root, id);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ id, contributes: spec.uses ? { uses: spec.uses } : {} }),
    );
    fs.writeFileSync(path.join(dir, "src", "index.tsx"), spec.source);
  }
  return root;
}

describe("check-plugin-uses", () => {
  it("finds owners through string literals and constants", () => {
    const dir = plugins({
      terminal: {
        source:
          'const SLOT = "terminal.toolbar";\napp.declareActionSlot({ id: SLOT });\napp.registerAction("terminal.open", f);\n',
      },
    });
    const { owner } = collect(dir);
    expect(owner.get("terminal.open")).toBe("terminal");
    expect(owner.get("terminal.toolbar")).toBe("terminal");
  });

  it("requires another plugin's id in contributes.uses", () => {
    const dir = plugins({
      terminal: { source: 'app.registerAction("terminal.open", f);\n' },
      files: { source: 'invokeAction("terminal.open", host);\n' },
    });
    expect(collect(dir).problems).toEqual([
      expect.stringContaining('files uses "terminal.open" from the terminal'),
    ]);
  });

  it("passes a declared use and flags a declared one that is unused", () => {
    const dir = plugins({
      terminal: { source: 'app.registerAction("terminal.open", f);\n' },
      files: {
        source: 'invokeAction("terminal.open", host);\n',
        uses: ["terminal.open", "terminal.gone"],
      },
    });
    expect(collect(dir).problems).toEqual([
      expect.stringContaining('declares "terminal.gone"'),
    ]);
  });
});
