import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validate } from "../packages/plugin-sdk/cli/commands/validate.mjs";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function plugin(dialects: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-validate-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({ id: "fixture", version: "1.0.0" }),
  );
  for (const dialect of dialects) {
    const dir = path.join(root, "migrations", dialect);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "0001_init.sql"),
      "CREATE TABLE p_fixture_items (id INTEGER PRIMARY KEY);\n",
    );
  }
  return root;
}

async function problems(cwd: string) {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((line) => lines.push(line));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(validate({ cwd })).rejects.toThrow();
  return lines.join("\n");
}

describe("termix-plugin validate migrations", () => {
  it("flags an engine with no migrations folder", async () => {
    const output = await problems(plugin(["sqlite", "postgres"]));
    expect(output).toContain("migrations/mysql is missing");
    expect(output).not.toContain("migrations/postgres is missing");
  });

  it("accepts all three engines", async () => {
    const output = await problems(plugin(["sqlite", "postgres", "mysql"]));
    expect(output).not.toMatch(/migrations\/\w+ is missing/);
  });
});

describe("termix-plugin validate themes", () => {
  function themed(css: string | null) {
    const root = plugin([]);
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        id: "fixture",
        version: "1.0.0",
        capabilities: ["ui:theme"],
        contributes: {
          themes: [
            {
              id: "paper",
              label: "Paper",
              mode: "light",
              css: "themes/paper.css",
            },
          ],
        },
      }),
    );
    if (css !== null) {
      fs.mkdirSync(path.join(root, "themes"));
      fs.writeFileSync(path.join(root, "themes", "paper.css"), css);
    }
    return root;
  }

  it("reports a missing theme file", async () => {
    expect(await problems(themed(null))).toContain(
      "theme paper: themes/paper.css does not exist",
    );
  });

  it("reports theme CSS that reaches outside or leaves its class", async () => {
    const output = await problems(
      themed('@import "x.css"; body { color: red }'),
    );
    expect(output).toContain("theme paper: @import is not allowed in a theme");
    expect(output).toContain(
      'theme paper: Selector "body" must start with .paper',
    );
  });

  it("says nothing about CSS that is fine", async () => {
    const output = await problems(themed(".paper { --background: #fff; }"));
    expect(output).not.toContain("theme paper");
  });
});
