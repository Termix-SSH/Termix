import { describe, expect, it } from "vitest";
import { termixPluginHost } from "./vite-plugin-termix-plugins.mjs";
import {
  importMapCspHash,
  productionImportMap,
  sharedModules,
} from "./lib/plugin-import-map.mjs";

type Tag = { tag: string; attrs: Record<string, string>; children?: string };

function tagsFor(command: "build" | "serve"): Tag[] {
  const plugin = termixPluginHost({
    repoRoot: process.cwd(),
    sdkUiEntry: "ui.ts",
    sdkFrontendEntry: "frontend.ts",
    metaCsp: (hash: string) => `script-src 'self' ${hash}`,
  }) as unknown as {
    config: (c: unknown, env: { command: string }) => void;
    transformIndexHtml: { handler: () => Tag[] };
  };
  plugin.config({}, { command });
  return plugin.transformIndexHtml.handler();
}

describe("termixPluginHost meta CSP", () => {
  it("puts the policy before the import map in a build", () => {
    const tags = tagsFor("build");
    expect(tags[0].tag).toBe("meta");
    expect(tags[0].attrs["http-equiv"]).toBe("Content-Security-Policy");
    const hash = importMapCspHash(productionImportMap(sharedModules()));
    expect(tags[0].attrs.content).toBe(`script-src 'self' ${hash}`);
    expect(tags[1].attrs.type).toBe("importmap");
  });

  it("adds no policy to the dev server, which needs inline scripts", () => {
    expect(tagsFor("serve").some((tag) => tag.tag === "meta")).toBe(false);
  });
});
