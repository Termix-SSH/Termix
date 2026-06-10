import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { syncVersion } = require("./sync-version.cjs");

let root: string;

function pkg() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}
function lock() {
  return JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-version-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "termix", version: "2.3.2" }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify(
      {
        name: "termix",
        version: "2.3.2",
        lockfileVersion: 3,
        packages: { "": { name: "termix", version: "2.3.2" } },
      },
      null,
      2,
    ) + "\n",
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("syncVersion", () => {
  it("updates package.json and both package-lock version fields", () => {
    const changed = syncVersion("2.4.0", { root });
    expect(changed).toEqual(["package.json", "package-lock.json"]);
    expect(pkg().version).toBe("2.4.0");
    expect(lock().version).toBe("2.4.0");
    expect(lock().packages[""].version).toBe("2.4.0");
  });

  it("is idempotent when already at the target version", () => {
    syncVersion("2.4.0", { root });
    const changed = syncVersion("2.4.0", { root });
    expect(changed).toEqual([]);
  });

  it("preserves the trailing newline", () => {
    syncVersion("2.4.0", { root });
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toMatch(
      /\}\n$/,
    );
  });

  it("rejects an invalid version", () => {
    expect(() => syncVersion("2.4", { root })).toThrow(/invalid version/);
  });

  it("works when only the lock root version is stale", () => {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "termix", version: "2.4.0" }, null, 2) + "\n",
    );
    const changed = syncVersion("2.4.0", { root });
    expect(changed).toEqual(["package-lock.json"]);
  });
});
