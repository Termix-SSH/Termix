import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Every Express app in the backend sits behind the same bundled nginx, so
 * every one of them needs the same `trust proxy` setting: without it `req.ip`
 * is the loopback proxy rather than the client, and the audit records these
 * services write name 127.0.0.1 for everyone.
 *
 * Enforced at the source level because the failure is silent - the records
 * still get written, they are just useless - and because it only shows up in
 * a real reverse-proxied deployment, which no unit test constructs.
 */
function backendFilesCreatingAnExpressApp(): string[] {
  const out = execFileSync(
    "git",
    ["grep", "-l", "-e", "= express()", "--", "src/backend"],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.includes("/tests/"));
}

describe("Express apps behind the bundled nginx", () => {
  it("all declare which proxies they trust", () => {
    const missing = backendFilesCreatingAnExpressApp().filter(
      (file) => !readFileSync(file, "utf8").includes(`app.set("trust proxy"`),
    );

    expect(missing).toEqual([]);
  });

  it("all derive that setting from TRUSTED_PROXIES rather than hardcoding it", () => {
    // `app.set("trust proxy", true)` believes any hop, which is what made
    // forwarded client addresses forgeable in the first place.
    const hardcoded = backendFilesCreatingAnExpressApp().filter((file) =>
      /app\.set\(\s*"trust proxy",\s*(true|1|\d+)\s*\)/.test(
        readFileSync(file, "utf8"),
      ),
    );

    expect(hardcoded).toEqual([]);
  });
});
