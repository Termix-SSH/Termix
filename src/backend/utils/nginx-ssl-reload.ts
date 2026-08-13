import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { authLogger } from "./logger.js";

const NGINX_TEMPLATE = "/app/nginx/nginx-https.conf.template";
const NGINX_CONF = "/tmp/nginx/nginx.conf";
const NGINX_PID = "/tmp/nginx/nginx.pid";

const DATA_DIR = process.env.DATA_DIR || "./db/data";
const SSL_DIR = path.join(DATA_DIR, "ssl");
const ENV_FILE = path.join(DATA_DIR, ".env");

function persistSSLEnv(sslPort: string, certPath: string, keyPath: string) {
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
  if (!existsSync(NGINX_TEMPLATE) || !existsSync(NGINX_PID)) {
    return {
      applied: false,
      message:
        "nginx is not managed by this environment; restart Termix with ENABLE_SSL=true to apply the certificate.",
    };
  }

  const port = process.env.PORT || "8080";
  const sslPort = process.env.SSL_PORT || "8443";
  const certPath =
    process.env.SSL_CERT_PATH || path.join(SSL_DIR, "termix.crt");
  const keyPath = process.env.SSL_KEY_PATH || path.join(SSL_DIR, "termix.key");

  try {
    const template = readFileSync(NGINX_TEMPLATE, "utf8");
    const rendered = template
      .split("${PORT}")
      .join(port)
      .split("${SSL_PORT}")
      .join(sslPort)
      .split("${SSL_CERT_PATH}")
      .join(certPath)
      .split("${SSL_KEY_PATH}")
      .join(keyPath);

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
