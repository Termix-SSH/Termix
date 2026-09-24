import type { PluginSettings } from "@termix/plugin-sdk/backend";
import { DEFAULT_PRIVATE_ALLOWLIST, parseAllowlist } from "./egress.js";

/**
 * Three gates, all checked on the server.
 *
 * The admin switch is a hard kill switch: when it is off the feature does not
 * exist for anyone, regardless of what any user has enabled. It defaults to
 * false so upgrading an existing install turns nothing on by surprise. Then
 * each user opts in for themselves, and RBAC decides what they may do.
 */

export type SettingsReader = Pick<PluginSettings, "get" | "getUser">;

export async function isAiGloballyEnabled(
  settings: SettingsReader,
): Promise<boolean> {
  return (await settings.get<boolean>("globallyEnabled")) === true;
}

/** The admin's private endpoint hosts, one per line. */
export async function readPrivateAllowlist(
  settings: SettingsReader,
): Promise<string[]> {
  const raw = await settings.get<string>("privateEndpoints");
  if (raw === undefined || raw === null) return [...DEFAULT_PRIVATE_ALLOWLIST];
  return parseAllowlist(raw);
}

export interface AiAccess {
  enabled: boolean;
  allowReadOnlyCommands: boolean;
}

export async function resolveAiAccess(
  settings: SettingsReader,
  userId: string,
): Promise<AiAccess> {
  if (!(await isAiGloballyEnabled(settings))) {
    return { enabled: false, allowReadOnlyCommands: false };
  }

  // Unset means the user was never asked, which is not consent.
  const enabled = (await settings.getUser<boolean>(userId, "enabled")) === true;
  return {
    enabled,
    allowReadOnlyCommands:
      enabled &&
      (await settings.getUser<boolean>(userId, "allowReadOnlyCommands")) ===
        true,
  };
}

interface GateRequest {
  aiAccess?: AiAccess;
}

interface GateResponse {
  status: (code: number) => { json: (body: unknown) => unknown };
}

/** Rejects any AI request unless both gates are open. */
export function createAiGate(
  settings: SettingsReader,
  currentActor: () => string | undefined,
) {
  return async (
    req: GateRequest,
    res: GateResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    const userId = currentActor();
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const access = await resolveAiAccess(settings, userId);
      if (!access.enabled) {
        res.status(403).json({ error: "The AI assistant is not enabled" });
        return;
      }
      req.aiAccess = access;
      next();
    } catch (error) {
      next(error);
    }
  };
}
