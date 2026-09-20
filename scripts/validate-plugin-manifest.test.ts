import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const VALIDATOR = path.join(__dirname, "validate-plugin-manifest.cjs");
const FIXTURES = path.join(__dirname, "__fixtures__", "manifests");

function runValidator(fixture: string): { status: number; output: string } {
  try {
    const output = execFileSync(
      "node",
      [VALIDATOR, path.join(FIXTURES, fixture)],
      { encoding: "utf8" },
    );
    return { status: 0, output };
  } catch (err) {
    const error = err as { status: number; stdout: string; stderr: string };
    return { status: error.status, output: error.stdout + error.stderr };
  }
}

describe("validate-plugin-manifest.cjs", () => {
  it("accepts a valid manifest", () => {
    const { status, output } = runValidator("valid.json");
    expect(status).toBe(0);
    expect(output).toContain("Valid plugin manifest");
  });

  it("rejects a manifest missing a required field", () => {
    const { status, output } = runValidator("invalid-missing-field.json");
    expect(status).not.toBe(0);
    expect(output).toContain('Missing required field: "description"');
  });

  it("rejects a manifest with a bad id pattern", () => {
    const { status, output } = runValidator("invalid-bad-id.json");
    expect(status).not.toBe(0);
    expect(output).toMatch(/Field "id" must match/);
  });

  it("rejects a manifest with an unknown permission", () => {
    const { status, output } = runValidator("invalid-unknown-permission.json");
    expect(status).not.toBe(0);
    expect(output).toContain('Unknown permission: "credentials.read"');
  });
});
