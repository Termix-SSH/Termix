import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dataSlotWarnings,
  uiWarnings,
  validate,
} from "../packages/plugin-sdk/cli/commands/validate.mjs";

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

describe("termix-plugin validate layouts and capabilities", () => {
  function withManifest(extra: Record<string, unknown>) {
    const root = plugin([]);
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({ id: "fixture", version: "1.0.0", ...extra }),
    );
    return root;
  }

  it("flags ui:theme with no themes and ui:layout with no layouts", async () => {
    const output = await problems(
      withManifest({ capabilities: ["ui:theme", "ui:layout"] }),
    );
    expect(output).toContain(
      '"ui:theme" is declared but contributes.themes is empty',
    );
    expect(output).toContain(
      '"ui:layout" is declared but contributes.layouts is empty',
    );
  });

  it("flags a layout plugin with no frontend source", async () => {
    const output = await problems(
      withManifest({
        capabilities: ["ui:layout"],
        contributes: { layouts: [{ id: "wide", label: "Wide" }] },
      }),
    );
    expect(output).toContain("contributes.layouts needs a frontend");
  });

  it("accepts a layout plugin that has a frontend entry", async () => {
    const root = withManifest({
      capabilities: ["ui:layout"],
      contributes: { layouts: [{ id: "wide", label: "Wide" }] },
    });
    fs.mkdirSync(path.join(root, "src", "frontend"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "frontend", "index.tsx"), "");
    const output = await problems(root);
    expect(output).not.toContain("contributes.layouts needs a frontend");
    expect(output).not.toContain("is declared but");
  });
});

describe("termix-plugin validate mobile entry", () => {
  function mobile(built: boolean) {
    const root = plugin([]);
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        id: "fixture",
        version: "1.0.0",
        contributes: { mobile: { mode: "webview", entry: "dist/mobile.js" } },
      }),
    );
    if (built) {
      fs.mkdirSync(path.join(root, "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "dist", "mobile.js"), "");
    }
    return root;
  }

  it("reports a mobile entry that was not built", async () => {
    expect(await problems(mobile(false))).toContain(
      "manifest references dist/mobile.js, which does not exist",
    );
  });

  it("finds a built mobile entry", async () => {
    expect(await problems(mobile(true))).not.toContain("dist/mobile.js");
  });
});

describe("sandbox warnings", () => {
  it("flags Node modules a plugin process can't use without a capability", async () => {
    const { sandboxWarnings } =
      await import("../packages/plugin-sdk/cli/commands/validate.mjs");
    const capabilities = await import("@termix-ssh/plugin-sdk/capabilities");
    const { isLegacyPluginApi } =
      await import("@termix-ssh/plugin-sdk/manifest");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmx-validate-sandbox-"));
    fs.mkdirSync(path.join(dir, "src", "backend"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "backend", "index.ts"),
      [
        'import net from "node:net";',
        'import { spawn } from "child_process";',
        'import { Worker } from "node:worker_threads";',
        'import path from "node:path";',
      ].join("\n"),
    );
    const sdk = { ...capabilities, isLegacyPluginApi };
    const warnings = sandboxWarnings(
      dir,
      { engine: { api: "^2.0.0" }, capabilities: ["process:spawn"] },
      sdk,
    );
    expect(warnings).toEqual([
      "src/backend/index.ts imports net, which needs the network:sockets capability in a plugin process",
      "src/backend/index.ts imports worker_threads, which no plugin process can use",
    ]);
    expect(
      sandboxWarnings(dir, { engine: { api: "^1.15" }, capabilities: [] }, sdk),
    ).toEqual([]);
    // sandbox.workers unlocks worker_threads.
    expect(
      sandboxWarnings(
        dir,
        {
          engine: { api: "^2.3.0" },
          capabilities: ["process:spawn", "network:sockets"],
          sandbox: { workers: true },
        },
        sdk,
      ),
    ).toEqual([]);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ termix: { workers: { engine: "src/worker.ts" } } }),
    );
    fs.writeFileSync(path.join(dir, "src", "backend", "index.ts"), "");
    expect(
      sandboxWarnings(
        dir,
        { engine: { api: "^2.3.0" }, capabilities: [] },
        sdk,
      ),
    ).toEqual([expect.stringMatching(/"sandbox": { "workers": true }/)]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("panel toolbar warning", () => {
  function frontend(source: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-validate-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src", "frontend"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "frontend", "Panel.tsx"), source);
    return root;
  }

  it("warns on search stacked over a full width add button", () => {
    const root = frontend(`export const P = () => (
  <div className="flex flex-col">
    <PanelSearch value={q} onChange={setQ} fill />
    <AddButton label="New" onClick={add} className="flex-1" />
  </div>
);`);
    const warnings = uiWarnings(root).filter((w) => w.includes("PanelToolbar"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("src/frontend/Panel.tsx:3");
  });

  it("stays quiet for toolbars that are one row already", () => {
    const compact = frontend(`export const P = () => (
  <div>
    <PanelSearch value={q} onChange={setQ} fill />
    <AddButton compact onClick={add} />
  </div>
);`);
    const band = frontend(`export const P = () => (
  <ToolbarBand>
    <PanelSearch value={q} onChange={setQ} fill />
    <AddButton label="New" onClick={add} />
  </ToolbarBand>
);`);
    const tab = frontend(`export const P = () => (
  <>
    <PanelSearch value={q} onChange={setQ} />
    <AddButton label="New" onClick={add} />
  </>
);`);
    for (const root of [compact, band, tab])
      expect(
        uiWarnings(root).filter((w) => w.includes("PanelToolbar")),
      ).toEqual([]);
  });

  it("stays quiet when the panel uses PanelToolbar", () => {
    const root = frontend(`export const P = () => (
  <PanelToolbar search={q} onSearchChange={setQ} onAdd={add}>
    <AddButton onClick={add} />
  </PanelToolbar>
);
const S = () => <PanelSearch value={q} onChange={setQ} />;`);
    expect(uiWarnings(root).filter((w) => w.includes("PanelToolbar"))).toEqual(
      [],
    );
  });
});

describe("data slot warnings", () => {
  function frontend(source: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-validate-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src", "frontend"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "frontend", "index.tsx"), source);
    return root;
  }
  const known = { "dashboard.hostRow": { shapes: ["bars"], rows: "host" } };

  it("warns on a component in a known data slot", () => {
    const root = frontend(`app.registerSlotContribution("dashboard.hostRow", {
  actionId: "x.row",
  titleKey: "a",
  kind: "component",
  component: Row,
});`);
    const warnings = dataSlotWarnings(root, known);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("src/frontend/index.tsx:1");
    expect(warnings[0]).toContain("dashboard.hostRow");
  });

  it("warns on a component in a slot the plugin declares as data or per row", () => {
    const root =
      frontend(`app.declareActionSlot({ id: "x.rows", accepts: ["component"], rows: "tab" });
app.declareActionSlot({ id: "x.data", accepts: ["data"] });
app.registerSlotContribution("x.rows", { actionId: "a", titleKey: "a", kind: "component", component: A });
app.registerSlotContribution("x.data", { actionId: "b", titleKey: "b", kind: "component", component: B });`);
    expect(dataSlotWarnings(root, {})).toHaveLength(2);
  });

  it("stays quiet for data contributions and other slots", () => {
    const root = frontend(`app.registerSlotContribution("dashboard.hostRow", {
  actionId: "x.row",
  titleKey: "a",
  kind: "data",
  useValue: useRow,
});
app.registerSlotContribution("tab.menu", { actionId: "b", titleKey: "b", kind: "component", component: B });
app.registerHostBadge({ id: "b", when: () => true, useValue: useBadge });`);
    expect(dataSlotWarnings(root, known)).toEqual([]);
  });

  it("warns on host badges, status indicators and toolbar items with components", () => {
    const root =
      frontend(`app.registerHostBadge({ id: "a", when: () => true, component: A });
app.registerHostStatusIndicator({ id: "b", when: () => true, component: B });
app.registerHostEditorToolbarItem({ id: "c", when: () => true, component: C });`);
    const warnings = dataSlotWarnings(root, {});
    expect(warnings).toHaveLength(3);
    expect(warnings[1]).toContain("registerHostStatusIndicator");
  });

  it("knows the core data slots from the manifest module", async () => {
    const { DATA_SLOTS } = await import("../packages/plugin-sdk/src/manifest");
    expect(Object.keys(DATA_SLOTS)).toEqual(
      expect.arrayContaining([
        "dashboard.hostRow",
        "dashboard.hostRowBadge",
        "homepage.hostMetrics",
        "terminal.toolbarStatus",
        "credentials.badges",
      ]),
    );
  });
});
