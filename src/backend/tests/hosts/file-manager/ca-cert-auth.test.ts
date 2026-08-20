import { beforeEach, describe, expect, it, vi } from "vitest";

const setupCACertAuth = vi.fn();
const warn = vi.fn();

vi.mock("../../../hosts/opkssh-cert-auth.js", () => ({
  setupCACertAuth: (...args: unknown[]) => setupCACertAuth(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  fileLogger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { applyCACertIfPresent } =
  await import("../../../hosts/file-manager/ca-cert-auth.js");

/**
 * `setupCACertAuth` had no call site in the file manager at all, while its
 * sibling `setupOPKSSHCertAuth` had two. So a host whose key is paired with a
 * user-managed CA-signed certificate authenticated in the terminal and failed
 * over SFTP, and OPKSSH certificates — going through the other helper — worked
 * in both places.
 */
describe("applyCACertIfPresent", () => {
  const client = {} as never;
  const key = Buffer.from("private-key");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches a certificate the host carries", async () => {
    const config: Record<string, unknown> = {};

    await applyCACertIfPresent(
      config,
      client,
      key,
      { certPublicKey: "ssh-rsa-cert-v01@openssh.com AAAA" },
      "root",
      "passphrase",
    );

    expect(setupCACertAuth).toHaveBeenCalledWith(
      config,
      client,
      key,
      "ssh-rsa-cert-v01@openssh.com AAAA",
      "root",
      "passphrase",
    );
  });

  it("does nothing when there is no certificate", async () => {
    // Most hosts. Touching the connection here would change key-only auth.
    for (const certPublicKey of [undefined, null, "", "   "]) {
      await applyCACertIfPresent(
        {},
        client,
        key,
        { certPublicKey },
        "root",
        undefined,
      );
    }

    expect(setupCACertAuth).not.toHaveBeenCalled();
  });

  it("leaves the connection usable when the certificate is unusable", async () => {
    // The private key on its own may still be accepted — which is what
    // happened before this was wired up. Failing the connection here would
    // turn a working setup into a broken one.
    setupCACertAuth.mockRejectedValueOnce(new Error("bad cert format"));

    await expect(
      applyCACertIfPresent(
        {},
        client,
        key,
        { certPublicKey: "garbage" },
        "root",
        undefined,
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("CA certificate setup failed"),
      expect.objectContaining({ operation: "sftp_ca_cert_auth_failed" }),
    );
  });
});
