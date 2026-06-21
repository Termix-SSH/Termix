import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";

const DATA_DIR = process.env.DATA_DIR || "./db/data";
const SSL_DIR = path.join(DATA_DIR, "ssl");
const ACME_WEBROOT = path.join(DATA_DIR, "acme-webroot");
const CLOUDFLARE_CREDENTIALS_FILE = path.join(
  DATA_DIR,
  "ssl",
  "cloudflare.ini",
);

export type AcmeSettings = {
  enabled: boolean;
  domain: string;
  email: string;
  challengeType: "http-webroot" | "dns-cloudflare";
  cloudflareToken: string;
  lastIssuedAt: string | null;
  certStatus: "none" | "valid" | "expiring" | "expired";
  certExpiresAt: string | null;
};

function getCertInfo(): {
  status: "none" | "valid" | "expiring" | "expired";
  expiresAt: string | null;
} {
  const certFile = path.join(SSL_DIR, "termix.crt");
  try {
    execSync(`openssl x509 -in "${certFile}" -noout 2>/dev/null`, {
      stdio: "pipe",
    });
  } catch {
    return { status: "none", expiresAt: null };
  }

  try {
    const endDateRaw = execSync(
      `openssl x509 -in "${certFile}" -noout -enddate`,
      { stdio: "pipe" },
    )
      .toString()
      .trim()
      .replace("notAfter=", "");
    const expiresAt = new Date(endDateRaw).toISOString();

    try {
      execSync(`openssl x509 -in "${certFile}" -checkend 0 -noout`, {
        stdio: "pipe",
      });
    } catch {
      return { status: "expired", expiresAt };
    }

    try {
      execSync(`openssl x509 -in "${certFile}" -checkend 2592000 -noout`, {
        stdio: "pipe",
      });
      return { status: "valid", expiresAt };
    } catch {
      return { status: "expiring", expiresAt };
    }
  } catch {
    return { status: "none", expiresAt: null };
  }
}

function getAcmeSettingsFromDb(): AcmeSettings {
  const row = db.$client
    .prepare("SELECT value FROM settings WHERE key = 'acme_ssl_settings'")
    .get() as { value: string } | undefined;

  const { status, expiresAt } = getCertInfo();
  const stored = row ? JSON.parse(row.value) : {};

  return {
    enabled: stored.enabled ?? false,
    domain: stored.domain ?? "",
    email: stored.email ?? "",
    challengeType: stored.challengeType ?? "http-webroot",
    cloudflareToken: stored.cloudflareToken
      ? `${stored.cloudflareToken.slice(0, 4)}${"*".repeat(Math.max(0, stored.cloudflareToken.length - 4))}`
      : "",
    lastIssuedAt: stored.lastIssuedAt ?? null,
    certStatus: status,
    certExpiresAt: expiresAt,
  };
}

export function registerAcmeSSLRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/acme-ssl-settings:
   *   get:
   *     summary: Get ACME SSL settings
   *     description: Returns current ACME/Let's Encrypt configuration and certificate status.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: ACME SSL settings and certificate status.
   *       500:
   *         description: Failed to get ACME SSL settings.
   */
  router.get("/acme-ssl-settings", authenticateJWT, async (_req, res) => {
    try {
      res.json(getAcmeSettingsFromDb());
    } catch (err) {
      authLogger.error("Failed to get ACME SSL settings", err);
      res.status(500).json({ error: "Failed to get ACME SSL settings" });
    }
  });

  /**
   * @openapi
   * /users/acme-ssl-settings:
   *   patch:
   *     summary: Update ACME SSL settings (admin only)
   *     description: Saves ACME/Let's Encrypt configuration.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *               domain:
   *                 type: string
   *               email:
   *                 type: string
   *               challengeType:
   *                 type: string
   *                 enum: [http-webroot, dns-cloudflare]
   *               cloudflareToken:
   *                 type: string
   *     responses:
   *       200:
   *         description: ACME SSL settings updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update ACME SSL settings.
   */
  router.patch("/acme-ssl-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0 || !user[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const existing = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'acme_ssl_settings'")
        .get() as { value: string } | undefined;
      const current = existing ? JSON.parse(existing.value) : {};

      const { enabled, domain, email, challengeType, cloudflareToken } =
        req.body;

      const updated = {
        ...current,
        ...(typeof enabled === "boolean" && { enabled }),
        ...(typeof domain === "string" && { domain }),
        ...(typeof email === "string" && { email }),
        ...(typeof challengeType === "string" && { challengeType }),
        ...(typeof cloudflareToken === "string" &&
          cloudflareToken &&
          !cloudflareToken.includes("*") && { cloudflareToken }),
      };

      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('acme_ssl_settings', ?)",
        )
        .run(JSON.stringify(updated));

      const { ipAddress, userAgent } = getRequestMeta(req);
      const actorRecord = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: actorRecord[0]?.username ?? userId,
        action: "update_acme_ssl_settings",
        resourceType: "setting",
        details: JSON.stringify({
          enabled,
          domain,
          email,
          challengeType,
          hasCloudflareToken: !!updated.cloudflareToken,
        }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json(getAcmeSettingsFromDb());
    } catch (err) {
      authLogger.error("Failed to update ACME SSL settings", err);
      res.status(500).json({ error: "Failed to update ACME SSL settings" });
    }
  });

  /**
   * @openapi
   * /users/acme-ssl-request:
   *   post:
   *     summary: Request or renew Let's Encrypt certificate (admin only)
   *     description: Triggers certbot to issue or renew a certificate using the configured challenge method.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Certificate issued or renewed successfully.
   *       400:
   *         description: Invalid configuration.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Certificate issuance failed.
   */
  router.post("/acme-ssl-request", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0 || !user[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const row = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'acme_ssl_settings'")
        .get() as { value: string } | undefined;

      if (!row) {
        return res.status(400).json({ error: "ACME settings not configured" });
      }

      const settings = JSON.parse(row.value);
      const { domain, email, challengeType, cloudflareToken } = settings;

      if (!domain || !email) {
        return res.status(400).json({ error: "Domain and email are required" });
      }

      try {
        execSync("certbot --version", { stdio: "pipe" });
      } catch {
        return res
          .status(500)
          .json({ error: "certbot is not available in this environment" });
      }

      await fs.mkdir(SSL_DIR, { recursive: true });
      await fs.mkdir(ACME_WEBROOT, { recursive: true });

      let certbotCmd: string;

      if (challengeType === "dns-cloudflare") {
        if (!cloudflareToken) {
          return res.status(400).json({
            error: "Cloudflare API token is required for DNS challenge",
          });
        }

        await fs.mkdir(path.dirname(CLOUDFLARE_CREDENTIALS_FILE), {
          recursive: true,
        });
        await fs.writeFile(
          CLOUDFLARE_CREDENTIALS_FILE,
          `dns_cloudflare_api_token = ${cloudflareToken}\n`,
          { mode: 0o600 },
        );

        certbotCmd = [
          "certbot",
          "certonly",
          "--non-interactive",
          "--agree-tos",
          "--dns-cloudflare",
          `--dns-cloudflare-credentials "${CLOUDFLARE_CREDENTIALS_FILE}"`,
          "--dns-cloudflare-propagation-seconds",
          "30",
          "-d",
          `"${domain}"`,
          "--email",
          `"${email}"`,
          "--cert-name",
          "termix",
        ].join(" ");
      } else {
        certbotCmd = [
          "certbot",
          "certonly",
          "--non-interactive",
          "--agree-tos",
          "--webroot",
          "-w",
          `"${ACME_WEBROOT}"`,
          "-d",
          `"${domain}"`,
          "--email",
          `"${email}"`,
          "--cert-name",
          "termix",
        ].join(" ");
      }

      authLogger.info("Requesting Let's Encrypt certificate", {
        domain,
        challengeType,
        operation: "acme_cert_request",
      });

      execSync(certbotCmd, { stdio: "pipe", timeout: 120000 });

      const liveDir = `/etc/letsencrypt/live/termix`;
      const fullchainSrc = path.join(liveDir, "fullchain.pem");
      const privkeySrc = path.join(liveDir, "privkey.pem");
      const certDest = path.join(SSL_DIR, "termix.crt");
      const keyDest = path.join(SSL_DIR, "termix.key");

      await fs.copyFile(fullchainSrc, certDest);
      await fs.copyFile(privkeySrc, keyDest);
      await fs.chmod(keyDest, 0o600);
      await fs.chmod(certDest, 0o644);

      const updated = { ...settings, lastIssuedAt: new Date().toISOString() };
      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('acme_ssl_settings', ?)",
        )
        .run(JSON.stringify(updated));

      authLogger.info("Let's Encrypt certificate issued and installed", {
        domain,
        operation: "acme_cert_installed",
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      const actorRecord = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: actorRecord[0]?.username ?? userId,
        action: "acme_ssl_request",
        resourceType: "setting",
        details: JSON.stringify({ domain, challengeType, success: true }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true, ...getAcmeSettingsFromDb() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      authLogger.error("ACME certificate request failed", err);

      const { ipAddress, userAgent } = getRequestMeta(req);
      const actorRecord = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: actorRecord[0]?.username ?? userId,
        action: "acme_ssl_request",
        resourceType: "setting",
        details: JSON.stringify({ error: message }),
        ipAddress,
        userAgent,
        success: false,
      });

      res.status(500).json({ error: `Certificate request failed: ${message}` });
    }
  });
}
