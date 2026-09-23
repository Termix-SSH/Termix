import express, { type Request, type Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  listSshAuthProviders,
  listSshAuthTypeOwners,
} from "../../hosts/connect/auth-provider-registry.js";
import { ensureCoreSshAuthProviders } from "../../hosts/connect/core-providers.js";

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();

export interface SshAuthProviderSummary {
  type: string;
  labelKey: string;
  descriptionKey?: string;
  pluginId: string;
  fields: unknown[];
  credentialType: boolean;
  needsUserInteraction: boolean;
  supportsBackground: boolean;
  available: boolean;
  /** Set when the type belongs to a plugin that is disabled or missing. */
  missingPlugin?: { id: string; name: string };
}

export function summarizeSshAuthProviders(): SshAuthProviderSummary[] {
  ensureCoreSshAuthProviders();
  const summaries: SshAuthProviderSummary[] = listSshAuthProviders().map(
    (provider) => ({
      type: provider.type,
      labelKey: provider.labelKey,
      descriptionKey: provider.descriptionKey,
      pluginId: provider.pluginId,
      fields: provider.fields ?? [],
      credentialType: !!provider.credentialType,
      needsUserInteraction: !!provider.needsUserInteraction,
      supportsBackground: provider.supportsBackground !== false,
      available: true,
    }),
  );

  const known = new Set(summaries.map((summary) => summary.type));
  for (const owner of listSshAuthTypeOwners()) {
    if (known.has(owner.type)) continue;
    summaries.push({
      type: owner.type,
      labelKey: "",
      pluginId: owner.pluginId,
      fields: [],
      credentialType: false,
      needsUserInteraction: false,
      supportsBackground: false,
      available: false,
      missingPlugin: { id: owner.pluginId, name: owner.pluginName },
    });
  }
  return summaries;
}

/**
 * @openapi
 * /ssh-auth/providers:
 *   get:
 *     summary: List SSH auth types
 *     description: Every SSH auth type the server can connect with, from core and from plugins, plus types declared by plugins that are disabled so the host editor can explain them.
 *     tags:
 *       - SSH Auth
 *     responses:
 *       200:
 *         description: Auth type list.
 *       401:
 *         description: Not authenticated.
 */
router.get("/providers", authenticateJWT, (_req: Request, res: Response) => {
  res.json({ providers: summarizeSshAuthProviders() });
});

export default router;
