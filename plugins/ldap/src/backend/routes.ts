import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { identityProvider } from "./ldap.js";
import type { ProviderStore } from "./providers.js";
import { REQUIRED_FIELDS, type ProviderRow } from "./types.js";

function fail(
  ctx: PluginContext,
  res: Response,
  message: string,
  error: unknown,
) {
  ctx.log.error(
    message,
    error instanceof Error ? error : new Error(String(error)),
  );
  res.status(500).json({ error: message });
}

function missingFields(config: Record<string, unknown>): string[] {
  return REQUIRED_FIELDS.filter((field) => !config[field]);
}

export function registerLdapRoutes(
  router: Router,
  ctx: PluginContext,
  store: ProviderStore,
): void {
  router.use(ctx.rbac.require("manage") as never);

  async function present(row: ProviderRow) {
    const { bindPassword, ...config } = (await store.parseConfig(
      row.config,
    )) as unknown as Record<string, unknown>;
    return {
      id: row.id,
      name: row.name,
      enabled: !!row.enabled,
      displayOrder: row.displayOrder,
      config,
      hasBindPassword: typeof bindPassword === "string" && !!bindPassword,
    };
  }

  /**
   * @openapi
   * /plugin-api/ldap/providers:
   *   get:
   *     summary: List LDAP directories
   *     description: Every configured LDAP directory. The bind password is never sent, only whether one is set. Needs ldap.manage.
   *     tags:
   *       - LDAP
   *     responses:
   *       200:
   *         description: Directories.
   *       403:
   *         description: Missing permission.
   */
  router.get("/providers", async (_req: Request, res: Response) => {
    try {
      const rows = await store.listRows();
      res.json({ providers: await Promise.all(rows.map(present)) });
    } catch (error) {
      fail(ctx, res, "Failed to list LDAP providers", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/ldap/providers:
   *   post:
   *     summary: Add an LDAP directory
   *     description: Needs ldap.manage.
   *     tags:
   *       - LDAP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               enabled:
   *                 type: boolean
   *               config:
   *                 type: object
   *     responses:
   *       201:
   *         description: Directory added.
   *       400:
   *         description: Missing fields.
   *       403:
   *         description: Missing permission.
   */
  router.post("/providers", async (req: Request, res: Response) => {
    try {
      const {
        name,
        enabled = true,
        displayOrder = 0,
        config = {},
      } = req.body ?? {};
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Provider name is required" });
        return;
      }
      const missing = missingFields(config);
      if (missing.length > 0) {
        res.status(400).json({
          error: `Missing required LDAP fields: ${missing.join(", ")}`,
        });
        return;
      }
      const row = await store.create({
        name: name.trim(),
        enabled: !!enabled,
        displayOrder: Number(displayOrder) || 0,
        config: { ...(config as Record<string, unknown>) },
      });
      await ctx.audit.record({
        action: "ldap_provider_create",
        resourceType: "ldap_provider",
        resourceId: String(row.id),
        resourceName: row.name,
        success: true,
      });
      res.status(201).json(await present(row));
    } catch (error) {
      fail(ctx, res, "Failed to create LDAP provider", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/ldap/providers/{id}:
   *   put:
   *     summary: Update an LDAP directory
   *     description: Config fields are merged over the stored ones; an empty bind password keeps the stored one. Needs ldap.manage.
   *     tags:
   *       - LDAP
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Directory updated.
   *       400:
   *         description: Missing fields.
   *       403:
   *         description: Missing permission.
   *       404:
   *         description: Directory not found.
   */
  router.put("/providers/:id", async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      const row = Number.isInteger(id) ? await store.findRow(id) : null;
      if (!row) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }
      const { name, enabled, displayOrder, config } = req.body ?? {};
      const values: Parameters<ProviderStore["update"]>[1] = {};
      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "Provider name is required" });
          return;
        }
        values.name = name.trim();
      }
      if (enabled !== undefined) values.enabled = !!enabled;
      if (displayOrder !== undefined) {
        values.displayOrder = Number(displayOrder) || 0;
      }
      if (config && typeof config === "object") {
        const incoming = { ...(config as Record<string, unknown>) };
        if (!incoming.bindPassword) delete incoming.bindPassword;
        const merged = {
          ...((await store.parseConfig(row.config)) as unknown as Record<
            string,
            unknown
          >),
          ...incoming,
        };
        const missing = missingFields(merged);
        if (missing.length > 0) {
          res.status(400).json({
            error: `Missing required LDAP fields: ${missing.join(", ")}`,
          });
          return;
        }
        values.config = merged;
      }
      const updated = await store.update(id, values);
      await ctx.audit.record({
        action: "ldap_provider_update",
        resourceType: "ldap_provider",
        resourceId: String(id),
        resourceName: updated?.name ?? row.name,
        success: true,
      });
      res.json(await present(updated ?? row));
    } catch (error) {
      fail(ctx, res, "Failed to update LDAP provider", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/ldap/providers/{id}:
   *   delete:
   *     summary: Delete an LDAP directory
   *     description: Refused while users still sign in with it. Needs ldap.manage.
   *     tags:
   *       - LDAP
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Directory deleted.
   *       403:
   *         description: Missing permission.
   *       404:
   *         description: Directory not found.
   *       409:
   *         description: Users are still linked to it.
   */
  router.delete("/providers/:id", async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      const row = Number.isInteger(id) ? await store.findRow(id) : null;
      if (!row) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }
      if ((await ctx.auth.countLinkedUsers(identityProvider(id))) > 0) {
        res.status(409).json({
          error:
            "Users still sign in with this directory. Disable it instead, or remove those users first.",
        });
        return;
      }
      await store.remove(id);
      await ctx.audit.record({
        action: "ldap_provider_delete",
        resourceType: "ldap_provider",
        resourceId: String(id),
        resourceName: row.name,
        success: true,
      });
      res.json({ message: "LDAP provider deleted" });
    } catch (error) {
      fail(ctx, res, "Failed to delete LDAP provider", error);
    }
  });
}
