import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { systemLogger } from "./logger.js";

export class AutoSSLSetup {
  private static readonly DATA_DIR = process.env.DATA_DIR || "./db/data";
  private static readonly SSL_DIR = path.join(AutoSSLSetup.DATA_DIR, "ssl");
  private static readonly CERT_FILE = path.join(
    AutoSSLSetup.SSL_DIR,
    "termix.crt",
  );
  private static readonly KEY_FILE = path.join(
    AutoSSLSetup.SSL_DIR,
    "termix.key",
  );
  private static readonly ENV_FILE = path.join(AutoSSLSetup.DATA_DIR, ".env");

  static async initialize(): Promise<void> {
    if (process.env.ENABLE_SSL !== "true") {
      systemLogger.info("SSL not enabled - skipping certificate generation", {
        operation: "ssl_disabled_default",
        enable_ssl: process.env.ENABLE_SSL || "undefined",
        note: "Set ENABLE_SSL=true to enable SSL certificate generation",
      });
      return;
    }

    try {
      if (await this.isSSLConfigured()) {
        await this.logCertificateInfo();
        await this.setupEnvironmentVariables();
        return;
      }

      try {
        await fs.access(this.CERT_FILE);
        await fs.access(this.KEY_FILE);

        systemLogger.info("SSL certificates found from entrypoint script", {
          operation: "ssl_cert_found_entrypoint",
          cert_path: this.CERT_FILE,
          key_path: this.KEY_FILE,
        });

        await this.logCertificateInfo();
        await this.setupEnvironmentVariables();
        return;
      } catch {
        await this.generateSSLCertificates();
        await this.setupEnvironmentVariables();
      }
    } catch (error) {
      systemLogger.error("Failed to initialize SSL configuration", error, {
        operation: "ssl_auto_init_failed",
      });

      systemLogger.warn("Falling back to HTTP-only mode", {
        operation: "ssl_fallback_http",
      });
    }
  }

  private static async isSSLConfigured(): Promise<boolean> {
    try {
      await fs.access(this.CERT_FILE);
      await fs.access(this.KEY_FILE);

      execSync(
        `openssl x509 -in "${this.CERT_FILE}" -checkend 2592000 -noout`,
        {
          stdio: "pipe",
        },
      );

      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("checkend")) {
        systemLogger.warn(
          "SSL certificate is expired or expiring soon, will regenerate",
          {
            operation: "ssl_cert_expired",
            cert_path: this.CERT_FILE,
            error: error.message,
          },
        );
      } else {
        systemLogger.info(
          "SSL certificate not found or invalid, will generate new one",
          {
            operation: "ssl_cert_missing",
            cert_path: this.CERT_FILE,
          },
        );
      }
      return false;
    }
  }

  private static async generateSSLCertificates(): Promise<void> {
    try {
      try {
        execSync("openssl version", { stdio: "pipe" });
      } catch (error) {
        throw new Error(
          "OpenSSL is not installed or not available in PATH. Please install OpenSSL to enable SSL certificate generation.",
        );
      }

      await fs.mkdir(this.SSL_DIR, { recursive: true });

      const configFile = path.join(this.SSL_DIR, "openssl.conf");
      const opensslConfig = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=State
L=City
O=Termix
OU=IT Department
CN=localhost

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = 127.0.0.1
DNS.3 = *.localhost
DNS.4 = termix.local
DNS.5 = *.termix.local
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = 0.0.0.0
      `.trim();

      await fs.writeFile(configFile, opensslConfig);

      execSync(`openssl genrsa -out "${this.KEY_FILE}" 2048`, {
        stdio: "pipe",
      });

      execSync(
        `openssl req -new -x509 -key "${this.KEY_FILE}" -out "${this.CERT_FILE}" -days 365 -config "${configFile}" -extensions v3_req`,
        {
          stdio: "pipe",
        },
      );

      await fs.chmod(this.KEY_FILE, 0o600);
      await fs.chmod(this.CERT_FILE, 0o644);

      await fs.unlink(configFile);

      systemLogger.success("SSL certificates generated successfully", {
        operation: "ssl_cert_generated",
        cert_path: this.CERT_FILE,
        key_path: this.KEY_FILE,
        valid_days: 365,
      });

      await this.logCertificateInfo();
    } catch (error) {
      throw new Error(
        `SSL certificate generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private static async logCertificateInfo(): Promise<void> {
    try {
      const subject = execSync(
        `openssl x509 -in "${this.CERT_FILE}" -noout -subject`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();
      const issuer = execSync(
        `openssl x509 -in "${this.CERT_FILE}" -noout -issuer`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();
      const notAfter = execSync(
        `openssl x509 -in "${this.CERT_FILE}" -noout -enddate`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();
      const notBefore = execSync(
        `openssl x509 -in "${this.CERT_FILE}" -noout -startdate`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();

      systemLogger.info("SSL Certificate Information:", {
        operation: "ssl_cert_info",
        subject: subject.replace("subject=", ""),
        issuer: issuer.replace("issuer=", ""),
        valid_from: notBefore.replace("notBefore=", ""),
        valid_until: notAfter.replace("notAfter=", ""),
        note: "Certificate will auto-renew 30 days before expiration",
      });
    } catch (error) {
      systemLogger.warn("Could not retrieve certificate information", {
        operation: "ssl_cert_info_error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private static async setupEnvironmentVariables(): Promise<void> {
    const certPath = this.CERT_FILE;
    const keyPath = this.KEY_FILE;

    const sslEnvVars = {
      ENABLE_SSL: "false",
      SSL_PORT: process.env.SSL_PORT || "8443",
      SSL_CERT_PATH: certPath,
      SSL_KEY_PATH: keyPath,
      SSL_DOMAIN: "localhost",
    };

    let envContent = "";
    try {
      envContent = await fs.readFile(this.ENV_FILE, "utf8");
    } catch {}

    let updatedContent = envContent;
    let hasChanges = false;

    for (const [key, value] of Object.entries(sslEnvVars)) {
      const regex = new RegExp(`^${key}=.*$`, "m");

      if (regex.test(updatedContent)) {
        updatedContent = updatedContent.replace(regex, `${key}=${value}`);
      } else {
        if (!updatedContent.includes(`# SSL Configuration`)) {
          updatedContent += `\n# SSL Configuration (Auto-generated)\n`;
        }
        updatedContent += `${key}=${value}\n`;
        hasChanges = true;
      }
    }

    if (hasChanges || !envContent) {
      await fs.writeFile(this.ENV_FILE, updatedContent.trim() + "\n");

      systemLogger.info("SSL environment variables configured", {
        operation: "ssl_env_configured",
        file: this.ENV_FILE,
        variables: Object.keys(sslEnvVars),
      });
    }

    for (const [key, value] of Object.entries(sslEnvVars)) {
      process.env[key] = value;
    }
  }

  static getSSLConfig() {
    return {
      enabled: process.env.ENABLE_SSL === "true",
      port: parseInt(process.env.SSL_PORT || "8443"),
      certPath: process.env.SSL_CERT_PATH || this.CERT_FILE,
      keyPath: process.env.SSL_KEY_PATH || this.KEY_FILE,
      domain: process.env.SSL_DOMAIN || "localhost",
    };
  }
}
