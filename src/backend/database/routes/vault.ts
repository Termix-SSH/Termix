import express from "express";
import type { Request, Response } from "express";
import { desc, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, vaultProfiles } from "../db/schema.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { completeVaultAuth } from "../../ssh/vault-oidc-auth.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

async function userIsAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return !!rows[0]?.isAdmin;
  } catch {
    return false;
  }
}

function formatProfile(
  row: Record<string, unknown>,
  currentUserId: string,
): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    folder: row.folder,
    tags:
      typeof row.tags === "string"
        ? row.tags
          ? (row.tags as string).split(",").filter(Boolean)
          : []
        : [],
    vaultAddr: row.vaultAddr,
    vaultNamespace: row.vaultNamespace,
    oidcMount: row.oidcMount,
    oidcRole: row.oidcRole,
    sshMount: row.sshMount,
    sshRole: row.sshRole,
    validPrincipals: row.validPrincipals,
    keyType: row.keyType,
    shared: !!row.shared,
    owned: row.userId === currentUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Vault OIDC callback. Unauthenticated: the browser is redirected here by the
 * IdP after login. Correlation is via the unguessable Vault `state`.
 */
router.get("/oidc/callback", async (req: Request, res: Response) => {
  const state = String(req.query.state || "");
  const code = String(req.query.code || "");
  const oidcError = req.query.error ? String(req.query.error) : "";

  const html = (title: string, message: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:420px;text-align:center;padding:24px;border:1px solid #2a2a2e;border-radius:8px}</style></head>
<body><div class="card"><h2>${title}</h2><p>${message}</p>
<script>setTimeout(function(){window.close()},1500)</script></div></body></html>`;

  if (oidcError) {
    return res
      .status(400)
      .send(html("Vault sign-in failed", `Vault returned: ${oidcError}`));
  }
  if (!state || !code) {
    return res
      .status(400)
      .send(html("Vault sign-in failed", "Missing state or code."));
  }

  const result = await completeVaultAuth(state, code);
  if (result.ok) {
    return res.send(
      html(
        "Vault sign-in complete",
        "You can close this window and return to Termix.",
      ),
    );
  }
  return res
    .status(400)
    .send(
      html("Vault sign-in failed", result.error || "Authentication failed."),
    );
});

/** List Vault profiles visible to the user (owned or shared). */
router.get(
  "/profiles",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const rows = await db
        .select()
        .from(vaultProfiles)
        .where(
          or(eq(vaultProfiles.userId, userId), eq(vaultProfiles.shared, true)),
        )
        .orderBy(desc(vaultProfiles.updatedAt));
      res.json(
        rows.map((r) => formatProfile(r as Record<string, unknown>, userId)),
      );
    } catch (err) {
      authLogger.error("Failed to list vault profiles", err);
      res.status(500).json({ error: "Failed to list vault profiles" });
    }
  },
);

/** Create a Vault profile. The `shared` flag is admin-only. */
router.post(
  "/profiles",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const {
      name,
      description,
      folder,
      tags,
      vaultAddr,
      vaultNamespace,
      oidcMount,
      oidcRole,
      sshMount,
      sshRole,
      validPrincipals,
      keyType,
      shared,
    } = req.body;

    if (
      !isNonEmptyString(name) ||
      !isNonEmptyString(vaultAddr) ||
      !isNonEmptyString(sshRole)
    ) {
      return res
        .status(400)
        .json({ error: "name, vaultAddr and sshRole are required" });
    }

    const wantShared = !!shared;
    if (wantShared && !(await userIsAdmin(userId))) {
      return res
        .status(403)
        .json({
          error: "Only administrators can create shared Vault profiles",
        });
    }

    try {
      const inserted = await db
        .insert(vaultProfiles)
        .values({
          userId,
          name: name.trim(),
          description: description?.trim() || null,
          folder: folder?.trim() || null,
          tags: Array.isArray(tags) ? tags.join(",") : tags || "",
          vaultAddr: vaultAddr.trim(),
          vaultNamespace: vaultNamespace?.trim() || null,
          oidcMount: oidcMount?.trim() || null,
          oidcRole: oidcRole?.trim() || null,
          sshMount: sshMount?.trim() || null,
          sshRole: sshRole.trim(),
          validPrincipals: validPrincipals?.trim() || null,
          keyType: keyType?.trim() || null,
          shared: wantShared,
        })
        .returning();
      res
        .status(201)
        .json(formatProfile(inserted[0] as Record<string, unknown>, userId));
    } catch (err) {
      authLogger.error("Failed to create vault profile", err);
      res.status(500).json({ error: "Failed to create vault profile" });
    }
  },
);

/** Update a Vault profile (owner only; `shared` toggle is admin-only). */
router.put(
  "/profiles/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid profile id" });
    }

    try {
      const existing = await db
        .select()
        .from(vaultProfiles)
        .where(eq(vaultProfiles.id, id))
        .limit(1);
      if (!existing.length) {
        return res.status(404).json({ error: "Profile not found" });
      }
      if (existing[0].userId !== userId) {
        return res
          .status(403)
          .json({ error: "Only the owner can edit this profile" });
      }

      const body = req.body;
      const fields: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (body.name !== undefined) fields.name = body.name?.trim();
      if (body.description !== undefined)
        fields.description = body.description?.trim() || null;
      if (body.folder !== undefined)
        fields.folder = body.folder?.trim() || null;
      if (body.tags !== undefined)
        fields.tags = Array.isArray(body.tags)
          ? body.tags.join(",")
          : body.tags || "";
      if (body.vaultAddr !== undefined && isNonEmptyString(body.vaultAddr))
        fields.vaultAddr = body.vaultAddr.trim();
      if (body.vaultNamespace !== undefined)
        fields.vaultNamespace = body.vaultNamespace?.trim() || null;
      if (body.oidcMount !== undefined)
        fields.oidcMount = body.oidcMount?.trim() || null;
      if (body.oidcRole !== undefined)
        fields.oidcRole = body.oidcRole?.trim() || null;
      if (body.sshMount !== undefined)
        fields.sshMount = body.sshMount?.trim() || null;
      if (body.sshRole !== undefined && isNonEmptyString(body.sshRole))
        fields.sshRole = body.sshRole.trim();
      if (body.validPrincipals !== undefined)
        fields.validPrincipals = body.validPrincipals?.trim() || null;
      if (body.keyType !== undefined)
        fields.keyType = body.keyType?.trim() || null;
      if (body.shared !== undefined) {
        if (!!body.shared && !(await userIsAdmin(userId))) {
          return res.status(403).json({
            error: "Only administrators can share Vault profiles",
          });
        }
        fields.shared = !!body.shared;
      }

      const updated = await db
        .update(vaultProfiles)
        .set(fields)
        .where(eq(vaultProfiles.id, id))
        .returning();
      res.json(formatProfile(updated[0] as Record<string, unknown>, userId));
    } catch (err) {
      authLogger.error("Failed to update vault profile", err);
      res.status(500).json({ error: "Failed to update vault profile" });
    }
  },
);

/** Delete a Vault profile (owner only). */
router.delete(
  "/profiles/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid profile id" });
    }
    try {
      const existing = await db
        .select()
        .from(vaultProfiles)
        .where(eq(vaultProfiles.id, id))
        .limit(1);
      if (!existing.length) {
        return res.status(404).json({ error: "Profile not found" });
      }
      if (existing[0].userId !== userId) {
        return res
          .status(403)
          .json({ error: "Only the owner can delete this profile" });
      }
      await db.delete(vaultProfiles).where(eq(vaultProfiles.id, id));
      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete vault profile", err);
      res.status(500).json({ error: "Failed to delete vault profile" });
    }
  },
);

export default router;
