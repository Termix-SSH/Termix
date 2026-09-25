/**
 * Custom certificate paths set in the environment survive a boot: they are
 * neither replaced with a self-signed certificate nor reset in DATA_DIR/.env.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execSync = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ execSync }));
vi.mock("../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: log };
});

const saved = { ...process.env };
let dataDir: string;

beforeEach(() => {
  vi.resetModules();
  execSync.mockReset();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-ssl-"));
  process.env.DATA_DIR = dataDir;
  process.env.ENABLE_SSL = "true";
});

afterEach(() => {
  process.env = { ...saved };
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("AutoSSLSetup with custom paths", () => {
  it("keeps the operator's certificate and paths", async () => {
    process.env.SSL_CERT_PATH = path.join(dataDir, "mine", "cert.pem");
    process.env.SSL_KEY_PATH = path.join(dataDir, "mine", "key.pem");
    process.env.SSL_DOMAIN = "termix.example.com";

    const { AutoSSLSetup } = await import("../../tls/self-signed.js");
    await AutoSSLSetup.initialize();

    expect(execSync).not.toHaveBeenCalled();
    const env = fs.readFileSync(path.join(dataDir, ".env"), "utf8");
    expect(env).toContain(`SSL_CERT_PATH=${process.env.SSL_CERT_PATH}`);
    expect(env).toContain("SSL_DOMAIN=termix.example.com");
  });
});
