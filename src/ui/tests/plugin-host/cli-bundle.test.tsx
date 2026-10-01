/**
 * A bundle built by the termix-plugin CLI, loaded the way the shell loads it,
 * renders hooks against the shell's own React.
 *
 * The CLI leaves react, react/jsx-runtime and the SDK as bare imports; in the
 * browser the import map resolves them to the shell's copies. Here the test
 * runner resolves them to the same modules the test itself uses, so a hook
 * call only works if the bundle really did leave React out. A bundled second
 * React fails with "Invalid hook call".
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import {
  renderWithApp,
  type FrontendPluginModule,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import { resetPanels } from "@/shell/panel-registry";
import { resetPluginStore } from "@/plugin-host/plugin-store";

const ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE = path.join(__dirname, "fixtures", "hook-plugin");
// Inside the repo, so the built bundle's bare imports resolve to its packages.
const WORK = path.join(ROOT, "node_modules", ".tmp", "cli-bundle-test");
const CLI = path.join(ROOT, "packages", "plugin-sdk", "cli", "index.mjs");

let bundle = "";
let rendered: RenderedPluginApp | null = null;

beforeAll(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(WORK), { recursive: true });
  fs.cpSync(FIXTURE, WORK, { recursive: true });
  execFileSync(process.execPath, [CLI, "build"], { cwd: WORK, stdio: "pipe" });
  bundle = fs.readFileSync(path.join(WORK, "dist", "frontend.js"), "utf8");
}, 60_000);

afterAll(async () => {
  await rendered?.deactivate();
  resetPanels();
  resetPluginStore();
  fs.rmSync(WORK, { recursive: true, force: true });
});

describe("a CLI-built plugin bundle", () => {
  it("leaves React and the SDK out of the bundle", () => {
    expect(bundle).toMatch(/from\s*"react"/);
    expect(bundle).toMatch(/from\s*"@termix\/plugin-sdk\/frontend"/);
    expect(bundle).not.toMatch(/react\.production|react\.development/);
  });

  it("renders hooks against the shell's React", async () => {
    const module = (await import(
      /* @vite-ignore */ path.join(WORK, "dist", "frontend.js")
    )) as FrontendPluginModule;
    rendered = await renderWithApp(module, {
      manifest: JSON.parse(
        fs.readFileSync(path.join(WORK, "manifest.json"), "utf8"),
      ),
      locales: { title: "Clicks" },
    });
    const button = rendered.renderPanel("hook-panel").querySelector("button")!;
    expect(button.textContent).toBe("Clicks: 0");
    fireEvent.click(button);
    expect(button.textContent).toBe("Clicks: 1");
  });
});
