import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import type {
  PluginCapabilityError as CapabilityError,
  PluginTlsCertificateInfo,
  PluginTlsStatus,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activateWith } from "../../src/backend/index.js";
import { CHECK_INTERVAL_MS, RETRY_AFTER_MS } from "../../src/backend/runner.js";
import { renewalReason } from "../../src/backend/renewal.js";

const manifest = manifestJson as unknown as PluginManifest;
const DAY = 86_400_000;

const CONFIGURED = {
  autoRenew: true,
  domain: "termix.example.com",
  email: "admin@example.com",
};

function cert(
  overrides: Partial<PluginTlsCertificateInfo> = {},
): PluginTlsCertificateInfo {
  return {
    subject: "CN=termix.example.com",
    issuer: "CN=R11, O=Let's Encrypt",
    names: ["termix.example.com"],
    notBefore: new Date(Date.now() - 10 * DAY).toISOString(),
    notAfter: new Date(Date.now() + 60 * DAY).toISOString(),
    selfSigned: false,
    fingerprint: "AA",
    ...overrides,
  };
}

const issue = vi.fn(async () => ({
  certificate: "-----BEGIN CERTIFICATE-----new",
  privateKey: "-----BEGIN PRIVATE KEY-----new",
}));

let servers: http.Server[] = [];

afterEach(async () => {
  issue.mockClear();
  await Promise.all(
    servers.map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
  servers = [];
});

async function setup(
  options: {
    settings?: Record<string, unknown>;
    certificate?: PluginTlsCertificateInfo | null;
    permissions?: string[];
    capabilities?: string[];
    validateTls?: () => PluginTlsCertificateInfo;
  } = {},
) {
  let router: Router | null = null;
  const tlsStatus: Omit<PluginTlsStatus, "renewal"> = {
    enabled: true,
    certificate: options.certificate === undefined ? null : options.certificate,
  };
  const mock: MockPluginContext = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: options.capabilities ?? manifest.capabilities,
    router: () => (router = express.Router()),
    settings: options.settings,
    permissions: options.permissions ?? ["manage"],
    tlsStatus,
    validateTls: options.validateTls,
  });
  const runner = await activateWith(mock.ctx, issue);

  const app = express();
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, path: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
    });
    return { status: response.status, body: await response.json() };
  };
  return { mock, runner, call };
}

describe("renewalReason", () => {
  const status = (certificate: PluginTlsCertificateInfo | null) => ({
    enabled: true,
    certificate,
    renewal: null,
  });

  it("renews when missing, self-signed, for another domain or expiring", () => {
    expect(renewalReason(status(null), "termix.example.com")).toBe("missing");
    expect(
      renewalReason(status(cert({ selfSigned: true })), "termix.example.com"),
    ).toBe("self-signed");
    expect(renewalReason(status(cert()), "other.example.com")).toBe("domain");
    expect(
      renewalReason(
        status(
          cert({ notAfter: new Date(Date.now() + 10 * DAY).toISOString() }),
        ),
        "termix.example.com",
      ),
    ).toBe("expiring");
    expect(renewalReason(status(cert()), "TERMIX.example.com")).toBeNull();
  });
});

describe("scheduled renewal", () => {
  it("checks on a 12 hour timer and renews an expiring certificate", async () => {
    const { mock } = await setup({
      settings: CONFIGURED,
      certificate: cert({
        notAfter: new Date(Date.now() + 5 * DAY).toISOString(),
      }),
    });
    const job = mock.scheduled.find((entry) => entry.kind === "every");
    expect(job?.ms).toBe(CHECK_INTERVAL_MS);

    await mock.runScheduled();

    expect(issue).toHaveBeenCalledOnce();
    expect(mock.tls.writes).toEqual([
      {
        certificatePem: "-----BEGIN CERTIFICATE-----new",
        privateKeyPem: "-----BEGIN PRIVATE KEY-----new",
      },
    ]);
    const write = mock.tls.calls.indexOf("writeTlsCertificate");
    expect(mock.tls.calls.indexOf("reloadTls")).toBeGreaterThan(write);
    expect(mock.tls.reloads).toBe(1);
  });

  it("leaves a valid certificate alone", async () => {
    const { mock } = await setup({ settings: CONFIGURED, certificate: cert() });
    await mock.runScheduled();
    expect(issue).not.toHaveBeenCalled();
    expect(mock.tls.writes).toEqual([]);
  });

  it("does nothing and registers no renewer while renewal is off", async () => {
    const { mock } = await setup({
      settings: { ...CONFIGURED, autoRenew: false },
    });
    await mock.runScheduled();
    expect(issue).not.toHaveBeenCalled();
    expect(mock.tls.renewers).toBe(0);
  });

  it("registers as the renewer when configured and drops it when turned off", async () => {
    const { mock } = await setup({ settings: CONFIGURED, certificate: cert() });
    expect(mock.tls.renewers).toBe(1);
    expect((await mock.ctx.system.tlsStatus()).renewal?.pluginId).toBe(
      "acme-ssl",
    );

    await mock.ctx.settings.set("autoRenew", false);
    await vi.waitFor(() => expect(mock.tls.renewers).toBe(0));
  });

  it("waits before retrying after a failed attempt", async () => {
    const { mock, runner } = await setup({ settings: CONFIGURED });
    issue.mockRejectedValueOnce(new Error("rate limited"));
    expect(await runner.check()).toBe(false);
    expect((await runner.state()).lastError).toBe("rate limited");

    expect(await runner.check()).toBe(false);
    expect(issue).toHaveBeenCalledOnce();

    expect(
      await runner.check(new Date(Date.now() + RETRY_AFTER_MS + 1000)),
    ).toBe(true);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(mock.tls.reloads).toBe(1);
  });

  it("does not reload when core rejects the certificate", async () => {
    const { mock, runner } = await setup({
      settings: CONFIGURED,
      validateTls: () => {
        throw new Error("The certificate and private key do not match");
      },
    });
    await expect(runner.issue()).rejects.toThrow(/do not match/);
    expect(mock.tls.reloads).toBe(0);
    expect((await runner.state()).lastError).toMatch(/do not match/);
  });
});

describe("routes", () => {
  it("reports status and issues on request", async () => {
    const { call, mock } = await setup({ settings: CONFIGURED });
    const status = await call("GET", "/status");
    expect(status.status).toBe(200);
    expect(status.body.missing).toBeNull();
    expect(status.body.tls.certificate).toBeNull();

    const issued = await call("POST", "/request");
    expect(issued.status).toBe(200);
    expect(issued.body.success).toBe(true);
    expect(issued.body.tls.certificate).not.toBeNull();
    expect(mock.tls.reloads).toBe(1);
  });

  it("answers 400 when a setting is missing", async () => {
    const { call } = await setup({ settings: { domain: "a.example" } });
    const result = await call("POST", "/request");
    expect(result.status).toBe(400);
    expect(result.body.missing).toBe("email");
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a user without acme-ssl.manage on every route", async () => {
    const { call } = await setup({ settings: CONFIGURED, permissions: [] });
    expect((await call("GET", "/status")).status).toBe(403);
    expect((await call("POST", "/request")).status).toBe(403);
    expect(issue).not.toHaveBeenCalled();
  });
});

describe("capabilities", () => {
  it("fails closed without system:tls", async () => {
    await expect(
      setup({
        settings: CONFIGURED,
        capabilities: manifest.capabilities.filter(
          (capability) => capability !== "system:tls",
        ),
      }),
    ).rejects.toMatchObject({
      capability: "system:tls",
    } satisfies Partial<CapabilityError>);
  });
});
