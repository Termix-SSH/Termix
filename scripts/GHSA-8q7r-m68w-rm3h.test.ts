/**
 * The lockfile never goes back to dependency versions with known security
 * fixes missing. Each entry is the first fixed version on that major line.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";

const lock = JSON.parse(
  fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
) as { packages: Record<string, { version?: string }> };

const MINIMUM: Record<string, Record<number, string>> = {
  undici: { 6: "6.29.1", 7: "7.30.1", 8: "8.12.2" },
  multer: { 2: "2.5.0" },
  "follow-redirects": { 1: "1.16.2" },
  "fast-uri": { 3: "3.1.9" },
  "ip-address": { 10: "10.7.4" },
  qs: { 6: "6.16.1" },
  electron: { 43: "43.8.1" },
  vite: { 8: "8.3.3" },
  "@vitest/mocker": { 4: "4.1.12" },
  zod: { 4: "4.6.6" },
};

function parts(version: string): number[] {
  return version.split("-")[0].split(".").map(Number);
}

function atLeast(version: string, minimum: string): boolean {
  const a = parts(version);
  const b = parts(minimum);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe("GHSA-8q7r-m68w-rm3h dependency floor", () => {
  it("has no locked copy below its fixed version", () => {
    const stale: string[] = [];
    for (const [path, entry] of Object.entries(lock.packages)) {
      const name = path.split("node_modules/").pop();
      if (!name || !entry.version || !MINIMUM[name]) continue;
      const floor = MINIMUM[name][parts(entry.version)[0]];
      if (floor && !atLeast(entry.version, floor)) {
        stale.push(`${name}@${entry.version} (needs ${floor})`);
      }
    }
    expect(stale).toEqual([]);
  });
});
