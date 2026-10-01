import type { Request, Response, Router } from "express";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import {
  LoginMethodError,
  type PluginContext,
} from "@termix/plugin-sdk/backend";
import { FACTOR_ID, normalizeCode, type TotpService } from "./totp.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export function registerTotpRoutes(
  router: Router,
  ctx: PluginContext,
  totp: TotpService,
): void {
  const actor = () => ctx.currentActor()!;

  async function accountLabel(userId: string): Promise<string> {
    try {
      const { users } = await ctx.db.refs<{ users: Table }>();
      const drizzle = await ctx.db.client<Drizzle>();
      const rows = await drizzle
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (rows[0]?.username) return `Termix (${rows[0].username})`;
    } catch {
      // The label is cosmetic.
    }
    return "Termix";
  }

  const fail = (res: Response, message: string, error: unknown) => {
    ctx.log.error(
      message,
      error instanceof Error ? error : new Error(String(error)),
    );
    res.status(500).json({ error: message });
  };

  /**
   * @openapi
   * /plugin-api/totp/status:
   *   get:
   *     summary: TOTP status for the caller
   *     tags:
   *       - TOTP
   *     responses:
   *       200:
   *         description: Whether the caller has TOTP on.
   */
  router.get("/status", async (_req: Request, res: Response) => {
    try {
      res.json({ enabled: await totp.isEnrolled(actor()) });
    } catch (error) {
      fail(res, "Failed to read TOTP status", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/totp/setup:
   *   post:
   *     summary: Start TOTP setup
   *     description: Returns a new secret and QR code. With TOTP already on, a current code or backup code in `credential` returns the existing secret instead, to add another authenticator.
   *     tags:
   *       - TOTP
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               credential:
   *                 type: string
   *     responses:
   *       200:
   *         description: Secret and QR code.
   *       400:
   *         description: A code is required.
   *       401:
   *         description: Invalid code.
   */
  router.post("/setup", async (req: Request, res: Response) => {
    const userId = actor();
    try {
      const label = await accountLabel(userId);
      if (await totp.isEnrolled(userId)) {
        const credential = normalizeCode(req.body?.credential);
        if (!credential) {
          return res.status(400).json({ error: "A TOTP code is required" });
        }
        if (!(await totp.checkCode(userId, credential))) {
          return res.status(401).json({ error: "Invalid TOTP code" });
        }
        const secret = await totp.activeSecret(userId);
        if (!secret) {
          return res.status(409).json({ error: "TOTP secret is unavailable" });
        }
        const url = speakeasy.otpauthURL({
          secret,
          label,
          encoding: "base32",
        });
        return res.json({
          secret,
          qr_code: await QRCode.toDataURL(url),
          additional: true,
        });
      }

      const { secret, otpauthUrl } = await totp.startSetup(userId, label);
      res.json({ secret, qr_code: await QRCode.toDataURL(otpauthUrl) });
    } catch (error) {
      fail(res, "Failed to setup TOTP", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/totp/enable:
   *   post:
   *     summary: Turn TOTP on
   *     description: Checks a code from the secret /setup returned, turns TOTP on and returns backup codes. Signs the caller out everywhere else.
   *     tags:
   *       - TOTP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: TOTP on, with backup codes.
   *       400:
   *         description: Missing code, already on, or setup not started.
   *       401:
   *         description: Invalid code.
   *       409:
   *         description: Core does not allow second factors right now.
   */
  router.post("/enable", async (req: Request, res: Response) => {
    const userId = actor();
    const code = normalizeCode(req.body?.totp_code);
    if (!code) return res.status(400).json({ error: "TOTP code is required" });
    try {
      if (await totp.isEnrolled(userId)) {
        return res.status(400).json({ error: "TOTP is already enabled" });
      }
      const pending = await totp.pendingSecretFor(userId, code);
      if (pending.status === "not-started") {
        return res.status(400).json({ error: "TOTP setup not initiated" });
      }
      if (pending.status === "invalid") {
        return res.status(401).json({ error: "Invalid TOTP code" });
      }
      // Core's policy first, so a refusal leaves nothing half enabled.
      await ctx.auth.recordEnrollment(userId, FACTOR_ID);
      const backupCodes = await totp.activate(userId, pending.secret);
      res.json({
        message: "TOTP enabled successfully",
        backup_codes: backupCodes,
      });
    } catch (error) {
      if (error instanceof LoginMethodError) {
        return res.status(error.status).json({ error: error.message });
      }
      fail(res, "Failed to enable TOTP", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/totp/disable:
   *   post:
   *     summary: Turn TOTP off
   *     tags:
   *       - TOTP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: TOTP off.
   *       400:
   *         description: Missing code or TOTP is not on.
   *       401:
   *         description: Invalid code.
   */
  router.post("/disable", async (req: Request, res: Response) => {
    const userId = actor();
    const code = normalizeCode(req.body?.totp_code);
    if (!code) {
      return res.status(400).json({ error: "A TOTP code is required" });
    }
    try {
      const ok = await totp.checkCode(userId, code);
      if (ok === null) {
        return res.status(400).json({ error: "TOTP is not enabled" });
      }
      if (!ok) return res.status(401).json({ error: "Invalid TOTP code" });
      await totp.remove(userId);
      await ctx.auth.removeEnrollment(userId, FACTOR_ID);
      ctx.log.info(`Two-factor authentication disabled for ${userId}`);
      res.json({ message: "TOTP disabled successfully" });
    } catch (error) {
      fail(res, "Failed to disable TOTP", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/totp/backup-codes:
   *   post:
   *     summary: Replace the backup codes
   *     tags:
   *       - TOTP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: New backup codes.
   *       400:
   *         description: Missing code or TOTP is not on.
   *       401:
   *         description: Invalid code.
   */
  router.post("/backup-codes", async (req: Request, res: Response) => {
    const userId = actor();
    const code = normalizeCode(req.body?.totp_code);
    if (!code) {
      return res.status(400).json({ error: "A TOTP code is required" });
    }
    try {
      const ok = await totp.checkCode(userId, code);
      if (ok === null) {
        return res.status(400).json({ error: "TOTP is not enabled" });
      }
      if (!ok) return res.status(401).json({ error: "Invalid TOTP code" });
      res.json({ backup_codes: await totp.replaceBackupCodes(userId) });
    } catch (error) {
      fail(res, "Failed to generate backup codes", error);
    }
  });
}
