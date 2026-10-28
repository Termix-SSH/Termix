import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import bcrypt from "bcryptjs";
import { authLogger } from "../../utils/logger.js";
import { createCurrentUserRepository } from "../repositories/factory.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export function registerUserDeleteAccountRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/delete-account:
   *   delete:
   *     summary: Delete user account
   *     description: Deletes the authenticated user's account and all of their data.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               password:
   *                 type: string
   *     responses:
   *       200:
   *         description: Account deleted successfully.
   *       400:
   *         description: Password is required.
   *       401:
   *         description: Incorrect password.
   *       403:
   *         description: Cannot delete external authentication accounts or the last admin user.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to delete account.
   */
  router.delete("/delete-account", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { password } = req.body ?? {};

    if (!isNonEmptyString(password)) {
      return res
        .status(400)
        .json({ error: "Password is required to delete account" });
    }

    try {
      const userRepository = createCurrentUserRepository();
      const userRecord = await userRepository.findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      if (userRecord.isExternal) {
        return res.status(403).json({
          error:
            "Cannot delete external authentication accounts through this endpoint",
        });
      }

      const isMatch = await bcrypt.compare(password, userRecord.passwordHash);
      if (!isMatch) {
        authLogger.warn(
          `Incorrect password provided for account deletion: ${userRecord.username}`,
        );
        return res.status(401).json({ error: "Incorrect password" });
      }

      if (userRecord.isAdmin && (await userRepository.countAdmins()) <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }

      // Same cleanup as an admin delete, so plugins hear user.deleted too.
      await deleteUserAndRelatedData(userId);

      authLogger.success(`User account deleted: ${userRecord.username}`);
      res.json({ message: "Account deleted successfully" });
    } catch (err) {
      authLogger.error("Failed to delete user account", err);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });
}
