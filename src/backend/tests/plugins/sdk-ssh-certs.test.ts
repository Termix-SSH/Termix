import { describe, expect, it } from "vitest";
import {
  applyCertificateAuth,
  isSandboxSshClient,
  SANDBOX_CERTIFICATE_FIELD,
} from "@termix-ssh/plugin-sdk/ssh-certs";

describe("applyCertificateAuth in a plugin process", () => {
  it("knows the stand-in client", () => {
    expect(isSandboxSshClient({ termixSandboxClient: true })).toBe(true);
    expect(isSandboxSshClient({ termixSandboxClient: "yes" })).toBe(false);
    expect(isSandboxSshClient(null)).toBe(false);
  });

  it("puts the certificate on the config instead of patching a client", async () => {
    const config: Record<string, unknown> = {};
    await applyCertificateAuth(
      config as never,
      { termixSandboxClient: true } as never,
      {
        privateKey: Buffer.from("KEY"),
        certificate: "ssh-ed25519-cert-v01@openssh.com AAAA",
        passphrase: "pw",
      },
      "deploy",
    );
    expect(config).toEqual({
      username: "deploy",
      [SANDBOX_CERTIFICATE_FIELD]: {
        privateKey: "KEY",
        certificate: "ssh-ed25519-cert-v01@openssh.com AAAA",
        passphrase: "pw",
      },
    });
    expect(config.authHandler).toBeUndefined();
  });
});
