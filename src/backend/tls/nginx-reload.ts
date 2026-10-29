import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { authLogger } from "../utils/logger.js";

// The Docker image's paths. An install outside Docker (a Proxmox LXC script,
// a source checkout) points these at its own nginx instead.
const nginxTemplate = () =>
  process.env.TERMIX_NGINX_TEMPLATE || "/app/nginx/nginx-https.conf.template";
const nginxConf = () =>
  process.env.TERMIX_NGINX_CONF || "/tmp/nginx/nginx.conf";
const nginxPid = () => process.env.TERMIX_NGINX_PID || "/tmp/nginx/nginx.pid";

/** The template with Termix's own folder in place of the image's /app. */
export function renderNginxTemplate(
  template: string,
  values: {
    port: string;
    sslPort: string;
    certPath: string;
    keyPath: string;
    appDir?: string;
  },
): string {
  let rendered = template
    .split("${PORT}")
    .join(values.port)
    .split("${SSL_PORT}")
    .join(values.sslPort)
    .split("${SSL_CERT_PATH}")
    .join(values.certPath)
    .split("${SSL_KEY_PATH}")
    .join(values.keyPath);
  const appDir = values.appDir?.replace(/\/+$/, "");
  if (appDir && appDir !== "/app") {
    rendered = rendered.replace(/(^|[\s;])\/app\//gm, `$1${appDir}/`);
  }
  return rendered;
}

const DATA_DIR = process.env.DATA_DIR || "./db/data";
const SSL_DIR = path.join(DATA_DIR, "ssl");
const ENV_FILE = path.join(DATA_DIR, ".env");

export function persistSSLEnv(
  sslPort: string,
  certPath: string,
  keyPath: string,
) {
  const vars: Record<string, string> = {
    ENABLE_SSL: "true",
    SSL_PORT: sslPort,
    SSL_CERT_PATH: certPath,
    SSL_KEY_PATH: keyPath,
  };

  let content = "";
  try {
    content = readFileSync(ENV_FILE, "utf8");
  } catch {
    // no existing .env file yet
  }

  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      if (!content.includes("# SSL Configuration")) {
        content += `\n# SSL Configuration (Auto-generated)\n`;
      }
      content += `${key}=${value}\n`;
    }
  }

  writeFileSync(ENV_FILE, content.trim() + "\n");
}

/**
 * Regenerates the nginx config from the HTTPS template and reloads nginx so a
 * newly issued/uploaded certificate is served without a full container
 * restart. No-ops outside the Docker image (template/binary won't exist).
 */
export function reloadNginxWithSSL(): { applied: boolean; message: string } {
  const NGINX_TEMPLATE = nginxTemplate();
  const NGINX_CONF = nginxConf();
  if (!existsSync(NGINX_TEMPLATE) || !existsSync(nginxPid())) {
    return {
      applied: false,
      message:
        "Termix could not find the nginx it runs with, so HTTPS is not on yet. In Docker, restart Termix with ENABLE_SSL=true. On another install, set TERMIX_NGINX_TEMPLATE, TERMIX_NGINX_CONF and TERMIX_NGINX_PID (and TERMIX_APP_DIR if it is not /app), or add a listen 443 ssl block with this certificate to your nginx config.",
    };
  }

  const port = process.env.PORT || "8080";
  const sslPort = process.env.SSL_PORT || "8443";
  const certPath =
    process.env.SSL_CERT_PATH || path.join(SSL_DIR, "termix.crt");
  const keyPath = process.env.SSL_KEY_PATH || path.join(SSL_DIR, "termix.key");

  try {
    const rendered = renderNginxTemplate(readFileSync(NGINX_TEMPLATE, "utf8"), {
      port,
      sslPort,
      certPath,
      keyPath,
      appDir: process.env.TERMIX_APP_DIR,
    });

    writeFileSync(NGINX_CONF, rendered);

    execFileSync("nginx", ["-t", "-c", NGINX_CONF], { stdio: "pipe" });
    execFileSync("nginx", ["-s", "reload", "-c", NGINX_CONF], {
      stdio: "pipe",
    });

    process.env.ENABLE_SSL = "true";
    process.env.SSL_PORT = sslPort;
    process.env.SSL_CERT_PATH = certPath;
    process.env.SSL_KEY_PATH = keyPath;
    persistSSLEnv(sslPort, certPath, keyPath);

    authLogger.info("nginx reloaded with HTTPS enabled", {
      operation: "nginx_ssl_reload",
      sslPort,
    });

    return {
      applied: true,
      message: `HTTPS is now active on port ${sslPort}. Make sure that port is published/mapped to this container.`,
    };
  } catch (err) {
    authLogger.error("Failed to reload nginx with SSL config", err);
    return {
      applied: false,
      message:
        "Certificate installed, but nginx could not be reloaded automatically. Restart Termix with ENABLE_SSL=true to apply it.",
    };
  }
}
