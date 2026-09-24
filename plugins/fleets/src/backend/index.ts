import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { fleets, fleetMembers, fleetInventory } from "./tables.js";
import { createFleetRepository } from "./repository.js";
import { registerFleetRoutes } from "./routes.js";

/** What other plugins get from ctx.services.get("fleets.access", {userId}). */
export interface FleetsService {
  /** The calling user's fleets, without resolving membership. */
  list: () => Promise<
    Array<{ id: number; name: string; color: string | null }>
  >;
  /** A fleet's effective member hosts (static membership union tag matches). */
  members: (
    fleetId: number,
  ) => Promise<Array<{ id: number; name: string | null; ip: string }>>;
  /** Creates a fleet owned by the calling user. */
  create: (input: {
    name: string;
    description?: string | null;
  }) => Promise<{ id: number; name: string }>;
  /** Adds a host the calling user owns to a fleet's static membership. */
  addMember: (fleetId: number, hostId: number) => Promise<void>;
}

export async function activate(ctx: PluginContext) {
  const fleetsTable = await ctx.db.define(fleets);
  const membersTable = await ctx.db.define(fleetMembers);
  const inventoryTable = await ctx.db.define(fleetInventory);

  const repo = createFleetRepository(
    ctx.db,
    ctx.hosts,
    fleetsTable,
    membersTable,
    inventoryTable,
  );

  registerFleetRoutes(ctx.http.router<Router>(), repo, ctx);

  // The service is gated on fleets.view; changing a fleet also needs
  // fleets.manage, as its routes do.
  async function requireManage(): Promise<void> {
    if (!(await ctx.rbac.has("manage"))) {
      throw new Error("Missing permission fleets.manage");
    }
  }

  const service: FleetsService = {
    list: async () => {
      const userId = ctx.currentActor();
      if (!userId) return [];
      const rows = await repo.listByUser(userId);
      return rows.map((f) => ({ id: f.id, name: f.name, color: f.color }));
    },
    members: async (fleetId) => {
      const userId = ctx.currentActor();
      if (!userId) return [];
      const members = await repo.listEffectiveMembers(userId, fleetId);
      return members.map((m) => ({ id: m.id, name: m.name, ip: m.ip }));
    },
    create: async (input) => {
      const userId = ctx.currentActor();
      if (!userId) throw new Error("fleets.access.create needs an actor");
      await requireManage();
      const created = await repo.create(userId, input);
      return { id: created.id, name: created.name };
    },
    addMember: async (fleetId, hostId) => {
      const userId = ctx.currentActor();
      if (!userId) throw new Error("fleets.access.addMember needs an actor");
      await requireManage();
      // A host joins a fleet only if the caller can see it.
      if (!(await ctx.hosts.get(hostId))) throw new Error("Host not found");
      const fleet = await repo.findById(userId, fleetId);
      if (!fleet) throw new Error("Fleet not found");
      await repo.addMember(fleetId, hostId);
    },
  };
  ctx.services.provide("fleets.access", service);

  ctx.log.info("Fleets routes mounted at /plugin-api/fleets");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
