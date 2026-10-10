import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBundledPluginsDir } from "../../plugins/paths.js";

describe("getBundledPluginsDir", () => {
  const saved = process.env.TERMIX_BUNDLED_PLUGINS_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
    else process.env.TERMIX_BUNDLED_PLUGINS_DIR = saved;
  });

  it("reads dist/plugins when run from source", () => {
    delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
    expect(getBundledPluginsDir()).toBe(
      path.resolve(process.cwd(), "dist", "plugins"),
    );
  });

  it("honors the override", () => {
    process.env.TERMIX_BUNDLED_PLUGINS_DIR = "/somewhere/else";
    expect(getBundledPluginsDir()).toBe("/somewhere/else");
  });
});
