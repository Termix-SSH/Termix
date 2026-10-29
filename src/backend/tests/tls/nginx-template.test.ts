import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  authLogger: { info: vi.fn(), error: vi.fn() },
}));

const { renderNginxTemplate } = await import("../../tls/nginx-reload.js");

const TEMPLATE = [
  "listen ${PORT};",
  "listen ${SSL_PORT} ssl;",
  "ssl_certificate ${SSL_CERT_PATH};",
  "    root /app/html;",
  "pid /tmp/nginx/nginx.pid;",
].join("\n");

const values = {
  port: "8080",
  sslPort: "443",
  certPath: "/data/ssl/termix.crt",
  keyPath: "/data/ssl/termix.key",
};

describe("renderNginxTemplate", () => {
  it("fills the ports and certificate", () => {
    const out = renderNginxTemplate(TEMPLATE, values);
    expect(out).toContain("listen 8080;");
    expect(out).toContain("listen 443 ssl;");
    expect(out).toContain("ssl_certificate /data/ssl/termix.crt;");
    expect(out).toContain("root /app/html;");
  });

  it("uses the install folder in place of /app", () => {
    const out = renderNginxTemplate(TEMPLATE, {
      ...values,
      appDir: "/opt/termix/",
    });
    expect(out).toContain("root /opt/termix/html;");
    expect(out).toContain("pid /tmp/nginx/nginx.pid;");
  });
});
