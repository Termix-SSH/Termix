import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const {
  patchAgentSource,
} = require("../../../../scripts/patch-ssh2-agent.cjs");
it("is idempotent on the installed dependency", () => {
  const source = readFileSync(require.resolve("ssh2/lib/agent.js"), "utf8");
  const result = patchAgentSource(source);
  expect(patchAgentSource(result)).toBe(result);
});
it("fails explicitly when the dependency parser changes", () => {
  expect(() => patchAgentSource("changed parser")).toThrow("review");
});
