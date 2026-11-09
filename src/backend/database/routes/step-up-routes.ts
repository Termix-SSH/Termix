/**
 * Proving a second factor while already signed in. A rule such as "ask before
 * connecting to a host" reads the time it last happened.
 */

import type { RequestHandler, Response, Router } from "express";
import { evaluateSecondFactors } from "../../auth/login-pipeline.js";
import { recordStepUp } from "../../auth/step-up.js";
import type { SecondFactor } from "../../auth/registry.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { getAuditUsername, logAudit } from "../../utils/audit-logger.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import { authLogger } from "../../utils/logger.js";

async function findFactor(
  userId: string,
  factorId: string,
): Promise<SecondFactor | null> {
  const { required } = await evaluateSecondFactors(userId);
  return required.find((factor) => factor.id === factorId) ?? null;
}

function fail(res: Response, error: unknown): void {
  authLogger.error("Second factor check failed", error);
  res.status(500).json({ error: "Second factor check failed" });
}

export function registerStepUpRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/auth/step-up/factors:
   *   get:
   *     summary: List the second factors the signed in user can prove
   *     tags:
   *       - Auth
   *     responses:
   *       200:
   *         description: "{ factors } with an id for each factor."
   */
  router.get("/auth/step-up/factors", authenticateJWT, async (req, res) => {
    try {
      const { userId } = req as AuthenticatedRequest;
      const { required } = await evaluateSecondFactors(userId);
      res.json({ factors: required.map((factor) => ({ id: factor.id })) });
    } catch (error) {
      fail(res, error);
    }
  });

  /**
   * @openapi
   * /users/auth/step-up/{factorId}/challenge:
   *   post:
   *     summary: Start a second factor check for the signed in user
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: factorId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Challenge data.
   *       404:
   *         description: Factor not enabled for this user.
   */
  router.post(
    "/auth/step-up/:factorId/challenge",
    authenticateJWT,
    async (req, res) => {
      try {
        const { userId } = req as AuthenticatedRequest;
        const factor = await findFactor(userId, String(req.params.factorId));
        if (!factor) {
          return res.status(404).json({ error: "Second factor not enabled" });
        }
        res.json({ challenge: (await factor.challenge?.(userId)) ?? null });
      } catch (error) {
        fail(res, error);
      }
    },
  );

  /**
   * @openapi
   * /users/auth/step-up/{factorId}/verify:
   *   post:
   *     summary: Prove a second factor while signed in
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: factorId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Proved.
   *       401:
   *         description: Wrong answer.
   *       404:
   *         description: Factor not enabled for this user.
   *       429:
   *         description: Too many attempts.
   */
  router.post(
    "/auth/step-up/:factorId/verify",
    authenticateJWT,
    async (req, res) => {
      const { userId } = req as AuthenticatedRequest;
      try {
        const lock = loginRateLimiter.isTOTPLocked(userId);
        if (lock.locked) {
          return res.status(429).json({
            error: `Too many attempts. Wait ${lock.remainingTime} seconds and try again.`,
            remainingTime: lock.remainingTime,
          });
        }
        const factor = await findFactor(userId, String(req.params.factorId));
        if (!factor) {
          return res.status(404).json({ error: "Second factor not enabled" });
        }
        loginRateLimiter.recordFailedTOTPAttempt(userId);
        const result = await factor.verify(userId, req.body ?? {});
        const passed = result === true;
        void logAudit({
          userId,
          username: await getAuditUsername(userId).catch(() => userId),
          action: "second_factor_step_up",
          resourceType: "session",
          details: JSON.stringify({ factor: factor.id }),
          success: passed,
        });
        if (!passed) {
          const message =
            result && typeof result === "object"
              ? result.error
              : "Invalid code";
          return res.status(401).json({ error: message });
        }
        loginRateLimiter.resetTOTPAttempts(userId);
        recordStepUp(userId);
        res.json({ success: true });
      } catch (error) {
        fail(res, error);
      }
    },
  );
}
