import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { systemLogger } from "./logger.js";

/**
 * Auto SSL Setup - Optional SSL certificate generation for Termix
 *
 * Linus principle: Simple defaults, optional security features
 * - SSL disabled by default to avoid setup complexity
 * - Auto-generates SSL certificates when enabled
 * - Uses container-appropriate paths
 * - Users can enable SSL by setting ENABLE_SSL=true
 */
export class AutoSSLSetup {
  private static readonly SSL_DIR = path.join(process.cwd(), "ssl");
  private static readonly CERT_FILE = path.join(AutoSSLSetup.SSL_DIR, "termix.crt");
  private static readonly KEY_FILE = path.join(AutoSSLSetup.SSL_DIR, "termix.key");
  private static readonly ENV_FILE = path.join(process.cwd(), ".env");

  /**
   * Initialize SSL setup automatically during system startup
   */
  static async initialize(): Promise<void> {
    try {
      systemLogger.info("🔐 Initializing SSL/TLS configuration...", {
        operation: "ssl_auto_init"
      });

      // Check if SSL is already properly configured
      if (await this.isSSLConfigured()) {
        systemLogger.info("✅ SSL configuration already exists and is valid", {
          operation: "ssl_already_configured"
        });
        return;
      }

      // Auto-generate SSL certificates
      await this.generateSSLCertificates();

      // Setup environment variables for SSL
      await this.setupEnvironmentVariables();

      systemLogger.success("🚀 SSL/TLS configuration completed successfully", {
        operation: "ssl_auto_init_complete",
        https_port: process.env.SSL_PORT || "8443",
        note: "HTTPS/WSS is now enabled by default"
      });

    } catch (error) {
      systemLogger.error("❌ Failed to initialize SSL configuration", error, {
        operation: "ssl_auto_init_failed"
      });

      // Don't crash the application - fallback to HTTP
      systemLogger.warn("⚠️  Falling back to HTTP-only mode", {
        operation: "ssl_fallback_http"
      });
    }
  }

  /**
   * Check if SSL is already properly configured
   */
  private static async isSSLConfigured(): Promise<boolean> {
    try {
      // Check if certificate files exist
      await fs.access(this.CERT_FILE);
      await fs.access(this.KEY_FILE);

      // Check if certificate is still valid (at least 30 days)
      const result = execSync(`openssl x509 -in "${this.CERT_FILE}" -checkend 2592000 -noout`, {
        stdio: 'pipe'
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate SSL certificates automatically
   */
  private static async generateSSLCertificates(): Promise<void> {
    systemLogger.info("🔑 Generating SSL certificates for local development...", {
      operation: "ssl_cert_generation"
    });

    try {
      // Create SSL directory
      await fs.mkdir(this.SSL_DIR, { recursive: true });

      // Create OpenSSL config for comprehensive certificate
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
      `.trim();

      await fs.writeFile(configFile, opensslConfig);

      // Generate private key
      execSync(`openssl genrsa -out "${this.KEY_FILE}" 2048`, { stdio: 'pipe' });

      // Generate certificate
      execSync(`openssl req -new -x509 -key "${this.KEY_FILE}" -out "${this.CERT_FILE}" -days 365 -config "${configFile}" -extensions v3_req`, {
        stdio: 'pipe'
      });

      // Set proper permissions
      await fs.chmod(this.KEY_FILE, 0o600);
      await fs.chmod(this.CERT_FILE, 0o644);

      // Clean up temp config
      await fs.unlink(configFile);

      systemLogger.success("✅ SSL certificates generated successfully", {
        operation: "ssl_cert_generated",
        cert_path: this.CERT_FILE,
        key_path: this.KEY_FILE,
        valid_days: 365
      });

    } catch (error) {
      throw new Error(`SSL certificate generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Setup environment variables for SSL configuration
   */
  private static async setupEnvironmentVariables(): Promise<void> {
    systemLogger.info("⚙️  Configuring SSL environment variables...", {
      operation: "ssl_env_setup"
    });

    // Use container paths in production, local paths in development
    const isProduction = process.env.NODE_ENV === "production";
    const certPath = isProduction ? "/app/ssl/termix.crt" : this.CERT_FILE;
    const keyPath = isProduction ? "/app/ssl/termix.key" : this.KEY_FILE;

    const sslEnvVars = {
      ENABLE_SSL: "false", // Disable SSL by default to avoid setup issues
      SSL_PORT: process.env.SSL_PORT || "8443",
      SSL_CERT_PATH: certPath,
      SSL_KEY_PATH: keyPath,
      SSL_DOMAIN: "localhost"
    };

    // Check if .env file exists
    let envContent = "";
    try {
      envContent = await fs.readFile(this.ENV_FILE, 'utf8');
    } catch {
      // .env doesn't exist, will create new one
    }

    // Update or add SSL variables
    let updatedContent = envContent;
    let hasChanges = false;

    for (const [key, value] of Object.entries(sslEnvVars)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');

      if (regex.test(updatedContent)) {
        // Update existing variable
        updatedContent = updatedContent.replace(regex, `${key}=${value}`);
      } else {
        // Add new variable
        if (!updatedContent.includes(`# SSL Configuration`)) {
          updatedContent += `\n# SSL Configuration (Auto-generated)\n`;
        }
        updatedContent += `${key}=${value}\n`;
        hasChanges = true;
      }
    }

    // Write updated .env file if there are changes
    if (hasChanges || !envContent) {
      await fs.writeFile(this.ENV_FILE, updatedContent.trim() + '\n');

      systemLogger.info("✅ SSL environment variables configured", {
        operation: "ssl_env_configured",
        file: this.ENV_FILE,
        variables: Object.keys(sslEnvVars)
      });
    }

    // Update process.env for current session
    for (const [key, value] of Object.entries(sslEnvVars)) {
      process.env[key] = value;
    }
  }

  /**
   * Get SSL configuration for nginx/server
   */
  static getSSLConfig() {
    return {
      enabled: process.env.ENABLE_SSL === "true",
      port: parseInt(process.env.SSL_PORT || "8443"),
      certPath: process.env.SSL_CERT_PATH || this.CERT_FILE,
      keyPath: process.env.SSL_KEY_PATH || this.KEY_FILE,
      domain: process.env.SSL_DOMAIN || "localhost"
    };
  }

  /**
   * Display SSL setup information
   */
  static logSSLInfo(): void {
    const config = this.getSSLConfig();

    if (config.enabled) {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   🔒 Termix SSL/TLS Enabled                  ║
╠══════════════════════════════════════════════════════════════╣
║ HTTPS Port: ${config.port.toString().padEnd(47)} ║
║ HTTP Port:  ${(process.env.PORT || "8080").padEnd(47)} ║
║ Domain:     ${config.domain.padEnd(47)} ║
║                                                              ║
║ 🌐 Access URLs:                                              ║
║   • HTTPS: https://localhost:${config.port.toString().padEnd(31)} ║
║   • HTTP:  http://localhost:${(process.env.PORT || "8080").padEnd(32)} ║
║                                                              ║
║ 🔐 WebSocket connections automatically use WSS over HTTPS    ║
║ ⚠️  Self-signed certificate will show browser warnings      ║
╚══════════════════════════════════════════════════════════════╝
      `);
    }
  }
}