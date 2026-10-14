import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each([
  [false, "", ""],
  [false, "/termix/", "/termix"],
  [true, "", "__TERMIX_SW_BASE_PATH__"],
])(
  "stamps service worker paths (runtime=%s, base=%s)",
  (runtime, base, expected) => {
    const dir = mkdtempSync(path.join(tmpdir(), "termix-sw-"));
    try {
      mkdirSync(path.join(dir, "scripts"));
      mkdirSync(path.join(dir, "dist"));
      writeFileSync(
        path.join(dir, "scripts/stamp-sw-build-info.cjs"),
        readFileSync("scripts/stamp-sw-build-info.cjs"),
      );
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ version: "26.10.2" }),
      );
      writeFileSync(path.join(dir, "dist/sw.js"), readFileSync("public/sw.js"));
      execFileSync(
        process.execPath,
        [path.join(dir, "scripts/stamp-sw-build-info.cjs")],
        {
          env: {
            ...process.env,
            VITE_BASE_PATH: base,
            TERMIX_RUNTIME_BASE_PATH: String(runtime),
          },
        },
      );
      const sw = readFileSync(path.join(dir, "dist/sw.js"), "utf8");
      expect(sw).toContain('"26-10-2"');
      expect(sw).toContain(`const BASE_PATH = "${expected}";`);
      if (runtime) {
        expect(sw.replaceAll("__TERMIX_SW_BASE_PATH__", "/termix")).toContain(
          'const BASE_PATH = "/termix";',
        );
        expect(readFileSync("docker/Dockerfile", "utf8")).toContain(
          "TERMIX_RUNTIME_BASE_PATH=true",
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
