import type { Request, Response, Router } from "express";
import { eq } from "drizzle-orm";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  normalizeUserVerification,
  parseTransports,
  requestOrigin,
  type PasskeyService,
} from "./passkeys.js";
import type { CredentialRepository } from "./repository.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const PUBLIC_PATHS = ["/authenticate/options"];

export function registerPasskeyRoutes(
  router: Router,
  ctx: PluginContext,
  repository: CredentialRepository,
  passkeys: PasskeyService,
): void {
  async function findUser(
    column: "id" | "username",
    value: string,
  ): Promise<{ id: string; username: string } | null> {
    const { users } = await ctx.db.refs<{ users: Table }>();
    const drizzle = await ctx.db.client<Drizzle>();
    const rows = await drizzle
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users[column], value))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * @openapi
   * /plugin-api/webauthn/credentials:
   *   get:
   *     summary: List passkeys
   *     description: Lists the caller's registered passkeys.
   *     tags:
   *       - Passkeys
   *     responses:
   *       200:
   *         description: List of passkeys.
   */
  router.get("/credentials", async (_req: Request, res: Response) => {
    const credentials = await repository.listByUserId(ctx.currentActor()!);
    res.json({
      credentials: credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        deviceType: credential.deviceType,
        backedUp: !!credential.backedUp,
        transports: parseTransports(credential.transports),
        userVerification: credential.userVerification,
        createdAt: credential.createdAt,
        lastUsedAt: credential.lastUsedAt,
      })),
    });
  });

  /**
   * @openapi
   * /plugin-api/webauthn/register/options:
   *   post:
   *     summary: Start passkey registration
   *     tags:
   *       - Passkeys
   *     responses:
   *       200:
   *         description: Registration options and challenge id.
   *       404:
   *         description: User not found.
   */
  router.post("/register/options", async (req: Request, res: Response) => {
    const user = await findUser("id", ctx.currentActor()!);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(
      await passkeys.registrationOptions({
        userId: user.id,
        username: user.username,
        origin: requestOrigin(req.headers),
        userVerification: normalizeUserVerification(req.body?.userVerification),
      }),
    );
  });

  /**
   * @openapi
   * /plugin-api/webauthn/register/verify:
   *   post:
   *     summary: Finish passkey registration
   *     tags:
   *       - Passkeys
   *     responses:
   *       200:
   *         description: Passkey registered.
   *       400:
   *         description: Registration failed or challenge expired.
   */
  router.post("/register/verify", async (req: Request, res: Response) => {
    const userId = ctx.currentActor()!;
    try {
      const result = await passkeys.register({
        userId,
        challengeId: req.body?.challengeId,
        response: req.body?.response as RegistrationResponseJSON | undefined,
        name: req.body?.name,
      });
      if (result === "expired") {
        return res
          .status(400)
          .json({ error: "Registration challenge expired" });
      }
      if (!result) {
        return res.status(400).json({ error: "Passkey registration failed" });
      }
      res.json({ success: true });
    } catch (error) {
      ctx.log.warn(
        `Passkey registration failed for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.status(400).json({ error: "Passkey registration failed" });
    }
  });

  /**
   * @openapi
   * /plugin-api/webauthn/authenticate/options:
   *   post:
   *     summary: Start passkey login
   *     description: Public. Authentication options, optionally scoped to a username. The assertion is then sent to /users/auth/passkey/verify.
   *     tags:
   *       - Passkeys
   *     responses:
   *       200:
   *         description: Authentication options and challenge id.
   *       404:
   *         description: No passkeys found for the user.
   */
  router.post("/authenticate/options", async (req: Request, res: Response) => {
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim() : "";
    let userId: string | undefined;
    if (username) {
      const user = await findUser("username", username);
      if (!user) return res.status(404).json({ error: "No passkeys found" });
      userId = user.id;
    }
    const result = await passkeys.authenticationOptions({
      userId,
      origin: requestOrigin(req.headers),
      userVerification: normalizeUserVerification(req.body?.userVerification),
    });
    if (!result) return res.status(404).json({ error: "No passkeys found" });
    res.json(result);
  });

  /**
   * @openapi
   * /plugin-api/webauthn/credentials/{credentialId}:
   *   delete:
   *     summary: Delete a passkey
   *     tags:
   *       - Passkeys
   *     parameters:
   *       - in: path
   *         name: credentialId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Passkey deleted.
   */
  router.delete(
    "/credentials/:credentialId",
    async (req: Request, res: Response) => {
      await repository.deleteForUser(
        ctx.currentActor()!,
        String(req.params.credentialId),
      );
      res.json({ success: true });
    },
  );
}
