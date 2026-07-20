import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { authLogger } from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";

const DATA_DIR = process.env.DATA_DIR || "./db/data";
const SSL_DIR = path.join(DATA_DIR, "ssl");
const ACME_WEBROOT = path.join(DATA_DIR, "acme-webroot");
const CERTBOT_DIR = path.join(DATA_DIR, "certbot");
const CERTBOT_CONFIG_DIR = path.join(CERTBOT_DIR, "config");
const CERTBOT_WORK_DIR = path.join(CERTBOT_DIR, "work");
const CERTBOT_LOGS_DIR = path.join(CERTBOT_DIR, "logs");
const CLOUDFLARE_CREDENTIALS_FILE = path.join(
  DATA_DIR,
  "ssl",
  "cloudflare.ini",
);

export type AcmeSettings = {
  enabled: boolean;
  domain: string;
  email: string;
  challengeType: "http-webroot" | "dns-cloudflare" | "manual";
  cloudflareToken: string;
  lastIssuedAt: string | null;
  certStatus: "none" | "valid" | "expiring" | "expired";
  certExpiresAt: string | null;
};

async function getAdminActor(
  userId: string | undefined,
): Promise<UserRecord | null> {
  if (!userId) return null;
  const user = await createCurrentUserRepository().findById(userId);
  return user?.isAdmin ? user : null;
}

function getCertInfo(): {
  status: "none" | "valid" | "expiring" | "expired";
  expiresAt: string | null;
} {
  const certFile = path.join(SSL_DIR, "termix.crt");
  try {
    execFileSync("openssl", ["x509", "-in", certFile, "-noout"], {
      stdio: "pipe",
    });
  } catch {
    return { status: "none", expiresAt: null };
  }

  try {
    const endDateRaw = execFileSync(
      "openssl",
      ["x509", "-in", certFile, "-noout", "-enddate"],
      { stdio: "pipe" },
    )
      .toString()
      .trim()
      .replace("notAfter=", "");
    const expiresAt = new Date(endDateRaw).toISOString();

    try {
      execFileSync(
        "openssl",
        ["x509", "-in", certFile, "-checkend", "0", "-noout"],
        {
          stdio: "pipe",
        },
      );
    } catch {
      return { status: "expired", expiresAt };
    }

    try {
      execFileSync(
        "openssl",
        ["x509", "-in", certFile, "-checkend", "2592000", "-noout"],
        {
          stdio: "pipe",
        },
      );
      return { status: "valid", expiresAt };
    } catch {
      return { status: "expiring", expiresAt };
    }
  } catch {
    return { status: "none", expiresAt: null };
  }
}

async function getAcmeSettings(): Promise<AcmeSettings> {
  const { status, expiresAt } = getCertInfo();
  const value =
    await createCurrentSettingsRepository().get("acme_ssl_settings");
  const stored = value ? JSON.parse(value) : {};

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
      res.json(await getAcmeSettings());
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
   *                 enum: [http-webroot, dns-cloudflare, manual]
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
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const settingsRepository = createCurrentSettingsRepository();
      const existing = await settingsRepository.get("acme_ssl_settings");
      const current = existing ? JSON.parse(existing) : {};

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

      await settingsRepository.set(
        "acme_ssl_settings",
        JSON.stringify(updated),
      );

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
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

      res.json(await getAcmeSettings());
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
    const actor = await getAdminActor(userId);
    try {
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const settingsValue =
        await createCurrentSettingsRepository().get("acme_ssl_settings");

      if (!settingsValue) {
        return res.status(400).json({ error: "ACME settings not configured" });
      }

      const settings = JSON.parse(settingsValue);
      const { domain, email, challengeType, cloudflareToken } = settings;

      if (!domain || !email) {
        return res.status(400).json({ error: "Domain and email are required" });
      }

      try {
        execFileSync("certbot", ["--version"], { stdio: "pipe" });
      } catch {
        return res
          .status(500)
          .json({ error: "certbot is not available in this environment" });
      }

      await fs.mkdir(SSL_DIR, { recursive: true });
      await fs.mkdir(ACME_WEBROOT, { recursive: true });
      await fs.mkdir(CERTBOT_CONFIG_DIR, { recursive: true });
      await fs.mkdir(CERTBOT_WORK_DIR, { recursive: true });
      await fs.mkdir(CERTBOT_LOGS_DIR, { recursive: true });

      const certbotDirArgs = [
        "--config-dir",
        CERTBOT_CONFIG_DIR,
        "--work-dir",
        CERTBOT_WORK_DIR,
        "--logs-dir",
        CERTBOT_LOGS_DIR,
      ];

      let certbotArgs: string[];

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

        certbotArgs = [
          "certonly",
          "--non-interactive",
          "--agree-tos",
          "--dns-cloudflare",
          "--dns-cloudflare-credentials",
          CLOUDFLARE_CREDENTIALS_FILE,
          "--dns-cloudflare-propagation-seconds",
          "30",
          "-d",
          domain,
          "--email",
          email,
          "--cert-name",
          "termix",
          ...certbotDirArgs,
        ];
      } else {
        certbotArgs = [
          "certonly",
          "--non-interactive",
          "--agree-tos",
          "--webroot",
          "-w",
          ACME_WEBROOT,
          "-d",
          domain,
          "--email",
          email,
          "--cert-name",
          "termix",
          ...certbotDirArgs,
        ];
      }

      authLogger.info("Requesting Let's Encrypt certificate", {
        domain,
        challengeType,
        operation: "acme_cert_request",
      });

      execFileSync("certbot", certbotArgs, {
        stdio: "pipe",
        timeout: 120000,
      });

      const liveDir = path.join(CERTBOT_CONFIG_DIR, "live", "termix");
      const fullchainSrc = path.join(liveDir, "fullchain.pem");
      const privkeySrc = path.join(liveDir, "privkey.pem");
      const certDest = path.join(SSL_DIR, "termix.crt");
      const keyDest = path.join(SSL_DIR, "termix.key");

      await fs.copyFile(fullchainSrc, certDest);
      await fs.copyFile(privkeySrc, keyDest);
      await fs.chmod(keyDest, 0o600);
      await fs.chmod(certDest, 0o644);

      const updated = { ...settings, lastIssuedAt: new Date().toISOString() };
      await createCurrentSettingsRepository().set(
        "acme_ssl_settings",
        JSON.stringify(updated),
      );

      authLogger.info("Let's Encrypt certificate issued and installed", {
        domain,
        operation: "acme_cert_installed",
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "acme_ssl_request",
        resourceType: "setting",
        details: JSON.stringify({ domain, challengeType, success: true }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true, ...(await getAcmeSettings()) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      authLogger.error("ACME certificate request failed", err);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor?.username ?? userId,
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

  /**
   * @openapi
   * /users/manual-ssl-upload:
   *   post:
   *     summary: Upload a manual/custom SSL certificate and key (admin only)
   *     description: Validates and installs a user-supplied PEM certificate and private key as the active Termix SSL certificate.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               certificate:
   *                 type: string
   *               privateKey:
   *                 type: string
   *     responses:
   *       200:
   *         description: Certificate uploaded and installed successfully.
   *       400:
   *         description: Invalid or missing certificate/key.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Certificate installation failed.
   */
  router.post("/manual-ssl-upload", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const actor = await getAdminActor(userId);
    try {
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { certificate, privateKey } = req.body;

      if (
        typeof certificate !== "string" ||
        typeof privateKey !== "string" ||
        !certificate.includes("BEGIN CERTIFICATE") ||
        !privateKey.includes("PRIVATE KEY")
      ) {
        return res
          .status(400)
          .json({ error: "A valid PEM certificate and private key are required" });
      }

      await fs.mkdir(SSL_DIR, { recursive: true });

      const tmpCertFile = path.join(SSL_DIR, ".manual-upload.crt.tmp");
      const tmpKeyFile = path.join(SSL_DIR, ".manual-upload.key.tmp");

      try {
        await fs.writeFile(tmpCertFile, certificate, { mode: 0o644 });
        await fs.writeFile(tmpKeyFile, privateKey, { mode: 0o600 });

        try {
          execFileSync("openssl", ["x509", "-in", tmpCertFile, "-noout"], {
            stdio: "pipe",
          });
          execFileSync(
            "openssl",
            ["pkey", "-in", tmpKeyFile, "-noout", "-check"],
            { stdio: "pipe" },
          );
        } catch {
          return res.status(400).json({
            error: "The provided certificate or private key is not valid PEM data",
          });
        }

        const certPubkey = execFileSync(
          "openssl",
          ["x509", "-in", tmpCertFile, "-noout", "-pubkey"],
          { stdio: "pipe" },
        );
        const keyPubkey = execFileSync(
          "openssl",
          ["pkey", "-in", tmpKeyFile, "-pubout"],
          { stdio: "pipe" },
        );

        if (!certPubkey.equals(keyPubkey)) {
          return res
            .status(400)
            .json({ error: "The certificate and private key do not match" });
        }

        const certDest = path.join(SSL_DIR, "termix.crt");
        const keyDest = path.join(SSL_DIR, "termix.key");
        await fs.rename(tmpCertFile, certDest);
        await fs.rename(tmpKeyFile, keyDest);
        await fs.chmod(keyDest, 0o600);
        await fs.chmod(certDest, 0o644);
      } finally {
        await fs.rm(tmpCertFile, { force: true });
        await fs.rm(tmpKeyFile, { force: true });
      }

      const settingsRepository = createCurrentSettingsRepository();
      const existing = await settingsRepository.get("acme_ssl_settings");
      const current = existing ? JSON.parse(existing) : {};
      const updated = {
        ...current,
        challengeType: "manual",
        lastIssuedAt: new Date().toISOString(),
      };
      await settingsRepository.set(
        "acme_ssl_settings",
        JSON.stringify(updated),
      );

      authLogger.info("Manual SSL certificate installed", {
        operation: "manual_ssl_installed",
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "manual_ssl_upload",
        resourceType: "setting",
        details: JSON.stringify({ success: true }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true, ...(await getAcmeSettings()) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      authLogger.error("Manual SSL certificate upload failed", err);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor?.username ?? userId,
        action: "manual_ssl_upload",
        resourceType: "setting",
        details: JSON.stringify({ error: message }),
        ipAddress,
        userAgent,
        success: false,
      });

      res
        .status(500)
        .json({ error: `Certificate installation failed: ${message}` });
    }
  });
}
