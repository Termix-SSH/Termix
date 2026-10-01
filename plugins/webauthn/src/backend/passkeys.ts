import { randomUUID } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  LoginMethodError,
  type PluginContext,
  type PluginVerifiedIdentity,
} from "@termix/plugin-sdk/backend";
import type { CredentialRecord, CredentialRepository } from "./repository.js";

export type UserVerification = "discouraged" | "preferred" | "required";

interface ChallengeRecord {
  challenge: string;
  userId?: string;
  rpID: string;
  origin: string;
  userVerification: UserVerification;
  createdAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function normalizeUserVerification(value: unknown): UserVerification {
  return value === "discouraged" || value === "required" ? value : "preferred";
}

function header(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

/** The browser's origin, or the one a proxy reports. */
export function requestOrigin(headers: Record<string, unknown>): string {
  const origin = header(headers, "origin");
  if (origin) return origin;
  const proto = header(headers, "x-forwarded-proto") || "http";
  const host =
    header(headers, "x-forwarded-host") ||
    header(headers, "host") ||
    "localhost";
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

export function parseTransports(
  value: string | null,
): AuthenticatorTransportFuture[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toCredential(record: CredentialRecord): WebAuthnCredential {
  return {
    id: record.credentialId as Base64URLString,
    publicKey: Uint8Array.from(
      Buffer.from(record.publicKey, "base64url"),
    ) as WebAuthnCredential["publicKey"],
    counter: record.counter,
    transports: parseTransports(record.transports),
  };
}

export type PasskeyService = ReturnType<typeof createPasskeyService>;

/**
 * Registration and sign-in ceremonies. Challenges live in memory for five
 * minutes and are made in activate, so a disabled plugin forgets them.
 */
export function createPasskeyService(
  ctx: PluginContext,
  repository: CredentialRepository,
) {
  const registrations = new Map<string, ChallengeRecord>();
  const authentications = new Map<string, ChallengeRecord>();

  const prune = (map: Map<string, ChallengeRecord>) => {
    const now = Date.now();
    for (const [id, record] of map) {
      if (now - record.createdAt > CHALLENGE_TTL_MS) map.delete(id);
    }
  };
  const put = (
    map: Map<string, ChallengeRecord>,
    record: Omit<ChallengeRecord, "createdAt">,
  ) => {
    prune(map);
    const id = randomUUID();
    map.set(id, { ...record, createdAt: Date.now() });
    return id;
  };
  const take = (map: Map<string, ChallengeRecord>, id: unknown) => {
    if (typeof id !== "string") return null;
    prune(map);
    const record = map.get(id) ?? null;
    map.delete(id);
    return record;
  };

  async function rpName(): Promise<string> {
    try {
      return (await ctx.settings.readCore("app_name")) || "Termix";
    } catch {
      return "Termix";
    }
  }

  return {
    async registrationOptions(input: {
      userId: string;
      username: string;
      origin: string;
      userVerification: UserVerification;
    }) {
      const rpID = new URL(input.origin).hostname;
      const existing = await repository.listByUserId(input.userId);
      const options = await generateRegistrationOptions({
        rpName: await rpName(),
        rpID,
        userID: Buffer.from(input.userId, "utf8"),
        userName: input.username,
        userDisplayName: input.username,
        attestationType: "none",
        excludeCredentials: existing.map((credential) => ({
          id: credential.credentialId as Base64URLString,
          transports: parseTransports(credential.transports),
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: input.userVerification,
        },
      });
      const challengeId = put(registrations, {
        challenge: options.challenge,
        userId: input.userId,
        rpID,
        origin: input.origin,
        userVerification: input.userVerification,
      });
      return { options, challengeId };
    },

    /** Stores the passkey. False when the challenge or response is bad. */
    async register(input: {
      userId: string;
      challengeId: unknown;
      response: RegistrationResponseJSON | undefined;
      name: unknown;
    }): Promise<boolean | "expired"> {
      const challenge = take(registrations, input.challengeId);
      if (!challenge || challenge.userId !== input.userId) return "expired";
      if (!input.response) return false;

      const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpID,
        requireUserVerification: challenge.userVerification === "required",
      });
      if (!verification.verified) return false;

      const { credential, credentialDeviceType, credentialBackedUp } =
        verification.registrationInfo;
      const name =
        typeof input.name === "string" && input.name.trim()
          ? input.name.trim().slice(0, 80)
          : "Passkey";
      await repository.create({
        id: randomUUID(),
        userId: input.userId,
        name,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: JSON.stringify(input.response.response?.transports ?? []),
        userVerification: challenge.userVerification,
      });
      return true;
    },

    async authenticationOptions(input: {
      userId?: string;
      origin: string;
      userVerification: UserVerification;
    }) {
      const rpID = new URL(input.origin).hostname;
      let allowCredentials:
        | { id: Base64URLString; transports?: AuthenticatorTransportFuture[] }[]
        | undefined;
      if (input.userId) {
        const credentials = await repository.listByUserId(input.userId);
        if (credentials.length === 0) return null;
        allowCredentials = credentials.map((credential) => ({
          id: credential.credentialId as Base64URLString,
          transports: parseTransports(credential.transports),
        }));
      }
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials,
        userVerification: input.userVerification,
      });
      const challengeId = put(authentications, {
        challenge: options.challenge,
        userId: input.userId,
        rpID,
        origin: input.origin,
        userVerification: input.userVerification,
      });
      return { options, challengeId };
    },

    /**
     * Checks an assertion and says who signed in. A passkey that verified
     * the user (PIN or biometric) counts as the second factor too.
     */
    async verifyLogin(
      body: Record<string, unknown>,
    ): Promise<PluginVerifiedIdentity> {
      const challenge = take(authentications, body.challengeId);
      if (!challenge) {
        throw new LoginMethodError("Authentication challenge expired", 400);
      }
      const response = body.response as AuthenticationResponseJSON | undefined;
      if (!response?.id) {
        throw new LoginMethodError("Invalid passkey response", 400);
      }
      const credential = await repository.findByCredentialId(response.id);
      if (
        !credential ||
        (challenge.userId && challenge.userId !== credential.userId)
      ) {
        throw new LoginMethodError("Passkey not recognized", 401);
      }

      let verification: Awaited<
        ReturnType<typeof verifyAuthenticationResponse>
      >;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rpID,
          credential: toCredential(credential),
          requireUserVerification: challenge.userVerification === "required",
          advancedFIDOConfig: { userVerification: challenge.userVerification },
        });
      } catch (error) {
        ctx.log.warn(
          `Passkey authentication failed for ${credential.userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new LoginMethodError("Passkey authentication failed", 401);
      }
      if (!verification.verified) {
        throw new LoginMethodError("Passkey authentication failed", 401);
      }

      await repository.updateAuthState(credential.id, {
        counter: verification.authenticationInfo.newCounter,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        deviceType: verification.authenticationInfo.credentialDeviceType,
        lastUsedAt: new Date().toISOString(),
      });

      return {
        kind: "user",
        userId: credential.userId,
        mfaSatisfied: verification.authenticationInfo.userVerified === true,
        rememberMe: !!body.rememberMe,
      };
    },
  };
}
