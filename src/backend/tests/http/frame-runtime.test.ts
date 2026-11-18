import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  frameRuntimeCandidates,
  rewriteFramePage,
} from "../../http/frame-runtime.js";
import { importMapHashFromHtml } from "../../http/security-headers.js";

const root = path.resolve(import.meta.dirname, "../../../..");

describe("frame runtime folder", () => {
  it("is looked up beside the backend the desktop app ships", () => {
    // The compiled backend sits in dist/backend/backend/http.
    const candidates = frameRuntimeCandidates().map((dir) =>
      path.normalize(dir),
    );
    const here = path.join(root, "src", "backend", "http");
    expect(candidates).toContain(
      path.normalize(path.join(here, "../../../frame")),
    );
  });

  it("is unpacked from the asar with its fonts, where the backend can read it", () => {
    const builder = JSON.parse(
      fs.readFileSync(path.join(root, "electron-builder.json"), "utf8"),
    ) as { asarUnpack: string[] };
    expect(builder.asarUnpack).toEqual(
      expect.arrayContaining([
        "dist/backend/**/*",
        "dist/frame/**/*",
        "dist/fonts/**/*",
      ]),
    );
  });
});

describe("frame page rewrite", () => {
  const raw = [
    '<script type="importmap">{"imports":{"react":"./shared/react.js"}}</script>',
    '<script type="module" crossorigin src="./assets/frame-x.js"></script>',
    '<link rel="modulepreload" crossorigin href="./assets/helper.js">',
    "<p>./not-a-url</p>",
  ].join("\n");
  const html = rewriteFramePage(raw, "0123456789abcdef");

  it("points scripts, styles and the import map at the shared runtime", () => {
    expect(html).toContain(
      '"react":"../../_runtime/0123456789abcdef/shared/react.js"',
    );
    expect(html).toContain(
      'src="../../_runtime/0123456789abcdef/assets/frame-x.js"',
    );
    expect(html).toContain(
      'href="../../_runtime/0123456789abcdef/assets/helper.js"',
    );
    expect(html).toContain("<p>./not-a-url</p>");
    expect(html).not.toContain('"./');
  });

  it("changes the import map hash the CSP carries", () => {
    expect(importMapHashFromHtml(html)).not.toBe(importMapHashFromHtml(raw));
  });
});

describe("frame runtime version", () => {
  it("changes when only a shared entry changes, so no stale copy is used", async () => {
    const os = await import("node:os");
    const { vi } = await import("vitest");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-runtime-"));
    fs.mkdirSync(path.join(dir, "shared"));
    fs.writeFileSync(path.join(dir, "frame.html"), "<html></html>");
    const entry = path.join(dir, "shared", "termix-ssh-plugin-sdk-ui.js");
    fs.writeFileSync(entry, 'export * from "../assets/ui-A.js";');
    const before = process.env.TERMIX_FRAME_DIR;
    process.env.TERMIX_FRAME_DIR = dir;
    try {
      vi.resetModules();
      const first = (await import("../../http/frame-runtime.js")).framePage();
      fs.writeFileSync(entry, 'export * from "../assets/ui-B.js";');
      // A rebuild writes frame.html again, unchanged.
      const later = new Date(Date.now() + 5_000);
      fs.utimesSync(path.join(dir, "frame.html"), later, later);
      const second = (await import("../../http/frame-runtime.js")).framePage();
      expect(first?.version).toBeTruthy();
      expect(second?.version).not.toBe(first?.version);
    } finally {
      if (before === undefined) delete process.env.TERMIX_FRAME_DIR;
      else process.env.TERMIX_FRAME_DIR = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
