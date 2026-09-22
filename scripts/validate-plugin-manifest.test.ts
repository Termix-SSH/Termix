import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const VALIDATOR = path.join(__dirname, "validate-plugin-manifest.cjs");
const FIXTURES = path.join(__dirname, "__fixtures__", "manifests");

function runValidator(fixture?: string): { status: number; output: string } {
  const args = fixture
    ? [VALIDATOR, path.join(FIXTURES, fixture)]
    : [VALIDATOR];
  try {
    const output = execFileSync("node", args, { encoding: "utf8" });
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
    expect(output).toContain("ok");
  });

  it("accepts a manifest declaring services", () => {
    expect(runValidator("valid-services.json").status).toBe(0);
  });

  it("accepts a manifest declaring actions", () => {
    expect(runValidator("valid-actions.json").status).toBe(0);
  });

  it("rejects a manifest missing a required field", () => {
    const { status, output } = runValidator("invalid-missing-field.json");
    expect(status).toBe(1);
    expect(output).toContain("id");
  });

  it("rejects an id that is not a lowercase slug", () => {
    const { status, output } = runValidator("invalid-bad-id.json");
    expect(status).toBe(1);
    expect(output).toContain("id");
  });

  it("rejects an unknown category", () => {
    expect(runValidator("invalid-unknown-category.json").status).toBe(1);
  });

  // The dotted spelling was the v1 form. Capabilities are colon-separated now
  // so they can never be confused with RBAC permissions.
  it("rejects a dotted capability name", () => {
    const { status, output } = runValidator("invalid-unknown-capability.json");
    expect(status).toBe(1);
    expect(output).toContain("hosts.read");
  });

  it("rejects a service permission the plugin does not declare", () => {
    expect(runValidator("invalid-service-permission.json").status).toBe(1);
  });

  it("rejects an action permission the plugin does not declare", () => {
    expect(runValidator("invalid-action-permission.json").status).toBe(1);
  });

  it("rejects an unknown top-level field", () => {
    const { status, output } = runValidator("invalid-unknown-field.json");
    expect(status).toBe(1);
    expect(output).toContain("sudoEverything");
  });

  it("rejects an unknown field nested inside contributes", () => {
    const { status, output } = runValidator(
      "invalid-nested-unknown-field.json",
    );
    expect(status).toBe(1);
    expect(output).toContain("extra");
  });

  // A manifest must not be able to name a core namespace, which is how a
  // plugin could otherwise gate a route on admin authority it never had.
  it("rejects a permission name outside the plugin's own namespace", () => {
    const { status, output } = runValidator(
      "invalid-role-default-escalation.json",
    );
    expect(status).toBe(1);
    expect(output).toContain("admin.users.manage");
  });

  it("validates every bundled manifest when given no argument", () => {
    const { status, output } = runValidator();
    expect(status).toBe(0);
    expect(output).toContain("ssh-terminal");
  });
});
