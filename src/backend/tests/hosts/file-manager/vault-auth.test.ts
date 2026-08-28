import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("file manager Vault authentication", () => {
  it("configures the cached Vault certificate before connecting", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../hosts/file-manager/index.ts"),
      "utf8",
    );
    const vaultBranch = source.indexOf(
      'resolvedCredentials.authType === "vault"',
    );
    const agentBranch = source.indexOf(
      'resolvedCredentials.authType === "agent"',
      vaultBranch,
    );
    const body = source.slice(vaultBranch, agentBranch);

    expect(vaultBranch).toBeGreaterThan(-1);
    expect(agentBranch).toBeGreaterThan(vaultBranch);
    expect(body).toContain("setupVaultSshSignerAuth");
    expect(body).toContain("requiresVaultAuth: true");
  });
});
