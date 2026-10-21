import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { scan, buttonTags } = require("./check-button-colors.cjs") as {
  scan: (roots: string[], buttonFile?: string) => string[];
  buttonTags: (source: string) => string[];
};

let root: string | null = null;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

function fixture(files: Record<string, string>): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "button-colors-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("buttonTags", () => {
  it("reads a tag with arrow functions inside", () => {
    const tags = buttonTags(
      `<Button onClick={() => go(a > b)} className="x">Go</Button>`,
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('className="x"');
  });
});

describe("check-button-colors", () => {
  it("accepts orange buttons and hover fills", () => {
    const dir = fixture({
      "a.tsx": `<Button className="bg-accent-brand/15 text-accent-brand hover:bg-muted" />`,
    });
    expect(scan([dir])).toEqual([]);
  });

  it("rejects a white or neutral fill on a Button", () => {
    for (const cls of [
      "bg-primary",
      "bg-white",
      "bg-foreground text-background",
      "dark:bg-secondary",
      "bg-muted",
      "text-primary-foreground",
    ]) {
      const dir = fixture({ "a.tsx": `<Button className="${cls}">x</Button>` });
      expect(scan([dir]), cls).toHaveLength(1);
    }
  });

  it("rejects a neutral fill in a variant", () => {
    const dir = fixture({
      "button.tsx": `variant: {\n  default: "bg-primary text-primary-foreground",\n  ghost: "hover:bg-muted",\n},\nsize: {`,
    });
    expect(scan([], path.join(dir, "button.tsx"))).toHaveLength(1);
  });

  it("passes on the real button", () => {
    const button = path.resolve(
      __dirname,
      "..",
      "src",
      "ui",
      "components",
      "button.tsx",
    );
    expect(scan([], button)).toEqual([]);
  });
});
