import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { AuthSessions } from "./auth-session.js";
import type {
  ProfileInput,
  ProfileRow,
  ProfileStore,
} from "./profile-store.js";

/**
 * Vault sends the browser back here without a Termix session: the sign-in is
 * matched by the state Vault issued.
 */
export const PUBLIC_PATHS = ["/oidc/callback"];

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resultPage(ok: boolean, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Termix</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{max-width:28rem;padding:2rem;border:1px solid #333;background:#181818}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;color:#aaa}</style></head>
<body><main><h1>${ok ? "Vault sign-in complete" : "Vault sign-in failed"}</h1><p>${escapeHtml(message)}</p></main>
${ok ? "<script>setTimeout(function(){window.close()},1500)</script>" : ""}</body></html>`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatProfile(row: ProfileRow, userId: string) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    folder: row.folder,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    vaultAddr: row.vaultAddr,
    vaultNamespace: row.vaultNamespace,
    oidcMount: row.oidcMount,
    oidcRole: row.oidcRole,
    sshMount: row.sshMount,
    sshRole: row.sshRole,
    validPrincipals: row.validPrincipals,
    keyType: row.keyType,
    shared: !!row.shared,
    owned: row.userId === userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseId(req: Request): number | null {
  const id = Number.parseInt(String(req.params.id), 10);
  return Number.isFinite(id) ? id : null;
}

export function registerRoutes(
  ctx: PluginContext,
  router: Router,
  profiles: ProfileStore,
  sessions: AuthSessions,
): void {
  const userId = () => ctx.currentActor() as string;

  /**
   * @openapi
   * /plugin-api/vault/oidc/callback:
   *   get:
   *     summary: Vault OIDC callback
   *     description: Public. The redirect URI a Vault OIDC role allows. Matches the sign-in by the state Vault issued, has Vault sign the ephemeral key and tells the terminal to reconnect. The 2.8 URI /vault/oidc/callback redirects here.
   *     tags: [Vault]
   *     parameters:
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *       - in: query
   *         name: code
   *         schema:
   *           type: string
   *       - in: query
   *         name: error
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Signed in; an HTML page that closes itself.
   *       400:
   *         description: The sign-in failed or is no longer active.
   */
  router.get("/oidc/callback", async (req: Request, res: Response) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const error = typeof req.query.error === "string" ? req.query.error : "";

    const reply = (ok: boolean, message: string) =>
      res
        .status(ok ? 200 : 400)
        .type("html")
        .send(resultPage(ok, message));

    if (error) return reply(false, `Vault returned: ${error}`);
    if (!state || !code) return reply(false, "Missing state or code.");
    const result = await sessions.complete(state, code);
    return reply(result.ok, result.message);
  });

  router.use("/profiles", ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/vault/profiles:
   *   get:
   *     summary: List Vault profiles
   *     description: The caller's own Vault signer profiles and every shared one. Needs vault.use.
   *     tags: [Vault]
   *     responses:
   *       200:
   *         description: Array of Vault profile objects.
   *       403:
   *         description: Missing vault.use.
   */
  router.get("/profiles", async (_req: Request, res: Response) => {
    const rows = await profiles.listVisible(userId());
    res.json(rows.map((row) => formatProfile(row, userId())));
  });

  /**
   * @openapi
   * /plugin-api/vault/profiles:
   *   post:
   *     summary: Create a Vault profile
   *     description: Creates a Vault signer profile owned by the caller. Needs vault.use, and vault.share to mark it shared.
   *     tags: [Vault]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, vaultAddr, sshRole]
   *             properties:
   *               name:
   *                 type: string
   *               vaultAddr:
   *                 type: string
   *               vaultNamespace:
   *                 type: string
   *               oidcMount:
   *                 type: string
   *               oidcRole:
   *                 type: string
   *               sshMount:
   *                 type: string
   *               sshRole:
   *                 type: string
   *               validPrincipals:
   *                 type: string
   *               keyType:
   *                 type: string
   *               shared:
   *                 type: boolean
   *     responses:
   *       201:
   *         description: The created profile.
   *       400:
   *         description: Missing required fields.
   *       403:
   *         description: Missing vault.use, or vault.share for a shared profile.
   */
  router.post("/profiles", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      !isNonEmptyString(body.name) ||
      !isNonEmptyString(body.vaultAddr) ||
      !isNonEmptyString(body.sshRole)
    ) {
      return res
        .status(400)
        .json({ error: "name, vaultAddr and sshRole are required" });
    }
    const shared = !!body.shared;
    if (shared && !(await ctx.rbac.has("share"))) {
      return res
        .status(403)
        .json({ error: "You are not allowed to share Vault profiles" });
    }
    const row = await profiles.create(userId(), {
      name: body.name.trim(),
      description: optional(body.description),
      folder: optional(body.folder),
      tags: Array.isArray(body.tags)
        ? body.tags.join(",")
        : typeof body.tags === "string"
          ? body.tags
          : "",
      vaultAddr: body.vaultAddr.trim(),
      vaultNamespace: optional(body.vaultNamespace),
      oidcMount: optional(body.oidcMount),
      oidcRole: optional(body.oidcRole),
      sshMount: optional(body.sshMount),
      sshRole: body.sshRole.trim(),
      validPrincipals: optional(body.validPrincipals),
      keyType: optional(body.keyType),
      shared,
    });
    res.status(201).json(formatProfile(row, userId()));
  });

  /**
   * @openapi
   * /plugin-api/vault/profiles/{id}:
   *   put:
   *     summary: Update a Vault profile
   *     description: Only the owner may edit a profile. Needs vault.use, and vault.share to mark it shared.
   *     tags: [Vault]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The updated profile.
   *       400:
   *         description: Invalid profile id.
   *       403:
   *         description: Not the owner, or sharing without vault.share.
   *       404:
   *         description: Profile not found.
   */
  router.put("/profiles/:id", async (req: Request, res: Response) => {
    const id = parseId(req);
    if (id === null)
      return res.status(400).json({ error: "Invalid profile id" });
    const existing = await profiles.findById(id);
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    if (existing.userId !== userId()) {
      return res
        .status(403)
        .json({ error: "Only the owner can edit this profile" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: ProfileInput = {};
    if (isNonEmptyString(body.name)) fields.name = body.name.trim();
    if (body.description !== undefined)
      fields.description = optional(body.description);
    if (body.folder !== undefined) fields.folder = optional(body.folder);
    if (body.tags !== undefined) {
      fields.tags = Array.isArray(body.tags)
        ? body.tags.join(",")
        : typeof body.tags === "string"
          ? body.tags
          : "";
    }
    if (isNonEmptyString(body.vaultAddr))
      fields.vaultAddr = body.vaultAddr.trim();
    if (body.vaultNamespace !== undefined)
      fields.vaultNamespace = optional(body.vaultNamespace);
    if (body.oidcMount !== undefined)
      fields.oidcMount = optional(body.oidcMount);
    if (body.oidcRole !== undefined) fields.oidcRole = optional(body.oidcRole);
    if (body.sshMount !== undefined) fields.sshMount = optional(body.sshMount);
    if (isNonEmptyString(body.sshRole)) fields.sshRole = body.sshRole.trim();
    if (body.validPrincipals !== undefined)
      fields.validPrincipals = optional(body.validPrincipals);
    if (body.keyType !== undefined) fields.keyType = optional(body.keyType);
    if (body.shared !== undefined) {
      if (body.shared && !(await ctx.rbac.has("share"))) {
        return res
          .status(403)
          .json({ error: "You are not allowed to share Vault profiles" });
      }
      fields.shared = !!body.shared;
    }

    const updated = await profiles.update(id, fields);
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    res.json(formatProfile(updated, userId()));
  });

  /**
   * @openapi
   * /plugin-api/vault/profiles/{id}:
   *   delete:
   *     summary: Delete a Vault profile
   *     description: Deletes a profile and every certificate cached for it. Only the owner may delete it. Needs vault.use.
   *     tags: [Vault]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Deleted.
   *       400:
   *         description: Invalid profile id.
   *       403:
   *         description: Not the owner.
   *       404:
   *         description: Profile not found.
   */
  router.delete("/profiles/:id", async (req: Request, res: Response) => {
    const id = parseId(req);
    if (id === null)
      return res.status(400).json({ error: "Invalid profile id" });
    const existing = await profiles.findById(id);
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    if (existing.userId !== userId()) {
      return res
        .status(403)
        .json({ error: "Only the owner can delete this profile" });
    }
    await profiles.remove(existing);
    res.json({ success: true });
  });
}
