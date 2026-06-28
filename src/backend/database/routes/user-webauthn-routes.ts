import type { Request, RequestHandler, Router } from "express";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import {
  generateDeviceFingerprint,
  parseUserAgent,
} from "../../utils/user-agent-parser.js";
import { db, saveMemoryDatabaseToFile } from "../db/index.js";
import { users, webauthnCredentials } from "../db/schema.js";

type UserVerification = "discouraged" | "preferred" | "required";
type NativeAppRequestChecker = (req: Request) => boolean;

interface WebAuthnRoutesDeps {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
  isNativeAppRequest: NativeAppRequestChecker;
}

interface ChallengeRecord {
  challenge: string;
  userId?: string;
  rpID: string;
  origin: string;
  userVerification: UserVerification;
  createdAt: number;
}

const challengeTtlMs = 5 * 60 * 1000;
const registrationChallenges = new Map<string, ChallengeRecord>();
const authenticationChallenges = new Map<string, ChallengeRecord>();

function normalizeUserVerification(value: unknown): UserVerification {
  return value === "discouraged" || value === "required" ? value : "preferred";
}

function getRequestOrigin(req: Request): string {
  const origin = req.get("origin");
  if (origin) return origin;

  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

function getRpID(origin: string): string {
  return new URL(origin).hostname;
}

function pruneChallenges(map: Map<string, ChallengeRecord>): void {
  const now = Date.now();
  for (const [id, record] of map) {
    if (now - record.createdAt > challengeTtlMs) {
      map.delete(id);
    }
  }
}

function putChallenge(
  map: Map<string, ChallengeRecord>,
  record: Omit<ChallengeRecord, "createdAt">,
): string {
  pruneChallenges(map);
  const challengeId = nanoid();
  map.set(challengeId, { ...record, createdAt: Date.now() });
  return challengeId;
}

function takeChallenge(
  map: Map<string, ChallengeRecord>,
  challengeId: unknown,
): ChallengeRecord | null {
  if (typeof challengeId !== "string") return null;
  pruneChallenges(map);
  const record = map.get(challengeId);
  if (!record) return null;
  map.delete(challengeId);
  return record;
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getCredentialForVerification(
  credential: typeof webauthnCredentials.$inferSelect,
): WebAuthnCredential {
  return {
    id: credential.credentialId as Base64URLString,
    publicKey: fromBase64Url(
      credential.publicKey,
    ) as WebAuthnCredential["publicKey"],
    counter: credential.counter,
    transports: parseTransports(credential.transports),
  };
}

export function registerUserWebAuthnRoutes(
  router: Router,
  { authenticateJWT, authManager, isNativeAppRequest }: WebAuthnRoutesDeps,
): void {
  router.get("/webauthn/credentials", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const credentials = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId));

    res.json({
      credentials: credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
        transports: parseTransports(credential.transports),
        userVerification: credential.userVerification,
        createdAt: credential.createdAt,
        lastUsedAt: credential.lastUsedAt,
      })),
    });
  });

  router.post(
    "/webauthn/register/options",
    authenticateJWT,
    async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!authManager.getUserDataKey(userId)) {
        return res.status(401).json({
          error: "User data is locked. Log in again before adding a passkey.",
        });
      }

      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user.length) {
        return res.status(404).json({ error: "User not found" });
      }

      const existing = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, userId));

      const origin = getRequestOrigin(req);
      const rpID = getRpID(origin);
      const userVerification = normalizeUserVerification(
        req.body?.userVerification,
      );

      const options = await generateRegistrationOptions({
        rpName: "Termix",
        rpID,
        userID: Buffer.from(userId, "utf8"),
        userName: user[0].username,
        userDisplayName: user[0].username,
        attestationType: "none",
        excludeCredentials: existing.map((credential) => ({
          id: credential.credentialId as Base64URLString,
          transports: parseTransports(credential.transports),
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification,
        },
      });

      const challengeId = putChallenge(registrationChallenges, {
        challenge: options.challenge,
        userId,
        rpID,
        origin,
        userVerification,
      });

      res.json({ options, challengeId });
    },
  );

  router.post(
    "/webauthn/register/verify",
    authenticateJWT,
    async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const challenge = takeChallenge(
        registrationChallenges,
        req.body?.challengeId,
      );
      if (!challenge || challenge.userId !== userId) {
        return res
          .status(400)
          .json({ error: "Registration challenge expired" });
      }

      try {
        const verification = await verifyRegistrationResponse({
          response: req.body?.response as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rpID,
          requireUserVerification: challenge.userVerification === "required",
        });

        if (!verification.verified) {
          return res.status(400).json({ error: "Passkey registration failed" });
        }

        const { credential, credentialDeviceType, credentialBackedUp } =
          verification.registrationInfo;
        const transports =
          (req.body?.response as RegistrationResponseJSON | undefined)?.response
            ?.transports ?? [];

        await authManager.setupWebAuthnUserEncryption(userId);

        const name =
          typeof req.body?.name === "string" && req.body.name.trim()
            ? req.body.name.trim().slice(0, 80)
            : "Passkey";

        await db.insert(webauthnCredentials).values({
          id: nanoid(),
          userId,
          name,
          credentialId: credential.id,
          publicKey: toBase64Url(credential.publicKey),
          counter: credential.counter,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          transports: JSON.stringify(transports),
          userVerification: challenge.userVerification,
          createdAt: new Date().toISOString(),
        });

        await saveMemoryDatabaseToFile();
        res.json({ success: true });
      } catch (error) {
        authLogger.warn("WebAuthn registration failed", {
          operation: "webauthn_register_verify",
          userId,
          error: error instanceof Error ? error.message : "Unknown",
        });
        res.status(400).json({ error: "Passkey registration failed" });
      }
    },
  );

  router.post("/webauthn/authenticate/options", async (req, res) => {
    const origin = getRequestOrigin(req);
    const rpID = getRpID(origin);
    const userVerification = normalizeUserVerification(
      req.body?.userVerification,
    );
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim() : "";

    let userId: string | undefined;
    let allowCredentials:
      | { id: Base64URLString; transports?: AuthenticatorTransportFuture[] }[]
      | undefined;

    if (username) {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.username, username));
      if (!user.length) {
        return res.status(404).json({ error: "No passkeys found" });
      }

      userId = user[0].id;
      const credentials = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, userId));

      if (!credentials.length) {
        return res.status(404).json({ error: "No passkeys found" });
      }

      allowCredentials = credentials.map((credential) => ({
        id: credential.credentialId as Base64URLString,
        transports: parseTransports(credential.transports),
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification,
    });

    const challengeId = putChallenge(authenticationChallenges, {
      challenge: options.challenge,
      userId,
      rpID,
      origin,
      userVerification,
    });

    res.json({ options, challengeId });
  });

  router.post("/webauthn/authenticate/verify", async (req, res) => {
    const challenge = takeChallenge(
      authenticationChallenges,
      req.body?.challengeId,
    );
    if (!challenge) {
      return res
        .status(400)
        .json({ error: "Authentication challenge expired" });
    }

    const response = req.body?.response as
      | AuthenticationResponseJSON
      | undefined;
    if (!response?.id) {
      return res.status(400).json({ error: "Invalid passkey response" });
    }

    const credentials = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, response.id));

    if (!credentials.length) {
      return res.status(401).json({ error: "Passkey not recognized" });
    }

    const credential = credentials[0];
    if (challenge.userId && challenge.userId !== credential.userId) {
      return res.status(401).json({ error: "Passkey not recognized" });
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpID,
        credential: getCredentialForVerification(credential),
        requireUserVerification: challenge.userVerification === "required",
        advancedFIDOConfig: {
          userVerification: challenge.userVerification,
        },
      });

      if (!verification.verified) {
        return res.status(401).json({ error: "Passkey authentication failed" });
      }

      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, credential.userId));
      if (!user.length) {
        return res.status(404).json({ error: "User not found" });
      }

      const userRecord = user[0];
      const deviceInfo = parseUserAgent(req);
      const dataUnlocked = await authManager.authenticateWebAuthnUser(
        userRecord.id,
        deviceInfo.type,
      );

      if (!dataUnlocked) {
        return res.status(401).json({
          error:
            "Passkey cannot unlock this account. Log in with password and register the passkey again.",
        });
      }

      await db
        .update(webauthnCredentials)
        .set({
          counter: verification.authenticationInfo.newCounter,
          backedUp: verification.authenticationInfo.credentialBackedUp,
          deviceType: verification.authenticationInfo.credentialDeviceType,
          lastUsedAt: new Date().toISOString(),
        })
        .where(eq(webauthnCredentials.id, credential.id));

      if (userRecord.totpEnabled) {
        const deviceFingerprint = generateDeviceFingerprint(deviceInfo);
        const isTrusted = await authManager.isTrustedDevice(
          userRecord.id,
          deviceFingerprint,
        );

        if (!isTrusted) {
          await saveMemoryDatabaseToFile();
          const tempToken = await authManager.generateJWTToken(userRecord.id, {
            pendingTOTP: true,
            expiresIn: "10m",
          });
          return res.json({
            success: true,
            requires_totp: true,
            temp_token: tempToken,
            rememberMe: !!req.body?.rememberMe,
          });
        }
      }

      const token = await authManager.generateJWTToken(userRecord.id, {
        rememberMe: !!req.body?.rememberMe,
        deviceType: deviceInfo.type,
        deviceInfo: deviceInfo.deviceInfo,
      });

      await saveMemoryDatabaseToFile();

      const timeoutRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'session_timeout_hours'",
        )
        .get() as { value: string } | undefined;
      const timeoutHours = timeoutRow
        ? parseInt(timeoutRow.value, 10) || 24
        : 24;
      const maxAge = req.body?.rememberMe
        ? 30 * 24 * 60 * 60 * 1000
        : timeoutHours * 60 * 60 * 1000;

      res.cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge));
      res.json({
        success: true,
        is_admin: !!userRecord.isAdmin,
        username: userRecord.username,
        userId: userRecord.id,
        is_oidc: !!userRecord.isOidc,
        totp_enabled: !!userRecord.totpEnabled,
        data_unlocked: true,
        ...(isNativeAppRequest(req) ? { token } : {}),
      });
    } catch (error) {
      authLogger.warn("WebAuthn authentication failed", {
        operation: "webauthn_auth_verify",
        credentialId: credential.id,
        userId: credential.userId,
        error: error instanceof Error ? error.message : "Unknown",
      });
      res.status(401).json({ error: "Passkey authentication failed" });
    }
  });

  router.delete(
    "/webauthn/credentials/:credentialId",
    authenticateJWT,
    async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const credentialId = String(req.params.credentialId);

      await db
        .delete(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.id, credentialId),
            eq(webauthnCredentials.userId, userId),
          ),
        );
      await saveMemoryDatabaseToFile();

      res.json({ success: true });
    },
  );
}
