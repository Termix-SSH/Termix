import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { rewrite } = require("./check-importmap-csp.cjs") as {
  rewrite: (source: string, expected: [string, string][]) => string;
};

const ROOT = path.resolve(__dirname, "..");
const EXPECTED: [string, string][] = [
  ["Content-Security-Policy", "default-src 'self'"],
  ["X-Content-Type-Options", "nosniff"],
];

const CONF = `server {
        add_header X-Content-Type-Options nosniff always;

        location /api/ {
            proxy_pass http://127.0.0.1:30001;
        }

        location / {
            root /app/html;
            expires off;
            add_header Content-Security-Policy "old" always;
            add_header Cache-Control "no-store" always;
            try_files $uri /index.html;
        }
}`;

describe("check-importmap-csp", () => {
  it("puts the full header set on static locations only", () => {
    const out = rewrite(CONF, EXPECTED);
    const api = out.slice(
      out.indexOf("location /api/"),
      out.indexOf("location / {"),
    );
    expect(api).not.toContain("add_header");
    expect(out).toContain(
      `add_header Content-Security-Policy "default-src 'self'" always;`,
    );
    expect(out).toContain(`add_header Cache-Control "no-store" always;`);
    expect(out).not.toContain(`"old"`);
  });

  it("drops server level headers that would double up on proxied answers", () => {
    const out = rewrite(CONF, EXPECTED);
    expect(out.split("\n")[1]).not.toContain("add_header");
  });

  it("is stable when run twice", () => {
    const once = rewrite(CONF, EXPECTED);
    expect(rewrite(once, EXPECTED)).toBe(once);
  });

  it("finds the shipped nginx configs in step", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-importmap-csp.cjs"], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
    const conf = fs.readFileSync(path.join(ROOT, "docker/nginx.conf"), "utf8");
    expect(conf).toContain("base-uri 'none'");
    expect(conf).toContain("Cross-Origin-Opener-Policy");
  });
});
