import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

const state = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(async () => undefined),
  parseInfo: {
    publicKeyLine: "ssh-ed25519 TESTKEY",
    principals: ["alice"],
    validAfter: new Date(Date.now() - 60_000),
    validBefore: new Date(Date.now() + 60 * 60_000),
  },
  idToken: "",
  command: null as Record<string, string> | null,
  remoteResult: null as { ok: boolean; message: string } | null,
  runtimeComplete: vi.fn(async () => undefined),
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => Buffer.alloc(32, 1) },
}));
vi.mock("../../utils/field-crypto.js", () => ({
  FieldCrypto: {
    encryptField: (value: string, _key: Buffer, _id: string, field: string) =>
      `${field}:${value}`,
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) =>
      ({
        step_ca_url: "https://ca.example",
        step_ca_fingerprint: "a".repeat(64),
        step_ca_provisioner: "oidc",
      })[key],
  }),
  createCurrentOpksshTokenRepository: () => ({ upsert: state.upsert }),
}));
vi.mock("../../utils/step-ca-egress.js", () => ({
  readStepCaPrivateAllowlist: async () => [],
}));
vi.mock("../../utils/step-ca-client.js", () => ({
  fetchRootCertificate: async () => "ROOT",
  findOidcProvisioner: async () => ({
    clientID: "client",
    configurationEndpoint: "https://idp.example/.well-known/openid",
  }),
  discoverOidcEndpoints: async () => ({
    authorizationEndpoint: "https://idp.example/auth",
    tokenEndpoint: "https://idp.example/token",
  }),
  createPkce: () => ({ verifier: "verifier", challenge: "challenge" }),
  generateSshKeyPair: () => ({
    publicKeyLine: "ssh-ed25519 TESTKEY",
    privateKeyPem: "PRIVATE",
  }),
  buildAuthorizationUrl: (input: Record<string, string>) => {
    const url = new URL("https://idp.example/auth");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    return url.toString();
  },
  exchangeCodeForIdToken: async () => state.idToken,
  decodeJwtClaims: (token: string) => {
    const payload = token.split(".")[1];
    return payload
      ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
      : {};
  },
  signSshCertificate: async () => "CERT",
  parseSshCertificate: () => state.parseInfo,
}));
vi.mock("../../hosts/step-ca-runtime.js", () => ({
  stepCaRuntime: {
    register: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    submit: vi.fn(async () => true),
    takeCommand: vi.fn(async () => {
      const command = state.command;
      state.command = null;
      return command;
    }),
    complete: state.runtimeComplete,
    takeResult: vi.fn(async () => {
      const result = state.remoteResult;
      state.remoteResult = null;
      return result;
    }),
  },
}));

const { cancelStepCaAuth, completeStepCaAuth, startStepCaAuth } =
  await import("../../hosts/step-ca-auth.js");

function jwt(payload: object): string {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}

function fakeWs(): WebSocket {
  return {
    send: (raw: string) => state.sent.push(JSON.parse(raw)),
    once: vi.fn(),
  } as unknown as WebSocket;
}

async function start(): Promise<{ requestId: string; nonce: string }> {
  await startStepCaAuth(
    "user-1",
    7,
    "alice",
    fakeWs(),
    "https://termix.example",
  );
  const chooser = state.sent.at(-1)!;
  const url = new URL(String(chooser.url));
  return {
    requestId: String(chooser.requestId),
    nonce: url.searchParams.get("nonce")!,
  };
}

beforeEach(() => {
  state.sent.length = 0;
  state.upsert.mockClear();
  state.runtimeComplete.mockClear();
  state.command = null;
  state.remoteResult = null;
  state.parseInfo = {
    publicKeyLine: "ssh-ed25519 TESTKEY",
    principals: ["alice"],
    validAfter: new Date(Date.now() - 60_000),
    validBefore: new Date(Date.now() + 60 * 60_000),
  };
});

describe("Step CA authentication", () => {
  it("stores only a certificate bound to the nonce, key, principal and validity window", async () => {
    const { requestId, nonce } = await start();
    state.idToken = jwt({ nonce, email: "alice@example.com" });

    await expect(
      completeStepCaAuth({ state: requestId, code: "code" }),
    ).resolves.toEqual({
      ok: true,
      message: "Signed in. You can close this window.",
    });
    expect(state.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", hostId: 7 }),
    );
  });

  it("rejects a token without the requested nonce", async () => {
    const { requestId } = await start();
    state.idToken = jwt({ email: "alice@example.com" });

    const result = await completeStepCaAuth({ state: requestId, code: "code" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/does not match/);
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it("routes a callback through Redis to the instance holding the WebSocket", async () => {
    const { requestId, nonce } = await start();
    state.idToken = jwt({ nonce });
    state.command = { state: requestId, code: "remote-code" };

    await vi.waitFor(() => expect(state.runtimeComplete).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(state.upsert).toHaveBeenCalled();
  });

  it("returns a result produced by another instance", async () => {
    state.remoteResult = { ok: true, message: "remote success" };
    await expect(
      completeStepCaAuth({ state: "remote-state", code: "code" }),
    ).resolves.toEqual({ ok: true, message: "remote success" });
  });

  it("cancels local sessions", async () => {
    const { requestId } = await start();
    expect(cancelStepCaAuth(requestId)).toBe(true);
    expect(cancelStepCaAuth(requestId)).toBe(false);
  });
});
