/**
 * Every built plugin frontend in dist/plugins imports through the real loader
 * and runs activate(app) without an error. Needs `npm run build` first.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FrontendModule } from "@termix/plugin-sdk/frontend";
import type { PluginSummary } from "@/api/plugins-api";
import {
  configurePluginLoader,
  resetPluginLoader,
  syncPlugins,
} from "@/plugin-host/loader";
import { getPluginRecord } from "@/plugin-host/plugin-store";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BUILT = path.join(REPO_ROOT, "dist", "plugins");

function pluginIds(): string[] {
  const root = path.join(REPO_ROOT, "plugins");
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(root, entry.name, "manifest.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

function manifest(id: string) {
  return JSON.parse(
    fs.readFileSync(path.join(BUILT, id, "manifest.json"), "utf8"),
  ) as {
    id: string;
    name: string;
    version: string;
    icon?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    contributes?: PluginSummary["contributes"];
  };
}

function frontendFile(id: string): string {
  return path.join(BUILT, id, "dist", "frontend.js");
}

/** What GET /plugins would answer for a running, enabled plugin. */
function summaryFor(id: string): PluginSummary {
  const m = manifest(id);
  return {
    id,
    name: m.name,
    version: m.version,
    enabled: true,
    state: "active",
    contributes: m.contributes ?? null,
    icon: m.icon,
    dependencies: m.dependencies ?? {},
    optionalDependencies: m.optionalDependencies ?? {},
    frontend: fs.existsSync(frontendFile(id)),
    assetVersion: "test",
    locales: ["en"],
  };
}

const errors: unknown[][] = [];

beforeAll(async () => {
  const missing = pluginIds().filter(
    (id) => !fs.existsSync(path.join(BUILT, id, "manifest.json")),
  );
  if (missing.length > 0) {
    throw new Error(
      `dist/plugins is missing ${missing.join(", ")}. Run npm run build first.`,
    );
  }

  // Nothing here talks to a server; a plugin that fetches on activate gets
  // an empty answer rather than a network error.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });

  configurePluginLoader({
    fetchPlugins: async () => pluginIds().map(summaryFor),
    importFrontend: async (summary) =>
      (await import(
        /* @vite-ignore */ pathToFileURL(frontendFile(summary.id)).href
      )) as FrontendModule,
    loadLocale: async (summary, file) => {
      if (file !== "en") return null;
      const locale = path.join(BUILT, summary.id, "locales", "en.json");
      return fs.existsSync(locale)
        ? JSON.parse(fs.readFileSync(locale, "utf8"))
        : null;
    },
    injectCss: () => null,
  });

  await syncPlugins();
}, 180_000);

afterAll(async () => {
  await resetPluginLoader();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("built plugin frontends", () => {
  it("activates every plugin that ships a frontend", () => {
    const notActive = pluginIds()
      .filter((id) => fs.existsSync(frontendFile(id)))
      .map((id) => [
        id,
        getPluginRecord(id)?.frontend,
        getPluginRecord(id)?.error,
      ])
      .filter(([, state]) => state !== "active");
    expect(notActive).toEqual([]);
  });

  it("logs no error while importing and activating them", () => {
    // Axios has no server to reach here; a failed request is the test
    // environment, not the plugin.
    const real = errors
      .map((args) => args.map(String).join(" "))
      .filter((line) => !/Network Error/.test(line));
    expect(real).toEqual([]);
  });
});
