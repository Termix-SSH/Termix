import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CONFIGS = ["docker/nginx.conf", "docker/nginx-https.conf"];

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/** nginx treats a `#` to end-of-line as a comment, variables included. */
function withoutComments(config: string): string {
  return config
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * The Docker entrypoint runs these through `envsubst` with an explicit variable
 * list. The community Proxmox LXC installer does not: it curls nginx.conf
 * straight from the repository and substitutes the listen port and nothing
 * else. nginx reads `${NAME}` as a variable reference, so every placeholder
 * that installer does not handle fails its `nginx -t` and aborts the install.
 */
const ENVSUBST_HANDLED = new Set([
  "PORT",
  "SSL_PORT",
  "SSL_CERT_PATH",
  "SSL_KEY_PATH",
]);

/** The only placeholder the LXC installer substitutes itself. */
const LXC_HANDLED = new Set(["PORT"]);

describe("nginx config templates", () => {
  for (const config of CONFIGS) {
    it(`${config} only uses placeholders the entrypoint substitutes`, () => {
      const found = [
        ...withoutComments(read(config)).matchAll(/\$\{(\w+)\}/g),
      ].map((match) => match[1]);

      expect(
        [...new Set(found)].filter((n) => !ENVSUBST_HANDLED.has(n)),
      ).toEqual([]);
    });
  }

  it("nginx.conf stays valid for consumers that do not run envsubst", () => {
    // Anything beyond the listen port must be a literal, or the Proxmox LXC
    // install breaks.
    const found = [
      ...withoutComments(read("docker/nginx.conf")).matchAll(/\$\{(\w+)\}/g),
    ].map((match) => match[1]);

    expect([...new Set(found)].filter((n) => !LXC_HANDLED.has(n))).toEqual([]);
  });

  it("ships a restrictive frame-ancestors the entrypoint can widen", () => {
    for (const config of CONFIGS) {
      expect(read(config)).toContain(
        `add_header Content-Security-Policy "frame-ancestors 'self'" always;`,
      );
    }
  });

  it("hands the backend the pre-real_ip peer for proxy authentication", () => {
    for (const config of CONFIGS) {
      expect(read(config)).toContain(
        "proxy_set_header X-Termix-Proxy-Peer $realip_remote_addr;",
      );
    }
  });
});
