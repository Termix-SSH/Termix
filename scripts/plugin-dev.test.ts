import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isSourceChange,
  pushPlugin,
  resolveDevOptions,
} from "../packages/plugin-sdk/cli/commands/dev.mjs";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-plugin-dev-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "demo-1.0.0.tmxplug");
  fs.writeFileSync(file, "archive");
  return file;
}

describe("termix-plugin dev options", () => {
  it("reads flags first, then the environment", () => {
    expect(
      resolveDevOptions(["--server", "http://a:8080/", "--key", "tmx_1"], {}),
    ).toEqual({ server: "http://a:8080", key: "tmx_1", once: false });
    expect(
      resolveDevOptions(["--once"], {
        TERMIX_SERVER_URL: "http://b",
        TERMIX_API_KEY: "tmx_2",
      }),
    ).toEqual({ server: "http://b", key: "tmx_2", once: true });
    expect(resolveDevOptions([], { TERMIX_API_KEY: "tmx_3" }).server).toBe(
      "http://localhost:30001",
    );
  });

  it("needs an API key", () => {
    expect(() => resolveDevOptions([], {})).toThrow(/API key/);
  });

  it("watches sources only", () => {
    expect(isSourceChange("src/frontend/index.tsx")).toBe(true);
    expect(isSourceChange("README.md")).toBe(true);
    expect(isSourceChange("dist/frontend.js")).toBe(false);
  });
});

describe("pushPlugin", () => {
  it("uploads the file then installs it with the capabilities it asks for", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { token: "t".repeat(32), capabilities: ["kv:own"] }),
      )
      .mockResolvedValueOnce(
        json(200, { id: "demo", version: "1.0.0", state: "active" }),
      );
    const { result } = await pushPlugin(
      tempFile(),
      { server: "http://s", key: "tmx_k" },
      fetchImpl,
    );
    expect(result.state).toBe("active");

    const [uploadUrl, upload] = fetchImpl.mock.calls[0];
    expect(uploadUrl).toBe("http://s/plugins/upload");
    expect(upload.headers.Authorization).toBe("Bearer tmx_k");
    expect(upload.headers["Content-Type"]).toBe("application/octet-stream");

    const [installUrl, install] = fetchImpl.mock.calls[1];
    expect(installUrl).toBe(
      `http://s/plugins/upload/${"t".repeat(32)}/install`,
    );
    expect(JSON.parse(install.body)).toEqual({ capabilities: ["kv:own"] });
  });

  it("explains a server with developer mode off", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(403, {
        error: "Installing from a file needs developer mode",
        code: "DEVELOPER_MODE_OFF",
      }),
    );
    await expect(
      pushPlugin(tempFile(), { server: "http://s", key: "tmx_k" }, fetchImpl),
    ).rejects.toThrow(
      /403 Installing from a file needs developer mode\n.*developer mode/,
    );
  });
});
