import { beforeEach, describe, expect, it, vi } from "vitest";
import ssh2 from "ssh2";
import { FakeSshClient } from "./pipeline-test-helpers.js";

vi.mock("ssh2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ssh2")>();
  const { FakeSshClient: Fake } = await import("./pipeline-test-helpers.js");
  return {
    ...actual,
    default: {
      ...(actual as unknown as { default: object }).default,
      Client: Fake,
    },
    Client: Fake,
  };
});

const mocks = vi.hoisted(() => ({
  verifier: () => {},
  createHostVerifier: vi.fn(),
  applyCertificateAuth: vi.fn(),
  forgetCert: vi.fn(),
  applyAgentAuth: vi.fn(),
  performPortKnocking: vi.fn(),
  createJumpHostChain: vi.fn(),
  createSocks5Connection: vi.fn(),
  resolveHostById: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: log, sshLogger: log, authLogger: log, fileLogger: log };
});
vi.mock("../../../hosts/host-key-verifier.js", () => ({
  SSHHostKeyVerifier: {
    preloadHostData: async () => null,
    createHostVerifier: mocks.createHostVerifier,
  },
}));
vi.mock("@termix/plugin-sdk/ssh-certs", () => ({
  applyCertificateAuth: mocks.applyCertificateAuth,
}));
vi.mock("../../../hosts/terminal-auth-helpers.js", () => ({
  applyAgentAuth: mocks.applyAgentAuth,
  performPortKnocking: mocks.performPortKnocking,
}));
vi.mock("../../../hosts/jump-host-chain.js", () => ({
  createJumpHostChain: mocks.createJumpHostChain,
}));
vi.mock("../../../utils/socks5-helper.js", () => ({
  createSocks5Connection: mocks.createSocks5Connection,
}));
vi.mock("../../../hosts/ssh-dns.js", () => ({
  resolveSshConnectConfigHost: async (config: unknown) => config,
}));
vi.mock("../../../hosts/host-resolver.js", () => ({
  resolveHostById: mocks.resolveHostById,
}));
vi.mock("../../../hosts/ssh-connection-pool.js", () => ({
  withConnection: async (
    _key: string,
    factory: () => Promise<unknown>,
    fn: (client: unknown) => Promise<unknown>,
  ) => fn(await factory()),
}));

import {
  buildConnectConfig,
  getPurposeDefaults,
} from "../../../hosts/connect/build-connect-config.js";
import {
  connectHost,
  getConnectionPoolKey,
  SshConnectError,
  withHostConnection,
} from "../../../hosts/connect/connect-host.js";
import {
  getSshAuthProvider,
  listCredentialTypes,
  registerSshAuthProvider,
  setSshAuthTypeOwnerSource,
} from "../../../hosts/connect/auth-provider-registry.js";
import { ensureCoreSshAuthProviders } from "../../../hosts/connect/core-providers.js";
import type { SshConnectHost } from "../../../hosts/connect/types.js";

const plainKey = ssh2.utils.generateKeyPairSync("ed25519").private;
const encryptedKey = ssh2.utils.generateKeyPairSync("ed25519", {
  passphrase: "secret",
  cipher: "aes256-cbc",
}).private;

function host(overrides: Partial<SshConnectHost> = {}): SshConnectHost {
  return {
    id: 7,
    ip: "10.0.0.7",
    port: 22,
    username: "root",
    userId: "owner-1",
    authType: "password",
    password: "hunter2",
    ...overrides,
  };
}

/**
 * A plugin-style provider that needs a browser sign-in until it has a
 * certificate, and forgets it when the host rejects it.
 */
function registerSignInProvider(hasCert: boolean) {
  return registerSshAuthProvider({
    type: "signin",
    pluginId: "fixture-plugin",
    labelKey: "fixture.label",
    needsUserInteraction: true,
    interaction: "signin",
    prepare: async (config) => {
      if (!hasCert) {
        return {
          status: "interaction-required",
          interaction: "signin",
          message: "Sign in first",
        };
      }
      config.password = "cert";
      return { status: "ready" };
    },
    onAuthFailed: (_host, env) => {
      mocks.forgetCert(env.userId, env.hostId);
      return {
        status: "interaction-required",
        interaction: "signin",
        message: "Sign in again",
      };
    },
  });
}

async function build(
  target: SshConnectHost,
  purpose: Parameters<typeof buildConnectConfig>[1]["purpose"] = "terminal",
) {
  return buildConnectConfig(target, {
    userId: "user-1",
    purpose,
    client: new FakeSshClient() as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeSshClient.nextBehaviour = [];
  FakeSshClient.instances = [];
  mocks.createHostVerifier.mockResolvedValue(mocks.verifier);
  mocks.applyAgentAuth.mockImplementation(async (config) => {
    config.agent = "agent-object";
    return { socketPath: "/tmp/agent.sock" };
  });
  mocks.applyCertificateAuth.mockImplementation(async (config) => {
    config.authHandler = "cert-handler";
  });
});

describe("buildConnectConfig per auth type", () => {
  it("password puts the password in the config", async () => {
    const { config, outcome } = await build(host());
    expect(outcome).toEqual({ status: "ready" });
    expect(config).toMatchObject({
      host: "10.0.0.7",
      port: 22,
      username: "root",
      password: "hunter2",
      tryKeyboard: true,
      keepaliveInterval: 30000,
      keepaliveCountMax: 5,
      readyTimeout: 120000,
    });
    expect(config.hostVerifier).toBe(mocks.verifier);
  });

  it("password leaves the password out when keyboard-interactive is forced", async () => {
    const { config, outcome } = await build(
      host({ forceKeyboardInteractive: true }),
    );
    expect(outcome.status).toBe("ready");
    expect(config.password).toBeUndefined();
  });

  it("password without a password is an error", async () => {
    const { outcome } = await build(host({ password: null }));
    expect(outcome).toMatchObject({ status: "error", code: "missing-secret" });
  });

  it("key sets privateKey, passphrase and keeps a password fallback", async () => {
    const { config, outcome } = await build(
      host({
        authType: "key",
        key: encryptedKey,
        keyPassword: "secret",
        password: "fallback",
      }),
    );
    expect(outcome.status).toBe("ready");
    expect(Buffer.isBuffer(config.privateKey)).toBe(true);
    expect(config.passphrase).toBe("secret");
    expect(config.password).toBe("fallback");
    expect(mocks.applyCertificateAuth).not.toHaveBeenCalled();
  });

  it("key with a CA certificate grafts the certificate", async () => {
    const { config } = await build(
      host({
        authType: "key",
        key: plainKey,
        password: null,
        certPublicKey: "ssh-ed25519-cert-v01@openssh.com AAAA",
      }),
    );
    expect(mocks.applyCertificateAuth).toHaveBeenCalledOnce();
    expect(mocks.applyCertificateAuth.mock.calls[0][2]).toMatchObject({
      certificate: "ssh-ed25519-cert-v01@openssh.com AAAA",
    });
    expect(config.authHandler).toBe("cert-handler");
  });

  it("key with a failing CA certificate falls back to key only", async () => {
    mocks.applyCertificateAuth.mockRejectedValueOnce(new Error("bad cert"));
    const { outcome } = await build(
      host({ authType: "key", key: plainKey, certPublicKey: "junk" }),
    );
    expect(outcome.status).toBe("ready");
  });

  it("an encrypted key without its passphrase asks for one", async () => {
    const { outcome } = await build(
      host({ authType: "key", key: encryptedKey }),
    );
    expect(outcome).toMatchObject({
      status: "error",
      code: "passphrase-required",
    });
  });

  it("a broken key is an invalid-key error", async () => {
    const { outcome } = await build(
      host({ authType: "key", key: "not a key" }),
    );
    expect(outcome).toMatchObject({ status: "error", code: "invalid-key" });
  });

  it("credential behaves like whichever secret the resolver left", async () => {
    const keyed = await build(
      host({ authType: "credential", key: plainKey, password: null }),
    );
    expect(Buffer.isBuffer(keyed.config.privateKey)).toBe(true);

    const passworded = await build(host({ authType: "credential" }));
    expect(passworded.config.password).toBe("hunter2");

    const empty = await build(host({ authType: "credential", password: null }));
    expect(empty.outcome).toMatchObject({ code: "missing-secret" });
  });

  it("agent hands the config to the agent helper", async () => {
    const { config, outcome } = await build(
      host({
        authType: "agent",
        password: null,
        terminalConfig: { agentSocketPath: "/tmp/agent.sock" },
      }),
    );
    expect(outcome.status).toBe("ready");
    expect(config.agent).toBe("agent-object");
    expect(mocks.applyAgentAuth).toHaveBeenCalledWith(config, {
      agentSocketPath: "/tmp/agent.sock",
    });
  });

  it("agent errors are reported", async () => {
    mocks.applyAgentAuth.mockResolvedValueOnce({ error: "no socket" });
    const { outcome } = await build(host({ authType: "agent" }));
    expect(outcome).toEqual({
      status: "error",
      code: "failed",
      message: "no socket",
    });
  });

  it("none adds no credentials", async () => {
    const { config, outcome } = await build(
      host({ authType: "none", password: null }),
    );
    expect(outcome.status).toBe("ready");
    expect(config.password).toBeUndefined();
    expect(config.privateKey).toBeUndefined();
    expect(config.tryKeyboard).toBe(true);
  });

  // OPKSSH is a plugin-registered SSH auth provider now: see
  // plugins/opkssh/tests/backend/provider.test.ts.

  // Step CA is the step-ca plugin's provider: see
  // plugins/step-ca/tests/backend/step-ca.test.ts.

  it("a stepca host without the step-ca plugin names it", async () => {
    setSshAuthTypeOwnerSource(() => [
      { type: "stepca", pluginId: "step-ca", pluginName: "Step CA" },
    ]);
    const { outcome } = await build(host({ authType: "stepca" }));
    expect(outcome).toEqual({
      status: "error",
      code: "provider-missing",
      message: "This host uses stepca, which needs the Step CA plugin",
    });
    setSshAuthTypeOwnerSource(() => []);
  });

  // Vault is the vault plugin's provider: see
  // plugins/vault/tests/backend/vault.test.ts.

  it("a vault host without the vault plugin names it", async () => {
    setSshAuthTypeOwnerSource(() => [
      { type: "vault", pluginId: "vault", pluginName: "HashiCorp Vault" },
    ]);
    const { outcome } = await build(host({ authType: "vault" }));
    expect(outcome).toEqual({
      status: "error",
      code: "provider-missing",
      message: "This host uses vault, which needs the HashiCorp Vault plugin",
    });
    setSshAuthTypeOwnerSource(() => []);
  });

  // Tailscale is a plugin-registered SSH auth provider now: see
  // plugins/tailscale/tests/backend/ssh-auth-provider.test.ts.

  it("a type nobody provides names the plugin that would", async () => {
    setSshAuthTypeOwnerSource(() => [
      { type: "made-up", pluginId: "made", pluginName: "Made Up" },
    ]);
    const { outcome } = await build(host({ authType: "made-up" }));
    expect(outcome).toEqual({
      status: "error",
      code: "provider-missing",
      message: "This host uses made-up, which needs the Made Up plugin",
    });
    setSshAuthTypeOwnerSource(() => []);
  });

  it("jump hops skip keyboard-interactive for auth type none", async () => {
    const { config } = await build(
      host({ authType: "none", password: null }),
      "jump-host",
    );
    expect(config.tryKeyboard).toBe(false);
    expect(mocks.createHostVerifier).toHaveBeenCalledWith(
      7,
      "10.0.0.7",
      22,
      null,
      "user-1",
      true,
      null,
    );
  });
});

describe("purpose defaults", () => {
  it("keeps each transport's old keepalive numbers", () => {
    expect(getPurposeDefaults("terminal")).toMatchObject({
      keepaliveIntervalMs: 30000,
      keepaliveCountMax: 5,
    });
    expect(getPurposeDefaults("file-manager")).toMatchObject({
      keepaliveIntervalMs: 60000,
      keepaliveCountMax: 5,
    });
    expect(getPurposeDefaults("fleet")).toMatchObject({
      keepaliveIntervalMs: 30000,
      keepaliveCountMax: 3,
    });
  });

  it("host keepalive settings apply where the transport honoured them", async () => {
    const withSettings = host({
      terminalConfig: { keepaliveInterval: 10, keepaliveCountMax: 2 },
    });
    const terminal = await build(withSettings, "terminal");
    expect(terminal.config.keepaliveInterval).toBe(10000);
    const fleet = await build(withSettings, "fleet");
    expect(fleet.config.keepaliveInterval).toBe(30000);
  });
});

describe("provider registry", () => {
  it("registers and removes a plugin provider", async () => {
    ensureCoreSshAuthProviders();
    const dispose = registerSshAuthProvider({
      type: "fixture",
      pluginId: "fixture-plugin",
      labelKey: "fixture.label",
      credentialType: true,
      prepare: async (config) => {
        config.password = "from-plugin";
        return { status: "ready" };
      },
    });
    expect(listCredentialTypes()).toContain("fixture");
    const { config } = await build(host({ authType: "fixture" }));
    expect(config.password).toBe("from-plugin");

    dispose();
    expect(getSshAuthProvider("fixture")).toBeUndefined();
    expect(listCredentialTypes()).not.toContain("fixture");
    const { outcome } = await build(host({ authType: "fixture" }));
    expect(outcome).toMatchObject({ code: "provider-missing" });
  });

  it("refuses to let a second plugin take over a type", () => {
    ensureCoreSshAuthProviders();
    expect(() =>
      registerSshAuthProvider({
        type: "password",
        pluginId: "someone-else",
        labelKey: "x",
        prepare: async () => ({ status: "ready" }),
      }),
    ).toThrow(/already provided by core/);
  });

  it("offers password and key as credential types", () => {
    ensureCoreSshAuthProviders();
    expect(listCredentialTypes()).toEqual(
      expect.arrayContaining(["password", "key"]),
    );
  });
});

describe("connectHost", () => {
  it("resolves the host for the acting user and connects", async () => {
    mocks.resolveHostById.mockResolvedValueOnce(host());
    const connection = await connectHost(7, {
      userId: "user-1",
      purpose: "fleet",
    });
    expect(mocks.resolveHostById).toHaveBeenCalledWith(7, "user-1");
    const client = connection.client as unknown as FakeSshClient;
    expect(client.connectConfig).toMatchObject({ password: "hunter2" });
    connection.dispose();
    expect(client.ended).toBe(true);
  });

  it("uses a shared-override resolution exactly as the resolver returned it", async () => {
    mocks.resolveHostById.mockResolvedValueOnce(
      host({ authType: "key", key: plainKey, password: null, username: "me" }),
    );
    const connection = await connectHost(7, {
      userId: "recipient",
      purpose: "fleet",
    });
    const config = (connection.client as unknown as FakeSshClient)
      .connectConfig!;
    expect(config.username).toBe("me");
    expect(Buffer.isBuffer(config.privateKey)).toBe(true);
    expect(config.password).toBeUndefined();
  });

  it("fails for an unknown or forbidden host", async () => {
    mocks.resolveHostById.mockResolvedValueOnce(null);
    await expect(
      connectHost(9, { userId: "user-1", purpose: "fleet" }),
    ).rejects.toThrow("Host not found or access denied");
  });

  it("throws the auth outcome instead of connecting", async () => {
    const dispose = registerSignInProvider(false);
    const attempt = connectHost(host({ authType: "signin" }), {
      userId: "user-1",
      purpose: "tmux",
    });
    await expect(attempt).rejects.toBeInstanceOf(SshConnectError);
    await expect(
      connectHost(host({ authType: "signin" }), {
        userId: "user-1",
        purpose: "tmux",
      }).catch((error) => error.code),
    ).resolves.toBe("signin-required");
    dispose();
  });

  it("goes through the jump chain and forwards to the target", async () => {
    const jumpClient = new FakeSshClient();
    mocks.createJumpHostChain.mockResolvedValueOnce(jumpClient);
    const connection = await connectHost(
      host({ jumpHosts: [{ hostId: 2 }, { hostId: 3 }] }),
      { userId: "user-1", purpose: "fleet" },
    );
    expect(mocks.createJumpHostChain).toHaveBeenCalledWith(
      [{ hostId: 2 }, { hostId: 3 }],
      "owner-1",
    );
    expect(jumpClient.forwardOut).toHaveBeenCalledWith(
      "127.0.0.1",
      0,
      "10.0.0.7",
      22,
      expect.any(Function),
    );
    const config = (connection.client as unknown as FakeSshClient)
      .connectConfig!;
    expect(config.sock).toEqual({ fakeStream: true });
    connection.dispose();
    expect(jumpClient.ended).toBe(true);
  });

  it("uses a SOCKS5 proxy when the host has one", async () => {
    mocks.createSocks5Connection.mockResolvedValueOnce({ proxied: true });
    const connection = await connectHost(
      host({ useSocks5: true, socks5Host: "proxy", socks5Port: 1080 }),
      { userId: "user-1", purpose: "fleet" },
    );
    expect(mocks.createSocks5Connection).toHaveBeenCalledWith(
      "10.0.0.7",
      22,
      expect.objectContaining({ socks5Host: "proxy", socks5Port: 1080 }),
    );
    expect(
      (connection.client as unknown as FakeSshClient).connectConfig!.sock,
    ).toEqual({ proxied: true });
  });

  it("connects over a stream it is given and skips the transport", async () => {
    const connection = await connectHost(
      host({
        jumpHosts: [{ hostId: 2 }],
        useSocks5: true,
        socks5Host: "proxy",
        portKnockSequence: [{ port: 7000 }],
      }),
      {
        userId: "user-1",
        purpose: "tunnel",
        sock: { throughSource: true } as never,
      },
    );
    const config = (connection.client as unknown as FakeSshClient)
      .connectConfig!;
    expect(config.sock).toEqual({ throughSource: true });
    expect(config.hostVerifier).toBe(mocks.verifier);
    expect(mocks.createJumpHostChain).not.toHaveBeenCalled();
    expect(mocks.createSocks5Connection).not.toHaveBeenCalled();
    expect(mocks.performPortKnocking).not.toHaveBeenCalled();
    expect(connection.jumpClient).toBeNull();
  });

  it("knocks before connecting when the host has a sequence", async () => {
    await connectHost(
      host({ portKnockSequence: [{ port: 7000 }, { port: 8000 }] }),
      { userId: "user-1", purpose: "fleet" },
    );
    expect(mocks.performPortKnocking).toHaveBeenCalledWith("10.0.0.7", [
      { port: 7000 },
      { port: 8000 },
    ]);
  });

  it("auto-fills the stored password in keyboard-interactive with nobody to ask", async () => {
    FakeSshClient.nextBehaviour = ["hang"];
    const attempt = connectHost(host(), { userId: "user-1", purpose: "fleet" });
    await vi.waitFor(() => {
      const last = FakeSshClient.instances.at(-1)!;
      expect(last.connectConfig).not.toBeNull();
    });
    const client = FakeSshClient.instances.at(-1)!;
    const finish = vi.fn();
    client.emit(
      "keyboard-interactive",
      "",
      "",
      "",
      [
        { prompt: "Password: ", echo: false },
        { prompt: "Something else: ", echo: true },
      ],
      finish,
    );
    expect(finish).toHaveBeenCalledWith(["hunter2", ""]);
    client.emit("ready");
    await expect(attempt).resolves.toMatchObject({ client });
  });

  it("asks through the prompt channel when there is one", async () => {
    FakeSshClient.nextBehaviour = ["hang"];
    const ask = vi.fn().mockResolvedValue("123456");
    const attempt = connectHost(host(), {
      userId: "user-1",
      purpose: "file-manager",
      prompt: { ask },
    });
    await vi.waitFor(() =>
      expect(FakeSshClient.instances.at(-1)!.connectConfig).not.toBeNull(),
    );
    const client = FakeSshClient.instances.at(-1)!;
    const finish = vi.fn();
    client.emit(
      "keyboard-interactive",
      "",
      "",
      "",
      [
        { prompt: "Password: ", echo: false },
        { prompt: "Verification code: ", echo: true },
      ],
      finish,
    );
    await vi.waitFor(() => expect(finish).toHaveBeenCalled());
    expect(ask).toHaveBeenCalledWith({
      kind: "totp",
      prompt: "Verification code: ",
      retry: false,
    });
    expect(finish).toHaveBeenCalledWith(["hunter2", "123456"]);
    client.emit("ready");
    await attempt;
  });

  it("times out when the server never answers", async () => {
    FakeSshClient.nextBehaviour = ["hang"];
    await expect(
      connectHost(host(), {
        userId: "user-1",
        purpose: "fleet",
        timeoutMs: 20,
      }),
    ).rejects.toThrow("SSH connection timeout");
  });

  it("lets the provider react to an auth failure", async () => {
    FakeSshClient.nextBehaviour = ["auth-fail"];
    const dispose = registerSignInProvider(true);
    await expect(
      connectHost(host({ authType: "signin" }), {
        userId: "user-1",
        purpose: "fleet",
      }),
    ).rejects.toThrow(/All configured authentication methods failed/);
    await vi.waitFor(() =>
      expect(mocks.forgetCert).toHaveBeenCalledWith("user-1", 7),
    );
    dispose();
  });

  it("pools under the old key shape", async () => {
    expect(getConnectionPoolKey("fleet", host())).toBe(
      "fleet:owner-1:10.0.0.7:22:root",
    );
    expect(
      getConnectionPoolKey(
        "stats",
        host({ useSocks5: true, socks5Host: "p", socks5Port: 1 }),
      ),
    ).toBe("stats:owner-1:10.0.0.7:22:root:socks5:p:1");

    const result = await withHostConnection(
      "fleet:x",
      host(),
      { userId: "user-1", purpose: "fleet" },
      async (client) => (client as unknown as FakeSshClient).connectConfig,
    );
    expect(result).toMatchObject({ password: "hunter2" });
  });
});
