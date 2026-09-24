import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SecretSourceRepository } from "./repository.js";
import type { TokenStore } from "./token-store.js";
import { testConnectSource } from "./onepassword-connect.js";
import { parseAllowlist } from "./egress.js";

const KINDS = ["onepassword-connect"] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validBaseUrl(raw: unknown): string | null {
  if (!isNonEmptyString(raw)) return null;
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerSecretSourceRoutes(
  router: Router,
  ctx: PluginContext,
  repository: SecretSourceRepository,
  tokenStore: TokenStore,
): void {
  const isAdmin = () => ctx.rbac.has("admin.plugins.manage");
  const allowedPrivateHosts = async () =>
    parseAllowlist(await ctx.settings.get<string>("privateEndpoints"));

  /**
   * @openapi
   * /plugin-api/secret-sources:
   *   get:
   *     summary: List secret sources visible to the caller (own + shared)
   *     tags:
   *       - Secret Sources
   */
  router.get(
    "/",
    ctx.rbac.require("credentials.view") as never,
    async (req: Request, res: Response) => {
      const userId = ctx.currentActor()!;
      try {
        const rows = await repository.listVisibleToUser(userId);
        res.json({
          sources: rows.map((row) => ({
            ...row,
            owned: row.userId === userId,
          })),
        });
      } catch (error) {
        ctx.log.error("Failed to list secret sources", error);
        res.status(500).json({ error: "Failed to list secret sources" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/secret-sources:
   *   post:
   *     summary: Create a secret source (1Password Connect)
   *     description: Sharing a source with every user requires admin. The token is encrypted with the owner's data key.
   *     tags:
   *       - Secret Sources
   */
  router.post(
    "/",
    ctx.rbac.require("credentials.create") as never,
    async (req: Request, res: Response) => {
      const userId = ctx.currentActor()!;
      const {
        name,
        kind = "onepassword-connect",
        baseUrl,
        token,
        shared,
      } = req.body ?? {};
      const url = validBaseUrl(baseUrl);
      if (!isNonEmptyString(name) || !url || !isNonEmptyString(token)) {
        return res.status(400).json({
          error: "name, a valid http(s) baseUrl and token are required",
        });
      }
      if (!(KINDS as readonly string[]).includes(kind)) {
        return res
          .status(400)
          .json({ error: "Unsupported secret source kind" });
      }
      if (shared === true && !(await isAdmin())) {
        return res
          .status(403)
          .json({ error: "Only admins can share a secret source" });
      }
      try {
        const id = randomUUID();
        const created = await repository.create({
          id,
          userId,
          name: name.trim(),
          kind,
          baseUrl: url,
          shared: shared === true,
        });
        await tokenStore.set(id, token.trim());
        await ctx.audit.record({
          action: "secret_source_create",
          resourceType: "secret_source",
          resourceId: created.id,
          resourceName: created.name,
          success: true,
        });
        res.json({ source: { ...created, owned: true } });
      } catch (error) {
        ctx.log.error("Failed to create secret source", error);
        res.status(500).json({ error: "Failed to create secret source" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/secret-sources/{id}:
   *   put:
   *     summary: Update a secret source (owner only; omit token to keep it)
   *     tags:
   *       - Secret Sources
   */
  router.put(
    "/:id",
    ctx.rbac.require("credentials.edit") as never,
    async (req: Request, res: Response) => {
      const userId = ctx.currentActor()!;
      const { name, baseUrl, token, shared } = req.body ?? {};
      try {
        const source = await repository.findById(String(req.params.id));
        if (!source) {
          return res.status(404).json({ error: "Secret source not found" });
        }
        if (source.userId !== userId) {
          return res
            .status(403)
            .json({ error: "Only the owner can change this source" });
        }
        const url = baseUrl === undefined ? undefined : validBaseUrl(baseUrl);
        if (baseUrl !== undefined && !url) {
          return res.status(400).json({ error: "baseUrl must be http(s)" });
        }
        if (shared === true && !source.shared && !(await isAdmin())) {
          return res
            .status(403)
            .json({ error: "Only admins can share a secret source" });
        }
        await repository.update(source, {
          ...(isNonEmptyString(name) ? { name: name.trim() } : {}),
          ...(url ? { baseUrl: url } : {}),
          ...(typeof shared === "boolean" ? { shared } : {}),
        });
        if (isNonEmptyString(token)) {
          await tokenStore.set(source.id, token.trim());
        }
        res.json({ success: true });
      } catch (error) {
        ctx.log.error("Failed to update secret source", error);
        res.status(500).json({ error: "Failed to update secret source" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/secret-sources/{id}:
   *   delete:
   *     summary: Delete a secret source (owner only)
   *     tags:
   *       - Secret Sources
   */
  router.delete(
    "/:id",
    ctx.rbac.require("credentials.delete") as never,
    async (req: Request, res: Response) => {
      const userId = ctx.currentActor()!;
      try {
        const source = await repository.findById(String(req.params.id));
        if (!source) {
          return res.status(404).json({ error: "Secret source not found" });
        }
        if (source.userId !== userId) {
          return res
            .status(403)
            .json({ error: "Only the owner can change this source" });
        }
        await repository.deleteById(source.id);
        await tokenStore.clear(source.id);
        await ctx.audit.record({
          action: "secret_source_delete",
          resourceType: "secret_source",
          resourceId: source.id,
          resourceName: source.name,
          success: true,
        });
        res.json({ success: true });
      } catch (error) {
        ctx.log.error("Failed to delete secret source", error);
        res.status(500).json({ error: "Failed to delete secret source" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/secret-sources/{id}/test:
   *   post:
   *     summary: Check that the source is reachable and the token is accepted
   *     tags:
   *       - Secret Sources
   */
  router.post(
    "/:id/test",
    ctx.rbac.require("credentials.view") as never,
    async (req: Request, res: Response) => {
      const userId = ctx.currentActor()!;
      try {
        const source = await repository.findById(String(req.params.id));
        if (!source || (source.userId !== userId && !source.shared)) {
          return res.status(404).json({ error: "Secret source not found" });
        }
        const token = await tokenStore.getForOwner(source.id, source.userId);
        if (!token) {
          return res
            .status(200)
            .json({ ok: false, error: "No token stored for this source" });
        }
        const vaults = await testConnectSource(ctx.fetch, {
          baseUrl: source.baseUrl,
          token,
          allowedPrivateHosts: await allowedPrivateHosts(),
        });
        res.json({ ok: true, vaults });
      } catch (error) {
        res.status(200).json({ ok: false, error: errorMessage(error) });
      }
    },
  );
}
