import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserPreferenceRepository,
} from "../database/repositories/factory.js";

/**
 * Three gates, all checked on the server.
 *
 * The admin global is a hard kill switch: when it is off the feature does not
 * exist for anyone, regardless of what any user has enabled. It defaults to
 * false so upgrading an existing install turns nothing on by surprise.
 *
 * Mirrors the shape of isSharingEnabledForHost in the session-sharing routes,
 * where the global also wins over the per-entity setting.
 */

export const AI_GLOBAL_ENABLED_KEY = "ai_globally_enabled";

export async function isAiGloballyEnabled(): Promise<boolean> {
  return createCurrentSettingsRepository().getBoolean(
    AI_GLOBAL_ENABLED_KEY,
    false,
  );
}

export interface AiAccess {
  enabled: boolean;
  allowReadOnlyCommands: boolean;
}

export async function resolveAiAccess(userId: string): Promise<AiAccess> {
  const globalEnabled = await isAiGloballyEnabled();
  if (!globalEnabled) {
    return { enabled: false, allowReadOnlyCommands: false };
  }

  const preferences =
    await createCurrentUserPreferenceRepository().findByUserId(userId);

  return {
    // Null means the user was never asked, which is not consent.
    enabled: preferences?.aiAssistantEnabled === true,
    allowReadOnlyCommands: preferences?.aiReadOnlyCommands === true,
  };
}

/** Rejects any AI request unless both gates are open. */
export function createAiGate() {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const access = await resolveAiAccess(req.userId);
    if (!access.enabled) {
      res.status(403).json({ error: "The AI assistant is not enabled" });
      return;
    }

    (req as AuthenticatedRequest & { aiAccess?: AiAccess }).aiAccess = access;
    next();
  };
}
