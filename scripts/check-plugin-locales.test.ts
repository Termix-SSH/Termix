import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { scan, keysInSource, hasKey } =
  require("./check-plugin-locales.cjs") as {
    scan: (options: {
      pluginsDir: string;
      coreLocale: string;
    }) => Record<string, Array<{ key: string; file: string; inCore: boolean }>>;
    keysInSource: (source: string) => string[];
    hasKey: (tree: unknown, key: string) => boolean;
  };

let dir: string | null = null;

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function fixture(files: Record<string, unknown>) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-locales-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return {
    pluginsDir: path.join(dir, "plugins"),
    coreLocale: path.join(dir, "core.json"),
  };
}

describe("keysInSource", () => {
  it("reads t() calls, key props and run time prefixes, not comments", () => {
    const keys = keysInSource(
      [
        'const a = t("hosts.one");',
        "const b = i18next.t('docker:hosts.two', { x: 1 });",
        'app.registerTab("x", X, { titleKey: "nav.three" });',
        '<EmptyState messageKey="hosts.four" />',
        "t(`hosts.sharing.levels.${level}.label`);",
        "t(`hosts.${label}`);",
        '// t("hosts.commented")',
        'storageKey: "not.a.string.key"',
      ].join("\n"),
    );
    expect(keys.sort()).toEqual(
      [
        "docker:hosts.two",
        "hosts.four",
        "hosts.one",
        "hosts.sharing.levels.*",
        "nav.three",
      ].sort(),
    );
  });
});

describe("hasKey", () => {
  it("finds nested keys, dotted names and plural forms", () => {
    const tree = {
      a: { b: "x" },
      permissions: { "services.use": { title: "t" } },
      items: { count_one: "1", count_other: "n" },
    };
    expect(hasKey(tree, "a.b")).toBe(true);
    expect(hasKey(tree, "a")).toBe(true);
    expect(hasKey(tree, "permissions.services.use.title")).toBe(true);
    expect(hasKey(tree, "items.count")).toBe(true);
    expect(hasKey(tree, "a.c")).toBe(false);
  });
});

describe("scan", () => {
  it("passes keys a plugin defines and the shared common ones", () => {
    const options = fixture({
      "core.json": { common: { save: "Save" }, hosts: { name: "Name" } },
      "plugins/demo/manifest.json": { id: "demo", titleKey: "title" },
      "plugins/demo/locales/en.json": { title: "Demo", hosts: { name: "N" } },
      "plugins/demo/src/frontend/index.tsx":
        't("common.save"); t("hosts.name"); t("title");',
    });
    expect(scan(options)).toEqual({});
  });

  it("fails a key that only resolves through core's fallback", () => {
    const options = fixture({
      "core.json": { hosts: { name: "Name" } },
      "plugins/demo/manifest.json": { id: "demo" },
      "plugins/demo/locales/en.json": {},
      "plugins/demo/src/frontend/index.tsx": 't("hosts.name");',
    });
    expect(scan(options)).toEqual({
      demo: [
        {
          key: "hosts.name",
          file: expect.stringContaining("index.tsx"),
          inCore: true,
        },
      ],
    });
  });

  it("checks a namespaced key against that plugin and a prefix as a subtree", () => {
    const options = fixture({
      "core.json": { hosts: { levels: { view: "View" } } },
      "plugins/demo/manifest.json": { id: "demo" },
      "plugins/demo/locales/en.json": {},
      "plugins/demo/src/frontend/index.tsx":
        't("other:known.key"); t("other:gone.key"); t(`hosts.levels.${l}`);',
      "plugins/other/manifest.json": { id: "other" },
      "plugins/other/locales/en.json": { known: { key: "k" } },
    });
    expect(scan(options).demo.map((entry) => entry.key)).toEqual([
      "hosts.levels.*",
      "other:gone.key",
    ]);
  });
});
