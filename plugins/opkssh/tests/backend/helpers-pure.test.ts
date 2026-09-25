import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  binaryName,
  binarySpec,
  DEFAULT_VERSION,
} from "../../src/backend/binary.js";
import {
  parseProviders,
  validateRedirectUris,
} from "../../src/backend/config.js";
import {
  normalizeSelectOpParam,
  rewriteOpksshHtml,
} from "../../src/backend/html.js";

describe("config", () => {
  it("reads providers and strips the issuer scheme", () => {
    expect(
      parseProviders(`providers:
  - alias: google
    issuer: https://accounts.google.com
    redirect_uris:
      - http://localhost:3000/login-callback
  - alias: broken
`),
    ).toEqual([
      {
        alias: "google",
        issuer: "accounts.google.com",
        redirectUris: ["http://localhost:3000/login-callback"],
      },
    ]);
  });

  it("accepts localhost redirect_uris only, naming the public callback", () => {
    const callback = "https://termix.test/plugin-api/opkssh/callback";
    expect(
      validateRedirectUris(
        [
          {
            alias: "a",
            issuer: "x",
            redirectUris: ["http://127.0.0.1:10001/login-callback"],
          },
        ],
        callback,
      ),
    ).toEqual({ ok: true });
    const refused = validateRedirectUris(
      [{ alias: "a", issuer: "x", redirectUris: [callback] }],
      callback,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.message).toContain(callback);
  });
});

describe("html", () => {
  it("sends the page's links through the proxied path", () => {
    const html = rewriteOpksshHtml(
      '<html><head></head><body><a href="/select?op=google">g</a><form action="http://localhost:4567/login"></form></body></html>',
      "/plugin-api/opkssh/chooser/req-1",
    );
    expect(html).toContain(
      'href="/plugin-api/opkssh/chooser/req-1/select?op=google"',
    );
    expect(html).toContain('action="/plugin-api/opkssh/chooser/req-1/login"');
    expect(html).toContain('<base href="/plugin-api/opkssh/chooser/req-1/">');
  });

  it("maps a provider alias to the name OPKSSH's chooser uses", () => {
    const providers = [{ alias: "work", issuer: "accounts.google.com" }];
    expect(normalizeSelectOpParam("work", providers)).toBe("google");
    expect(normalizeSelectOpParam("google", providers)).toBe("google");
    expect(normalizeSelectOpParam("other", providers)).toBe("other");
  });
});

describe("binary", () => {
  it("names the release asset per platform", () => {
    expect(binaryName("linux", "x64")).toBe("opkssh-linux-amd64");
    expect(binaryName("darwin", "arm64")).toBe("opkssh-osx-arm64");
    expect(binaryName("win32", "x64")).toBe("opkssh-windows-amd64.exe");
  });

  it("pins the default release and checks the Docker copy first", () => {
    const spec = binarySpec({}, "linux", "x64", "/app");
    expect(spec).toMatchObject({
      name: "opkssh-linux-amd64",
      version: DEFAULT_VERSION,
      url: `https://github.com/openpubkey/opkssh/releases/download/${DEFAULT_VERSION}/opkssh-linux-amd64`,
      prebuilt: [path.join("/app", "opkssh-bundled", "opkssh-linux-amd64")],
    });
    expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      binarySpec({ OPKSSH_BUNDLED_DIR: "/srv/opk" }, "linux", "x64").prebuilt,
    ).toEqual([path.join("/srv/opk", "opkssh-linux-amd64")]);
  });

  it("needs a checksum for any other release", () => {
    expect(() => binarySpec({ OPKSSH_VERSION: "v9" }, "linux", "x64")).toThrow(
      /no trusted SHA-256/,
    );
    const sha = "a".repeat(64);
    expect(
      binarySpec({ OPKSSH_VERSION: "v9", OPKSSH_SHA256: sha }, "linux", "x64"),
    ).toMatchObject({ version: "v9", sha256: sha });
  });

  it("reads the per-architecture checksum the Docker image passes on", () => {
    const amd = "b".repeat(64);
    const arm = "c".repeat(64);
    const env = {
      OPKSSH_VERSION: "v9",
      OPKSSH_SHA256_AMD64: amd,
      OPKSSH_SHA256_ARM64: arm,
    };
    expect(binarySpec(env, "linux", "x64").sha256).toBe(amd);
    expect(binarySpec(env, "linux", "arm64").sha256).toBe(arm);
  });
});
