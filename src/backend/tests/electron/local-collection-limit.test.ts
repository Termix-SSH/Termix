import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  new URL("../../../../electron/main.cjs", import.meta.url),
  "utf8",
);
const collector = source.slice(
  source.indexOf("function collectLocalFilesFromPath("),
  source.indexOf('ipcMain.handle("get-local-home-directory"'),
);
const handler = source.slice(
  source.indexOf('ipcMain.handle("collect-local-files"'),
  source.indexOf('ipcMain.handle("create-local-folder"'),
);

describe("local collection limit", () => {
  it.each([9999, 10000, 10001])(
    "reports truncation only when %s files exceed the limit",
    (count) => {
      let collect: (
        _event: unknown,
        paths: string[],
      ) => { success: boolean; files: unknown[]; truncated: boolean };
      vm.runInNewContext(collector + handler, {
        fs: {
          lstatSync: (p: string) => ({
            isSymbolicLink: () => false,
            isFile: () => p !== "/root",
            isDirectory: () => p === "/root",
            size: 1,
            birthtime: new Date(0),
            mtime: new Date(0),
          }),
          readdirSync: () =>
            Array.from({ length: count }, (_, i) => `file${i}`),
        },
        path: path.posix,
        normalizeRelativeLocalPath: (p: string) => p,
        ipcMain: {
          handle: (_name: string, callback: typeof collect) => {
            collect = callback;
          },
        },
      });
      const result = collect!(null, ["/root"]);
      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(Math.min(10000, count));
      expect(result.truncated).toBe(count > 10000);
    },
  );
});
